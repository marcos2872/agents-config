"""Modelo lógico a partir dos requisitos: as entidades descritas nos documentos e a comparação com o que existe.

CÓPIA IDÊNTICA em er-diagram-generator/scripts/logico.py e uml-class-diagram-generator/scripts/logico.py. Cada skill
precisa funcionar sozinha (o instalar.sh do skill-kit copia uma skill por vez), por isso o arquivo vai nas duas. Mude
nas duas e confira com plugins/diagramas/conferir-copias.py.

As entidades vêm dos documentos de requisitos (por padrão docs/requisitos/modulo-*.md): cada título "### E – Nome"
é uma entidade; a tabela "| Campo | Tipo | Obrigatório | Descrição |" logo abaixo dá os campos. Entidade descrita só
em texto corrido entra sem campos. A leitura é refeita a cada build: não há o que envelhecer.

A ligação entre o documento e o que existe é curada à mão, na seção "entidades" do domains.json:

    "entidades": {
      "Fazenda": { "tabelas": ["farms"] },
      "Plantio e Cultura no Plantio": { "tabelas": ["plantings", "planting_crops"] },
      "Parceiro": { "planejado": true, "motivo": "fase 3 do contrato" }
    }

Cada skill compara pelo nome da tabela: a planta do banco, com as tabelas do catálogo; o diagrama de classes, com a
tabela que cada classe mapeia.

Campo a campo (opcional): o campos.json, ao lado do arquivo do mapeamento, liga cada campo do requisito à coluna. Os
nomes do documento estão no idioma do negócio e os do banco no do código, então a tradução é do modelo, feita uma vez e
gravada; o build só confere, sempre igual. Cada par guarda o carimbo da linha do requisito (carimbos.json, gravado pelo
--aceitar-campos): se a linha mudar, só aquele par volta para revisão.

    "Fazenda": {
      "nome": "farms.name",
      "status": {"derivado": "calculado das outorgas, nunca gravado"},
      "documento_pdf_id": {"planejado": "ainda sem coluna"}
    },
    "Preferências da Fazenda": {
      "fonte_agua": {"coluna": "farm_preferences.water_source", "ancora": "fonte_agua", "obrigatorio": false}
    }

Entidade em texto corrido não tem tabela de campos: os campos são os que o modelo leu no parágrafo, cada um com a
âncora (o próprio nome, se omitida) que o acha na seção da entidade.
"""
import glob
import json
import pathlib
import re

import fontes

PADRAO_REQUISITOS = ["docs/requisitos/modulo-*.md"]
TITULO_ENTIDADE = re.compile(r"^###\s+E\s*[–-]\s+(.+?)\s*$")
TITULO_MD = re.compile(r"^ {0,3}(#{1,6})\s")
TAG = re.compile(r"\s#[^\s#]\S*")
HIPOTESE = re.compile(r"\s#hip[oó]tese(?!\S)", re.IGNORECASE)
DIVISOR = re.compile(r"(?<!\\)\|")
SIM = {"✔", "✓", "sim", "s", "x", "obrigatório", "obrigatorio", "true"}
COLUNAS_IGNORADAS = ["id", "created_at", "updated_at", "deleted_at", "created_by", "updated_by", "xmin"]
CONFIG_DO_TEXTO = {"colunas_de_situacao": {"situação", "status"}}
_LINHAS = {}


def _celulas(linha):
    meio = linha.strip().strip("|")
    return [c.strip() for c in DIVISOR.split(meio)]


def _limpo(texto):
    return re.sub(r"\s+", " ", texto.replace("**", "").replace("`", "")).strip()


def ler_entidades(raiz, padroes=None):
    """As entidades dos documentos de requisitos, na ordem em que aparecem."""
    entidades = []
    arquivos = sorted({p for padrao in (padroes or PADRAO_REQUISITOS) for p in glob.glob(str(raiz / padrao))})
    for caminho in arquivos:
        rel = pathlib.Path(caminho).relative_to(raiz).as_posix()
        linhas = pathlib.Path(caminho).read_text(encoding="utf8").splitlines()
        _LINHAS[rel] = linhas
        for i, linha in enumerate(linhas):
            m = TITULO_ENTIDADE.match(linha)
            if not m:
                continue
            nome = _limpo(TAG.sub("", m.group(1)))
            fim = next((j for j in range(i + 1, len(linhas))
                        if TITULO_MD.match(linhas[j]) and len(TITULO_MD.match(linhas[j]).group(1)) <= 3), len(linhas))
            entidades.append({"nome": nome, "arquivo": rel, "linha": i + 1, "fim": fim,
                              "modulo": pathlib.Path(rel).stem, "campos": _campos(linhas, i + 1, fim),
                              "descricao": _descricao(linhas, i + 1, fim),
                              "hipotese": bool(HIPOTESE.search(m.group(1)))})
    return entidades


def _descricao(linhas, inicio, fim):
    """O primeiro parágrafo em prosa logo abaixo do título da entidade, se houver: o que ela é para o negócio. Seção
    que abre com a tabela de campos, um rótulo em negrito (**Campos**), código (um esboço `{ … }` ou a lista de
    campos em `crase`), uma lista ou um bloco de código não tem descrição. O texto volta numa linha só, com o Markdown em linha (a página o interpreta)."""
    i = inicio
    while i < fim and not linhas[i].strip():
        i += 1
    par = []
    while i < fim and linhas[i].strip():
        par.append(linhas[i].strip())
        i += 1
    if not par or re.match(r"(\||\*\*[^*]+\*\*\s*:?\s*$|`|\{|[-*+] |\d+\. |~~~|>|<|!\[)", par[0]):
        return None
    return re.sub(r"\s+", " ", " ".join(par)).strip() or None


def _campos(linhas, inicio, fim):
    """Os campos da primeira tabela com colunas Campo e Tipo; sem ela, nenhum (entidade em texto corrido)."""
    for i in range(inicio, fim):
        if not linhas[i].lstrip().startswith("|"):
            continue
        cab = [_limpo(c).lower() for c in _celulas(linhas[i])]
        if "campo" not in cab or "tipo" not in cab:
            continue
        col = {nome: cab.index(nome) for nome in ("campo", "tipo") }
        obrig = next((k for k, c in enumerate(cab) if c.startswith("obrigat")), None)
        desc = next((k for k, c in enumerate(cab) if c.startswith("descri")), None)
        campos = []
        for j in range(i + 2, fim):
            if not linhas[j].lstrip().startswith("|"):
                break
            v = _celulas(linhas[j])
            if len(v) <= max(col.values()):
                continue
            tipo = _limpo(v[col["tipo"]])
            fk = re.match(r"FK\s+(.+)$", tipo)
            campos.append({
                "nomes": [_limpo(n) for n in v[col["campo"]].split("/") if _limpo(n)],
                "tipo": tipo,
                "obrigatorio": None if obrig is None else (obrig < len(v) and _limpo(v[obrig]).lower() in SIM),
                "descricao": _limpo(v[desc]) if desc is not None and desc < len(v) else "",
                "referencia": _limpo(fk.group(1)) if fk else None,
                "linha": j + 1,
            })
        return campos
    return []


def ler_mapeamento(arquivo):
    """A seção "entidades" do domains.json, ou None se o arquivo não a tem."""
    if not arquivo or not pathlib.Path(arquivo).exists():
        return None
    return json.loads(pathlib.Path(arquivo).read_text(encoding="utf8")).get("entidades")


def comparar(entidades, mapeamento, existentes, ignorar=()):
    """Compara o que os requisitos descrevem com as tabelas que existem.

    existentes: as tabelas que existem (no banco, ou mapeadas por alguma classe). Devolve um dicionário com:
    - ok: [(entidade, tabelas)] mapeadas para tabelas que existem;
    - planejado: [entidade] marcadas como planejadas no mapeamento;
    - sem_mapeamento: [entidade] que o mapeamento ainda não cobre;
    - tabela_inexistente: [(entidade, tabela)] mapeadas para tabela que não existe;
    - fora: [tabela] que existem e nenhuma entidade dos requisitos cobre (fora dos requisitos);
    - orfas: [nome] no mapeamento sem entidade nos documentos;
    - erros: problemas de formato no mapeamento.
    """
    r = {"ok": [], "planejado": [], "sem_mapeamento": [], "tabela_inexistente": [], "fora": [], "orfas": [], "erros": []}
    nomes = {}
    for e in entidades:
        if e["nome"] in nomes:
            r["erros"].append(f"entidade repetida nos requisitos: {e['nome']} ({nomes[e['nome']]['arquivo']} e "
                              f"{e['arquivo']}); no mapeamento, use \"{e['nome']} ({e['modulo']})\" para a segunda")
            e["nome"] = f"{e['nome']} ({e['modulo']})"
        nomes[e["nome"]] = e
    cobertas = set()
    for e in entidades:
        m = mapeamento.get(e["nome"])
        if m is None:
            r["sem_mapeamento"].append(e)
            continue
        if not isinstance(m, dict):
            r["erros"].append(f"entidades[\"{e['nome']}\"] deve ser um objeto com tabelas ou planejado")
            continue
        tabelas = m.get("tabelas", [])
        if m.get("planejado") and tabelas:
            r["erros"].append(f"entidades[\"{e['nome']}\"]: planejado e tabelas ao mesmo tempo")
        if m.get("planejado"):
            r["planejado"].append(e)
            continue
        if not tabelas:
            r["erros"].append(f"entidades[\"{e['nome']}\"]: sem tabelas; se ainda não existe, marque \"planejado\": true")
            continue
        faltam = [t for t in tabelas if t not in existentes]
        r["tabela_inexistente"] += [(e, t) for t in faltam]
        if len(faltam) < len(tabelas):
            r["ok"].append((e, [t for t in tabelas if t in existentes]))
        cobertas.update(tabelas)
    r["mapa"] = mapeamento
    r["orfas"] = sorted(k for k in mapeamento if k not in nomes)
    r["fora"] = sorted(t for t in existentes if t not in cobertas and t not in set(ignorar))
    return r


def relatorio(r, rotulo):
    """O texto do --divergencias, igual nas duas skills."""
    linhas = []

    def bloco(titulo, itens):
        if itens:
            linhas.append(f"  {titulo}: {len(itens)}")
            linhas.extend(f"    - {x}" for x in itens)

    def h(e):
        return ", hipótese do contexto: confirme no comitê" if e.get("hipotese") else ""

    bloco("planejado (nos requisitos, ainda sem " + rotulo + ")",
          [f"{e['nome']} ({e['modulo']}{h(e)})" for e in r["planejado"]])
    bloco("fora dos requisitos (" + rotulo + " sem entidade nos requisitos)", r["fora"])
    bloco("mapeada para " + rotulo + " que não existe", [f"{e['nome']} → {t}" for e, t in r["tabela_inexistente"]])
    bloco("sem mapeamento (ligue em domains.json, seção entidades)",
          [f"{e['nome']} ({e['modulo']}{h(e)}){'' if e['campos'] else ', em texto corrido'}" for e in r["sem_mapeamento"]])
    bloco("no mapeamento sem entidade nos requisitos", r["orfas"])
    bloco("erros no mapeamento", r["erros"])
    total = len(r["ok"]) + len(r["planejado"]) + len(r["sem_mapeamento"])
    linhas.insert(0, f"  entidades nos requisitos: {total} · ligadas: {len(r['ok'])} · planejadas: {len(r['planejado'])}"
                     f" · sem mapeamento: {len(r['sem_mapeamento'])}")
    return "\n".join(linhas)


def dados_da_pagina(r, rc=None):
    """O que a página mostra: as entidades de cada tabela, as planejadas e as tabelas fora dos requisitos; com o
    campo a campo, os campos de cada entidade com a coluna e a situação, e as colunas fora dos requisitos."""
    def entidade(e):
        d = {"nome": e["nome"], "modulo": e["modulo"], "arquivo": e["arquivo"], "linha": e["linha"],
             "campos": [{"n": " / ".join(c["nomes"]), "t": c["tipo"], "o": bool(c["obrigatorio"])} for c in e["campos"]]}
        if rc and e["nome"] in rc["entidades"]:
            d["campos"] = rc["entidades"][e["nome"]]
        if e.get("hipotese"):
            d["h"] = True
        if e.get("descricao"):
            d["descricao"] = e["descricao"]
        motivo = (r["mapa"].get(e["nome"]) or {}).get("motivo")
        if motivo:
            d["motivo"] = motivo
        return d
    por_tabela = {}
    for e, tabelas in r["ok"]:
        for t in tabelas:
            por_tabela.setdefault(t, []).append(entidade(e))
    dados = {"porTabela": por_tabela, "planejadas": [entidade(e) for e in r["planejado"]], "fora": r["fora"],
             "ligadas": len(r["ok"]), "semMapa": len(r["sem_mapeamento"])}
    if rc:
        dados["colsFora"] = rc["fora"]
        dados["contagem"] = rc["contagem"]
    return dados



# ── Campo a campo ──

SITUACOES = {
    "ok": "confere",
    "div": "obrigatoriedade diferente",
    "tam": "tamanho diferente",
    "inex": "coluna inexistente",
    "nc": "não conferido",
    "plan": "planejado",
    "der": "derivado, não gravado",
    "duv": "dúvida",
    "sem": "sem tradução",
}


def arquivos_dos_campos(arquivo_do_mapeamento):
    """O campos.json (pares) e o carimbos.json (carimbos dos pares), na pasta do arquivo do mapeamento."""
    pasta = pathlib.Path(arquivo_do_mapeamento).parent
    return pasta / "campos.json", pasta / "carimbos.json"


def ler_json(arquivo):
    return json.loads(pathlib.Path(arquivo).read_text(encoding="utf8")) if pathlib.Path(arquivo).exists() else None


def _tamanho(tipo):
    m = re.search(r"\((\d+)", tipo or "")
    return int(m.group(1)) if m else None


def _tipo_do_nome(doc, nome):
    """Numa linha com vários nomes ("municipio / uf / cod_ibge"), o tipo de mesma posição, se os tipos vierem
    separados do mesmo jeito; senão, o tipo da linha inteira."""
    tipos = [t.strip() for t in doc["tipo"].split(" / ")]
    if len(doc["nomes"]) > 1 and len(tipos) == len(doc["nomes"]):
        return tipos[doc["nomes"].index(nome)]
    return doc["tipo"]


def _origem(e, nome, valor):
    """Onde o campo está no requisito: (linha, texto do carimbo, problema). Tabela: a linha do campo; texto corrido: a
    unidade com a âncora dentro da seção da entidade."""
    linhas = _LINHAS[e["arquivo"]]
    if e["campos"]:
        campo = next((c for c in e["campos"] if nome in c["nomes"]), None)
        if campo is None:
            return None, None, "não está na tabela de campos do requisito"
        texto, _ = fontes.item_de_tabela(linhas, campo["linha"] - 1, CONFIG_DO_TEXTO)
        return campo["linha"], fontes.para_carimbo(texto), None
    ancora = fontes.normalizar((valor.get("ancora") if isinstance(valor, dict) else None) or nome)
    achada = fontes.achar_ancora(linhas, e["linha"], e["fim"], ancora, CONFIG_DO_TEXTO)
    if not achada:
        return None, None, f"âncora não encontrada na seção da entidade: {ancora}"
    return achada[0] + 1, achada[1], None


def _colunas_do_par(valor, tabelas_da_entidade):
    """As colunas ("tabela.coluna") de um par, ou (None, erro)."""
    alvo = valor.get("coluna") if isinstance(valor, dict) else valor
    alvos = alvo if isinstance(alvo, list) else [alvo]
    saida = []
    for a in alvos:
        if not isinstance(a, str) or not a:
            return None, "coluna vazia"
        if "." in a:
            saida.append(tuple(a.split(".", 1)))
        elif len(tabelas_da_entidade) == 1:
            saida.append((tabelas_da_entidade[0], a))
        else:
            return None, f"indique a tabela: {a} está em qual de {', '.join(tabelas_da_entidade)}? (tabela.coluna)"
    return saida, None


def comparar_campos(r, pares, colunas, carimbos=None, ignoradas=None, rotulo="banco"):
    """Compara os campos dos requisitos com as colunas, pelos pares do campos.json.

    r: o resultado de comparar(); pares: o campos.json; colunas: {tabela: {coluna: {"nn", "tam", "df", "pk"}}} (a
    tabela com "_parcial" não acusa coluna inexistente: só "não conferido"); carimbos: o carimbos.json.
    Devolve {"entidades": {nome: [campo da página]}, "fora": {tabela: [colunas]}, "atuais": {nome: {campo: carimbo}},
    "erros": [...], "contagem": {situação: n}}.
    """
    carimbos = carimbos or {}
    ignoradas = set(COLUNAS_IGNORADAS if ignoradas is None else ignoradas)
    rc = {"entidades": {}, "fora": {}, "atuais": {}, "erros": [], "contagem": {}}
    usadas = {}
    traduzidas_por_tabela = {}
    for e, tabelas in r["ok"]:
        meus = pares.get(e["nome"])
        for t in tabelas:
            traduzidas_por_tabela.setdefault(t, []).append(meus is not None)
        campos = []
        if meus is None:
            if e["campos"]:
                campos = [{"n": " / ".join(c["nomes"]), "t": c["tipo"], "o": bool(c["obrigatorio"]), "s": "sem"}
                          for c in e["campos"]]
            rc["entidades"][e["nome"]] = campos
            for c in campos:
                rc["contagem"]["sem"] = rc["contagem"].get("sem", 0) + 1
            continue
        if not isinstance(meus, dict):
            rc["erros"].append(f"campos.json[\"{e['nome']}\"] deve ser um objeto {{campo: par}}")
            continue
        nomes_do_doc = [n for c in e["campos"] for n in c["nomes"]]
        for nome in nomes_do_doc + [k for k in meus if k not in nomes_do_doc]:
            valor = meus.get(nome)
            doc = next((c for c in e["campos"] if nome in c["nomes"]), None)
            campo = {"n": nome, "t": _tipo_do_nome(doc, nome) if doc else (valor or {}).get("tipo", "") if isinstance(valor, dict) else "",
                     "o": bool(doc["obrigatorio"]) if doc else (valor.get("obrigatorio") if isinstance(valor, dict) else None)}
            obrig = doc["obrigatorio"] if doc else (valor.get("obrigatorio") if isinstance(valor, dict) else None)
            if isinstance(valor, dict) and valor.get("obrigatoriedade"):
                obrig = None  # o par explica por que não se compara (ex.: tabela à parte, a linha só existe com o dado)
            if valor is None:
                campo["s"] = "sem"
            else:
                linha, texto, problema = _origem(e, nome, valor)
                if problema:
                    rc["erros"].append(f"campos.json[\"{e['nome']}\"][\"{nome}\"]: {problema}")
                    continue
                campo["l"] = linha
                atual = fontes.carimbo(texto)
                rc["atuais"].setdefault(e["nome"], {})[nome] = atual
                gravado = (carimbos.get(e["nome"]) or {}).get(nome)
                if gravado is None:
                    campo["k"] = "novo"
                elif gravado != atual:
                    campo["k"] = "mudou"
                _situacao(campo, valor, obrig, e, tabelas, colunas, usadas, rotulo)
            campos.append(campo)
            rc["contagem"][campo["s"]] = rc["contagem"].get(campo["s"], 0) + 1
            if campo.get("k"):
                rc["contagem"][campo["k"]] = rc["contagem"].get(campo["k"], 0) + 1
        rc["entidades"][e["nome"]] = campos
    for t, flags in traduzidas_por_tabela.items():
        if t in colunas and all(flags) and not colunas[t].get("_parcial"):
            sobra = sorted(c for c in colunas[t] if not c.startswith("_") and c not in ignoradas
                           and c not in usadas.get(t, set()))
            if sobra:
                rc["fora"][t] = sobra
    rc["contagem"]["fora"] = sum(len(v) for v in rc["fora"].values())
    rc["orfas"] = sorted(k for k in pares if k not in {e["nome"] for e, _ in r["ok"]})
    return rc


def _situacao(campo, valor, obrig, e, tabelas, colunas, usadas, rotulo):
    if isinstance(valor, dict) and not valor.get("coluna"):
        for chave, s in (("planejado", "plan"), ("derivado", "der"), ("duvida", "duv")):
            if chave in valor:
                campo["s"] = s
                if isinstance(valor[chave], str):
                    campo["m"] = valor[chave]
                return
        campo["s"] = "duv"
        campo["m"] = "par sem coluna, planejado, derivado ou duvida"
        return
    alvos, erro = _colunas_do_par(valor, tabelas)
    if erro:
        campo["s"] = "duv"
        campo["m"] = erro
        return
    campo["c"] = [f"{t}.{c}" if len(tabelas) > 1 or t not in tabelas else c for t, c in alvos]
    notas, situacao = [], "ok"
    for t, c in alvos:
        usadas.setdefault(t, set()).add(c)
        col = (colunas.get(t) or {}).get(c)
        if col is None:
            if t in colunas and not colunas[t].get("_parcial"):
                situacao = "inex"
                notas.append(f"{t}.{c} não existe")
            elif situacao == "ok":
                situacao = "nc"
                notas.append(f"{t}.{c} não lida do {rotulo}")
            continue
        if obrig is True and not col.get("nn") and situacao in ("ok", "tam"):
            situacao = "div"
            notas.append(f"obrigatório no requisito, opcional no {rotulo}")
        elif obrig is False and col.get("nn") and not col.get("df") and not col.get("pk") and situacao in ("ok", "tam"):
            situacao = "div"
            notas.append(f"opcional no requisito, obrigatório no {rotulo}")
        tam_doc = _tamanho(campo["t"])
        if tam_doc and col.get("tam") and tam_doc != col["tam"]:
            if situacao == "ok":
                situacao = "tam"
            notas.append(f"tamanho {tam_doc} no requisito, {col['tam']} no {rotulo}")
    campo["s"] = situacao
    if notas:
        campo["m"] = "; ".join(notas)


def relatorio_campos(rc):
    """O bloco campo a campo do --divergencias."""
    linhas = []
    ct = rc["contagem"]
    linhas.append("  campo a campo (campos.json): " + " · ".join(
        f"{SITUACOES.get(k, k)}: {ct[k]}" for k in ("ok", "div", "tam", "inex", "nc", "plan", "der", "duv", "sem")
        if ct.get(k)) + (f" · colunas fora dos requisitos: {ct['fora']}" if ct.get("fora") else ""))

    def bloco(titulo, itens):
        if itens:
            linhas.append(f"  {titulo}: {len(itens)}")
            linhas.extend(f"    - {x}" for x in itens)

    def com(s=None, k=None):
        return [f"{nome}.{c['n']}" + (f" → {', '.join(c['c'])}" if c.get("c") else "") + (f": {c['m']}" if c.get("m") else "")
                for nome, campos in rc["entidades"].items() for c in campos
                if (s is None or c.get("s") == s) and (k is None or c.get("k") == k)]

    bloco("obrigatoriedade diferente", sorted(com("div"), key=lambda x: "opcional no requisito" in x))
    bloco("coluna inexistente (corrija o par)", com("inex"))
    bloco("o requisito mudou (revise o par e rode --aceitar-campos)", com(k="mudou"))
    novos = {}
    for nome, campos in rc["entidades"].items():
        n = sum(1 for c in campos if c.get("k") == "novo")
        if n:
            novos[nome] = n
    bloco("pares sem carimbo (confira e rode --aceitar-campos)", [f"{nome}: {n}" for nome, n in novos.items()])
    bloco("tamanho diferente (aviso)", com("tam"))
    bloco("dúvida", com("duv"))
    bloco("planejado (no requisito, sem coluna)", com("plan"))
    bloco("colunas fora dos requisitos", [f"{t}: {', '.join(cs)}" for t, cs in rc["fora"].items()])
    sem = [nome for nome, campos in rc["entidades"].items() if any(c.get("s") == "sem" for c in campos)]
    sem_campos = [nome for nome, campos in rc["entidades"].items() if not campos]
    bloco("entidades com campos sem tradução (veja --campos-pendentes)", sem)
    bloco("entidades em texto corrido ainda sem campos (veja --campos-pendentes)", sem_campos)
    bloco("no campos.json sem entidade ligada", rc["orfas"])
    bloco("erros no campos.json", rc["erros"])
    return "\n".join(linhas)


def pendentes(r, rc, colunas, nomes=None):
    """O que o modelo precisa para traduzir: por entidade ligada com algo pendente, os campos do requisito (ou o texto
    da seção, se em texto corrido), as colunas das tabelas e os pares que já existem com problema."""
    saida = []
    for e, tabelas in r["ok"]:
        campos = rc["entidades"].get(e["nome"], [])
        problemas = [c for c in campos if c.get("s") in ("sem", "inex", "duv") or c.get("k") == "mudou"]
        if nomes and e["nome"] not in nomes:
            continue
        if not nomes and campos and not problemas:
            continue
        saida.append(f"## {e['nome']}  ({e['arquivo']}:{e['linha']})")
        linhas = _LINHAS[e["arquivo"]]
        if e["campos"]:
            saida.append("campos do requisito:")
            saida.extend(f"  {c['linha']}: " + linhas[c["linha"] - 1].strip() for c in e["campos"])
        else:
            saida.append("texto corrido (os campos são os que você ler aqui; cada um com a âncora que o acha):")
            saida.extend(f"  {i + 1}: {linhas[i]}" for i in range(e["linha"], e["fim"]) if linhas[i].strip())
        for t in tabelas:
            cols = colunas.get(t) or {}
            saida.append(f"colunas de {t}:" + ("" if cols else " (não lidas)"))
            saida.extend(f"  {c}  {v.get('ty') or ''}{'' if v.get('nn') else ' null'}{' default' if v.get('df') else ''}"
                         for c, v in cols.items() if not c.startswith("_"))
        if problemas:
            saida.append("pares com problema:")
            saida.extend(f"  {c['n']}: {SITUACOES[c['s']]}" + (f" ({c['m']})" if c.get("m") else "")
                         + (" · o requisito mudou" if c.get("k") == "mudou" else "") for c in problemas)
        saida.append("")
    return "\n".join(saida) if saida else "nada pendente: todos os campos das entidades ligadas têm par"


def gravar_carimbos_campos(arquivo, atuais, nomes=None):
    """Grava o carimbo atual dos pares (todos, ou só das entidades em nomes). Devolve quantos pares gravou."""
    dados = ler_json(arquivo) or {}
    n = 0
    for nome, campos in atuais.items():
        if nomes and nome not in nomes:
            continue
        dados[nome] = dict(sorted(campos.items()))
        n += len(campos)
    pathlib.Path(arquivo).write_text(json.dumps(dict(sorted(dados.items())), ensure_ascii=False, indent=2) + "\n",
                                     encoding="utf8")
    return n
