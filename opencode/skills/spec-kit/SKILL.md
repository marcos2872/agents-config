---
name: spec-kit
description: "Fluxo oficial do GitHub Spec Kit (Spec-Driven Development). Use para SDD, spec-driven development, spec kit, speckit, specify init, constitution, especificação/plano/tarefas de uma feature, /speckit.*, correção de bug estruturada (assess/fix/test) ou avaliação de ideia (assess)."
---

# Spec Kit (GitHub) — Spec-Driven Development

Toolkit oficial (MIT) do GitHub que dá ao agente processos estruturados com artefatos em Markdown. A especificação é a fonte de verdade: **defina o quê/por quê antes de decidir o como** e implemente contra ela.

Três processos independentes: **SDD** (feature/app), **bug fixing** e **idea assessment** (os dois últimos como extensões opt-in).

## Pré-requisitos

- Python 3.11+, `uv` e git.
- Instalar: `uv tool install specify-cli`
- Validar o ambiente: `specify check`
- Atualizar o CLI: `specify self check` (verifica) / `specify self upgrade`

## Setup no OpenCode

No diretório do projeto (ou criando um novo):

```bash
specify init . --integration opencode            # no projeto atual
specify init meu-projeto --integration opencode  # novo projeto
```

- Gera `.specify/` (constitution, templates, scripts, workflows) e os commands `.opencode/commands/speckit.*.md`.
- Diretório não vazio exige `--force`; para script/CI use `--non-interactive`.
- No OpenCode os comandos são invocados como `/speckit.<nome>` (ex.: `/speckit.specify`); se não aparecerem, reinicie a sessão.

## Processo 1 — SDD

**Constitution uma vez por projeto; depois, por feature:**

1. `/speckit.constitution` — princípios (qualidade, testes, manutenibilidade) → `.specify/memory/constitution.md`.
2. `/speckit.specify <descrição>` — o quê/por quê → `specs/<n>/spec.md`.
3. `/speckit.plan <como>` — stack/arquitetura → `specs/<n>/plan.md`.
4. `/speckit.tasks` — tarefas executáveis → `specs/<n>/tasks.md`.
5. `/speckit.implement` — implementa contra spec/plan/tasks.
6. `/speckit.converge` — verifica convergência; repita implement → converge até reportar "Converged".

Gates opcionais: `/speckit.clarify` (ambiguidades na spec), `/speckit.checklist` (checklist de qualidade) e `/speckit.analyze` (consistência entre os artefatos). `/speckit.taskstoissues` converte as tasks em issues do GitHub.

**Regras:** invoque um comando por vez e revise o artefato antes de seguir; refine o Markdown existente em vez de regenerar etapas inteiras; a spec guia a implementação — divergências voltam para a spec.

## Processo 2 — Bug fixing (extensão `bug`)

```bash
specify extension add bug
```

- `/speckit.bug.assess "<sintoma, stack trace ou URL>" [slug=<slug>]` — triagem contra o código → `.specify/bugs/<slug>/assessment.md`.
- `/speckit.bug.fix slug=<slug>` — aplica a correção e registra o que mudou.
- `/speckit.bug.test slug=<slug>` — valida o sintoma original.
- Veredito final: `verified`, `partial` ou `failed`. Sem verificação, não é correção bem-sucedida.

## Processo 3 — Idea assessment (extensão `assess`)

```bash
specify extension add assess
```

- `/speckit.assess.intake "<ideia>" slug=<slug>` → `research` → `define` → `shape` → `decide`.
- Artefatos em `.specify/assessments/<slug>/`, terminando em **`go` / `needs-clarification` / `kill`**. Um `go` pode seguir para `/speckit.specify`.

## Extensões

- `specify extension list` / `search` / `add <nome>` / `update` / `remove` / `disable|enable` / `info`.
- Instale já no init: `specify init . --integration opencode --extension bug --extension assess`.

## Referências

- Repositório: https://github.com/github/spec-kit
- Documentação: https://github.github.io/spec-kit/
