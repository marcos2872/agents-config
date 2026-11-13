# AGENTS.md

## Escopo do repo

- Este checkout centraliza configuração do OpenCode em `opencode/`; não há `package.json`, CI, build, lint ou teste automatizado na raiz.
- `.opencode/` é ignorado pelo Git; use-o só para artefatos locais/auditorias geradas em runtime, não para configuração versionada.

## Estrutura OpenCode

- Agentes ficam em `opencode/agents/*.md`; o único agente versionado é `msbos-chat` (primary, desktop msbos).
- Commands ficam em `opencode/commands/*.md` (nome do arquivo = nome do comando).
- Skills ficam em `opencode/skills/<nome>/SKILL.md`; recursos auxiliares da skill ficam dentro do próprio diretório da skill.
- Plugins locais ficam em `opencode/plugins/*.ts`, `*.js` ou diretórios de pacote; são auto-descobertos quando symlinkados para `~/.config/opencode/plugins/`.
- O antigo plugin `opencode/plugins/memory.ts` foi removido no cutover para o ai-memory; as memórias dele foram importadas para `notes/opencode-memory/` (tag `opencode-import`).
- O plugin `opencode/plugins/ai-memory-opencode2.ts` é gerado por `ai-memory install-hooks --agent opencode2 --apply` e versionado como fallback; o `sync.sh` roda `ai-memory setup --yes --agent opencode2` no fim e regenera o plugin conforme o binário instalado. Após upgrade do ai-memory, regenere e re-copie o arquivo.
- Config versionada do runtime fica em `opencode/opencode.json`, em formato nativo V2 (`permissions`, `plugins`, `mcp.servers`); os MCPs são `context7` e `ai-memory` (bridge stdio para `http://127.0.0.1:49375/mcp`).
- Config do terminal (tema etc.) fica em `opencode/cli.json` e é sempre global; não existe config de CLI por projeto.
- Instruções globais do runtime ficam em `opencode/AGENTS.md` (sincronizado para `~/.config/opencode/AGENTS.md`); o `AGENTS.md` da raiz vale apenas para este repo.
- Frontmatter de agente usa `description`, `mode: primary | subagent`, `model` e `permissions` (array V2 ordenado); o formato legado `permission:`/`temperature` não é usado.
- Frontmatter de skill usa `name`, `description` e opcionalmente `argument-hint`.
- Frontmatter de command usa `description`, opcionalmente `agent`, `model` e `subagent`.
- Agente versionado atualmente: `msbos-chat` (primary). Os papéis de review, debug, planejamento e exploração são skills; a delegação usa os subagentes embutidos `explore` e `general`.
- Skills versionadas atualmente: `build-standards-index`, `code-conventions`, `code-review`, `debugging`, `doc`, `er-diagram-generator`, `git-commit-push`, `mapa-de-requisitos`, `planning`, `spec-kit`, `subagents`, `technical-documentation-generator`, `uml-class-diagram-generator`, `verify`.
- Skills do ai-memory (`ai-memory-retrieval`, `ai-memory-durable-pages`, `ai-memory-handoff`, `ai-memory-messaging`, `ai-memory-learning-maintenance`, `ai-memory-routing-install`) ficam em `~/.agents/skills` e são gerenciadas por `ai-memory install-skills`; não são duplicadas em `opencode/skills/`.
- As skills herdadas do skill-kit (`diagramas` e `projeto`) foram adaptadas do Claude Code: onde o guia usava `${CLAUDE_SKILL_DIR}`/`${CLAUDE_PLUGIN_ROOT}`, agora aponta para `~/.config/opencode/skills/<skill>/`; todo o conteúdo está em português brasileiro.

## Instalação e runtime

- A instalação/sync é feita por `sync.sh` (Linux/macOS) ou `sync.ps1`/`sync.cmd` (Windows), que copiam `opencode/` para `~/.config/opencode/` (ou destino passado como argumento, ex.: `.opencode/` de um projeto), substituindo o que existir com backup em `backup-<data>/`.
- Depois da cópia, o sync garante o ai-memory: instala o binário oficial (`~/.local/bin/ai-memory` no Linux/macOS, `%LOCALAPPDATA%\Programs\ai-memory` no Windows) se faltar, roda `init` numa instalação nova, fixa `bind = "127.0.0.1:49375"` e `language = "pt-BR"`, e aplica `ai-memory setup --yes --agent opencode2` (serviço do usuário, MCP, plugin e skills). A porta 49375 evita o conflito com o serviço do OpenCode V2, que usa 49374.
- Para ativar plugins configurados, mantenha `opencode/opencode.json` sincronizado e reinicie o OpenCode após alterar plugins.
- O ai-memory roda como serviço systemd user `ai-memory.service` em `127.0.0.1:49375`, com dados/wiki em `~/.local/share/ai-memory`; as skills globais dele ficam em `~/.agents/skills` e são gerenciadas por `ai-memory install-skills`.
- O `sync.sh` remove do config vivo o que não existe no repo; o drift antigo (`browser-relay.ts` e `opencode-browser.agent.md`) já foi reconciliado, mas confira `git status` antes de sincronizar em outra máquina.
- O perfil de permissões é "flow" (shell liberado) com regras `deny` explícitas (sudo, rm -rf /, push forçado); não remova esses denies sem combinar.
- RTK é opcional: rode `rtk init -g --opencode` e reinicie o OpenCode; no Linux, garantir `~/.local/bin` no `PATH` se instalado via script.

## Convenções importantes

- Conteúdo user-facing e comentários devem ficar em português brasileiro; identificadores em exemplos de código podem ficar em inglês.
- `qa`, `quality` e `test` exigem carregar a skill `code-conventions` antes da análise/escrita de testes.
- Para documentação técnica, use a skill `doc`; não existe agente dedicado de documentação neste repo.
- Commits devem seguir Conventional Commits; use a skill `git-commit-push` quando o usuário pedir commit, push ou PR.
- Antes de declarar uma tarefa concluída, siga a skill `verify` e mostre a evidência (comando e resultado).
- Antes de mudanças multi-etapa, use a skill `planning`; antes de revisar, a skill `code-review`; para decidir delegação, a skill `subagents`.

## Memória do projeto

- Memória de longo prazo via ai-memory (MCP `ai-memory`): consulte com `memory_query` antes de responder sobre histórico/decisões; grave com `memory_write_page` só quando o usuário pedir explicitamente.
- Preferências que valem em todos os projetos → `memory_write_page` com `scope: "profile"`; fatos globais → `scope: "global"`.
- As memórias do antigo plugin `memory.ts` foram importadas para páginas em `notes/opencode-memory/` (tag `opencode-import`); o plugin foi removido no cutover.
- Serviço local em `http://127.0.0.1:49375`; dados/wiki em `~/.local/share/ai-memory`.

## Validação

- Não há suíte geral. Para mudanças em skills/commands/agentes, valide lendo o frontmatter e a renderização Markdown.
- Para `opencode/opencode.json`, valide o JSON (por exemplo, com `jq`) e confira os campos contra a documentação V2 (`https://opencode.ai/v2/docs/`).
- Para os scripts de sync, rode `bash -n sync.sh` e `git diff --check`; no Windows, valide o parse do `sync.ps1` com `[scriptblock]::Create((Get-Content -Raw .\sync.ps1))`.
