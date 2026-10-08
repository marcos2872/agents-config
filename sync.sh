#!/usr/bin/env bash
# sync.sh — sincroniza as configurações de opencode/ com o config local do OpenCode.
#
# Uso:
#   ./sync.sh                       # destino: ${XDG_CONFIG_HOME:-$HOME/.config}/opencode
#   ./sync.sh /caminho/de/destino   # destino customizado (ex.: .opencode de um projeto)
#
# O que já existir no destino é substituído e movido para <destino>/backup-<data>/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$ROOT/opencode"
DST="${1:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
BACKUP="$DST/backup-$(date +%Y%m%d-%H%M%S)"

if [ ! -d "$SRC" ]; then
  echo "erro: pasta opencode/ não encontrada em $ROOT" >&2
  exit 1
fi

mkdir -p "$DST"

backup() {
  local src="$1" rel="${1#"$DST"/}" dst
  [ -e "$src" ] || return 0
  dst="$BACKUP/$rel"
  mkdir -p "$(dirname "$dst")"
  rm -rf "$dst"
  cp -a "$src" "$dst"
}

# Instalações antigas por symlink são removidas — a partir daqui sincronizamos por cópia.
for entry in opencode.json opencode.jsonc cli.json agents commands plugins skills; do
  if [ -L "$DST/$entry" ]; then
    rm -f "$DST/$entry"
  fi
done

# Um opencode.jsonc antigo conflitaria com o opencode.json do repo: backup e remove.
if [ -f "$DST/opencode.jsonc" ]; then
  backup "$DST/opencode.jsonc"
  rm -f "$DST/opencode.jsonc"
  echo "aviso: opencode.jsonc antigo movido para $BACKUP/"
fi

for f in opencode.json cli.json; do
  backup "$DST/$f"
  cp -a "$SRC/$f" "$DST/$f"
  echo "→ $f"
done

for d in agents commands plugins; do
  backup "$DST/$d"
  rm -rf "$DST/$d"
  mkdir -p "$DST/$d"
  cp -a "$SRC/$d/." "$DST/$d/"
  echo "→ $d/"
done

mkdir -p "$DST/skills"
for skill in "$SRC/skills"/*/; do
  name="$(basename "$skill")"
  backup "$DST/skills/$name"
  rm -rf "$DST/skills/$name"
  cp -a "$skill" "$DST/skills/$name"
  echo "→ skills/$name/"
done

echo
echo "Sync concluído:"
echo "  origem:  $SRC"
echo "  destino: $DST"
if [ -d "$BACKUP" ]; then
  echo "  backup:  $BACKUP"
fi
echo
echo "Se plugins/config mudaram, reinicie o OpenCode: opencode service restart"
