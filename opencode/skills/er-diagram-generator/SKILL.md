---
name: er-diagram-generator
description: Gera e atualiza o diagrama E/R físico do banco PostgreSQL do projeto a partir do catálogo (schema real, não os requisitos). Produz uma página HTML navegável por domínio e, se configurado, um Mermaid por domínio. Use quando pedirem o E/R do banco, a planta do banco, atualizar o diagrama depois de uma migration, ou conferir o que existe hoje no banco.
---

# er-diagram-generator

Pipeline **catálogo do PostgreSQL → página E/R navegável**. A fonte é o **banco vivo**, não
`docs/requisitos/**`.

```
pg_catalog (banco do projeto) ─────────────┐
entidades JPA (@Entity, opcional) ─────────┼─[build.py · código]──▶ docs/diagramas/planta-do-banco.html
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
| a pasta da skill | `build.py`, a consulta ao catálogo (`schema.sql`), o modelo da página, os modelos de configuração, este guia | não |
| `.agents/er-diagram-generator/config.json` | acesso ao banco, pasta das migrações, pastas das entidades, saídas | sim |
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
| `entidades` | `pastas` com os `.java` das entidades JPA; lista vazia desliga o mapeamento tabela → entidade |
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

## O que a página tem

- **Visão geral** — os domínios e quantas FKs cruzam de um para outro.
- **Uma folha por domínio** — tabelas do domínio inteiras; tabelas de fora entram tracejadas, só
  pelo nome, na ponta da relação.
- **Notação pé-de-galinha derivada do schema**: FK `NOT NULL` é traço duplo, FK anulável ganha o
  círculo, 1:1 quando a FK é a PK ou tem UNIQUE, tracejado quando a FK **é** a PK (herança JOINED).
- **Painel da tabela** — colunas com tipo e default, valores de enum lidos dos CHECK, unicidade,
  o que referencia e quem a referencia, com a regra ON DELETE, e a entidade JPA correspondente.
- **Vizinhança** (duplo clique) — a tabela com tudo que se liga a ela por FK.

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
- **tabela sem entidade JPA** — a página marca no painel. Pode ser resíduo de migration ou
  mapeamento faltando; vale investigar, não silenciar;
- **tabela mapeada no código e ausente no banco** (o build avisa) — migração faltando ou `@Table`
  com o nome errado.

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
