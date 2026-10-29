#!/bin/bash
# check_standards_index_sync.sh — verifica se docs/standards/_index-standards.md está
# sincronizado com os arquivos de standard (fonte da verdade).
#
# Compara o campo `fonte-hash:` gravado no índice com o hash recomputado sobre os
# standards atuais. Usa hash de CONTEÚDO (não mtime), robusto a git clone/checkout.
#
# Fonte = docs/standards/**/*.md EXCETO README.md, _template-standard.md e _index-standards.md.
#
# Uso:    bash check_standards_index_sync.sh [<dir-standards>]
#         (default: docs/standards relativo ao cwd)
# Saída:  "OK" e sai 0            se sincronizado
#         "STALE ..." e sai 1     se desatualizado / índice ausente
#         "ERROR ..." e sai 2     se faltar índice/standards
#
# Determinístico (não usa o modelo) — pode rodar no início de qualquer skill.
set -euo pipefail

STD_DIR="${1:-docs/standards}"
INDEX="$STD_DIR/_index-standards.md"

if [[ ! -f "$INDEX" ]]; then
  echo "STALE índice ausente ($INDEX) — gere com build-standards-index"
  exit 1
fi

# há standards-fonte?
if ! find "$STD_DIR" -type f -name '*.md' ! -name '_*' ! -name 'README.md' | grep -q .; then
  echo "ERROR nenhum standard-fonte em $STD_DIR"
  exit 2
fi

stored="$(grep -E '^fonte-hash:' "$INDEX" | head -1 | sed -E 's/^fonte-hash:[[:space:]]*//; s/^sha256://')"
if [[ -z "$stored" ]]; then
  echo "STALE índice sem campo fonte-hash — regenere com build-standards-index"
  exit 1
fi

# ordem alfabética estável do sort → hash determinístico
current="$(find "$STD_DIR" -type f -name '*.md' ! -name '_*' ! -name 'README.md' \
  | sort | xargs cat | shasum -a 256 | cut -d' ' -f1)"

if [[ "$stored" == "$current" ]]; then
  echo "OK índice sincronizado ($current)"
  exit 0
else
  echo "STALE standards mudaram desde a geração do índice"
  echo "  gravado:    $stored"
  echo "  atual:      $current"
  echo "  ação: rode a skill build-standards-index para regenerar $INDEX"
  exit 1
fi
