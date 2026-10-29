#!/usr/bin/env python3
"""Gera o diagrama de classes UML das entidades persistentes a partir do código-fonte.

    python3 scripts/build.py [--online] [--keep-json]
    python3 scripts/build.py --iniciar       # cria a configuração do projeto a partir do modelo

O mecanismo (este script e o modelo da página) não sabe nada do projeto. O que muda de um projeto para outro fica em
<raiz>/.agents/uml-class-diagram-generator/: config.json (linguagem, pastas do código, arquivo das folhas, saídas) e, quando o
projeto não reaproveita as folhas da planta do banco, domains.json (a folha de cada classe, curada à mão). A raiz é a
pasta que contém o .agents/skills/ onde a skill está instalada (fora disso, a do repositório git em que o comando
roda); UML_RAIZ a sobrescreve, e UML_DADOS aponta outra pasta de dados.

A linguagem do código é obrigatória na configuração (entidades.linguagem), sem padrão: ela escolhe o leitor (ver
LEITORES). Só lê os arquivos-fonte: não compila, não sobe aplicação e não consulta banco.
"""
import argparse, datetime, importlib, json, os, re, shutil, subprocess, sys

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASTA_DOS_DADOS = os.path.join('.agents', 'uml-class-diagram-generator')
# Onde a planta do banco (skill er-diagram-generator) guarda as folhas, na versão exportável e na antiga.
FOLHAS_DA_PLANTA = [os.path.join('.agents', 'er-diagram-generator', 'domains.json'),
                    os.path.join('.agents', 'skills', 'er-diagram-generator', 'domains.json')]


def raiz():
    if os.environ.get('UML_RAIZ'):
        return os.path.abspath(os.environ['UML_RAIZ'])
    skills = os.path.dirname(SKILL)  # instalada em <raiz>/.agents/skills/<skill>: vale mesmo sem git próprio
    if os.path.basename(skills) == 'skills' and os.path.basename(os.path.dirname(skills)) == '.agents':
        return os.path.dirname(os.path.dirname(skills))
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
DADOS = os.path.abspath(os.environ.get('UML_DADOS') or os.path.join(ROOT, PASTA_DOS_DADOS))
AVISOS = []
CONVENCOES = ('snake_case', 'minusculas')
CONVENCAO = None  # entidades.nomes_no_banco: como tabelas e colunas sem nome explícito viram nomes no banco


def no_banco(nome):
    """Nome de tabela ou coluna como fica no banco, pela convenção da configuração (sem ela, como no código)."""
    if not nome or nome == '(padrão)' or not CONVENCAO:
        return nome
    if CONVENCAO == 'minusculas':
        return nome.lower()
    return re.sub(r'(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', '_', nome).lower()


def aviso(msg):
    AVISOS.append(msg)


# ---------------------------------------------------------------- configuração

def configuracao():
    caminho = os.path.join(DADOS, 'config.json')
    if not os.path.exists(caminho):
        sys.exit(f'Sem configuração do diagrama de classes em {caminho}. Rode `build.py --iniciar` para criar uma a '
                 'partir do modelo e ajuste-a ao projeto.')
    return json.load(open(caminho, encoding='utf-8'))


def iniciar():
    destino = os.path.join(DADOS, 'config.json')
    if os.path.exists(destino):
        sys.exit(f'{destino} já existe.')
    os.makedirs(DADOS, exist_ok=True)
    cfg = json.load(open(os.path.join(SKILL, 'scripts/config.modelo.json'), encoding='utf-8'))
    planta = next((p for p in FOLHAS_DA_PLANTA if os.path.exists(os.path.join(ROOT, p))), None)
    if planta:
        cfg['dominios']['arquivo'] = planta
        origem = f'das folhas da planta do banco ({planta}), pela tabela de cada entidade'
    else:
        dominios = os.path.join(DADOS, 'domains.json')
        if not os.path.exists(dominios):
            shutil.copy(os.path.join(SKILL, 'scripts/domains.modelo.json'), dominios)
        origem = f'de {os.path.relpath(dominios, ROOT)}, criado a partir do modelo'
    json.dump(cfg, open(destino, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(destino, 'a', encoding='utf-8').write('\n')
    print(f'{os.path.relpath(destino, ROOT)} criado. As folhas vêm {origem}. Preencha a linguagem do código '
          f'(entidades.linguagem: {", ".join(sorted(LEITORES))}), as pastas do código e as saídas; depois rode o build: '
          'ele lista as entidades sem folha, para classificar.')


# ---------------------------------------------------------------- leitor Java (anotações JPA)

def sem_comentarios(src):
    """Troca comentários por espaços (mantendo posições e quebras de linha) e guarda os javadocs pela posição final."""
    out, docs, i, n = list(src), [], 0, len(src)
    while i < n:
        c = src[i]
        if c == '"' and src.startswith('"""', i):
            j = src.find('"""', i + 3)
            i = n if j < 0 else j + 3
        elif c in '"\'':
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == '\\' else 1
            i = j + 1
        elif src.startswith('//', i):
            j = src.find('\n', i)
            j = n if j < 0 else j
            out[i:j] = ' ' * (j - i)
            i = j
        elif src.startswith('/*', i):
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            if src.startswith('/**', i) and not src.startswith('/**/', i):
                docs.append((j, src[i:j]))
            out[i:j] = [ch if ch == '\n' else ' ' for ch in src[i:j]]
            i = j
        else:
            i += 1
    return ''.join(out), docs


def texto_do_javadoc(raw):
    linhas = []
    for l in raw[3:-2].splitlines():
        l = re.sub(r'^\s*\*\s?', '', l).rstrip()
        if l.lstrip().startswith('@'):
            break
        linhas.append(l)
    txt = re.sub(r'\{@(?:code|link|linkplain|literal)\s+([^}]*)\}', r'\1', ' '.join(linhas))
    txt = re.sub(r'<[^>]+>', ' ', txt)
    return re.sub(r'\s+', ' ', txt).strip() or None


def fecha(s, i, abre, fecha_):
    """Posição do delimitador que fecha o aberto em s[i] (ignora strings)."""
    prof, n = 0, len(s)
    while i < n:
        c = s[i]
        if c in '"\'':
            j = i + 1
            while j < n and s[j] != c:
                j += 2 if s[j] == '\\' else 1
            i = j
        elif c == abre:
            prof += 1
        elif c == fecha_:
            prof -= 1
            if prof == 0:
                return i
        i += 1
    return n - 1


def sem_parenteses(s):
    """O texto com o conteúdo de todo (...) e <...> de nível zero removido, para achar '=' e ',' de verdade."""
    out, prof, ang = [], 0, 0
    for c in s:
        if c == '(':
            prof += 1
        elif c == ')':
            prof -= 1
        elif prof == 0 and c == '<':
            ang += 1
        elif prof == 0 and c == '>':
            ang -= 1
        elif prof == 0 and ang == 0:
            out.append(c)
    return ''.join(out)


def divide(s, sep=','):
    """Divide s no separador de nível zero (fora de (), {}, [], <> e strings)."""
    partes, prof, atual, i = [], 0, [], 0
    while i < len(s):
        c = s[i]
        if c in '"\'':
            j = i + 1
            while j < len(s) and s[j] != c:
                j += 2 if s[j] == '\\' else 1
            atual.append(s[i:j + 1])
            i = j + 1
            continue
        if c in '({[<':
            prof += 1
        elif c in ')}]>':
            prof -= 1
        if c == sep and prof == 0:
            partes.append(''.join(atual))
            atual = []
        else:
            atual.append(c)
        i += 1
    partes.append(''.join(atual))
    return [p.strip() for p in partes if p.strip()]


def argumentos(raw):
    """'name = "x", nullable = false' → {'name': '"x"', 'nullable': 'false'}; valor solto vai em 'value'."""
    args = {}
    for p in divide(raw or ''):
        m = re.match(r'^(\w+)\s*=\s*(.*)$', p, re.S)
        if m and not p.startswith(('"', '{')):
            args[m.group(1)] = m.group(2).strip()
        else:
            args['value'] = p
    return args


def le_anotacoes(s, i=0):
    """Lê as anotações no começo de s[i:]. Devolve ({nome simples: args}, posição depois delas)."""
    anns = {}
    while True:
        m = re.compile(r'\s*@(?!interface\b)([\w.]+)\s*').match(s, i)
        if not m:
            return anns, i
        nome, i = m.group(1).split('.')[-1], m.end()
        raw = None
        if i < len(s) and s[i] == '(':
            j = fecha(s, i, '(', ')')
            raw, i = s[i + 1:j], j + 1
        anns[nome] = argumentos(raw)


def texto(v):
    """Valor de anotação sem aspas: '"x"' → 'x'."""
    v = (v or '').strip()
    return v[1:-1] if len(v) >= 2 and v[0] == v[-1] == '"' else v


def lista(v):
    """Valor de anotação que pode ser lista: '{A.B, C}' ou 'A.B' → ['B', 'C']."""
    v = (v or '').strip()
    if v.startswith('{'):
        v = v[1:-1]
    return [x.split('.')[-1] for x in divide(v)] if v else []


def verdadeiro(args, chave):
    return (args or {}).get(chave, '').strip() == 'true'


def falso(args, chave):
    return (args or {}).get(chave, '').strip() == 'false'


MODIFICADORES = {'public', 'protected', 'private', 'static', 'final', 'transient', 'volatile', 'abstract', 'sealed',
                 'non-sealed', 'strictfp', 'synchronized', 'native', 'default'}
DECL = re.compile(r'\b(class|enum|interface|record|@interface)\s+(\w+)')


def le_tipo_e_nome(s):
    """'private final List<Foo> itens = ...' → (modificadores, 'List<Foo>', 'itens'), ou None se não for campo."""
    toks, i, mods = s.strip(), 0, set()
    while True:
        m = re.match(r'([\w-]+)\s+', toks[i:])
        if not m or m.group(1) not in MODIFICADORES:
            break
        mods.add(m.group(1))
        i += m.end()
    m = re.match(r'([\w.]+)\s*', toks[i:])
    if not m:
        return None
    j = i + m.end()
    tipo = m.group(1)
    if j < len(toks) and toks[j] == '<':
        k, prof = j, 0
        while k < len(toks):
            prof += {'<': 1, '>': -1}.get(toks[k], 0)
            if prof == 0:
                break
            k += 1
        tipo += re.sub(r'\s+', ' ', toks[j:k + 1])
        j = k + 1
    m = re.match(r'\s*((?:\[\s*\]\s*)*)\s*(\w+)\s*(?:=|$)', toks[j:])
    if not m:
        return None
    return mods, tipo + re.sub(r'\s', '', m.group(1)), m.group(2)


def args_genericos(tipo):
    m = re.search(r'<(.*)>', tipo)
    return [a.strip() for a in divide(m.group(1))] if m else []


def base_do_tipo(tipo):
    return re.sub(r'<.*', '', tipo).replace('[]', '').strip()


def simples(tipo):
    """Tipo para exibir: sem pacote e sem espaços — 'java.util.List<a.b.Foo>' → 'List<Foo>'."""
    return re.sub(r'\b(?:[a-z]\w*\.)+(?=[A-Z])', '', re.sub(r'\s+', '', tipo)).replace(',', ', ')


def javadoc_antes(docs, pos, limite):
    """Javadoc que termina entre limite e pos (o último), se houver."""
    achado = None
    for fim, raw in docs:
        if limite <= fim <= pos:
            achado = raw
    return texto_do_javadoc(achado) if achado else None


def le_tipos(caminho):
    """Todas as declarações de tipo de um .java, aninhadas inclusive."""
    src = open(caminho, encoding='utf-8').read()
    limpo, docs = sem_comentarios(src)
    pacote = re.search(r'^\s*package\s+([\w.]+)\s*;', limpo, re.M)
    pacote = pacote.group(1) if pacote else ''
    imports, curingas = {}, []
    for m in re.finditer(r'^\s*import\s+(static\s+)?([\w.]+?)(\.\*)?\s*;', limpo, re.M):
        if m.group(1):
            continue
        if m.group(3):
            curingas.append(m.group(2))
        else:
            imports[m.group(2).split('.')[-1]] = m.group(2)
    ctx = {'pkg': pacote, 'imports': imports, 'curingas': curingas,
           'arquivo': os.path.relpath(caminho, ROOT)}
    tipos = []
    m = DECL.search(limpo)
    if m:
        ini = limpo.rfind(';', 0, m.start()) + 1  # depois do package/imports; anotação não tem ';'
        le_declaracao(limpo, docs, ini, ctx, None, tipos)
    return tipos


def le_declaracao(limpo, docs, ini, ctx, externo, tipos):
    """Lê a declaração que começa em limpo[ini:] (anotações, cabeçalho e corpo). Devolve o fim do corpo."""
    anns, i = le_anotacoes(limpo, ini)
    m = DECL.search(limpo, i)
    abre = limpo.find('{', m.end())
    cab = limpo[m.end():abre]
    fim = fecha(limpo, abre, '{', '}')
    mods = set(re.findall(r'\b(abstract|static|final)\b', limpo[i:m.start()]))
    ext = re.search(r'\bextends\s+([\w.]+)', cab) if m.group(1) == 'class' else None
    nome = m.group(2)
    t = {'kind': m.group(1), 'name': nome, 'outer': externo['name'] if externo else None,
         'fqn': (externo['fqn'] if externo else ctx['pkg']) + '.' + nome, 'ctx': ctx, 'anns': anns,
         'abstract': 'abstract' in mods, 'extends': ext.group(1) if ext else None,
         'doc': javadoc_antes(docs, m.start(), max(0, ini - 2)),
         'fields': [], 'consts': [], 'nested': []}
    tipos.append(t)
    i = abre + 1
    if t['kind'] == 'enum':
        i = le_constantes(limpo, abre + 1, fim, t)
    le_membros(limpo, docs, i, fim, ctx, t, tipos)
    return fim


def le_constantes(limpo, ini, fim, t):
    """Constantes de um enum: até o primeiro ';' de nível zero. Devolve onde os membros começam."""
    i, prof = ini, 0
    while i < fim:
        c = limpo[i]
        if c in '"\'':
            j = i + 1
            while j < fim and limpo[j] != c:
                j += 2 if limpo[j] == '\\' else 1
            i = j
        elif c in '({':
            prof += 1
        elif c in ')}':
            prof -= 1
        elif c == ';' and prof == 0:
            break
        i += 1
    for p in divide(limpo[ini:i]):
        _, k = le_anotacoes(p)
        m = re.match(r'\s*(\w+)\s*(\((.*?)\))?', p[k:], re.S)
        if m:
            rot = re.match(r'\s*"((?:[^"\\]|\\.)*)"', m.group(3) or '')
            t['consts'].append({'n': m.group(1), 'l': rot.group(1) if rot else None})
    return i + 1


def le_membros(limpo, docs, ini, fim, ctx, t, tipos):
    i, ini_seg, paren = ini, ini, 0
    while i < fim:
        c = limpo[i]
        if c in '"\'':
            j = i + 1
            while j < fim and limpo[j] != c:
                j += 2 if limpo[j] == '\\' else 1
            i = j + 1
            continue
        if c == '(':
            paren += 1
        elif c == ')':
            paren -= 1
        elif c == '{' and paren == 0:
            seg = limpo[ini_seg:i]
            _, k = le_anotacoes(seg)
            resto = sem_parenteses(seg[k:])
            if DECL.search(resto) and '=' not in resto:
                fim_aninhado = le_declaracao(limpo, docs, ini_seg, ctx, t, tipos)
                t['nested'].append(tipos[-1]['fqn'])
                i = ini_seg = fim_aninhado + 1
                continue
            j = fecha(limpo, i, '{', '}')
            if '=' in resto:  # inicializador de campo com chaves: o campo continua até o ';'
                i = j + 1
                continue
            i = ini_seg = j + 1  # método, construtor ou bloco de inicialização
            continue
        elif c == ';' and paren == 0:
            le_campo(limpo[ini_seg:i], docs, ini_seg, t)
            ini_seg = i + 1
        i += 1


def le_campo(seg, docs, pos, t):
    anns, k = le_anotacoes(seg)
    resto = seg[k:]
    if '(' in sem_parenteses(resto) or '(' in resto.split('=')[0]:
        return  # método abstrato ou de interface
    tn = le_tipo_e_nome(resto)
    if not tn:
        return
    mods, tipo, nome = tn
    if 'static' in mods:
        return
    inicio = pos + len(seg) - len(seg.lstrip())
    t['fields'].append({'name': nome, 'type': tipo, 'anns': anns, 'mods': mods,
                        'doc': javadoc_antes(docs, inicio, max(0, pos - 1))})


# ---------------------------------------------------------------- modelo de classes

PRIMITIVOS = {'int', 'long', 'short', 'byte', 'char', 'boolean', 'double', 'float'}
COLECOES = {'List', 'Set', 'Collection', 'SortedSet', 'NavigableSet', 'LinkedHashSet', 'HashSet', 'ArrayList',
            'LinkedList', 'TreeSet', 'Iterable', 'Queue', 'Deque',
            # C#
            'IList', 'ICollection', 'IEnumerable', 'ISet', 'IReadOnlyCollection', 'IReadOnlyList', 'IReadOnlySet',
            'ObservableCollection', 'ImmutableList', 'ImmutableArray', 'IImmutableList', 'ImmutableHashSet'}
MAPAS = {'Map', 'HashMap', 'LinkedHashMap', 'TreeMap', 'SortedMap', 'NavigableMap',
         'Dictionary', 'IDictionary', 'IReadOnlyDictionary', 'SortedDictionary', 'ConcurrentDictionary'}
RELACOES = ('ManyToOne', 'OneToMany', 'OneToOne', 'ManyToMany')
OBRIGATORIO = ('NotNull', 'NonNull', 'NotBlank', 'NotEmpty')


class Indice:
    """Resolve nomes de tipo como o compilador: aninhado, import, mesmo pacote, import com *, nome único."""

    def __init__(self, tipos):
        self.por_fqn = {t['fqn']: t for t in tipos}
        self.por_nome = {}
        for t in tipos:
            self.por_nome.setdefault(t['name'], []).append(t)

    def resolve(self, nome, t):
        nome = base_do_tipo(nome)
        if not nome or nome in PRIMITIVOS:
            return None
        if nome in self.por_fqn:
            return self.por_fqn[nome]
        primeiro, _, resto = nome.partition('.')
        ctx = t['ctx']
        alvo = None
        escopo = t
        while escopo and not alvo:  # tipos aninhados no próprio tipo e nos que o envolvem
            alvo = self.por_fqn.get(escopo['fqn'] + '.' + primeiro)
            escopo = self.por_fqn.get(escopo['fqn'].rsplit('.', 1)[0]) if escopo.get('outer') else None
        if not alvo and primeiro in ctx['imports']:
            alvo = self.por_fqn.get(ctx['imports'][primeiro])
        if not alvo:
            alvo = self.por_fqn.get(ctx['pkg'] + '.' + primeiro)
        if not alvo:
            for c in ctx['curingas']:
                alvo = self.por_fqn.get(c + '.' + primeiro)
                if alvo:
                    break
        if not alvo and primeiro in ctx['imports']:
            return None  # importado de fora das pastas lidas (biblioteca)
        if not alvo:
            achados = self.por_nome.get(primeiro, [])
            alvo = achados[0] if len(achados) == 1 else None
        if alvo and resto:
            alvo = self.por_fqn.get(alvo['fqn'] + '.' + resto)
        return alvo


def estereotipo(t):
    a = t['anns']
    if t['kind'] == 'enum':
        return 'enum'
    if 'Entity' in a:
        return 'abstract' if t['abstract'] else 'entity'
    if 'MappedSuperclass' in a:
        return 'mapped'
    if 'Embeddable' in a:
        return 'embeddable'
    return 'plain'


def nome_da_tabela(t, idx):
    """Tabela que a entidade mapeia: @Table, ou a da raiz em SINGLE_TABLE, ou o nome da classe em minúsculas."""
    tab = t['anns'].get('Table')
    if tab and texto(tab.get('name') or tab.get('value')):
        return texto(tab.get('name') or tab.get('value'))
    pai = idx.resolve(t['extends'], t) if t['extends'] else None
    if pai and 'Entity' in pai['anns']:
        raiz_ = pai
        while raiz_ and raiz_['extends']:
            p = idx.resolve(raiz_['extends'], raiz_)
            if not p or 'Entity' not in p['anns']:
                break
            raiz_ = p
        estrategia = lista((raiz_['anns'].get('Inheritance') or {}).get('strategy'))
        if not estrategia or estrategia[0] == 'SINGLE_TABLE':
            return nome_da_tabela(raiz_, idx)
    ent = t['anns'].get('Entity') or {}
    return texto(ent.get('name') or ent.get('value')) or t['name']


def requerido(f):
    if 'req' in f:  # o leitor já decidiu (C#: nulabilidade, IsRequired, chave estrangeira)
        return f['req']
    a = f['anns']
    if base_do_tipo(f['type']) in PRIMITIVOS or 'Id' in a or 'EmbeddedId' in a:
        return True
    if any(x in a for x in OBRIGATORIO):
        return True
    for k in ('Column', 'JoinColumn'):
        if falso(a.get(k), 'nullable'):
            return True
    for k in ('ManyToOne', 'OneToOne'):
        if falso(a.get(k), 'optional'):
            return True
    return 'MapsId' in a


def alvo_da_relacao(f, rel, t, idx):
    alvo = texto((f['anns'][rel] or {}).get('targetEntity', '')).replace('.class', '')
    if alvo:
        return idx.resolve(alvo, t), alvo
    base = base_do_tipo(f['type'])
    gen = args_genericos(f['type'])
    if base.split('.')[-1] in COLECOES and gen:
        return idx.resolve(gen[0], t), gen[0]
    if base.split('.')[-1] in MAPAS and gen:
        return idx.resolve(gen[-1], t), gen[-1]
    return idx.resolve(f['type'], t), f['type']


def colunas_de_juncao(a):
    jc = a.get('JoinColumn')
    if jc is not None:
        return [texto(jc.get('name') or jc.get('value'))] if texto(jc.get('name') or jc.get('value')) else ['(padrão)']
    jcs = a.get('JoinColumns')
    if jcs is not None:
        return re.findall(r'name\s*=\s*"([^"]+)"', jcs.get('value', '')) or ['(padrão)']
    return []


def tabela_de_juncao(a, chave='JoinTable'):
    jt = a.get(chave)
    if jt is None:
        return None
    return texto(jt.get('name') or jt.get('value')) or '(padrão)'


def monta_modelo(tipos, idx):
    """Classes do diagrama, atributos, associações, heranças e dependências de enum."""
    persistentes = [t for t in tipos if estereotipo(t) in ('entity', 'abstract', 'mapped', 'embeddable')]
    no_diagrama = {t['fqn']: t for t in persistentes}
    # superclasses comuns de entidades também entram, para a herança não ficar pendurada
    for t in list(persistentes):
        p = idx.resolve(t['extends'], t) if t['extends'] else None
        while p and p['fqn'] not in no_diagrama:
            no_diagrama[p['fqn']] = p
            p = idx.resolve(p['extends'], p) if p['extends'] else None

    lados, atributos, deps = [], {}, {}
    enums_usados = {}

    def usa_enum(t, e, campo):
        enums_usados[e['fqn']] = e
        deps.setdefault((t['fqn'], e['fqn']), []).append(campo)

    for t in no_diagrama.values():
        attrs = atributos.setdefault(t['fqn'], [])
        for f in t['fields']:
            a = f['anns']
            rel = next((r for r in RELACOES if r in a), None)
            tr = 'Transient' in a or 'transient' in f['mods']
            if rel and not tr:
                alvo, nome_alvo = alvo_da_relacao(f, rel, t, idx)
                if not alvo or estereotipo(alvo) not in ('entity', 'abstract', 'mapped'):
                    aviso(f'{t["name"]}.{f["name"]}: @{rel} para `{simples(nome_alvo)}`, que não é entidade lida '
                          '— entrou como atributo')
                else:
                    ra = a[rel] or {}
                    cascade = lista(ra.get('cascade'))
                    lados.append({'c': t['fqn'], 'f': f['name'], 'rel': rel, 't': alvo['fqn'],
                                  'mb': texto(ra.get('mappedBy')) or None, 'cascade': cascade,
                                  'orphan': verdadeiro(ra, 'orphanRemoval'),
                                  'fetch': (lista(ra.get('fetch')) or [None])[0], 'req': requerido(f),
                                  'jc': [no_banco(c) for c in colunas_de_juncao(a)],
                                  'jt': no_banco(tabela_de_juncao(a)),
                                  'order': 'OrderColumn' in a or 'OrderBy' in a,
                                  'key': 'MapKeyColumn' in a or 'MapKey' in a, 'ty': simples(f['type']),
                                  'doc': f['doc']})
                    continue
            base = base_do_tipo(f['type']).split('.')[-1]
            gen = args_genericos(f['type'])
            colecao = 'ElementCollection' in a or base in COLECOES or base in MAPAS
            elemento = (gen[-1] if gen else f['type']) if colecao else f['type']
            alvo = idx.resolve(elemento, t)
            tags = []
            if 'ElementCollection' in a:
                ct = no_banco(tabela_de_juncao(a, 'CollectionTable'))
                tags.append('coleção' + (f' em {ct}' if ct and ct != '(padrão)' else ''))
            if 'MapKeyColumn' in a:
                tags.append('chave ' + (texto(a['MapKeyColumn'].get('name')) or 'do mapa'))
            if 'OrderColumn' in a:
                tags.append('ordenada')
            col = a.get('Column') or {}
            if verdadeiro(col, 'unique'):
                tags.append('único')
            if col.get('length'):
                tags.append('tamanho ' + col['length'])
            if col.get('precision'):
                tags.append(f'precisão {col["precision"]}' + (f',{col["scale"]}' if col.get('scale') else ''))
            if 'GeneratedValue' in a:
                tags.append('gerado' + ''.join(f' {s}' for s in lista(a['GeneratedValue'].get('strategy'))))
            for k, rot in (('Lob', 'lob'), ('Version', 'versão'), ('CreationTimestamp', 'criado em'),
                           ('UpdateTimestamp', 'alterado em'), ('Embedded', 'embutido'), ('EmbeddedId', 'id embutido'),
                           ('Convert', 'conversor'), ('JdbcTypeCode', 'tipo JDBC')):
                if k in a:
                    tags.append(rot)
            if 'Enumerated' in a:
                tags.append('enum ' + ((lista(a['Enumerated'].get('value')) or ['ORDINAL'])[0]))
            tags += f.get('_tags', [])  # marcas que só o leitor sabe (C#: tipo da coluna, chave estrangeira)
            if tr:
                tags.append('transient')
            coluna = no_banco(texto(col.get('name') or col.get('value'))) or None
            at = {'n': f['name'], 'ty': simples(f['type']), 'nn': requerido(f), 'id': 'Id' in a or 'EmbeddedId' in a,
                  'm': '*' if colecao else '', 'tg': tags, 'col': coluna, 'tr': tr, 'en': None, 'doc': f['doc']}
            if alvo and estereotipo(alvo) == 'enum':
                at['en'] = alvo['fqn']
                usa_enum(t, alvo, f['name'])
            elif alvo and estereotipo(alvo) == 'embeddable' and not tr:
                no_diagrama.setdefault(alvo['fqn'], alvo)
                lados.append({'c': t['fqn'], 'f': f['name'], 'rel': 'ElementCollection' if colecao else 'Embedded',
                              't': alvo['fqn'], 'mb': None,
                              'cascade': [], 'orphan': False, 'fetch': None, 'req': at['nn'], 'jc': [],
                              'jt': no_banco(tabela_de_juncao(a, 'CollectionTable')), 'order': False, 'key': False,
                              'ty': at['ty'], 'doc': f['doc'], 'colecao': colecao})
                continue
            attrs.append(at)
    # Enums usados por embutíveis que só entraram agora pelas associações
    for t in list(no_diagrama.values()):
        atributos.setdefault(t['fqn'], [])
    return no_diagrama, atributos, lados, deps, enums_usados


def ancestrais(fqn, classes, idx):
    out, t = [], classes.get(fqn)
    while t and t['extends']:
        p = idx.resolve(t['extends'], t)
        if not p:
            break
        out.append(p['fqn'])
        t = p
    return out


def compoe(lado):
    """O lado é o todo de uma composição: dono exclusivo que apaga as partes junto."""
    if lado['rel'] in ('Embedded', 'ElementCollection'):
        return True
    return lado['rel'] in ('OneToMany', 'OneToOne') and (
        lado['orphan'] or 'ALL' in lado['cascade'] or 'REMOVE' in lado['cascade'])


def mult_no_alvo(lado):
    if lado['rel'] in ('OneToMany', 'ManyToMany') or lado.get('colecao'):
        return '*'
    return '1' if lado['req'] else '0..1'


def mult_na_origem(lado):
    """Multiplicidade do lado de quem declara o campo, quando o outro lado não tem campo de volta."""
    if lado['rel'] in ('ManyToOne', 'ManyToMany'):
        return '*'
    return '1' if compoe(lado) else '0..1'


def emparelha(lados, classes, idx):
    """Junta os dois lados de uma associação bidirecional (mappedBy) numa linha só."""
    por_campo = {(l['c'], l['f']): l for l in lados}
    pares, usados = [], set()
    for l in lados:
        if not l['mb']:
            continue
        dono = None
        for c in [l['t']] + ancestrais(l['t'], classes, idx):
            dono = por_campo.get((c, l['mb']))
            if dono:
                break
        if not dono:
            aviso(f'{classes[l["c"]]["name"]}.{l["f"]}: mappedBy="{l["mb"]}" não achou o campo em '
                  f'{classes[l["t"]]["name"]} — desenhada como associação de mão única')
            continue
        if id(dono) in usados:
            aviso(f'{classes[dono["c"]]["name"]}.{dono["f"]} é o mappedBy de mais de um campo')
            continue
        usados.update((id(l), id(dono)))
        pares.append((dono, l))
    soltos = [l for l in lados if id(l) not in usados]
    return pares, soltos


def associacao(dono, inverso):
    """Uma linha do diagrama: a ponta 'a' fica à esquerda no layout (o lado 'um', o todo ou o dono)."""
    lados = [x for x in (dono, inverso) if x]
    todo = next((x for x in lados if compoe(x)), None)
    rel = dono['rel']
    if todo:
        a_lado = todo
        a, b = todo['c'], todo['t']
    elif rel == 'ManyToOne' or (rel == 'OneToOne' and inverso is None and dono['jc']) or \
            (rel == 'OneToOne' and inverso is not None):
        a, b = dono['t'], dono['c']
        a_lado = inverso
    else:  # OneToMany sem volta, ManyToMany e OneToOne pela tabela de junção: a partir de quem declara
        a, b = dono['c'], dono['t']
        a_lado = dono
    de_a = next((x for x in lados if x['c'] == a and x['t'] == b and (x is a_lado or a != b)), None)
    de_b = next((x for x in lados if x is not de_a), None)
    if a == b and de_a is None:  # autorrelação: a ponta 'a' é a de quem o lado não declara
        de_a, de_b = (inverso, dono) if a_lado is inverso else (dono, inverso)
    # de_a: o campo declarado em a (aponta para b); de_b: o campo declarado em b (aponta para a)
    mult_b = mult_no_alvo(de_a) if de_a else mult_na_origem(de_b)
    mult_a = mult_no_alvo(de_b) if de_b else mult_na_origem(de_a)
    if todo and mult_a == '*':
        mult_a = '1'
    return {'k': 'comp' if todo else 'assoc', 'a': a, 'b': b, 'ma': mult_a, 'mb': mult_b,
            'ra': de_b['f'] if de_b else None, 'rb': de_a['f'] if de_a else None,
            'na': de_b is not None, 'nb': de_a is not None, 'rel': rel,
            'own': dono['c'], 'of': dono['f'], 'mbf': inverso['f'] if inverso else None,
            'jc': dono['jc'], 'jt': dono['jt'] or (inverso or {}).get('jt'),
            'cascade': sorted(set(dono['cascade']) | set((inverso or {}).get('cascade', []))),
            'orphan': dono['orphan'] or bool(inverso and inverso['orphan']),
            'fetch': [x for x in (dono['fetch'], (inverso or {}).get('fetch')) if x],
            'order': dono['order'] or bool(inverso and inverso['order'])}


# ---------------------------------------------------------------- folhas

def chaves_das_classes(classes):
    """Nome curto e único de cada classe (nome simples; com o pacote quando se repete)."""
    contagem = {}
    for t in classes.values():
        contagem[t['name']] = contagem.get(t['name'], 0) + 1
    out = {}
    for fqn, t in classes.items():
        if contagem[t['name']] == 1:
            out[fqn] = t['name']
        else:
            partes = fqn.split('.')
            out[fqn] = '.'.join(partes[-2:])
    return out


def atribui_folhas(cfg, classes, chave, tabela, lados, deps, idx):
    caminho = (cfg.get('dominios') or {}).get('arquivo') or os.path.join(PASTA_DOS_DADOS, 'domains.json')
    caminho_abs = os.path.join(ROOT, caminho)
    if not os.path.exists(caminho_abs):
        sys.exit(f'arquivo das folhas `{caminho}` não encontrado — ajuste dominios.arquivo na configuração')
    doms = json.load(open(caminho_abs, encoding='utf-8'))['domains']
    por_nome = {}
    for fqn, k in chave.items():
        por_nome.setdefault(k, fqn)
        por_nome.setdefault(fqn, fqn)
    por_tabela = {}
    for fqn, tb in tabela.items():
        if tb:
            por_tabela.setdefault(tb.lower(), []).append(fqn)
    folha, stale, twice = {}, [], []
    for d in doms:  # 1º: as classes citadas pelo nome
        for c in d.get('classes', []):
            fqn = por_nome.get(c)
            if not fqn:
                stale.append(f"{c} (folha {d['id']})")
            elif fqn in folha:
                twice.append(f'{c} (folhas {folha[fqn]} e {d["id"]})')
            else:
                folha[fqn] = d['id']
    for d in doms:  # 2º: as entidades pela tabela que mapeiam
        for tb in d.get('tables', []):
            for fqn in por_tabela.get(tb.lower(), []):
                folha.setdefault(fqn, d['id'])
    # Superclasses mapeadas, embutíveis e superclasses comuns herdam a folha de quem as usa; entidade não herda:
    # cada uma precisa de folha própria, pela tabela ou pelo nome
    for _ in range(3):
        for fqn, t in classes.items():
            if fqn in folha or 'Entity' in t['anns']:
                continue
            filhos = [f for f, x in classes.items() if x['extends'] and idx.resolve(x['extends'], x)
                      and idx.resolve(x['extends'], x)['fqn'] == fqn and f in folha]
            donos = [l['c'] for l in lados if l['t'] == fqn and l['c'] in folha]
            if filhos or donos:
                folha[fqn] = folha[(filhos or donos)[0]]
    sem = sorted(chave[f] + (f' (tabela {tabela[f]})' if tabela.get(f) else '') for f in classes
                 if f not in folha and 'Entity' in classes[f]['anns'])
    if not sem:
        for f in sorted(f for f in classes if f not in folha):
            aviso(f'{chave[f]}: ninguém nas folhas a usa nem a estende — fora da página')
    problemas = [(titulo, itens) for titulo, itens in (
        ('não existem no código — remova a linha', stale),
        ('estão em duas folhas — deixe em uma', twice),
        ('não têm folha — classifique cada uma (pela tabela em "tables" ou pelo nome em "classes")', sem)) if itens]
    if problemas:
        sys.exit(f'{caminho} não bate com o código:\n' + '\n'.join(
            f'- {titulo}:\n    ' + '\n    '.join(itens) for titulo, itens in problemas))
    return doms, folha, caminho


def folha_dos_enums(enums, deps, folha, ordem):
    """Cada enum vai para a folha da primeira classe que o usa, na ordem das folhas."""
    out = {}
    for e in enums:
        usos = sorted((ordem[folha[c]], c) for (c, en) in deps if en == e and c in folha)
        out[e] = folha[usos[0][1]] if usos else None
    return out


# ---------------------------------------------------------------- saída

def git(*args):
    try:
        return subprocess.run(['git', '-C', ROOT, *args], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return ''


def href_relativo(destino_html, alvo):
    return os.path.relpath(os.path.join(ROOT, alvo), os.path.dirname(os.path.join(ROOT, destino_html)))


def render_html(data, online, titulo):
    tpl = open(os.path.join(SKILL, 'assets/template.html'), encoding='utf-8').read()
    assert '/*__DATA__*/null' in tpl, 'template sem o marcador de dados'
    src = tpl.replace('__TITULO__', titulo.replace('&', '&amp;').replace('<', '&lt;'))
    src = src.replace('/*__DATA__*/null', json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/'))
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


# Um leitor por linguagem. `ler` devolve, para cada arquivo, a lista de tipos no formato de le_tipos (anotações com
# os nomes JPA: Entity, Table, ManyToOne…); `completa`, opcional, recebe os tipos de todos os arquivos e os devolve
# completos, para a linguagem cujo mapeamento se espalha por vários arquivos. O resto do script consome o resultado
# sem saber a linguagem. Leitor em módulo à parte (`modulo`) é carregado só quando escolhido.
LEITORES = {
    'java': {'extensoes': ('.java',), 'ler': le_tipos, 'pular': ('build', 'target', 'test', 'node_modules'),
             'rotulo': 'Entidades JPA', 'modelo': 'as classes JPA'},
    'csharp': {'extensoes': ('.cs',), 'modulo': 'leitor_csharp',
               'pular': ('bin', 'obj', 'Migrations', 'test', 'tests', 'node_modules'),
               'rotulo': 'Entidades EF Core', 'modelo': 'as entidades do Entity Framework Core',
               # como a página nomeia relação, cascata e herança no vocabulário do EF Core (padrão: o do JPA)
               'termos': {'rel': {'ManyToOne': 'HasOne · WithMany', 'OneToMany': 'HasMany · WithOne',
                                  'OneToOne': 'HasOne · WithOne', 'ManyToMany': 'HasMany · WithMany',
                                  'Embedded': 'OwnsOne', 'ElementCollection': 'OwnsMany'},
                          'cascata': 'OnDelete Cascade',
                          'heranca': {'SINGLE_TABLE': 'TPH — uma tabela para a hierarquia',
                                      'JOINED': 'TPT — uma tabela por classe, ligada pela chave',
                                      'TABLE_PER_CLASS': 'TPC — uma tabela completa por classe concreta'}}},
}
APELIDOS = {'c#': 'csharp', 'cs': 'csharp', 'dotnet': 'csharp', '.net': 'csharp'}


def leitor(cfg):
    linguagem = ((cfg.get('entidades') or {}).get('linguagem') or '').strip().lower()
    linguagem = APELIDOS.get(linguagem, linguagem)
    disponiveis = ', '.join(sorted(LEITORES))
    if not linguagem:
        sys.exit(f'falta entidades.linguagem na configuração (não há padrão). Leitores disponíveis: {disponiveis}')
    if linguagem not in LEITORES:
        sys.exit(f'não há leitor para a linguagem `{linguagem}`. Leitores disponíveis: {disponiveis}')
    escolhido = LEITORES[linguagem]
    if 'modulo' in escolhido:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        instancia = importlib.import_module(escolhido['modulo']).Leitor(ROOT, aviso)
        escolhido = {**escolhido, 'ler': instancia.ler, 'completa': instancia.completa}
    return escolhido


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--iniciar', action='store_true', help='cria config.json a partir do modelo')
    ap.add_argument('--online', action='store_true', help='busca ELK e fontes na CDN (página bem menor)')
    ap.add_argument('--keep-json', action='store_true', help='guarda os dados extraídos ao lado da página')
    args = ap.parse_args()
    if args.iniciar:
        return iniciar()
    cfg = configuracao()
    ler = leitor(cfg)
    global CONVENCAO
    CONVENCAO = ((cfg.get('entidades') or {}).get('nomes_no_banco') or '').strip().lower() or None
    if CONVENCAO and CONVENCAO not in CONVENCOES:
        sys.exit(f'entidades.nomes_no_banco `{CONVENCAO}` desconhecida: use {" ou ".join(CONVENCOES)}, ou deixe vazio')

    if not (cfg.get('entidades') or {}).get('pastas'):
        sys.exit('falta entidades.pastas na configuração: as pastas com o código das entidades, relativas à raiz')
    tipos = []
    for pasta in (cfg.get('entidades') or {}).get('pastas', []):
        base = os.path.join(ROOT, pasta)
        if not os.path.isdir(base):
            sys.exit(f'a pasta `{pasta}` da configuração não existe')
        for dirpath, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in ler['pular']]
            for f in sorted(files):
                if f.endswith(ler['extensoes']):
                    tipos += ler['ler'](os.path.join(dirpath, f))
    if ler.get('completa'):
        tipos = ler['completa'](tipos)
    idx = Indice(tipos)
    classes, atributos, lados, deps, enums = monta_modelo(tipos, idx)
    if not any(estereotipo(t) in ('entity', 'abstract') for t in classes.values()):
        sys.exit('nenhuma entidade encontrada nas pastas da configuração')
    todos = {**classes, **enums}
    chave = chaves_das_classes(todos)
    tabela = {fqn: no_banco(nome_da_tabela(t, idx)) if 'Entity' in t['anns'] else None for fqn, t in classes.items()}

    pares, soltos = emparelha(lados, classes, idx)
    rels = [associacao(d, i) for d, i in pares] + [associacao(l, None) for l in soltos]
    for fqn, t in classes.items():
        p = idx.resolve(t['extends'], t) if t['extends'] else None
        if p and p['fqn'] in classes:
            rels.append({'k': 'gen', 'a': p['fqn'], 'b': fqn})

    doms, folha, arquivo_folhas = atribui_folhas(cfg, classes, chave, tabela, lados, deps, idx)
    ordem = {d['id']: i for i, d in enumerate(doms)}
    folha.update({e: d for e, d in folha_dos_enums(enums, deps, folha, ordem).items() if d})

    # ---- dados da página (chaves curtas no lugar do fqn)
    C = {}
    for fqn, t in todos.items():
        if fqn not in folha:
            continue
        st = estereotipo(t)
        p = idx.resolve(t['extends'], t) if t['extends'] else None
        inh = (t['anns'].get('Inheritance') or {})
        C[chave[fqn]] = {
            'd': folha[fqn], 'k': st, 'p': fqn.rsplit('.', 1)[0], 'f': t['ctx']['arquivo'], 'doc': t['doc'],
            'tb': tabela.get(fqn), 'ex': chave.get(p['fqn']) if p and p['fqn'] in todos else (t['extends'] and simples(t['extends'])),
            'inh': (lista(inh.get('strategy')) or ['SINGLE_TABLE'])[0] if 'Inheritance' in t['anns'] else None,
            'dv': texto((t['anns'].get('DiscriminatorValue') or {}).get('value')) or None,
            'idc': simples(texto((t['anns'].get('IdClass') or {}).get('value')).replace('.class', '')) or None,
            'a': [{**at, 'en': chave.get(at['en'])} for at in atributos.get(fqn, [])] if st != 'enum' else [],
            'v': t['consts'] if st == 'enum' else []}
    R = []
    for r in rels:
        if r['a'] not in folha or r['b'] not in folha:
            continue
        x = {**r, 'a': chave[r['a']], 'b': chave[r['b']]}
        if 'own' in x:
            x['own'] = chave[x['own']]
        R.append(x)
    for (c, e), campos in sorted(deps.items()):
        if c in folha and e in folha:
            R.append({'k': 'dep', 'a': chave[c], 'b': chave[e], 'fs': campos})
    for i, r in enumerate(R):
        r['id'] = f'r{i}'

    out_html = (cfg.get('saidas') or {}).get('html') or 'docs/diagramas/diagrama-de-classes.html'
    url_file = (cfg.get('saidas') or {}).get('url_do_artefato')
    planta = cfg.get('planta_do_banco') or {}
    planta_href = None
    if planta.get('url_do_artefato') and os.path.exists(os.path.join(ROOT, planta['url_do_artefato'])):
        planta_href = open(os.path.join(ROOT, planta['url_do_artefato'])).read().strip()
    elif planta.get('html'):
        planta_href = href_relativo(out_html, planta['html'])
    commit = git('rev-parse', '--short', 'HEAD')
    sujo = bool(git('status', '--porcelain', '--', *(cfg.get('entidades') or {}).get('pastas', [])))
    kinds = {}
    for v in C.values():
        kinds[v['k']] = kinds.get(v['k'], 0) + 1
    rk = {}
    for r in R:
        rk[r['k']] = rk.get(r['k'], 0) + 1
    data = {'meta': {'stamp': datetime.datetime.now().strftime('%d/%m/%Y %H:%M'), 'commit': commit, 'dirty': sujo,
                     'nome': cfg.get('nome') or os.path.basename(ROOT), 'rotulo': ler['rotulo'],
                     'modelo': ler['modelo'], 'termos': ler.get('termos'), 'pastas': (cfg.get('entidades') or {}).get('pastas', []),
                     'folhas': arquivo_folhas, 'kinds': kinds, 'rels': rk, 'planta': planta_href,
                     'url': open(os.path.join(ROOT, url_file)).read().strip()
                     if url_file and os.path.exists(os.path.join(ROOT, url_file)) else None},
            'domains': [{k: d.get(k) for k in ('id', 'label', 'hue', 'chroma', 'desc')} | {
                'classes': [k for k, v in C.items() if v['d'] == d['id']]} for d in doms
                if any(v['d'] == d['id'] for v in C.values())],
            'c': C, 'r': R}

    html_path = os.path.join(ROOT, out_html)
    os.makedirs(os.path.dirname(html_path), exist_ok=True)
    open(html_path, 'w', encoding='utf-8').write(render_html(data, args.online, data['meta']['nome']))
    print(f'{out_html}  ({os.path.getsize(html_path) // 1024} KB, {"online" if args.online else "offline"})')
    if args.keep_json:
        json.dump(data, open(os.path.splitext(html_path)[0] + '.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    rels_por = {}
    for r in R:
        if r['k'] in ('assoc', 'comp'):
            rels_por[r['rel']] = rels_por.get(r['rel'], 0) + 1
    print(' · '.join(f'{n} {k}' for k, n in sorted(kinds.items())) + f' · {len(data["domains"])} folhas')
    print(' · '.join(f'{n} {k}' for k, n in sorted(rk.items())) + '  |  por anotação do dono: '
          + ', '.join(f'{k} {n}' for k, n in sorted(rels_por.items())))
    if commit:
        print(f'commit {commit}{" + alterações não commitadas nas pastas lidas" if sujo else ""}')
    for a in AVISOS:
        print('⚠ ' + a)


if __name__ == '__main__':
    main()
