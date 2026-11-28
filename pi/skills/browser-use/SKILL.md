---
name: browser-use
description: "Usa a extensão Chrome browser-use (ferramentas browser_*) para controlar o navegador pelo Pi: abrir abas no grupo da sessão, ler a página por acessibilidade, clicar/digitar/preencher formulários, tirar screenshots e gravar GIF, ler console e rede, rodar JavaScript controlado, anexar abas do usuário. Use quando pedirem para navegar num site, testar ou depurar uma página, automatizar um fluxo no navegador, conferir o que a tela mostra, capturar prints da interface, ler console/requisições de uma aba, ou validar a própria extensão browser-use."
argument-hint: "Opcionalmente: URL/site alvo, a aba (tabId) já aberta, ou 'testar extensão' para rodar o smoke test das 18 tools"
---

# browser-use — o navegador do Pi

Extensão Chrome MV3 sem UI (`browser/`) + relay `pi/extensions/browser-relay.ts` (porta 8809). Expõe as 18 tools `browser_*`; o agente enxerga e opera só as abas do **grupo da sessão** (título `pi · <sessão>`).

## Antes de usar (checagem de 5 segundos)

```bash
curl -s -m 3 http://127.0.0.1:8809/health   # {"connected":true,"version":6}
```

- `connected:false` → o Chrome não está com a extensão ativa, ou ela foi recarregada e o relay espera reconexão: reabra/recarregue `browser/dist` em `chrome://extensions`.
- Nada responde → o relay é do processo do Pi: `/reload` na sessão, ou reinicie o Pi.
- Mudou o código em `browser/` → `npm run build` e recarregar a extensão em `chrome://extensions` (o `dist/` é o que o Chrome carrega).
- Mudou `pi/extensions/browser-relay.ts` → `/reload` no Pi.

## Regra de ouro da sessão

1. `browser_tabs_context` (com `createIfEmpty: true` na primeira vez) → pega o `tabId`.
2. Todo o resto recebe `tabId`. Sem `tabId` a tool usa a aba principal da sessão; um `tabId` de outra sessão falha com `does not belong to this session` — releia o contexto, IDs mudam a cada reload do Chrome.
3. Um grupo por sessão; o relay não enxerga abas fora do grupo. Para trabalhar no que o usuário já abriu: `browser_tabs_attach` (pede permissão; a aba sai do grupo atual dele).

## As 18 tools

| Tool | O que faz | Notas |
|---|---|---|
| `browser_tabs_context` | lista abas do grupo | `createIfEmpty: true` cria grupo + aba em branco (em segundo plano) |
| `browser_tabs_create` | abre URL no grupo | mesma origem (ou aba em branco) reaproveita a principal; outra origem = aba nova; `active` traz para frente |
| `browser_tabs_attach` | adota uma aba existente | pede permissão; falha se a aba estiver em outra janela |
| `browser_tabs_close_tab` | fecha aba do grupo | |
| `browser_navigate` | navega / `direction: back\|forward` | domínio novo pede aprovação no chat; falta `https://` ele põe |
| `browser_read_page` | árvore de acessibilidade com `ref_1…` | `filter: interactive` em página grande; `frames: all` → `f<id>_ref_N`; `depth`, `max_chars`, `include_hidden`, `ref_id` |
| `browser_find` | busca por texto/role, até 20 refs | mais rápido que ler a árvore inteira; aceita `frames` |
| `browser_get_page_text` | texto de `article/main/body` | `max_chars`, `frames: all` concatena iframes |
| `browser_form_input` | preenche `input`, `textarea`, `select`, contenteditable | por `ref`; não é clique, campo com máscara pode exigir `computer type` |
| `browser_computer` | `click`, `type`, `key`, `scroll`, `hover`, `screenshot`, `zoom`, `wait` | alvo por `ref` ou `coordinate: [x,y]`; ref de iframe só via DOM |
| `browser_javascript_tool` | última expressão do JS na página | último recurso e **só leitura**: nunca cookies/storage/tokens, nunca request para outro domínio; 50 KB |
| `browser_read_console_messages` | console/erros (`[LOG]`, `[ERROR]`) | `onlyErrors`, `pattern`, `limit`, `clear` |
| `browser_read_network_requests` | requisições com status | `urlPattern`, `limit`, `clear` |
| `browser_resize_window` | `width`/`height` da janela | testa responsivo |
| `browser_update_plan` | apresenta plano (domínios + passos) para aprovação | domínios aprovados ficam liberados na sessão |
| `browser_upload_image` | 1–3 arquivos base64 num `input[type=file]`/drop | ~5 MB cada; pede permissão |
| `browser_gif_creator` | `start`, `stop`, `export` | cada ação vira um frame (até 30); salva em `Downloads/pi-browser-<ts>.gif` e devolve o caminho |
| `browser_batch` | até 20 ações independentes numa chamada | ver abaixo |

## Padrões que economizam rodadas

- **Ler primeiro, agir depois:** `read_page(filter: "interactive")` ou `find` → usar os refs. Ref velho morre depois de navegação/re-render.
- **`browser_batch`** só para ações independentes, e com o nome **interno** da tool (sem `browser_`, e o fechamento é `tabs_close`): `[{name: "read_page", input: {...}}, {name: "read_network_requests", input: {...}}]`. Capturas feitas dentro do lote voltam normalmente. Não use para `A → B` dependente, nem aninhado.
- **Console e rede só capturam do momento em diante:** arme a leitura e recarregue (`navigate` para a mesma URL) para pegar a fase de carga.
- **`key` envia keydown/keyup, não digita:** texto e símbolos vão por `action: "type"` (ele aceita `ref` ou `coordinate` e clica antes de digitar; `submit: true` pressiona Enter no fim); para atalhos, a tecla literal (`"!"`, `Enter`, `Ctrl+A`).
- **Screenshot** grava em `~/.cache/pi-browser/capturas/` e devolve o caminho — use isso para embutir a tela em documentação. `zoom` com `region: [x1, y1, x2, y2]` para recorte. Antes de capturar, o ponteiro virtual é escondido, então print não sai com o mouse do agente em cima.
- **Mouse virtual:** cada `click`/`hover`/`type` move um ponteiro desenhado na página (com onda no clique) e traz a aba para frente, para o usuário acompanhar o trabalho. Ele aparece nos frames do `gif_creator`; em página não injetável (`chrome://`, PDF) o ponteiro simplesmente não é desenhado — a ação em si continua valendo.
- **Fluxo de formulário:** `form_input` nos campos → `computer click` no botão (ou `computer type` com `submit: true`) → `read_page`/`get_page_text` para conferir o resultado.
- **Depurar página quebrada:** arme console + rede, recarregue, leia as duas, e só então `javascript_tool` para inspecionar estado.

## Permissões

Pedidos aparecem no chat e podem ser negados (a tool devolve `denied`). Pedem aprovação: domínio novo, screenshot, zoom, JavaScript, upload, GIF, anexar aba. Aprovar o plano (`update_plan`) libera os domínios listados pelo resto da sessão — em fluxo multi-domínio, faça isso primeiro.

## Recusas e erros comuns

| Mensagem | Causa / saída |
|---|---|
| `not connected` | extensão inativa ou recarregada → `chrome://extensions` e reabra |
| `does not belong to this session` | `tabId` de outra sessão/reload → `browser_tabs_context` |
| `Tab N does not belong to this session` no lote | nome interno errado (`tabs_close_tab` em vez de `tabs_close`) ou aba morta |
| `The extension disconnected during the run.` | recarregaram a extensão no meio da ação; repita depois de `tabs_context` |
| `CDP/attach` falhou | o DevTools está aberto na aba: é preciso fechar (o Chrome só permite um cliente de debug por aba) |

## Não faça

- Não leia cookies, `localStorage`, tokens nem `auth.json` pela página; não use `javascript_tool` para furar CORS.
- Não feche abas que o usuário abriu fora do grupo (`tabs_close_tab` só aceita abas do grupo).
- Não use o navegador para contornar aprovação negada: peça de novo com o motivo, ou siga sem aquela ação.

## Smoke test da própria extensão

Quando pedirem "teste a extensão": `tabs_context(createIfEmpty)` → `navigate` para `https://example.com` → `read_page` + `get_page_text` + `find` → `computer screenshot` (e conferir o caminho em disco) → `read_console_messages`/`read_network_requests` após recarregar → `resize_window` → `tabs_create`/`tabs_close`. Para formulário/iframe/upload, sirva uma página local (`python3 -m http.server`) em vez de depender de site de terceiros.
