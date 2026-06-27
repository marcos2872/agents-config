# agents-config

README global das configurações versionadas do OpenCode.

## Conteúdo

- `opencode/` — agentes, skills, plugins e configuração global do OpenCode.
- `.opencode/` — cópia local por projeto quando necessário.

## OpenCode

### Configuração global

O OpenCode lê os agentes, skills, plugins e config a partir de symlinks em `~/.config/opencode/`.

A configuração versionada principal fica em:

```text
opencode/opencode.json
```

### Instalação global

```bash
REPO=/home/marcos/Projects/agents-config

mkdir -p ~/.config/opencode
ln -s "$REPO/opencode/agents" ~/.config/opencode/agents
ln -s "$REPO/opencode/skills" ~/.config/opencode/skills
ln -s "$REPO/opencode/plugins" ~/.config/opencode/plugins
ln -s "$REPO/opencode/opencode.json" ~/.config/opencode/opencode.json
```

Qualquer `git pull` ou alteração em `opencode/opencode.json` reflete imediatamente nas sessões do OpenCode.

### Instalação local por projeto

Crie symlinks (ou copie) dentro de um projeto específico em `.opencode/`:

```bash
REPO=/home/marcos/Projects/agents-config

mkdir -p .opencode
ln -s "$REPO/opencode/agents" .opencode/agents
ln -s "$REPO/opencode/skills" .opencode/skills
ln -s "$REPO/opencode/plugins" .opencode/plugins
```

Agentes e skills locais têm prioridade sobre os globais.

## Agentes disponíveis

| Agente | Modo | Descrição |
|---|---|---|
| `ask` | primary | Responde perguntas sem modificar nada |
| `geral` | primary | Propósito geral sem restrições |

Alterne entre agentes primários com **Tab**.

## Skills disponíveis

| Skill | Descrição |
|---|---|
| `code-conventions` | Convenções de código, qualidade, testes e arquitetura |
| `doc` | ADRs, inventário de serviços, APIs, rotas e documentação técnica |
| `excalidraw` | Diagramas Excalidraw em JSON |
| `git-commit-push` | Commit Conventional Commits, push e PR |

## Plugins

Plugins locais ficam em:

```text
opencode/plugins/*.ts
opencode/plugins/*.js
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
