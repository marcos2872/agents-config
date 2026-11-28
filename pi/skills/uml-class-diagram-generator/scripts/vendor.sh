#!/usr/bin/env bash
# Baixa o que a página offline embute: o ELK (layout) e as fontes IBM Plex (subconjunto latino).
# Roda uma vez por máquina; precisa de rede. Depois disso, build.py gera a página sem tocar na internet.
# Grava no cache do usuário (sobrevive às atualizações do plugin e serve às duas skills de diagrama):
# $SKILL_KIT_CACHE/vendor, ou ${XDG_CACHE_HOME:-~/.cache}/skill-kit/vendor. VENDOR_DIR escolhe outra pasta.
set -euo pipefail
vendor="${VENDOR_DIR:-${SKILL_KIT_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/skill-kit}/vendor}"
mkdir -p "$vendor"

ELK_VERSION="0.9.3"
echo "· elkjs $ELK_VERSION"
curl -sfL "https://cdn.jsdelivr.net/npm/elkjs@${ELK_VERSION}/lib/elk.bundled.js" -o "$vendor/elk.bundled.js"

echo "· IBM Plex (latin)"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
curl -sfL -A "$UA" -o "$vendor/fonts-remote.css" \
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap"

python3 - "$vendor" <<'PY'
import base64, re, sys, urllib.request
vendor = sys.argv[1]
css = open(f'{vendor}/fonts-remote.css').read()
faces = []
for subset, block in re.findall(r'/\* ([\w-]+) \*/\s*(@font-face\s*\{[^}]*\})', css):
    if subset != 'latin':
        continue  # latin já cobre os acentos do português
    url = re.search(r'url\((https://[^)]+\.woff2)\)', block).group(1)
    data = base64.b64encode(urllib.request.urlopen(url).read()).decode()
    faces.append(block.replace(url, 'data:font/woff2;base64,' + data))
assert faces, 'nenhuma @font-face latina encontrada'
open(f'{vendor}/fonts.css', 'w').write('\n'.join(faces) + '\n')
print(f'  {len(faces)} variações embutidas')
PY

rm -f "$vendor/fonts-remote.css"
ls -la "$vendor"
