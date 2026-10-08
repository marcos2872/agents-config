# agents-config

README global das configurações versionadas do OpenCode.

## Conteúdo

- `opencode/` — agentes, skills, commands, plugins, configuração global (`opencode.json`) e de terminal (`cli.json`) do OpenCode.
- `.opencode/` — cópia local por projeto quando necessário.

## OpenCode

### Configuração global

O OpenCode lê os agentes, skills, commands, plugins e config a partir de symlinks em `~/.config/opencode/`.

A configuração versionada principal fica em:

```text
opencode/opencode.json
```

Ela usa o formato nativo do OpenCode V2: `permissions` (regras ordenadas), `mcp.servers` e `plugins`.

As preferências do terminal (tema etc.) ficam em `opencode/cli.json` e são sempre globais — não existe config de CLI por projeto. Tema padrão: `system` (segue a paleta do terminal).

### Instalação global

```bash
REPO=/home/marcos/Projetos/agents-config

mkdir -p ~/.config/opencode
ln -s "$REPO/opencode/agents" ~/.config/opencode/agents
ln -s "$REPO/opencode/skills" ~/.config/opencode/skills
ln -s "$REPO/opencode/commands" ~/.config/opencode/commands
ln -s "$REPO/opencode/plugins" ~/.config/opencode/plugins
ln -s "$REPO/opencode/opencode.json" ~/.config/opencode/opencode.json
ln -s "$REPO/opencode/cli.json" ~/.config/opencode/cli.json
```

Se algum arquivo de destino já existir (ex.: `cli.json`), faça backup e substitua pelo symlink.

Depois de adicionar novos arquivos via symlink, pode ser necessário `opencode service restart` para o runtime carregá-los.

Qualquer `git pull` ou alteração em `opencode/opencode.json` reflete imediatamente nas sessões do OpenCode.

### Instalação local por projeto

Crie symlinks (ou copie) dentro de um projeto específico em `.opencode/`:

```bash
REPO=/home/marcos/Projetos/agents-config

mkdir -p .opencode
ln -s "$REPO/opencode/agents" .opencode/agents
ln -s "$REPO/opencode/skills" .opencode/skills
ln -s "$REPO/opencode/commands" .opencode/commands
ln -s "$REPO/opencode/plugins" .opencode/plugins
```

Agentes e skills locais têm prioridade sobre os globais.

## Agentes disponíveis

| Agente | Modo | Descrição |
|---|---|---|
| `ask` | primary | Responde perguntas sem modificar nada |
| `reviewer` | subagent | Revisa diffs sem editar; modelo mais forte para revisão |
| `debugger` | subagent | Investiga falhas e aplica a correção mínima com evidência |
| `explore` | subagent | Explora o código com modelo barato (sobrepõe o embutido) |
| `planner` | subagent | Produz plano de implementação sem editar código |

Alterne entre agentes primários com **Tab**. Subagentes são acionados pelo agente principal (tool `subagent`) ou por commands.

Os subagentes `reviewer`, `explore` e `planner` fixam modelos do provedor `opencode-go`; ajuste ou remova o campo `model` no frontmatter se preferir herdar o modelo da sessão.

## Skills disponíveis

| Skill | Descrição |
|---|---|
| `code-conventions` | Convenções de código, qualidade, testes e arquitetura |
| `doc` | ADRs, inventário de serviços, APIs, rotas e documentação técnica |
| `git-commit-push` | Commit Conventional Commits, push e PR |
| `verify` | Exige evidência de teste/lint antes de declarar concluído |

## Commands disponíveis

| Command | Descrição |
|---|---|
| `/init-agents` | Gera/atualiza o `AGENTS.md` do projeto |
| `/memory` | Lista e gerencia as memórias do projeto (plugin `memory.ts`) |
| `/review` | Revisão estruturada das mudanças atuais |
| `/test` | Roda a suíte relevante e corrige falhas |
| `/commit` | Commit convencional com staging seletivo (skill `git-commit-push`) |
| `/pr` | Cria Pull Request com descrição estruturada |

## Perfil de permissões

O `opencode/opencode.json` usa o perfil "flow": `shell` liberado por padrão, com regras `deny` para `sudo`, `rm -rf /`, `git push --force`/`-f`, `.ssh` e `.env`. Um `deny` configurado não é removido por aprovações "allow sempre".

> Nota de validação: a doc V2 documenta `experimental.policies` com `action: "permission"`, mas o runtime v2.0.26 aceita apenas `provider.use`, `tool.use` e `integration.use` — statements com `permission` são descartados com warning no log. Por isso os hard-denies ficam em `permissions`.

Para o perfil mais restrito (pergunta antes de cada comando shell), troque a primeira regra para `"effect": "ask"`:

```json
{ "action": "shell", "resource": "*", "effect": "ask" }
```

Opcional: ative o scanner portátil de shell com `"experimental": { "portable_shell_scanner": true }` — comandos que o scanner não conseguir analisar falham com erro de scanner (não é uma negação de permissão).

## Plugins

Plugins locais ficam em:

```text
opencode/plugins/*.ts
opencode/plugins/*.js
opencode/plugins/<pacote>/index.ts
```

São auto-descobertos quando o diretório é symlinkado para `~/.config/opencode/plugins/`.

### Memória de projeto (`memory.ts`)

Plugin próprio de memória durável por projeto (equivalente ao auto memory do Claude Code):

- Tools `memory_write`, `memory_list` e `memory_delete` — o agente salva, lista e remove notas do projeto.
- As memórias são injetadas automaticamente no contexto de cada request (bloco `<project-memory>`).
- Armazenamento no `ctx.storage` do OpenCode, com escopo por `projectID` (máx. 50 memórias por projeto).
- Não é preciso listar o plugin em `opencode.json` — `plugins/` é auto-descoberto (listar também não duplica, se um dia precisar passar `options`).
- O comando `/init-agents` inclui a seção "Memória do projeto" (com a regra de uso das tools) no `AGENTS.md` gerado.

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
