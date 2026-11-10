# agents-config

Configurações versionadas do OpenCode: agentes, skills, commands, plugins e config global.

## Instalação / sync

```bash
git clone https://github.com/marcos2872/agents-config.git
cd agents-config
./sync.sh
```

O `sync.sh` copia `opencode/` para `~/.config/opencode/` (ou `$XDG_CONFIG_HOME/opencode`), **substituindo** o que já existir — o conteúdo anterior vai para `~/.config/opencode/backup-<data>/`. Rode de novo após cada `git pull`.

No fim, o sync garante o [ai-memory](https://github.com/akitaonrails/ai-memory) (backend de memória do OpenCode): instala o binário oficial se faltar, inicializa os dados, fixa a porta local **49375** (a 49374 é a porta padrão do serviço do OpenCode V2) e roda `ai-memory setup --yes --agent opencode2`, que sobe o serviço do usuário, registra o MCP, gera o plugin e instala as skills. O passo é idempotente e global, inclusive quando o destino é um projeto.

Para um projeto específico:

```bash
./sync.sh /caminho/do/projeto/.opencode
```

### Windows (PowerShell)

```powershell
.\sync.ps1
# ou, sem depender da execution policy:
.\sync.cmd
```

O destino padrão é `$env:XDG_CONFIG_HOME\opencode` ou `%USERPROFILE%\.config\opencode`, e o backup segue o mesmo formato `backup-<data>\`. Para um projeto específico:

```powershell
.\sync.ps1 -Destination C:\caminho\do\projeto\.opencode
```

O `sync.ps1` requer PowerShell 5.1+ (já incluso no Windows); o `sync.cmd` apenas chama o script com `-ExecutionPolicy Bypass`.

Depois de sincronizar plugins/config, reinicie: `opencode service restart`.

## Conteúdo

| Caminho | O que é |
|---|---|
| `sync.sh` | Instala/atualiza as configs no `~/.config/opencode/` (Linux/macOS) |
| `sync.ps1` / `sync.cmd` | Mesmo sync no Windows, com destino e backup equivalentes |
| `opencode/opencode.json` | Config global: permissões "flow", MCP (`context7` e `ai-memory`), compaction, snapshots, websearch |
| `opencode/cli.json` | Terminal: tema `system` |
| `opencode/AGENTS.md` | Instruções globais: contrato de intenção, idioma, delegação para subagentes e memória |
| `opencode/agents/` | `orchestrator` (primary, padrão) + `ask` (primary) + subagentes `reviewer`, `debugger`, `explore`, `planner` |
| `opencode/commands/` | `/init-agents`, `/memory`, `/review`, `/test`, `/commit`, `/pr` |
| `opencode/skills/` | `build-standards-index`, `code-conventions`, `doc`, `er-diagram-generator`, `git-commit-push`, `mapa-de-requisitos`, `spec-kit`, `technical-documentation-generator`, `uml-class-diagram-generator`, `verify` |
| `opencode/plugins/` | `ai-memory-opencode2.ts` — captura de sessão do ai-memory (gerado por `ai-memory setup`) |

## Notas

- **Permissões:** shell liberado, com `deny` para `sudo`, `rm -rf /`, `git push --force/-f`, `.ssh` e `.env`. Para o modo restrito, troque o `allow` do shell para `ask` em `opencode.json`. Hard-denies ficam em `permissions` (o runtime 2.0.26 ainda não aplica `experimental.policies`).
- **Memória:** backend único no ai-memory (MCP + plugin de captura), instalado e configurado pelo `sync.sh`; as regras de consulta e gravação ficam no `AGENTS.md` global e o `/init-agents` as inclui no `AGENTS.md` do projeto.
- **Modelos:** os subagentes personalizados herdam o modelo da sessão que os chamou; nenhum fixa um modelo próprio.
- **Plugins** são auto-descobertos de `~/.config/opencode/plugins/`; não precisa listar no config.
- **MCPs:** `context7` (docs de libs/frameworks) e `ai-memory` (memória local). Na primeira vez, autentique o `context7` com `/mcps` no TUI; o `ai-memory` é configurado pelo `sync.sh`.
- **Agente padrão:** `orchestrator` (`default_agent` no `opencode.json`). Ele só altera o projeto quando o pedido é de execução explícita; pedidos de análise/validação de ideia ou erro recebem diagnóstico/plano sem edições. Em qualquer dúvida, pergunta ao usuário com a tool `question`.
- **Delegação:** o `AGENTS.md` global instrui o agente principal a mandar o trabalho "massante" para `explore`/`planner`/`reviewer`/`debugger` (e tarefas longas em background). Para forçar numa tarefa, peça explicitamente ("delegue ao `explore` ...").
