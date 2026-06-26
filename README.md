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
ln -s "$REPO/opencode-model-router/opencode-model-router.state.json" ~/.config/opencode/opencode-model-router.state.json
```

Qualquer `git pull` ou alteração em `opencode/opencode.json` reflete imediatamente nas sessões do OpenCode.
Alterações em `opencode-model-router/opencode-model-router.state.json` também refletem quando o OpenCode está usando o state symlinkado em `~/.config/opencode/`.
Se o OpenCode carregar o pacote `opencode-model-router` de um cache interno, também é necessário apontar o `tiers.json` desse cache para o arquivo versionado neste repo.

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

### Instalação npm de `opencode-model-router`

Execute no projeto do OpenCode ou globalmente:

```bash
npm install -g opencode-model-router
```

Depois registre no `opencode/opencode.json`:

```json
{
  "plugin": ["opencode-model-router"]
}
```

Crie os links para os arquivos versionados no repo:

```bash
REPO=/home/marcos/Projects/agents-config
PLUGIN_ROOT=$(npm root -g)/opencode-model-router
CACHE_PLUGIN="$HOME/.cache/opencode/packages/opencode-model-router@latest/node_modules/opencode-model-router"

mkdir -p ~/.config/opencode
ln -sfn "$REPO/opencode-model-router/tiers.json" "$PLUGIN_ROOT/tiers.json"
ln -sfn "$REPO/opencode-model-router/tiers.json" "$CACHE_PLUGIN/tiers.json" 2>/dev/null || true
ln -sfn "$REPO/opencode-model-router/opencode-model-router.state.json" ~/.config/opencode/opencode-model-router.state.json
```

O arquivo `opencode-model-router/tiers.json` fica versionado neste repo e é lido pelo plugin npm/cacheado via symlink. Ele define os modelos de roteamento. O state `opencode-model-router/opencode-model-router.state.json` fica versionado neste repo e controla o preset/modo/enforcement persistentes, mas **não** altera os modelos.

Se o OpenCode continuar exibindo modelos antigos depois do `git pull`, mate o processo de fundo e reinicie:

```bash
pkill -f opencode
opencode
```

Depois confirme no OpenCode:

```text
/preset
/tiers
```

Exemplo atual com os demais campos do arquivo:

```json
{
  "plugin": ["opencode-model-router"],
  "model": "llama.cpp/Nex-N2-mini",
  "provider": {
    "llama.cpp": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Server IA",
      "options": {
        "baseURL": "http://100.68.95.21:8080/v1"
      },
      "models": {
        "Nex-N2-mini": {
          "name": "Nex-N2-mini-UD-Q5_K_XL.gguf",
          "supportsToolCalls": true,
          "contextWindow": 262144,
          "maxTokens": 4096
        }
      }
    }
  }
}
```

Se `plugin` já existir, mantenha o array e apenas adicione `"opencode-model-router"`.

### Instalação local por clone

A instalação oficial pelo clone usa `plugin` como objeto. Essa sintaxe pode não ser aceita pela versão atual do OpenCode que você está usando, então este repo mantém o caminho compatível: pacote npm + symlinks para `tiers.json` e state.

Caso você tenha uma versão do OpenCode compatível com `plugin` como objeto, o clone ficaria assim:

```bash
git clone https://github.com/marco-jardim/opencode-model-router ~/opencode-model-router
cd ~/opencode-model-router
npm install
```

E no `opencode/opencode.json`:

```json
{
  "plugin": {
    "opencode-model-router": {
      "type": "local",
      "path": "/home/marcos/Projects/agents-config/opencode-model-router"
    }
  }
}
```

Para a configuração deste repo, prefira o caminho npm/cacheado acima e garanta que `readlink ~/.cache/.../opencode-model-router/tiers.json` aponte para `/home/marcos/Projects/agents-config/opencode-model-router/tiers.json`.

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
