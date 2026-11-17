# agents-config

Configurações versionadas do OpenCode, compartilhadas com o Claude Code: agente, skills, commands, plugins e config global.

## Instalação / sync

```bash
git clone https://github.com/marcos2872/agents-config.git
cd agents-config
./sync.sh
```

O `sync.sh` copia `opencode/` para `~/.config/opencode/` (ou `$XDG_CONFIG_HOME/opencode`), **substituindo** o que já existir — o conteúdo anterior vai para `~/.config/opencode/backup-<data>/`. Rode de novo após cada `git pull`.

Se o Claude Code estiver instalado (`claude` no `PATH`), o mesmo sync aponta `~/.claude/skills/<nome>` e `~/.claude/commands/<nome>.md` para os arquivos sincronizados, sem duplicar conteúdo, e garante o MCP `context7`. Assim as skills e os comandos valem nos dois runtimes; detalhes em **Claude Code**, nas notas.

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
| `opencode/agents/` | `msbos-chat.md` — único agente (primary, desktop msbos) |
| `opencode/commands/` | `/init-agents`, `/memory`, `/review`, `/audit`, `/test`, `/commit`, `/pr` |
| `opencode/skills/` | `code-conventions`, `code-review`, `debugging`, `doc`, `er-diagram-generator`, `git-commit-push`, `mapa-de-requisitos`, `planning`, `spec-kit`, `subagents`, `technical-documentation-generator`, `uml-class-diagram-generator`, `verify` |
| `opencode/plugins/` | `ai-memory-opencode2.ts` — captura de sessão do ai-memory (gerado por `ai-memory setup`) |

## Notas

- **Permissões:** shell liberado, com `deny` para `sudo`, `rm -rf /`, `git push --force/-f`, `.ssh` e `.env`. Para o modo restrito, troque o `allow` do shell para `ask` em `opencode.json`. Hard-denies ficam em `permissions` (o runtime 2.0.26 ainda não aplica `experimental.policies`).
- **Memória:** backend único no ai-memory (MCP + plugin de captura), instalado e configurado pelo `sync.sh`; as regras de consulta e gravação ficam no `AGENTS.md` de cada projeto e o `/init-agents` as cria.
- **Modelos:** os subagentes embutidos herdam o modelo da sessão que os chamou; não há agente customizado de review/debug/planning.
- **Plugins** são auto-descobertos de `~/.config/opencode/plugins/`; não precisa listar no config.
- **MCPs:** `context7` (docs de libs/frameworks) e `ai-memory` (memória local). Na primeira vez, autentique o `context7` com `/mcps` no TUI; o `ai-memory` é configurado pelo `sync.sh`.
- **Agente padrão:** `build` embutido (sem `default_agent`). Não há mais `AGENTS.md` global versionado: as instruções de cada projeto ficam no `AGENTS.md` da raiz dele. O `msbos-chat` é selecionável para o desktop.
- **Delegação:** a skill `subagents` define a matriz; os subagentes disponíveis são `explore` e `general`. Para forçar numa tarefa, peça explicitamente ("delegue ao `explore` ...").
- **Claude Code:** quando o binário `claude` está no `PATH`, o sync cria links de `~/.config/opencode/skills/<nome>` em `~/.claude/skills/<nome>` e dos commands em `~/.claude/commands/`, além de registrar o MCP `context7` no escopo user se ainda não existir. O sync nunca apaga nem sobrescreve link ou arquivo que não tenha criado — conflito vira aviso. O MCP `ai-memory` no Claude Code é criado pelo próprio `ai-memory setup`.
- **Revisão e auditoria:** a skill `code-review` tem dois modos — mudança (diff/PR, usada pelo `/review`) e repositório inteiro (usada pelo `/audit`). O conteúdo dos modos vem das skills `ponytail-review` e `ponytail-audit` do [ponytail](https://github.com/DietrichGebert/ponytail) v5.3.3 (MIT), fundidas com o procedimento local; o aviso de licença está em `opencode/skills/code-review/LICENSE-ponytail.txt`. O resto do pacote ponytail (níveis, hooks, plugin) não foi adotado.
