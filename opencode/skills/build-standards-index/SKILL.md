---
name: build-standards-index
description: (Re)gera o índice compacto de standards (docs/standards/_index-standards.md) a partir dos arquivos de standard (style/, arch/, practices/) — código STD-<CAT>-<NNN>, status, aplica-se-a e título curto. Roda OFFLINE sempre que os standards mudarem, para que skills de review/documentação injetem só o relevante sem ler tudo. Use quando: standards alterados, regenerar índice de standards, atualizar _index-standards.md, preparar injeção de padrões antes de implementar/revisar.
---

# Skill: build-standards-index

> **Pasta da skill.** No OpenCode esta skill fica em `~/.config/opencode/skills/build-standards-index/` (o runtime informa o caminho em
> *Base directory for this skill*). Os comandos abaixo já usam esse caminho; se o `opencode/` for sincronizado em
> outro destino, ajuste para `<destino>/skills/build-standards-index`.

Produz `docs/standards/_index-standards.md`: uma visão **compacta** dos padrões de codificação
(`código → categoria → aplica-se-a → resumo`) que substitui a leitura de todos os arquivos de
standard nas skills de baixo contexto (ex.: `doc`, `technical-documentation-generator`)
e no code review. É o "inject-standards" nativo do método.

> **Por quê**: standards crescem (style por stack + practices + arch). Ler todos em cada review
> é caro e ruidoso. O índice permite a um agente carregar **só** os standards cujo `aplica-se-a`
> casa com a área tocada.

## Quando rodar

- Após adicionar/alterar/descontinuar qualquer `docs/standards/**/*.md`.
- No bootstrap (`init-project`), depois de remover os `style/*` de stacks não usadas.
- Antes de uma bateria de reviews, para garantir que o índice reflete os standards atuais.

NÃO rode dentro do fluxo quente de review — é offline (pode ler os standards inteiros).

## Processo

### 1. Coletar os arquivos-fonte

Standards são todos os `.md` sob `docs/standards/` **exceto** `README.md`, `_template-standard.md`
e o próprio `_index-standards.md`:

```bash
cd docs/standards
find . -type f -name '*.md' ! -name '_*' ! -name 'README.md' | sort
```

### 2. Extrair metadados de cada standard

Do frontmatter YAML: `código`, `status`, `aplica-se-a`, e do H1 o título curto.

```bash
for f in $(find . -type f -name '*.md' ! -name '_*' ! -name 'README.md' | sort); do
  echo "== $f =="
  sed -n '1,12p' "$f" | grep -iE "código:|status:|aplica-se-a:"
  grep -m1 -E '^# STD-' "$f"
done
```

### 3. Resumir cada standard

Uma frase por standard (a "Regra" condensada). Preserve o código exatamente. Agrupe por
categoria (`STYLE`, `ARCH`, `TEST`, `GIT`, `LOG`, `API`, `SEC`).

### 4. Escrever o índice

Gerar/sobrescrever `docs/standards/_index-standards.md` com:

1. Frontmatter (`tipo: indice-standards`, `gerado-por: build-standards-index`, `fonte`,
   `fonte-hash`, `fonte-hash-cmd`, `proposito`, `atualizado`).
2. Bloco de uso + a convenção de código (aponta para `README.md`).
3. Uma tabela por categoria: `Código | Título | Status | Aplica-se a | Resumo`.

### 4.1 Gravar o hash de sincronização (OBRIGATÓRIO)

O campo `fonte-hash` permite detectar índice defasado. Compute sobre os arquivos-fonte
(ordem alfabética estável → determinístico) e grave `fonte-hash: sha256:<hash>`:

```bash
echo "sha256:$(find docs/standards -type f -name '*.md' ! -name '_*' ! -name 'README.md' \
  | sort | xargs cat | shasum -a 256 | cut -d' ' -f1)"
```

Use **hash de conteúdo** (não mtime — git reescreve timestamps). Grave o valor recém-computado
depois de escrever o corpo do índice.

### 5. Validar

- Cada standard aparece uma vez, com código e status corretos.
- `bash ~/.config/opencode/skills/build-standards-index/scripts/check_standards_index_sync.sh`, rodado na raiz do projeto, imprime `OK` e sai 0. Se `STALE`, recompute (4.1).

## Notas

- O índice é **derivado** — nunca é fonte da verdade. Para a regra completa de um standard,
  abra o arquivo correspondente.
- Standards `descontinuado` permanecem no índice marcados como tal (histórico), com o substituto.
