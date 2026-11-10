#!/usr/bin/env bash
# sync.sh — sincroniza as configurações de opencode/ com o config local do OpenCode.
#
# Uso:
#   ./sync.sh                       # destino: ${XDG_CONFIG_HOME:-$HOME/.config}/opencode
#   ./sync.sh /caminho/de/destino   # destino customizado (ex.: .opencode de um projeto)
#
# O que já existir no destino é substituído e movido para <destino>/backup-<data>/.
#
# Depois da cópia, garante o ai-memory (backend de memória do OpenCode): instala
# o binário oficial se faltar, sobe o serviço local do usuário em 127.0.0.1:49375
# (a 49374 é a porta padrão do serviço do OpenCode V2) e aplica a integração do
# OpenCode V2. O passo é global e idempotente: roda mesmo com destino customizado.
#
# Não rode este script com sudo: o sudo é usado só internamente para corrigir o
# dono de ~/.config/systemd. Como root, o destino e o ai-memory iriam para /root.
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "erro: rode ./sync.sh como seu usuário, sem sudo." >&2
  echo "      O script chama sudo apenas para corrigir ~/.config/systemd." >&2
  echo "      Rodar o script inteiro como root instala tudo em /root." >&2
  exit 1
fi

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
for entry in opencode.json opencode.jsonc cli.json AGENTS.md agents commands plugins skills; do
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

for f in opencode.json cli.json AGENTS.md; do
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

# ─── ai-memory ───────────────────────────────────────────────────────────────
# Porta local: 49375. O ai-memory usa 49374 por padrão, a mesma do serviço
# compartilhado do OpenCode V2; manter as duas separadas evita o conflito.
AI_MEMORY_PORT="${AI_MEMORY_PORT:-49375}"
AI_MEMORY_DATA_DIR="${AI_MEMORY_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/ai-memory}"
AI_MEMORY_CONFIG="$AI_MEMORY_DATA_DIR/config.toml"
AI_MEMORY_BIN=""

ai_memory_bin() {
  if [ -n "$AI_MEMORY_BIN" ] && [ -x "$AI_MEMORY_BIN" ]; then
    printf '%s\n' "$AI_MEMORY_BIN"
  elif [ -x "$HOME/.local/bin/ai-memory" ]; then
    printf '%s\n' "$HOME/.local/bin/ai-memory"
  elif command -v ai-memory >/dev/null 2>&1; then
    command -v ai-memory
  fi
}

install_ai_memory() {
  if [ -n "$(ai_memory_bin)" ]; then
    return 0
  fi

  echo "→ ai-memory: baixando o release oficial (binário não encontrado)"
  local url="https://github.com/akitaonrails/ai-memory/releases/latest/download/install.sh"
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/ai-memory-install.XXXXXX")"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$tmp"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmp" "$url"
  else
    rm -f "$tmp"
    echo "erro: ai-memory ausente e sem curl/wget para instalar" >&2
    return 1
  fi

  if ! sh "$tmp"; then
    rm -f "$tmp"
    echo "erro: o instalador do ai-memory falhou" >&2
    return 1
  fi
  rm -f "$tmp"

  AI_MEMORY_BIN="$(ai_memory_bin)"
  if [ -z "$AI_MEMORY_BIN" ]; then
    echo "erro: ai-memory não ficou disponível após a instalação" >&2
    return 1
  fi
}

configure_ai_memory() {
  # O `setup` grava a unit do systemd em ~/.config/systemd/user. Se esse
  # diretório tiver outro dono (ex.: uma instalação antiga rodou como root),
  # o setup falha sem dizer o que fazer; corrigimos o dono dos diretórios
  # com sudo antes de chamar o setup.
  if [ "$(uname -s)" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
    local systemd_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd"
    local unit_dir="$systemd_dir/user"
    local blocked=""
    if [ -d "$systemd_dir" ] && [ ! -w "$systemd_dir" ]; then
      blocked="$systemd_dir"
    elif [ -d "$unit_dir" ] && [ ! -w "$unit_dir" ]; then
      blocked="$unit_dir"
    fi
    if [ -n "$blocked" ]; then
      local owner owner_ids
      owner="$(stat -c '%U' "$blocked" 2>/dev/null || echo '?')"
      owner_ids="$(id -u):$(id -g)"
      echo "→ ai-memory: $blocked não é gravável (dono: $owner); corrigindo com sudo"
      if ! command -v sudo >/dev/null 2>&1; then
        echo "erro: sudo não encontrado para corrigir o dono de $systemd_dir." >&2
        echo "      Rode como root: chown -R $(id -un):$(id -gn) $systemd_dir" >&2
        return 1
      fi
      # -h: muda o dono do symlink, nunca do alvo (ex.: podman.socket em /usr).
      if ! sudo chown -R -h "$owner_ids" "$systemd_dir"; then
        echo "erro: não foi possível corrigir o dono de $systemd_dir." >&2
        echo "      Rode manualmente: sudo chown -R -h $(id -un):$(id -gn) $systemd_dir" >&2
        return 1
      fi
      if [ ! -w "$systemd_dir" ] || { [ -d "$unit_dir" ] && [ ! -w "$unit_dir" ]; }; then
        echo "erro: $systemd_dir continua sem permissão de escrita após o chown." >&2
        return 1
      fi
    fi
  fi

  install_ai_memory || return 1

  local bin created=0 code
  bin="$(ai_memory_bin)"
  [ -n "$bin" ] || return 1

  if [ ! -f "$AI_MEMORY_CONFIG" ]; then
    echo "→ ai-memory: inicializando $AI_MEMORY_DATA_DIR"
    if ! "$bin" init >/dev/null 2>&1; then
      echo "erro: ai-memory init falhou" >&2
      return 1
    fi
    created=1
  fi

  # Instalação nova: fixa a porta 49375 e o idioma pt-BR no config gerado.
  if [ "$created" -eq 1 ]; then
    if grep -qE '^[[:space:]]*bind[[:space:]]*=' "$AI_MEMORY_CONFIG"; then
      sed -i.bak -E "s|^[[:space:]]*bind[[:space:]]*=.*|bind = \"127.0.0.1:${AI_MEMORY_PORT}\"|" "$AI_MEMORY_CONFIG"
    else
      printf '\nbind = "127.0.0.1:%s"\n' "$AI_MEMORY_PORT" >> "$AI_MEMORY_CONFIG"
    fi
    if grep -qE '^[[:space:]]*language[[:space:]]*=' "$AI_MEMORY_CONFIG"; then
      sed -i.bak -E 's|^[[:space:]]*language[[:space:]]*=.*|language = "pt-BR"|' "$AI_MEMORY_CONFIG"
    else
      printf 'language = "pt-BR"\n' >> "$AI_MEMORY_CONFIG"
    fi
    rm -f "$AI_MEMORY_CONFIG.bak"
  elif ! grep -qE "^[[:space:]]*bind[[:space:]]*=[[:space:]]*\"[^\"]*:${AI_MEMORY_PORT}\"" "$AI_MEMORY_CONFIG"; then
    echo "aviso: $AI_MEMORY_CONFIG não usa a porta ${AI_MEMORY_PORT}; o MCP do repo espera 127.0.0.1:${AI_MEMORY_PORT}" >&2
  fi

  echo "→ ai-memory: aplicando serviço e integração do OpenCode V2"
  if ! "$bin" setup --yes --agent opencode2; then
    echo "erro: ai-memory setup falhou (veja as mensagens acima)" >&2
    return 1
  fi

  if command -v curl >/dev/null 2>&1; then
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${AI_MEMORY_PORT}/healthz" || true)"
    if [ "$code" != "200" ]; then
      echo "erro: ai-memory não respondeu em http://127.0.0.1:${AI_MEMORY_PORT}/healthz (HTTP $code)" >&2
      return 1
    fi
  fi
  echo "→ ai-memory: ok (http://127.0.0.1:${AI_MEMORY_PORT})"
}

configure_ai_memory

echo
echo "Sync concluído:"
echo "  origem:  $SRC"
echo "  destino: $DST"
if [ -d "$BACKUP" ]; then
  echo "  backup:  $BACKUP"
fi
echo "  memória: http://127.0.0.1:${AI_MEMORY_PORT}"
echo
echo "Se plugins/config mudaram, reinicie o OpenCode: opencode service restart"
