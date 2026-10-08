---
description: "Gera ou atualiza o AGENTS.md do projeto a partir do estado real do repositório"
---

Analise este repositório (comandos de instalação/build/teste/lint, arquitetura, convenções) e crie ou atualize `AGENTS.md` na raiz com as seções Comandos / Arquitetura / Convenções / Memória do projeto.

Não invente: confirme cada comando em `package.json`, `Makefile`, CI ou equivalente. Máximo de ~200 linhas. Responda em português brasileiro.

A seção "Memória do projeto" deve conter exatamente esta regra:

```markdown
## Memória do projeto

- Ao aprender algo durável sobre este projeto (decisão, convenção, armadilha, preferência do usuário), salve com a tool `memory_write` — uma frase objetiva por memória.
- As memórias são injetadas automaticamente no seu contexto (bloco `<project-memory>`); siga-as.
- Liste com `memory_list` e remova memórias obsoletas com `memory_delete`; o usuário também gerencia via `/memory`.
```

Se o `AGENTS.md` já existir sem essa seção, apenas acrescente a seção.
