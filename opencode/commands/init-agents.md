---
description: "Gera ou atualiza o AGENTS.md do projeto a partir do estado real do repositório"
---

Analise este repositório (comandos de instalação/build/teste/lint, arquitetura, convenções) e crie ou atualize `AGENTS.md` na raiz com as seções Comandos / Arquitetura / Convenções / Memória do projeto.

Não invente: confirme cada comando em `package.json`, `Makefile`, CI ou equivalente. Máximo de ~200 linhas. Responda em português brasileiro.

A seção "Memória do projeto" deve conter exatamente esta regra:

```markdown
## Memória do projeto

- Memória de longo prazo via ai-memory (MCP `ai-memory`): consulte com `memory_query` antes de responder sobre histórico/decisões; grave com `memory_write_page` só quando o usuário pedir explicitamente.
- Preferências que valem em todos os projetos → `memory_write_page` com `scope: "profile"`; fatos globais → `scope: "global"`.
- Handoffs: `memory_handoff_begin` ao encerrar; `memory_handoff_list`/`memory_handoff_accept` ao retomar.
```

Se o `AGENTS.md` já existir sem essa seção, apenas acrescente a seção.
