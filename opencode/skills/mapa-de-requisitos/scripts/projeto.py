"""
O projeto em que o mapa é gerado: a raiz do repositório e a configuração dele.

O mecanismo (os scripts e o modelo da página) não sabe nada do projeto. Tudo o que muda de um projeto para outro —
endereço do sistema, portais e login, formato dos requisitos, filtro do texto, cores — está em
`<raiz>/.agents/mapa-de-requisitos/config.json`, junto dos fluxos e das capturas do projeto.

A raiz é a pasta, a partir da atual e sem passar da raiz do git, que tem `.agents/mapa-de-requisitos/`; sem ela, a raiz
do repositório git em que o comando roda. `MAPA_RAIZ` a sobrescreve, e a pasta dos dados pode ser outra com
`MAPA_DADOS`.
"""
import json
import os
import shutil
import subprocess
import sys

PASTA_DOS_DADOS = os.path.join(".agents", "mapa-de-requisitos")


def raiz():
    if os.environ.get("MAPA_RAIZ"):
        return os.path.abspath(os.environ["MAPA_RAIZ"])
    # Sobe a partir da pasta atual até achar a pasta de dados do projeto, sem passar da raiz do git: assim a skill
    # funciona instalada como plugin e num projeto que fica numa subpasta do repositório.
    try:
        topo = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True,
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
    base = os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache")
    return os.environ.get("SKILL_KIT_CACHE") or os.path.join(base, "skill-kit")


def pasta_do_node(aqui):
    """Onde está o playwright-core: ao lado dos scripts, se já instalado ali, ou no cache do usuário.

    No cache, instala na primeira vez e de novo quando o package.json da skill muda."""
    if os.path.isdir(os.path.join(aqui, "node_modules", "playwright-core")):
        return aqui
    destino = os.path.join(cache_do_kit(), "mapa-de-requisitos", "node")
    pacote = os.path.join(aqui, "package.json")
    copia = os.path.join(destino, "package.json")
    atual = os.path.exists(copia) and open(copia, encoding="utf-8").read() == open(pacote, encoding="utf-8").read()
    if not (atual and os.path.isdir(os.path.join(destino, "node_modules", "playwright-core"))):
        os.makedirs(destino, exist_ok=True)
        shutil.copy(pacote, copia)
        subprocess.run(["npm", "install", "--silent"], cwd=destino, check=True)
    return destino


def dados():
    return os.path.abspath(os.environ.get("MAPA_DADOS") or os.path.join(raiz(), PASTA_DOS_DADOS))


def arquivo_de_configuracao():
    return os.path.join(dados(), "config.json")


def configuracao():
    caminho = arquivo_de_configuracao()
    if not os.path.exists(caminho):
        sys.exit(f"Sem configuração do mapa em {caminho}. Rode `build.py --iniciar` para criar uma a partir do modelo "
                 "e ajuste-a ao projeto.")
    with open(caminho, encoding="utf-8") as arquivo:
        return json.load(arquivo)


def no_projeto(caminho):
    """Caminho relativo à raiz do projeto → absoluto."""
    return caminho if os.path.isabs(caminho) else os.path.join(raiz(), caminho)
