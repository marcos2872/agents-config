# AGENTS.md

## Escopo do repo

- Este checkout centraliza configuração do OpenCode em `opencode/`; não há `package.json`, CI, build, lint ou teste automatizado na raiz.
- `.opencode/` é ignorado pelo Git; use-o só para artefatos locais/auditorias geradas em runtime, não para configuração versionada.

## Estrutura OpenCode

- Agentes ficam em `opencode/agents/*.md` como arquivos flat, sem subdiretório por agente.
- Skills ficam em `opencode/skills/<nome>/SKILL.md`; recursos auxiliares da skill ficam dentro do próprio diretório da skill.
- Plugins locais ficam em `opencode/plugins/*.ts` ou `*.js` e são auto-descobertos pelo OpenCode quando symlinkados para `~/.config/opencode/plugins/`.
- Config versionada do runtime fica em `opencode/opencode.json`.
- Frontmatter de agente usa `description`, `mode: primary | subagent` e `permission`; frontmatter de skill usa `name`, `description` e opcionalmente `argument-hint`.
- Agentes versionados atualmente: `ask`, `geral`. Não referencie agentes inexistentes como `build`, `plan`, `qa`, `quality` ou `test`.
- Skills versionadas atualmente: `code-conventions`, `doc`, `excalidraw`, `git-commit-push`.

## Instalação e runtime

- A instalação usa symlinks de `opencode/agents`, `opencode/skills` e `opencode/plugins` para `~/.config/opencode/` ou `.opencode/` do projeto alvo.
- Para ativar plugins configurados, mantenha `opencode/opencode.json` sincronizado e reinicie o OpenCode após alterar plugins.
- RTK é opcional: rode `rtk init -g --opencode` e reinicie o OpenCode; no Linux, garantir `~/.local/bin` no `PATH` se instalado via script.

## Convenções importantes

- Conteúdo user-facing e comentários devem ficar em português brasileiro; identificadores em exemplos de código podem ficar em inglês.
- `qa`, `quality` e `test` exigem carregar a skill `code-conventions` antes da análise/escrita de testes.
- Para documentação técnica, use a skill `doc`; não existe agente dedicado de documentação neste repo.
- Commits devem seguir Conventional Commits; use a skill `git-commit-push` quando o usuário pedir commit, push ou PR.

## Skill Excalidraw

- O renderer fica em `opencode/skills/excalidraw/references/` e é Python `>=3.11` com `uv`, Playwright e Pillow.
- Comandos de setup/render do renderer, a partir de `opencode/skills/excalidraw/references/`: `uv sync`, `uv run playwright install chromium`, `uv run python render_excalidraw.py <arquivo.excalidraw>`.
- `.gitignore` ainda ignora `.agents/skills/excalidraw/references/.venv/`; se usar venv sob `opencode/skills/...`, confira antes de commitar.

## Validação

- Não há suíte geral. Para mudanças em agentes/skills, valide lendo o frontmatter e a renderização Markdown; para Excalidraw, rode o renderer quando alterar JSON ou referências executáveis.
