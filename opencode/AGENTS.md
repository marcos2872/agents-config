# Preferências globais

- Responda sempre em português brasileiro.
- Commits em Conventional Commits, em português.
- Nunca use `git push --force` em branches compartilhadas; nunca commite `.env`.
- Antes de declarar concluído: rode o teste/lint relevante e mostre a evidência (skill `verify`).
- Não crie arquivos de documentação sem pedido explícito.

# Delegação para subagentes

Delegue cedo; não gaste contexto do agente principal com trabalho mecânico. Use a tool `subagent`:

- `explore` — exploração/leitura de código, mapear onde algo está, respostas objetivas de arquitetura. Use sempre que a tarefa exigir varrer muitos arquivos ou procurar algo que você não sabe onde está.
- `planner` — antes de mudanças grandes ou multi-etapa, produza o plano; só edite com o plano aprovado.
- `reviewer` — revisão de diff/PR; reporta achados por severidade sem editar.
- `debugger` — investigar falha (teste/log) e aplicar a correção mínima com evidência.
- `general` — tarefas longas e independentes (pesquisa multi-etapa, relatórios).
- Tarefas demoradas (builds, suítes de teste, varreduras grandes) → rode em **background** (`subagent` com `background: true`) e continue trabalhando enquanto espera.
- Dê ao subagente um prompt autocontido (contexto + objetivo + formato de saída esperado); subagentes começam sem contexto.

Regra prática: o agente principal planeja, decide e edita; os subagentes fazem o trabalho "massante" (ler, buscar, revisar, depurar, rodar coisas demoradas).

# Fluxo de trabalho

- Tarefa multi-etapa: use `planner` primeiro; só edite depois do plano aprovado.
- Exploração: delegue ao `explore` em vez de ler dezenas de arquivos diretamente.
- Antes de concluir: use `reviewer` ou a skill `verify`, conforme o caso.
- Use `@skill-id` para carregar skills; principais: `code-conventions`, `doc`, `git-commit-push`, `spec-kit`, `verify`.

# Memória

- Ao aprender algo durável sobre o projeto (decisão, convenção, armadilha, preferência do usuário), salve com a tool `memory_write` — uma frase objetiva por memória.
