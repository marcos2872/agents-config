---
name: code-review
description: >
  Use para revisar uma mudança (diff, PR, branch, último commit, arquivos) ou
  auditar o repositório inteiro: corretude, segurança, carga real, código de
  risco sem teste, velocidade e o que apagar, fundir ou dividir. Abordagem
  herdada das skills ponytail-review e ponytail-audit (ponytail v5.3.3).
  Achados por severidade com arquivo:linha; não edita arquivos.
---

# Revisão de código e auditoria do repositório

Review like the senior developer who will be paged when it breaks.
Order of importance: correct, safe, holds under load, tested, fast, lean.
Lean still matters: every extra line must be read, tested and fixed later.
This is a report the user asked for, so give it in full.

Two modes: **change** (default) and **whole repo**.

## Preparation (both modes)

1. Load `code-conventions`.
2. Query ai-memory (`memory_query`) for decisions and gotchas in the area.
3. Find the expected load in the repo (README, deploy config): one person
   running a script, or many users and processes at once. Judge scale against
   that, and say which load you assumed.
4. Change no files. Read only, run read-only commands, report.

## Change mode

- Review what the user names: uncommitted or staged changes, a branch, a PR
  link, or files. Nothing named: the uncommitted changes, or the last commit
  if there are none.
- Read the diff, then the code it touches: callers of every changed function,
  the functions it calls, the tests.
- Trace the real flow: where data comes in, what is stored, what goes out.
- A change can break code it does not touch. When a signature, return value
  or behavior changes, grep every caller.
- Big diff: go deep on the highest-risk files and say what you left out.

## Whole repo mode

- Audit what the user names: a folder, a package, or the whole repo.
  Nothing named: the whole repo.
- Read the README, the deploy and build config, the dependency list, the
  entry points (main, routes, handlers, jobs, CLI commands) and the tests.
- Trace the main flows end to end: where data comes in, what is stored,
  what goes out. Read those paths fully: input from users, money, auth,
  data writes, background jobs, anything shared between processes.
- Big repo: go deep where a mistake costs the most, not file by file. Say
  which parts you did not read.

## Look for

1. **Bug:** wrong result, crash, missed edge case (empty, zero, last item,
   rounding, time zones), a caller broken by the change, a fix applied in one
   caller while the shared function stays broken, the same rule applied
   differently in two places.
2. **Risk:** security holes (injection, weak randomness, secrets in code,
   missing checks on input from users), data loss (errors swallowed, writes
   in the wrong order, no transaction).
3. **Scale:** fine for one user, wrong for many: check-then-write races, the
   same work done by every process, memory or lists that only grow, a query
   per item, O(n^2) on big input, per-process state that must be shared.
4. **Missing test:** risky logic (a branch, a parser, money, security, data
   writes, a bug fix) with no test that fails when it breaks. One good test,
   not coverage.
5. **Speed:** big slowdowns are problems. Small wins (work repeated in a hot
   loop) are suggestions; some software counts every millisecond.
6. **Lean:** code that should not exist or should be smaller.
   - delete: dead code, unused options, flags and config, speculative features
   - reuse: the repo already has this helper (name the path)
   - stdlib / native: the standard library or platform already does it;
     a new dependency for a few lines
   - yagni: abstraction with one implementation, factory with one product,
     wrapper that only passes calls through
   - merge: near-copies that must change together
   - split: one function or class doing several unrelated jobs, so it is
     hard to read or test. Split by job, never by line count, and never into
     helpers that exist only to make a function shorter.

## Check before you report

- Every finding needs a concrete case: "this input or situation leads to this
  wrong result". No case, no finding.
- Re-read the lines and confirm: the caller exists, the value can really be
  empty. Before calling code unused, grep the whole tree for it, including
  tests, fixtures, config, and string or dynamic references.
- A shortcut marked with a `shortcut:` (or older `ponytail:`) comment that
  names its limit is a decision, not a finding, unless the expected load
  already crosses it.
- Propose the smallest fix that works. Prefer fixes that delete code. Never
  add layers, frameworks or config the problem does not need.
- No style taste, no "consider", no vague worries. Nothing found is a valid
  answer: do not invent a problem to look useful.

## Output

Write the report in Brazilian Portuguese (the repository language rule wins
over the English wording of this skill file). Keep the section labels in
Portuguese: `O que esta mudança faz:` / `O que este repositório faz:`,
`Corrigir agora` / `Deveria corrigir` / `Bom ter`, `Veredito:`, `Enxuto:`,
`Não verificado:`.

Use short sentences and everyday words. Explain a technical term the first
time you use it. The reader may never have seen this code.

Start with the "what it does" line in two or three sentences, and the load
you assumed.

Then the findings in three groups, most important first, skip empty groups:
- **Corrigir agora:** bug, security, data loss, breaks at the expected load.
- **Deveria corrigir:** risky code without a test, real slowness, duplication,
  a function that mixes jobs, code that should not exist.
- **Bom ter:** small speed-ups, shorter forms.

Number findings across all groups, so the user can say "corrija 2 e 5". In
whole repo mode, at most 20 findings; if you left smaller ones out, say how
many. Every finding has all four parts, each one or two short sentences:

2. **Pedidos caem no dia errado** (`billing/close_day.py:L40-52`)
   - **O que é:** à meia-noite este job fecha o dia e cobra todos os pedidos dele.
   - **Problema:** pega o "hoje" do relógio do servidor, que roda em UTC. Um pedido
     feito 00h30 em Berlim é cobrado no dia anterior.
   - **Correção:** calcule o dia uma vez no fuso da loja:
     `datetime.now(ZoneInfo("Europe/Berlin")).date()`. Uma linha, nada mais muda.
   - **Se não corrigir:** pedidos atrasados saem com a data errada e o financeiro
     corrige na mão.

End with:
- `Veredito:` `Pode subir.` or what to fix first.
- `Enxuto: -<N> linhas, -<M> dependências possíveis.` when lean findings exist.
- `Não verificado:` what you did not read or run, plus the missing test scenarios
  as `<cenário> — <teste que deveria existir>`.

Nothing found: the "what it does" line, then `Sem achados. Pode subir.` and one
line on what you checked.

Lists findings, changes no code.

## Rules

- Cite `arquivo:linha` on every finding.
- Keep the problem separate from the suggestion; be objective.
- When delegated to `general`, repeat in the prompt: "não edite; devolva
  sugestões" plus the load you assumed.

---

Merged from [ponytail](https://github.com/DietrichGebert/ponytail) v5.3.3
(MIT, © 2026 DietrichGebert): `skills/ponytail-review` and `skills/ponytail-audit`.
