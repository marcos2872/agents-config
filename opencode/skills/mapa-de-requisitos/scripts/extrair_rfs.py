#!/usr/bin/env python3
"""
Extrai os requisitos de um documento Markdown para o mapa de requisitos.

O formato vem da configuração do projeto (`requisitos` em config.json). Há dois leitores.

`markdown-headings` lê o formato de docs/requisitos/_template-modulo.md: cada requisito é um título próprio,
seguido de uma lista de campos:

    ##### RF#A12 — Criar pedido #core
    - **Descrição:** ...
    - **Ator:** ...
    - **Fluxo principal:** ...

e aceita, na configuração, a expressão do título do requisito (com os grupos `codigo` e `titulo`), a do título que
agrupa os requisitos (o assunto, por padrão a entidade `### E – Nome`) e o mapeamento dos nomes dos campos para
objetivo, atores, fluxo, regras e core. As linhas recuadas ou numeradas logo abaixo de um campo pertencem a ele.

`markdown-details` lê requisitos escritos como blocos HTML colapsáveis com uma tabela de campos:

    <details id="rfa12">
    <summary><strong>RF – Criar pedido (RF#A12)</strong></summary>
    | Campo | Valor |
    |---|---|
    | **Objetivo** | ... |
    ...
    </details>

e aceita a expressão do bloco, a do código no título, o prefixo a tirar do título, a do grupo e o mapeamento dos
campos da tabela.

`markdown-secoes` lê documentos em que cada campo é um parágrafo só em negrito, com o conteúdo abaixo (o formato de
documentos de requisitos exportados do Word):

    ### RF001 — Autenticação
    **Descrição**
    Valida se o usuário pertence à plataforma
    **Critérios de aceite**
    1. Campos obrigatórios
       - a) E-mail

e aceita as mesmas expressões `requisito` e `grupo` do `markdown-headings`. Só a linha que é inteira `**Nome**` abre
um campo; os subitens recuados se juntam ao item de cima ("Campos obrigatórios: E-mail; Senha").

Um formato novo entra como outra função em LEITORES, devolvendo o mesmo dicionário.

Nos leitores, os campos podem ir para objetivo, atores, papeis (quem pode executar), fluxo, regras, criterios
(critérios de aceite), campos, nao_funcionais e core, e
`valores_ocultos` lista, por campo, os valores que não vão ao mapa (ex.: um papel ainda a definir).

O texto que vai ao cliente passa pelo filtro do projeto, quando a configuração aponta um (`filtro`): linhas com
referência interna saem, e parênteses que são só referência também. O que fica fora dos campos — as notas de histórico
abaixo de cada requisito — não é lido.

Uso: python3 extrair_rfs.py docs/requisitos/modulo-a-cadastros.md saida.json
"""
import html
import importlib.util
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import projeto  # noqa: E402

CAMPO = re.compile(r"^\s*[-*]\s+\*\*(?P<campo>[^*:]+):?\*\*:?\s*(?P<valor>.*)$")
CONTINUACAO = re.compile(r"^(?:\s+\S|\s*\d+[.)]\s)")
TITULO = re.compile(r"^#{1,6}\s")
LINHA = re.compile(r"^\|\s*\*\*(?P<campo>[^*|]+)\*\*\s*\|(?P<valor>.*)\|\s*$", re.M)
LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")


def carregar_filtro(config):
    """O módulo de padrões do projeto (RESIDUO, PARENTESE, ITEM_PURO, TEM_REF), ou None se o projeto não usa filtro."""
    caminho = os.environ.get("MAPA_FILTRO") or config.get("filtro")
    if not caminho:
        return None
    caminho = projeto.no_projeto(caminho)
    if os.path.isdir(caminho):
        caminho = os.path.join(caminho, "padroes.py")
    if not os.path.exists(caminho):
        sys.exit(f"O filtro do texto que vai ao cliente não está em {caminho}. Aponte o arquivo em MAPA_FILTRO "
                 "(numa worktree ele pode não existir), ou tire `filtro` da configuração se o projeto não tiver um.")
    especificacao = importlib.util.spec_from_file_location("padroes_do_projeto", caminho)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def limpador(filtro):
    def limpar(texto):
        """Markdown da célula → texto simples, em linhas, sem referência interna."""
        texto = LINK.sub(r"\1", texto)
        texto = re.sub(r"<br\s*/?>", "\n", texto)
        texto = re.sub(r"<[^>]+>", "", texto)
        texto = html.unescape(texto).replace("**", "").replace("`", "")
        linhas = []
        for linha in texto.split("\n"):
            linha = linha.strip()
            if not linha:
                continue
            if filtro is not None:
                linha = filtro.PARENTESE.sub(
                    lambda m: "" if filtro.ITEM_PURO.match(m.group(1)) or (
                        filtro.TEM_REF.search(m.group(1)) and filtro.RESIDUO.search(m.group(1))) else m.group(0), linha)
                if filtro.RESIDUO.search(linha):
                    continue
            linhas.append(linha.strip())
        return linhas
    return limpar


def status_da_matriz(caminho):
    """Status de implementação por RF, das tabelas Markdown da matriz, pela coluna "Status de implementação"."""
    status = {}
    if not caminho or not os.path.exists(caminho):
        return status
    cabecalho = None
    for linha in open(caminho, encoding="utf-8"):
        partes = [p.strip() for p in linha.strip().strip("|").split("|")]
        if partes[:1] == ["RF"]:
            cabecalho = partes
        elif cabecalho and len(partes) == len(cabecalho) and re.match(r"RN?F#", partes[0]):
            status[partes[0]] = {"implementacao": dict(zip(cabecalho, partes)).get("Status de implementação", "")}
    return status


def ler_markdown_details(texto, regras, limpar):
    bloco = re.compile(regras["bloco"], re.S)
    codigo_re = re.compile(regras["codigo"])
    prefixo = re.compile(regras.get("prefixo_do_titulo", r"^$"))
    grupo_re = re.compile(regras["grupo"], re.M) if regras.get("grupo") else None
    campos = regras.get("campos", {})
    ocultos = regras.get("valores_ocultos", {})
    grupos = [(m.start(), m.group("nome").strip()) for m in grupo_re.finditer(texto)] if grupo_re else []

    rfs = {}
    for achado in bloco.finditer(texto):
        titulo = achado.group("titulo").strip()
        codigo = codigo_re.search(titulo)
        if not codigo:
            continue
        rf = codigo.group(1).replace(" ", "")
        nome = prefixo.sub("", codigo_re.sub("", titulo)).strip()
        grupo = next((nome_ for inicio, nome_ in reversed(grupos) if inicio < achado.start()), "")
        dados = {"codigo": rf, "titulo": nome, "ancora": achado.groupdict().get("ancora") or "", "grupo": grupo}
        for linha in LINHA.finditer(achado.group("corpo")):
            chave = campos.get(linha.group("campo").strip())
            if not chave:
                continue
            valor = limpar(linha.group("valor"))
            if " ".join(valor).strip() in ocultos.get(chave, []):
                continue
            dados[chave] = (valor[0] if valor else "") if chave == "core" else valor
        dados["core"] = str(dados.get("core", "")).strip().lower().startswith("sim")
        rfs.setdefault(rf, dados)
    return rfs


def ler_markdown_headings(texto, regras, limpar):
    requisito_re = re.compile(regras["requisito"], re.M)
    grupo_re = re.compile(regras["grupo"], re.M) if regras.get("grupo") else None
    campos = regras.get("campos", {})
    ocultos = regras.get("valores_ocultos", {})
    grupos = [(m.start(), m.group("nome").strip()) for m in grupo_re.finditer(texto)] if grupo_re else []
    achados = list(requisito_re.finditer(texto))

    rfs = {}
    for achado in achados:
        rf = achado.group("codigo").replace(" ", "")
        grupo = next((nome for inicio, nome in reversed(grupos) if inicio < achado.start()), "")
        dados = {"codigo": rf, "titulo": achado.group("titulo").strip(), "ancora": "", "grupo": grupo}
        # O corpo do requisito vai até o próximo título, de qualquer nível, ou até a linha horizontal.
        valores, atual = {}, None
        for linha in texto[achado.end():].split("\n")[1:]:
            if TITULO.match(linha) or linha.strip() == "---":
                break
            campo = CAMPO.match(linha)
            if campo:
                atual = campos.get(campo.group("campo").strip())
                if atual:
                    valores.setdefault(atual, []).append(campo.group("valor"))
            elif atual and linha.strip() and CONTINUACAO.match(linha):
                valores[atual].append(re.sub(r"^\s*(?:[-*]|\d+[.)])\s+", "", linha))
            elif not linha.strip() or linha.lstrip().startswith(">"):
                atual = None
        for chave, partes in valores.items():
            linhas = [l for parte in partes for l in limpar(parte)]
            if " ".join(linhas).strip() in ocultos.get(chave, []):
                continue
            if chave == "atores":
                linhas = [a.strip() for l in linhas for a in re.split(r"[,;]", l) if a.strip()]
            dados[chave] = (linhas[0] if linhas else "") if chave == "core" else linhas
        dados["core"] = str(dados.get("core", "")).strip().lower().startswith("sim")
        rfs.setdefault(rf, dados)
    return rfs


SECAO = re.compile(r"^\s*\*\*(?P<campo>[^*]+?):?\*\*\s*$")
ITEM = re.compile(r"^(?P<recuo>\s*)(?:[-*]|\d+[.)])\s+(?P<texto>.*)$")
LETRA = re.compile(r"^[a-z][.)]\s+")


def ler_markdown_secoes(texto, regras, limpar):
    requisito_re = re.compile(regras["requisito"], re.M)
    grupo_re = re.compile(regras["grupo"], re.M) if regras.get("grupo") else None
    campos = regras.get("campos", {})
    ocultos = regras.get("valores_ocultos", {})
    grupos = [(m.start(), m.group("nome").strip()) for m in grupo_re.finditer(texto)] if grupo_re else []

    rfs = {}
    for achado in requisito_re.finditer(texto):
        rf = achado.group("codigo").replace(" ", "")
        grupo = next((nome for inicio, nome in reversed(grupos) if inicio < achado.start()), "")
        dados = {"codigo": rf, "titulo": achado.group("titulo").strip(), "ancora": "", "grupo": grupo}
        # O corpo vai até o próximo título, de qualquer nível, ou até a linha horizontal. Cada linha é um item;
        # o subitem recuado (a), b)…) se junta ao item de cima.
        valores, atual, subitens = {}, None, False
        for linha in texto[achado.end():].split("\n")[1:]:
            if TITULO.match(linha) or linha.strip() == "---":
                break
            secao = SECAO.match(linha)
            if secao:
                atual = campos.get(secao.group("campo").strip())
                if atual:
                    valores.setdefault(atual, [])
                continue
            if not atual or not linha.strip():
                continue
            item = ITEM.match(linha)
            if item and item.group("recuo") and valores[atual]:
                sub = LETRA.sub("", item.group("texto").strip())
                valores[atual][-1] += ("; " if subitens else ": ") + sub
                subitens = True
                continue
            subitens = False
            valores[atual].append(item.group("texto") if item else linha.strip())
        for chave, partes in valores.items():
            linhas = [l for parte in partes for l in limpar(parte)]
            if not linhas or " ".join(linhas).strip() in ocultos.get(chave, []):
                continue
            if chave == "atores":
                linhas = [a.strip() for l in linhas for a in re.split(r",|;|\s+e\s+", l) if a.strip()]
            dados[chave] = (linhas[0] if linhas else "") if chave == "core" else linhas
        dados["core"] = str(dados.get("core", "")).strip().lower().startswith("sim")
        rfs.setdefault(rf, dados)
    return rfs


# Um formato novo de documento entra aqui, com a mesma assinatura e o mesmo dicionário de saída.
LEITORES = {"markdown-headings": ler_markdown_headings, "markdown-details": ler_markdown_details,
            "markdown-secoes": ler_markdown_secoes}


def extrair(caminho_do_documento, config=None):
    config = config or projeto.configuracao()
    regras = config["requisitos"]
    leitor = LEITORES.get(regras.get("leitor", "markdown-headings"))
    if leitor is None:
        sys.exit(f'Leitor de requisitos desconhecido: {regras.get("leitor")}. Disponíveis: {", ".join(LEITORES)}')
    filtro = carregar_filtro(config)
    texto = open(caminho_do_documento, encoding="utf-8").read()
    rfs = leitor(texto, regras, limpador(filtro))

    matriz = status_da_matriz(projeto.no_projeto(regras["matriz"]) if regras.get("matriz") else None)
    for rf, dados in rfs.items():
        situacao = matriz.get(rf, {})
        dados["implementacao"] = situacao.get("implementacao", "")

    if filtro is not None:
        com_residuo = [rf for rf, dados in rfs.items() if any(
            filtro.RESIDUO.search(" ".join(v if isinstance(v, list) else [str(v)])) for v in dados.values())]
        if com_residuo:
            sys.exit("Referência interna que sobrou no texto de: " + ", ".join(com_residuo))
    return rfs


if __name__ == "__main__":
    origem, destino = sys.argv[1], sys.argv[2]
    rfs = extrair(projeto.no_projeto(origem))
    with open(destino, "w", encoding="utf-8") as saida:
        json.dump(rfs, saida, ensure_ascii=False, indent=1)
    print(f"{len(rfs)} requisito(s) extraído(s) de {origem}")
