/**
 * Presença do agente na aba: borda animada (anel cônico girando + brilho interno),
 * pílula na base dizendo o que está sendo feito, mouse virtual e onda de clique.
 *
 * Só no frame principal, acima de tudo e sem capturar eventos. A API fica em
 * `window.__piOverlay` no mundo isolado do content script; o background a chama
 * por `chrome.scripting.executeScript` (ver background/overlay.ts).
 */
export interface OverlayApi {
  /** Acende a borda e atualiza a pílula com a ação em andamento. */
  status: (text: string, busy?: boolean) => void
  move: (x: number, y: number, click?: boolean) => void
  hide: () => void
}

declare global {
  interface Window {
    __piOverlay?: OverlayApi
  }
}

const HOST_ID = "__pi-overlay"
const FADE_MS = 300
const PRESS_MS = 160
const RIPPLE_MS = 620
const CURSOR_IDLE_MS = 3_000
/** Durante a ação: tempo máximo sem notícia antes de apagar sozinho. */
const BUSY_WATCHDOG_MS = 20_000
/** Ação terminou: some logo depois, sem piscar entre tools. */
const IDLE_WATCHDOG_MS = 4_000
const ACCENT = "#8fb8ee"
const ACCENT_SOFT = "#c5dcf7"
const ACCENT_RGB = "143, 184, 238"

const STYLE = `
  :host { all: initial; }
  .frame { position: fixed; inset: 0; pointer-events: none; opacity: 0;
    transition: opacity ${FADE_MS}ms ease; }
  .frame.on { opacity: 1; }
  /* Anel: gradiente cônico girando, recortado em 3px pela máscara. */
  .ring { position: absolute; inset: 0; padding: 3px; overflow: hidden;
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0); }
  .ring::before { content: ""; position: absolute; left: 50%; top: 50%;
    width: 200vmax; height: 200vmax; margin: -100vmax 0 0 -100vmax;
    background: conic-gradient(from 0deg,
      ${ACCENT} 0%, ${ACCENT_SOFT} 12%, ${ACCENT} 28%,
      rgba(${ACCENT_RGB}, .18) 50%,
      ${ACCENT} 72%, ${ACCENT_SOFT} 88%, ${ACCENT} 100%);
    animation: spin 3.4s linear infinite; }
  .glow { position: absolute; inset: 0;
    box-shadow: inset 0 0 40px 4px rgba(${ACCENT_RGB}, .30),
                inset 0 0 120px rgba(${ACCENT_RGB}, .10);
    animation: pulse 2.6s ease-in-out infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }

  .pill { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
    display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 24px);
    background: #141413; color: #faf9f5; pointer-events: auto;
    font: 500 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 9px 10px 9px 14px; border-radius: 999px;
    box-shadow: 0 12px 32px rgba(0,0,0,.28);
    opacity: 0; transition: opacity ${FADE_MS}ms ease; }
  .pill.on { opacity: 1; }
  .pill > .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: ${ACCENT}; }
  .dot.busy { animation: blink 1s ease-in-out infinite; }
  @keyframes blink { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
  .stop { border: 0; border-radius: 999px; padding: 6px 10px;
    background: #faf9f5; color: #141413; font: 600 12px/1 inherit; cursor: pointer; }
  .stop:hover { background: #f1efe8; }

  .cursor { position: fixed; left: 0; top: 0; width: 22px; height: 28px; margin: -1px 0 0 -2px;
    pointer-events: none; opacity: 0; will-change: transform;
    transition: transform 300ms cubic-bezier(.22,.8,.24,1), opacity 200ms ease;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,.35)); }
  .cursor.on { opacity: 1; }
  .cursor.snap { transition: opacity 200ms ease; }
  .cursor svg { display: block; transform-origin: 2px 2px; transition: transform ${PRESS_MS / 2}ms ease-out; }
  .cursor path { fill: ${ACCENT}; stroke: #faf9f5; stroke-width: 1.5; stroke-linejoin: round; }
  .cursor.press svg { transform: scale(.78); }
  .ripple { position: fixed; left: 0; top: 0; width: 38px; height: 38px; margin: -19px 0 0 -19px;
    border-radius: 50%; pointer-events: none;
    border: 2px solid ${ACCENT}; background: rgba(${ACCENT_RGB}, .22);
    animation: ripple ${RIPPLE_MS}ms ease-out forwards; }
  @keyframes ripple {
    from { transform: translate3d(var(--x), var(--y), 0) scale(.2); opacity: .95; }
    to { transform: translate3d(var(--x), var(--y), 0) scale(1.5); opacity: 0; } }

  /* Aba escondida: animação pausada, mesma aparência, menos CPU/GPU. */
  .frame.paused .ring::before, .frame.paused .glow { animation-play-state: paused; }

  @media (prefers-reduced-motion: reduce) {
    .ring::before, .glow { animation: none; }
    .glow { opacity: .8; }
    .cursor { transition: opacity 200ms ease; }
    .ripple { animation-duration: 1ms; }
  }
`

export function installOverlay(): void {
  if (window.top !== window) return
  if (window.__piOverlay) return
  if (!document.documentElement) {
    document.addEventListener("DOMContentLoaded", () => installOverlay(), { once: true })
    return
  }

  document.getElementById(HOST_ID)?.remove()
  const host = document.createElement("div")
  host.id = HOST_ID
  host.setAttribute("aria-hidden", "true")
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647"
  const root = host.attachShadow({ mode: "open" })
  const style = document.createElement("style")
  style.textContent = STYLE
  root.appendChild(style)

  const frame = document.createElement("div")
  frame.className = "frame"
  const glow = document.createElement("div")
  glow.className = "glow"
  const ring = document.createElement("div")
  ring.className = "ring"
  frame.append(glow, ring)
  root.appendChild(frame)

  const pill = document.createElement("div")
  pill.className = "pill"
  const dot = document.createElement("span")
  dot.className = "dot"
  const label = document.createElement("span")
  label.className = "label"
  label.setAttribute("role", "status")
  label.setAttribute("aria-live", "polite")
  const stop = document.createElement("button")
  stop.type = "button"
  stop.className = "stop"
  stop.textContent = "Parar"
  stop.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "pi:stop" }).catch(() => undefined)
  })
  pill.append(dot, label, stop)
  root.appendChild(pill)

  const cursor = document.createElement("div")
  cursor.className = "cursor snap"
  cursor.innerHTML = `<svg width="22" height="28" viewBox="0 0 18 24"><path d="M1 1 L1 18 L5 14.5 L7.5 22 L11 20.5 L8.5 13 L14 13 Z"/></svg>`
  root.appendChild(cursor)

  document.documentElement.appendChild(host)

  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let cursorTimer: ReturnType<typeof setTimeout> | undefined
  let pressTimer: ReturnType<typeof setTimeout> | undefined
  let cursorPlaced = false
  let busyActive = false

  const syncPaused = () =>
    frame.classList.toggle("paused", document.visibilityState === "hidden")
  document.addEventListener("visibilitychange", syncPaused)

  const overlayOff = (): void => {
    clearTimeout(hideTimer)
    clearTimeout(cursorTimer)
    hideTimer = undefined
    cursorTimer = undefined
    busyActive = false
    // Sem transição: capturas saem sem pegar o fade no meio.
    frame.style.transition = "none"
    pill.style.transition = "none"
    cursor.style.transition = "none"
    frame.classList.remove("on")
    pill.classList.remove("on")
    cursor.classList.remove("on")
  }

  const arm = (ms: number): void => {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(overlayOff, ms)
  }

  const showCursor = (): void => {
    cursor.classList.add("on")
    clearTimeout(cursorTimer)
    cursorTimer = setTimeout(() => cursor.classList.remove("on"), CURSOR_IDLE_MS)
  }

  const show = (text: string, busy: boolean): void => {
    const wasOn = frame.classList.contains("on")
    // Primeira aparição acende sem fade: o GIF e o print pegam o estado real.
    frame.style.transition = wasOn ? "" : "none"
    pill.style.transition = wasOn ? "" : "none"
    label.textContent = text
    dot.classList.toggle("busy", busy)
    frame.classList.add("on")
    pill.classList.add("on")
    if (!wasOn) {
      void frame.offsetWidth
      requestAnimationFrame(() => {
        frame.style.transition = ""
        pill.style.transition = ""
      })
    }
    busyActive = busy
    arm(busy ? BUSY_WATCHDOG_MS : IDLE_WATCHDOG_MS)
  }

  const clickAt = (x: number, y: number): void => {
    cursor.classList.add("press")
    clearTimeout(pressTimer)
    pressTimer = setTimeout(() => cursor.classList.remove("press"), PRESS_MS)
    const ripple = document.createElement("div")
    ripple.className = "ripple"
    ripple.style.setProperty("--x", `${x}px`)
    ripple.style.setProperty("--y", `${y}px`)
    root.appendChild(ripple)
    setTimeout(() => ripple.remove(), RIPPLE_MS + 100)
  }

  window.__piOverlay = {
    status(text, busy = false) {
      show(text, busy)
    },
    move(x, y, click = false) {
      if (!host.isConnected) document.documentElement.appendChild(host)
      frame.classList.add("on")
      pill.classList.add("on")
      // Durante uma ação o timer longo de `status(busy)` manda; aqui só quando não há.
      if (!busyActive) arm(CURSOR_IDLE_MS + IDLE_WATCHDOG_MS)
      cursor.style.transition = ""
      cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`
      if (!cursorPlaced) {
        // Primeira aparição: nasce no destino em vez de cruzar a tela desde (0, 0).
        cursorPlaced = true
        void cursor.offsetWidth
        cursor.classList.remove("snap")
      }
      showCursor()
      if (click) clickAt(x, y)
    },
    hide: overlayOff,
  }
}
