---
description: "Consulta e gerencia a memória de longo prazo do projeto (ai-memory)"
---

Use o ai-memory para mostrar o que existe sobre este projeto:

- Comece com `memory_briefing` para o panorama (contagens, regras, páginas recentes) ou `memory_query` para buscar um tema específico.
- Apresente cada resultado com o `path`, o título e um resumo curto; use `memory_read_page` se o usuário quiser o conteúdo completo.
- Se o usuário pedir para salvar algo novo, use `memory_write_page`: projeto por padrão, `scope: "profile"` para preferência que vale em todos os projetos e `scope: "global"` para fato global.
- Se o usuário pedir para remover, use `memory_delete_page` com o `path` exato retornado pela consulta.
- Não crie, altere nem apague nada sem confirmação explícita. Não use `memory_write`, `memory_list` ou `memory_delete`: o plugin antigo foi removido.
