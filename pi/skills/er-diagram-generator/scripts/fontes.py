"""Citações de documento e de código, carimbos e lacunas: o que as skills de diagrama têm em comum.

CÓPIA IDÊNTICA nas skills de atividades, de arquitetura, da planta do banco e do diagrama de classes (em
<skill>/scripts/fontes.py). Cada skill precisa funcionar sozinha (o instalar.sh do skill-kit copia uma skill por vez),
por isso o arquivo vai em todas. Mude em uma, copie para as outras e confira com plugins/diagramas/conferir-copias.py.

Uma citação aponta o trecho que justifica um elemento do diagrama:
- de código: {arquivo, ancora, antes, depois}, como sempre;
- de documento (requisito ou contexto, em Markdown): {arquivo, secao, ancora?, selo?}, ou {arquivo, ancora, antes,
  depois}. O texto citado ganha um carimbo (resumo), gravado em <pasta da skill no projeto>/carimbos.json pelo
  --aceitar: se o texto mudar, o build pede a revisão do diagrama. Marcas de entrega (emoji + itálico) e colunas de
  situação das tabelas não entram no carimbo.
"""
import hashlib
import json
import pathlib
import re
import sys

TIPOS_DE_FONTE = ("contexto", "requisito", "codigo")
CAMPOS_DA_CITACAO = {"arquivo", "ancora", "antes", "depois", "secao", "selo"}
MODOS = {"estrito", "levantamento"}
CONFIG_PADRAO = {"modo": "estrito", "colunas_de_situacao": ["Situação", "Status"],
                 "lacunas": "docs/levantamento/lacunas-e-perguntas.md", "contexto": "docs/contexto.md"}
FIM_DE_FRASE = re.compile(r"(?<=[.!?])\s+(?=[\"'(«“]?[A-ZÀ-Ý0-9])")
MARKDOWN = {".md", ".markdown"}
MAX_LINHA = 130

TITULO_MD = re.compile(r"^ {0,3}(#{1,6})\s")
EMOJI = "[\u2600-\u27BF\u2B00-\u2BFF\U0001F300-\U0001FAFF]\uFE0F?"
MARCA_DE_SITUACAO = re.compile(rf"(?:{EMOJI}\s*)+\*[^*\n]+\*")
DIVISOR_DE_CELULA = re.compile(r"(?<!\\)\|")
RESPONDIDA = re.compile(r"✅\s*\*respondida em ([^*]+)\*\s*")


def ler_config(raiz, pasta):
    arquivo = raiz / pasta / "config.json"
    config = dict(CONFIG_PADRAO)
    if arquivo.exists():
        config.update(json.loads(arquivo.read_text(encoding="utf8")))
    if config["modo"] not in MODOS:
        sys.exit(f"{arquivo.relative_to(raiz)}: modo desconhecido {config['modo']} (use {' ou '.join(sorted(MODOS))})")
    config["colunas_de_situacao"] = {c.strip().lower() for c in config["colunas_de_situacao"]}
    return config


# ── Texto dos documentos ──

def sem_negrito(texto):
    return re.sub(r"\s+", " ", texto.replace("**", "")).strip()


def normalizar(texto):
    """Tira as marcas de situação (emoji seguido de itálico), o negrito e os espaços repetidos.

    Também arruma o que a marca deixa para trás: parênteses vazios, espaço antes da pontuação e ponto repetido, para que
    "(403). ✅ *implementado*." e "(403)." deem o mesmo texto.
    """
    texto = sem_negrito(MARCA_DE_SITUACAO.sub("", texto))
    texto = re.sub(r"\(\s*\)", "", texto)
    texto = re.sub(r"\s+([.,;:)])", r"\1", texto)
    return re.sub(r"\.(?:\s*\.)+", ".", texto).strip()


def para_carimbo(texto):
    """O texto que entra no carimbo: normalizado e sem a pontuação final."""
    return re.sub(r"[\s.,;:]+$", "", texto)


def frases(item):
    """Separa um item nas frases (ponto, exclamação ou interrogação seguidos de maiúscula)."""
    return [f.strip() for f in FIM_DE_FRASE.split(item) if f.strip()]


def itens(linha):
    """Separa a linha nos itens entre ';', sem cortar o que está entre parênteses ou colchetes."""
    partes, atual, fundo = [], [], 0
    for ch in linha:
        if ch in "([":
            fundo += 1
        elif ch in ")]" and fundo:
            fundo -= 1
        if ch == ";" and not fundo:
            partes.append("".join(atual))
            atual = []
        else:
            atual.append(ch)
    partes.append("".join(atual))
    return [p.strip() for p in partes if p.strip()]


def celulas(linha):
    meio = linha.strip()
    meio = meio[1:] if meio.startswith("|") else meio
    meio = meio[:-1] if meio.endswith("|") and not meio.endswith("\\|") else meio
    return [c.strip() for c in DIVISOR_DE_CELULA.split(meio)]


def linha_de_tabela(linha):
    return linha.lstrip().startswith("|")


# ── Unidade citada: o item da lista ou o parágrafo, mesmo quebrado em várias linhas ──

CITACAO_MD = re.compile(r"^\s*((?:>\s?)+)")
INICIO_DE_ITEM = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s")
ALERTA = re.compile(r"^\s*\[!(\w+)\]\s*(.*)$")
NOMES_DE_ALERTA = {"note": "Nota", "tip": "Dica", "important": "Importante", "warning": "Atenção", "caution": "Cuidado"}


def sem_citacao(linha):
    """(profundidade do bloco de citação '>', o resto da linha)."""
    m = CITACAO_MD.match(linha)
    return (m.group(1).count(">"), linha[m.end():]) if m else (0, linha)


def _abre_unidade(linha):
    """A linha começa uma unidade nova (ou é uma sozinha): vazia, título, tabela, item de lista ou título de alerta."""
    resto = sem_citacao(linha)[1]
    return (not resto.strip() or TITULO_MD.match(resto) or linha_de_tabela(resto) or INICIO_DE_ITEM.match(resto)
            or ALERTA.match(resto))


def _so_uma_linha(linha):
    resto = sem_citacao(linha)[1]
    return not resto.strip() or TITULO_MD.match(resto) or linha_de_tabela(resto) or ALERTA.match(resto)


def unidade(linhas, i, inicio, fim):
    """As linhas [a, b) do item de lista ou do parágrafo que contém a linha i, dentro de [inicio, fim)."""
    if _so_uma_linha(linhas[i]):
        return i, i + 1
    fundo = sem_citacao(linhas[i])[0]
    a = i
    while (a > inicio and not _abre_unidade(linhas[a]) and not _so_uma_linha(linhas[a - 1])
           and sem_citacao(linhas[a - 1])[0] == fundo):
        a -= 1
    b = i + 1
    while b < fim and not _abre_unidade(linhas[b]) and sem_citacao(linhas[b])[0] == fundo:
        b += 1
    return a, b


def texto_da_unidade(linhas, a, b):
    """O texto da unidade como uma linha só. A primeira linha fica como está (o carimbo de antes não muda); das outras,
    sai o '>' do bloco de citação e o recuo."""
    return " ".join([linhas[a]] + [sem_citacao(l)[1].strip() for l in linhas[a + 1:b]])


def visto(linhas, a, b):
    """O texto da unidade como aparece na página: sem o '>' do bloco de citação e sem o negrito."""
    return sem_negrito(" ".join(sem_citacao(l)[1].strip() for l in linhas[a:b]))


def alerta_em_volta(linhas, a):
    """O alerta do GitHub (> [!important] Título) em que a linha a está, como "Importante: Título", ou None."""
    if not sem_citacao(linhas[a])[0]:
        return None
    topo = a
    while topo > 0 and sem_citacao(linhas[topo - 1])[0]:
        topo -= 1
    m = ALERTA.match(sem_citacao(linhas[topo])[1])
    if not m:
        return None
    nome = NOMES_DE_ALERTA.get(m.group(1).lower(), m.group(1).capitalize())
    titulo = sem_negrito(m.group(2))
    return f"{nome}: {titulo}" if titulo else nome


def carimbo(texto):
    return hashlib.sha256(texto.encode("utf8")).hexdigest()[:8]


def achar_secao(linhas, secao):
    padrao = re.compile(re.escape(secao) + r"(?!\w)")
    for i, linha in enumerate(linhas):
        titulo = TITULO_MD.match(linha)
        if titulo and padrao.search(linha):
            nivel = len(titulo.group(1))
            fim = len(linhas)
            for j in range(i + 1, len(linhas)):
                outro = TITULO_MD.match(linhas[j])
                if outro and len(outro.group(1)) <= nivel:
                    fim = j
                    break
            while fim > i + 1 and not linhas[fim - 1].strip():
                fim -= 1
            return i, fim
    return None


def item_de_tabela(linhas, i, config):
    """A linha i de uma tabela, sem as colunas de situação. Devolve (texto normalizado, corpo para a página)."""
    topo = i
    while topo > 0 and linha_de_tabela(linhas[topo - 1]):
        topo -= 1
    cabecalho = celulas(linhas[topo])
    valores = celulas(linhas[i])
    fica = [normalizar(v) for k, v in enumerate(valores)
            if k >= len(cabecalho) or normalizar(cabecalho[k]).lower() not in config["colunas_de_situacao"]]
    nomes = [sem_negrito(h) for h in cabecalho] if topo != i else []
    corpo = "\n".join((f"{nomes[k]}: " if k < len(nomes) else "") + sem_negrito(v).replace("\\|", "|")
                      for k, v in enumerate(valores))
    return "| " + " | ".join(fica) + " |", corpo


def texto_da_linha(linhas, i, config):
    """O texto normalizado de uma linha; numa tabela, sem as colunas de situação."""
    if linha_de_tabela(linhas[i]):
        return item_de_tabela(linhas, i, config)[0]
    return normalizar(linhas[i])


def texto_do_bloco(linhas, inicio, fim, config):
    return "\n".join(para_carimbo(texto_da_linha(linhas, i, config)) for i in range(inicio, fim) if linhas[i].strip())


def citar_documento(raiz, c, config):
    """Resolve uma citação de documento. Devolve (trecho para a página, texto do carimbo) ou (None, motivo).

    A âncora é procurada no texto já normalizado (sem marcas de situação, sem negrito e, nas tabelas, sem as colunas de
    situação), para não depender do que muda a cada entrega.
    """
    caminho = raiz / c["arquivo"]
    if not caminho.exists():
        return None, f"arquivo citado não existe: {c['arquivo']}"
    linhas = caminho.read_text(encoding="utf8").splitlines()
    ancora = normalizar(c["ancora"]) if "ancora" in c else None
    if "secao" not in c:
        achadas = [i for i in range(len(linhas)) if ancora in texto_da_linha(linhas, i, config)]
        if not achadas:
            return None, f"âncora não encontrada em {c['arquivo']}: {c['ancora']}"
        i = achadas[0]
        inicio, fim = max(0, i - c.get("antes", 0)), min(len(linhas), i + c.get("depois", 0) + 1)
        corpo = "\n".join(sem_negrito(l) if l.strip() else "" for l in linhas[inicio:fim])
        trecho = {"arquivo": c["arquivo"], "linha": inicio + 1, "corpo": corpo, "ancora": ancora}
        return trecho, texto_do_bloco(linhas, inicio, fim, config)
    achada = achar_secao(linhas, c["secao"])
    if not achada:
        return None, f"seção não encontrada em {c['arquivo']}: {c['secao']}"
    inicio, fim = achada
    titulo = re.sub(r"\s#[^\s#]\S*", "", linhas[inicio].strip().lstrip("#"))
    base = {"arquivo": c["arquivo"], "secao": sem_negrito(titulo)}
    if ancora is None:
        corpo = "\n".join(sem_negrito(l) if l.strip() else "" for l in linhas[inicio:fim])
        return {**base, "linha": inicio + 1, "corpo": corpo}, texto_do_bloco(linhas, inicio, fim, config)
    achada = achar_ancora(linhas, inicio, fim, ancora, config, por_frase=c["arquivo"] == config.get("contexto"))
    if not achada:
        return None, f"âncora não encontrada na seção {c['secao']} de {c['arquivo']}: {c['ancora']}"
    i, texto, corpo, item, alerta = achada
    if alerta:
        base["alerta"] = alerta
    if item is None:
        return {**base, "linha": i + 1, "corpo": corpo}, texto
    return {**base, "linha": i + 1, "corpo": corpo, "destaque": item, "ancora": ancora}, texto


def achar_ancora(linhas, inicio, fim, ancora, config, por_frase=False):
    """A primeira unidade do trecho [inicio, fim) com a âncora já normalizada: a linha da tabela (sem as colunas de
    situação) ou o item entre ';' do item de lista ou do parágrafo (mesmo quebrado em várias linhas); por_frase (o
    documento de contexto, que é prosa), a frase dentro do item.

    Devolve (índice da primeira linha, texto do carimbo, corpo, item, alerta) ou None. O item é None numa tabela; o
    alerta é o rótulo do bloco > [!important] em volta ("Importante: Premissas"), ou None."""
    i = inicio
    while i < fim:
        if linha_de_tabela(linhas[i]):
            if ancora in texto_da_linha(linhas, i, config):
                texto, corpo = item_de_tabela(linhas, i, config)
                return i, para_carimbo(texto), corpo, None, None
            i += 1
            continue
        a, b = unidade(linhas, i, inicio, fim)
        texto = normalizar(texto_da_unidade(linhas, a, b))
        if ancora not in texto:
            # a âncora que só existe na linha crua (com o '>' ou o recuo da continuação) vale como antes: a linha
            k = next((k for k in range(a, b) if ancora in normalizar(linhas[k])), None)
            if k is not None:
                a, b, texto = k, k + 1, normalizar(linhas[k])
            else:
                i = b
                continue
        partes = itens(texto)
        if por_frase:
            partes = [f for p in partes for f in frases(p)]
        item = next((p for p in partes if ancora in p), None) or texto
        corpo = visto(linhas, a, b)
        mostra = [p for p in itens(normalizar(visto(linhas, a, b))) if ancora in p]
        if por_frase:
            mostra = [f for p in mostra for f in frases(p) if ancora in f]
        return a, para_carimbo(item), corpo, (mostra[0] if mostra else item), alerta_em_volta(linhas, a)
    return None


def trecho_de_codigo(raiz, citacao, erros, nome):
    caminho = raiz / citacao["arquivo"]
    if not caminho.exists():
        erros.append(f"{nome}: arquivo citado não existe: {citacao['arquivo']}")
        return None
    linhas = caminho.read_text(encoding="utf8").splitlines()
    achadas = [i for i, linha in enumerate(linhas) if citacao["ancora"] in linha]
    if not achadas:
        erros.append(f"{nome}: âncora não encontrada em {citacao['arquivo']}: {citacao['ancora']}")
        return None
    i = achadas[0]
    inicio, fim = max(0, i - citacao.get("antes", 0)), min(len(linhas), i + citacao.get("depois", 0) + 1)
    bloco = linhas[inicio:fim]
    margem = min((len(l) - len(l.lstrip()) for l in bloco if l.strip()), default=0)
    if pathlib.Path(citacao["arquivo"]).suffix.lower() in MARKDOWN:
        corpo = "\n".join(l[margem:] for l in bloco)
    else:
        corpo = "\n".join(l[margem:] if len(l[margem:]) <= MAX_LINHA else l[margem:][:MAX_LINHA - 3] + "..." for l in bloco)
    return {"arquivo": citacao["arquivo"], "linha": inicio + 1, "corpo": corpo}


# ── Fontes e carimbos ──

def chave(c):
    return tuple(c.get(k) for k in ("arquivo", "secao", "ancora", "antes", "depois"))


def ler_carimbos(raiz, pasta):
    arquivo = raiz / pasta / "carimbos.json"
    if not arquivo.exists():
        return {}
    return {fluxo: {chave(e): e["carimbo"] for e in entradas}
            for fluxo, entradas in json.loads(arquivo.read_text(encoding="utf8")).items()}


def gravar_carimbos(raiz, pasta, fluxo, atuais):
    arquivo = raiz / pasta / "carimbos.json"
    dados = json.loads(arquivo.read_text(encoding="utf8")) if arquivo.exists() else {}
    entradas = []
    for k, valor in sorted(atuais.items(), key=lambda par: tuple(str(x) for x in par[0])):
        e = {campo: v for campo, v in zip(("arquivo", "secao", "ancora", "antes", "depois"), k) if v is not None}
        e["carimbo"] = valor
        entradas.append(e)
    dados[fluxo] = entradas
    arquivo.write_text(json.dumps(dict(sorted(dados.items())), ensure_ascii=False, indent=2) + "\n", encoding="utf8")


def separar_fontes(no, erros):
    """Junta 'codigo' e 'fontes' num só dicionário, conferindo o formato."""
    fontes = no.get("fontes", {})
    if not isinstance(fontes, dict):
        erros.append(f"{no['id']}: fontes deve ser um objeto com contexto, requisito e codigo")
        return {}
    for tipo in fontes:
        if tipo not in TIPOS_DE_FONTE:
            erros.append(f"{no['id']}: tipo de fonte desconhecido {tipo} (use {', '.join(TIPOS_DE_FONTE)})")
    if "codigo" in no and "codigo" in fontes:
        erros.append(f"{no['id']}: use codigo ou fontes.codigo, não os dois")
    juntas = {t: list(fontes.get(t, [])) for t in TIPOS_DE_FONTE}
    juntas["codigo"] += no.get("codigo", [])
    for tipo, citacoes in juntas.items():
        for c in citacoes:
            sobra = set(c) - CAMPOS_DA_CITACAO
            if sobra:
                erros.append(f"{no['id']}: campo desconhecido na citação de {tipo}: {', '.join(sorted(sobra))}")
            if "arquivo" not in c or ("ancora" not in c and "secao" not in c):
                erros.append(f"{no['id']}: citação de {tipo} sem arquivo, ou sem ancora nem secao")
            elif tipo == "codigo" and ("secao" in c or "ancora" not in c):
                erros.append(f"{no['id']}: citação de código usa arquivo e ancora (secao só vale para documentos)")
            elif "secao" in c and pathlib.Path(c["arquivo"]).suffix.lower() not in MARKDOWN:
                erros.append(f"{no['id']}: secao só vale para Markdown: {c['arquivo']}")
    return juntas


def sem_link(texto):
    return re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", sem_negrito(texto))


def ler_lacunas(raiz, config):
    """Lê as linhas numeradas das tabelas do arquivo de lacunas: número → {pergunta, contexto, provisorio}."""
    caminho = raiz / config["lacunas"]
    if not caminho.exists():
        return None
    linhas = caminho.read_text(encoding="utf8").splitlines()
    achadas = {}
    cabecalho = None
    for i, linha in enumerate(linhas):
        if not linha_de_tabela(linha):
            cabecalho = None
            continue
        if cabecalho is None:
            cabecalho = [normalizar(c).lower() for c in celulas(linha)]
            continue
        valores = celulas(linha)
        if not valores or not re.fullmatch(r"\d+", valores[0].strip()):
            continue
        campo = {}
        for k, nome in enumerate(cabecalho):
            if k >= len(valores):
                break
            if nome.startswith("pergunta"):
                marca = RESPONDIDA.search(valores[k])
                if marca:  # marcada pelo plugin requisitos (apply-committee-decisions) quando o comitê decide
                    campo["respondida"] = marca.group(1).strip()
                campo["pergunta"] = sem_link(RESPONDIDA.sub("", valores[k]))
            elif nome.startswith("contexto"):
                campo["contexto"] = sem_link(valores[k])
            elif "provis" in nome:
                campo["provisorio"] = sem_link(valores[k])
        achadas.setdefault(int(valores[0]), {**campo, "linha": i + 1})
    return achadas


def conferir_documento(raiz, c, config, gravados):
    """Resolve uma citação de documento e compara com o carimbo gravado.

    Devolve (trecho, carimbo atual, problema, texto): problema é None, "sumiu" (o texto diz o que faltou),
    "sem-carimbo" ou "mudou" (o texto é o rótulo da citação, como "RF#D02 › coordenada fora do Brasil").
    """
    rotulo = " › ".join(c[k] for k in ("secao", "ancora") if k in c)
    trecho, texto = citar_documento(raiz, c, config)
    if trecho is None:
        return None, None, "sumiu", texto
    atual = carimbo(texto)
    gravado = gravados.get(chave(c))
    if gravado is None:
        return trecho, atual, "sem-carimbo", rotulo
    if gravado != atual:
        return trecho, atual, "mudou", rotulo
    return trecho, atual, None, rotulo



MODELO_DE_LACUNAS = """# Lacunas e perguntas em aberto

> Dúvidas do levantamento. Cada uma vira decisão (ADR) ou ajuste de requisito quando respondida; até lá, vale a
> solução provisória. Os diagramas citam o número da dúvida (campo `lacunas` do diagrama de atividades).

| # | Pergunta | Contexto | Solução provisória |
| --- | --- | --- | --- |
"""


def nova_lacuna(raiz, config, pergunta, contexto="", provisoria=""):
    """Acrescenta uma dúvida numerada ao arquivo de lacunas (cria o arquivo, se não existe) e devolve o número.

    A linha entra no fim da última tabela com a coluna Pergunta; as células se preenchem pelo título da coluna (#,
    Pergunta, Contexto, a que tem "provisória"); as outras ficam vazias. O número é o maior do arquivo mais um."""
    caminho = raiz / config["lacunas"]
    if not caminho.exists():
        caminho.parent.mkdir(parents=True, exist_ok=True)
        caminho.write_text(MODELO_DE_LACUNAS, encoding="utf8")
    linhas = caminho.read_text(encoding="utf8").splitlines()
    numero = max(ler_lacunas(raiz, config) or {0: None}) + 1
    tabela = None  # (índice do cabeçalho, índice da última linha)
    i = 0
    while i < len(linhas):
        if linha_de_tabela(linhas[i]):
            inicio = i
            while i + 1 < len(linhas) and linha_de_tabela(linhas[i + 1]):
                i += 1
            if any(normalizar(c).lower().startswith("pergunta") for c in celulas(linhas[inicio])):
                tabela = (inicio, i)
        i += 1
    if tabela is None:
        sys.exit(f"{config['lacunas']}: nenhuma tabela com a coluna Pergunta")
    cabecalho = [normalizar(c).lower() for c in celulas(linhas[tabela[0]])]

    def celula(nome):
        if nome in ("#", "nº", "n", "numero", "número"):
            return str(numero)
        texto = (pergunta if nome.startswith("pergunta") else contexto if nome.startswith("contexto")
                 else provisoria if "provis" in nome else "")
        return re.sub(r"\s+", " ", texto).replace("|", "\\|").strip()

    linhas.insert(tabela[1] + 1, "| " + " | ".join(celula(n) for n in cabecalho) + " |")
    caminho.write_text("\n".join(linhas) + "\n", encoding="utf8")
    return numero
