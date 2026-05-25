# AGENTS.md

## Estrutura do Repositório

Este repo contém configuração para **dois agentes distintos** que não compartilham código:

```
pi-config/
├── pi/                    ← Configuração do agente "pi" (shittycodingagent.ai)
│   ├── extensions/        ← Plugins TypeScript carregados via jiti em runtime
│   ├── agents/agents/     ← Definições de agentes (subdir + SKILL.md por agente)
│   ├── agents/skills/     ← Skills reutilizáveis (subdir + SKILL.md por skill)
│   └── docs/              ← Documentação do pi
└── opencode/              ← Configuração do OpenCode (este agente)
    ├── agents/            ← Arquivos .md flat (um por agente, sem subdiretório)
    └── skills/            ← Skills com SKILL.md (subdir por skill)
```

**Não confundir os dois sistemas.** As extensões em `pi/extensions/` são exclusivas do runtime do pi e não se aplicam ao OpenCode.

## Setup

Nenhum `package.json`, build ou teste automatizado na raiz.

**pi:**
```bash
npm install -g @mariozechner/pi-coding-agent
ln -s ~/pi-config/pi/extensions ~/.pi/agent/extensions
ln -s ~/pi-config/pi/agents ~/agents          # agentes globais
# atualizar ~/.pi/agent/settings.json — ver pi/docs/configure.md
```

**RTK para pi:** `/rtk-reload` (comando pi em runtime)
**RTK para OpenCode:** `rtk init -g --opencode` → reiniciar OpenCode
**RTK no Linux:** após instalação via script, garantir `~/.local/bin` no `PATH`

## Extensões pi (`pi/extensions/`)

- Carregadas via **jiti** — sem compilação TypeScript, nunca rodar `tsc`
- **Entry point obrigatório:** `export default function (pi: ExtensionAPI): void`
- Hooks `pi.on()` devem retornar objeto de modificação (`{ systemPrompt }`, `{ block, reason }`) ou `undefined` — **nunca lançar exceção**
- Estado de módulo reiniciado a cada `/reload`
- Limite: funções ≤ 40 linhas, arquivos ≤ 300 linhas, aninhamento ≤ 3 níveis
- Guard de escrita: `write` em arquivo existente com > 40.000 chars ou > 600 linhas é bloqueado — use `edit` incremental

## Agentes e Skills pi (`pi/agents/`)

Estrutura obrigatória:
```
agents/agents/<nome>/SKILL.md   # frontmatter: name, description
agents/skills/<nome>/SKILL.md   # frontmatter: name, description
```

Conteúdo do SKILL.md truncado em 8.000 chars (`MAX_SKILL_CHARS`).

Descoberta via `pi/extensions/agents-resolver.ts`: prioridade `{cwd}/agents/` → fallback `~/agents/`.

## Agentes OpenCode (`opencode/agents/`)

Arquivos `.md` flat (sem subdiretório). Frontmatter diferente do pi:
```yaml
---
description: "<string>"
mode: primary | subagent
permission:
  edit: allow | deny | { "*": deny, "path/*": allow }
  bash: allow | ask | { "*": deny, "cmd *": allow }
  read: allow
---
```

Agentes disponíveis: `ask`, `geral`, `qa`, `quality`, `test`
(OpenCode **não tem** agentes `build` ou `plan` — diferente do pi)

## Skills OpenCode (`opencode/skills/`)

```
opencode/skills/<nome>/SKILL.md   # frontmatter: name, description, argument-hint (opcional)
```

Convenção: agentes `qa`, `quality` e `test` carregam `code-conventions` primeiro. Para documentação, usar a skill `doc` diretamente (não há agente dedicado).

## Saída de Auditoria

- **pi:** `.pi/audit/` e `.pi/plans/` (no .gitignore)
- **OpenCode:** `.opencode/audit/` (**não está** no .gitignore — cuidado ao criar arquivos de auditoria)

## Convenções de Código

- Comentários e conteúdo user-facing: **português brasileiro**
- Identificadores (variáveis, funções, classes): **inglês**
- Commits: **Conventional Commits** — usar skill `git-commit-push`

## Validação

Não há CI, linter automático ou suite de testes. Validação de extensões pi é manual:
```bash
node -e "require('./pi/extensions/nome.ts')"   # smoke test isolado
```
