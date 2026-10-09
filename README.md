# agents-config

Configurações versionadas do OpenCode: agentes, skills, commands, plugins e config global.

## Instalação / sync

```bash
git clone https://github.com/marcos2872/agents-config.git
cd agents-config
./sync.sh
```

O `sync.sh` copia `opencode/` para `~/.config/opencode/` (ou `$XDG_CONFIG_HOME/opencode`), **substituindo** o que já existir — o conteúdo anterior vai para `~/.config/opencode/backup-<data>/`. Rode de novo após cada `git pull`.

Para um projeto específico:

```bash
./sync.sh /caminho/do/projeto/.opencode
```

Depois de sincronizar plugins/config, reinicie: `opencode service restart`.

## Conteúdo

| Caminho | O que é |
|---|---|
| `sync.sh` | Instala/atualiza as configs no `~/.config/opencode/` |
| `opencode/opencode.json` | Config global: permissões "flow", MCP (`chrome-devtools`, `context7`), compaction, snapshots, websearch |
| `opencode/cli.json` | Terminal: tema `system` |
| `opencode/agents/` | `ask` (primary) + subagentes `reviewer`, `debugger`, `explore`, `planner` |
| `opencode/commands/` | `/init-agents`, `/memory`, `/review`, `/test`, `/commit`, `/pr` |
| `opencode/skills/` | `code-conventions`, `doc`, `git-commit-push`, `verify` |
| `opencode/plugins/` | `memory.ts` — memória durável por projeto (tools `memory_*` e `/memory`) |

## Notas

- **Permissões:** shell liberado, com `deny` para `sudo`, `rm -rf /`, `git push --force/-f`, `.ssh` e `.env`. Para o modo restrito, troque o `allow` do shell para `ask` em `opencode.json`. Hard-denies ficam em `permissions` (o runtime 2.0.26 ainda não aplica `experimental.policies`).
- **Memória:** injetada automaticamente no contexto (`<project-memory>`); `/init-agents` inclui a regra no `AGENTS.md` do projeto.
- **Modelos:** `reviewer`, `explore` e `planner` fixam modelos do `opencode-go`; remova o `model` no frontmatter para herdar o da sessão.
- **Plugins** são auto-descobertos de `~/.config/opencode/plugins/`; não precisa listar no config.
- **MCPs:** `chrome-devtools` (browser) e `context7` (docs de libs/frameworks). Na primeira vez, autentique o `context7` com `/mcps` no TUI.
