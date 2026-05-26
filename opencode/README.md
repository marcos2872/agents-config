# opencode config

Agentes e skills para o [OpenCode](https://opencode.ai/).

## Instalação global

Crie symlinks em `~/.config/opencode/` apontando para este diretório:

```bash
REPO=~/Projetos/pi-config

ln -s "$REPO/opencode/agents" ~/.config/opencode/agents
ln -s "$REPO/opencode/skills" ~/.config/opencode/skills
```

Qualquer `git pull` reflete imediatamente em todas as sessões.

## Instalação local (por projeto)

Crie symlinks (ou copie) dentro do projeto em `.opencode/`:

```bash
REPO=~/Projetos/pi-config

mkdir -p .opencode
ln -s "$REPO/opencode/agents" .opencode/agents
ln -s "$REPO/opencode/skills" .opencode/skills
```

Agentes e skills locais têm prioridade sobre os globais.

## Agentes disponíveis

| Agente | Modo | Descrição |
|---|---|---|
| `ask` | primary | Responde perguntas sem modificar nada |
| `geral` | primary | Propósito geral sem restrições |
| `doc` | subagent | Cria e atualiza documentação técnica |
| `qa` | subagent | Analisa bugs, edge cases e vulnerabilidades |
| `quality` | subagent | Verifica conformidade com convenções do projeto |
| `test` | subagent | Cria, mantém e executa testes automatizados |

Alterne entre agentes primários com **Tab**. Invoque subagentes com `@nome`.

## Skills disponíveis

| Skill | Descrição |
|---|---|
| `code-conventions` | Convenções de código, Makefile e templates por linguagem |
| `doc-architecture` | ADRs e inventário de serviços |
| `doc-backend` | Endpoints, fluxos de dados e ADRs de backend |
| `doc-db` | Diagramas ER em três níveis de detalhe |
| `doc-frontend` | Componentes, rotas, estado global e fluxos de usuário |
| `excalidraw` | Geração de JSON Excalidraw |
| `git-commit-push` | Commit Conventional Commits, push e PR |

## opencode-mem

`opencode-mem` adiciona memória persistente ao OpenCode usando um banco local em `~/.opencode-mem/data`. Por padrão, as memórias ficam separadas por projeto (`defaultScope: "project"`), mas podem ser consultadas entre projetos com `scope: "all-projects"`. A interface web fica em `http://127.0.0.1:4747`.

## opencode-mem — erro de inicialização

Se o tool `memory` responder `Memory system is initializing` mesmo com a interface web aberta, confira:

```bash
grep -E "Failed to initialize embedding model|sharp|Plugin warmup failed" ~/.opencode-mem/opencode-mem.log
```

Erro conhecido:

```text
Something went wrong installing the "sharp" module
Cannot find module '../build/Release/sharp-linux-x64.node'
```

Correção:

```bash
cd ~/.cache/opencode/packages/opencode-mem@latest
npm install --ignore-scripts=false --foreground-scripts --platform=linux --arch=x64 sharp
```

Depois reinicie o OpenCode e valide:

```ts
memory({ mode: "add", content: "Teste opencode-mem ativo neste projeto" })
memory({ mode: "search", query: "Teste opencode-mem" })
```

## RTK (opcional, recomendado)

Reduz o consumo de tokens em ~40% comprimindo saídas de terminal.

```bash
# macOS
brew install rtk

# Linux
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
# garantir ~/.local/bin no PATH se instalar via script
```

Ativar no OpenCode:

```bash
rtk init -g --opencode
```

Reinicie o OpenCode após ativar.
