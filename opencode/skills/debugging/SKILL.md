---
name: debugging
description: "Use para investigar falha reproduzível, confirmar causa raiz com evidência e aplicar a menor correção quando o pedido autorizar. Sem autorização, apenas diagnostica."
---

# Depuração

## Fluxo

1. **Reproduzir** — rode o teste que falha ou capture o log. Sem reprodução, não afirme causa.
2. **Contexto** — consulte o ai-memory (`memory_query`) por falhas e gotchas da área; leia o código envolvido.
3. **Hipóteses** — liste 2–4 hipóteses e escolha a mais provável.
4. **Confirmar** — colete evidência (teste, log, inspeção, `git bisect` se fizer sentido). Não confunda correlação com causa.
5. **Corrigir** — só se o pedido autorizar explicitamente. Aplique a menor correção possível.
6. **Provar** — rode o teste que falhava e a suíte relevante. Use a skill `verify` antes de concluir.

## Regras

- Pedido de diagnóstico → **não edite**; entregue causa raiz e o que precisa ser feito.
- Pedido de correção → corrija a causa, não o sintoma; nada de refatoração de carona.
- Não desabilite teste, não aumente timeout e não silencie erro para “passar”.
- Se não conseguir reproduzir, diga o que falta (ambiente, dados, acesso) em vez de chutar.
- Preserve a evidência: comando executado e saída relevante.

## Saída

```markdown
## Causa raiz
<o que causou, com evidência>

## Correção
<o que mudou; “não aplicada” se o pedido era só diagnóstico>

## Evidência
- `<comando>` → <resultado>

## Prevenção
<teste, validação ou alerta que evita a regressão>
```

## Delegação

Quando delegado ao `general`, inclua no prompt o erro/log, o comando de reprodução, os arquivos suspeitos e se a correção está autorizada. O subagente tem acesso amplo; confira o diff depois.
