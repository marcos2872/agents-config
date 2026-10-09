# AGENTS.md

## Escopo do repo

- Este checkout centraliza configuração do OpenCode em `opencode/`; não há `package.json`, CI, build, lint ou teste automatizado na raiz.
- `.opencode/` é ignorado pelo Git; use-o só para artefatos locais/auditorias geradas em runtime, não para configuração versionada.

## Estrutura OpenCode

- Agentes ficam em `opencode/agents/*.md` como arquivos flat, sem subdiretório por agente.
- Commands ficam em `opencode/commands/*.md` (nome do arquivo = nome do comando).
- Skills ficam em `opencode/skills/<nome>/SKILL.md`; recursos auxiliares da skill ficam dentro do próprio diretório da skill.
- Plugins locais ficam em `opencode/plugins/*.ts`, `*.js` ou diretórios de pacote; são auto-descobertos quando symlinkados para `~/.config/opencode/plugins/`.
- O plugin `opencode/plugins/memory.ts` implementa memória durável por projeto (tools `memory_write`/`memory_list`/`memory_delete` e injeção via hook de sessão).
- Config versionada do runtime fica em `opencode/opencode.json`, em formato nativo V2 (`permissions`, `plugins`, `mcp.servers`).
- Config do terminal (tema etc.) fica em `opencode/cli.json` e é sempre global; não existe config de CLI por projeto.
- Instruções globais do runtime ficam em `opencode/AGENTS.md` (sincronizado para `~/.config/opencode/AGENTS.md`); o `AGENTS.md` da raiz vale apenas para este repo.
- Frontmatter de agente usa `description`, `mode: primary | subagent`, `model` e `permissions` (array V2 ordenado).
- Frontmatter de skill usa `name`, `description` e opcionalmente `argument-hint`.
- Frontmatter de command usa `description`, opcionalmente `agent`, `model` e `subagent`.
- Agentes versionados atualmente: `ask` (primary), `reviewer`, `debugger`, `explore`, `planner` (subagentes).
- Skills versionadas atualmente: `code-conventions`, `doc`, `git-commit-push`, `spec-kit`, `verify`.

## Instalação e runtime

- A instalação/sync é feita por `sync.sh`, que copia `opencode/` para `~/.config/opencode/` (ou destino passado como argumento, ex.: `.opencode/` de um projeto), substituindo o que existir com backup em `backup-<data>/`.
- Para ativar plugins configurados, mantenha `opencode/opencode.json` sincronizado e reinicie o OpenCode após alterar plugins.
- O perfil de permissões é "flow" (shell liberado) com regras `deny` explícitas (sudo, rm -rf /, push forçado); não remova esses denies sem combinar.
- RTK é opcional: rode `rtk init -g --opencode` e reinicie o OpenCode; no Linux, garantir `~/.local/bin` no `PATH` se instalado via script.

## Convenções importantes

- Conteúdo user-facing e comentários devem ficar em português brasileiro; identificadores em exemplos de código podem ficar em inglês.
- `qa`, `quality` e `test` exigem carregar a skill `code-conventions` antes da análise/escrita de testes.
- Para documentação técnica, use a skill `doc`; não existe agente dedicado de documentação neste repo.
- Commits devem seguir Conventional Commits; use a skill `git-commit-push` quando o usuário pedir commit, push ou PR.
- Antes de declarar uma tarefa concluída, siga a skill `verify` e mostre a evidência (comando e resultado).

## Memória do projeto

- Ao aprender algo durável sobre este repo (decisão, convenção, armadilha, preferência do usuário), salve com a tool `memory_write` — uma frase objetiva por memória.
- As memórias são injetadas automaticamente no contexto (bloco `<project-memory>`); siga-as.
- Liste com `memory_list` e remova memórias obsoletas com `memory_delete`; o usuário também gerencia via `/memory`.

## Validação

- Não há suíte geral. Para mudanças em agentes/skills/commands, valide lendo o frontmatter e a renderização Markdown.
- Para `opencode/opencode.json`, valide o JSON (por exemplo, com `jq`) e confira os campos contra a documentação V2 (`https://opencode.ai/v2/docs/`).
