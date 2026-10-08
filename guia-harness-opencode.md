# Como deixar o harness do OpenCode no nível do Claude Code

> Pesquisa profunda — OpenCode **v2.0.26** (seu setup) contra Claude Code (2026).
> Fontes primárias: documentação oficial OpenCode V2 (`opencode.ai/v2/docs`), docs do
> Claude Code (`code.claude.com/docs`), ecossistema (awesome-opencode, npm) e issues do
> repositório opencode. Links no final.

---

## 1. TL;DR — o que fazer (em ordem de impacto)

| # | Ação | Impacto | Custo |
|---|------|---------|-------|
| 1 | Criar `~/.config/opencode/AGENTS.md` global + `AGENTS.md` por projeto | ⭐⭐⭐⭐⭐ | 15 min |
| 2 | Blindar `~/.config/opencode/opencode.jsonc`: permissões, policies, formatter, compaction | ⭐⭐⭐⭐⭐ | 10 min |
| 3 | Criar subagentes (`reviewer`, `explorer`, `debugger`, `planner`) | ⭐⭐⭐⭐ | 20 min |
| 4 | Criar commands globais (`/review`, `/commit`, `/test`, `/pr`, `/init-agents`) | ⭐⭐⭐⭐ | 20 min |
| 5 | Instalar **plugin de hooks compatível com Claude Code** (V2-nativo — código neste guia) | ⭐⭐⭐⭐⭐ | 30 min |
| 6 | MCPs essenciais: `context7` + `playwright` (+ fonte de conhecimento da empresa) | ⭐⭐⭐ | 10 min |
| 7 | Plugins de UX: statusline, notify, OTEL, context pruning, memória | ⭐⭐⭐ | 15 min |
| 8 | Adotar fluxos: plan agent, `/undo`, worktrees nativos, background subagents | ⭐⭐⭐ | — |

**Seu estado atual:** V2.0.26, config global quase vazia (só `$schema`), skills vindas
de `~/.claude/skills` (code-conventions, git-commit-push, sdd) já são auto-descobertas
pelo V2 ✅, nenhum plugin/AGENTS.md configurado.

---

## 2. Mapa de paridade: Claude Code ↔ OpenCode V2

Legenda: ✅ paridade · ⚠️ parcial (dá para cobrir com plugin/config) · ❌ lacuna real

| Recurso do Claude Code | Equivalente no OpenCode V2 | Status |
|---|---|---|
| `CLAUDE.md` (global/projeto/local) | `AGENTS.md` (global + hierarquia até o workspace + lazy em subdiretórios) | ⚠️ sem `@imports`, sem `CLAUDE.local.md` |
| `.claude/rules/*.md` (path-scoped) | Não nativo — cobrir com skills + `AGENTS.md` aninhado ou plugin | ⚠️ |
| Auto memory (notas que o próprio agente grava) | Não nativo — plugins da comunidade (claude-memory, agent-memory, mnemoria) ou plugin próprio | ❌ |
| `/init`, `/memory`, `/doctor`, `/context` | Só via commands customizados | ⚠️ |
| **Hooks** (~30 eventos, JSON stdin/stdout, exit codes) | Plugin API V2: `tool.hook("execute.before/after")`, `permission.hook("evaluate")`, `shell.hook("create.before")`, `session.hook("prompt"/"context"/"compaction"/"title"/"retry"/"http.*"/"model.request")`, stream de eventos | ⚠️ ~70% via plugin (ponte neste guia) |
| Hooks `Stop` re-ativando o agente (exit 2) | Issue nativa aberta ([#12472](https://github.com/anomalyco/opencode/issues/12472)); emulação experimental via `session.prompt` | ❌ |
| Subagents (contexto próprio, modelo, tools, permissions) | `agents` com `mode: subagent`, `model`, `permissions`, `steps`; foreground/background | ✅ (sem memória própria por agente nem `isolation: worktree` por agente) |
| Skills (`SKILL.md`) | Nativo + compat `~/.claude/skills` e `.claude/skills` + catálogos HTTP + `autoinvoke` + permissões | ✅ |
| Slash commands | `commands` com `$ARGUMENTS`, `$1..$n`, blocos shell `` !`cmd` ``, `agent`, `model`, `subagent` | ✅ |
| Plugins & marketplace | `plugins` npm/git/local + CLI plugins (TUI) + registries da comunidade (awesomeopencode.com, opencode.cafe) | ✅ (sem marketplace oficial) |
| MCP (tools/prompts/resources, OAuth) | Nativo: local/remote, OAuth PKCE, timeouts, Code Mode, permissões por tool | ✅ |
| Permissões (allow/deny/ask + modos) | `permissions` ordenado (allow/deny/ask) + `experimental.policies` (hard-deny) + por agente | ✅ (sem "permission modes" prontos; emuláveis) |
| Checkpoints (`/rewind`) | Snapshots + `/undo` / `/redo` (restaura arquivos em repo git) | ✅ |
| Compaction (+ PreCompact hook) | `compaction` config + `session.hook("compaction")` (pode fornecer o próprio resumo) | ✅ |
| Statusline | TUI plugin (slots `prompt.footer.status`, etc.); plugins da comunidade | ⚠️ |
| Output styles | System prompt por agente (`agents.<id>.system`) | ⚠️ |
| Sandbox do Bash | ❌ nativo — usar permissões + scanner portátil, ou rodar em devcontainer/VM | ❌ |
| Background tasks (Ctrl+B) | `shell` com `background: true` + subagent `background: true` | ✅ |
| Web search/fetch | 5 provedores nativos (Exa, Firecrawl, Parallel, Tavily, TinyFish) | ✅ |
| OTel/métricas | Plugin comunitário `opencode-plugin-otel` | ⚠️ |
| LSP tools | ❌ V2 não roda LSP; usar typecheck/lint do projeto | ❌ |
| Browser automation | Nativo no app desktop (namespace `browser`) + MCP Playwright | ✅ |

### Gotchas importantes do V2

- O campo `instructions` do config **é aceito mas ignorado no V2** — use `AGENTS.md`.
- V2 **não lê `CLAUDE.md`** (só `AGENTS.md`). Se algum repo depende de `CLAUDE.md`, crie `AGENTS.md` (symlink resolve).
- **Plugins V1 não rodam no V2** (ex.: `opencode-hooks-plugin@0.1.0` é V1). Port necessário.
- `agents.*.request` (temperature etc.) ainda **não é enviado** nas requests no V2.
- Subagentes aninhados: profundidade padrão 1 (`experimental.subagent_depth`).

---

## 3. Camada 1 — Contexto e memória (AGENTS.md)

### 3.1 `~/.config/opencode/AGENTS.md` (global — criar)

```markdown
# Preferências globais

- Responda sempre em português do Brasil.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`...) em português.
- Nunca faça `git push --force` em branches compartilhadas; nunca commite `.env`.
- Antes de declarar concluído: rode o teste/lint relevante e mostre o resultado.
- Prefira `edit` para mudanças pontuais e `write` só para arquivos novos.
- Não crie arquivos de documentação sem pedido explícito.

# Fluxo de trabalho

- Tarefas multi-etapa: use o agente `plan` primeiro; só edite depois de plano aprovado.
- Para explorar código (sem editar), delegue ao subagente `explore`.
- Para revisar mudanças, use o subagente `reviewer`.
- Use `@skill-id` para carregar skills; skills disponíveis: code-conventions,
  git-commit-push, sdd, cua-driver.
```

### 3.2 `AGENTS.md` por projeto (equivalentes a CLAUDE.md)

A hierarquia do V2 carrega na ordem: global → raiz do projeto → subdiretórios (lazy,
quando o agente lê arquivos da área). Ou seja, a "memória por diretório" do Claude Code
já existe; o que não existe é `@import`.

Template de projeto:

```markdown
# <Projeto>

## Comandos
- Instalar: `npm install`
- Testes: `npm test`
- Lint/Typecheck: `npm run lint && npm run typecheck`

## Arquitetura
- `src/api/` — handlers HTTP; `src/core/` — regras de negócio (não importa infra).

## Convenções
- Erros sempre via `AppError` (src/core/errors.ts).
- Migrations em `db/migrations`, nunca editar as já aplicadas.
```

### 3.3 Auto-memory (o que o CC tem e falta aqui)

Opções, da mais simples à mais completa:

1. **Plugin comunitário** `opencode-claude-memory` (kuitos) — memória compatível com o formato do CC.
2. `opencode-agent-memory` / `oc-mnemoria` — memória persistente via plugin/vector store.
3. **Plugin próprio** (~40 linhas): usar `ctx.storage` + `session.hook("context")` para injetar
   um `MEMORY.md` no system a cada request, e expor uma tool `memory_write`. Ideal se
   quiser o mesmo contrato do CC ("Saved 2 memories"). Posso implementar sob demanda.

---

## 4. Camada 2 — Permissões e segurança

### 4.1 `~/.config/opencode/opencode.jsonc` — proposta completa

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode-go/deepseek-v4.1-flash",   // ajuste ao seu provedor
  "default_agent": "build",

  // ---------- Segurança ----------
  "permissions": [
    { "action": "shell", "resource": "*", "effect": "ask" },
    { "action": "shell", "resource": "git status *",  "effect": "allow" },
    { "action": "shell", "resource": "git diff *",    "effect": "allow" },
    { "action": "shell", "resource": "git log *",     "effect": "allow" },
    { "action": "shell", "resource": "ls *",          "effect": "allow" },
    { "action": "shell", "resource": "cat *",         "effect": "allow" },
    { "action": "shell", "resource": "rg *",          "effect": "allow" },
    { "action": "shell", "resource": "git push *",    "effect": "ask" },
    { "action": "read",  "resource": "*.env",         "effect": "ask" },
    { "action": "read",  "resource": "*/.ssh/*",      "effect": "deny" },
    { "action": "edit",  "resource": "*/.ssh/*",      "effect": "deny" },
    { "action": "webfetch", "resource": "*",          "effect": "allow" }
  ],

  // Hard-deny que nenhum "allow sempre" remove:
  "experimental": {
    "policies": [
      { "action": "permission", "resource": "shell:sudo *",              "effect": "deny" },
      { "action": "permission", "resource": "shell:rm -rf /*",           "effect": "deny" },
      { "action": "permission", "resource": "shell:git push --force *",  "effect": "deny" },
      { "action": "permission", "resource": "shell:git push -f *",       "effect": "deny" }
    ],
    "portable_shell_scanner": true
  },

  // ---------- Qualidade ----------
  "formatter": true,
  "tool_output": { "max_lines": 2000, "max_bytes": 51200 },
  "watcher": { "ignore": ["dist/**", "build/**", "coverage/**", ".next/**", "*.log"] },

  // ---------- Contexto ----------
  "compaction": { "auto": true, "keep": { "tokens": 20000 }, "buffer": 16000 },
  "snapshots": true,

  // ---------- Busca ----------
  "websearch": { "provider": "random" },

  // ---------- Plugins (descomente conforme instalar) ----------
  "plugins": [
    // "opencode-notify",
    // "opencode-statusline",
    // "./plugins/claude-hooks-bridge"
  ],

  // ---------- MCPs ----------
  "mcp": {
    "servers": {
      "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp" },
      "playwright": { "type": "local", "command": ["npx", "-y", "@playwright/mcp@latest"] }
    },
    "timeout": { "startup": 30000, "catalog": 30000, "execution": 600000 }
  },

  // ---------- Referências (diretórios externos nomeados) ----------
  "references": {
    "docs-produto": { "path": "../product-docs", "description": "Comportamento e terminologia do produto" }
  }
}
```

> **Modo "flow" (menos atrito):** troque `shell * → ask` por `allow` e mantenha apenas os
> `deny` de policies. É o mais próximo do default do Claude Code com `acceptEdits`.

### 4.2 O que isso cobre do CC

- `permissions.allow/deny/ask` do CC ⇒ `permissions` ordenado (última regra vence).
- `bypassPermissions`/`acceptEdits` ⇒ perfis de config (não há "modo" por sessão).
- Regras "Allow always" ficam salvas por projeto — igual ao CC.
- Sandbox real de filesystem/rede **não existe** no OpenCode: a alternativa é rodar em
  devcontainer/VM (há plugin comunitário de devcontainers) ou usar o scanner de shell +
  policy. Documente isso no AGENTS.md ("nunca rode X").

---

## 5. Camada 3 — Skills e Commands

### 5.1 Skills

Suas skills atuais em `~/.claude/skills` **já funcionam** no V2 (compat). Recomendação:

- Mover as definitivas para `~/.config/opencode/skills/<id>/SKILL.md` (precedência maior
  e independente do Claude Code). Ou manter — o V2 busca `.claude/skills` por compat.
- Skills com side-effect manual ganham `metadata: { "opencode/autoinvoke": false }` para
  não serem sugeridas sempre.
- Estrutura padrão: `SKILL.md` + `scripts/` + `references/` (caminhos relativos ao skill).

Skill nova que vale a pena: **`verify`** — obriga rodar testes/lint e colar evidência antes
de declarar pronto (equivalente comportamental do `Stop` hook do CC):

```markdown
---
name: Verify Before Done
description: Enforce test/lint evidence before declaring a task complete
---
1. Identifique o comando de teste/lint do projeto (AGENTS.md).
2. Rode-o na área afetada.
3. Se falhar: corrija e repita; se não puder, explique o bloqueio.
4. Só então responda, incluindo o comando e o resultado resumido.
```

### 5.2 Commands globais (`~/.config/opencode/commands/`)

Crie estes 5 arquivos (≈ equivalentes dos comandos do CC):

`init-agents.md`
```markdown
---
description: Gera/atualiza AGENTS.md do projeto
---
Analise este repositório (build, testes, convenções, arquitetura). Crie ou atualize
`AGENTS.md` na raiz com seções Comandos / Arquitetura / Convenções. Não invente:
confirme cada comando no package.json/Makefile/CI. Máx. 120 linhas.
```

`review.md`
```markdown
---
description: Revisão estruturada das mudanças atuais
agent: plan
---
Revise as mudanças atuais (git diff). Liste achados por severidade com arquivo:linha.
Foque em: corretude, regressões, segurança, casos de borda, testes faltantes.
Não edite arquivos.

!`git diff --stat && git diff --cached --stat`
```

`test.md`
```markdown
---
description: Roda a suíte relevante e corrige falhas
agent: build
---
Descubra o comando de teste correto (AGENTS.md), rode-o, e se houver falhas:
corrija a causa raiz e repita até passar. Ao final, cole o resumo da última execução.
Alvo: $ARGUMENTS
```

`commit.md` (ou use sua skill git-commit-push)
```markdown
---
description: Commit convencional com staging inteligente
---
Analise `git status`/`git diff`. Agrupe em commits Conventional Commits em português,
um por unidade lógica. Faça staging seletivo e commit. Não faça push sem pedir.
```

`pr.md`
```markdown
---
description: Cria Pull Request com descrição
subagent: true
---
Use o GitHub CLI. Crie PR da branch atual para a default, com título convencional e
descrição estruturada (Resumo / Mudanças / Como testar). Base: $ARGUMENTS
```

> Commands com `!` shell rodam **fora** do fluxo de permissão do agente — trate como
> confiável (não coloque `$ARGUMENTS` dentro de bloco shell com input externo).

---

## 6. Camada 4 — Subagentes (o "time" do Claude Code)

Crie em `~/.config/opencode/agents/`. O V2 já tem `explore`, `plan`, `general`
embutidos; adicione especialistas:

`reviewer.md`
```markdown
---
description: Revisa mudanças para corretude e regressões sem editar
mode: subagent
model: anthropic/claude-sonnet-4-5#high   // ou seu modelo premium via gateway
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: deny
---
Revise o diff indicado. Saída: lista por severidade (arquivo:linha, problema,
sugestão). Sem edições. Cite testes ausentes para cada bug encontrado.
```

`debugger.md`
```markdown
---
description: Investiga falhas e propõe correção mínima
mode: subagent
steps: 12
---
Reproduza a falha (log/teste falho), formule hipóteses, confirme com evidência,
aplique a menor correção possível e rode o teste que falhava. Reporte:
causa raiz → correção → evidência.
```

`explorer.md` (se quiser sobrepor o builtin com modelo barato)
```markdown
---
description: Mapeia código e responde perguntas de arquitetura rapidamente
mode: subagent
model: opencode-go/deepseek-v4.1-flash   // modelo barato
---
Responda à pergunta navegando pelo repo (glob/grep/read). Saída: resposta objetiva
+ caminhos relevantes. Não edite nada.
```

`planner.md`
```markdown
---
description: Produz plano de implementação sem editar código
mode: subagent
---
Leia o contexto necessário e produza plano numerado: arquivos a mudar, abordagem,
riscos, testes. Não edite.
```

**Boas práticas herdadas do CC:**
- `description` curta e orientada a "quando usar" (o modelo escolhe por ela).
- Modelo por agente: barato para explorar/planilhar, premium para revisar/depurar.
- `permissions` do subagente são **independentes** das do pai (não é subconjunto!).
- Para debrief de trabalho longo, rode subagente em `background: true`.

---

## 7. Camada 5 — Hooks: a maior lacuna (e como fechá-la)

### 7.1 Situação

- O Claude Code define hooks em JSON (`~/.claude/settings.json`) que rodam como
  processos com JSON no stdin e exit codes (0/2 = allow/block).
- O OpenCode V2 **não executa hooks do CC nativamente** — há issue aberta pedindo
  compatibilidade ([#12472](https://github.com/anomalyco/opencode/issues/12472),
  já atribuída a um mantenedor). O gap crítico é `Stop` com re-ativação.
- O plugin da comunidade `opencode-hooks-plugin@0.1.0` faz isso, **mas é V1**
  (`@opencode-ai/plugin`, campo `plugin`) — não roda no V2.

### 7.2 A boa notícia: os primitivos V2 cobrem ~70% dos hooks

| Hook do Claude Code | Primitivo V2 |
|---|---|
| `PreToolUse` (bloquear/allow/ask) | `ctx.permission.hook("evaluate")` — muda `effect` para `allow/ask/deny` |
| `PreToolUse` (observar/reescrever input) | `ctx.tool.hook("execute.before")` |
| `PostToolUse` / `PostToolUseFailure` | `ctx.tool.hook("execute.after")` (status `completed`/`error`) |
| `UserPromptSubmit` (injetar contexto) | `ctx.session.hook("prompt")` + `ctx.session.hook("context")` |
| `SessionStart` (adicionar contexto) | `session.hook("context")` no primeiro request |
| `PreCompact` | `ctx.session.hook("compaction")` (pode até fornecer o resumo) |
| `StopFailure`/retry | `ctx.session.hook("retry")` |
| `Notification`/`SessionEnd`/`FileChanged`/... | `ctx.event.subscribe()` (stream de eventos) |
| `Stop` (só observar) | `ctx.event.subscribe()` |
| `Stop` com re-ativação (exit 2) | ❌ emulação experimental via `ctx.session.prompt`; nativo pendente |

### 7.3 Opção A — Ponte própria V2-nativa (recomendada; código de referência)

Crie `~/.config/opencode/plugins/claude-hooks-bridge/index.ts` e registre em
`plugins` como `{"package": "./plugins/claude-hooks-bridge", "options": {...}}`.
Ele **lê os hooks que você já tem** em `~/.claude/settings.json` e executa no V2.

```ts
// Ponte Claude Code hooks -> OpenCode V2 (referência; ajuste conforme seu caso)
import { Plugin } from "@opencode/plugin"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

type CCHook = { type: string; command?: string; url?: string; timeout?: number }
type CCGroup = { matcher?: string; hooks: CCHook[] }

const TOOL_MAP: Record<string, string> = {
  read: "Read", edit: "Edit", write: "Write", patch: "Patch", shell: "Bash",
  glob: "Glob", grep: "Grep", webfetch: "WebFetch", websearch: "WebSearch",
  subagent: "Task", skill: "Skill", question: "AskUserQuestion", execute: "CodeMode",
}
const ccToolName = (t: string) => {
  if (TOOL_MAP[t]) return TOOL_MAP[t]
  const i = t.indexOf("_") // MCP: server_tool -> mcp__server__tool
  return i > 0 ? `mcp__${t.slice(0, i)}__${t.slice(i + 1)}` : t
}

const expand = (p: string, cwd: string) =>
  p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(2))
  : isAbsolute(p) ? p : resolve(cwd, p)

function matches(matcher: string | undefined, value: string) {
  if (!matcher || matcher === "*") return true
  if (/^[\w\-, |]+$/.test(matcher))
    return matcher.split(/[|,]/).map((s) => s.trim()).filter(Boolean).includes(value)
  try { return new RegExp(matcher).test(value) } catch { return false }
}

async function loadSettings(cwd: string, files: string[]) {
  const merged: any = { hooks: {} }
  let disableAll = false
  for (const f of files) {
    try {
      const raw = JSON.parse(await readFile(expand(f, cwd), "utf8"))
      if (raw.disableAllHooks) disableAll = true
      for (const [event, groups] of Object.entries(raw.hooks ?? {}))
        (merged.hooks[event] ??= []).push(...(groups as any[]))
    } catch { /* arquivo ausente/inválido: ignora */ }
  }
  return disableAll ? null : merged
}

function collect(settings: any, event: string, matcherValue?: string): CCHook[] {
  const out: CCHook[] = []
  for (const g of (settings?.hooks?.[event] ?? []) as CCGroup[])
    if (matches(g.matcher, matcherValue ?? "")) out.push(...(g.hooks ?? []))
  return out
}

function runCommand(command: string, stdin: string, cwd: string, timeoutSec: number) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn(command, { shell: true, cwd, env: process.env })
    let stdout = "", stderr = ""
    child.stdout.on("data", (d) => (stdout += d)); child.stderr.on("data", (d) => (stderr += d))
    const t = setTimeout(() => child.kill("SIGKILL"), timeoutSec * 1000)
    child.on("error", () => { clearTimeout(t); done({ code: 1, stdout, stderr }) })
    child.on("close", (code) => { clearTimeout(t); done({ code, stdout, stderr }) })
    child.stdin.write(stdin); child.stdin.end()
  })
}

type Result = { block: boolean; ask: boolean; allow: boolean; reason?: string; ctx?: string; msg?: string }

function parse(res: { code: number | null; stdout: string; stderr: string }): Result {
  const out: Result = { block: res.code === 2, ask: false, allow: false }
  try {
    const j = JSON.parse(res.stdout.trim())
    const s = j.hookSpecificOutput ?? {}
    if (s.permissionDecision === "deny") { out.block = true; out.reason = s.permissionDecisionReason }
    if (s.permissionDecision === "ask") out.ask = true
    if (s.permissionDecision === "allow") out.allow = true
    if (s.additionalContext) out.ctx = s.additionalContext
    if (j.decision === "block") { out.block = true; out.reason = j.reason }
    if (j.systemMessage) out.msg = j.systemMessage
  } catch { /* sem JSON: exit code manda */ }
  if (out.block && !out.reason)
    out.reason = res.stderr.trim() || "Bloqueado por hook do Claude Code"
  return out
}

async function run(hooks: CCHook[], input: Record<string, unknown>, cwd: string): Promise<Result[]> {
  const stdin = JSON.stringify(input)
  const results: Result[] = []
  for (const h of hooks) {
    if (h.type === "command" && h.command) {
      results.push(parse(await runCommand(h.command, stdin, cwd, h.timeout ?? 600)))
    } else if (h.type === "http" && h.url) {
      try {
        const r = await fetch(h.url, { method: "POST", headers: { "content-type": "application/json" }, body: stdin })
        results.push(parse({ code: r.ok ? 0 : 1, stdout: await r.text(), stderr: "" }))
      } catch (e) { console.error("[cc-hooks] http falhou:", e) }
    }
    // type "prompt"/"agent" não implementados nesta versão enxuta
  }
  return results
}

export default Plugin.define({
  id: "cc.hooks-bridge",
  async setup(ctx) {
    const cwd = ctx.location.directory
    const opts = (ctx.options ?? {}) as { settings?: string[]; stopReactivate?: boolean }
    const files = opts.settings ?? ["~/.claude/settings.json", ".claude/settings.json", ".claude/settings.local.json"]
    const settings = await loadSettings(cwd, files)
    if (!settings) return

    const pending = new Map<string, string[]>()          // contexto pendente por sessão
    const started = new Set<string>()                    // SessionStart já injetado
    const push = (sid: string, text?: string) => { if (sid && text) pending.set(sid, [...(pending.get(sid) ?? []), text]) }

    // ---------- SessionStart (injeta no primeiro request da sessão) ----------
    const startCtx: string[] = []
    for (const h of collect(settings, "SessionStart", "startup")) {
      const res = await run([h], { cwd, hook_event_name: "SessionStart", source: "startup" }, cwd)
      for (const r of res) if (r.ctx) startCtx.push(r.ctx)
    }

    // ---------- PreToolUse (bloqueia/permite) ----------
    await ctx.permission.hook("evaluate", async (event) => {
      const tool = ccToolName(event.action)
      const hooks = collect(settings, "PreToolUse", tool)
      if (!hooks.length) return
      const input = {
        session_id: event.sessionID, cwd, hook_event_name: "PreToolUse", tool_name: tool,
        tool_input: event.action === "shell"
          ? { command: event.resources.join(" && ") }
          : { resources: event.resources },
      }
      const results = await run(hooks, input, cwd)
      const deny = results.find((r) => r.block)
      if (deny) { event.effect = "deny"; event.message = deny.reason; return }
      if (results.some((r) => r.ask)) { event.effect = "ask"; return }
      if (results.some((r) => r.allow)) { event.effect = "allow"; return }
      for (const r of results) push(event.sessionID, r.ctx)
    })

    // ---------- PostToolUse / PostToolUseFailure ----------
    await ctx.tool.hook("execute.after", async (event: any) => {
      const tool = ccToolName(event.tool)
      const ccEvent = event.status === "error" ? "PostToolUseFailure" : "PostToolUse"
      const hooks = collect(settings, ccEvent, tool)
      if (!hooks.length) return
      const results = await run(hooks, {
        session_id: event.sessionID ?? "", cwd, hook_event_name: ccEvent, tool_name: tool,
        tool_input: event.input, tool_response: event.result ?? event.error,
      }, cwd)
      for (const r of results) { push(event.sessionID, r.ctx); if (r.msg) console.log("[cc-hooks]", r.msg) }
    })

    // ---------- UserPromptSubmit ----------
    await ctx.session.hook("prompt", async (event) => {
      const hooks = collect(settings, "UserPromptSubmit")
      if (!hooks.length) return
      const sid = (event as any).sessionID ?? ""
      const results = await run(hooks, { session_id: sid, cwd, hook_event_name: "UserPromptSubmit", prompt: event.prompt.text }, cwd)
      for (const r of results) {
        if (r.block) event.prompt.text = `[hook] ${r.reason}\n\n${event.prompt.text}`
        push(sid, r.ctx)
      }
    })

    // ---------- Injeção de contexto (SessionStart + hooks) ----------
    await ctx.session.hook("context", async (event) => {
      const sid = (event as any).sessionID ?? ""
      const notes = [...pending.get(sid) ?? []]
      pending.delete(sid)
      if (!started.has(sid)) { started.add(sid); notes.push(...startCtx) }
      for (const text of notes)
        event.system.push({ type: "text", text: `<claude-code-hook-context>\n${text}\n</claude-code-hook-context>` })
    })

    // ---------- PreCompact ----------
    await ctx.session.hook("compaction", async (event) => {
      const hooks = collect(settings, "PreCompact")
      if (!hooks.length) return
      await run(hooks, { session_id: (event as any).sessionID ?? "", cwd, hook_event_name: "PreCompact", trigger: "auto" }, cwd)
    })

    // ---------- Stop (observa; re-ativação experimental) ----------
    const ac = new AbortController()
    void (async () => {
      for await (const ev of ctx.event.subscribe({ signal: ac.signal })) {
        const type = (ev as any).type ?? (ev as any).$type ?? ""
        if (type !== "session.idle" && type !== "session.execution.succeeded") continue
        const sid = (ev as any).sessionID ?? (ev as any).properties?.sessionID ?? (ev as any).data?.sessionID
        if (!sid) continue
        const hooks = collect(settings, "Stop")
        if (!hooks.length) continue
        const results = await run(hooks, { session_id: sid, cwd, hook_event_name: "Stop" }, cwd)
        const retrigger = results.find((r) => r.block && opts.stopReactivate)
        if (retrigger) await ctx.session.prompt({ sessionID: sid, text: retrigger.reason ?? "Continue.", delivery: "queue" })
      }
    })()
    return () => ac.abort()
  },
})
```

Config correspondente:

```jsonc
{
  "plugins": [
    {
      "package": "./plugins/claude-hooks-bridge",
      "options": { "stopReactivate": false }
    }
  ]
}
```

**Limitações honestas** (documente no seu AGENTS.md):
- `Stop` re-ativante é experimental — comportamento nativo está pendente na issue #12472.
- `notification`, `SubagentStop`, `WorktreeCreate` etc. não têm equivalente 1:1; use `ctx.event.subscribe` para observabilidade.
- `prompt`/`agent` hooks (que usam LLM) não estão implementados na versão enxuta acima.
- O campo `if` (ex.: `Bash(git push *)`) dos hooks do CC não é avaliado; use o `matcher` no nível do grupo.

### 7.4 Opção B — Soubi (portabilidade multi-harness)

[Soubi](https://github.com/tarkaworks/soubi) compila um plugin "filesystem-first"
(`hooks/*.ts`, `skills/`, `commands/`, `agents/`) para **22 harnesses**, incluindo
OpenCode — gera um plugin TypeScript nativo para o V2. Vale se você quer o mesmo
hook/skill funcionando em Claude Code + Codex + Cursor + OpenCode a partir de uma fonte.

```bash
npx soubi@latest build . --harness claude,opencode
# saída nativa em .soubi-out/<harness>/
```

### 7.5 Opção C — plugin pronto (só se você estiver no V1)

`opencode-hooks-plugin@0.1.0` (npm) roda hooks do CC, mas é V1. No V2, **não funciona**
sem porte. Não recomendo instalar no seu V2.0.26.

---

## 8. Camada 6 — MCPs recomendados

| MCP | Para quê | Instalação |
|---|---|---|
| **context7** | Docs atualizadas de libs/frameworks (mata alucinação de API) | `opencode mcp add context7 --global --url https://mcp.context7.com/mcp` |
| **playwright** | Testar UI no browser de verdade | `opencode mcp add playwright --global -- npx -y @playwright/mcp@latest` |
| **github** | Issues/PRs/Actions sem sair do agente | via `opencode mcp add github --url ...` (OAuth) |
| **sentry** | Erros de produção durante o fix | OAuth: `opencode mcp add sentry --global --url https://mcp.sentry.dev/mcp` |
| **linear/notion** | Contexto de produto/tickets | conforme workspace |

Regras de ouro (senão o contexto morre):
- Máx. **3–5 servidores** ativos; cada tool description consome contexto.
- Mantenha `codemode: true` (padrão): agrupa as tools sob `tools.<server>` (carrega sob demanda).
- Use permissões para esconder tools perigosas sem desconectar o server:
  `{ "action": "github_*", "resource": "*", "effect": "deny" }`.
- Prompts de MCP viram slash commands (`/<server>:<prompt>`).

---

## 9. Camada 7 — UX, observabilidade e contexto

Plugins da comunidade que cobrem o que o CC traz de fábrica (instale com
`opencode plugin add <pacote>` e configure em `plugins`):

| Necessidade (CC tem) | Plugin OpenCode | Notas |
|---|---|---|
| Statusline com tokens/contexto/custo | `opencode-statusline` (tsy-fred) ou `ocstatusline` | V2 TUI plugins; o CC tem `statusLine` shell nativo, aqui é plugin (issues #30295/#46775 abertas) |
| Notificações de "terminou/precisa de você" | `opencode-notify` | equivalente ao Notification hook |
| Telemetria/métricas (OTel) | `opencode-plugin-otel` | "espelha os sinais do Claude Code" |
| Podar contexto antigo | `opencode-dynamic-context-pruning` | reduz tokens em sessões longas |
| Memória persistente | `opencode-claude-memory`, `opencode-agent-memory`, `oc-mnemoria` | escolha um; teste antes de confiar |
| Revisão automática | `opencode-review` | review estruturado com auto-fix opcional |
| Segurança de comandos destrutivos | `CC Safety Net` / `EnvSitter Guard` | rede de proteção extra p/ `.env` e `rm -rf` |
| Subagentes em paralelo/worktrees | `opencode-swarm`, `Mission Control`, `opencode-workspace` | "agent teams" do CC é mais nativo; aqui é plugin |
| Spec-driven development | `GoopSpec`, `OpenSpec`, `opencode-bmad-workflow` | você já usa SDD via skill; dá para integrar |

**Fluxos do CC já nativos no OpenCode** (use mais):
- **Plan mode** ⇒ agente `plan` (nega edits; permite escrever só em `~/.opencode/plan`).
- **Rewind** ⇒ `/undo` + `/redo` (snapshots restauram arquivos em repo git).
- **Fork de sessão / resumo** ⇒ subagentes com contexto próprio + `session_move`.
- **Background** ⇒ `shell` `background: true` (dev servers, builds) e subagent `background: true`.
- **Worktrees** ⇒ suporte nativo por projeto (`worktree.directory` no config; tools `worktree_*`).
- **Compactação** ⇒ automática; ajuste `keep.tokens` para 20–24k em sessões de código longo.
- **Web search** ⇒ escolha provedor com `/connect` e fixe com `websearch.provider`.
- **Warming** ⇒ desligado por padrão; só ligue se quiser latência menor (custa tokens).

---

## 10. Configuração de referência completa (arquivos)

```
~/.config/opencode/
├── opencode.jsonc            # §4.1
├── AGENTS.md                 # §3.1 (global)
├── agents/
│   ├── reviewer.md           # §6
│   ├── debugger.md
│   ├── explorer.md
│   └── planner.md
├── commands/
│   ├── init-agents.md        # §5.2
│   ├── review.md
│   ├── test.md
│   ├── commit.md
│   └── pr.md
├── skills/                   # opcional: mover de ~/.claude/skills
│   ├── code-conventions/SKILL.md
│   ├── git-commit-push/SKILL.md
│   ├── sdd/SKILL.md
│   ├── cua-driver/SKILL.md
│   └── verify/SKILL.md       # §5.1
└── plugins/
    └── claude-hooks-bridge/index.ts   # §7.3
```

Projeto (por repo):

```
AGENTS.md                     # §3.2
.opencode/opencode.jsonc      # permissões/regras específicas do repo
```

---

## 11. O que ainda fica devendo (lacunas reais do V2 vs CC)

1. **Hooks nativos do CC** — incluindo `Stop` re-ativante (issue #12472, já atribuída).
   Workaround: ponte §7.3; mantém uma única fonte de hooks.
2. **Auto memory nativa** — só plugin/DIY.
3. **`@imports` em AGENTS.md** e **rules path-scoped** — não existem; use hierarquia de
   AGENTS.md + skills.
4. **Sandbox de execução** (fs/rede) — não existe; devcontainer/VM + permissões.
5. **Statusline em script** (estilo `statusLine.command`) — só plugin TUI.
6. **LSP tools** — V2 não roda LSP; use `typecheck`/`lint`/compilador no fluxo (o CC tem
   auto-correção via LSP).
7. **Marketplace de plugins** — ecossistema existe (awesome-opencode, opencode.cafe),
   mas sem curadoria/instalação 1-clique como o do CC.
8. **Agent teams nativos** — plugins cobrem, mas não com a integração do CC.

Prioridade do que dá mais retorno por hora investida: **AGENTS.md + permissões +
subagentes + commands + ponte de hooks**. Isso cobre ~80% da sensação "harness do CC".

---

## 12. Checklist de aplicação (manual)

Marque conforme for fazendo — cada item é independente:

- [ ] Criar `~/.config/opencode/AGENTS.md` (§3.1)
- [ ] Rodar `/init-agents` em cada projeto importante para gerar o `AGENTS.md` local (§5.2)
- [ ] Atualizar `~/.config/opencode/opencode.jsonc` com a config do §4.1 (ajuste o `model`)
- [ ] Criar os 4 subagentes em `~/.config/opencode/agents/` (§6)
- [ ] Criar os 5 commands em `~/.config/opencode/commands/` (§5.2)
- [ ] Criar skill `verify` (§5.1)
- [ ] Testar a ponte de hooks: copiar §7.3 para `~/.config/opencode/plugins/claude-hooks-bridge/index.ts`
      e registrar em `plugins`; validar com um hook que bloqueia `rm -rf` em `~/.claude/settings.json`
- [ ] Adicionar MCPs: `opencode mcp add context7 --global --url https://mcp.context7.com/mcp`
      e `opencode mcp add playwright --global -- npx -y @playwright/mcp@latest` (§8)
- [ ] Instalar plugins de UX que quiser (statusline, notify, otel, context pruning) (§9)
- [ ] Mover ou manter as skills em `~/.claude/skills` (ambas funcionam) (§5.1)
- [ ] Validar tudo com `opencode plugin list`, `opencode mcp list` e uma sessão de teste

> Dica: aplique em blocos e reinicie o serviço (`opencode service restart`) só quando mexer
> em plugins/config global.

## 13. Fontes

- OpenCode V2 docs: https://opencode.ai/v2/docs/ (config, agents, skills, commands,
  permissions, policies, snapshots, compaction, mcp-servers, references, websearch,
  instructions, build/plugins)
- Claude Code docs: https://code.claude.com/docs/en/hooks · /memory · /sub-agents
- Issue compat de hooks: https://github.com/anomalyco/opencode/issues/12472
- Issue statusline: https://github.com/anomalyco/opencode/issues/30295 · #46775
- awesome-opencode: https://github.com/awesome-opencode/awesome-opencode
- Soubi (compilador multi-harness): https://github.com/tarkaworks/soubi
- opencode-hooks-plugin (V1): https://github.com/romain325/opencode-hooks-plugin
- Statusline: https://github.com/tsy-fred/opencode-statusline ·
  https://github.com/amirlehmam/ocstatusline
- Guias comparativos: composio.dev/content/claude-code-vs-open-code ·
  dev.to/composiodev/claude-code-vs-opencode-without-the-hype

---

*Gerado em 2026-10-08. Versões mudam rápido — valide comandos `opencode plugin`/`mcp`
contra a doc V2 antes de aplicar em massa.*
