import { ensureBridge } from "./tools/a11y"

/**
 * Presença visual do agente na aba: borda animada, pílula com a ação em
 * andamento, mouse virtual. O overlay vive no content script (`overlay.ts`).
 */

/** Rótulo da pílula: o que o agente está fazendo, em pt-BR. */
export function labelFor(tool: string, args: Record<string, unknown>): string {
  const action = typeof args.action === "string" ? args.action : ""
  if (tool === "computer") {
    switch (action) {
      case "click":
        return "Clicando na página"
      case "hover":
        return "Movendo o mouse"
      case "type":
        return "Digitando"
      case "key":
        return "Pressionando tecla"
      case "scroll":
        return "Rolando a página"
      case "screenshot":
        return "Capturando a tela"
      case "zoom":
        return "Capturando uma região"
      case "wait":
        return "Aguardando"
      default:
        return "Interagindo com a página"
    }
  }
  if (tool === "navigate") {
    const url = typeof args.url === "string" ? args.url : ""
    let host = ""
    try {
      host = url ? new URL(url.includes("://") ? url : `https://${url}`).host : ""
    } catch {
      host = ""
    }
    if (host) return `Abrindo ${host}`
    return args.direction === "forward" ? "Avançando no histórico" : "Voltando no histórico"
  }
  const labels: Record<string, string> = {
    tabs_context: "Olhando as abas",
    tabs_create: "Abrindo uma aba",
    tabs_attach: "Anexando a aba ao agente",
    tabs_close: "Fechando a aba",
    read_page: "Lendo a página",
    find: "Procurando na página",
    get_page_text: "Lendo o texto da página",
    form_input: "Preenchendo o formulário",
    javascript_tool: "Executando JavaScript",
    read_console_messages: "Lendo o console",
    read_network_requests: "Lendo as requisições",
    resize_window: "Redimensionando a janela",
    update_plan: "Preparando o plano",
    upload_image: "Enviando arquivo",
    gif_creator: "Gravando GIF",
    browser_batch: "Executando ações",
    batch: "Executando ações",
  }
  return labels[tool] ?? "Trabalhando na aba"
}

/**
 * Acende a borda e escreve a ação na pílula. Sem `ensureBridge` de propósito:
 * é sinal visual, e um round trip a mais por tool custa mais do que perder o
 * overlay na primeira ação de uma aba antiga.
 */
export async function showStatus(tabId: number, text: string): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: (label: string) => {
        window.__piOverlay?.status(label, true)
      },
      args: [text],
    })
  } catch {
    // Página não injetável (chrome://, PDF, aba fechada): sem overlay, sem erro.
  }
}

/** A ação terminou: mantém a pílula por alguns segundos e apaga. */
export async function idleStatus(tabId: number, text: string): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: (label: string) => {
        window.__piOverlay?.status(label, false)
      },
      args: [text],
    })
  } catch {
    // ignore
  }
}

/**
 * Mouse virtual: desenha o ponteiro e o clique. Também traz a aba para frente,
 * senão o usuário não tem o que ver.
 */
export async function moveCursor(
  tabId: number,
  x: number,
  y: number,
  click = false,
): Promise<void> {
  try {
    await chrome.tabs.update(tabId, { active: true }).catch(() => undefined)
    await ensureBridge(tabId)
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: (px: number, py: number, doClick: boolean) => {
        window.__piOverlay?.move(px, py, doClick)
      },
      args: [x, y, click],
    })
  } catch {
    // Ponteiro é enfeite: página não injetável não falha a ação.
  }
}

/** Esconde tudo na hora: capturas para documentação saem limpas. */
export async function hideOverlay(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () => {
        window.__piOverlay?.hide()
      },
    })
  } catch {
    // ignore
  }
}
