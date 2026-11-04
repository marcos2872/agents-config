"""
Domínio de cada tag do Swagger e de cada schema, lido do código-fonte Java em vez de adivinhado pelo nome.

Vale para o módulo Spring que organiza as classes em subpacotes por domínio (`controller/<domínio>/`,
`dto/<domínio>/`, `model/<domínio>/`...). Os domínios são os subpacotes de `controller/`. A tag de um endpoint é a
`@Tag(name = ...)` do controller; o schema é a classe (ou o `@Schema(name = ...)`) de mesmo nome. O subpacote onde
cada uma está diz o domínio.
"""
import os
import re
from collections import Counter

PASTAS_DE_CONTROLLER = ("controller", "controllers")

_TAG = re.compile(r'@Tag\(\s*name\s*=\s*"([^"]+)"')
_TIPO = re.compile(r'\b(?:class|record|enum|interface)\s+([A-Z]\w*)')
_SCHEMA = re.compile(r'@Schema\(\s*name\s*=\s*"(\w+)"')
_PREFIXOS = re.compile(r'^(PagingDTO|Page|Slice|List|Set|Map)(?=[A-Z])')
_SUFIXOS = re.compile(r'(DTO|Dto|Request|Response)$')


def _arquivos_java(raiz):
    for pasta, _, nomes in os.walk(raiz):
        for nome in sorted(nomes):
            if nome.endswith(".java"):
                caminho = os.path.join(pasta, nome)
                with open(caminho, encoding="utf-8", errors="replace") as f:
                    yield os.path.relpath(caminho, raiz), f.read()


def _dominio_do_controller(relativo):
    """O subpacote logo abaixo de controller/; nulo para o controller fora de subpacote."""
    partes = relativo.split(os.sep)
    for i, parte in enumerate(partes[:-2]):
        if parte in PASTAS_DE_CONTROLLER:
            return partes[i + 1]
    return None


def dominios(raiz):
    """Os domínios do módulo: os subpacotes de controller/ que têm controller."""
    return sorted({d for relativo, _ in _arquivos_java(raiz) if (d := _dominio_do_controller(relativo))})


def dominio_das_tags(raiz, ordem=()):
    """{tag: domínio}. Uma tag em controllers de mais de um domínio fica onde está a maioria deles; no empate,
    no que vem antes em `ordem` (e, fora dela, no primeiro em ordem alfabética)."""
    votos = {}
    for relativo, texto in _arquivos_java(raiz):
        dominio = _dominio_do_controller(relativo)
        tag = _TAG.search(texto)
        if dominio and tag:
            votos.setdefault(tag.group(1), Counter())[dominio] += 1
    posicao = {d: i for i, d in enumerate(ordem)}
    return {tag: min(c, key=lambda d: (-c[d], posicao.get(d, len(posicao)), d)) for tag, c in votos.items()}


def dominio_dos_tipos(raiz, dominios_do_modulo):
    """{nome da classe ou do @Schema: domínio}, pelo subpacote do arquivo onde o tipo é declarado."""
    conhecidos = set(dominios_do_modulo)
    tipos = {}
    for relativo, texto in _arquivos_java(raiz):
        dominio = next((p for p in relativo.split(os.sep)[:-1] if p in conhecidos), None)
        if not dominio:
            continue
        for padrao in (_SCHEMA, _TIPO):
            for m in padrao.finditer(texto):
                tipos.setdefault(m.group(1), dominio)
    return tipos


def dominio_do_schema(nome, tipos):
    """O domínio do schema pelo nome exato; depois sem o envelope (Page..., ...DTO). Nulo se não achar."""
    sem_prefixo = _PREFIXOS.sub("", nome)
    for candidato in (nome, sem_prefixo, _SUFIXOS.sub("", nome), _SUFIXOS.sub("", sem_prefixo)):
        if candidato in tipos:
            return tipos[candidato]
    return None


def ordem_dos_dominios(encontrados, *preferencias):
    """Os domínios encontrados na ordem das preferências (títulos do projeto, depois os do script); o resto, em
    ordem alfabética."""
    ordem = []
    for lista in preferencias:
        ordem += [d for d in lista if d in encontrados and d not in ordem]
    return ordem + sorted(d for d in encontrados if d not in ordem)
