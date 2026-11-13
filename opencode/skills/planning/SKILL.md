---
name: planning
description: "Use antes de mudanças multi-arquivo, features, refatorações ou decisões de arquitetura. Obriga perguntas detalhadas com a tool question antes do plano e uma aprovação explícita antes de editar."
---

# Planejamento

## Quando usar

- Mudança em mais de um arquivo ou módulo.
- Feature nova, refatoração, migração, mudança de arquitetura.
- Pedido ambíguo em que a abordagem muda o resultado.
- Antes de qualquer execução que não seja trivial.

Para uma correção pontual e óbvia, não carregue esta skill: execute direto e mostre a evidência.

## Fluxo obrigatório

1. **Contexto** — leia `AGENTS.md`, as skills relevantes e o ai-memory (`memory_query`) sobre a área.
2. **Perguntas** — use a tool `question` com perguntas detalhadas antes de planejar. Não comece o plano sem essa rodada.
3. **Plano** — produza o plano numerado no formato abaixo.
4. **Aprovação** — use `question` de novo com **Aprovar / Ajustar / Cancelar**.
5. **Execução** — só edite depois da aprovação. Se surgir uma decisão nova, pare e pergunte.

## Perguntas obrigatórias

Use uma rodada com até 5 perguntas; se o usuário não souber, proponha um default e peça confirmação.

1. **Objetivo** — o que precisa estar verdadeiro ao final? (opções + resposta livre)
2. **Escopo** — o que entra e o que fica de fora?
3. **Restrições** — compatibilidade, prazo, dependências, padrões do projeto?
4. **Validação** — como saberemos que está pronto? (teste, lint, comportamento)
5. **Abordagem** — prefere a opção A (menor risco) ou B (mais limpa)? Por quê?

Perguntas ruins: “como você quer que eu faça?”. Perguntas boas: “A mudança deve preservar a API atual ou pode quebrar compatibilidade?”.

## Formato do plano

```markdown
## Objetivo
<uma frase verificável>

## Pressupostos
- <o que foi assumido; confirmar se mudar>

## Passos
1. <ação> — `<arquivo>`
2. ...

## Arquivos afetados
- `<caminho>` — <o que muda>

## Validação
- <comando/teste e resultado esperado>

## Riscos e rollback
- <risco> → <mitigação>
- Rollback: <como desfazer>

## Fora de escopo
- <o que não será feito>
```

## Regras

- **Nenhuma edição antes da aprovação.**
- Não use `question` para perguntas óbvias que o código responde.
- Se o pedido for SDD, use a skill `spec-kit`; esta skill cobre planejamento geral.
- Se a mudança for grande, proponha fases com entregas verificáveis.
- Ao executar, siga o plano aprovado; mudou o escopo? Volte ao passo 2.
