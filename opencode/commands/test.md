---
description: "Roda a suíte de testes relevante, confirma a causa de cada falha e prova o resultado (via skill verify)"
---

Alvo: $ARGUMENTS

Carregue a skill `code-conventions` (regra do `AGENTS.md` para análise e escrita de testes) e a skill `verify` no
modo **Correção** (este comando autoriza corrigir). Depois siga o procedimento da `verify`:

1. Descubra o comando de teste correto no `AGENTS.md` do projeto (ou no `package.json`/`Makefile`/CI) e rode-o.
2. Para cada falha, confirme a causa raiz com evidência antes de editar — não ajuste o teste para acomodar o código.
3. Corrija a causa com a menor mudança possível e repita até passar.
4. Ao final, cole o resumo da última execução: comando, resultado e o que foi alterado.

Se a falha for pré-existente e alheia a esta tarefa, não a conserte sem pedir: reporte com a saída e pare.
