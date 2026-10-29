#!/usr/bin/env python3
"""Gera o diagrama E/R físico de um banco PostgreSQL a partir do catálogo.

    python3 scripts/build.py [--online] [--no-mermaid] [--keep-json] [--banco-atras]
    python3 scripts/build.py --iniciar       # cria a configuração do projeto a partir do modelo

O mecanismo (este script, o modelo da página e a consulta ao catálogo) não sabe nada do projeto. O que muda de um
projeto para outro fica em <raiz>/.agents/er-diagram-generator/: config.json (acesso ao banco, pasta das migrações,
pastas das entidades, saídas) e domains.json (a folha de cada tabela, curada à mão). A raiz é a do repositório git em
que o comando roda, ou a pasta acima da atual que tem .agents/er-diagram-generator/; ER_RAIZ a sobrescreve, e ER_DADOS
aponta outra pasta de dados.

Só faz leitura no banco: SELECT no catálogo e count(*) por tabela.
"""
import argparse, base64, datetime, html, json, os, re, shutil, subprocess, sys

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASTA_DOS_DADOS = os.path.join('.agents', 'er-diagram-generator')


def raiz():
    if os.environ.get('ER_RAIZ'):
        return os.path.abspath(os.environ['ER_RAIZ'])
    # Sobe a partir da pasta atual até achar a pasta de dados do projeto, sem passar da raiz do git: assim a skill
    # funciona instalada como plugin e num projeto que fica numa subpasta do repositório.
    try:
        topo = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True,
                              check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        topo = None
    pasta = os.getcwd()
    while True:
        if os.path.isdir(os.path.join(pasta, PASTA_DOS_DADOS)):
            return pasta
        acima = os.path.dirname(pasta)
        if pasta == topo or acima == pasta:
            break
        pasta = acima
    return topo or os.getcwd()


def cache_do_kit():
    """Pasta do usuário para o que se baixa uma vez por máquina: sobrevive às atualizações do plugin."""
    base = os.environ.get('XDG_CACHE_HOME') or os.path.join(os.path.expanduser('~'), '.cache')
    return os.environ.get('SKILL_KIT_CACHE') or os.path.join(base, 'skill-kit')


def pasta_do_vendor():
    """O ELK e as fontes: em assets/vendor da skill, se já baixados ali, ou no cache do usuário."""
    local = os.path.join(SKILL, 'assets/vendor')
    if os.path.exists(os.path.join(local, 'elk.bundled.js')):
        return local
    return os.path.join(cache_do_kit(), 'vendor')


ROOT = raiz()
DADOS = os.path.abspath(os.environ.get('ER_DADOS') or os.path.join(ROOT, PASTA_DOS_DADOS))
CFG = {}

COUNTS_SQL = """select table_name, (xpath('/row/c/text()',
  query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint
from information_schema.tables where table_schema=:'schema' and table_type='BASE TABLE' order by 1"""
# Com versões por timestamp e out-of-order, a última instalada não é necessariamente a mais nova: vale a maior versão
# aplicada, e o total aplicado se confere com os arquivos.
FLYWAY_SQL = """select version, description, (select count(*) from flyway_schema_history where success and version is not null)
from flyway_schema_history where success and version is not null order by length(version) desc, version desc limit 1"""
APPLIED_SQL = "select version from flyway_schema_history where success and version is not null"


def configuracao():
    caminho = os.path.join(DADOS, 'config.json')
    if not os.path.exists(caminho):
        sys.exit(f'Sem configuração da planta do banco em {caminho}. Rode `build.py --iniciar` para criar uma a partir '
                 'do modelo e ajuste-a ao projeto.')
    return json.load(open(caminho, encoding='utf-8'))


def iniciar():
    destino = os.path.join(DADOS, 'config.json')
    if os.path.exists(destino):
        sys.exit(f'{destino} já existe.')
    os.makedirs(DADOS, exist_ok=True)
    shutil.copy(os.path.join(SKILL, 'scripts/config.modelo.json'), destino)
    dominios = os.path.join(DADOS, 'domains.json')
    if not os.path.exists(dominios):
        shutil.copy(os.path.join(SKILL, 'scripts/domains.modelo.json'), dominios)
    print(f'{os.path.relpath(destino, ROOT)} e domains.json criados a partir do modelo: ajuste o acesso ao banco, a '
          'pasta das migrações, as pastas das entidades e as saídas. Depois rode o build: ele lista as tabelas sem '
          'folha, para classificar em domains.json.')


def psql(sql=None, file=None):
    banco = CFG['banco']
    if banco.get('url'):
        cmd = ['psql', banco['url']]
    else:
        cmd = ['docker', 'exec', '-i', banco['container'], 'psql', '-U', banco['usuario'], '-d', banco['nome']]
    cmd += ['-At', '-v', f"schema={banco.get('schema', 'public')}", '-f', '-']
    entrada = open(file).read() if file else sql
    r = subprocess.run(cmd, capture_output=True, text=True, input=entrada)
    if r.returncode:
        onde = 'o banco está acessível pela url da configuração?' if banco.get('url') \
            else f"o container '{banco['container']}' está de pé?"
        sys.exit(f"erro ao consultar o banco ({onde}):\n{r.stderr.strip()}")
    return r.stdout


def migration_files():
    """Versão → nome de arquivo de cada migração do repositório."""
    pasta = (CFG.get('migracoes') or {}).get('pasta')
    folder = os.path.join(ROOT, pasta) if pasta else None
    if not folder or not os.path.isdir(folder):
        return None
    return {m.group(1): f for f in os.listdir(folder) if (m := re.match(r'V(\d+)__.+\.sql$', f))}


def flyway_meta(row, files):
    """Versão mais nova aplicada, a data UTC que o timestamp dela carrega e o total aplicado × arquivos no repositório."""
    version, desc, applied = (row.split('|') + ['', '', '0'])[:3] if row else ('?', '', '0')
    when = None
    if re.fullmatch(r'\d{14}', version):
        when = datetime.datetime.strptime(version, '%Y%m%d%H%M%S').strftime('%d/%m/%Y %H:%M') + ' UTC'
    return {'v': version, 'desc': desc, 'when': when, 'applied': int(applied or 0),
            'files': len(files) if files is not None else None}


def check_migrations(files, applied, allow_behind):
    """A planta tem de mostrar o banco do código atual: migração do repositório ainda não aplicada para o build.

    Com --banco-atras o build segue e só avisa. Migração aplicada sem arquivo no repositório (banco de outro branch)
    só avisa: o banco está à frente, não atrás.
    """
    if files is None:
        return
    pending = sorted(v for v in files if v not in applied)
    extra = sorted(applied - set(files))
    if pending:
        como = (CFG.get('migracoes') or {}).get('como_aplicar') or 'aplique-as'
        msg = (f'o banco não tem {len(pending)} migração(ões) do repositório — a planta sairia desatualizada:\n  '
               + '\n  '.join(files[v] for v in pending)
               + f'\n{como} e rode de novo, ou gere assim mesmo com --banco-atras')
        if not allow_behind:
            sys.exit(msg)
        print('⚠ ' + msg.rsplit('\n', 1)[0])
    if extra:
        print(f'⚠ o banco tem {len(extra)} migração(ões) sem arquivo no repositório (veio de outro branch?): '
              + ', '.join('V' + v for v in extra))


def scan_entities():
    """Mapa tabela → entidade JPA, varrendo as anotações dos .java nas pastas da configuração."""
    ents, join = {}, {}
    for pasta in (CFG.get('entidades') or {}).get('pastas', []):
        base = os.path.join(ROOT, pasta)
        if not os.path.isdir(base):
            sys.exit(f'a pasta de entidades `{pasta}` da configuração não existe')
        for dirpath, _, files in os.walk(base):
            scan_folder(dirpath, files, ents, join)
    return ents, join


def scan_folder(dirpath, files, ents, join):
    """Entidades e tabelas de junção declaradas nos .java de uma pasta."""
    for f in files:
        if not f.endswith('.java'):
            continue
        src = open(os.path.join(dirpath, f), encoding='utf-8').read()
        if re.search(r'^@Entity\b', src, re.M):
            m = re.search(r'@Table\s*\(\s*(?:name\s*=\s*)?"([^"]+)"', src)
            cls = f[:-5]
            ext = re.search(r'class\s+\w+\s+extends\s+(\w+)', src)
            pkg = re.search(r'^package\s+([\w.]+)\s*;', src, re.M)
            ents[(m.group(1) if m else cls).lower()] = {
                'class': cls, 'pkg': pkg.group(1) if pkg else None, 'extends': ext.group(1) if ext else None}
        for m in re.finditer(r'@(JoinTable|CollectionTable)\s*\(\s*name\s*=\s*"([^"]+)"', src):
            join[m.group(2).lower()] = {'kind': m.group(1), 'class': f[:-5]}


def short(ty):
    s = re.sub(r'^character varying', 'varchar', ty)
    s = re.sub(r'^character\b', 'char', s)
    s = re.sub(r'^timestamp(\(\d\))? without time zone$', 'timestamp', s)
    s = re.sub(r'^timestamp(\(\d\))? with time zone$', 'timestamptz', s)
    return {'integer': 'int4', 'bigint': 'int8', 'smallint': 'int2', 'boolean': 'bool',
            'double precision': 'float8', 'real': 'float4'}.get(s, s)


def build_tables(schema, counts, dom_of, ents, join):
    out, fk_total = {}, 0
    for t in schema:
        n, cons = t['table'], t['cons'] or []
        pk = next((c['cols'] for c in cons if c['type'] == 'p'), [])
        uniq = [set(c['cols']) for c in cons if c['type'] == 'u']
        con_names = {c['name'] for c in cons}
        ux = []
        for ix in t['uidx'] or []:
            if ix['name'] in con_names:
                continue  # índice criado por uma constraint já listada
            m = re.search(r'USING \w+ \(([^)]*)\)(?:\s+WHERE\s+(.*))?$', ix['def'])
            cols = [x.strip() for x in m.group(1).split(',')] if m else []
            where = m.group(2) if m and m.group(2) else None
            ux.append({'n': ix['name'], 'c': cols, 'w': where})
            if not where:
                uniq.append(set(cols))
        cols = [{'n': c['name'], 'ty': short(c['type']), 'tf': c['type'], 'nn': c['nn'], 'df': c['def']} for c in t['cols']]
        nn = {c['n']: c['nn'] for c in cols}
        en, ck = {}, []
        for c in cons:
            if c['type'] != 'c':
                continue
            d, refs = c['def'], set(re.findall(r'\((\w+)\)::text = ANY', c['def']))
            if len(refs) == 1 and 'ARRAY[' in d and ' AND ' not in d:
                en[refs.pop()] = re.findall(r"'([^']*)'::", d.split('ARRAY[', 1)[1])
            else:
                ck.append({'n': c['name'], 'd': re.sub(r'\s+', ' ', d)})
        fks = []
        for c in cons:
            if c['type'] != 'f':
                continue
            fk_total += 1
            cs = c['cols']
            pkfk = set(cs) == set(pk)
            fks.append({'c': cs, 't': c['ref'], 'rc': c['refcols'], 'od': c['ondelete'], 'nm': c['name'],
                        'o2o': pkfk or any(set(cs) == u for u in uniq), 'pkfk': pkfk,
                        'opt': any(not nn.get(x, True) for x in cs)})
        e, j = ents.get(n), join.get(n)
        out[n] = {'d': dom_of[n], 'e': e['class'] if e else None,
                  'ep': e['pkg'] if e else None,
                  'ex': e['extends'] if e else None,
                  'j': j['class'] if j else None, 'jk': j['kind'] if j else None,
                  'r': counts.get(n, 0), 'cm': t['comment'], 'c': cols, 'pk': pk, 'fk': fks,
                  'uq': [c['cols'] for c in cons if c['type'] == 'u'], 'ux': ux, 'en': en, 'ck': ck}
    return out, fk_total


def render_html(data, online):
    tpl = open(os.path.join(SKILL, 'assets/template.html'), encoding='utf-8').read()
    tpl = tpl.replace('__BANCO__', html.escape(data['meta']['db']))
    assert '/*__DATA__*/null' in tpl, 'template sem o marcador de dados'
    src = tpl.replace('/*__DATA__*/null', json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/'))
    if not online:
        vendor = pasta_do_vendor()
        elk_path, fonts_path = os.path.join(vendor, 'elk.bundled.js'), os.path.join(vendor, 'fonts.css')
        if not (os.path.exists(elk_path) and os.path.exists(fonts_path)):
            sys.exit(f'ELK e fontes não encontrados em {vendor} — rode `bash {os.path.join(SKILL, "scripts/vendor.sh")}` '
                     'uma vez, ou gere com --online')
        elk = open(elk_path, encoding='utf-8').read()
        assert '</script' not in elk.lower(), 'elk.bundled.js fecharia o <script> da página'
        links = re.compile(r'<link rel="preconnect"[^>]*>\s*<link rel="preconnect"[^>]*>\s*<link rel="stylesheet" href="https://fonts\.googleapis\.com[^"]*">')
        assert links.search(src), 'template sem os <link> das fontes'
        src = links.sub(lambda m: '<style>\n' + open(fonts_path, encoding='utf-8').read() + '</style>', src, count=1)
        tag = re.search(r'<script src="https://cdn\.jsdelivr\.net/npm/elkjs@[^"]+"></script>', src)
        assert tag, 'template sem o <script> do ELK'
        src = src.replace(tag.group(0), '<script>\n/* elkjs (EPL-2.0), embutido para uso offline */\n' + elk + '\n</script>', 1)
    return ('<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            + src.replace('<div class="app">', '</head>\n<body>\n<div class="app">', 1) + '\n</body>\n</html>\n')


def render_mermaid(data):
    meta, doms, T = data['meta'], data['domains'], data['t']
    fw = meta['flyway']
    versao = ''
    if fw:
        quando = f' ({fw["when"]})' if fw['when'] else ''
        versao = f' em Flyway **V{fw["v"]}**{quando}, {fw["applied"]} migrações aplicadas'
    mty = lambda s: re.sub(r'[^A-Za-z0-9_]', '_', s).strip('_') or 'tipo'
    md = [f'# Diagrama E/R do banco `{meta["db"]}` — schema físico\n',
          f'> Gerado pela skill `er-diagram-generator` a partir do catálogo do PostgreSQL em {meta["stamp"]}.',
          f'> Schema `{meta["schema"]}`{versao}: {meta["tables"]} tabelas, {meta["fks"]} chaves estrangeiras.',
          '> Modelo **físico** — o lógico, vindo dos requisitos, é o do `mermaid-diagram-generator`.',
          '> Cardinalidade pela coluna real: `||` FK NOT NULL, `|o` FK anulável; `o{` muitos,',
          f'> `o|` quando a FK é PK ou UNIQUE (1:1). Versão navegável: `{meta["html"]}`.\n']
    for d in doms:
        md.append(f'## {d["label"]}\n\n{d["desc"]}\n\n```mermaid\nerDiagram')
        for n in d['tables']:
            v = T[n]
            pks, fkc = set(v['pk']), {c for f in v['fk'] for c in f['c']}
            md.append(f'    {n} {{')
            for c in v['c']:
                keys = ','.join(k for k, ok in (('PK', c['n'] in pks), ('FK', c['n'] in fkc)) if ok)
                md.append(f'        {mty(c["ty"])} {c["n"]}{(" " + keys) if keys else ""}{"" if c["nn"] else " \"null\""}')
            md.append('    }')
        for n in d['tables']:
            for f in T[n]['fk']:
                left = '|o' if f['opt'] else '||'
                right = 'o|' if f['o2o'] else 'o{'
                md.append(f'    {f["t"]} {left}--{right} {n} : "{", ".join(f["c"])}"')
        md.append('```\n')
    return '\n'.join(md)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--online', action='store_true', help='busca ELK e fontes na CDN (página bem menor)')
    ap.add_argument('--no-mermaid', action='store_true', help='não escreve o Mermaid por domínio')
    ap.add_argument('--keep-json', action='store_true', help='guarda o catálogo cru ao lado da página')
    ap.add_argument('--banco-atras', action='store_true',
                    help='gera mesmo com migração do repositório ainda não aplicada no banco (só avisa)')
    ap.add_argument('--iniciar', action='store_true', help='cria a configuração do projeto a partir do modelo')
    args = ap.parse_args()
    if args.iniciar:
        iniciar()
        return

    CFG.update(configuracao())
    saidas = {'html': 'docs/diagramas/planta-do-banco.html', 'mermaid': 'docs/diagramas/mermaid/ER-banco-fisico.md',
              'url_do_artefato': 'docs/diagramas/.er-artifact-url', **(CFG.get('saidas') or {})}
    usa_flyway = (CFG.get('migracoes') or {}).get('flyway', True)
    doms = json.load(open(os.path.join(DADOS, 'domains.json'), encoding='utf-8'))['domains']
    files = migration_files() if usa_flyway else None
    if usa_flyway:
        check_migrations(files, set(psql(APPLIED_SQL).split()), args.banco_atras)
    schema = json.loads(psql(file=os.path.join(SKILL, 'scripts/schema.sql')).strip() or 'null') or []
    counts = dict((l.split('|')[0], int(l.split('|')[1])) for l in psql(COUNTS_SQL).splitlines() if '|' in l)
    flyway = flyway_meta(psql(FLYWAY_SQL).strip(), files) if usa_flyway else None
    names = {t['table'] for t in schema}

    # Todos os desvios de uma vez, para acertar domains.json numa passada só.
    dom_of, stale, twice = {}, [], []
    for d in doms:
        for t in d['tables']:
            if t not in names:
                stale.append(f"{t} (folha {d['id']})")
            elif t in dom_of:
                twice.append(f'{t} (folhas {dom_of[t]} e {d["id"]})')
            else:
                dom_of[t] = d['id']
    orphans = sorted(names - set(dom_of))
    problems = [(titulo, itens) for titulo, itens in (
        ('não existem no banco — remova a linha', stale),
        ('estão em duas folhas — deixe em uma', twice),
        ('não têm folha — classifique cada uma', orphans)) if itens]
    if problems:
        sys.exit('domains.json não bate com o banco:\n' + '\n'.join(
            f'- {titulo}:\n    ' + '\n    '.join(itens) for titulo, itens in problems))

    ents, join = scan_entities()
    tables, fks = build_tables(schema, counts, dom_of, ents, join)
    stamp = datetime.datetime.now().strftime('%d/%m/%Y %H:%M')
    url_path = os.path.join(ROOT, saidas['url_do_artefato'])
    data = {'meta': {'tables': len(tables), 'fks': fks, 'rows': sum(v['r'] for v in tables.values()),
                     'empty': sum(1 for v in tables.values() if v['r'] == 0), 'flyway': flyway, 'stamp': stamp,
                     'db': CFG['banco'].get('nome') or 'postgres', 'schema': CFG['banco'].get('schema', 'public'),
                     'entidades': bool((CFG.get('entidades') or {}).get('pastas')), 'html': saidas['html'],
                     'url': open(url_path).read().strip() if os.path.exists(url_path) else None},
            'domains': [{k: d[k] for k in ('id', 'label', 'hue', 'chroma', 'desc', 'tables')} for d in doms],
            't': tables}

    html_path = os.path.join(ROOT, saidas['html'])
    os.makedirs(os.path.dirname(html_path), exist_ok=True)
    open(html_path, 'w', encoding='utf-8').write(render_html(data, args.online))
    print(f'{saidas["html"]}  ({os.path.getsize(html_path) // 1024} KB, {"online" if args.online else "offline"})')
    if not args.no_mermaid and saidas.get('mermaid'):
        mmd_path = os.path.join(ROOT, saidas['mermaid'])
        os.makedirs(os.path.dirname(mmd_path), exist_ok=True)
        open(mmd_path, 'w', encoding='utf-8').write(render_mermaid(data))
        print(f'{saidas["mermaid"]}  ({os.path.getsize(mmd_path) // 1024} KB)')
    if args.keep_json:
        json.dump(data, open(os.path.join(os.path.dirname(html_path), 'er-catalogo.json'), 'w'), ensure_ascii=False,
                  indent=1)
    m = data['meta']
    fw = m['flyway']
    versao = f'V{fw["v"]} ({fw["when"] or "versão sem timestamp"}) · {fw["applied"]} migrações · ' if fw else ''
    print(f'{versao}{m["tables"]} tabelas · {m["fks"]} FKs · {m["rows"]:,} linhas · {m["empty"]} vazias'.replace(',', '.'))
    sem_entidade = sorted(n for n, v in tables.items() if not v['e'] and not v['j'])
    if sem_entidade and m['entidades']:
        print('sem entidade JPA: ' + ', '.join(sem_entidade))
    sem_tabela = sorted(set(ents) - names) + sorted(set(join) - names)
    if sem_tabela and m['entidades']:
        print('⚠ mapeadas no código e ausentes no banco (migração faltando, ou @Table com o nome errado): '
              + ', '.join(sem_tabela))


if __name__ == '__main__':
    main()
