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
- O plugin `opencode/plugins/ai-memory-opencode2.ts` é gerado por `ai-memory install-hooks --agent opencode --apply` e versionado como fallback; o sync roda `ai-memory setup --yes --agent opencode` no fim e regenera o plugin conforme o binário instalado. Após upgrade do ai-memory, regenere e re-copie o arquivo.
- Config versionada do runtime fica em `opencode/opencode.json`, em formato nativo V2 (`permissions`, `plugins`, `mcp.servers`); os MCPs são `context7` e `ai-memory` (bridge stdio para `http://127.0.0.1:49375/mcp`).
- Config do terminal (tema etc.) fica em `opencode/cli.json` e é sempre global; não existe config de CLI por projeto.
- Não há mais instruções globais versionadas: `opencode/AGENTS.md` foi removido e o sync não o copia. As instruções de cada projeto ficam no `AGENTS.md` da raiz dele; o `AGENTS.md` desta raiz vale apenas para este repo. Um `~/.config/opencode/AGENTS.md` antigo não é apagado pelo sync (só gera aviso).
- Frontmatter de agente usa `description`, `mode: primary | subagent`, `model` e `permissions` (array V2 ordenado); o formato legado `permission:`/`temperature` não é usado.
- Frontmatter de skill usa `name`, `description` e opcionalmente `argument-hint`.
- Frontmatter de command usa `description`, opcionalmente `agent`, `model` e `subagent`.
- Agente versionado atualmente: `msbos-chat` (primary). Os papéis de review, debug, planejamento e exploração são skills; a delegação usa os subagentes embutidos `explore` e `general`.
- Skills versionadas atualmente: `code-conventions`, `code-review`, `er-diagram-generator`, `git-commit-push`, `mapa-de-requisitos`, `planning`, `spec-kit`, `subagents`, `technical-documentation-generator`, `uml-class-diagram-generator`, `verify`.
- `code-conventions` **dita as regras** de qualidade (SOLID, Clean Code, DDD, TDD, Clean Architecture) para consulta **enquanto se programa** — não revisa diff nem audita; isso é `code-review`.
- `verify` cobre três situações num só arquivo: **conclusão** (exige evidência de teste/lint antes de dizer que terminou), **diagnóstico** (causa raiz sem editar) e **correção** (a menor mudança, só quando o pedido autoriza). O comando `/test` é o atalho de correção. A antiga skill `debugging` foi fundida nela.
- `technical-documentation-generator` tem dois perfis: **catálogo por tema** (ADR em `docs/adr/`, endpoints, models, componentes, rotas, estado, arquitetura, eventos, config, segurança, erros, índice e README) e **consolidado de módulo** (README técnico + anexo de DTOs a partir do Swagger). A antiga skill `doc` foi fundida nela; os templates do catálogo vieram de lá.
- A skill `code-review` tem dois modos: mudança (diff/PR) e repositório inteiro (auditoria). O conteúdo vem das skills `ponytail-review` e `ponytail-audit` do [ponytail](https://github.com/DietrichGebert/ponytail) v5.3.3, fundidas com o procedimento local. O corpo da regra ficou em inglês (pedido explícito), mas a `description` e o relatório de saída seguem o idioma do projeto (pt-BR). O aviso MIT está em `opencode/skills/code-review/LICENSE-ponytail.txt`. O resto do pacote ponytail (níveis, hooks, plugin, `AGENTS.md` compacto) não foi adotado.
- Skills do ai-memory (`ai-memory-retrieval`, `ai-memory-durable-pages`, `ai-memory-handoff`, `ai-memory-messaging`, `ai-memory-learning-maintenance`, `ai-memory-routing-install`) ficam em `~/.agents/skills` e são gerenciadas por `ai-memory install-skills`; não são duplicadas em `opencode/skills/`.
- Skills nunca gravam na própria pasta: ela é global, compartilhada e o sync a substitui. Dados de projeto vão para `<projeto>/.agents/<skill>/`; o que se baixa uma vez por máquina (ELK, fontes, `node_modules`) vai para `~/.cache/skill-kit`. Bytecode Python é desligado (`sys.dont_write_bytecode = True`) nos scripts que importam módulos irmãos, e `raiz()` recusa resolver para dentro da skill.
- As skills são escritas para OpenCode. Recursos auxiliares ficam sob `~/.config/opencode/skills/<skill>`; caminhos específicos de runtime usam os nomes das ferramentas e subagentes do OpenCode. Todo o conteúdo está em português brasileiro, exceto o corpo da regra de `code-review` (inglês, a pedido).
- Quatro arquivos são **cópia idêntica** entre `er-diagram-generator/scripts/` e `uml-class-diagram-generator/scripts/`: `fontes.py`, `leitor_csharp.py`, `logico.py` e `vendor.sh`. A duplicação é proposital (cada skill precisa funcionar sozinha), mas exige disciplina: corrija um e copie sobre o gêmeo, nunca edite os dois à mão. `opencode/skills/er-diagram-generator/tests/test_copias_espelhadas.py` falha quando eles divergem.

## Instalação e runtime

- A instalação/sync é feita por `sync.sh` (Linux/macOS) ou `sync.ps1`/`sync.cmd` (Windows), que copiam `opencode/` para `~/.config/opencode/` (ou destino passado como argumento, ex.: `.opencode/` de um projeto), substituindo o que existir com backup em `backup-<data>/`.
- Depois da cópia, o sync garante o ai-memory: instala o binário oficial (`~/.local/bin/ai-memory` no Linux/macOS, `%LOCALAPPDATA%\Programs\ai-memory` no Windows) se faltar, roda `init` numa instalação nova, fixa `bind = "127.0.0.1:49375"` e `language = "pt-BR"`, e aplica `ai-memory setup --yes --agent opencode` (serviço do usuário, MCP, plugin e skills, com detecção automática V1/V2). A porta 49375 evita o conflito com o serviço do OpenCode V2, que usa 49374.
- O sync reinicia automaticamente o serviço do OpenCode ao terminar quando o binário `opencode` está no `PATH`; se plugins forem alterados manualmente fora do sync, rode `opencode service restart`.
- O ai-memory roda como serviço systemd user `ai-memory.service` em `127.0.0.1:49375`, com dados/wiki em `~/.local/share/ai-memory`; as skills globais dele ficam em `~/.agents/skills` e são gerenciadas por `ai-memory install-skills`.
- O Browser Relay, o agente mínimo e a skill não são duplicados em `opencode/`: `sync.sh`/`sync.ps1` baixam a última release estável de `marcos2872/opencode-browser-extension`, validam o SHA-256 e instalam o pacote. A extensão compilada fica sob `${XDG_DATA_HOME:-$HOME/.local/share}/opencode-browser-extension/` (Windows: `XDG_DATA_HOME` ou `%USERPROFILE%\.local\share`); o sync imprime o caminho `extension/` para carregar no Chrome. O pacote é a fonte de verdade de relay, agente e skill.
- O sync do Browser Relay requer Node.js 20+ e `unzip` em Linux/macOS; no Windows a extração usa `Expand-Archive` do PowerShell.
- O perfil de permissões é "flow" (shell liberado) com regras `deny` explícitas (sudo, rm -rf /, push forçado); não remova esses denies sem combinar.
- RTK é opcional: rode `rtk init -g --opencode` e reinicie o OpenCode; no Linux, garantir `~/.local/bin` no `PATH` se instalado via script.

## Convenções importantes

- Conteúdo user-facing e comentários devem ficar em português brasileiro; identificadores em exemplos de código podem ficar em inglês.
- `qa`, `quality` e `test` exigem carregar a skill `code-conventions` antes da análise/escrita de testes.
- Para documentação técnica, use a skill `technical-documentation-generator`; não existe agente dedicado de documentação neste repo.
- Commits devem seguir Conventional Commits; use a skill `git-commit-push` quando o usuário pedir commit, push ou PR.
- Antes de declarar uma tarefa concluída, siga a skill `verify` e mostre a evidência (comando e resultado).
- Antes de mudanças multi-etapa, use a skill `planning`; antes de revisar ou auditar, a skill `code-review`; para decidir delegação, a skill `subagents`.

## Memória do projeto

- Memória de longo prazo via ai-memory (MCP `ai-memory`): consulte com `memory_query` antes de responder sobre histórico/decisões; grave com `memory_write_page` só quando o usuário pedir explicitamente.
- Preferências que valem em todos os projetos → `memory_write_page` com `scope: "profile"`; fatos globais → `scope: "global"`.
- As memórias do antigo plugin `memory.ts` foram importadas para páginas em `notes/opencode-memory/` (tag `opencode-import`); o plugin foi removido no cutover.
- Serviço local em `http://127.0.0.1:49375`; dados/wiki em `~/.local/share/ai-memory`.

## Validação

- Não há suíte geral. Para mudanças em skills/commands/agentes, valide lendo o frontmatter e a renderização Markdown.
- Para os scripts das skills de diagrama, rode `cd opencode/skills/er-diagram-generator && python3 -m unittest discover -s tests` — os testes cobrem o parser lógico, os leitores de entidades e a igualdade dos arquivos espelhados.
- Para `opencode/opencode.json`, valide o JSON (por exemplo, com `jq`) e confira os campos contra a documentação V2 (`https://opencode.ai/v2/docs/`).
- Para os scripts de sync, rode `bash -n sync.sh` e `git diff --check`; no Windows, valide o parse do `sync.ps1` com `[scriptblock]::Create((Get-Content -Raw .\sync.ps1))`.
