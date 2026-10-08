---
name: verify
description: "Exige evidência de teste/lint antes de declarar uma tarefa concluída. Use ao finalizar mudanças de código, antes de responder que terminou."
---

# Verificar antes de concluir

1. Identifique o comando de teste/lint relevante para a área afetada (veja o `AGENTS.md` do projeto; se não existir, infira de `package.json`, `Makefile` ou CI).
2. Rode o comando na área afetada.
3. Se falhar: corrija a causa raiz e repita até passar; se não for possível corrigir, explique o bloqueio com a saída relevante.
4. Só então declare a tarefa concluída, incluindo o comando executado e o resumo do resultado.
