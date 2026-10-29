"""Leitor C# (Entity Framework Core) do diagrama de classes.

Lê os .cs em duas etapas, na ordem em que o EF Core monta o modelo:

1. ler(caminho) — cada arquivo sozinho: namespaces, usings, tipos (aninhados inclusive), propriedades, constantes
   de enum, atributos ([Key], [Table]…), documentação XML (///), os DbSet<T> e o corpo dos métodos que configuram
   o modelo (OnModelCreating, Configure de IEntityTypeConfiguration<T>, extensões sobre EntityTypeBuilder<T>).
2. completa(tipos) — o projeto inteiro: quais classes são entidades (DbSet<T>, Entity<T>(), EntityTypeBuilder<T>
   e as navegações a partir delas), a API fluente, o pareamento das navegações por convenção, as chaves
   estrangeiras e a obrigatoriedade. Devolve os tipos com as anotações no vocabulário que o build.py consome (os
   nomes JPA: Entity, Table, ManyToOne, mappedBy…), sem que ele precise saber que o código é C#.

Regras do EF Core aplicadas (as convenções dele, salvo configuração explícita):
- entra no modelo a propriedade pública com get e set (ou init), não estática; get sem set e corpo de expressão
  (=>) ficam de fora, como no EF;
- classe-base que não é entidade tem as propriedades mapeadas na tabela da derivada: vira superclasse mapeada;
  classe-base que é entidade forma hierarquia (TPH por padrão; UseTpt/UseTpc mudam a estratégia);
- obrigatório: chave, [Required]/IsRequired(), tipo de valor sem ?, e tipo de referência sem ? quando o projeto
  tem <Nullable>enable</Nullable> (ou #nullable enable no arquivo);
- relação obrigatória pela chave estrangeira (PedidoId não anulável), e apaga em cascata quando OnDelete(Cascade)
  ou, sem OnDelete, quando é obrigatória (padrão do EF). Cascata com navegação de coleção ou de referência no
  principal desenha composição.
"""
import os, re

MODIFICADORES = {'public', 'private', 'protected', 'internal', 'static', 'virtual', 'override', 'abstract', 'sealed',
                 'new', 'readonly', 'required', 'partial', 'extern', 'unsafe', 'volatile', 'const', 'file', 'async',
                 'fixed', 'ref'}
TIPOS_DE_VALOR = {'bool', 'byte', 'sbyte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong', 'float', 'double',
                  'decimal', 'char', 'nint', 'nuint', 'Boolean', 'Byte', 'SByte', 'Int16', 'UInt16', 'Int32', 'UInt32',
                  'Int64', 'UInt64', 'Single', 'Double', 'Decimal', 'Char', 'Guid', 'DateTime', 'DateTimeOffset',
                  'DateOnly', 'TimeOnly', 'TimeSpan'}
COLECOES = {'List', 'IList', 'ICollection', 'IEnumerable', 'HashSet', 'ISet', 'IReadOnlyCollection', 'IReadOnlyList',
            'IReadOnlySet', 'Collection', 'ObservableCollection', 'SortedSet', 'LinkedList', 'ImmutableList',
            'ImmutableArray', 'IImmutableList', 'ImmutableHashSet'}
ALVOS_IGNORADOS = {'assembly', 'module', 'return', 'param', 'field', 'method', 'event', 'typevar'}
GERADO = {'ValueGeneratedOnAdd', 'ValueGeneratedOnAddOrUpdate', 'ValueGeneratedOnUpdate', 'HasDefaultValueSql',
          'HasDefaultValue', 'UseIdentityColumn', 'UseIdentityByDefaultColumn', 'UseIdentityAlwaysColumn',
          'HasComputedColumnSql', 'UseHiLo', 'UseSequence', 'UseSerialColumn'}
ESTRATEGIAS = {'UseTphMappingStrategy': 'SINGLE_TABLE', 'UseTptMappingStrategy': 'JOINED',
               'UseTpcMappingStrategy': 'TABLE_PER_CLASS'}
DECL = re.compile(r'\s*((?:\w+\s+)*?)(record\s+struct|record\s+class|class|struct|interface|enum|record)\s+(@?\w+)')
LITERAL = re.compile(r'(\$+@?|@\$*)?("{3,}|")')


# ---------------------------------------------------------------- texto: literais, comentários, delimitadores

def fim_da_string(s, i, interpolada):
    """Fim de "..." (ou $"...") cujo conteúdo começa em s[i]."""
    prof, n = 0, len(s)
    while i < n:
        c = s[i]
        if c == '\\' and prof == 0:
            i += 2
            continue
        if interpolada:
            if c == '{':
                if prof == 0 and s.startswith('{{', i):
                    i += 2
                    continue
                prof += 1
            elif c == '}' and prof > 0:
                prof -= 1
            elif c == '"' and prof > 0:  # texto dentro da interpolação
                j = i + 1
                while j < n and s[j] != '"':
                    j += 2 if s[j] == '\\' else 1
                i = j + 1
                continue
        if c == '"' and prof == 0:
            return i + 1
        if c == '\n' and prof == 0:
            return i  # literal sem fechamento: para na linha
        i += 1
    return n


def fim_literal(s, i):
    """Se s[i] abre um literal de texto ou de caractere, a posição logo depois dele; senão None."""
    c = s[i]
    if c == "'":
        j = i + 1
        while j < len(s) and s[j] != "'" and s[j] != '\n':
            j += 2 if s[j] == '\\' else 1
        return j + 1
    if c not in '"$@' or (c != '"' and i > 0 and (s[i - 1].isalnum() or s[i - 1] == '_')):
        return None
    m = LITERAL.match(s, i)
    if not m:
        return None
    pre, aspas, j = m.group(1) or '', m.group(2), m.end()
    if len(aspas) >= 3:
        k = s.find(aspas, j)
        return len(s) if k < 0 else k + len(aspas)
    if '@' in pre:
        while j < len(s):
            if s[j] == '"':
                if s.startswith('""', j):
                    j += 2
                    continue
                return j + 1
            j += 1
        return len(s)
    return fim_da_string(s, j, '$' in pre)


def limpa(src):
    """Troca comentários e diretivas (#region, #nullable…) por espaços, mantendo posições e quebras de linha.
    Devolve o texto, as linhas de documentação /// [(fim, texto)] e o #nullable do arquivo (None se não houver)."""
    out, docs, nullable, i, n = list(src), [], None, 0, len(src)
    while i < n:
        c = src[i]
        if c == '#' and not src[src.rfind('\n', 0, i) + 1:i].strip():
            j = src.find('\n', i)
            j = n if j < 0 else j
            m = re.match(r'#\s*nullable\s+(enable|disable)', src[i:j])
            if m and nullable is None:
                nullable = m.group(1) == 'enable'
            out[i:j] = ' ' * (j - i)
            i = j
            continue
        if src.startswith('//', i):
            j = src.find('\n', i)
            j = n if j < 0 else j
            if src.startswith('///', i) and not src.startswith('////', i):
                docs.append((j, src[i + 3:j]))
            out[i:j] = ' ' * (j - i)
            i = j
            continue
        if src.startswith('/*', i):
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out[i:j] = [ch if ch == '\n' else ' ' for ch in src[i:j]]
            i = j
            continue
        k = fim_literal(src, i)
        i = k if k is not None else i + 1
    return ''.join(out), docs, nullable


def fecha(s, i, abre, fecha_):
    """Posição do delimitador que fecha o aberto em s[i] (ignora literais)."""
    prof, n = 0, len(s)
    while i < n:
        k = fim_literal(s, i)
        if k is not None:
            i = k
            continue
        c = s[i]
        if c == abre:
            prof += 1
        elif c == fecha_:
            prof -= 1
            if prof == 0:
                return i
        i += 1
    return n - 1


def divide(s, sep=',', angulos=False):
    """Divide s no separador de nível zero (fora de (), {}, [] e literais; de <> também, se angulos)."""
    partes, prof, ini, i = [], 0, 0, 0
    abre, fecha_ = ('({[<', ')}]>') if angulos else ('({[', ')}]')
    while i < len(s):
        k = fim_literal(s, i)
        if k is not None:
            i = k
            continue
        c = s[i]
        if c in abre:
            prof += 1
        elif c in fecha_:
            prof -= 1
        elif c == sep and prof == 0:
            partes.append(s[ini:i])
            ini = i + 1
        i += 1
    partes.append(s[ini:])
    return [p.strip() for p in partes if p.strip()]


def sem_parenteses(s):
    """O texto sem o conteúdo de (...), [...] e <...> de nível zero, para achar '=' de verdade."""
    out, prof = [], 0
    for c in s:
        if c in '([<':
            prof += 1
        elif c in ')]>':
            prof = max(0, prof - 1)
        elif prof == 0:
            out.append(c)
    return ''.join(out)


def texto_da_doc(linhas):
    if not linhas:
        return None
    xml = '\n'.join(linhas)
    if re.search(r'<inheritdoc\b', xml):
        return None
    m = re.search(r'<summary>(.*?)</summary>', xml, re.S)
    txt = m.group(1) if m else xml
    txt = re.sub(r'<see\s+(?:cref|href|langword)="(?:\w:)?([^"]*)"\s*/>', lambda x: x.group(1).split('.')[-1], txt)
    txt = re.sub(r'<(?:paramref|typeparamref)\s+name="([^"]*)"\s*/>', r'\1', txt)
    txt = re.sub(r'<[^>]+>', ' ', txt)
    txt = txt.replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&amp;', '&')
    return re.sub(r'\s+', ' ', txt).strip() or None


def doc_entre(docs, limite, pos):
    return texto_da_doc([t for fim, t in docs if limite <= fim <= pos])


def literal(v):
    """'"x"' → 'x'; nameof(A.B) → 'B'; outros valores voltam como estão."""
    v = (v or '').strip()
    m = re.match(r'^@?"(.*)"$', v, re.S)
    if m:
        return m.group(1)
    m = re.match(r'^nameof\(\s*([\w.]+)\s*\)$', v)
    return m.group(1).split('.')[-1] if m else v


def le_atributos(s, i=0):
    """Lê os [Atributos] no começo de s[i:]. Devolve ({Nome: {'pos': [...], 'nom': {...}}}, posição depois deles)."""
    attrs = {}
    while True:
        m = re.compile(r'\s*\[').match(s, i)
        if not m:
            return attrs, i
        j = fecha(s, m.end() - 1, '[', ']')
        dentro, i = s[m.end():j], j + 1
        alvo = re.match(r'\s*(\w+)\s*:(?!:)', dentro)
        if alvo:
            if alvo.group(1) in ALVOS_IGNORADOS:
                continue
            dentro = dentro[alvo.end():]
        for item in divide(dentro):
            mm = re.match(r'([\w.]+)\s*(?:\((.*)\))?\s*$', item, re.S)
            if not mm:
                continue
            nome = mm.group(1).split('.')[-1]
            nome = nome[:-9] if nome.endswith('Attribute') and len(nome) > 9 else nome
            pos, nom = [], {}
            for a in divide(mm.group(2) or ''):
                na = re.match(r'^(\w+)\s*(?:=(?!=)|:)\s*(.*)$', a, re.S)
                if na and not a.startswith(('"', '@"', '$"')):
                    nom[na.group(1)] = na.group(2).strip()
                else:
                    pos.append(a)
            attrs[nome] = {'pos': pos, 'nom': nom}


def le_tipo(s, i=0):
    """Tipo C# a partir de s[i]: 'List<Foo?>?', 'int[]', 'global::A.B'. Devolve (tipo, fim) ou None."""
    m = re.compile(r'\s*((?:global::)?[A-Za-z_][\w.]*)').match(s, i)
    if not m:
        return None
    tipo, j = m.group(1).replace('global::', ''), m.end()
    while True:
        k = j
        while k < len(s) and s[k] in ' \t\r\n':
            k += 1
        if k < len(s) and s[k] == '<' and tipo[-1:] not in '?]':
            fim, prof = k, 0
            while fim < len(s):
                prof += {'<': 1, '>': -1}.get(s[fim], 0)
                if prof == 0:
                    break
                fim += 1
            tipo += re.sub(r'\s+', ' ', s[k:fim + 1])
            j = fim + 1
        elif k < len(s) and s[k] == '?':
            tipo += '?'
            j = k + 1
        elif k < len(s) and s[k] == '[' and re.match(r'\[\s*,*\s*\]', s[k:]):
            mm = re.match(r'\[\s*,*\s*\]', s[k:])
            tipo += '[]'
            j = k + mm.end()
        else:
            return tipo, j


def base_do_tipo(tipo):
    return re.sub(r'<.*', '', tipo).replace('[]', '').replace('?', '').strip()


def args_genericos(tipo):
    m = re.search(r'<(.*)>', tipo)
    return divide(m.group(1), angulos=True) if m else []


def elemento(tipo):
    """(tipo do elemento, é coleção): List<Foo> → ('Foo', True); Foo[] → ('Foo', True); Foo → ('Foo', False)."""
    base = base_do_tipo(tipo).split('.')[-1]
    gen = args_genericos(tipo)
    if base in COLECOES and len(gen) == 1:
        return gen[0], True
    if tipo.endswith('[]') and base not in ('byte', 'Byte'):
        return tipo[:-2], True
    return tipo, False


def snake(nome):
    return re.sub(r'(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', '_', nome).lower()


# ---------------------------------------------------------------- o leitor

class Leitor:
    def __init__(self, raiz, aviso):
        self.raiz, self.aviso = raiz, aviso
        self._nrt = {}

    # ------------------------------------------------ etapa 1: um arquivo

    def nrt_do_projeto(self, pasta):
        """<Nullable> do .csproj ou do Directory.Build.props mais próximo (o .csproj vale primeiro)."""
        if pasta in self._nrt:
            return self._nrt[pasta]
        valor, atual = None, pasta
        while valor is None:
            try:
                nomes = sorted(os.listdir(atual))
            except OSError:
                nomes = []
            for nome in [x for x in nomes if x.endswith('.csproj')] + \
                        [x for x in nomes if x == 'Directory.Build.props']:
                try:
                    m = re.search(r'<Nullable>\s*(\w+)\s*</Nullable>', open(os.path.join(atual, nome), encoding='utf-8').read())
                except OSError:
                    m = None
                if m:
                    valor = m.group(1).lower() in ('enable', 'annotations')
                    break
            pai = os.path.dirname(atual)
            if valor is None and pai == atual:
                valor = False
            atual = pai
        self._nrt[pasta] = valor
        return valor

    def ler(self, caminho):
        src = open(caminho, encoding='utf-8-sig').read()
        limpo, docs, nullable = limpa(src)
        if nullable is None:
            nullable = self.nrt_do_projeto(os.path.dirname(os.path.abspath(caminho)))
        usings, apelidos = [], {}
        for m in re.finditer(r'^\s*(?:global\s+)?using\s+(static\s+)?(?:(\w+)\s*=\s*)?([\w.:]+)\s*;', limpo, re.M):
            if m.group(1):
                continue
            alvo = m.group(3).replace('global::', '')
            if m.group(2):
                apelidos[m.group(2)] = alvo
            else:
                usings.append(alvo)
        arquivo = {'usings': usings, 'apelidos': apelidos, 'arquivo': os.path.relpath(caminho, self.raiz),
                   'nrt': nullable}
        tipos = []
        self.le_corpo(limpo, docs, 0, len(limpo), arquivo, '', None, tipos)
        return tipos

    def contexto(self, arquivo, ns):
        partes = ns.split('.') if ns else []
        pais = ['.'.join(partes[:k]) for k in range(len(partes) - 1, 0, -1)]
        return {'pkg': ns, 'imports': arquivo['apelidos'], 'curingas': pais + arquivo['usings'],
                'arquivo': arquivo['arquivo'], 'nrt': arquivo['nrt']}

    def le_corpo(self, s, docs, ini, fim, arquivo, ns, externo, tipos):
        """Percorre um corpo (arquivo, namespace ou tipo) dividindo-o em declarações."""
        i, seg, par = ini, ini, 0
        while i < fim:
            k = fim_literal(s, i)
            if k is not None:
                i = k
                continue
            c = s[i]
            if c in '([':
                par += 1
            elif c in ')]':
                par -= 1
            elif c == '{' and par == 0:
                cab = s[seg:i]
                attrs, a = le_atributos(cab)
                h = cab[a:]
                j = fecha(s, i, '{', '}')
                m_ns = re.match(r'\s*namespace\s+([\w.]+)\s*$', h)
                if m_ns:
                    self.le_corpo(s, docs, i + 1, j, arquivo, (ns + '.' if ns else '') + m_ns.group(1), None, tipos)
                    i = seg = j + 1
                    continue
                if DECL.match(h) and '=' not in sem_parenteses(h):
                    t = self.tipo(h, attrs, ns, externo, arquivo, doc_entre(docs, seg, i), tipos)
                    corpo = s[i + 1:j]
                    t['_dbsets'] = re.findall(r'\bDbSet<\s*([\w.]+)\s*>\??\s+(\w+)', corpo)
                    if t['kind'] == 'enum':
                        self.constantes(corpo, t)
                    else:
                        self.le_corpo(s, docs, i + 1, j, arquivo, ns, t, tipos)
                    i = seg = j + 1
                    continue
                if externo is not None and '(' not in h and '=' not in h:
                    self.propriedade(h, attrs, s[i + 1:j], doc_entre(docs, seg, i), externo)
                    depois = s[j + 1:fim].lstrip()
                    if depois.startswith('=') and not depois.startswith('=>'):
                        i = self.ate_o_fim(s, j + 1, fim)
                    else:
                        i = j + 1
                    seg = i
                    continue
                if '=' in sem_parenteses(h):  # inicializador com chaves: segue até o ';'
                    i = j + 1
                    continue
                if externo is not None:  # método, construtor, indexador, operador
                    self.metodo(h, s[i + 1:j], externo)
                i = seg = j + 1
                continue
            elif c == ';' and par == 0:
                cab = s[seg:i]
                attrs, a = le_atributos(cab)
                h = cab[a:]
                m_ns = re.match(r'\s*namespace\s+([\w.]+)\s*$', h)
                if m_ns:
                    ns = (ns + '.' if ns else '') + m_ns.group(1)
                elif DECL.match(h) and '=' not in sem_parenteses(h):  # record sem corpo
                    t = self.tipo(h, attrs, ns, externo, arquivo, doc_entre(docs, seg, i), tipos)
                    t['_dbsets'] = []
                elif externo is not None:
                    m = re.match(r'(.*?\))\s*=>(.*)$', h, re.S)
                    if m:
                        self.metodo(m.group(1), m.group(2) + ';', externo)
                seg = i + 1
            i += 1

    @staticmethod
    def ate_o_fim(s, i, fim):
        """Posição logo depois do ';' que encerra o inicializador que começa em s[i]."""
        prof = 0
        while i < fim:
            k = fim_literal(s, i)
            if k is not None:
                i = k
                continue
            c = s[i]
            if c in '({[':
                prof += 1
            elif c in ')}]':
                prof -= 1
            elif c == ';' and prof == 0:
                return i + 1
            i += 1
        return fim

    def tipo(self, h, attrs, ns, externo, arquivo, doc, tipos):
        m = DECL.match(h)
        mods = set(m.group(1).split())
        palavra = m.group(2).split()
        kind = 'record' if palavra[0] == 'record' else palavra[0]
        nome = m.group(3).lstrip('@')
        resto = h[m.end():]
        k = len(resto) - len(resto.lstrip())
        if resto[k:k + 1] == '<':
            k = fecha(resto, k, '<', '>') + 1
        params = None
        r2 = resto[k:].lstrip()
        if r2.startswith('('):
            k += len(resto[k:]) - len(r2)
            fp = fecha(resto, k, '(', ')')
            params = resto[k + 1:fp]
            k = fp + 1
        bases = []
        r2 = resto[k:].lstrip()
        if r2.startswith(':'):
            lista = re.split(r'\bwhere\b', r2[1:], maxsplit=1)[0]
            bases = [re.sub(r'\(.*\)\s*$', '', b, flags=re.S).strip() for b in divide(lista, angulos=True)]
        pai = externo['fqn'] if externo else ns
        t = {'kind': kind, 'name': nome, 'outer': externo['name'] if externo else None,
             'fqn': (pai + '.' if pai else '') + nome, 'ctx': self.contexto(arquivo, ns), 'anns': {},
             'abstract': 'abstract' in mods, 'extends': None, 'doc': doc, 'fields': [], 'consts': [], 'nested': [],
             '_attrs': attrs, '_bases': bases, '_metodos': [], '_dbsets': [], '_static': 'static' in mods}
        tipos.append(t)
        if externo:
            externo['nested'].append(t['fqn'])
        if params is not None and kind == 'record':
            for p in divide(params):
                pa, a = le_atributos(p)
                tn = le_tipo(p, a)
                mm = tn and re.match(r'\s*(@?\w+)', p[tn[1]:])
                if mm:
                    self.campo(t, mm.group(1).lstrip('@'), tn[0], pa, None)
        return t

    def constantes(self, corpo, t):
        for p in divide(corpo):
            attrs, a = le_atributos(p)
            m = re.match(r'\s*@?(\w+)', p[a:])
            if not m:
                continue
            rot = None
            for nome, chave in (('Display', 'Name'), ('Description', None), ('EnumMember', 'Value')):
                at = attrs.get(nome)
                if at:
                    v = at['nom'].get(chave) if chave else (at['pos'] or [None])[0]
                    if v and v.strip().startswith('"'):
                        rot = literal(v)
                        break
            t['consts'].append({'n': m.group(1), 'l': rot})

    @staticmethod
    def campo(t, nome, tipo, attrs, doc):
        t['fields'].append({'name': nome, 'type': tipo.replace('?', ''), 'nullable': tipo.endswith('?'),
                            'anns': {}, 'mods': set(), 'doc': doc, '_attrs': attrs})

    def propriedade(self, h, attrs, acessores, doc, t):
        if t['kind'] in ('interface', 'enum'):
            return
        toks, mods = h.strip(), set()
        while True:
            m = re.match(r'(\w+)\s+', toks)
            if not m or m.group(1) not in MODIFICADORES:
                break
            mods.add(m.group(1))
            toks = toks[m.end():]
        if 'public' not in mods or 'static' in mods or toks.startswith('('):
            return
        tn = le_tipo(toks)
        if not tn:
            return
        m = re.match(r'\s*@?(\w+)\s*$', toks[tn[1]:])
        if not m or m.group(1) in ('this', 'operator') or not re.search(r'\b(set|init)\b', acessores):
            return
        self.campo(t, m.group(1), tn[0], attrs, doc)

    def metodo(self, h, corpo, t):
        """Guarda o corpo dos métodos que recebem um ModelBuilder ou um EntityTypeBuilder<T>."""
        abre = h.rfind('(')
        if abre < 0:
            return
        params = h[abre + 1:h.rfind(')')] if ')' in h[abre:] else ''
        vars_ = {}
        for p in divide(params):
            m = re.match(r'(?:this\s+)?(?:[\w.]+\.)?EntityTypeBuilder<\s*([\w.]+)\s*>\s+(\w+)', p.strip())
            if m:
                vars_[m.group(2)] = ('tipo', m.group(1))
            m = re.match(r'(?:this\s+)?(?:[\w.]+\.)?ModelBuilder\s+(\w+)', p.strip())
            if m:
                vars_[m.group(1)] = ('modelo', None)
        if vars_:
            t['_metodos'].append({'vars': vars_, 'corpo': corpo})

    # ------------------------------------------------ etapa 2: o projeto inteiro

    def resolve(self, nome, t):
        """Tipo pelo nome, como o compilador: aninhado, apelido, mesmo namespace, namespaces pais, usings, nome único."""
        nome = base_do_tipo(nome or '')
        if not nome or nome in TIPOS_DE_VALOR or t is None:
            return None
        if nome in self.por_fqn:
            return self.por_fqn[nome]
        primeiro, _, resto = nome.partition('.')
        ctx, alvo, escopo = t['ctx'], None, t
        while escopo and not alvo:
            alvo = self.por_fqn.get(escopo['fqn'] + '.' + primeiro)
            escopo = self.por_fqn.get(escopo['fqn'].rsplit('.', 1)[0]) if escopo.get('outer') else None
        if not alvo and primeiro in ctx['imports']:  # using A = X.Y; (de um tipo ou de um namespace)
            destino = ctx['imports'][primeiro]
            alvo = self.por_fqn.get(destino) or (self.por_fqn.get(destino + '.' + resto) if resto else None)
            if not alvo:
                return None
            if alvo['fqn'] != destino:
                resto = ''
        for ns in ([ctx['pkg']] if ctx['pkg'] else []) + ctx['curingas']:
            if alvo:
                break
            alvo = self.por_fqn.get(ns + '.' + primeiro)
        if not alvo:
            achados = self.por_nome.get(primeiro, [])
            alvo = achados[0] if len(achados) == 1 else None
        if alvo and resto:
            alvo = self.por_fqn.get(alvo['fqn'] + '.' + resto)
        return alvo

    def base(self, t):
        """A classe-base: o primeiro item da lista de bases que é classe (do código lido ou, de fora, sem cara de
        interface)."""
        if t['kind'] not in ('class', 'record') or not t['_bases']:
            return None
        primeiro = t['_bases'][0]
        alvo = self.resolve(primeiro, t)
        if alvo:
            return primeiro if alvo['kind'] in ('class', 'record') else None
        return None if re.match(r'I[A-Z]', base_do_tipo(primeiro).split('.')[-1]) else primeiro

    def ancestrais(self, t):
        out = []
        while t and t['extends']:
            t = self.resolve(t['extends'], t)
            if t:
                out.append(t)
        return out

    def campo_de(self, t, nome, sem_caixa=False):
        """O campo `nome` declarado em t ou numa classe-base: (tipo que declara, campo)."""
        for x in [t] + self.ancestrais(t):
            for f in x['fields']:
                if f['name'] == nome or (sem_caixa and f['name'].lower() == nome.lower()):
                    return x, f
        return None, None

    def fatos_de(self, fqn):
        return self.fatos.setdefault(fqn, {'props': {}, 'chave': None, 'tabela': None, 'ignorar': set(),
                                           'estrategia': None, 'discriminador': None, 'possuidos': {}})

    def completa(self, tipos):
        self.por_fqn = {t['fqn']: t for t in tipos}
        self.por_nome = {}
        for t in tipos:
            self.por_nome.setdefault(t['name'], []).append(t)
        for t in tipos:
            t['extends'] = self.base(t)
        self.fatos, self.relacoes, self.entidades, self.possuidos, self.ignorados = {}, [], {}, {}, set()

        # 1. o que o código declara: DbSet<T>, API fluente, atributos de classe
        for t in tipos:
            for nome, prop in t['_dbsets']:
                e = self.resolve(nome, t)
                if e:
                    self.entidades.setdefault(e['fqn'], {})['set'] = prop
            for m in t['_metodos']:
                vars_ = {}
                for v, (tipo_, nome) in m['vars'].items():
                    if tipo_ == 'modelo':
                        vars_[v] = 'modelo'
                    else:
                        e = self.resolve(nome, t)
                        if e:
                            self.entidades.setdefault(e['fqn'], {})
                            vars_[v] = e['fqn']
                self.instrucoes(m['corpo'], vars_, t)
        for t in tipos:
            if 'NotMapped' in t['_attrs']:
                self.ignorados.add(t['fqn'])
            if 'Owned' in t['_attrs'] or 'ComplexType' in t['_attrs']:
                self.possuidos.setdefault(t['fqn'], {})
            if 'EntityTypeConfiguration' in t['_attrs']:
                self.entidades.setdefault(t['fqn'], {})

        # 2. as entidades alcançadas pelas navegações (convenção do EF)
        fila = [f for f in self.entidades if f not in self.ignorados and f not in self.possuidos]
        vistos = set(fila)
        while fila:
            t = self.por_fqn[fila.pop()]
            for x in [t] + self.ancestrais(t):
                for f in x['fields']:
                    alvo = self.resolve(elemento(f['type'])[0], x)
                    if alvo and alvo['fqn'] not in vistos and alvo['kind'] in ('class', 'record') and \
                            alvo['fqn'] not in self.ignorados and not alvo['_static'] and \
                            not self.ignorada(t['fqn'], f['name']):
                        vistos.add(alvo['fqn'])
                        if alvo['fqn'] not in self.possuidos:
                            self.entidades.setdefault(alvo['fqn'], {})
                        fila.append(alvo['fqn'])
        for f in list(self.entidades):
            if f in self.ignorados or f in self.possuidos:
                del self.entidades[f]

        # 3. classes do diagrama: entidades, as bases delas e os tipos possuídos
        self.mapeadas = set()
        for fqn in self.entidades:
            for b in self.ancestrais(self.por_fqn[fqn]):
                if b['fqn'] not in self.entidades:
                    self.mapeadas.add(b['fqn'])
        persistentes = [self.por_fqn[f] for f in list(self.entidades) + sorted(self.mapeadas) + list(self.possuidos)]

        # 4. navegações, relações, chaves estrangeiras e obrigatoriedade
        navs = {}
        for t in persistentes:
            for f in t['fields']:
                el, colecao = elemento(f['type'])
                alvo = self.resolve(el, t)
                if alvo and alvo['fqn'] in self.entidades and not self.transiente(t, f):
                    navs[(t['fqn'], f['name'])] = {'c': t, 'f': f, 'alvo': alvo, 'el': el, 'muitos': colecao}
        self.relaciona(navs)

        # 5. anotações no vocabulário do build.py
        for t in persistentes:
            self.anota_tipo(t)
            for f in t['fields']:
                if (t['fqn'], f['name']) not in navs:
                    self.anota_campo(t, f)
        return tipos

    # ------------------------------------------------ API fluente

    def instrucoes(self, corpo, vars_, t):
        """Interpreta as cadeias que começam numa variável conhecida (o ModelBuilder ou um EntityTypeBuilder)."""
        padrao = re.compile(r'(?:^|(?<=[;{}]))\s*(?:(?:var|[\w.]+<[\w.,\s]+>)\s+(\w+)\s*=\s*)?(\w+)\s*(?=\.)')
        i = 0
        while True:
            m = padrao.search(corpo, i)
            if not m:
                return
            fim = Leitor.ate_o_fim(corpo, m.end(), len(corpo))
            if m.group(2) in vars_:
                sujeito = self.cadeia(corpo[m.end():fim].rstrip().rstrip(';'), vars_[m.group(2)], vars_, t)
                if m.group(1) and sujeito:
                    vars_ = {**vars_, m.group(1): sujeito}
                i = fim
            else:
                i = m.end()

    @staticmethod
    def chamadas(s):
        """'.A<T>(x).B(y)' → [('A', 'T', ['x']), ('B', None, ['y'])]."""
        out, i = [], 0
        while True:
            m = re.compile(r'\s*[!?]?\s*\.\s*(\w+)\s*').match(s, i)
            if not m:
                return out
            nome, i, gen = m.group(1), m.end(), None
            if s[i:i + 1] == '<':
                j = fecha(s, i, '<', '>')
                gen, i = s[i + 1:j].strip(), j + 1
                while s[i:i + 1].isspace():
                    i += 1
            if s[i:i + 1] != '(':
                return out
            j = fecha(s, i, '(', ')')
            out.append((nome, gen, divide(s[i + 1:j])))
            i = j + 1

    @staticmethod
    def lambda_(arg):
        m = re.match(r'\s*\(?\s*(?:[\w.<>]+\s+)?(\w+)\s*\)?\s*=>\s*(.*)$', arg or '', re.S)
        if not m:
            return None, None
        corpo = m.group(2).strip()
        return m.group(1), (corpo[1:-1] if corpo.startswith('{') and corpo.endswith('}') else corpo + ';')

    @staticmethod
    def membros(arg):
        """Nomes dos membros citados: x => x.A, x => new { x.A, x.B }, "A", nameof(T.A)."""
        arg = (arg or '').strip()
        if arg.startswith(('"', '@"')) or arg.startswith('nameof'):
            return [literal(arg)]
        param, corpo = Leitor.lambda_(arg)
        if not param:
            return []
        return re.findall(r'\b' + re.escape(param) + r'\s*[!?]?\s*\.\s*(\w+)', corpo)

    def cadeia(self, s, sujeito, vars_, t):
        """Aplica as chamadas de uma cadeia. Devolve o sujeito final (para `var b = modelBuilder.Entity<T>()`)."""
        prop = rel = indice = possuido = None
        for nome, gen, args in self.chamadas(s):
            if sujeito == 'modelo':
                if nome == 'Entity' and gen:
                    e = self.resolve(gen, t)
                    if not e:
                        return None
                    self.entidades.setdefault(e['fqn'], {})
                    sujeito = e['fqn']
                    param, corpo = self.lambda_(args[0] if args else '')
                    if param:
                        self.instrucoes(corpo, {**vars_, param: sujeito}, t)
                elif nome in ('Ignore', 'Owned') and gen:
                    e = self.resolve(gen, t)
                    if e:
                        (self.ignorados.add(e['fqn']) if nome == 'Ignore' else self.possuidos.setdefault(e['fqn'], {}))
                    return None
                else:
                    return None
                continue
            if sujeito is None:
                return None
            fat = self.fatos_de(sujeito)
            primeiro = args[0] if args else ''
            if nome == 'ToTable' and primeiro.strip().startswith('"'):
                if possuido:
                    possuido['tabela'] = literal(primeiro)
                else:
                    fat['tabela'] = literal(primeiro)
            elif nome == 'HasKey':
                fat['chave'] = [m for a in args for m in self.membros(a)]
            elif nome in ('Property', 'PrimitiveCollection'):
                prop, rel, indice = (self.membros(primeiro) or [None])[0], None, None
            elif nome == 'Ignore':
                fat['ignorar'].update(self.membros(primeiro))
            elif nome == 'HasIndex':
                indice, prop, rel = [m for a in args for m in self.membros(a)], None, None
            elif nome == 'IsUnique' and indice and len(indice) == 1 and primeiro.strip() != 'false':
                fat['props'].setdefault(indice[0], {})['unico'] = True
            elif nome in ('HasOne', 'HasMany'):
                rel = {'origem': sujeito, 'nav': (self.membros(primeiro) or [None])[0], 'alvo': gen,
                       'muitos': nome == 'HasMany', 'inverso': None, 'inverso_muitos': None, 'fk': None,
                       'fk_em': None, 'req': None, 'delete': None, 'juncao': None, 'ctx': t}
                self.relacoes.append(rel)
                prop = indice = None
            elif rel and nome in ('WithOne', 'WithMany'):
                rel['inverso'] = (self.membros(primeiro) or [None])[0]
                rel['inverso_muitos'] = nome == 'WithMany'
            elif rel and nome == 'HasForeignKey':
                rel['fk'] = [m for a in args for m in self.membros(a)]
                rel['fk_em'] = gen
            elif rel and nome == 'OnDelete':
                rel['delete'] = primeiro.split('.')[-1].strip()
            elif rel and nome == 'UsingEntity':
                rel['juncao'] = literal(primeiro) if primeiro.strip().startswith('"') else \
                    (base_do_tipo(gen.split(',')[0]).split('.')[-1] if gen else '(padrão)')
            elif nome == 'IsRequired':
                valor = primeiro.strip() != 'false'
                if rel:
                    rel['req'] = valor
                elif prop:
                    fat['props'].setdefault(prop, {})['req'] = valor
            elif prop and nome == 'HasMaxLength':
                fat['props'].setdefault(prop, {})['length'] = primeiro.strip()
            elif prop and nome == 'HasPrecision':
                p = fat['props'].setdefault(prop, {})
                p['precision'] = primeiro.strip()
                if len(args) > 1:
                    p['scale'] = args[1].strip()
            elif prop and nome == 'HasColumnName':
                fat['props'].setdefault(prop, {})['col'] = literal(primeiro)
            elif prop and nome == 'HasColumnType':
                fat['props'].setdefault(prop, {})['tipo'] = literal(primeiro)
            elif prop and nome == 'HasConversion':
                fat['props'].setdefault(prop, {})['conv'] = gen or 'conversor'
            elif prop and nome in GERADO:
                fat['props'].setdefault(prop, {})['gerado'] = True
            elif prop and nome in ('IsRowVersion', 'IsConcurrencyToken'):
                fat['props'].setdefault(prop, {})['versao'] = True
            elif nome in ('OwnsOne', 'OwnsMany', 'ComplexProperty', 'ComplexCollection'):
                nav = (self.membros(primeiro) or [None])[0]
                dono = self.por_fqn[sujeito]
                _, f = self.campo_de(dono, nav) if nav else (None, None)
                alvo = self.resolve(elemento(f['type'])[0], dono) if f else (self.resolve(gen, t) if gen else None)
                if not alvo:
                    continue
                self.possuidos.setdefault(alvo['fqn'], {})
                info = fat['possuidos'].setdefault(nav, {'muitos': nome in ('OwnsMany', 'ComplexCollection'),
                                                         'tabela': None})
                param, corpo = self.lambda_(args[1] if len(args) > 1 else '')
                if param:
                    self.instrucoes(corpo, {**vars_, param: alvo['fqn']}, t)
                else:
                    sujeito, possuido, prop, rel, indice = alvo['fqn'], info, None, None, None
            elif nome == 'HasBaseType' and gen:
                b = self.resolve(gen, t)
                if b:
                    self.por_fqn[sujeito]['extends'] = gen
            elif nome in ESTRATEGIAS:
                fat['estrategia'] = ESTRATEGIAS[nome]
            elif nome == 'HasDiscriminator':
                fat['estrategia'] = fat['estrategia'] or 'SINGLE_TABLE'
            elif nome == 'HasValue':
                alvo = self.resolve(gen, t) if gen else self.por_fqn.get(sujeito)
                if alvo:
                    self.entidades.setdefault(alvo['fqn'], {})
                    self.fatos_de(alvo['fqn'])['discriminador'] = literal(primeiro)
        return sujeito

    # ------------------------------------------------ relações

    def ignorada(self, entidade, nome):
        e = self.por_fqn.get(entidade)
        for x in ([e] + self.ancestrais(e)) if e else []:
            if nome in self.fatos.get(x['fqn'], {}).get('ignorar', ()):
                return True
        return False

    def transiente(self, t, f):
        if 'NotMapped' in f['_attrs'] or f['name'] in self.fatos.get(t['fqn'], {}).get('ignorar', ()):
            return True
        # Ignore() na entidade que herda a propriedade da base
        return any(self.herda_de(e, t) and f['name'] in self.fatos.get(e, {}).get('ignorar', ()) for e in self.entidades)

    def relaciona(self, navs):
        usadas, rels = set(), []

        def nav_de(fqn, nome):
            if not nome or fqn not in self.por_fqn:
                return None
            x, f = self.campo_de(self.por_fqn[fqn], nome)
            return navs.get((x['fqn'], f['name'])) if f else None

        for r in self.relacoes:  # API fluente
            n = nav_de(r['origem'], r['nav'])
            alvo = n['alvo']['fqn'] if n else (self.resolve(r['alvo'], r['ctx']) or {}).get('fqn')
            if not alvo:
                continue
            inv = nav_de(alvo, r['inverso'])
            for x in (n, inv):
                if x:
                    usadas.add(id(x))
            lado_o, lado_i = (r['origem'], n), (alvo, inv)
            if r['muitos'] and r['inverso_muitos']:
                tipo, dep, princ = 'nn', lado_o, lado_i
            elif r['muitos']:
                tipo, dep, princ = 'n1', lado_i, lado_o
            elif r['inverso_muitos'] is False:
                tipo = '11'
                em = self.resolve(r['fk_em'], r['ctx']) if r['fk_em'] else None
                if em and em['fqn'] == alvo:
                    dep, princ = lado_i, lado_o
                elif em:
                    dep, princ = lado_o, lado_i
                else:
                    dep, princ = self.dependente_11(lado_o, lado_i)
            else:
                tipo, dep, princ = 'n1', lado_o, lado_i
            rels.append({'tipo': tipo, 'dep': dep, 'princ': princ, 'fk': r['fk'], 'req': r['req'],
                         'delete': r['delete'], 'juncao': r['juncao']})

        livres = [n for n in navs.values() if id(n) not in usadas]
        pares = {}
        for n in livres:  # [InverseProperty] primeiro
            ip = n['f']['_attrs'].get('InverseProperty')
            if ip and ip['pos'] and id(n) not in usadas:
                outra = nav_de(n['alvo']['fqn'], literal(ip['pos'][0]))
                if outra and id(outra) not in usadas:
                    usadas.update((id(n), id(outra)))
                    rels.append(self.par(n, outra))
        for n in livres:
            if id(n) not in usadas:
                pares.setdefault(tuple(sorted((n['c']['fqn'], n['alvo']['fqn']))), []).append(n)
        for (a, b), grupo in sorted(pares.items()):
            if a != b:
                ida = [n for n in grupo if n['c']['fqn'] == a or self.herda(n['c']['fqn'], a)]
                volta = [n for n in grupo if n not in ida]
                if len(ida) == 1 and len(volta) == 1:
                    usadas.update((id(ida[0]), id(volta[0])))
                    rels.append(self.par(ida[0], volta[0]))
                    continue
            elif len(grupo) == 2 and grupo[0]['muitos'] != grupo[1]['muitos']:  # autorrelação pai/filhos
                usadas.update(id(n) for n in grupo)
                rels.append(self.par(grupo[0], grupo[1]))
                continue
            for n in grupo:
                usadas.add(id(n))
                if n['muitos']:
                    rels.append({'tipo': 'n1', 'dep': (n['alvo']['fqn'], None), 'princ': (n['c']['fqn'], n),
                                 'fk': None, 'req': None, 'delete': None, 'juncao': None})
                else:
                    rels.append({'tipo': 'n1', 'dep': (n['c']['fqn'], n), 'princ': (n['alvo']['fqn'], None),
                                 'fk': None, 'req': None, 'delete': None, 'juncao': None})
        for r in rels:
            self.anota_relacao(r)

    def herda(self, fqn, de):
        return any(b['fqn'] == de for b in self.ancestrais(self.por_fqn[fqn]))

    def herda_de(self, fqn, t):
        """A classe `fqn` tem t entre as suas bases."""
        return fqn != t['fqn'] and any(b is t for b in self.ancestrais(self.por_fqn[fqn]))

    def par(self, n1, n2):
        base = {'fk': None, 'req': None, 'delete': None, 'juncao': None}
        l1, l2 = (n1['c']['fqn'], n1), (n2['c']['fqn'], n2)  # (tipo do lado, navegação declarada nele)
        if n1['muitos'] and n2['muitos']:
            dono, outro = sorted((l1, l2), key=lambda l: (l[0], l[1]['f']['name']))
            return {**base, 'tipo': 'nn', 'dep': dono, 'princ': outro}
        if n1['muitos'] or n2['muitos']:
            dep, princ = (l2, l1) if n1['muitos'] else (l1, l2)
            return {**base, 'tipo': 'n1', 'dep': dep, 'princ': princ}
        dep, princ = self.dependente_11(l1, l2)
        return {**base, 'tipo': '11', 'dep': dep, 'princ': princ}

    def dependente_11(self, l1, l2):
        """Num um-para-um sem HasForeignKey<T>, depende quem tem a chave estrangeira por convenção."""
        for dep, princ in ((l1, l2), (l2, l1)):
            if self.fk_por_convencao(dep, princ):
                return dep, princ
        self.aviso(f'um-para-um entre {self.por_fqn[l1[0]]["name"]} e {self.por_fqn[l2[0]]["name"]} sem chave '
                   'estrangeira achada — considerado dependente o segundo em ordem alfabética')
        return tuple(sorted((l1, l2), key=lambda l: l[0], reverse=True))

    def fk_por_convencao(self, dep, princ):
        tipo_dep, nav = self.por_fqn[dep[0]], dep[1]
        tipo_princ, nav_p = self.por_fqn[princ[0]], princ[1]
        if nav:  # [ForeignKey] na navegação
            fk = nav['f']['_attrs'].get('ForeignKey')
            if fk and fk['pos']:
                return [x.strip() for x in literal(fk['pos'][0]).split(',')]
        for x in [tipo_dep] + self.ancestrais(tipo_dep):  # [ForeignKey("Nav")] na propriedade
            for f in x['fields']:
                fk = f['_attrs'].get('ForeignKey')
                if fk and fk['pos'] and nav and literal(fk['pos'][0]) == nav['f']['name']:
                    return [f['name']]
        candidatos = []
        if nav:
            candidatos.append(nav['f']['name'] + 'Id')
        if nav_p:
            candidatos.append(nav_p['f']['name'] + 'Id')
        candidatos.append(tipo_princ['name'] + 'Id')
        for c in candidatos:
            _, f = self.campo_de(tipo_dep, c, sem_caixa=True)
            if f and f is not (nav or {}).get('f'):
                return [f['name']]
        return None

    def anota_relacao(self, r):
        (dep_fqn, dn), (princ_fqn, pn) = r['dep'], r['princ']
        if r['tipo'] == 'nn':
            if dn:
                dn['f']['anns']['ManyToMany'] = {'targetEntity': f'"{dn["alvo"]["fqn"]}"'}
                dn['f']['anns']['JoinTable'] = {'name': f'"{r["juncao"]}"'} if r['juncao'] else {}
            if pn:
                a = {'targetEntity': f'"{pn["alvo"]["fqn"]}"'}
                if dn:
                    a['mappedBy'] = f'"{dn["f"]["name"]}"'
                else:
                    pn['f']['anns']['JoinTable'] = {'name': f'"{r["juncao"]}"'} if r['juncao'] else {}
                pn['f']['anns']['ManyToMany'] = a
            return
        fk = r['fk'] or self.fk_por_convencao(r['dep'], r['princ'])
        tipo_dep = self.por_fqn[dep_fqn]
        campos_fk = [self.campo_de(tipo_dep, c, sem_caixa=True)[1] for c in (fk or [])]
        campos_fk = [f for f in campos_fk if f]
        nome_princ = self.por_fqn[princ_fqn]['name']
        for f in campos_fk:
            f.setdefault('_tags', []).append(f'chave estrangeira de {nome_princ}')
        if r['req'] is not None:
            req = r['req']
        elif campos_fk:
            req = all(self.obrigatorio(self.dono_do_campo(tipo_dep, f), f) for f in campos_fk)
        elif dn and 'Required' in dn['f']['_attrs']:
            req = True
        else:
            req = bool(dn and dn['c']['ctx']['nrt'] and not dn['f']['nullable'])
        cascata = r['delete'] == 'Cascade' if r['delete'] else req
        juncao = {'name': f'"{fk[0]}"'} if fk and len(fk) == 1 else (
            {'value': '{' + ', '.join(f'@JoinColumn(name = "{c}")' for c in fk) + '}'} if fk else {})
        rel = 'ManyToOne' if r['tipo'] == 'n1' else 'OneToOne'
        if dn:
            dn['f']['anns'][rel] = {'targetEntity': f'"{dn["alvo"]["fqn"]}"', 'optional': 'false' if req else 'true'}
            dn['f']['anns']['JoinColumns' if fk and len(fk) > 1 else 'JoinColumn'] = juncao
            dn['f']['req'] = req
        if pn:
            a = {'targetEntity': f'"{pn["alvo"]["fqn"]}"'}
            if dn:
                a['mappedBy'] = f'"{dn["f"]["name"]}"'
            elif r['tipo'] == 'n1':
                pn['f']['anns']['JoinColumns' if fk and len(fk) > 1 else 'JoinColumn'] = juncao
            if cascata:
                a['cascade'] = '{REMOVE}'
            pn['f']['anns']['OneToMany' if r['tipo'] == 'n1' else 'OneToOne'] = a

    def dono_do_campo(self, t, f):
        for x in [t] + self.ancestrais(t):
            if any(g is f for g in x['fields']):
                return x
        return t

    # ------------------------------------------------ anotações

    def eh_valor(self, tipo, t):
        base = base_do_tipo(tipo)
        if base.split('.')[-1] in TIPOS_DE_VALOR:
            return True
        alvo = self.resolve(base, t)
        return bool(alvo and alvo['kind'] in ('enum', 'struct'))

    def obrigatorio(self, t, f, chave=False):
        fat = self.props_de(t, f['name'])
        if 'req' in fat:
            return fat['req']
        if chave or 'Required' in f['_attrs']:
            return True
        if f['nullable']:
            return False
        return self.eh_valor(f['type'], t) or bool(t['ctx']['nrt'])

    def props_de(self, t, nome):
        """O que a API fluente disse da propriedade, na classe que a declara ou numa entidade que a herda."""
        out = dict(self.fatos.get(t['fqn'], {}).get('props', {}).get(nome, {}))
        for e in self.entidades:
            if self.herda_de(e, t):
                for k, v in self.fatos.get(e, {}).get('props', {}).get(nome, {}).items():
                    out.setdefault(k, v)
        return out

    def chaves(self, t):
        """Nomes das propriedades-chave declaradas em t: HasKey, [Key] ou a convenção Id / <Classe>Id."""
        nomes = set()
        donos = [e for e in self.entidades if e == t['fqn'] or self.herda_de(e, t)]
        for e in donos:
            ent = self.por_fqn[e]
            explicita = self.fatos.get(e, {}).get('chave')
            if explicita:
                nomes.update(explicita)
                continue
            if any('Key' in f['_attrs'] for x in [ent] + self.ancestrais(ent) for f in x['fields']):
                continue
            for c in ('Id', ent['name'] + 'Id'):
                x, f = self.campo_de(ent, c, sem_caixa=True)
                if f:
                    if x is t:
                        nomes.add(f['name'])
                    break
        return {n for n in nomes if any(f['name'] == n for f in t['fields'])} | \
            {f['name'] for f in t['fields'] if 'Key' in f['_attrs']}

    def anota_tipo(self, t):
        fqn, a = t['fqn'], t['anns']
        if fqn in self.possuidos:
            a['Embeddable'] = {}
            return
        if fqn in self.mapeadas:
            a['MappedSuperclass'] = {}
            return
        a['Entity'] = {}
        fat = self.fatos.get(fqn, {})
        pai = next((b for b in self.ancestrais(t) if b['fqn'] in self.entidades), None)
        raiz = t
        for b in self.ancestrais(t):
            if b['fqn'] in self.entidades:
                raiz = b
        estrategia = self.fatos.get(raiz['fqn'], {}).get('estrategia') or 'SINGLE_TABLE'
        if 'Table' in t['_attrs'] and t['_attrs']['Table']['pos']:
            a['Table'] = {'name': t['_attrs']['Table']['pos'][0]}
        elif fat.get('tabela'):
            a['Table'] = {'name': f'"{fat["tabela"]}"'}
        elif not pai or estrategia != 'SINGLE_TABLE':
            a['Table'] = {'name': f'"{self.entidades[fqn].get("set") or t["name"]}"'}
        if not pai and any(self.herda_de(e, t) for e in self.entidades):
            a['Inheritance'] = {'strategy': estrategia}
        if fat.get('discriminador'):
            a['DiscriminatorValue'] = {'value': f'"{fat["discriminador"]}"'}

    def anota_campo(self, t, f):
        a, at = f['anns'], f['_attrs']
        fat = self.props_de(t, f['name'])
        tags = f.setdefault('_tags', [])
        el, colecao = elemento(f['type'])
        alvo = self.resolve(el, t)
        if alvo and alvo['fqn'] in self.possuidos:
            info = next((self.fatos[e]['possuidos'][f['name']] for e in [t['fqn']] + list(self.entidades)
                         if f['name'] in self.fatos.get(e, {}).get('possuidos', {})), {})
            if colecao or info.get('muitos'):
                a['ElementCollection'] = {}
                if info.get('tabela'):
                    a['CollectionTable'] = {'name': f'"{info["tabela"]}"'}
            else:
                a['Embedded'] = {}
        chave = f['name'] in self.chaves(t)
        if chave:
            a['Id'] = {}
        col = {}
        if 'Column' in at and at['Column']['pos']:
            col['name'] = at['Column']['pos'][0]
        if fat.get('col'):
            col['name'] = f'"{fat["col"]}"'
        tamanho = fat.get('length') or next((at[k]['pos'][0] for k in ('MaxLength', 'StringLength')
                                             if k in at and at[k]['pos']), None)
        if tamanho:
            col['length'] = tamanho
        prec = at.get('Precision')
        if fat.get('precision') or (prec and prec['pos']):
            col['precision'] = fat.get('precision') or prec['pos'][0]
            escala = fat.get('scale') or (prec['pos'][1] if prec and len(prec['pos']) > 1 else None)
            if escala:
                col['scale'] = escala
        ix = t['_attrs'].get('Index')  # [Index(nameof(P), IsUnique = true)] na classe
        if fat.get('unico') or (ix and len(ix['pos']) == 1 and literal(ix['pos'][0]) == f['name']
                                and ix['nom'].get('IsUnique', '').strip() == 'true'):
            col['unique'] = 'true'
        if col:
            a['Column'] = col
        tipo_col = fat.get('tipo') or ('Column' in at and literal(at['Column']['nom'].get('TypeName', '')))
        if tipo_col:
            tags.append(f'tipo {tipo_col}')
        gerado = at.get('DatabaseGenerated')
        if fat.get('gerado') or (gerado and gerado['pos'] and not gerado['pos'][0].endswith('None')):
            a['GeneratedValue'] = {}
        if fat.get('versao') or 'Timestamp' in at or 'ConcurrencyCheck' in at:
            a['Version'] = {}
        conv = fat.get('conv')
        if conv:
            if alvo and alvo['kind'] == 'enum' and base_do_tipo(conv) in ('string', 'String'):
                a['Enumerated'] = {'value': 'STRING'}
            else:
                a['Convert'] = {}
        if self.transiente(t, f):
            a['Transient'] = {}
        f['req'] = self.obrigatorio(t, f, chave)

