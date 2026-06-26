---
name: code-conventions
description:  Diretrizes universais de qualidade de código — SOLID, Clean Code, DDD, TDD e
  Clean Architecture. Use quando precisar revisar design de código, estruturar
  responsabilidades, aplicar princípios de baixo acoplamento e alta coesão,
  ou orientar decisões arquiteturais em qualquer linguagem
---

# Princípios de Qualidade de Código

Esta skill define os princípios fundamentais de qualidade de código que devem orientar
toda implementação, revisão e refatoração. Não contém regras específicas de linguagem
ou ferramentas — apenas conceitos gerais aplicáveis a qualquer stack.

---

## Convicção central

> Código bom é código que dá para **alterar sem causar bugs** e que está **bem documentado** o suficiente para que qualquer pessoa (incluindo você do futuro) entenda o *porquê* das decisões.

Tudo o que segue é consequência dessa ideia.

---

## SOLID

### S — Single Responsibility Principle
Cada módulo, classe ou função deve ter **um único motivo para mudar**. Responsabilidades diferentes devem estar separadas.

### O — Open/Closed Principle
Entidades devem estar **abertas para extensão, fechadas para modificação**. Prefira adicionar comportamento novo sem reescrever o existente (polimorfismo, estratégias, hooks).

### L — Liskov Substitution Principle
Subtipos devem poder substituir seus tipos base **sem alterar a corretude do programa**. Se uma subclasse quebra a expectativa da superclasse, o design está errado.

### I — Interface Segregation Principle
Interfaces pequenas e coesas são melhores que interfaces grandes e genéricas. Um cliente não deve ser forçado a depender de métodos que não usa.

### D — Dependency Inversion Principle
Módulos de alto nível não devem depender de módulos de baixo nível. Ambos devem depender de **abstrações**. Abstrações não devem depender de detalhes; detalhes devem depender de abstrações.

---

## Clean Code

### Nomes significativos
- Nomes devem revelar intenção: `calcularFatura()` em vez de `calc()`, `usuariosAtivos` em vez de `data`.
- Evite abreviações, siglas não óbvias e nomes genéricos como `dados`, `info`, `temp`.

### Funções pequenas e focadas
- Uma função deve fazer **uma coisa só** e fazer bem.
- Poucos parâmetros (idealmente 0 a 2). Muitos parâmetros indicam que a função faz demais.
- Early returns são melhores que aninhamento profundo.
- Evite flags booleanas que alteram o fluxo interno da função — prefira duas funções distintas.

### Sem side effects ocultos
- Funções que prometem ser puras não devem alterar estado global, arquivos ou bancos de dados inesperadamente.
- Efeitos colaterais devem estar claros pelo nome ou pelo contexto.

### Comentários
- Comente **o porquê**, não **o quê**. O código já diz o que faz.
- TODO e FIXME sem contexto (issue associada, data, autor) são ruído.

### Tratamento de erros
- Erros não devem ser silenciados. Um `catch` genérico sem log ou ação é pior que não tratar.
- Use exceções ou resultados explícitos (como `Result`, `Either`) em vez de códigos de retorno opacos.

---

## Clean Architecture

### Regra de dependência
As dependências de código devem apontar **para dentro**: o núcleo de negócio (domínio, entidades, casos de uso) não deve depender de frameworks, bancos de dados, bibliotecas externas ou UI.

### Separação de responsabilidades
- **Domínio**: regras de negócio centrais, sem dependência externa.
- **Casos de uso**: orquestração de regras de negócio para um objetivo específico.
- **Adaptadores / Infra**: implementações concretas de banco, API, UI — detalhes trocáveis.

### Testabilidade
- O núcleo de negócio deve ser testável **sem banco, sem rede, sem framework**.
- Se uma entidade ou caso de uso só pode ser testado com integração, há acoplamento excessivo.

### Portas e adaptadores
- Defina interfaces (portas) para serviços externos no domínio/casos de uso.
- Adaptadores implementam essas interfaces. O domínio não conhece o adaptador.

---

## DDD — Domain-Driven Design

### Linguagem ubíqua
- Use o mesmo vocabulário do domínio no código, nas discussões e na documentação.
- Um termo no código deve ter o mesmo significado para negócio e tecnologia.

### Agregados e entidades
- **Entidade**: objeto com identidade única que persiste ao longo do tempo.
- **Value Object**: objeto imutável definido por seus atributos, sem identidade própria.
- **Agregado**: cluster de entidades e value objects tratado como unidade de consistência. Uma raiz de agregado garante as invariantes.

### Repositórios e domínio rico
- **Repositórios**: abstraem o armazenamento e recuperação de agregados.
- Domínio rico: coloque lógica de negócio nas entidades e value objects, não nos serviços.
- Serviços de domínio existem apenas para operações que não pertencem naturalmente a uma entidade ou value object.

---

## TDD — Test-Driven Development

### Ciclo Red-Green-Refactor
1. **Red**: escreva um teste que falha antes de implementar.
2. **Green**: escreva o código mínimo para passar o teste.
3. **Refactor**: melhore o código sem quebrar os testes.

### O que testar
- Comportamento observável, não detalhes internos de implementação.
- Casos felizes, casos de erro e edge cases.
- Regras de negócio e validações primeiro; integração com I/O depois (com mocks).

### Qualidade dos testes
- Testes devem ser **rápidos, determinísticos e isolados**.
- Não escreva testes triviais que sempre passam sem exercitar lógica real.
- Um teste que falha sem dar contexto (mensagem genérica, assertion opaca) é um débito técnico.
- Não deixe `skip`, `xfail` ou `todo` em testes sem justificativa explícita.

---

## Critérios de avaliação

| Nível | Significado |
|---|---|
| **ERRO** | Viola a convicção central: introduz risco de bug, quebra a regra de dependência, ou torna a mudança perigosa. |
| **AVISO** | Viola um ou mais princípios acima, mas sem risco funcional imediato. Gera dívida técnica. |
| **SUGESTÃO** | Poderia ser mais claro, mais coeso ou mais consistente com os princípios, mas está funcionalmente correto. |

---

## Regra final

Esta skill não se sobrepõe ao toolchain ou às convenções operacionais definidas no `AGENTS.md` do projeto. Ela serve como guia de **qualidade de design** — aplique os princípios com bom senso, não como dogma.
