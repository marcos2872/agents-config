# AGENTS.md

## Escopo do repo

- Este checkout é o **pacote Pi** das minhas skills, prompts e extensões: `package.json` na raiz declara o manifesto `pi` e o conteúdo fica em `pi/`. Não há CI, build nem lint na raiz.
- O repo é instalado com `pi install` e **carregado no lugar** — não há cópia para o agent dir. Editar uma skill e rodar `/reload` já vale; o `sync.sh` existe para primeira instalação e para o ai-memory, não para cada mudança.
- `.pi/` é config local do projeto (ignorada pelo Git): artefatos gerados em runtime ficam lá, nunca versionados.

## Estrutura

| Caminho | O que é |
|---|---|
| `package.json` | Manifesto `pi`: `extensions` → `./pi/extensions/{guard,quota}.ts`, `skills` → `./pi/skills`, `prompts` → `./pi/prompts` |
| `pi/skills/<nome>/SKILL.md` | Skill: frontmatter `name` + `description` (até 1024 caracteres) e recursos auxiliares no próprio diretório |
| `pi/prompts/*.md` | Prompt template: frontmatter `description` e `argument-hint` opcional; nome do arquivo = comando; corpo usa `$1`, `$@`, `${@:-default}` |
| `pi/extensions/guard.ts` | Extensão que aplica as regras de `pi/lib/guard-rules.ts` em `bash`/`powershell` e `read`/`write`/`edit` |
| `pi/extensions/quota.ts` | `/cota` (e `/cota fechar`) + rodapé com as cotas do GitHub Copilot e do OpenCode Go; lê `auth.json` (só leitura) e consulta os endpoints de uso a cada 10 min |
| `pi/lib/guard-rules.ts` | Regras puras (sem API do Pi), testadas por `pi/lib/guard-rules.test.ts` |
| `pi/lib/quota.ts` | Parsers e formatação das cotas, testados por `pi/lib/quota.test.ts` |
| `sync.sh` / `sync.ps1` / `sync.cmd` | Instalação: pacote + ponytail + context7 + ai-memory |

- **Skills nunca gravam na própria pasta.** Elas são globais e compartilhadas entre projetos: dados do projeto vão para `<projeto>/.agents/<skill>/` e o que se baixa uma vez por máquina vai para `~/.cache/skill-kit`.
- Skills do ai-memory (`ai-memory-*`) e as pessoais (`msbos`, `noctalia-plugin`) ficam em `~/.agents/skills`, gerenciadas por `ai-memory install-skills` ou à mão; o Pi as descobre sozinho e elas **não** são duplicadas aqui.
- Skills atuais: `er-diagram-generator`, `git-commit-push`, `mapa-de-requisitos`, `planning`, `technical-documentation-generator`, `uml-class-diagram-generator`.
- Quatro arquivos são **cópia idêntica** entre `pi/skills/er-diagram-generator/scripts/` e `pi/skills/uml-class-diagram-generator/scripts/`: `fontes.py`, `leitor_csharp.py`, `logico.py` e `vendor.sh`. A duplicação é proposital (cada skill precisa funcionar sozinha), mas exige disciplina: corrija um e copie sobre o gêmeo, nunca edite os dois à mão. `pi/skills/er-diagram-generator/tests/test_copias_espelhadas.py` falha quando eles divergem.
- As skills são escritas para o Pi: usam as ferramentas `read`, `bash`, `edit` e `write`, e caminhos do agent dir usam `${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}`. Não há ferramenta `question` embutida — perguntas e aprovação são no chat.

### Saíram no cutover para o Pi

`opencode/agents/msbos-chat.md`, `opencode/cli.json`, `opencode/opencode.json`, `opencode/plugins/go-usage/`, o plugin `ai-memory-opencode2.ts` versionado e o Browser Relay. O `msbos-chat` era um perfil do OpenCode (o Pi não tem perfis de agente primário): o ritual vive na skill `msbos` e os freios na extensão `guard`. O Browser Relay será portado no repo oficial `marcos2872/opencode-browser-extension`.

## Instalação e runtime

- `./sync.sh [agent-dir]` (Linux/macOS) e `sync.ps1 [-AgentDir]` / `sync.cmd` (Windows) fazem: `pi install <repo>`, `pi install npm:@dietrichgebert/ponytail`, `pi mcp add context7` e o ai-memory. Tudo é idempotente.
- Agent dir padrão: `${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}`. O pacote fica declarado em `packages` com caminho **relativo ao agent dir**; se o repo for movido, o sync avisa e basta rodá-lo de novo.
- **ai-memory:** instalado e configurado pelo sync (`init`, `bind = "127.0.0.1:49375"`, `language = "pt-BR"`, `setup --yes --agent pi`). Roda como serviço systemd user `ai-memory.service`, dados em `~/.local/share/ai-memory` e skills em `~/.agents/skills`. A extensão `extensions/ai-memory-pi.ts` é **gerada** por `ai-memory setup` — não versionar nem editar à mão.
- A porta 49375 é nossa; o padrão do ai-memory (49374) pode estar em uso por outro harness.
- **ponytail:** `@dietrichgebert/ponytail` instalado como pacote do Pi; injeta a regra em todo turno (nível `full`), as skills `ponytail*` e os comandos `/ponytail*`. Nada disso é copiado para `pi/skills/`. Nível: `/ponytail lite|full|ultra|off`.
- **guard:** bloqueia `sudo`, `rm -rf /`, `git push -f/--force`, `.env*` e `.ssh`. Não é sandbox: a proteção real é rodar o Pi com usuário ou container restrito.
- **cota:** a extensão lê as credenciais do `auth.json` do agent dir (`github-copilot.refresh` e `opencode-go.key`) e só faz `GET`; os endpoints (`copilot_internal/user` e `zen/go/v1/usage`) não são públicos, então falha vira aviso e o último valor bom fica no rodapé. Nada da cota entra no contexto do modelo.
- **MCP:** só `context7` no `mcp.json`; o ai-memory chega por extensão (o Pi não usa `mcp.json` para ele).
- Não há instruções globais versionadas: o `AGENTS.md` de cada projeto é a fonte. O `AGENTS.md` desta raiz vale só para este repo.

## Convenções

- Conteúdo e comentários em português brasileiro; identificadores de código podem ficar em inglês.
- Testes seguem a regra do ponytail: lógica com branch, loop, parser, dinheiro ou segurança deixa um teste pequeno; validação em fronteira de confiança, tratamento de erro, segurança e acessibilidade nunca são cortados.
- Commits seguem Conventional Commits; use a skill `git-commit-push` quando o usuário pedir commit, push ou PR.
- Revisão de diff/PR e auditoria do repo: `/ponytail-review` e `/ponytail-audit`. Planejamento multi-etapa: skill `planning`. Documentação técnica: skill `technical-documentation-generator`.
- Antes de declarar uma tarefa concluída, mostre a evidência da validação (comando e resultado).

## Memória do projeto

- Memória de longo prazo via ai-memory (extensão/MCP `ai-memory`): consulte com `memory_query` antes de responder sobre histórico/decisões; grave com `memory_write_page` só quando o usuário pedir explicitamente.
- Preferências que valem em todos os projetos → `memory_write_page` com `scope: "profile"`; fatos globais → `scope: "global"`.
- Handoffs: `memory_handoff_begin` ao encerrar; `memory_handoff_list`/`memory_handoff_accept` ao retomar.

## Validação

```bash
bash -n sync.sh && git diff --check
python3 -m json.tool package.json >/dev/null
node --test pi/lib/guard-rules.test.ts pi/lib/quota.test.ts
cd pi/skills/er-diagram-generator && python3 -m unittest discover -s tests   # 17 testes
```

- Frontmatter: toda `pi/skills/*/SKILL.md` precisa de `name` e `description`; todo `pi/prompts/*.md` precisa de `description` e não pode ter campos de outro runtime (`agent`, `model`, `subagent`).
- Instalação de teste, sem tocar no agent dir real:

```bash
pi --agent-dir /tmp/pi-test install . && pi --agent-dir /tmp/pi-test list
```

- No Windows, valide o parse: `[scriptblock]::Create((Get-Content -Raw .\sync.ps1))` (o `sync.ps1` é salvo em UTF-8 com BOM por causa dos acentos no PowerShell 5.1).
