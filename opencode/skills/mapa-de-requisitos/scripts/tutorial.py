#!/usr/bin/env python3
"""
Gera um guia do usuário em PDF: os casos de uso de um perfil, cada um com a sequência de telas e o passo a passo.

Usa as mesmas fontes do mapa de requisitos (em `.agents/mapa-de-requisitos/`, ver projeto.py):
  - o guia (tutoriais/<guia>.json): título, público, os portais que o perfil usa, quantos pixels cortar à esquerda das
    telas (`cortar_a_esquerda`, opcional) e as seções, cada uma com os casos de uso, cada caso com as etapas que o
    compõem, citadas como "<fluxo>/<etapa>";
  - os fluxos (fluxos/<módulo>.json): de cada etapa, o título, o resumo, o caminho até a tela e os `passos` — o texto
    de cada passo e, opcionalmente, o `alvo` na tela (texto ou seletor, como os marcadores), onde vai o número dele;
  - as capturas (capturas/<módulo>/): a tela de cada etapa e a caixa do alvo de cada passo.

O contrato do guia não é o do mapa (RF sem destino): falha quando um caso de uso não tem etapa, quando a etapa citada
não existe, não tem captura ou não tem passos, quando a captura é anterior aos passos (o número de passos medidos
difere), quando a etapa é de um portal que o perfil não usa, e quando algum texto do guia cai no filtro do texto que
vai ao cliente.

Uso (de qualquer pasta do repositório):
  tutorial.py usuario               # monta o PDF com as capturas que já existem
  tutorial.py usuario --capturar    # fotografa de novo as telas que o guia usa (o sistema precisa estar no ar)
"""
import argparse
import base64
import html
import json
import os
import re
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

import projeto  # noqa: E402
from build import capturar, caminho_do_fluxo, pasta_das_capturas  # noqa: E402
from extrair_rfs import carregar_filtro  # noqa: E402


def caminho_do_guia(guia):
    return os.path.join(projeto.dados(), "tutoriais", f"{guia}.json")


def ler_json(caminho):
    with open(caminho, encoding="utf-8") as arquivo:
        return json.load(arquivo)


def etapas_citadas(guia):
    """{fluxo: [ids das etapas]} na ordem em que o guia as cita."""
    citadas = {}
    for secao in guia["secoes"]:
        for caso in secao["casos"]:
            for referencia in caso.get("etapas", []):
                fluxo, _, etapa = referencia.partition("/")
                if etapa not in citadas.setdefault(fluxo, []):
                    citadas[fluxo].append(etapa)
    return citadas


def formatar(texto):
    """Texto do guia → HTML: escapa e transforma **trecho** em negrito (o nome do botão, do campo, do menu)."""
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", html.escape(texto))


def montar(nome_do_guia):
    config = projeto.configuracao()
    arquivo_do_guia = caminho_do_guia(nome_do_guia)
    if not os.path.exists(arquivo_do_guia):
        sys.exit(f"Sem guia em {arquivo_do_guia}.")
    guia = ler_json(arquivo_do_guia)
    portais = set(guia.get("portais", []))
    erros, avisos, textos = [], [], []

    fluxos, capturas = {}, {}
    for modulo in etapas_citadas(guia):
        if not os.path.exists(caminho_do_fluxo(modulo)):
            erros.append(f'O guia cita o fluxo "{modulo}", que não existe em fluxos/.')
            continue
        fluxo = ler_json(caminho_do_fluxo(modulo))
        fluxos[modulo] = {"raias": {raia["id"]: raia for raia in fluxo.get("raias") or config.get("raias", [])},
                          "etapas": {etapa["id"]: etapa for etapa in fluxo["etapas"]}}
        indice = os.path.join(pasta_das_capturas(modulo), "capturas.json")
        capturas[modulo] = ler_json(indice) if os.path.exists(indice) else {"etapas": {}}

    janela = config.get("janela", {})
    largura, altura = janela.get("largura", 1440), janela.get("altura", 900)
    secoes = []
    for numero_da_secao, secao in enumerate(guia["secoes"], 1):
        textos += [secao["nome"], secao.get("descricao", "")]
        casos = []
        for numero_do_caso, caso in enumerate(secao["casos"], 1):
            rotulo = f'{numero_da_secao}.{numero_do_caso} {caso["titulo"]}'
            textos += [caso["titulo"], caso.get("objetivo", ""), caso.get("resultado", "")]
            if not caso.get("etapas"):
                erros.append(f"{rotulo}: o caso de uso não tem etapa.")
            telas = []
            for referencia in caso.get("etapas", []):
                modulo, _, id_da_etapa = referencia.partition("/")
                if modulo not in fluxos:
                    continue
                etapa = fluxos[modulo]["etapas"].get(id_da_etapa)
                if etapa is None:
                    erros.append(f'{rotulo}: a etapa "{referencia}" não existe no fluxo.')
                    continue
                portal = fluxos[modulo]["raias"].get(etapa["raia"], {}).get("portal")
                if portais and portal not in portais:
                    erros.append(f'{rotulo}: a etapa "{referencia}" é do portal "{portal}", que este perfil não usa.')
                passos = etapa.get("passos") or []
                if not passos:
                    erros.append(f'{rotulo}: a etapa "{referencia}" não tem passos.')
                captura = capturas[modulo]["etapas"].get(id_da_etapa)
                if captura is None:
                    erros.append(f'{rotulo}: a etapa "{referencia}" não tem captura; rode com --capturar.')
                    continue
                caixas = captura.get("passos") or []
                if len(caixas) != len(passos):
                    erros.append(f'{rotulo}: a captura de "{referencia}" é anterior aos passos; rode com --capturar.')
                    continue
                textos += [etapa["titulo"], etapa.get("resumo", "")] + [passo["texto"] for passo in passos]
                ausentes = set(captura.get("passosAusentes", []))
                for ordem, (passo, caixa) in enumerate(zip(passos, caixas)):
                    if ordem in ausentes:
                        erros.append(f'{referencia}: o alvo do passo "{passo["texto"][:50]}" não existe na tela; '
                                     'ajuste o texto ou o seletor no fluxo e capture de novo.')
                    elif passo.get("alvo") and caixa is None:
                        avisos.append(f'{referencia}: o alvo do passo "{passo["texto"][:50]}" não aparece na tela.')
                with open(os.path.join(pasta_das_capturas(modulo), captura["imagem"]), "rb") as imagem:
                    dados = base64.b64encode(imagem.read()).decode()
                telas.append({"etapa": etapa, "passos": list(zip(passos, caixas)), "imagem": dados})
            casos.append({"rotulo": rotulo, "ancora": f"caso-{numero_da_secao}-{numero_do_caso}", "caso": caso,
                          "telas": telas})
        secoes.append({"numero": numero_da_secao, "secao": secao, "casos": casos})

    filtro = carregar_filtro(config)
    if filtro is not None:
        textos += [guia["titulo"], guia.get("subtitulo", ""), guia.get("publico", "")] + guia.get("apresentacao", [])
        erros += [f"Texto com referência interna, que não vai ao cliente: {texto}"
                  for texto in textos if texto and filtro.RESIDUO.search(texto)]
    if erros:
        sys.exit("O guia não fecha:\n  " + "\n  ".join(erros))

    pagina = pagina_do_guia(guia, secoes, largura, altura, config)
    rascunho = os.path.join(projeto.dados(), "capturas", f"tutorial-{nome_do_guia}.html")
    with open(rascunho, "w", encoding="utf-8") as arquivo:
        arquivo.write(pagina)
    saida = projeto.no_projeto(guia["saida"])
    os.makedirs(os.path.dirname(saida), exist_ok=True)
    ambiente = dict(os.environ, MAPA_NODE=projeto.pasta_do_node(AQUI))
    subprocess.run(["node", os.path.join(AQUI, "imprimir.mjs"), rascunho, saida, guia["titulo"]], env=ambiente, check=True)

    total_de_casos = sum(len(secao["casos"]) for secao in secoes)
    total_de_telas = sum(len(caso["telas"]) for secao in secoes for caso in secao["casos"])
    print(f"{os.path.relpath(saida, projeto.raiz())}: {len(secoes)} seção(ões), {total_de_casos} caso(s) de uso, "
          f"{total_de_telas} tela(s), {os.path.getsize(saida) / 1024 / 1024:.1f} MB")
    for aviso in avisos:
        print("aviso:", aviso)


def pagina_do_guia(guia, secoes, largura, altura, config):
    marca = guia.get("marca") or config.get("marca", "#c8102e")
    logo = ""
    if guia.get("logo"):
        with open(projeto.no_projeto(guia["logo"]), "rb") as imagem:
            tipo = "png" if guia["logo"].lower().endswith(".png") else "jpeg"
            logo = f'<img class="logo" src="data:image/{tipo};base64,{base64.b64encode(imagem.read()).decode()}" alt="">'

    # O guia pode cortar a faixa da esquerda das telas (o menu lateral, por exemplo), para a área útil sair maior; a
    # etapa com `tela_inteira` (a que mostra o próprio menu, o login) sai sem corte.
    corte = guia.get("cortar_a_esquerda", 0)
    sumario = []
    for secao in secoes:
        itens = "".join(f'<li><a href="#{caso["ancora"]}">{formatar(caso["rotulo"])}</a></li>' for caso in secao["casos"])
        sumario.append(f'<li><a href="#secao-{secao["numero"]}">{secao["numero"]}. {formatar(secao["secao"]["nome"])}'
                       f'</a><ol>{itens}</ol></li>')

    corpo = []
    for secao in secoes:
        for indice, caso in enumerate(secao["casos"]):
            abertura = ""
            if indice == 0:
                descricao = secao["secao"].get("descricao", "")
                abertura = (f'<header class="secao" id="secao-{secao["numero"]}"><span>Seção {secao["numero"]}</span>'
                            f'<h1>{formatar(secao["secao"]["nome"])}</h1>'
                            + (f"<p>{formatar(descricao)}</p>" if descricao else "") + "</header>")
            dados = caso["caso"]
            telas = "".join(
                tela_do_caso(tela, numero, largura, altura, 0 if tela["etapa"].get("tela_inteira") else corte)
                for numero, tela in enumerate(caso["telas"], 1))
            resultado = (f'<p class="resultado"><strong>Resultado:</strong> {formatar(dados["resultado"])}</p>'
                         if dados.get("resultado") else "")
            corpo.append(f'<section class="caso">{abertura}<h2 id="{caso["ancora"]}">{formatar(caso["rotulo"])}</h2>'
                         + (f'<p class="objetivo">{formatar(dados["objetivo"])}</p>' if dados.get("objetivo") else "")
                         + telas + resultado + "</section>")

    apresentacao = "".join(f"<p>{formatar(paragrafo)}</p>" for paragrafo in guia.get("apresentacao", []))
    modelo = open(os.path.join(AQUI, "modelo-tutorial.html"), encoding="utf-8").read()
    return (modelo
            .replace("__MARCA__", marca)
            .replace("__TITULO__", html.escape(guia["titulo"]))
            .replace("__CAPA__", f'{logo}<h1>{formatar(guia["titulo"])}</h1>'
                                 f'<p class="subtitulo">{formatar(guia.get("subtitulo", ""))}</p>'
                                 f'<p class="publico">{formatar(guia.get("publico", ""))}</p>')
            .replace("__APRESENTACAO__", apresentacao)
            .replace("__SUMARIO__", "".join(sumario))
            .replace("__CORPO__", "".join(corpo)))


FOLGA = 5  # px da janela entre o alvo e a moldura, para a moldura não cobrir o texto
LARGURA_DO_NUMERO = 34  # px da janela que o número ocupa ao lado da moldura


def tela_do_caso(tela, numero, largura, altura, corte=0):
    etapa = tela["etapa"]
    pontos, itens = [], []
    for ordem, (passo, caixa) in enumerate(tela["passos"], 1):
        if caixa:
            # A moldura do alvo em fração da área mostrada: acompanha a imagem em qualquer largura de página. O número
            # fica à esquerda da moldura, ou no canto de cima quando o alvo encosta na borda esquerda do recorte.
            visivel = largura - corte
            x, y = caixa["x"] - corte - FOLGA, caixa["y"] - FOLGA
            w, h = caixa["w"] + 2 * FOLGA, caixa["h"] + 2 * FOLGA
            lado = "esquerda" if x > LARGURA_DO_NUMERO else "canto"
            estilo = (f'left:{x / visivel * 100:.3f}%;top:{y / altura * 100:.3f}%;'
                      f'width:{w / visivel * 100:.3f}%;height:{h / altura * 100:.3f}%')
            pontos.append(f'<div class="alvo {lado}" style="{estilo}"><span>{ordem}</span></div>')
        itens.append(f'<li><span class="numero{" sem-alvo" if not caixa else ""}">{ordem}</span>'
                     f'<span>{formatar(passo["texto"])}</span></li>')
    resumo = f'<p class="resumo">{formatar(etapa["resumo"])}</p>' if etapa.get("resumo") else ""
    return (f'<div class="tela"><h3><span class="etapa">Tela {numero}</span> {formatar(etapa["titulo"])}</h3>{resumo}'
            f'<figure><img src="data:image/jpeg;base64,{tela["imagem"]}" alt="" '
            f'style="width:{largura / (largura - corte) * 100:.3f}%;margin-left:-{corte / (largura - corte) * 100:.3f}%">'
            f'{"".join(pontos)}</figure>'
            f'<ol class="passos">{"".join(itens)}</ol></div>')


if __name__ == "__main__":
    argumentos = argparse.ArgumentParser(description="Gera um guia do usuário em PDF a partir dos fluxos do mapa.")
    argumentos.add_argument("guia", help="o nome do guia em tutoriais/, sem .json (ex.: usuario)")
    argumentos.add_argument("--capturar", action="store_true", help="fotografa de novo as telas que o guia usa")
    opcoes = argumentos.parse_args()
    if opcoes.capturar:
        for modulo, etapas in etapas_citadas(ler_json(caminho_do_guia(opcoes.guia))).items():
            capturar(modulo, ",".join(etapas))
    montar(opcoes.guia)
