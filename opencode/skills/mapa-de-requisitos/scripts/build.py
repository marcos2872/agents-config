#!/usr/bin/env python3
"""
Gera o mapa de requisitos de um módulo: um único HTML, sem dependência externa, que abre direto no navegador.

Junta três fontes, todas do projeto (em `.agents/mapa-de-requisitos/`, ver projeto.py):
  - o fluxo (fluxos/<módulo>.json): as fases e as etapas da jornada, a raia de cada uma, os marcadores ligados aos RFs
    e, em `fora_da_jornada`, os RFs que ficam só na aba Requisitos, com o motivo;
  - as capturas (capturas/<módulo>/capturas.json e as imagens): a tela de cada etapa e a caixa de cada marcador;
  - os requisitos, extraídos do documento do módulo por extrair_rfs.py, no formato que config.json descreve.

Falha quando um marcador cita RF que não existe no módulo, e quando um RF do módulo não está nem na jornada nem em
`fora_da_jornada` — o RF novo de um comitê pede uma decisão: entra numa tela ou fica só na lista.

Uso (de qualquer pasta do repositório):
  build.py modulo-a                                  # monta o HTML com as capturas que já existem
  build.py modulo-a --capturar                       # fotografa as telas de novo (o sistema precisa estar no ar)
  build.py modulo-a --capturar --etapas a,b          # refaz só essas telas
  build.py modulo-c --novo --fonte docs/requisitos/modulo-c-financeiro.md   # cria o esqueleto do fluxo de um módulo
  build.py --iniciar                                 # cria a configuração do projeto a partir do modelo
"""
import argparse
import base64
import json
import os
import shutil
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

import projeto  # noqa: E402
from extrair_rfs import extrair  # noqa: E402

AINDA_NAO = "Ainda não ilustrado na jornada"
CORES_DAS_RAIAS = ["#1f6feb", "#1e7f4f", "#8250df", "#b35900", "#c2185b"]


def caminho_do_fluxo(modulo):
    return os.path.join(projeto.dados(), "fluxos", f"{modulo}.json")


def pasta_das_capturas(modulo):
    return os.path.join(projeto.dados(), "capturas", modulo)


def raias_do(fluxo, config):
    raias = fluxo.get("raias") or config.get("raias") or []
    return [{"id": raia["id"], "nome": raia["nome"], "cor": raia.get("cor") or CORES_DAS_RAIAS[i % len(CORES_DAS_RAIAS)]}
            for i, raia in enumerate(raias)]


def montar(modulo):
    config = projeto.configuracao()
    arquivo_do_fluxo = caminho_do_fluxo(modulo)
    if not os.path.exists(arquivo_do_fluxo):
        sys.exit(f"Sem fluxo em {arquivo_do_fluxo}. Para um módulo novo: build.py {modulo} --novo --fonte <documento>")
    fluxo = json.load(open(arquivo_do_fluxo, encoding="utf-8"))
    capturas_dir = pasta_das_capturas(modulo)
    indice = os.path.join(capturas_dir, "capturas.json")
    janela = config.get("janela", {})
    capturas = json.load(open(indice, encoding="utf-8")) if os.path.exists(indice) else {
        "janela": {"width": janela.get("largura", 1440), "height": janela.get("altura", 900)}, "etapas": {}}
    rfs = extrair(projeto.no_projeto(fluxo["fonte"]), config)

    # O que não vai ao cliente sai da página inteira, também da aba Requisitos — e o motivo fica no fluxo.
    omitidos = {rf for codigos in fluxo.get("fora_do_mapa", {}).values() for rf in codigos}
    inexistentes = sorted(omitidos - set(rfs))
    if inexistentes:
        sys.exit("fora_do_mapa cita RF que não existe no módulo: " + ", ".join(inexistentes))
    for rf in omitidos:
        del rfs[rf]

    grupos = fluxo.get("grupos", {})
    for rf in rfs.values():
        rf["grupo"] = grupos.get(rf.get("grupo", ""), rf.get("grupo", ""))

    fora = fluxo.get("fora_da_jornada", {})
    motivo_de = {rf: motivo for motivo, codigos in fora.items() for rf in codigos}

    desconhecidos, ausentes = [], []
    etapas = []
    for etapa in fluxo.get("etapas", []):
        captura = capturas["etapas"].get(etapa["id"])
        if captura is None:
            sys.exit(f'A etapa "{etapa["id"]}" não tem captura; rode o build com --capturar.')
        with open(os.path.join(capturas_dir, captura["imagem"]), "rb") as imagem:
            dados = base64.b64encode(imagem.read()).decode()
        ausentes += [f'{etapa["id"]}: "{etapa["marcadores"][i].get("texto") or etapa["marcadores"][i].get("seletor")}"'
                     for i in captura.get("marcadoresAusentes", []) if i < len(etapa["marcadores"])]
        marcadores = []
        for marcador, caixa in zip(etapa["marcadores"], captura["marcadores"]):
            desconhecidos += [f'{etapa["id"]}: {rf}' for rf in marcador["rfs"] if rf not in rfs]
            marcadores.append({"rotulo": marcador["rotulo"], "rfs": marcador["rfs"], "caixa": caixa})
        etapas.append({
            "id": etapa["id"],
            "fase": etapa.get("fase", ""),
            "raia": etapa["raia"],
            "titulo": etapa["titulo"],
            "resumo": etapa["resumo"],
            "imagem": "data:image/jpeg;base64," + dados,
            "marcadores": marcadores,
        })
    if desconhecidos:
        sys.exit("Marcadores com RF que não existe no módulo:\n  " + "\n  ".join(desconhecidos))
    if ausentes:
        sys.exit("Marcadores cujo elemento não existe na tela (a tela mudou; ajuste o texto ou o seletor no fluxo e "
                 "capture de novo):\n  " + "\n  ".join(ausentes))

    citados = {rf for etapa in etapas for marcador in etapa["marcadores"] for rf in marcador["rfs"]}
    sem_decisao = [rf for rf in rfs if rf not in citados and rf not in motivo_de]
    if sem_decisao:
        sys.exit("RF(s) do módulo fora da jornada e sem motivo em fora_da_jornada — ponha cada um num marcador ou "
                 "num dos motivos:\n  " + "\n  ".join(f"{rf}  {rfs[rf]['titulo']}" for rf in sem_decisao))
    nos_dois = sorted(citados & set(motivo_de))
    if nos_dois:
        sys.exit("RF(s) na jornada e também em fora_da_jornada: " + ", ".join(nos_dois))
    inexistentes = sorted(set(motivo_de) - set(rfs))
    if inexistentes:
        sys.exit("fora_da_jornada cita RF que não existe no módulo: " + ", ".join(inexistentes))
    for rf, motivo in motivo_de.items():
        rfs[rf]["fora"] = motivo

    rotulo = config.get("rotulo", "Mapa de requisitos")
    dados = {
        "rotulo": rotulo,
        "marca": config.get("marca", "#1f6feb"),
        "modulo": fluxo["modulo"],
        "titulo": fluxo["titulo"],
        "descricao": fluxo["descricao"],
        "janela": capturas["janela"],
        "raias": raias_do(fluxo, config),
        "fases": fluxo.get("fases", []),
        "etapas": etapas,
        "rfs": rfs,
    }
    modelo = open(os.path.join(AQUI, "modelo.html"), encoding="utf-8").read()
    pagina = (modelo
              .replace("__TITULO__", f'{rotulo} — {fluxo["modulo"]}')
              .replace("__DADOS__", json.dumps(dados, ensure_ascii=False).replace("</", "<\\/")))
    saida = projeto.no_projeto(fluxo["saida"])
    os.makedirs(os.path.dirname(saida), exist_ok=True)
    with open(saida, "w", encoding="utf-8") as arquivo:
        arquivo.write(pagina)

    sem_lugar = [etapa["id"] for etapa in etapas for marcador in etapa["marcadores"] if marcador["caixa"] is None]
    print(f'{os.path.relpath(saida, projeto.raiz())}: {len(etapas)} etapa(s), {len(citados)} de {len(rfs)} RF(s) na '
          f'jornada, {os.path.getsize(saida) / 1024 / 1024:.1f} MB')
    if sem_lugar:
        print("Marcadores sem lugar na tela (aparecem só na lista):", ", ".join(sem_lugar))


def capturar(modulo, etapas=None):
    ambiente = dict(os.environ)
    if etapas:
        ambiente["MAPA_ETAPAS"] = etapas
    ambiente["MAPA_NODE"] = projeto.pasta_do_node(AQUI)
    concluiu = subprocess.run(["node", os.path.join(AQUI, "capturar.mjs"), caminho_do_fluxo(modulo),
                               pasta_das_capturas(modulo), projeto.arquivo_de_configuracao()], env=ambiente)
    if concluiu.returncode != 0:
        sys.exit(f"A captura de {modulo} falhou; veja os erros acima.")


def novo(modulo, fonte, modulo_nome=None):
    """O esqueleto do fluxo de um módulo: sem etapas, com todos os RFs à espera de uma tela."""
    destino = caminho_do_fluxo(modulo)
    if os.path.exists(destino):
        sys.exit(f"{destino} já existe; o esqueleto só é criado para módulo novo.")
    config = projeto.configuracao()
    if not os.path.exists(projeto.no_projeto(fonte)):
        sys.exit(f"O documento de requisitos {fonte} não existe.")
    rfs = extrair(projeto.no_projeto(fonte), config)
    grupos = {}
    for rf in rfs.values():
        if rf.get("grupo"):
            grupos.setdefault(rf["grupo"], rf["grupo"])
    nome = modulo_nome or modulo
    fluxo = {
        "modulo": nome,
        "fonte": fonte,
        "saida": f"docs/diagramas/mapa-{modulo}.html",
        "titulo": nome,
        "descricao": "",
        "grupos": grupos,
        "raias": config.get("raias", []),
        "fases": [],
        "etapas": [],
        "fora_da_jornada": {AINDA_NAO: list(rfs)},
    }
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with open(destino, "w", encoding="utf-8") as arquivo:
        arquivo.write(json.dumps(fluxo, ensure_ascii=False, indent=2) + "\n")
    print(f"{os.path.relpath(destino, projeto.raiz())}: esqueleto com {len(rfs)} RF(s) em \"{AINDA_NAO}\". "
          "Preencha titulo, descricao, grupos, fases e etapas; cada RF posto num marcador sai da lista de fora.")


def iniciar():
    destino = projeto.arquivo_de_configuracao()
    if os.path.exists(destino):
        sys.exit(f"{destino} já existe.")
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    shutil.copy(os.path.join(AQUI, "config.modelo.json"), destino)
    with open(os.path.join(os.path.dirname(destino), ".gitignore"), "w", encoding="utf-8") as arquivo:
        arquivo.write("# As capturas vão embutidas no HTML gerado; a pasta é refeita pelo build com --capturar.\n"
                      "capturas/\n")
    print(f"{os.path.relpath(destino, projeto.raiz())} criado a partir do modelo: ajuste o endereço, os portais e o "
          "login, o formato dos requisitos e as cores do projeto.")


if __name__ == "__main__":
    argumentos = argparse.ArgumentParser(description="Gera o mapa de requisitos de um módulo.")
    argumentos.add_argument("modulo", nargs="?", help="o nome do fluxo em fluxos/, sem .json (ex.: modulo-a)")
    argumentos.add_argument("--capturar", action="store_true", help="fotografa as telas de novo antes de montar")
    argumentos.add_argument("--etapas", help="com --capturar, refaz só estas etapas (ids separados por vírgula)")
    argumentos.add_argument("--novo", action="store_true", help="cria o esqueleto do fluxo de um módulo novo")
    argumentos.add_argument("--fonte", help="com --novo, o documento de requisitos do módulo")
    argumentos.add_argument("--nome", help="com --novo, o nome do módulo no cabeçalho (ex.: Planejamento)")
    argumentos.add_argument("--iniciar", action="store_true", help="cria a configuração do projeto a partir do modelo")
    opcoes = argumentos.parse_args()

    if opcoes.iniciar:
        iniciar()
        sys.exit(0)
    if not opcoes.modulo:
        argumentos.error("informe o módulo (ex.: modulo-a)")
    if opcoes.novo:
        if not opcoes.fonte:
            argumentos.error("--novo precisa de --fonte com o documento de requisitos do módulo")
        novo(opcoes.modulo, opcoes.fonte, opcoes.nome)
    if opcoes.capturar:
        capturar(opcoes.modulo, opcoes.etapas)
    montar(opcoes.modulo)
