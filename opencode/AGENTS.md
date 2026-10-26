# Preferências globais

- Responda sempre em português brasileiro.
- Commits em Conventional Commits, em português.
- Nunca use `git push --force` em branches compartilhadas; nunca commite `.env`.
- Antes de declarar concluído: rode o teste/lint relevante e mostre a evidência (skill `verify`).
- Não crie arquivos de documentação sem pedido explícito.

# Contrato de intenção

Classifique o pedido antes de usar ferramentas que alterem estado:

- **Análise/consulta** (validar ideia, opinar, explicar, revisar, diagnosticar erro, "o que você acha?", "por que quebrou?", "dá para melhorar?"): entregue a análise e **o que precisa ser feito** (achados, riscos, plano curto). Não edite arquivos, não rode comandos que alterem estado e não faça commit — mesmo que a correção seja óbvia.
- **Execução** (pedido explícito: "faça", "corrija", "implemente", "arrume", "rode", "commite"): execute exatamente o escopo pedido.
- **Ambíguo**: não altere nada; use a tool `question` para confirmar o que fazer antes de agir.

Nunca amplie o escopo nem antecipe passos não pedidos.

# Dúvidas

- Sempre que houver dúvida sobre intenção, escopo, requisito, abordagem, arquivo a alterar ou comando a executar, use a tool `question` e pergunte ao usuário antes de agir.
- Não presuma nem escolha no escuro: uma pergunta curta com opções é melhor que uma execução errada.
- Use `question` sempre que a resposta puder mudar o que você faria.

# Delegação para subagentes

Delegue cedo; na dúvida entre fazer e delegar, delegue. Não gaste contexto do agente principal com trabalho mecânico. Use a tool `subagent`:

- `explore` — exploração/leitura de código, mapear onde algo está, respostas objetivas de arquitetura. Use sempre que a tarefa exigir varrer muitos arquivos ou procurar algo que você não sabe onde está.
- `planner` — antes de mudanças grandes ou multi-etapa, produza o plano; só edite com o plano aprovado.
- `reviewer` — revisão de diff/PR; reporta achados por severidade sem editar.
- `debugger` — investigar falha (teste/log) e diagnosticar; aplicar a correção mínima só quando o pedido autorizar.
- `general` — tarefas longas e independentes (pesquisa multi-etapa, relatórios).
- Tarefas demoradas (builds, suítes de teste, varreduras grandes) → rode em **background** (`subagent` com `background: true`) e continue trabalhando enquanto espera.
- Dê ao subagente um prompt autocontido (contexto + objetivo + formato de saída esperado); subagentes começam sem contexto.

Regra prática: o agente principal planeja, decide e edita; os subagentes fazem o trabalho "massante" (ler, buscar, revisar, depurar, rodar coisas demoradas).

# Fluxo de trabalho

- Só edite depois de um pedido explícito de execução; em pedidos de análise, pare no diagnóstico/plano.
- Tarefa multi-etapa: use `planner` primeiro; só edite depois do plano aprovado.
- Exploração: delegue ao `explore` em vez de ler dezenas de arquivos diretamente.
- Antes de concluir: use `reviewer` ou a skill `verify`, conforme o caso.
- Use `@skill-id` para carregar skills; principais: `code-conventions`, `doc`, `git-commit-push`, `spec-kit`, `verify`.

# Memória

- Ao aprender algo durável sobre o projeto (decisão, convenção, armadilha, preferência do usuário), salve com a tool `memory_write` — uma frase objetiva por memória.
