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
# O bytecode não pode cair na pasta da skill: ela é global, compartilhada por projetos e pode ser somente leitura.
sys.dont_write_bytecode = True

PASTA_DOS_DADOS = os.path.join(".agents", "mapa-de-requisitos")


def conferir_pasta_unica(raiz, skill):
    """Os dados da skill ficam só em <raiz>/.agents/<skill>/, e a skill vem do plugin (ou de .agents/skills/<skill>/).

    Uma cópia dos dados ou da skill em outro lugar faz cada pessoa da equipe gravar numa pasta: o build para e diz o que
    mover. As variáveis que apontam outra raiz ou outra pasta de dados continuam valendo."""
    import pathlib as _p
    raiz = _p.Path(raiz)
    achados = []
    dados = raiz / ".agents" / skill
    if dados.is_dir() and any(p.name.lower() == "skill.md" for p in dados.iterdir()):
        achados.append(f".agents/{skill}/SKILL.md: cópia da skill misturada aos dados")
    if achados:
        sys.exit(f"{skill}: os dados deste projeto ficam só em .agents/{skill}/, e a skill vem do plugin diagramas do "
                 "skill-kit, a mesma para toda a equipe. Encontrei:\n  - " + "\n  - ".join(achados) +
                 f"\nMova os dados para .agents/{skill}/ (git mv), apague a cópia da skill e instale o plugin.")


SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def raiz():
    if os.environ.get('MAPA_RAIZ'):
        return os.path.abspath(os.environ['MAPA_RAIZ'])
    try:
        topo = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True,
                              check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        topo = None
    pasta = os.getcwd()
    while True:
        # A pasta da skill nunca é a raiz do projeto: os dados ficam no projeto aberto, não na skill.
        if os.path.isdir(os.path.join(pasta, PASTA_DOS_DADOS)) and not _dentro_da_skill(pasta):
            return pasta
        acima = os.path.dirname(pasta)
        if pasta == topo or acima == pasta:
            break
        pasta = acima
    if topo and not _dentro_da_skill(topo):
        return topo
    # Sem raiz de projeto utilizável (cwd preso dentro da skill, fora de um git): para, em vez de gravar
    # artefatos na pasta da skill, que é global e compartilhada. Rodar de dentro do projeto, ou definir MAPA_RAIZ.
    sys.exit(f'não encontrei a raiz do projeto a partir de {os.getcwd()}. Os dados ficam em .agents/mapa-de-requisitos/ '
             'do projeto aberto, nunca na pasta da skill. Rode de dentro do projeto ou defina MAPA_RAIZ.')


def _dentro_da_skill(caminho):
    """Verdadeiro quando caminho é a pasta da skill ou está dentro dela."""
    alvo = os.path.abspath(caminho)
    return alvo == SKILL or alvo.startswith(SKILL + os.sep)


def cache_do_kit():
    """Pasta do usuário para o que se baixa uma vez por máquina: sobrevive às atualizações do plugin."""
    base = os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache")
    return os.environ.get("SKILL_KIT_CACHE") or os.path.join(base, "skill-kit")


def pasta_do_node(aqui):
    """Onde está o playwright-core: sempre no cache do usuário, nunca na pasta da skill.

    No cache, instala na primeira vez e de novo quando o package.json da skill muda. A pasta da skill é
    global, compartilhada entre projetos e o sync a substitui, então nada é instalado ali."""
    # A pasta da skill não é local de instalação: é global, compartilhada e o sync a substitui.
    if os.path.isdir(os.path.join(aqui, "node_modules", "playwright-core")):
        print(f"aviso: {aqui}/node_modules é ignorado; o playwright-core fica no cache do usuário",
              file=sys.stderr)
    destino = os.path.join(cache_do_kit(), "mapa-de-requisitos", "node")
    pacote = os.path.join(aqui, "package.json")
    copia = os.path.join(destino, "package.json")
    atual = os.path.exists(copia) and open(copia, encoding="utf-8").read() == open(pacote, encoding="utf-8").read()
    if not (atual and os.path.isdir(os.path.join(destino, "node_modules", "playwright-core"))):
        os.makedirs(destino, exist_ok=True)
        shutil.copy(pacote, copia)
        subprocess.run(["npm", "install", "--silent"], cwd=destino, check=True)
    return destino


_conferida = False


def dados():
    global _conferida
    if not _conferida:
        conferir_pasta_unica(raiz(), "mapa-de-requisitos")
        _conferida = True
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
