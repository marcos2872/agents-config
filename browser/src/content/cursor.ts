/**
 * Mouse virtual: ponteiro e onda de clique desenhados na própria página, para o
 * usuário acompanhar onde o agente está agindo. Só no frame principal, acima de
 * tudo e sem capturar eventos (pointer-events: none).
 *
 * A API fica em `window.__piCursor` no mundo isolado do content script; o
 * background a chama por `chrome.scripting.executeScript` (ver cursor.ts).
 */
export interface CursorApi {
  move: (x: number, y: number, click?: boolean) => void
  hide: () => void
}

declare global {
  interface Window {
    __piCursor?: CursorApi
  }
}

const HOST_ID = "__pi-cursor-overlay"
const POINTER_OFFSET = 2

function build(): CursorApi {
  const host = document.createElement("div")
  host.id = HOST_ID
  host.setAttribute("aria-hidden", "true")
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647"
  const root = host.attachShadow({ mode: "open" })
  // Ponteiro branco com contorno escuro: visível em página clara e escura.
  root.innerHTML = `
<style>
  .pointer{position:fixed;left:0;top:0;width:22px;height:22px;opacity:0;
    transition:transform .16s ease-out,opacity .12s linear;
    filter:drop-shadow(0 1px 2px rgba(0,0,0,.55))}
  .pointer.on{opacity:1}
  .ripple{position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;
    border-radius:50%;border:2px solid #ff7a45;opacity:0}
</style>
<svg class="pointer" viewBox="0 0 22 22">
  <path d="M2 1.5 19 12l-7.6 1.6L8 21z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/>
</svg>
<div class="ripple"></div>`
  const pointer = root.querySelector<SVGElement>(".pointer")
  const ripple = root.querySelector<HTMLElement>(".ripple")
  if (!pointer || !ripple) throw new Error("cursor overlay markup missing")
  document.documentElement.appendChild(host)

  return {
    move(x, y, click = false) {
      if (!host.isConnected) document.documentElement.appendChild(host)
      pointer.style.transition = ""
      pointer.style.transform = `translate(${x - POINTER_OFFSET}px, ${y - POINTER_OFFSET}px)`
      pointer.classList.add("on")
      if (!click) return
      ripple.style.left = `${x}px`
      ripple.style.top = `${y}px`
      ripple.animate(
        [
          { opacity: 0.9, transform: "scale(.35)" },
          { opacity: 0, transform: "scale(1.5)" },
        ],
        { duration: 420, easing: "ease-out" },
      )
    },
    hide() {
      // Sem transição: a captura sai logo depois e pegaria o ponteiro no meio do fade.
      pointer.style.transition = "none"
      pointer.classList.remove("on")
    },
  }
}

export function installCursor(): void {
  if (window.top !== window) return
  if (window.__piCursor) return
  if (!document.documentElement) {
    document.addEventListener("DOMContentLoaded", () => installCursor(), { once: true })
    return
  }
  window.__piCursor = build()
}
