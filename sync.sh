#!/usr/bin/env bash
# sync.sh — instala este repo como pacote do Pi e garante as dependências globais.
#
# Uso:
#   ./sync.sh                    # agent dir: ${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}
#   ./sync.sh /caminho/do/agente # agent dir customizado (--agent-dir)
#
# O pacote é carregado no lugar, sem cópia: o Pi passa a ler `pi/skills/`,
# `pi/prompts/` e `pi/extensions/` direto deste checkout. Depois de um
# `git pull`, basta `/reload` numa sessão aberta (ou abrir o Pi de novo);
# rode o sync de novo só quando este script ou o ai-memory mudarem.
#
# O script é idempotente: `pi install` repete sem duplicar, `pi mcp add`
# substitui a entrada do context7 e `ai-memory setup` não muda nada se já está
# aplicado.
#
# Não rode com sudo: o ai-memory instala serviço do usuário e o sudo é usado só
# internamente para corrigir o dono de ~/.config/systemd. Como root, tudo iria
# para /root.
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "erro: rode ./sync.sh como seu usuário, sem sudo." >&2
  echo "      O script chama sudo apenas para corrigir ~/.config/systemd." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${1:-${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}}"

if [ ! -f "$ROOT/package.json" ] || [ ! -d "$ROOT/pi/skills" ]; then
  echo "erro: pacote incompleto em $ROOT (falta package.json ou pi/skills)" >&2
  exit 1
fi

if ! command -v pi >/dev/null 2>&1; then
  echo "erro: comando 'pi' não encontrado no PATH" >&2
  exit 1
fi

pi_cmd=(pi --agent-dir "$AGENT_DIR")

# ─── Pacote, ponytail e MCP ──────────────────────────────────────────────────
echo "→ pacote: instalando $ROOT"
"${pi_cmd[@]}" install "$ROOT"

echo "→ ponytail: garantindo @dietrichgebert/ponytail"
"${pi_cmd[@]}" install npm:@dietrichgebert/ponytail

echo "→ question: garantindo @juicesharp/rpiv-ask-user-question"
"${pi_cmd[@]}" install npm:@juicesharp/rpiv-ask-user-question

# O diálogo recolhe com Ctrl+] (shift no teclado ABNT); alt+o é o que usamos.
# O pacote só lê o arquivo, então ele é criado aqui — sem sobrescrever o do usuário.
QUESTION_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/rpiv-ask-user-question/config.json"
if [ ! -f "$QUESTION_CONFIG" ]; then
  echo "→ question: gravando $QUESTION_CONFIG (collapseKey alt+o)"
  mkdir -p "$(dirname "$QUESTION_CONFIG")"
  printf '{\n  "collapseKey": "alt+o"\n}\n' > "$QUESTION_CONFIG"
fi

# Pacote local que sumiu (repo movido/apagado) deixa o settings.json apontando
# para um caminho inválido; só avisamos, a remoção é decisão do usuário.
while IFS= read -r declarado; do
  [ -e "$declarado" ] || echo "aviso: pacote declarado não existe mais: $declarado (remova com: pi remove $declarado)" >&2
done < <("${pi_cmd[@]}" list 2>/dev/null | sed -n 's/^    \(\/.*\)$/\1/p')

echo "→ mcp: garantindo context7"
"${pi_cmd[@]}" mcp add context7 --url https://mcp.context7.com/mcp >/dev/null

# ─── ai-memory ───────────────────────────────────────────────────────────────
# Porta local própria: o ai-memory usa 49374 por padrão, que pode estar ocupada
# por outro harness; 49375 mantém o serviço separado.
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
    echo "aviso: $AI_MEMORY_CONFIG não usa a porta ${AI_MEMORY_PORT}" >&2
  fi

  echo "→ ai-memory: aplicando serviço e integração do Pi (extensão + MCP)"
  # PI_CODING_AGENT_DIR direciona a extensão gerada para o mesmo agent dir do sync.
  if ! PI_CODING_AGENT_DIR="$AGENT_DIR" "$bin" setup --yes --agent pi; then
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
echo "  pacote:    $ROOT"
echo "  agent dir: $AGENT_DIR"
echo "  memória:   http://127.0.0.1:${AI_MEMORY_PORT}"
echo
echo "Abra o Pi (ou rode /reload numa sessão aberta) para carregar skills, prompts e a extensão guard."
