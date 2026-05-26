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

## Não versionar

- Login, tokens ou credenciais
- Cache e estado local do Zed
- Histórico de projetos recentes
- Arquivos gerados em runtime
