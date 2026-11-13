---
name: code-review
description: "Use para revisar diff/PR por corretude, regressões, segurança, casos de borda e testes ausentes. Produz achados por severidade com arquivo:linha e não edita arquivos."
---

# Revisão de código

## Preparação

1. Carregue `code-conventions` e, se existir, `docs/standards/_index-standards.md`.
2. Obtenha o diff: `git diff`, `git diff --cached` ou o PR indicado.
3. Leia o contexto ao redor das mudanças; não revise só as linhas alteradas.
4. Consulte o ai-memory (`memory_query`) por decisões e gotchas da área.

## Checklist

- **Corretude** — a mudança faz o que promete? Quebra algum contrato?
- **Regressões** — fluxos existentes, chamadas, schemas, permissões.
- **Segurança** — entrada não confiável, segredos, injeção, autorização.
- **Casos de borda** — vazio, nulo, erro, concorrência, limites.
- **Testes** — o bug/cenário novo tem teste? O teste falha sem a correção?
- **Consistência** — padrões do projeto, nomes, camadas, tratamento de erro.
- **Dados** — migração, compatibilidade, rollback.

## Saída

```markdown
## Crítico
- `arquivo:linha` — problema. Sugestão: ...

## Alto
- ...

## Médio
- ...

## Baixo
- ...

## Testes ausentes
- <cenário> — <teste que deveria existir>
```

Se não houver achados, diga explicitamente: “Sem achados nas mudanças revisadas.” Não invente problema para parecer útil.

## Regras

- **Não edite arquivos.** Só leia e rode comandos de leitura.
- Cite `arquivo:linha` em todo achado.
- Separe problema de sugestão; seja objetivo.
- Se o diff for grande, priorize os arquivos de maior risco e diga o que ficou fora.
- Quando delegado ao `general`, repita no prompt: “não edite; devolva sugestões”.
