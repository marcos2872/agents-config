---
name: er-diagram-generator
description: Gera e atualiza o diagrama E/R físico do banco PostgreSQL do projeto a partir do catálogo (schema real, não os requisitos). Produz uma página HTML navegável por domínio e, se configurado, um Mermaid por domínio. Use quando pedirem o E/R do banco, a planta do banco, atualizar o diagrama depois de uma migration, ou conferir o que existe hoje no banco.
---

# er-diagram-generator

Pipeline **catálogo do PostgreSQL → página E/R navegável**. A fonte é o **banco vivo**, não
`docs/requisitos/**`.

```
pg_catalog (banco do projeto) ─────────────┐
entidades no código (opcional) ────────────┼─[build.py · código]──▶ docs/diagramas/planta-do-banco.html
.agents/er-diagram-generator/domains.json ─┘                     └▶ docs/diagramas/mermaid/ER-banco-fisico.md
```

> É o schema **físico**: nomes de tabela e coluna como estão no banco, com contagem real de linhas.
> O modelo de objetos que o mapeia (classes, associações, herança) é o da `uml-class-diagram-generator`.
> Se o projeto também usa a `mermaid-diagram-generator`, o E/R dela é outro: o modelo **lógico**, gerado
> a partir dos requisitos, com nomes em português.

## Mecanismo × projeto

> **Pasta da skill.** No OpenCode esta skill fica em `~/.config/opencode/skills/er-diagram-generator/` (o runtime informa o caminho em
> *Base directory for this skill*). Os comandos abaixo já usam esse caminho; se o `opencode/` for sincronizado em
> outro destino, ajuste para `<destino>/skills/er-diagram-generator`.


| Onde | O quê | Muda de projeto para projeto? |
|---|---|---|
| a pasta da skill | `build.py`, a consulta ao catálogo (`schema.sql`), os leitores de entidades (`entidades.py`, `leitor_csharp.py`), o modelo da página, os modelos de configuração, este guia | não |
| `.agents/er-diagram-generator/config.json` | acesso ao banco, pasta das migrações, linguagem e pastas das entidades, saídas | sim |
| `.agents/er-diagram-generator/domains.json` | a folha (domínio) de cada tabela, curada à mão | sim |

A raiz do projeto é a pasta, a partir da atual e sem passar da raiz do git, que tem `.agents/er-diagram-generator/`;
sem ela (antes do `--iniciar`), a raiz do repositório git. `ER_RAIZ` sobrescreve; `ER_DADOS` aponta outra pasta de
dados.

## Princípio de arquitetura

**Um estágio de modelo + um contrato.** O modelo faz UMA coisa: **classificar tabelas novas**
em `domains.json`. Todo o resto é código determinístico — extração, layout, notação, HTML.

O `build.py` **falha** se `domains.json` não bater com o banco: tabela do banco sem folha, linha de
tabela que não existe mais, ou tabela em duas folhas. Lista todos os desvios de uma vez. Isso é
proposital: tabela nova sem dono é a única decisão que exige julgamento.

Com Flyway, ele também **falha** se o banco não tiver aplicado todas as migrações da pasta configurada,
listando as que faltam: a planta tem de mostrar o schema do código atual, não o de um banco atrasado.

## Primeira vez no projeto

```bash
S=~/.config/opencode/skills/er-diagram-generator/scripts                 # copiada no projeto: .agents/skills/er-diagram-generator/scripts
python3 $S/build.py --iniciar            # cria config.json e domains.json a partir dos modelos
bash $S/vendor.sh                        # uma vez por máquina: ELK e fontes da página offline (precisa de rede)
```

Ajuste `config.json`:

| Campo | O que é |
|---|---|
| `banco` | `container`, `usuario`, `nome` e `schema` para ler via `docker exec <container> psql`; ou `url` (string de conexão) para `psql` direto |
| `migracoes` | `flyway` (liga a conferência), `pasta` dos `V<versão>__*.sql` e `como_aplicar` (instrução mostrada quando o banco está atrás do código) |
| `entidades` | `linguagem` do código e `pastas` com as entidades, relativas à raiz; lista vazia desliga o mapeamento tabela → entidade (ver **Entidades no código**) |
| `saidas` | `html`, `mermaid` e `url_do_artefato`, relativos à raiz; `mermaid` vazio desliga o Mermaid por domínio |

Depois rode o build: ele para listando todas as tabelas sem folha. Monte as folhas em `domains.json`
(ver abaixo) e rode de novo.

## Como executar

```bash
S=~/.config/opencode/skills/er-diagram-generator/scripts                 # copiada no projeto: .agents/skills/er-diagram-generator/scripts
python3 $S/build.py                      # extrai do banco, valida, escreve a página (e o Mermaid, se ligado)
python3 $S/build.py --online             # HTML que busca ELK e fontes na CDN (arquivo ~180 KB)
python3 $S/build.py --no-mermaid         # só a página
python3 $S/build.py --banco-atras        # gera mesmo com migração pendente (só avisa) — foto de um banco velho
```

Por padrão a página sai **offline** (~2 MB): ELK e as fontes IBM Plex embutidos, sem nenhuma
requisição externa. Precisa de o ELK e as fontes, baixados uma vez por máquina pelo `vendor.sh` para `~/.cache/skill-kit/vendor` (ou
`$SKILL_KIT_CACHE/vendor`); se a skill já tiver `assets/vendor/`, vale esse. Uma atualização do plugin não
obriga a baixar de novo.

O `build.py` não pede nada ao banco além de leitura (`SELECT` no catálogo e `count(*)`).
Ele **não** aplica migration nem altera dado.

### Quando alguma tabela não tem domínio

O build para com a lista de tabelas órfãs. Abra `domains.json` e coloque cada uma na folha a que
pertence, olhando a entidade que a mapeia e as FKs dela. Se a tabela não tem entidade nenhuma
(histórico do Flyway, backup, tabela abandonada), ela vai para a folha `legado`. Depois rode o build de novo.

`domains.json` é **curadoria**, não derivação: as folhas seguem o assunto (cadastro, pedido,
faturamento…), não o pacote do código — um pacote grande daria uma folha ilegível. Cada folha tem
`id`, `label`, `hue`/`chroma` (matiz OKLCH; chroma 0 = cinza), `desc` e `tables`; a ordem das folhas é
a ordem da navegação.

## Requisitos × banco (opcional)

Compara as entidades descritas nos documentos de requisitos com as tabelas do catálogo. Liga com a seção `logico` na configuração;
sem ela, nada muda.

```json
"logico": { "requisitos": ["docs/requisitos/modulo-*.md"], "ignorar": [] }
```

- **Entidades:** cada título `### E – Nome` dos documentos é uma entidade; a tabela `| Campo | Tipo | Obrigatório |
  Descrição |` logo abaixo dá os campos (entidade só em texto corrido entra sem campos). A leitura é refeita a cada build,
  pelo `scripts/logico.py` (cópia idêntica na planta do banco e no diagrama de classes).
  Entidade com a tag `#hipótese` no título (escrita a partir do documento de contexto, antes do comitê) sai marcada
  como hipótese no `--divergencias` e na lista de planejadas.
- **Mapeamento, curado à mão:** a seção `entidades` do `domains.json` desta skill:

  ```json
  "entidades": {
    "Fazenda": { "tabelas": ["farms"] },
    "Plantio e Cultura no Plantio": { "tabelas": ["plantings", "planting_crops"] },
    "Parceiro": { "planejado": true, "motivo": "ainda não implementado" }
  }
  ```

  A chave é o nome do título, sem as tags. Entidade guardada de outro jeito (JSON numa coluna, por exemplo) aponta a
  tabela onde vive, com um `motivo`.
- **`--divergencias`** lista, sem gravar a página: o **planejado** (nos requisitos, ainda sem tabela), o que está
  **fora dos requisitos** (tabela que nenhuma entidade cobre; a folha `legado` não conta), o mapeamento que aponta tabela que não
  existe, as entidades **sem mapeamento** e as do mapeamento que sumiram dos requisitos. O build normal só imprime o resumo.
- **Na página:** tabela fora dos requisitos ganha uma faixa âmbar à esquerda; o painel da tabela mostra a entidade dos requisitos que ela implementa, com o primeiro parágrafo em prosa da seção (o que ela é para o negócio; seção que abre com a tabela de campos, um esboço em código ou uma lista não tem), o arquivo, a linha, o motivo e os campos do documento;
  a visão geral resume ligadas, planejadas, sem mapeamento e fora, e lista as planejadas.
- **Campo a campo (opcional):** liga com o `campos.json`, na mesma pasta do arquivo do mapeamento. Os nomes do
  requisito estão no idioma do negócio e os do banco no do código, e nenhuma regra fixa traduz `horas_dia` em
  `hours_per_day`: a tradução é **um estágio de modelo**, feita uma vez e gravada; o build só confere, sempre igual.
  Sem o arquivo, nada muda.

  ```json
  {
    "Fazenda": {
      "nome": "farms.name",
      "documento": "farms.document",
      "proprietario_nome": {"coluna": ["farms.owner_name", "farm_owners.name"],
                             "obrigatoriedade": "farm_owners só tem linha quando há proprietário"},
      "matriculas_esperadas": {"planejado": "sem coluna em farms"},
      "status": {"derivado": "calculado, nunca gravado"},
      "documento_pdf_id": {"duvida": "o PDF fica em document_key, não como chave para o Drive"}
    },
    "Matrícula CAR": {
      "numero_car": {"coluna": "car_number", "ancora": "numero_car"},
      "cartorio": {"coluna": "registry", "ancora": "cartorio?", "obrigatorio": false}
    }
  }
  ```

  A chave de fora é a entidade; a de dentro, o nome do campo no requisito (numa linha com vários nomes, como
  `municipio / uf / cod_ibge`, um par por nome). O par é `"tabela.coluna"` (só `"coluna"` quando a entidade tem uma
  tabela), uma lista delas, ou um objeto com `coluna`, `planejado`, `derivado` ou `duvida` (o texto é o motivo).
  `obrigatoriedade` (o motivo) pula a comparação de obrigatório quando ela não se aplica. Entidade **em texto corrido**:
  os campos são os que o modelo leu no parágrafo, cada um com a `ancora` que o acha na seção da entidade (omitida, é o
  próprio nome) e, se o texto disser, `obrigatorio` e `tipo`.

  **Estágio de modelo, passo a passo:**
  1. `python3 $S/build.py --campos-pendentes [ENTIDADE ...]` imprime, por entidade ligada com algo pendente, os campos
     do requisito (ou o texto da seção), as colunas de cada tabela, com tipo, nulo e default e os pares com problema.
  2. Escreva os pares no `campos.json`. Só ligue o que tem o mesmo significado; na dúvida, `duvida` com a pergunta.
     Nunca invente coluna: campo do requisito sem coluna é `planejado` (ou `derivado`, se o texto diz que não se grava).
  3. `--divergencias` confere; acerte os erros do `campos.json`.
  4. `--aceitar-campos [ENTIDADE ...]` grava o carimbo de cada par (no `carimbos.json` ao lado), da linha do requisito
     (ou do item do parágrafo). Se a linha mudar depois, só aquele par volta como "o requisito mudou".

  O `--divergencias` ganha o bloco campo a campo: **obrigatoriedade diferente** (✔ no requisito e coluna anulável, ou
  campo sem ✔ e coluna `NOT NULL` sem default; só quando a tabela do requisito tem a coluna Obrigatório), coluna
  inexistente, requisito mudou, pares sem carimbo, **tamanho diferente** (aviso: `texto(14)` × `varchar(200)`), dúvidas,
  planejados, **colunas fora dos requisitos** (de tabelas cujas entidades já têm todas os pares; `id`, `created_at`,
  `updated_at`, `deleted_at`, `created_by`, `updated_by` e `xmin` não contam, troque com `logico.colunas_ignoradas`) e
  as entidades ainda sem tradução. O painel da tabela mostra cada campo com a coluna e a situação, e as colunas fora.

## Entidades no código (opcional)

Com `entidades.pastas` preenchida, o build liga cada tabela à classe do código que a mapeia (`scripts/entidades.py`),
para o painel mostrar a classe, a classe-mãe, o pacote e a **documentação da classe**, que vira a descrição da tabela
quando o banco não tem `COMMENT ON TABLE`. `entidades.linguagem` escolhe o leitor (padrão `java`, como antes; aceita
uma lista, para projeto com mais de uma linguagem):

| `linguagem` | O que reconhece | Documentação |
|---|---|---|
| `java` | JPA / Hibernate (Spring, Quarkus Panache): `@Entity`, `@Table(name)`, `@JoinTable`, `@CollectionTable` | Javadoc `/** */` |
| `kotlin` | JPA / Hibernate, Room (`@Entity(tableName)`) e Exposed (`object X : Table("x")`, `IntIdTable`…) | KDoc `/** */` |
| `csharp` | Entity Framework Core, pelo leitor do diagrama de classes (`leitor_csharp.py`, cópia idêntica): `DbSet<T>`, `ToTable`, `[Table]`, herança TPH | XML `/// <summary>` |
| `javascript` | Prisma (`model` e `@@map`, nos `.prisma`), TypeORM e MikroORM (`@Entity`), sequelize-typescript (`@Table`), Sequelize (`define` / `init` com `tableName`) e Drizzle (`pgTable('x')`), em `.js`, `.ts` e afins | JSDoc `/** */`; `///` no Prisma |
| `dart` | Drift (`class X extends Table`, `tableName`) e Floor (`@Entity(tableName)`) | `///` |
| `rust` | Diesel (`#[diesel(table_name = x)]`, ou derive `Identifiable`/`Insertable` pela convenção) e SeaORM (`#[sea_orm(table_name)]`) | `///` ou `//!` do módulo |

Só marcas explícitas do ORM contam; o leitor nunca liga classe e tabela por semelhança de nome. Sem nome explícito,
a tabela sai da convenção do ORM (nome da classe, snake_case, o plural do Sequelize e do Diesel), conferida contra
as tabelas do banco também em snake_case e em minúsculas. A documentação vale até a primeira marca (`@param`,
`@see`…), título (`# Exemplo`) ou bloco de código. Pastas de build, dependências, migrações e testes (`bin`, `obj`,
`build`, `target`, `node_modules`, `generated`, `.dart_tool`, `test`…) e arquivos gerados (`*.g.dart`, `*.d.ts`)
ficam de fora. Os leitores leem só o mapeamento, não o modelo inteiro: o diagrama de classes continua com Java e C#.

## O que a página tem

- **Visão geral** — os domínios e quantas FKs cruzam de um para outro.
- **Uma folha por domínio** — tabelas do domínio inteiras; tabelas de fora entram tracejadas, só
  pelo nome, na ponta da relação.
- **Notação pé-de-galinha derivada do schema**: FK `NOT NULL` é traço duplo, FK anulável ganha o
  círculo, 1:1 quando a FK é a PK ou tem UNIQUE, tracejado quando a FK **é** a PK (herança JOINED).
- **Painel da tabela** — colunas com tipo e default, valores de enum lidos dos CHECK, unicidade,
  o que referencia e quem a referencia, com a regra ON DELETE, e a entidade do código correspondente (classe,
  classe-mãe, pacote ou namespace).
- **Descrição da tabela** — no topo do painel: o `COMMENT ON TABLE` do banco; sem ele, a documentação da classe que
  mapeia a tabela, com o nome da classe e o arquivo. Tabela sem nenhum dos dois (as de infraestrutura, como
  `spatial_ref_sys`) fica sem descrição.
- **Vizinhança** (duplo clique) — a tabela com tudo que se liga a ela por FK.
- **Tema** — botão no cabeçalho que alterna entre claro e escuro; sem escolha, segue o sistema. A escolha fica no
  navegador com a mesma chave dos diagramas de atividades (`ativ-tema`), então vale para todos os diagramas.

O layout vem do ELK no navegador; o `build.py` não calcula coordenada nenhuma.

## Publicar como artefato (opcional)

A página é um HTML único e funciona como Artifact. Na **primeira** publicação, publique o arquivo
e guarde a URL no arquivo de `saidas.url_do_artefato` (o `build.py` lê esse arquivo e escreve a URL
no rodapé da página). Para **atualizar**, publique com essa mesma URL — sem ela, nasce um artefato
novo e o link antigo congela numa foto velha do banco.

## Regeneração depois de uma migration

Primeiro o banco precisa estar no código atual: aplique as migrações (`migracoes.como_aplicar`).
Depois rode o build: ele relê o catálogo. Não há cache nem hash — a extração inteira leva
segundos. Colunas, tipos, chaves, enums e contagens vêm sempre do catálogo; o que se mantém à mão é
só a folha de cada tabela em `domains.json`:

- **migração que cria tabela** (inclusive `@JoinTable` e `@CollectionTable`) — a tabela entra na
  folha do assunto dela;
- **migração que remove tabela** — a linha sai de `domains.json`;
- **migração que renomeia tabela** — o nome antigo dá lugar ao novo, na mesma folha;
- **coluna criada, removida ou renomeada** — nada a fazer, o catálogo traz;
- se a folha mudou de conteúdo, revise o `desc` dela, que é texto curado e não se atualiza sozinho.

A alteração de `domains.json` vai no **mesmo commit** da migração que cria, remove ou renomeia a
tabela. Assim a próxima geração não para em tabela órfã ou linha velha deixada por outra entrega.

No resultado, vale reparar em:

- **desvios de `domains.json`** (o build para e lista) — corrija todos e rode de novo;
- **tabela sem entidade no código** — a página marca no painel. Pode ser resíduo de migration ou
  mapeamento faltando; vale investigar, não silenciar;
- **tabela mapeada no código e ausente no banco** (o build avisa) — migração faltando ou nome de
  tabela errado no código (`@Table`, `ToTable`, `@@map`, `table_name`…).

## Armadilhas

- **O banco precisa estar de pé.** Com o container parado (ou a `url` inacessível), a extração falha
  com a mensagem do `psql`.
- **A contagem de linhas é `count(*)` de verdade**, não estimativa do catálogo: reflete o banco no
  instante da extração, e é isso que o carimbo da página registra.
- **Com o Mermaid ligado, a pasta dele pode ser compartilhada** com a `mermaid-diagram-generator`. Esta skill
  escreve só o arquivo de `saidas.mermaid`; os demais são do outro pipeline e são sobrescritos por ele.
- **A página não se atualiza sozinha.** É uma foto. O carimbo mostra data, hora e a versão Flyway.
- **Versão Flyway por timestamp** (`V{yyyyMMddHHmmss}__`) e `out-of-order`: a última instalada pode
  não ser a mais nova. O build mostra a **maior versão aplicada**, a data que ela carrega e o **total
  aplicado**. Migração do repositório sem registro no banco para o build (ou só avisa, com
  `--banco-atras`); migração aplicada sem arquivo no repositório (banco de outro branch) só avisa. Na
  mensagem do commit da planta, cite a versão e a descrição da migração.
