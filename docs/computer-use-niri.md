# Computer use no Linux (niri) para o OpenCode

Pesquisa e plano para dar ao agente uma forma **padronizada** de validar apps desktop
(Electron, Tauri, GTK/Qt) no niri: clicar, digitar, redimensionar, tirar screenshot,
esperar mudança de tela — com evidência e sem depender de improviso a cada sessão.

- **Data:** 2026-11-27
- **Ambiente:** niri 26.04 (`wayland-1`), OpenCode V2, Fedora
- **Status:** pesquisa concluída; `wayland-mcp` instalado e conectado **apenas neste repo**

---

## TL;DR

A parte "controlar o desktop" **já existe pronta e com suporte a niri** — não vale
construir outro driver de pixel do zero. O que não existe é a camada que resolve o
problema de verdade: **validação de fluxo de app, semântica primeiro, com cenário e
evidência**, integrada ao OpenCode. A recomendação é construir essa camada fina em cima
de peças existentes (`wayland-mcp`, `niri`, CDP/WebDriver), não um novo "computer use".

---

## 1. O que já existe hoje

| Projeto | O que é | niri? | Veredito |
|---|---|---|---|
| **wayland-mcp** (Rust, MIT) | MCP com 49 tools: screenshot, OCR, clique/tecla/drag/scroll, árvore AT-SPI, clipboard, gravação, sandbox em niri aninhado, overlay indicador | Sim, protocolos nativos (wlr-screencopy + virtual pointer/keyboard) | **Mais próximo do que foi pedido.** Base natural |
| **computer-use-linux** (Rust, MCP/CLI) | AT-SPI semântico + pixel, `screenshot_after`/`include_tree` na mesma chamada, indicador de cursor, `doctor` | Parcial: janelas via IPC do niri, screenshot via grim; input por uinput (o portal RemoteDesktop não existe no niri) | Backend do **Codex Desktop no Linux**. Ótimo em semântica, fraco em niri nativo |
| **niri-use** (CLI, JSON) | "xdotool do niri": sessão niri aninhada, `zwlr_virtual_pointer`, `wtype`, `grim`, IPC de janelas, AT-SPI opcional, `observe --grid` | Nativo | Prova de que o caminho niri puro funciona |
| **cua-driver** (trycua) | Driver de computer-use para qualquer agente, AT-SPI + XTEST, MCP/CLI/SDK | Wayland em preview (X11/XWayland é o suportado) | Não é o melhor caminho no niri |
| **waymux** | Sessões Wayland **headless** com niri aninhado, input sintético, gravação e viewer; CI sem GPU (llvmpipe) | Sim | A peça que falta para rodar em CI |
| **wl-inject / wlrctl / wtype / grim** | Blocos de baixo nível | Sim | `wlrctl`/`wtype` abrem conexão one-shot e podem **perder eventos**; `wl-inject` existe por isso |
| **Playwright `_electron`**, **`tauri-driver`** | Automação semântica do app em si (CDP / WebKitWebDriver) | Independe do compositor | **O atalho que ninguém está usando** |

### Detalhes que importam

- **wayland-mcp**: fala MCP por stdio, tem CLI (`doctor`, `tools`, `call`), mantém um
  dispositivo virtual persistente, valida `shot_id` (recusa clique com screenshot velho),
  oferece sandbox (niri aninhado com socket, D-Bus, bus AT-SPI e clipboard próprios) e
  indicador layer-shell.
- **computer-use-linux**: clique por `element_index`/seletor AT-SPI, verificação
  pós-ação na mesma chamada, indicador que se esconde durante o screenshot. No niri há
  **um único seat**, então não existe cursor de agente separado do cursor real.
- **niri-use**: nested niri por padrão, coordenada do screenshot = coordenada do clique,
  mouse via `zwlr_virtual_pointer` (sem `ydotool`).
- **waymux**: "xvfb-run do Wayland" — sessão headless, screenshot, gravação e input;
  niri validado como compositor interno.

---

## 2. Como Anthropic e OpenAI fazem

O loop é sempre: **screenshot → modelo devolve coordenada → app traduz para input →
novo screenshot**.

**Anthropic**

- O `computer_20250124` é uma tool **definida pelo provedor** (screenshot, zoom, click,
  type, key, scroll, drag, wait, cursor_position). O schema não é editável.
- A referência roda um desktop Linux em Docker com **Xvfb + Mutter + xdotool/scrot**.
- Screenshot é rebaixado para **XGA/WXGA (1024×768 / 1280×800)** e as coordenadas voltam
  escaladas proporcionalmente. Recomendam nunca mandar acima de 1920×1080.
- Delay fixo (~2 s) entre ação e captura; histórico de screenshots é podado.
- É **puramente pixel**: não sabe o que é um botão.

**OpenAI**

- Computer use é tool customizada no Responses API (a OpenAI não fixa um schema nativo);
  o agente roda numa VM na nuvem.
- No **Codex Desktop Linux**, o backend é o `computer-use-linux` (AT-SPI + uinput +
  indicador): semântica primeiro, pixel como fallback.

**A "tarja azul"**

- É um overlay/indicador do lado do app, não do modelo. No niri há equivalente nativo
  (window rule + layer-shell), ver seção 3.

---

## 3. O que o niri entrega de graça

- **Input sem root**: `zwlr_virtual_pointer_manager_v1` v2 (com `motion_absolute`, dá para
  ir direto em x,y) e `zwp_virtual_keyboard_manager_v1`. Sem `/dev/uinput`, sem grupo
  `input`.
- **Captura por janela**: `niri msg action screenshot-window --id N --path ...` renderiza
  **só aquela janela**, sem outras por cima — ideal para validar app. Para vídeo/stream:
  wlr-screencopy / ext-image-copy-capture.
- **Janelas**: `niri msg --json windows|workspaces|outputs` (geometria, `app_id`, `pid`,
  foco), foco, `set-window-width`/`height` em **px** ou %, floating, mover de workspace,
  fullscreen, close.
- **Isolamento**: o niri roda dentro do niri — o agente ganha um desktop aninhado com
  socket, D-Bus e bus AT-SPI próprios.
- **A tarja**: window rule `is-window-cast-target=true` + cor de borda (o niri já desenha
  borda especial na janela que está sendo castada) ou overlay layer-shell para
  borda/cursor/glow.
- **O que falta**: portal `RemoteDesktop` ainda é PR aberto no niri; e há **um único
  seat**, então clique do agente move o cursor real (a menos que use sessão
  aninhada/headless).

---

## 4. Onde está a lacuna real

Não é "clicar e tirar screenshot" — isso já tem três implementações. Falta, para o caso
de desenvolver app e pedir validação:

1. **Camada semântica do app**, não do desktop. Electron expõe CDP
   (`--remote-debugging-port`); Tauri no Linux expõe WebDriver via `tauri-driver`. Com
   isso dá para clicar por seletor, ler DOM, console e network, redimensionar viewport e
   tirar screenshot **sem mover o mouse do usuário**.
2. **Escopo por janela/workspace**: validar *aquele* app, numa janela flutuante de tamanho
   fixo, não no desktop inteiro.
3. **Cenário + evidência**: passos declarativos com asserts (`expect_text`, `expect_dom`,
   `no_console_errors`, baseline) e um pacote de saída (screenshots, DOM, console,
   vídeo) por execução.
4. **Integração com OpenCode**: tools namespaced + skill ensinando a escada
   (CDP → AT-SPI → pixel) e o formato do cenário.
5. **Consentimento/visibilidade**: indicador, allowlist de apps, kill switch, log de ações.

---

## 5. Plano por fases

### Fase 0 — matar ou confirmar a ideia (1–2 dias)

Instalar e exercitar o que existe: `wayland-mcp` (feito), `computer-use-linux`,
`niri-use`. Fazer um fluxo inteiro em um Electron real.

**Critério de saída:** se um deles já resolve 80%, o projeto vira "contribuir + glue",
não "novo driver".

### Fase 1 — runner de validação para Electron (3–5 dias)

É onde está o retorno. Daemon local em TS/Bun que:

- sobe o app com `--remote-debugging-port` + `--user-data-dir` isolado;
- conecta via Playwright (`_electron.launch` ou `connectOverCDP`);
- expõe `app_launch / app_snapshot / app_click / app_type / app_wait / app_assert /
  app_record / app_run_scenario`;
- grava a evidência em `.agents/validation/<run>/`.

Escada de resolução:

```
CDP / WebDriver  →  AT-SPI  →  pixel (niri)  →  desktop inteiro
```

### Fase 2 — driver niri nativo (1–2 semanas)

Só para o que não é web ou quando o CDP não existe:

- processo persistente segurando **um** virtual pointer + keyboard (lição do `wl-inject`);
- `niri msg` para geometria/janela; `screenshot-window` para captura;
- mapeamento screenshot→tela com downscale para ≤1280 px;
- overlay layer-shell com borda/cursor + consentimento.

Tools: `app_windows`, `app_focus`, `app_resize`, `app_capture`, `app_click`, `app_type`,
`app_wait_change`, `app_record`.

### Fase 3 — Tauri, AT-SPI e CI

- `tauri-driver` para WebKitGTK;
- AT-SPI como camada semântica para app nativo (Electron precisa de
  `--force-renderer-accessibility`);
- execução headless com `waymux` no CI (llvmpipe, sem GPU).

### Onde pluga neste repo

- servidor MCP em `opencode/opencode.json` (`mcp.servers`) para todos os projetos, ou
  `opencode.json` na raiz para este repo apenas;
- skill em `opencode/skills/app-validation/SKILL.md`.

---

## 6. Armadilhas que vão aparecer

- **Janela tiled não tem retângulo absoluto** no IPC do niri: `tile_pos_in_workspace_view`
  vem `null` (confirmado no teste desta sessão). Solução: abrir o app **flutuante** com
  tamanho fixo (window rule) ou fullscreen; aí a coordenada é determinística.
- **Escala fracionária**: screenshot em pixels físicos, geometria em pixels lógicos.
  Sempre mandar o screenshot rebaixado e converter de volta.
- **Texto acentuado**: `wtype`/keysyms erram com layout ABNT2. Para pt-BR, usar
  `Input.insertText` (CDP) ou clipboard + Ctrl+V.
- **Dispositivo virtual one-shot** perde evento em cliente que faz bind tardio do seat.
  Manter a conexão viva.
- **Um seat só**: clique do agente move o cursor real. Se incomodar, sessão
  aninhada/headless.
- **Segurança**: conteúdo do app é input não confiável (prompt injection). Allowlist,
  perfil isolado, sem segredos na sessão, kill switch e log de ações.
- **AT-SPI desligado**: no niri, `toolkit-accessibility` costuma vir `false`; é preciso
  habilitar (ver seção 7).

---

## 7. Instalação local (feita em 2026-11-27)

### Binário

- Versão: **wayland-mcp 0.5.2** (release de 2026-10-28)
- Origem: `gh release download v0.5.2 --repo alex-oleshkevich/wayland-mcp`
- Checksum: `sha256sum -c SHA256SUMS` → **SUCESSO** para `linux-amd64`
- Destino: `~/.local/bin/wayland-mcp`

### `doctor` no niri 26.04

```
target: host
  wayland_socket    ok                 socket=/run/user/1000/wayland-1 target=host
  registry          ok                 globals=44 outputs=2
  screencopy        available
  virtual_pointer   available
  virtual_keyboard  available
  layer_shell       available
  data_control      available          protocol=zwlr_data_control_manager_v1
  niri              available          path=/usr/local/bin/niri
  ffmpeg            available          path=/usr/bin/ffmpeg
  accessibility     disabled           applications=3 is_enabled=false
  portal            capture-only       input_devices=[]
  indicator         on
```

Leitura: screencopy, ponteiro e teclado virtuais, layer-shell e IPC do niri funcionam.
AT-SPI está desligado; para habilitar use a tool `a11y_enable` com
`confirm_desktop_change: true` (ou
`gsettings set org.gnome.desktop.interface toolkit-accessibility true`). O portal só
serve para captura; input vai pelos protocolos wlr.

### Configuração no OpenCode (escopo deste repo)

```json
{
  "mcp": {
    "servers": {
      "wayland-mcp": {
        "type": "local",
        "command": ["/home/marcos/.local/bin/wayland-mcp"]
      }
    }
  }
}
```

Arquivo: `opencode.json` na raiz deste repositório (**não** é global; não foi para
`~/.config/opencode/opencode.json`). `opencode mcp list` mostra `wayland-mcp connected`.

### Teste feito

`desktop_info` chamado **de dentro do OpenCode** (não só pela CLI) retornou:

- saídas: `eDP-1` 1920×1080 em (0,0) e `DP-1` 3440×1440 em (1920,0), escala 1;
- 8 janelas com `app_id`, `pid`, foco e geometria;
- `windows_note: via compositor IPC`;
- todas as janelas com `tile_pos_in_workspace_view: null` — confirmando a armadilha da
  seção 6.

### Como remover depois

```sh
rm ~/.local/bin/wayland-mcp
# e apague o bloco "wayland-mcp" de opencode.json na raiz do repo
```

---

## 8. Testes práticos (2026-11-27)

Todos os testes rodaram com o OpenCode V2 no niri 26.04, usando o `wayland-mcp`
conectado por MCP. Salvo indicação, o app foi aberto num **niri aninhado** (sandbox) para
não mexer na área de trabalho real.

### 8.1 `zenity` no sandbox — ciclo completo

Objetivo: abrir, digitar, submeter e ler o resultado de volta.

```
sandbox_start { width: 1280, height: 800 }
  → sandbox-655060-1, output interno 1272×768 (o host decide o tamanho)
app_launch ["zenity","--entry","--title=Teste wayland-mcp","--text=Digite seu nome"]
  → app-1, pid 655780, janela flutuante 300×253
type_text "Marcos"
key ["Return"]
app_logs app-1 → stdout: "Marcos"   (exit_code: 0)
```

Resultado: **abrir → digitar → submeter → ler stdout** funcionou de ponta a ponta.

Clique por pixel com validação de screenshot:

```
screenshot → shot (900×543)
click { shot_id, space: "screenshot", x: 450, y: 319 }
  → lógico [636.7, 451.9]; app fechou com exit_code 0
```

Gravação de evidência (`record_start` → ação → `record_stop`):

```
50 frames / 3617 ms / h264 1272×768 15 fps / 3,33 s / 40 KB
~/.local/share/wayland-mcp/recordings/demo-zenity-1795805707851.mp4
```

### 8.2 KCalc no sandbox — teclado, mouse e regressão visual

```
sandbox_start → sandbox-655060-2, 1272×768
app_launch ["kcalc"] → org.kde.kcalc, pid 656699, janela tiled 612×736

type_text "6*7" + key ["Return"]      → display: 42
6 cliques por pixel (AC, 1, 2, ×, 4, =) → display: 48

baseline_save "kcalc-48"
type_text "2+3" + Return                → display: 5
baseline_compare "kcalc-48"
  → pass: false, 85 px alterados, região (576,96,64,32)
```

O `baseline_compare` localizou exatamente a área do display que mudou de 48 para 5 — é o
tipo de assert que serve para validação automatizada.

### 8.3 DT Flow Transcript na sessão principal — CDP vs. pixel

App Electron (`/opt/DT Flow Transcript/dt-flow-transcript`, v0.1.90). Para não interferir
na instância já aberta, subi uma **instância nova** com porta de debug e perfil isolado:

```
/opt/DT Flow Transcript/dt-flow-transcript \
  --remote-debugging-port=9334 \
  --user-data-dir=/tmp/opencode/dtf-profile-host
```

A instância original (pid 552564, janela 114) permaneceu intocada; a de teste virou a
janela 121.

**Caminho semântico (CDP).** Scripts versionados em
[`docs/exemplos/`](exemplos/):

```
node docs/exemplos/cdp-eval.mjs 9334 \
  "[...document.querySelectorAll('button')].map(b=>b.innerText.trim())"
  → Início, Reuniões, Projetos, Configurações, "Baixar modelo", "Depois", ...

node docs/exemplos/cdp-click.mjs 9334 "Depois" /tmp/dtf.png
  → rect {x:997,y:945,w:92,h:42}
  → Input.dispatchMouseEvent (press/release no centro do rect)
  → modalAberto: false
  → Page.captureScreenshot → só a página do app
```

O clique semântico achou o botão pelo **nome**, clicou no centro exato com evento de mouse
real e verificou o efeito — sem adivinhar pixel nem capturar o resto da tela.

**Caminho por pixel (wayland-mcp), na sessão principal:**

```
screenshot { output: "DP-1", max_dimension: 1500, grid: true } → shot 1500×628
click { shot_id, space: "screenshot", x: 768, y:  97 } → lógico [3682.4, 223.6] → "Projetos"
click { shot_id, space: "screenshot", x: 768, y: 103 } → lógico [3682.4, 237.3] → "Configurações"

baseline_save "dtf-projetos" (output: DP-1)
baseline_compare "dtf-projetos" (output: DP-1)
  → 1.424.619 px alterados (28,8% de 4.953.600), pass: false
```

A navegação foi confirmada pelo próprio CDP (`body.innerText` com Geral/Transcrição/FLOW/
Áudio/…), e o screenshot da tela de Configurações mostrou a pasta de gravações em
`/tmp/opencode/dtf-profile-host/recordings` — prova de que o perfil isolado funcionou.

### 8.4 O que funcionou e o que não

| Capacidade | Resultado |
|---|---|
| `app_launch` / `app_logs` / `app_stop` | Funciona (stdout, exit code, processo dono) |
| `type_text` + `key` (virtual keyboard) | Funciona, inclusive acentos via modo `paste` |
| `click` por pixel com `shot_id` | Funciona; recusa screenshot velho |
| `screenshot` (output, crop, grid, downscale) | Funciona |
| `record_start/stop` | Funciona (h264, via ffmpeg) |
| `baseline_save/compare` | Funciona, com as ressalvas abaixo |
| Sandbox (niri aninhado) | Funciona; isola desktop, D-Bus e socket |
| AT-SPI no sandbox | **Falha**: `org.a11y.Bus: Permission denied` |
| OCR (`read_text`/`find_text`) | Não testado (modelos ausentes) |
| `window.screenX/screenY` no Electron | **Sempre 0** no Wayland |

### 8.5 Achados que mudam o desenho

1. **`screenX/screenY = 0` no Wayland.** O renderer não sabe onde a janela está. Não dá
   para converter `getBoundingClientRect()` em coordenada global só com o DOM: é preciso
   juntar CDP (elemento) + compositor (posição da janela). O harness tem que ser esse elo.
2. **Clique por pixel erra por pouco.** 6 px de diferença na imagem acertaram "Projetos"
   em vez de "Configurações"; o clique semântico não tem essa ambiguidade. Pixel é
   fallback, não padrão.
3. **`tile_pos_in_workspace_view` vem `null` para janelas tiled.** Coordenada relativa à
   janela não é confiável; coordenada na tela (screenshot do output) funciona.
   → Para validar app, abrir flutuante com tamanho fixo ou fullscreen.
4. **`baseline_compare` usa a primeira saída por padrão.** Sem `output`, comparou
   3440×1440 com 1920×1080 e devolveu `size_mismatch` com `total_pixels: 0`.
5. **Comparar o output inteiro é ruidoso.** O diff pegou também o cursor do terminal.
   Para app, capturar/recortar só a janela (no Electron, `Page.captureScreenshot`).
6. **O niri aninhado sobe com o "Important Hotkeys" aberto**, cobrindo parte da tela.
   Fechar com `Escape`; o ideal é `hotkey-overlay { skip-at-startup }` na config do
   sandbox (o `niri-use` faz isso; o `wayland-mcp` 0.5.2 não).
7. **Perfil novo de Electron cria efeitos colaterais.** O perfil limpo tinha "iniciar com
   o sistema" marcado e criou `~/.config/autostart/dt-flow-transcript.desktop`. Foi
   removido junto com os perfis temporários.

---

## 9. Próximos passos

1. Investigar o `org.a11y.Bus: Permission denied` no sandbox para habilitar clique
   semântico por AT-SPI também em app nativo.
2. Montar o runner da **Fase 1**: CDP decide o elemento, niri/MCP confirma a janela e
   fornece evidência (screenshot, vídeo, console, network).
3. Definir o formato de cenário/evidência (`.agents/validation/<run>/`) e a skill
   `app-validation` do OpenCode.

---

## Referências

- Anthropic computer use (tool, ambiente, escala): <https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool>
- Referência em Docker (xdotool/scrot/Xvfb): <https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo>
- wayland-mcp: <https://github.com/alex-oleshkevich/wayland-mcp>
- computer-use-linux: <https://github.com/agent-sh/computer-use-linux>
- niri-use: <https://github.com/jswysnemc/niri-use>
- cua-driver: <https://github.com/trycua/cua>
- waymux: <https://github.com/waymux/waymux>
- niri IPC: <https://niri-wm.github.io/niri/IPC.html>
- niri screencasting (portais, dynamic cast, `is-window-cast-target`): <https://niri-wm.github.io/niri/Screencasting.html>
- protocolo virtual pointer: <https://wayland.app/protocols/wlr-virtual-pointer-unstable-v1>
- protocolo virtual keyboard: <https://wayland.app/protocols/virtual-keyboard-unstable-v1>
- portal RemoteDesktop (ainda não no niri): <https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html>
- PR do portal no niri: <https://github.com/niri-wm/niri/pull/1966>
