---
name: code-conventions
description: Convenções globais do projeto — execução de comandos, qualidade por linguagem, testes, código limpo e princípios de arquitetura. Carregue antes de auditar, escrever testes ou executar comandos do projeto.
---

# Code Conventions

Esta skill define a interface operacional do projeto, os checklists de qualidade e as regras universais de teste.  
Ela deve orientar agentes de auditoria, QA e implementação sem sobrescrever automaticamente o toolchain já adotado pelo repositório. [web:9]

---

## Objetivo

Use esta skill para:

- Detectar a linguagem, o gerenciador de pacotes e a interface canônica do projeto antes de executar qualquer comando. [web:9]
- Padronizar a forma de rodar desenvolvimento, build, testes e lint.
- Avaliar qualidade de código, design, testes e acoplamento arquitetural.
- Reportar achados como `ERRO`, `AVISO` ou `SUGESTÃO`.

---

## Ordem de decisão

### 1. Detectar antes de agir

Antes de executar qualquer comando:

1. Detecte a linguagem e o toolchain real do projeto.
2. Verifique se existe `AGENTS.md`, `README`, `Makefile`, `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml` ou equivalente.
3. Use a interface já oficial do projeto sempre que ela existir. [web:9]

### 2. Interface de execução

Use a seguinte prioridade:

1. Se existir `Makefile` e ele for a interface operacional do projeto, prefira `make <target>`.
2. Se não existir `Makefile`, use a interface nativa do projeto, como `uv run`, `npm run`, `go test`, `cargo test` ou equivalente. [web:9][web:25]
3. Só proponha criar `Makefile` quando:
   - o projeto não tiver interface unificada; ou
   - o usuário pedir padronização operacional.

### 3. Regra de mudança

- Não criar, reestruturar ou migrar arquivos automaticamente durante auditoria.
- Primeiro detectar e reportar.
- Só alterar a estrutura quando isso for explicitamente solicitado.

---

## Classificação dos achados

### ERRO
Problema com risco funcional, de segurança, de integridade ou de manutenção crítica.

### AVISO
Problema relevante de qualidade, legibilidade, acoplamento, testes ou evolução.

### SUGESTÃO
Melhoria desejável de clareza, consistência ou ergonomia.

---

## Convenções globais

### Makefile

Se houver `Makefile`, ele pode ser usado como fachada operacional do projeto.  
Quando adotado, os targets recomendados são:

- `make dev`
- `make build`
- `make test`
- `make lint`
- `make format`
- `make install`
- `make clean`

Targets opcionais:

- `make typecheck`
- `make docs`
- `make migrate`
- `make seed`
- `make docker`

### Regras para Makefile

- Não assumir que todo projeto precisa de `Makefile`.
- Não duplicar uma interface já consolidada em `package.json`, `justfile`, `tox`, `nox`, `cargo` ou scripts de CI.
- Se um `Makefile` for criado, ele deve ser uma fachada fina sobre os comandos reais do projeto.

---

## Princípios universais

### Estrutura

- Função excessivamente longa → `AVISO`
- Aninhamento maior que 3 níveis → `AVISO`
- Arquivo excessivamente longo → `AVISO`
- Código duplicado em 3 ou mais pontos → `AVISO`

### Segurança

- Segredo hardcoded no código ou log → `ERRO`
- Entrada de usuário sem validação → `ERRO`
- Path vindo do cliente sem whitelist → `ERRO`
- Desserialização de entrada não confiável sem validação de schema → `ERRO`
- Variável sensível com default inseguro no código → `ERRO`

### Manutenção

- Dependência importada e não usada → `AVISO`
- Nome pouco descritivo → `SUGESTÃO`
- Comentário explicando "o quê" em vez de "por quê" → `SUGESTÃO`
- TODO/FIXME sem contexto ou issue → `SUGESTÃO`

---

## Código limpo

As regras abaixo devem ser avaliadas como heurísticas de legibilidade e manutenção, não como dogma absoluto.  
A intenção é favorecer nomes significativos, funções focadas, baixo acoplamento e fluxo de leitura simples. [web:22][web:24][web:27]

### Regras gerais

- Nome de variável, classe e função deve revelar intenção → caso contrário `AVISO`. [web:24][web:27]
- Função deve ter responsabilidade única → se fizer muitas coisas, `AVISO`. [web:22]
- Muitos parâmetros em função pública → `AVISO`. [web:22]
- Boolean flag alterando comportamento de função pública → `AVISO`
- Magic numbers sem constante nomeada → `AVISO`. [web:22]
- Fluxo com nesting profundo quando early return resolveria → `AVISO`. [web:22]
- Side effects ocultos em função aparentemente pura → `AVISO`
- Tratamento de erro silencioso ou genérico sem contexto → `AVISO`
- Código difícil de entender sem comentário explicando intenção → `SUGESTÃO`
- Comentário redundante explicando o óbvio → `SUGESTÃO`. [web:22]

---

## Arquitetura limpa

Arquitetura limpa deve ser aplicada como princípio de dependência e separação de responsabilidades, não como obrigação de pastas ou camadas fixas.  
A regra central é que dependências de código apontem para dentro, preservando o núcleo de negócio desacoplado de framework, banco e interface externa. [web:21][web:26][web:29]

### Regras arquiteturais

- Regra de dependência violada, com domínio dependendo de infra ou framework → `ERRO`. [web:21][web:29]
- Regra de negócio acoplada diretamente a controller, ORM, HTTP client ou UI → `AVISO`
- Casos de uso ausentes quando a lógica de aplicação está espalhada por adapters → `AVISO`
- Infraestrutura conhecendo detalhes internos do domínio além de contratos necessários → `AVISO`
- Entidades ou regras centrais impossíveis de testar sem banco, web framework ou rede → `AVISO`
- Estrutura de pastas diferente do padrão "clean architecture" não é problema por si só → não reportar sem evidência de acoplamento

### Sinais positivos

- Casos de uso explícitos
- Portas/interfaces para serviços externos
- Domínio testável em isolamento
- Framework tratado como detalhe de borda

---

## Python

### Gerenciador e execução

Para projetos Python novos ou já baseados em `uv`, prefira `uv` para dependências e execução.  
Se o projeto já usa outro fluxo consolidado, respeite o toolchain existente e não force migração automática. [web:9][web:25]

| Ação | Comando preferencial |
|---|---|
| Instalar dependências | `uv sync` |
| Executar comando no ambiente | `uv run <comando>` |
| Adicionar dependência | `uv add <pacote>` |

### Checklist Python

- Função pública sem anotação de tipo → `AVISO`
- `Optional[X]` em vez de `X | None` em Python moderno → `AVISO`
- `Union[X, Y]` em vez de `X | Y` → `AVISO`
- `List`/`Dict` de `typing` quando built-ins bastam → `AVISO`
- `except Exception` sem contexto ou log → `AVISO`
- `print()` em código de produção → `AVISO`
- `os.path` quando `pathlib.Path` for mais claro → `AVISO`

### Pydantic

- `.dict()` em vez de `.model_dump()` → `ERRO`
- `.schema()` em vez de `.model_json_schema()` → `ERRO`
- `validator` legado em vez de `field_validator` → `ERRO`

### Testes Python

- Framework preferencial: `pytest`
- Fixtures compartilhadas em `conftest.py`
- Mocks com `unittest.mock` ou `pytest-mock`
- Testar comportamento observável, não detalhes internos

---

## TypeScript / JavaScript

### Checklist

- `any` explícito sem justificativa → `AVISO`
- Mutação direta de estado em UI → `ERRO`
- `fetch` acoplado diretamente ao componente quando deveria estar em camada de acesso → `AVISO`
- `useEffect` assíncrono sem cleanup quando aplicável → `AVISO`
- Props públicas sem tipagem → `AVISO`
- Componente excessivamente grande → `AVISO`

### Testes

- Detectar Jest, Vitest ou ferramenta declarada no projeto
- Um arquivo de teste por módulo-alvo relevante
- Mock explícito para dependência externa
- Não testar detalhe interno de framework quando o comportamento público bastar

---

## Rust

### Checklist

- `unwrap()` ou `expect()` em produção sem justificativa → `AVISO`
- `unsafe` sem comentário justificando invariantes → `AVISO`
- Warning do clippy ignorado sem motivo → `AVISO`
- `clone()` excessivo → `SUGESTÃO`

### Testes

- Unitários próximos ao código
- Integração em `tests/`

---

## Regras universais de teste

### Prioridade de cobertura

1. Funções puras e lógica de domínio
2. Validações e transformações
3. Casos de erro e edge cases
4. Integrações com I/O usando mocks
5. Endpoints e handlers

### Regras

- Testar comportamento observável
- Não escrever testes triviais que sempre passam
- Não usar path absoluto hardcoded
- Não chamar API externa em teste
- Não deixar `skip`, `xfail` ou `todo` sem justificativa
- Reutilizar fixtures/helpers compartilhados da linguagem

---

## Detecção de stack

| Evidência | Linguagem | Ferramenta provável | Comando inicial sugerido |
|---|---|---|---|
| `uv.lock` ou `pyproject.toml` com `uv` | Python | uv | `uv run pytest` |
| `pyproject.toml` | Python | uv/pip/poetry | verificar projeto |
| `package.json` | JS/TS | npm/pnpm/yarn | verificar scripts |
| `go.mod` | Go | go | `go test ./...` |
| `Cargo.toml` | Rust | cargo | `cargo test` |

### Comandos úteis de inspeção

```bash
ls Makefile AGENTS.md README.md pyproject.toml uv.lock requirements.txt package.json go.mod Cargo.toml 2>/dev/null
find . -maxdepth 3 -type d \( -name tests -o -name test -o -name __tests__ -o -name spec \) 2>/dev/null
```

---

## Regra final

Esta skill deve:

1. Detectar antes de executar.
2. Respeitar a interface real do projeto.
3. Reportar antes de modificar.
4. Priorizar segurança, testabilidade, clareza e baixo acoplamento.
5. Aplicar código limpo e arquitetura limpa como princípios de qualidade, não como religião. [web:21][web:22]
