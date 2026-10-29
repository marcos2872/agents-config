---
name: code-conventions
description: Diretrizes universais de qualidade de código — SOLID, Clean Code, DDD, TDD e Clean Architecture. Use ao revisar o design do código, estruturar responsabilidades, aplicar os princípios de baixo acoplamento e alta coesão, ou orientar decisões de arquitetura em qualquer linguagem.
disable-model-invocation: false
---

# Convenções de Qualidade de Código

Princípios universais de qualidade de código. Aplique com bom senso, não como dogma.

## Convicção

> Bom código é aquele que você consegue **mudar sem quebrar** e que está **documentado o suficiente** para que qualquer pessoa (inclusive você no futuro) entenda o *porquê* das decisões.

---

## SOLID

- **S — Responsabilidade Única**: Cada módulo, classe ou função tem **um único motivo para mudar**. Responsabilidades diferentes devem ser separadas.
- **O — Aberto/Fechado**: Aberto para extensão, fechado para modificação. Adicione comportamento sem reescrever o código existente (polimorfismo, estratégias, hooks).
- **L — Substituição de Liskov**: Subtipos devem substituir os tipos-base **sem quebrar a correção**. Se uma subclasse quebra as expectativas da superclasse, o design está errado.
- **I — Segregação de Interfaces**: Interfaces pequenas e coesas valem mais que interfaces grandes e genéricas. Um cliente não deve depender de métodos que não usa.
- **D — Inversão de Dependência**: Módulos de alto nível não devem depender de módulos de baixo nível. Ambos dependem de **abstrações**. Abstrações não dependem de detalhes; detalhes dependem de abstrações.

---

## Clean Code

- **Nomes revelam a intenção**: `calcularFatura()`, não `calc()`; `usuariosAtivos`, não `data`. Evite abreviações, siglas obscuras e nomes genéricos como `dados`, `info`, `temp`.
- **Funções pequenas e focadas**: Uma única coisa. Poucos parâmetros (0–2 é o ideal). Retornos antecipados em vez de aninhamento profundo. Evite flags booleanas que mudam o fluxo interno — prefira duas funções distintas.
- **Sem efeitos colaterais escondidos**: Funções puras não devem alterar estado global, arquivos ou bancos de dados de forma inesperada. Efeitos colaterais devem estar claros pelo nome ou pelo contexto.
- **Comentários**: Comente o **porquê**, não o **o quê**. O código já diz o que faz. TODO/FIXME sem contexto (issue, data, autor) é ruído.
- **Tratamento de erros**: Nunca engula erros. Um `catch` genérico sem log nem ação é pior do que não tratar. Use exceções ou resultados explícitos (`Result`, `Either`) em vez de códigos de retorno opacos.

---

## Clean Architecture

- **Regra de dependência**: As dependências apontam **para dentro**. O núcleo de negócio (domínio, entidades, casos de uso) não deve depender de frameworks, bancos de dados, bibliotecas externas nem da UI.
- **Separação de responsabilidades**:
  - **Domínio**: regras de negócio centrais, sem dependências externas
  - **Casos de uso**: orquestração das regras de negócio para um objetivo específico
  - **Adaptadores / Infraestrutura**: implementações concretas de banco, API e UI — detalhes substituíveis
- **Testabilidade**: O núcleo de negócio deve ser testável **sem banco, rede ou framework**. Se uma entidade ou um caso de uso só pode ser testado com integração, há acoplamento excessivo.
- **Portas e adaptadores**: Defina interfaces (portas) para serviços externos no domínio ou nos casos de uso. Os adaptadores implementam essas interfaces. O domínio não conhece o adaptador.

---

## DDD — Domain-Driven Design

- **Linguagem ubíqua**: Use o mesmo vocabulário de domínio no código, nas discussões e na documentação. Um termo no código deve significar o mesmo para o negócio e para a tecnologia.
- **Entidades e Objetos de Valor**:
  - **Entidade**: objeto com identidade única que persiste ao longo do tempo
  - **Objeto de Valor**: objeto imutável definido por seus atributos, sem identidade
  - **Agregado**: conjunto de entidades e objetos de valor tratado como uma única unidade de consistência. A raiz do agregado garante as invariantes
- **Repositórios**: abstraem o armazenamento e a recuperação de agregados. Domínio rico: coloque a lógica de negócio nas entidades e objetos de valor, não em serviços. Serviços de domínio existem apenas para operações que não pertencem naturalmente a uma entidade ou objeto de valor.

---

## TDD — Test-Driven Development

- **Vermelho-Verde-Refatorar**:
  1. **Vermelho**: escreva um teste que falha antes de implementar
  2. **Verde**: escreva o mínimo de código para passar
  3. **Refatorar**: melhore o código sem quebrar os testes
- **O que testar**: Comportamento observável, não detalhes de implementação. Caminhos felizes, casos de erro, casos de borda. Regras de negócio e validações primeiro; integração de I/O depois (com mocks).
- **Qualidade dos testes**: Testes devem ser **rápidos, determinísticos e isolados**. Nada de testes triviais que sempre passam sem exercitar lógica real. Nada de mensagens de falha genéricas. Nada de `skip`/`xfail`/`todo` sem justificativa explícita.

---

## Critérios de Avaliação

| Nível | Significado |
|---|---|
| **ERRO** | Viola a convicção central: introduz risco de bug, quebra a regra de dependência ou torna a mudança perigosa. |
| **AVISO** | Viola um ou mais princípios acima, mas sem risco funcional imediato. Dívida técnica. |
| **SUGESTÃO** | Poderia ser mais claro, mais coeso ou mais consistente com os princípios, mas está funcionalmente correto. |

---

## Regra Final

Esta skill não substitui convenções de toolchain ou operacionais definidas no `AGENTS.md`. Ela serve como **guia de qualidade de design** — aplique os princípios com bom senso, não como dogma.
