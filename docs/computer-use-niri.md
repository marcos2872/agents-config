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

## 8. Próximos passos

1. Testar um fluxo real: `screenshot` → `click`/`type_text` → `wait_screen` em uma janela
   flutuante de um Electron.
2. Habilitar AT-SPI (`a11y_enable`) e comparar clique por seletor vs. pixel.
3. Decidir entre **Fase 1** (runner Electron) e contribuir com o backend niri no
   `wayland-mcp`/`computer-use-linux`.

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
