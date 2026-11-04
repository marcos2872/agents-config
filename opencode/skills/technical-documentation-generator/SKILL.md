---
name: technical-documentation-generator
description: "Gerar documentação técnica consolidada (Markdown) de um módulo de backend a partir de seus fontes e do contrato OpenAPI exposto via Swagger. Produz README principal (arquitetura, stack, configuração, endpoints) e anexo opcional com schemas/DTOs detalhados. Use quando: gerar README técnico, documentar API REST, documentar módulo Spring Boot, consolidar Swagger em Markdown, gerar anexo de DTOs, exportar OpenAPI para MD, criar documentação de arquitetura."
argument-hint: "Gere a documentação técnica do módulo <nome> a partir do Swagger <url>"
---

# Gerador de Documentação Técnica

> **Pasta da skill.** No OpenCode esta skill fica em `~/.config/opencode/skills/technical-documentation-generator/` (o runtime informa o caminho em
> *Base directory for this skill*). Os comandos abaixo já usam esse caminho; se o `opencode/` for sincronizado em
> outro destino, ajuste para `<destino>/skills/technical-documentation-generator`.

Skill para gerar documentação técnica consolidada em Markdown de um módulo de backend (tipicamente Java/Spring Boot, mas adaptável), combinando duas fontes:

1. **Código-fonte do módulo** — extrai stack, estrutura de pacotes, modelo de dados, configurações, padrões.
2. **Contrato OpenAPI ao vivo** (`/v3/api-docs` do Swagger) — extrai catálogo completo de endpoints e schemas/DTOs.

## Quando Usar

- Criar/atualizar o `README.md` técnico de um módulo backend.
- Documentar uma API REST exposta via springdoc-openapi (Swagger).
- Gerar anexo separado com **todos os DTOs/Schemas** detalhados (campos, tipos, validações, enums).
- Consolidar arquitetura, stack, configurações e endpoints em um único documento navegável.

## Pré-requisitos

- O backend precisa estar **rodando e acessível** (URL do `/v3/api-docs` deve responder com JSON OpenAPI 3).
- Acesso ao código-fonte do módulo (build file, configs, controllers, models).
- `python3` disponível (para parsing do JSON OpenAPI e geração das tabelas).
- `curl` disponível para baixar o spec.

## ⚠️ Inputs Obrigatórios — SEMPRE Solicitar ao Usuário

**Antes de executar qualquer passo**, a skill DEVE perguntar ao usuário, mesmo que algum valor pareça óbvio pelo contexto. Use o tool `question` (ou equivalente) para coletar:

### 1. Identificação do projeto/módulo
- **Nome do projeto** (ex.: `Minha Plataforma`)
- **Nome do módulo a documentar** (ex.: `meu-servico`)
- **Caminho do código-fonte do módulo** (relativo à raiz do workspace, ex.: `meu-servico/`)
- **Descrição curta do papel do módulo** no ecossistema (1–2 linhas) — opcional, pode ser inferido se omitido

### 2. URL do Swagger / OpenAPI
- **URL completa do JSON OpenAPI** (ex.: `http://localhost/api/v3/api-docs`)
- Confirme que está acessível agora (faça um `curl -sS -o /dev/null -w "%{http_code}"` e valide HTTP 200)
- Se estiver protegida por autenticação, peça também o header/token

### 3. Destino do arquivo principal
- **Caminho completo do arquivo MD principal** (ex.: `README.md`, `meu-servico/README.md`, `docs/meu-servico/README.md`)
- Se o arquivo já existir, **confirmar explicitamente se pode sobrescrever** (mostre o tamanho/linhas atuais)

### 4. Anexo de DTOs/Schemas (opcional)
- **Gerar anexo de schemas?** (sim/não)
- Se sim: **caminho de destino do anexo** (ex.: `docs/meu-servico/SCHEMAS.md`)
- O README principal receberá um link para o anexo na seção de Referências

### 5. Idioma do documento
- `pt-BR` (padrão), `en` ou outro

> **Nunca** assumir esses valores silenciosamente. Se o usuário responder de forma ambígua (ex.: "README.md" sem caminho), pergunte novamente para desambiguar (raiz vs. submódulo).

## Procedimento

### Passo 1 — Coletar inputs
Faça as perguntas acima usando o tool `question` com múltiplas perguntas no mesmo bloco. Recomende valores padrão quando aplicável, marcando-os como `(Recomendado)`.

### Passo 2 — Baixar o contrato OpenAPI
```bash
curl -sS "<URL_OPENAPI>" -o /tmp/openapi.json
# Validar:
python3 -c "import json; d=json.load(open('/tmp/openapi.json')); print('paths:', len(d.get('paths',{})), 'schemas:', len(d.get('components',{}).get('schemas',{})), 'title:', d.get('info',{}).get('title'))"
```
Se falhar, pare e peça ao usuário para subir o backend ou corrigir a URL.

### Passo 3 — Explorar o código-fonte
Em paralelo, leia/liste:
- Build file (`build.gradle`, `pom.xml`, `package.json`, etc.) → stack, versões, dependências
- Configurações (`application*.properties`, `application*.yml`, `.env*`) → variáveis, perfis, datasource, integrações
- Migrações de DB (`db.migration/V*.sql`, `migrations/`, etc.) → modelo de dados
- Estrutura de pacotes/diretórios (`controller/`, `service/`, `model/`, `dto/`, `repo/`)
- Dockerfile e scripts de execução (`run.sh`, `Dockerfile`)
- README atual (se existir) — preservar referências relevantes (diagramas, links externos)

### Passo 4 — Gerar tabela de endpoints
Use o script auxiliar [`scripts/generate-endpoints-md.py`](./scripts/generate-endpoints-md.py) para parsear o OpenAPI e produzir tabelas Markdown agrupadas por tag e subdomínio:

```bash
python3 ~/.config/opencode/skills/technical-documentation-generator/scripts/generate-endpoints-md.py \
  --openapi /tmp/openapi.json \
  --output /tmp/endpoints.md \
  --java-root <módulo>/src/main/java/<pacote/raiz> \
  --titles-json .agents/technical-documentation-generator/titles.json   # se o projeto tiver o seu
```

O script agrupa por **tag** do Swagger (que normalmente corresponde 1:1 ao controller/recurso) e por subdomínio.

**Módulo Java/Spring com subpacotes por domínio** (`controller/<domínio>/`, `dto/<domínio>/`...): use `--java-root`
com a raiz dos pacotes. O subdomínio de cada tag é o subpacote do controller que declara a `@Tag`; uma tag usada por
controllers de mais de um domínio fica onde está a maioria. Não precisa de mapa de domínios: ele sai do código.

**Outros módulos**: os domínios ficam no projeto, não na skill: `.agents/technical-documentation-generator/domain-map.json`
(mesma estrutura de `DEFAULT_DOMAIN_MAP`, passado em `--domain-map-json`, que tem precedência sobre `--java-root`) e,
para o anexo, `.agents/technical-documentation-generator/domain-keywords.json` (mesma estrutura de
`DEFAULT_DOMAIN_KEYWORDS`). Sem eles, valem os exemplos dos scripts ou `--no-subdomain`.

**Títulos das seções**: `.agents/technical-documentation-generator/titles.json`, passado em `--titles-json` nos dois
scripts, com `{"<domínio>": "<título>"}` e `"misc"` para o grupo do que não se classifica (padrão: "Outros"). A ordem
das chaves é a ordem das seções; o domínio sem título aparece com o nome do pacote capitalizado.

```json
{"auth": "Autenticação & Usuários", "billing": "Faturamento", "misc": "Outros"}
```

### Passo 5 — Montar o README principal
Estrutura recomendada (ajuste conforme inputs do usuário):

```
1. Visão Geral (papel do módulo, fluxo de dados macro)
2. Stack Tecnológica (tabela de tecnologias e versões)
3. Arquitetura & Estrutura de Pacotes
4. Modelo de Dados (entidades por subdomínio + total de schemas)
5. Configuração & Variáveis de Ambiente
6. Autenticação & Autorização
7. Catálogo de Endpoints (tabelas geradas no Passo 4)
8. Mensageria / Integrações Assíncronas (se aplicável: Kafka, RabbitMQ, SQS)
9. Tratamento de Erros (exception handlers, status HTTP)
10. Migrations & Seeders
11. Como Executar (Docker e build local)
12. Documentação OpenAPI / Swagger (URLs)
13. Observabilidade (tracing, métricas, logs)
14. Convenções de Código
15. CI/CD (workflows)
16. Referências (incluindo link para o anexo de DTOs, se gerado)
```

### Passo 6 — Gerar anexo de DTOs (opcional)
Se o usuário solicitou anexo, use [`scripts/generate-schemas-md.py`](./scripts/generate-schemas-md.py):

```bash
python3 ~/.config/opencode/skills/technical-documentation-generator/scripts/generate-schemas-md.py \
  --openapi /tmp/openapi.json \
  --output <caminho-do-anexo> \
  --java-root <módulo>/src/main/java/<pacote/raiz> \
  --titles-json .agents/technical-documentation-generator/titles.json \
  --keywords-json .agents/technical-documentation-generator/domain-keywords.json \
  --title "<Projeto> — Anexo: DTOs / Schemas" \
  --source-url "<URL do OpenAPI>"
```

Com `--java-root`, o subdomínio de cada schema é o subpacote da classe Java de mesmo nome (ou do
`@Schema(name = ...)`), também sem o envelope `Page…`/`PagingDTO…`/`…DTO`. As palavras-chave (`--keywords-json`) ficam
só para o que não for achado; o que sobrar vai para `misc`. Cada argumento é opcional.

O script gera tabelas para cada schema com colunas: **Campo · Tipo · Obrigatório · Observações**, com:
- Links internos para tipos referenciados (`$ref`)
- Detecção de enums, formatos (`uuid`, `date-time`, `email`, etc.)
- Validações (`minLength`, `maxLength`, `min`, `max`, `pattern`, `default`, `example`)
- Flags `readOnly`, `nullable`, `deprecated`
- Sumário no topo, agrupado por subdomínio, com âncoras explícitas (`#dominio-<chave>`) que funcionam também com
  títulos acentuados

### Passo 7 — Adicionar link cruzado
Se o anexo foi gerado, edite a seção **Referências** do README principal para incluir:

```markdown
- **Anexo — DTOs / Schemas detalhados (N estruturas)**: [`<caminho-relativo>`](caminho-relativo)
```

### Passo 8 — Validar resultado
- Confirmar que os arquivos foram criados nos caminhos solicitados
- Reportar ao usuário: total de linhas/chars, total de endpoints documentados, total de schemas (se anexo)
- Sugerir abrir os arquivos para revisão

## Heurística de Classificação por Subdomínio

Em módulo Java/Spring, prefira `--java-root` (Passo 4): o domínio sai do pacote e não depende do nome. Sem ele, os
scripts classificam tags/schemas por palavras-chave no nome. A lista padrão é:

| Subdomínio | Palavras-chave |
|---|---|
| `auth` | auth, account, token, password, reset, user, permission, login, register |
| `catalog` | product, category, item, catalog |
| `orders` | order, invoice, payment, cart, checkout |
| `messaging` | event, message, notification, email, job |

A lista é um exemplo ilustrativo. Os domínios do sistema vão para os JSON do projeto em
`.agents/technical-documentation-generator/` (ver o Passo 4), nunca para os scripts da skill.

Para outros projetos, **pergunte ao usuário** se quer customizar essa classificação ou aceitar a genérica (uma seção única "Endpoints" sem subdivisão).

## Boas Práticas

- **Preservar conteúdo legado**: se o README atual tem referências a diagramas (`docs/*.png`), mover para a seção Referências em vez de descartar.
- **Não inventar valores**: se uma config não está clara nos fontes, marque como `(verificar)` ou pergunte.
- **Tabelas Markdown**: escapar `|` em descrições (`\|`), truncar `example` muito longo (>60 chars).
- **Idempotência**: rodar a skill duas vezes seguidas deve gerar o mesmo resultado (sem timestamps voláteis).
- **Erros de rede**: se o `curl` falhar com timeout/499, instrua o usuário a verificar se o backend está saudável e tente novamente — não improvise endpoints a partir só dos fontes.

## Arquivos da Skill

- [`scripts/generate-endpoints-md.py`](./scripts/generate-endpoints-md.py) — Gera tabela de endpoints agrupada por tag/subdomínio
- [`scripts/generate-schemas-md.py`](./scripts/generate-schemas-md.py) — Gera anexo de DTOs/Schemas detalhado
- [`scripts/dominios_java.py`](./scripts/dominios_java.py) — Domínio de cada tag e de cada schema lido dos subpacotes Java (`--java-root`)

## Exemplo de Invocação

> "Gere a documentação técnica do módulo `meu-servico` a partir do Swagger `http://localhost/api/v3/api-docs`, salvando o README principal em `./README.md` e o anexo de schemas em `./docs/meu-servico/SCHEMAS.md`."

A skill irá:
1. Confirmar todos os inputs (mesmo que fornecidos no prompt)
2. Validar a URL do Swagger
3. Explorar `meu-servico/`
4. Gerar README principal com 154 endpoints catalogados
5. Gerar anexo com 159 schemas detalhados
6. Adicionar link cruzado entre os documentos
7. Reportar métricas finais (linhas, endpoints, schemas)
