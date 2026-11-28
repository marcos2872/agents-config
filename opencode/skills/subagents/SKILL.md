---
name: subagents
description: "Use ao decidir se uma tarefa deve ser delegada a um subagente. Traz a matriz de roteamento (explore/general), o template de prompt autocontido e as regras para revisão, auditoria, depuração, documentação, ER, UML e SDD."
---

# Subagentes — quando e como delegar

## Princípio

Delegue o trabalho pesado, mecânico ou de contexto grande; não delegue decisão, aprovação nem edição final. O agente principal planeja, decide e valida. O subagente varre, reproduz, revisa ou gera.

Os subagentes embutidos do OpenCode são `explore` e `general`.

| Subagente | Use para | Não use para |
|---|---|---|
| `explore` | localizar código, varrer muitos arquivos, responder “onde está X”, levantar arquitetura sem editar | revisar diff, corrigir, gerar documentação |
| `general` | trabalho multi-etapa com contexto novo: revisão, depuração, geração de docs/diagramas, pesquisa longa | planejamento com perguntas ao usuário, commit, push, decisão de arquitetura |

O `general` tem acesso amplo e **pode editar arquivos**. A restrição “não edite” é contratual no prompt, não é deny. Depois de qualquer delegação, confira `git status` e `git diff` antes de aceitar o resultado.

## Matriz de roteamento

| Tarefa | Executor padrão | Skill no prompt | Regra |
|---|---|---|---|
| Explorar código | `explore` | — | sempre que a tarefa exigir varrer muitos arquivos ou localizar algo que você não sabe onde está |
| Revisar diff/PR | `general` ou principal | `ponytail-review` | diff médio/grande ou segunda opinião; o principal valida os achados |
| Auditar o repo | `general` | `ponytail-audit` | varredura grande; o principal valida os achados |
| Depurar falha | `general` ou principal | — | correção só com autorização explícita; caso contrário, só causa raiz |
| Planejar | **principal** | `planning` | **nunca delegar**: a skill precisa perguntar ao usuário, não ao subagente |
| SDD | principal | `spec-kit` | delegue ao `explore` apenas a pesquisa de código; spec/constitution ficam no principal |
| Documentação | principal | `technical-documentation-generator` | delegue ao `general` o levantamento mecânico; o principal revisa e grava |
| Diagrama ER | `general` | `er-diagram-generator` | precisa de shell/banco; delega só a **extração**. A curadoria de `domains.json` (tabela sem folha) é decisão e fica no principal |
| Diagrama UML | `general` ou principal | `uml-class-diagram-generator` | leitura massiva de entidades; o principal valida |
| Tarefa longa independente | `general` em background | — | pesquisa multi-etapa, relatório, varredura grande |

## Template de prompt

Todo prompt de subagente deve ser autocontido. Use este formato:

```text
CONTEXTO
- Repo/branch:
- Arquivos, diff ou trecho relevante:
- Erro/log (se houver):
- Decisões já tomadas:

OBJETIVO
- <resultado verificável, em uma frase>

SKILL
- Carregue a skill `<skill-id>` e siga o procedimento dela.

RESTRIÇÕES
- Não edite arquivos (quando aplicável).
- Não faça commit nem push.
- Comandos permitidos: <lista>.
- Não invente: cite arquivo e linha.

SAÍDA
- <formato exato: achados por severidade, causa raiz, caminhos, etc.>
```

## Regras

- Um subagente por tarefa; não empilhe delegações.
- Dê contexto suficiente para o subagente não precisar adivinhar.
- Use `background: true` para tarefas longas e continue trabalhando enquanto espera.
- Revise o retorno antes de aceitar; subagente não substitui sua validação.
- Não delegate: commit, push, aprovação do usuário, perguntas ao usuário, decisão de arquitetura, edição final de arquivo sensível — nem a **curadoria** dos geradores de diagrama (a folha de uma tabela ou de uma entidade nova é decisão, não trabalho mecânico).
- Se o subagente falhar ou fugir do escopo, não repita o mesmo prompt: ajuste o contexto ou faça localmente.
- Se o subagente não tiver acesso à skill, inclua no prompt o checklist essencial dela.

## Exemplo — revisão

```text
CONTEXTO
- Repo: agents-config; branch: main; diff: `git diff` (não commitado).

OBJETIVO
- Revisar as mudanças atuais e listar achados por severidade.

SKILL
- Carregue `ponytail-review` e siga o procedimento.

RESTRIÇÕES
- Não edite arquivos; não faça commit.

SAÍDA
- Achados por severidade com `arquivo:linha`, problema, sugestão e testes ausentes.
```
