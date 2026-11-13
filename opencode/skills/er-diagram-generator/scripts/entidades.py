"""Tabela → entidade no código, para o painel da planta do banco: a classe que mapeia a tabela, o pacote, a classe-mãe,
o arquivo e a documentação da classe (que vira a descrição da tabela quando o banco não tem COMMENT ON TABLE).

Um leitor leve por linguagem, escolhido em entidades.linguagem (padrão java, como antes). Cada leitor só reconhece
marcas explícitas de mapeamento do ORM; nunca liga classe e tabela por semelhança de nome.

    java        JPA / Hibernate (Spring, Quarkus Panache): @Entity, @Table(name), @JoinTable, @CollectionTable
    kotlin      JPA / Hibernate (as mesmas anotações), Room (@Entity(tableName)) e Exposed (object X : Table("x"))
    csharp      Entity Framework Core, pelo leitor do diagrama de classes (leitor_csharp.py, cópia idêntica)
    javascript  Prisma (model + @@map, nos .prisma), TypeORM e MikroORM (@Entity), sequelize-typescript (@Table),
                Sequelize (define / init com tableName) e Drizzle (pgTable('x')), em .js, .ts e afins
    dart        Drift (class X extends Table, tableName) e Floor (@Entity(tableName))
    rust        Diesel (#[diesel(table_name = x)] e derive Identifiable/Insertable) e SeaORM (#[sea_orm(table_name)])

Sem nome explícito, a tabela sai da convenção do ORM (nome da classe, snake_case, plural do Sequelize e do Diesel).
Como a planta conhece as tabelas do banco, cada entidade traz os nomes candidatos (o explícito ou o da convenção,
também em snake_case e em minúsculas) e fica com o primeiro que existe; nenhum existindo, vale o primeiro, e o build
avisa que a entidade não tem tabela no banco.
"""
import os
import re

LINGUAGENS = ('java', 'kotlin', 'csharp', 'javascript', 'dart', 'rust')
APELIDOS = {'c#': 'csharp', 'cs': 'csharp', 'dotnet': 'csharp', '.net': 'csharp', 'js': 'javascript',
            'ts': 'javascript', 'typescript': 'javascript', 'node': 'javascript', 'nodejs': 'javascript',
            'kt': 'kotlin', 'rs': 'rust', 'flutter': 'dart'}
EXTENSOES = {'java': ('.java',), 'kotlin': ('.kt',), 'csharp': ('.cs',),
             'javascript': ('.prisma', '.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'), 'dart': ('.dart',),
             'rust': ('.rs',)}
PULAR = {'build', 'target', 'bin', 'obj', 'Migrations', 'migrations', 'node_modules', 'dist', 'out', 'generated',
         '.next', '.nuxt', '.dart_tool', '.gradle', '.idea', '.git', 'coverage', 'test', 'tests', '__tests__'}
ROTULOS = {'java': 'JPA', 'kotlin': 'Kotlin', 'csharp': 'EF Core', 'javascript': 'JavaScript', 'dart': 'Dart',
           'rust': 'Rust'}
PACOTE = {'java': 'Pacote', 'kotlin': 'Pacote', 'csharp': 'Namespace', 'rust': 'Módulo'}


# ---------------------------------------------------------------- nomes

def snake(nome):
    """PedidoItem → pedido_item; Et0Method → et0_method (a mesma regra do diagrama de classes)."""
    return re.sub(r'(?<=[a-z])(?=[A-Z])|(?<=[A-Z0-9])(?=[A-Z][a-z])', '_', nome).lower()


def plural(nome):
    """Plural em inglês, como o Sequelize e o Diesel fazem por padrão (category → categories, box → boxes)."""
    if re.search(r'[^aeiou]y$', nome):
        return nome[:-1] + 'ies'
    if re.search(r'(s|x|z|ch|sh)$', nome):
        return nome + 'es'
    return nome + 's'


def candidatos(*nomes):
    out = []
    for n in nomes:
        for v in (n, snake(n), n.lower()):
            if n and v not in out:
                out.append(v)
    return out


# ---------------------------------------------------------------- texto

def fecha(s, i, abre='(', fecha_=')'):
    """Posição do fecha_ que casa com o abre em s[i] (ignora o que está entre aspas)."""
    prof, n = 0, len(s)
    while i < n:
        c = s[i]
        if c in '"\'`':
            j = i + 1
            while j < n and s[j] != c:
                j += 2 if s[j] == '\\' else 1
            i = j + 1
            continue
        if c == abre:
            prof += 1
        elif c == fecha_:
            prof -= 1
            if prof == 0:
                return i
        i += 1
    return n


def sem_comentarios(s, aspas_simples=True):
    """s com o conteúdo dos comentários trocado por espaços (mesmas posições e quebras de linha). Strings ficam."""
    out, i, n = list(s), 0, len(s)
    delims = '"`\'' if aspas_simples else '"`'
    while i < n:
        c = s[i]
        if c in delims:
            j = i + 1
            while j < n and s[j] != c and not (c != '`' and s[j] == '\n'):
                j += 2 if s[j] == '\\' else 1
            i = j + 1
        elif s.startswith('//', i):
            j = s.find('\n', i)
            j = n if j < 0 else j
            out[i:j] = ' ' * (j - i)
            i = j
        elif s.startswith('/*', i):
            j = s.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out[i:j] = [x if x == '\n' else ' ' for x in s[i:j]]
            i = j
        else:
            i += 1
    return ''.join(out)


MODIFICADORES = {'public', 'private', 'protected', 'internal', 'abstract', 'final', 'open', 'data', 'sealed',
                 'export', 'default', 'declare', 'pub', 'static', 'partial', 'inline', 'value', 'base', 'strictfp'}


def abre_de(s, j, abre, fecha_):
    """Posição do abre que casa com o fecha_ em s[j], andando para trás."""
    prof = 0
    while j >= 0:
        if s[j] == fecha_:
            prof += 1
        elif s[j] == abre:
            prof -= 1
            if prof == 0:
                return j
        j -= 1
    return 0


def palavra_antes(s, j):
    """Início da palavra (letras, dígitos, _ e .; com o @ de anotação) que termina em j."""
    k = j
    while k > 0 and (s[k - 1].isalnum() or s[k - 1] in '_.'):
        k -= 1
    return k - 1 if k > 0 and s[k - 1] == '@' else k


def cabecalho(s, pos):
    """Início do que vem logo antes da declaração em pos e pertence a ela: anotações (@Entity, @Table(...)),
    decoradores, atributos do Rust (#[...]) e modificadores (public, export, data, pub…), em s sem comentários. A
    documentação da declaração termina logo antes dessa posição."""
    i = pos
    while True:
        j = i
        while j > 0 and s[j - 1] in ' \t\r\n':
            j -= 1
        if j == 0:
            break
        if s[j - 1] == ')':
            a = abre_de(s, j - 1, '(', ')')
            while a > 0 and s[a - 1] in ' \t\r\n':
                a -= 1
            w = palavra_antes(s, a)
            if not (s[w:a].startswith('@') or s[w:a] == 'pub'):
                break
            i = w
            continue
        if s[j - 1] == ']':
            a = abre_de(s, j - 1, '[', ']')
            if a > 0 and s[a - 1] == '#':
                i = a - 1
                continue
            break
        w = palavra_antes(s, j)
        if w < j and (s[w] == '@' or s[w:j] in MODIFICADORES):
            i = w
            continue
        break
    return i


def doc_antes(s, ini):
    """Comentário de documentação logo antes de ini: /** … */ ou um bloco de linhas ///. None se não houver."""
    k = len(s[:ini].rstrip())
    if s.startswith('*/', k - 2):
        a = s.rfind('/*', 0, k - 2)
        if a < 0 or not s.startswith('/**', a) or s.startswith('/**/', a):
            return None
        linhas = [re.sub(r'^\s*\*\s?', '', l) for l in s[a + 3:k - 2].splitlines()]
        return limpa_doc(linhas, bloco=True)
    linhas, fim = [], k
    while fim > 0:
        inicio = s.rfind('\n', 0, fim) + 1
        l = s[inicio:fim].strip()
        if not l.startswith('///'):
            break
        linhas.insert(0, l[3:][1:] if l[3:4] == ' ' else l[3:])
        fim = inicio - 1
    return limpa_doc(linhas) if linhas else None


def limpa_doc(linhas, bloco=False):
    """Texto corrido da documentação: até a primeira marca (@param, @see…), título (# Exemplo) ou bloco de código."""
    txt = []
    for l in linhas:
        e = l.strip()
        if (bloco and e.startswith('@')) or e.startswith(('# ', '```', '~~~')):
            break
        txt.append(e)
    t = ' '.join(txt)
    t = re.sub(r'\{@(?:link|linkplain|code|literal)\s+([^}]*)\}', lambda m: m.group(1).split('#')[-1].strip(), t)
    t = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', t)          # [texto](link) → texto
    t = re.sub(r'\[`?([\w:.]+)`?\]', r'\1', t)                # [Tipo] do dartdoc / rustdoc → Tipo
    t = re.sub(r'</?\w+[^>]*>', ' ', t)                     # <p>, <b>… do Javadoc
    t = t.replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&amp;', '&')
    return re.sub(r'\s+', ' ', t).strip() or None


def string(s):
    """Conteúdo de um literal de string no começo de s ('x', "x" ou `x`)."""
    m = re.match(r'\s*(["\'`])((?:\\.|(?!\1).)*)\1', s)
    return m.group(2) if m else None


def opcao(texto, *chaves, ident=False):
    """Valor da primeira chave (tableName: 'x', name = "x") encontrada em texto, a mais rasa; com ident, também
    um caminho sem aspas (table_name = crate::schema::x, do Rust)."""
    for k in chaves:
        achados = []
        for m in re.finditer(r'\b' + k + r'\s*[:=]\s*(?:(["\'`])((?:\\.|(?!\1).)*)\1' + (r'|([\w:]+))' if ident else ')'), texto):
            antes = re.sub(r'(["\'`])(?:\\.|(?!\1).)*\1', '', texto[:m.start()])
            prof = sum(antes.count(c) for c in '([{') - sum(antes.count(c) for c in ')]}')
            achados.append((prof, m.group(2) if m.group(2) is not None else m.group(3).split('::')[-1]))
        if achados:
            return min(achados, key=lambda a: a[0])[1]
    return None


def linha(s, pos):
    return s.count('\n', 0, pos) + 1


# ---------------------------------------------------------------- leitores

def entidade(rel, s, pos, classe, nomes, pacote=None, mae=None, doc=None, prioridade=0):
    return {'class': classe, 'pkg': pacote, 'extends': mae, 'doc': doc, 'arquivo': rel, 'linha': linha(s, pos),
            'nomes': nomes, 'prioridade': prioridade}


def mae_kotlin(s, fim_nome):
    """Classe-mãe na declaração Kotlin: class X(...) : Mae(...), Interface."""
    i = fim_nome
    while i < len(s) and s[i] in ' \t\r\n':
        i += 1
    if s.startswith('<', i):
        i = fecha(s, i, '<', '>') + 1
    r = s[i:].lstrip()
    if r.startswith('constructor'):
        r = r[len('constructor'):].lstrip()
    if r.startswith('('):
        j = len(s) - len(r)
        r = s[fecha(s, j) + 1:].lstrip()
    m = re.match(r':\s*([\w.]+)\s*\(', r)
    return m.group(1).split('.')[-1] if m else None


def le_jvm(rel, orig, ents, juncoes, kotlin):
    s = sem_comentarios(orig)
    pacote = re.search(r'^\s*package\s+([\w.]+)', s, re.M)
    pacote = pacote.group(1) if pacote else None
    classe_do_arquivo = os.path.splitext(os.path.basename(rel))[0]
    for m in re.finditer(r'\bclass\s+(\w+)', s):
        ini = cabecalho(s, m.start())
        cab = s[ini:m.start()]
        ent = re.search(r'@(?:[\w.]+\.)?Entity\b', cab)
        if not ent:
            continue
        classe_do_arquivo = m.group(1)
        if kotlin:
            mae = mae_kotlin(s, m.end())
        else:
            x = re.match(r'\s*(?:<[^{]*?>)?\s*extends\s+([\w.]+)', s[m.end():])
            mae = x.group(1).split('.')[-1] if x else None
        tab = re.search(r'@(?:[\w.]+\.)?Table\s*\(', cab)
        nome = opcao(s[ini + tab.end() - 1:fecha(s, ini + tab.end() - 1)], 'name') if tab else None
        if not nome:  # Room: @Entity(tableName = "x"); JPA: @Entity(name = "X") muda o nome padrão
            arg = s[ini + ent.end():]
            arg = arg[:fecha(arg, 0) + 1] if arg.lstrip().startswith('(') and arg.startswith('(') else ''
            nome = opcao(arg, 'tableName')
            padrao = opcao(arg, 'name') or string(arg[1:] if arg else '') or m.group(1)
        ents.append(entidade(rel, s, m.start(), m.group(1), candidatos(nome) if nome else candidatos(padrao),
                             pacote, mae, doc_antes(orig, ini)))
    if kotlin:  # Exposed: object Usuarios : Table("usuarios") / IntIdTable("usuarios")
        for m in re.finditer(r'\bobject\s+(\w+)\s*:\s*(?:[\w.]+\.)?(\w*Table)\b\s*(?:<[^>]*>)?\s*(\()?', s):
            if m.group(2) not in ('Table', 'IdTable', 'IntIdTable', 'LongIdTable', 'UUIDTable', 'UIntIdTable',
                                  'ULongIdTable', 'CompositeIdTable'):
                continue
            arg = s[m.end() - 1:fecha(s, m.end() - 1)] if m.group(3) else ''
            nome = opcao(arg, 'name') or (string(arg[1:]) if arg else None)
            padrao = re.sub(r'Table$', '', m.group(1)) or m.group(1)
            ents.append(entidade(rel, s, m.start(), m.group(1), candidatos(nome or padrao), pacote, None,
                                 doc_antes(orig, cabecalho(s, m.start()))))
    for m in re.finditer(r'@(?:[\w.]+\.)?(JoinTable|CollectionTable)\s*\(', s):
        nome = opcao(s[m.end() - 1:fecha(s, m.end() - 1)], 'name')
        if nome:
            antes = [c.group(1) for c in re.finditer(r'\bclass\s+(\w+)', s[:m.start()])]
            juncoes.append({'nomes': candidatos(nome), 'kind': m.group(1),
                            'class': antes[-1] if antes else classe_do_arquivo})


def le_prisma(rel, orig, ents):
    s = sem_comentarios(orig)
    for m in re.finditer(r'^\s*model\s+(\w+)\s*\{', s, re.M):
        corpo = s[m.end() - 1:fecha(s, m.end() - 1, '{', '}')]
        mapa = re.search(r'@@map\s*\(\s*(?:name\s*:\s*)?"([^"]+)"', corpo)
        ini = s.index('model', m.start())
        ents.append(entidade(rel, s, ini, m.group(1), candidatos(mapa.group(1) if mapa else m.group(1)),
                             doc=doc_antes(orig, ini)))


BASES_DO_ORM = {'Model', 'BaseEntity', 'Table'}  # TypeORM, Sequelize: base do framework, não superclasse do domínio


def le_js(rel, orig, ents):
    s = sem_comentarios(orig)
    sequelize = re.search(r'[\'"]sequelize(?:-typescript)?[\'"]', s)
    # TypeORM, MikroORM e sequelize-typescript: decorador antes da classe
    for m in re.finditer(r'\bclass\s+(\w+)', s):
        ini = cabecalho(s, m.start())
        cab = s[ini:m.start()]
        dec = re.search(r'@(Entity|Table)\s*\(', cab)
        if not dec or (dec.group(1) == 'Table' and not sequelize):
            continue
        arg = s[ini + dec.end() - 1:fecha(s, ini + dec.end() - 1)]
        nome = string(arg[1:]) or opcao(arg, 'tableName', 'name')
        x = re.match(r'\s*(?:<[^{]*?>)?\s*extends\s+([\w.]+)', s[m.end():])
        mae = x.group(1).split('.')[-1] if x else None
        mae = None if mae in BASES_DO_ORM else mae
        if nome:
            nomes = candidatos(nome)
        elif dec.group(1) == 'Table':  # sequelize-typescript pluraliza o nome do modelo
            nomes = candidatos(plural(m.group(1)), m.group(1))
        else:  # TypeORM: snake_case do nome da classe
            nomes = candidatos(m.group(1))
        ents.append(entidade(rel, s, m.start(), m.group(1), nomes, mae=mae, doc=doc_antes(orig, ini)))
    # Sequelize: sequelize.define('Modelo', {...}, { tableName: 'x' })
    for m in (re.finditer(r'\.define\s*\(', s) if sequelize else ()):
        arg = s[m.end() - 1:fecha(s, m.end() - 1)]
        modelo = string(arg[1:])
        if not modelo:
            continue
        nome = opcao(arg, 'tableName')
        inicio = s.rfind('\n', 0, m.start()) + 1
        inicio += len(s[inicio:]) - len(s[inicio:].lstrip())
        ini = cabecalho(s, inicio)
        ents.append(entidade(rel, s, m.start(), modelo,
                             candidatos(nome) if nome else candidatos(plural(modelo), modelo), doc=doc_antes(orig, ini)))
    # Sequelize: class X extends Model {} … X.init({...}, { sequelize, tableName: 'x' })
    for m in (re.finditer(r'\b(\w+)\.init\s*\(', s) if sequelize else ()):
        cls = re.search(r'\bclass\s+' + m.group(1) + r'\s+extends\s+(?:[\w.]+\.)?Model\b', s)
        if not cls:
            continue
        arg = s[m.end() - 1:fecha(s, m.end() - 1)]
        nome = opcao(arg, 'tableName')
        modelo = opcao(arg, 'modelName') or m.group(1)
        ini = cabecalho(s, cls.start())
        ents.append(entidade(rel, s, cls.start(), m.group(1),
                             candidatos(nome) if nome else candidatos(plural(modelo), modelo),
                             doc=doc_antes(orig, ini)))
    # Drizzle: export const usuarios = pgTable('usuarios', {...}) (também mysqlTable, sqliteTable, schema.table)
    for m in re.finditer(r'\b(?:const|let|var)\s+(\w+)\s*=\s*(?:\w+\.)?(pgTable|mysqlTable|sqliteTable|table)\s*\(', s):
        nome = string(s[m.end():])
        if not nome:
            continue
        ini = cabecalho(s, m.start())
        ents.append(entidade(rel, s, m.start(), m.group(1), candidatos(nome), doc=doc_antes(orig, ini)))


def le_dart(rel, orig, ents):
    s = sem_comentarios(orig)
    for m in re.finditer(r'\bclass\s+(\w+)(?:\s*<[^{]*?>)?\s*(?:extends\s+(\w+))?', s):
        ini = cabecalho(s, m.start())
        cab = s[ini:m.start()]
        if m.group(2) == 'Table':  # Drift: tableName no corpo ou o snake_case do nome da classe
            abre = s.find('{', m.end())
            corpo = s[abre:fecha(s, abre, '{', '}')] if abre >= 0 else ''
            t = re.search(r'\bString\s+get\s+tableName\s*(?:=>\s*|\{\s*return\s+)(["\'])([^"\']+)\1', corpo)
            nomes = candidatos(t.group(2)) if t else candidatos(snake(m.group(1)))
            ents.append(entidade(rel, s, m.start(), m.group(1), nomes, doc=doc_antes(orig, ini)))
            continue
        dec = re.search(r'@(Entity\s*\(|entity\b)', cab)  # Floor
        if dec:
            arg = s[ini + dec.end() - 1:fecha(s, ini + dec.end() - 1)] if dec.group(1).startswith('Entity') else ''
            nome = opcao(arg, 'tableName')
            ents.append(entidade(rel, s, m.start(), m.group(1), candidatos(nome or m.group(1)), mae=m.group(2),
                                 doc=doc_antes(orig, ini)))


DERIVA_TABELA = {'Identifiable', 'Insertable', 'AsChangeset', 'Associations'}
DERIVA_LEITURA = {'Queryable', 'Selectable', 'Identifiable'}


def modulo_rust(rel):
    partes = rel.replace(os.sep, '/').split('/')
    if 'src' in partes:
        partes = partes[len(partes) - partes[::-1].index('src'):]
    partes[-1] = partes[-1][:-3]
    if partes[-1] in ('mod', 'lib', 'main'):
        partes = partes[:-1]
    return '::'.join(partes) or None


def le_rust(rel, orig, ents):
    s = sem_comentarios(orig, aspas_simples=False)
    mod = modulo_rust(rel)
    for m in re.finditer(r'\bstruct\s+(\w+)', s):
        ini = cabecalho(s, m.start())
        cab = s[ini:m.start()]
        derive = set(re.findall(r'\b(\w+)\b', ' '.join(re.findall(r'#\[derive\(([^)]*)\)\]', cab))))
        sea = re.search(r'#\[sea_orm\(([^\]]*)\)\]', cab)
        if sea and opcao(sea.group(1), 'table_name'):  # SeaORM: struct Model do módulo da tabela
            nome = opcao(sea.group(1), 'table_name')
            topo = re.match(r'(?:\s*//![^\n]*\n)+', orig)
            doc = doc_antes(orig, ini) or (limpa_doc([l.strip()[3:] for l in topo.group(0).splitlines()]) if topo else None)
            ents.append(entidade(rel, s, m.start(), f'{mod.split("::")[-1]}::{m.group(1)}' if mod else m.group(1),
                                 candidatos(nome), mod, None, doc, prioridade=1))
            continue
        nome = None
        d = ' '.join(re.findall(r'#\[diesel\(([^\]]*)\)\]', cab))
        if d:
            nome = opcao(d, 'table_name', ident=True)
        antigo = re.search(r'#\[table_name\s*=\s*"([^"]+)"\]', cab)
        if antigo:
            nome = antigo.group(1)
        if not nome and not derive & DERIVA_TABELA:
            continue
        nomes = candidatos(nome.split('::')[-1]) if nome else candidatos(plural(snake(m.group(1))))
        ents.append(entidade(rel, s, m.start(), m.group(1), nomes, mod, None, doc_antes(orig, ini),
                             prioridade=1 if derive & DERIVA_LEITURA else 0))


def le_csharp(raiz, arquivos, ents, aviso):
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import leitor_csharp
    leitor = leitor_csharp.Leitor(raiz, aviso)
    tipos = []
    for caminho in arquivos:
        tipos += leitor.ler(caminho)
    for t in leitor.completa(tipos):
        tab = (t['anns'].get('Table') or {}).get('name')
        if 'Entity' not in t['anns'] or not tab:
            continue  # derivada em TPH fica na tabela da raiz
        nome = tab.strip().strip('"')
        ents.append({'class': t['name'], 'pkg': t['ctx'].get('pkg') or None,
                     'extends': t['extends'].split('.')[-1] if t.get('extends') else None, 'doc': t.get('doc'),
                     'arquivo': t['ctx']['arquivo'], 'linha': None, 'nomes': candidatos(nome), 'prioridade': 0})


# ---------------------------------------------------------------- entrada

def linguagens(cfg):
    valor = cfg.get('linguagem') or 'java'
    out = []
    for l in (valor if isinstance(valor, list) else [valor]):
        l = APELIDOS.get(str(l).strip().lower(), str(l).strip().lower())
        if l not in LINGUAGENS:
            raise ValueError(f'entidades.linguagem `{l}` desconhecida: use {", ".join(LINGUAGENS)}')
        out.append(l)
    return out


def ler(raiz, cfg, tabelas, aviso=lambda m: None):
    """(ents, juncoes, info): ents e juncoes por tabela do banco; info com o rótulo e o nome do campo do pacote.

    cfg: a seção entidades da configuração (linguagem, pastas). tabelas: os nomes das tabelas do banco."""
    langs = linguagens(cfg)
    achadas, juncoes = [], []
    for lang in langs:
        arquivos = []
        for pasta in cfg.get('pastas') or []:
            base = os.path.join(raiz, pasta)
            if not os.path.isdir(base):
                raise FileNotFoundError(f'a pasta de entidades `{pasta}` da configuração não existe')
            for dirpath, dirs, files in os.walk(base):
                dirs[:] = sorted(d for d in dirs if d not in PULAR)
                for f in sorted(files):
                    if f.endswith(EXTENSOES[lang]) and not re.search(r'\.(g|freezed|d)\.\w+$|\.d\.ts$', f):
                        arquivos.append(os.path.join(dirpath, f))
        if lang == 'csharp':
            le_csharp(raiz, arquivos, achadas, aviso)
            continue
        for caminho in arquivos:
            rel = os.path.relpath(caminho, raiz)
            try:
                with open(caminho, encoding='utf-8-sig') as arq:
                    s = arq.read()
            except UnicodeDecodeError:
                continue
            if lang in ('java', 'kotlin'):
                le_jvm(rel, s, achadas, juncoes, lang == 'kotlin')
            elif lang == 'javascript':
                (le_prisma if caminho.endswith('.prisma') else le_js)(rel, s, achadas)
            elif lang == 'dart':
                le_dart(rel, s, achadas)
            elif lang == 'rust':
                le_rust(rel, s, achadas)

    por_minuscula = {t.lower(): t for t in tabelas}

    def tabela(nomes):
        return next((por_minuscula[n.lower()] for n in nomes if n.lower() in por_minuscula), nomes[0].lower())

    ents = {}
    for e in sorted(achadas, key=lambda e: -e['prioridade']):  # estável: na ordem dos arquivos
        tb = tabela(e['nomes'])
        if tb not in ents:
            ents[tb] = {k: v for k, v in e.items() if k not in ('nomes', 'prioridade')}
    junc = {}
    for j in juncoes:
        junc.setdefault(tabela(j['nomes']), {'kind': j['kind'], 'class': j['class']})
    rotulo = ' · '.join(ROTULOS[l] for l in langs)
    pacote = PACOTE.get(langs[0], 'Pacote') if len(langs) == 1 else 'Pacote'
    return ents, junc, {'rotulo': rotulo, 'pacote': pacote}
