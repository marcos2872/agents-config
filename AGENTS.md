# AGENTS.md

## Escopo do repo

- Este checkout centraliza configuração do OpenCode em `opencode/` e do Zed em `zed/`; não há `package.json`, CI, build, lint ou teste automatizado na raiz.
- `.opencode/` é ignorado pelo Git; use-o só para artefatos locais/auditorias geradas em runtime, não para configuração versionada.

## Estrutura OpenCode

- Agentes ficam em `opencode/agents/*.md` como arquivos flat, sem subdiretório por agente.
- Skills ficam em `opencode/skills/<nome>/SKILL.md`; recursos auxiliares da skill ficam dentro do próprio diretório da skill.
- Config versionada do runtime fica em `opencode/opencode.json`; config do plugin de memória fica em `opencode/opencode-mem.jsonc`.
- Frontmatter de agente usa `description`, `mode: primary | subagent` e `permission`; frontmatter de skill usa `name`, `description` e opcionalmente `argument-hint`.
- Agentes versionados atualmente: `ask`, `geral`, `qa`, `quality`, `test`. Não referencie agentes inexistentes como `build` ou `plan`.
- Skills versionadas atualmente: `code-conventions`, `doc`, `excalidraw`, `git-commit-push`.

## Instalação e runtime

- A instalação usa symlinks de `opencode/agents` e `opencode/skills` para `~/.config/opencode/` ou `.opencode/` do projeto alvo.
- Para ativar memória persistente, symlink também `opencode/opencode.json` e `opencode/opencode-mem.jsonc` em `~/.config/opencode/`; reinicie o OpenCode após alterar configs/plugins.
- RTK é opcional: rode `rtk init -g --opencode` e reinicie o OpenCode; no Linux, garantir `~/.local/bin` no `PATH` se instalado via script.

## Estrutura Zed

- Config versionada do editor fica em `zed/settings.json`; temas customizados ficam em `zed/themes/`.
- Para ativar globalmente, use symlinks para `~/.config/zed/settings.json` e `~/.config/zed/themes`; faça backup dos arquivos reais antes de substituir.
- Não versionar estado local do Zed, cache, login, histórico de projetos ou arquivos que contenham tokens.

## Plugin opencode-mem

- `opencode/opencode.json` carrega `opencode-mem` via `plugin: ["opencode-mem"]`; se houver config global existente, mescle esse campo em vez de sobrescrever o arquivo do usuário.
- `opencode/opencode-mem.jsonc` usa `opencodeProvider: "github-copilot"` e `opencodeModel: "gpt-5.5"`; a interface web padrão fica em `http://127.0.0.1:4747`.

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
