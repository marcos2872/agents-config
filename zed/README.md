# zed config

Configurações versionadas para o [Zed](https://zed.dev/).

## Instalação global

Faça backup dos arquivos reais e crie symlinks em `~/.config/zed/` apontando para este diretório:

```bash
REPO=~/Projects/agents-config

mv ~/.config/zed/settings.json ~/.config/zed/settings.json.bak
mv ~/.config/zed/themes ~/.config/zed/themes.bak

ln -s "$REPO/zed/settings.json" ~/.config/zed/settings.json
ln -s "$REPO/zed/themes" ~/.config/zed/themes
```

Qualquer `git pull` reflete na próxima leitura de configuração do Zed.

## Arquivos versionados

| Caminho | Descrição |
|---|---|
| `settings.json` | Preferências do editor, tema e extensões auto-instaladas |
| `themes/` | Temas customizados do Zed |

## Tema

| Modo | Tema |
|---|---|
| light | `One Light` |
| dark | `Claude Code Inspired Dark` |

## Extensões auto-instaladas

| Extensão |
|---|
| `claude-code-inspired-dark` |
| `colored-zed-icons-theme` |
| `csv` |
| `docker-compose` |
| `dockerfile` |
| `git-firefly` |
| `github-actions` |
| `html` |
| `log` |
| `make` |
| `nginx` |
| `ssh-config` |
| `sql` |
| `toml` |
| `xml` |

## Skills globais para o Zed Agent

O Zed reconhece skills em `~/.agents/skills/<nome>/SKILL.md` ([documentação](https://zed.dev/docs/ai/skills)).
Para ativar as skills do OpenCode no Zed, crie symlinks:

```bash
REPO=~/Projects/agents-config

mkdir -p ~/.agents/skills

ln -s "$REPO/opencode/skills/code-conventions" ~/.agents/skills/code-conventions
ln -s "$REPO/opencode/skills/doc"              ~/.agents/skills/doc
ln -s "$REPO/opencode/skills/excalidraw"       ~/.agents/skills/excalidraw
ln -s "$REPO/opencode/skills/git-commit-push"  ~/.agents/skills/git-commit-push
```

Após criar os links, as skills aparecem automaticamente no Zed Agent e podem ser invocadas via `/skill-name` ou `@skill` no editor de mensagens.

> **Nota:** O Zed não suporta "agentes customizados" como o OpenCode. Para instruções globais permanentes, use `~/.config/zed/AGENTS.md`. Para instruções por projeto, use `.rules` ou `AGENTS.md` na raiz do worktree.

## Não versionar

- Login, tokens ou credenciais
- Cache e estado local do Zed
- Histórico de projetos recentes
- Arquivos gerados em runtime
