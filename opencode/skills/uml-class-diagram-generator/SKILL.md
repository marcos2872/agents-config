---
name: uml-class-diagram-generator
description: Gera e atualiza o diagrama de classes UML das entidades persistentes a partir do código-fonte, com um leitor por linguagem escolhido na configuração (Java, pelas anotações JPA; C#/.NET, pelo Entity Framework Core). Produz uma página HTML navegável por folha (domínio), no mesmo formato da planta do banco. Use quando pedirem o diagrama de classes, o modelo de entidades, atualizar o diagrama depois de mexer numa entidade, ou conferir associações, heranças e multiplicidades do código.
---

# uml-class-diagram-generator

Pipeline **código-fonte → página de classes navegável**. A fonte é o mapeamento das entidades no código (no
leitor Java, as anotações JPA dos `.java`; no leitor C#, o `DbContext`, a API fluente e os atributos do Entity
Framework Core nos `.cs`), não o banco nem os requisitos.

```
código das entidades (leitor da linguagem) ─┐
folhas (domains.json, curado)              ─┼─[build.py · código]──▶ docs/diagramas/diagrama-de-classes.html
planta do banco (opcional, só para links)  ─┘
```

> **Não há linguagem padrão.** `entidades.linguagem` é obrigatória na configuração e escolhe o leitor; sem ela,
> ou com uma linguagem sem leitor, o build para e lista os leitores disponíveis. Leitores disponíveis: `java`
> (anotações JPA) e `csharp` (Entity Framework Core; aceita também `dotnet` e `c#`; VB.NET e F# não são lidos).

> **Par da `er-diagram-generator`.** A planta do banco mostra o schema **físico** (tabelas, colunas, FKs, linhas);
> esta página mostra o modelo de **objetos** que o mapeia (classes, atributos com o tipo do código, associações com
> multiplicidade e navegabilidade, herança, composição, enums). As duas usam o mesmo motor de página (ELK no
> navegador, folhas, painel, vizinhança) e podem partilhar as folhas.

## Mecanismo × projeto

| Onde | O quê | Muda de projeto para projeto? |
|---|---|---|
| a pasta da skill | `build.py`, o modelo da página, os modelos de configuração, este guia | não |
| `.agents/uml-class-diagram-generator/config.json` | linguagem, pastas do código, arquivo das folhas, planta do banco, saídas | sim |
| `domains.json` (onde a configuração apontar) | a folha de cada classe, curada à mão | sim |

> **Pasta da skill.** No OpenCode esta skill fica em `~/.config/opencode/skills/uml-class-diagram-generator/` (o runtime informa o caminho em
> *Base directory for this skill*). Os comandos abaixo já usam esse caminho; se o `opencode/` for sincronizado em
> outro destino, ajuste para `<destino>/skills/uml-class-diagram-generator`.

A raiz do projeto é a pasta que contém o `.agents/skills/` onde a skill está copiada. Como plugin, é a pasta, a partir
da atual e sem passar da raiz do git, que tem `.agents/uml-class-diagram-generator/`; sem ela (antes do `--iniciar`),
a raiz do repositório git. Vale também para um projeto numa subpasta do repositório de outro. `UML_RAIZ` sobrescreve;
`UML_DADOS` aponta outra pasta de dados.

## Princípio de arquitetura

**Um estágio de modelo + um contrato.** O modelo faz UMA coisa: **classificar entidades novas** numa folha. Todo
o resto é código determinístico — leitura do código, multiplicidade, notação, layout, HTML.

O `build.py` **falha** se as folhas não baterem com o código: entidade sem folha, classe citada que não existe
mais, ou classe em duas folhas. Lista todos os desvios de uma vez.

O que ele não reconhece não some calado: associação para um tipo que não é entidade lida, ou `mappedBy` que não
acha o campo do outro lado, sai como **aviso** no fim do build.

## Primeira vez no projeto

```bash
S=~/.config/opencode/skills/uml-class-diagram-generator/scripts                 # copiada no projeto: .agents/skills/uml-class-diagram-generator/scripts
python3 $S/build.py --iniciar            # cria config.json (e domains.json, se não houver planta do banco)
# preencha entidades.linguagem e entidades.pastas em .agents/uml-class-diagram-generator/config.json
bash $S/vendor.sh                        # uma vez por máquina: ELK e fontes da página offline (precisa de rede)
```

O `--iniciar` procura as folhas da planta do banco (`.agents/er-diagram-generator/domains.json`). Se achar,
aponta a configuração para elas: cada entidade cai na folha da tabela que mapeia, e não há segunda curadoria.
Se não achar, cria um `domains.json` próprio a partir do modelo.

Ajuste `config.json`:

| Campo | O que é |
|---|---|
| `nome` | o que aparece no título da página |
| `entidades.linguagem` | **obrigatória, sem padrão**: a linguagem do código, que escolhe o leitor (`java` ou `csharp`) |
| `entidades.pastas` | pastas com o código das entidades, relativas à raiz. Cada leitor pula as pastas de build e de teste da sua linguagem (Java: `build`, `target`, `test`, `node_modules`; C#: `bin`, `obj`, `Migrations`, `test`, `tests`, `node_modules`) |
| `entidades.nomes_no_banco` | opcional: `snake_case` ou `minusculas`, quando o projeto converte os nomes do código ao gravar no banco (EF Core com conversão para snake_case, Hibernate com a estratégia de nomes do Spring). Aplica-se à tabela, à coluna e à coluna de junção mostradas, para a tabela bater com a planta do banco e com as folhas em `tables`. `snake_case` põe `_` antes da maiúscula que segue minúscula ou que abre palavra (`Et0Method` → `et0_method`, `FlowM3PerH` → `flow_m3_per_h`, `Per100M` → `per100m`). Vazio = como no código |
| `dominios.arquivo` | o `domains.json` das folhas (o da planta do banco ou um próprio) |
| `planta_do_banco` | opcional: `html` e `url_do_artefato` da planta, para o painel abrir a tabela da classe |
| `saidas` | `html` e `url_do_artefato`, relativos à raiz |

### As folhas

Mesmo formato da planta do banco: cada folha tem `id`, `label`, `hue`/`chroma` (matiz OKLCH; chroma 0 = cinza),
`desc` e as listas que a preenchem:

- `tables` — a entidade entra pela tabela que mapeia (no Java: `@Table`; sem ela, a tabela da raiz em
  `SINGLE_TABLE`, ou o nome da classe em minúsculas). Linhas de tabela sem entidade (junção, legado) são ignoradas aqui.
- `classes` — a classe entra pelo nome simples (ou `pacote.Nome`, quando o nome se repete). Vale antes de `tables`.

Toda entidade precisa de folha própria, pela tabela ou pelo nome — não herda a folha de quem se liga a ela.
Não precisam de folha: `@MappedSuperclass`, `@Embeddable` e superclasses comuns vão para a folha da primeira
subclasse ou de quem as usa; cada enum vai para a folha da primeira classe que o usa, na ordem das folhas. Folha
sem nenhuma classe não aparece na página.

## Como executar

```bash
S=~/.config/opencode/skills/uml-class-diagram-generator/scripts                 # copiada no projeto: .agents/skills/uml-class-diagram-generator/scripts
python3 $S/build.py                      # lê o código, valida as folhas, escreve o HTML
python3 $S/build.py --online             # HTML que busca ELK e fontes na CDN (arquivo bem menor)
python3 $S/build.py --keep-json          # guarda também os dados extraídos (.json ao lado da página)
```

O build imprime os totais (classes por tipo, associações por anotação do dono, heranças, usos de enum), o commit
de onde leu e os avisos. Não compila nada, não sobe a aplicação e não consulta banco: roda em segundos.

## Como o código vira UML

Um leitor por linguagem, registrado em `LEITORES` no `build.py`. Cada um diz as extensões dos arquivos, as pastas a
pular, o rótulo da página e, opcionalmente, os `termos` com que a página nomeia relação, cascata e herança (sem
eles, os do JPA). E entrega duas funções:

- **`ler(caminho)`** — lê um arquivo e devolve a lista de tipos dele, no formato do leitor Java (anotações com os
  nomes JPA: `Entity`, `Table`, `ManyToOne`, `mappedBy`…). Um campo pode trazer `req` (obrigatório ou não, quando a
  linguagem decide de outro jeito) e `_tags` (marcas extras no painel);
- **`completa(tipos)`**, opcional — recebe os tipos de todos os arquivos e os devolve completos. Serve à linguagem
  cujo mapeamento se espalha por vários arquivos (no EF Core, o `DbContext` e as configurações dizem o que é
  entidade e como as navegações se pareiam).

Leitor grande vai em módulo próprio ao lado do `build.py` (`modulo` no registro), carregado só quando escolhido.
Para outra linguagem, escreva o leitor nesse contrato e registre-o; o resto do script não muda.

### Leitor Java (JPA)

O leitor Java é próprio (sem dependência externa): tira comentários, acha as declarações de tipo (inclusive aninhadas)
e lê anotações, modificadores, tipo e nome de cada campo. Tipos são resolvidos como o compilador faria: tipo
aninhado, `import`, mesmo pacote, `import pacote.*` e, por último, nome único no código lido.

**Classes.** `@Entity` (abstrata se `abstract`), `@MappedSuperclass`, `@Embeddable`, superclasses comuns de
entidades e os enums usados por elas. Campos `static` ficam de fora.

**Atributos** são os campos que não viram linha: tipos simples, enums e `@ElementCollection` (marcada como
coleção). `?` no tipo = aceita nulo. Um campo é **obrigatório** quando é primitivo, `@Id`/`@EmbeddedId`,
`@NotNull`/`@NonNull`/`@NotBlank`/`@NotEmpty`, `@Column(nullable = false)`, `@JoinColumn(nullable = false)`,
`@ManyToOne`/`@OneToOne(optional = false)` ou `@MapsId`. `@Transient` aparece em itálico.

**Associações** vêm de `@ManyToOne`, `@OneToMany`, `@OneToOne` e `@ManyToMany`:

- os dois lados de uma bidirecional (`mappedBy`) viram **uma** linha, sem setas; mão única ganha a seta do lado
  navegável;
- multiplicidade no alvo: `*` para coleção; `1` se o campo é obrigatório (regra acima); senão `0..1`;
- multiplicidade do lado de quem declara, quando não há campo de volta: `*` para `@ManyToOne`/`@ManyToMany`,
  `1` para o todo de uma composição, `0..1` nos demais;
- **composição** (losango cheio no todo) quando o lado `@OneToMany`/`@OneToOne` tem `orphanRemoval = true` ou
  `cascade` com `ALL`/`REMOVE`, e sempre para `@Embedded` e para `@ElementCollection` de `@Embeddable`. `@ManyToMany` nunca é composição (a parte é
  partilhada); o cascade aparece no painel;
- o nome do papel aparece na ponta só quando diz algo além do nome da classe (`parentPart 0..1`, não
  `part 0..1`).

**Herança**: `extends` de uma classe lida vira o triângulo na superclasse; a estratégia (`@Inheritance`),
o `@DiscriminatorValue` e o `@IdClass` aparecem no painel.

**Uso de enum**: linha tracejada da classe para o enum, com o nome dos campos.

### Leitor C# (Entity Framework Core) — `scripts/leitor_csharp.py`

Também próprio, sem dependência externa nem compilação. Tira comentários (guardando a documentação `///`, de que usa
o `<summary>`), diretivas e literais (`@"…"`, `$"…"`, `"""…"""`), e lê namespaces (de bloco e de arquivo), `using`
(inclusive apelido), tipos aninhados, records com construtor primário, atributos e propriedades. Resolve tipos
como o compilador: aninhado, apelido, mesmo namespace, namespaces pais, `using` e, por último, nome único.

Depois, com o projeto inteiro, monta o modelo como o EF Core:

- **Entidades**: os `DbSet<T>` de qualquer classe, os `modelBuilder.Entity<T>()`, os `EntityTypeBuilder<T>` (o
  `Configure` de `IEntityTypeConfiguration<T>` e extensões), os `HasValue<T>()` do discriminador e
  `[EntityTypeConfiguration]`; e, por convenção, toda classe alcançada por navegação a partir delas.
  `[NotMapped]` na classe e `modelBuilder.Ignore<T>()` tiram; `[Owned]`, `[ComplexType]`, `OwnsOne`, `OwnsMany` e
  `ComplexProperty` fazem do tipo um embutível.
- **Propriedades**: só as públicas, não estáticas, com `set` ou `init` (o que o EF mapeia por convenção). Só `get`
  e corpo de expressão (`=>`) ficam de fora. `[NotMapped]` e `Ignore()` aparecem como transientes.
- **Herança**: base que não é entidade (ex.: uma `EntidadeBase` com `Id` e datas) vira **superclasse mapeada**, porque o EF grava as
  propriedades dela na tabela da derivada. Base que é entidade forma hierarquia, TPH por padrão;
  `UseTptMappingStrategy`/`UseTpcMappingStrategy` mudam. O painel diz TPH/TPT/TPC.
- **Tabela**: `[Table]` ou `ToTable()`; sem eles, o nome do `DbSet` (ou da classe), como o EF. Na TPH, a da raiz.
- **Chave**: `HasKey`, `[Key]` ou a convenção `Id` / `<Classe>Id` (na entidade ou numa base).
- **Obrigatório**: chave, `[Required]` ou `IsRequired()`, tipo de valor sem `?` e, com `<Nullable>enable</Nullable>`
  no `.csproj` ou no `Directory.Build.props` mais próximo (ou `#nullable enable` no arquivo), tipo de referência
  sem `?`. `IsRequired(false)` vence.
- **Relações**: `HasOne`/`HasMany` + `WithOne`/`WithMany`, `HasForeignKey` (`<T>` no um-para-um), `OnDelete`,
  `UsingEntity`; sem API fluente, `[InverseProperty]` e, por convenção, a única navegação de cada lado entre duas
  classes. Referência + coleção = muitos-para-um; coleção + coleção = muitos-para-muitos; referência + referência =
  um-para-um, dependente quem tem a chave estrangeira. Navegação sem par fica de mão única.
- **Chave estrangeira**: `HasForeignKey`, `[ForeignKey]` ou a convenção `<Navegação>Id` / `<Principal>Id`. A
  propriedade fica nos atributos, marcada *chave estrangeira de X*; sem ela (chave de sombra), a coluna aparece como
  `(padrão)`. A relação é obrigatória quando a chave estrangeira não aceita nulo.
- **Composição**: o EF apaga os dependentes em cascata com `OnDelete(Cascade)` ou, sem `OnDelete`, quando a relação
  é obrigatória. Com navegação no principal (coleção ou referência), isso desenha o losango cheio; sem ela, fica
  associação simples. `OwnsOne`/`OwnsMany` são sempre composição.
- **Marcas**: `HasMaxLength`/`[MaxLength]`/`[StringLength]` (tamanho), `HasPrecision`/`[Precision]`,
  `HasColumnName`/`[Column]`, `HasColumnType`/`[Column(TypeName)]` (tipo da coluna), índice único de uma
  propriedade, valor gerado (`ValueGenerated…`, `HasDefaultValueSql`, identidade, `[DatabaseGenerated]`),
  `IsRowVersion`/`[Timestamp]`/`[ConcurrencyCheck]` (versão) e `HasConversion<string>()` num enum (*enum STRING*).

Não lê: o que só existe em tempo de execução (configuração montada em laço sobre `Model.GetEntityTypes()`,
convenções customizadas, `ApplyConfigurationsFromAssembly` de outro assembly fora das pastas) — por isso a
conversão de nomes do projeto entra pela configuração (`nomes_no_banco`), não pelo código; nem `Entity("Nome")` por
texto. As migrações (`Migrations/`) são puladas: o snapshot repete o modelo em texto.

### Layout

No layout, o lado "um" (ou o todo, ou a superclasse) fica à esquerda — a mesma leitura da planta do banco, em que
a tabela referenciada fica à esquerda.

## Requisitos × classes (opcional)

Compara as entidades descritas nos documentos de requisitos com as classes, pela tabela que cada uma mapeia. Liga com a seção `logico` na configuração;
sem ela, nada muda.

```json
"logico": { "requisitos": ["docs/requisitos/modulo-*.md"], "mapeamento": "", "ignorar": [] }
```

- **Entidades:** cada título `### E – Nome` dos documentos é uma entidade; a tabela `| Campo | Tipo | Obrigatório |
  Descrição |` logo abaixo dá os campos (entidade só em texto corrido entra sem campos). A leitura é refeita a cada build,
  pelo `scripts/logico.py` (cópia idêntica na planta do banco e no diagrama de classes).
  Entidade com a tag `#hipótese` no título (escrita a partir do documento de contexto, antes do comitê) sai marcada
  como hipótese no `--divergencias` e na lista de planejadas.
- **Mapeamento, curado à mão:** a seção `entidades` do `domains.json` indicado em `logico.mapeamento` (vazio: o da planta do banco, se houver, senão o das folhas):

  ```json
  "entidades": {
    "Fazenda": { "tabelas": ["farms"] },
    "Plantio e Cultura no Plantio": { "tabelas": ["plantings", "planting_crops"] },
    "Parceiro": { "planejado": true, "motivo": "ainda não implementado" }
  }
  ```

  A chave é o nome do título, sem as tags. Entidade guardada de outro jeito (JSON numa coluna, por exemplo) aponta a
  tabela onde vive, com um `motivo`.
- **`--divergencias`** lista, sem gravar a página: o **planejado** (nos requisitos, ainda sem classe), o que está
  **fora dos requisitos** (classe que nenhuma entidade cobre), o mapeamento que aponta classe que não
  existe, as entidades **sem mapeamento** e as do mapeamento que sumiram dos requisitos. O build normal só imprime o resumo.
- **Na página:** classe fora dos requisitos ganha uma faixa âmbar à esquerda; o painel da classe mostra a entidade dos requisitos que ela implementa, com o primeiro parágrafo em prosa da seção (o que ela é para o negócio; seção que abre com a tabela de campos, um esboço em código ou uma lista não tem), o arquivo, a linha, o motivo e os campos do documento;
  a visão geral resume ligadas, planejadas, sem mapeamento e fora, e lista as planejadas.
- **Campo a campo (opcional):** liga com o `campos.json`, na mesma pasta do arquivo do mapeamento. Os nomes do
  requisito estão no idioma do negócio e os do código no do código, e nenhuma regra fixa traduz `horas_dia` em
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
     do requisito (ou o texto da seção), as colunas que as classes declaram (atributos, herdados e colunas de junção, pela convenção `nomes_no_banco`) e os pares com problema.
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
  as entidades ainda sem tradução. O painel da classe mostra cada campo com a coluna e a situação, e as colunas fora.

## O que a página tem

- **Visão geral** — as folhas e quantas associações e heranças ligam uma à outra (grafo sem direção).
- **Uma folha por domínio** — as classes e enums da folha inteiros; classes de outras folhas entram tracejadas,
  só pelo nome. Botões: *Só nomes* / *Com atributos* e *Sem enums* / *Com enums*.
- **Painel da classe** — tipo, pacote, arquivo, tabela (com link para a planta), superclasse, estratégia de
  herança, subclasses, documentação da classe (javadoc), atributos com tipo, anotações e documentação, atributos
  herdados, associações (campo, multiplicidade, anotação, mão única ou bidirecional, composição, cascade, fetch,
  coluna ou tabela de junção) e enums usados. No enum: valores e quem o usa.
- **Vizinhança** (duplo clique) — a classe com tudo que se liga a ela.
- **Tema** — botão no cabeçalho que alterna entre claro e escuro; sem escolha, segue o sistema. A escolha fica no
  navegador com a mesma chave dos diagramas de atividades (`ativ-tema`), então vale para todos os diagramas.

## Publicar como artefato (opcional)

A página é um HTML único e funciona como Artifact. Na **primeira** publicação, guarde a URL no arquivo de
`saidas.url_do_artefato`; o build a mostra no painel. Para **atualizar**, publique com essa mesma URL. O link
para a planta usa a URL publicada da planta (`planta_do_banco.url_do_artefato`) quando ela existe; senão, o
caminho relativo, que só funciona com as duas páginas lado a lado no disco.

## Regeneração depois de mexer numa entidade

Rode o build. Atributos, associações, heranças e enums vêm sempre do código; o que se mantém à mão é só a folha:

- **entidade nova** — entra na folha pela tabela (se as folhas são as da planta, a migração que cria a tabela já
  a classifica) ou pelo nome em `classes`;
- **entidade removida ou renomeada** — tire ou troque a linha em `classes` (em `tables`, quem cuida é a planta);
- **campo, anotação ou enum** — nada a fazer.

## Armadilhas

- **A página é uma foto do código**, não do banco: o carimbo mostra o commit lido, com `*` se havia alteração não
  commitada nas pastas lidas.
- **Herança `SINGLE_TABLE` implícita.** Entidade que estende outra sem `@Inheritance` na raiz usa a tabela da
  raiz: é por ela que cai na folha.
- **Linguagem sem leitor** para a stack do projeto: o build para logo no início. Não troque a linguagem para
  `java` só para rodar; escreva o leitor (ver "Como o código vira UML").
- **Tipo de fora das pastas lidas** (de uma biblioteca, ou de outro módulo não configurado) não resolve: se for
  alvo de associação, sai aviso e o campo entra como atributo. Acrescente a pasta em `entidades.pastas`.
- **Mapeamento em XML** (`orm.xml`, no Java) não é lido: só anotações.
- **C#: conversão de nomes feita em código** (laço em `OnModelCreating` que passa tudo para snake_case) não é lida:
  declare `entidades.nomes_no_banco`, senão a tabela mostrada sai como no código (`ItensDoPedido`) e não bate com a
  planta do banco nem com `tables` nas folhas.
- **C#: projeto sem git próprio** (pasta dentro do repositório de outro): a raiz vem da instalação da skill, mas o
  carimbo mostra o commit do repositório de fora, com `*` enquanto a pasta não estiver commitada nele.
- **Nome de classe repetido** em pacotes diferentes vira `pacote.Nome` na página e nas folhas.
