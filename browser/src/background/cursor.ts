import { ensureBridge } from "./tools/a11y"

/**
 * Mouse virtual: desenha o ponteiro na página (o overlay vive no content
 * script). Também traz a aba para frente, senão o usuário não tem o que ver.
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
        window.__piCursor?.move(px, py, doClick)
      },
      args: [x, y, click],
    })
  } catch {
    // Ponteiro é enfeite: página não injetável (chrome://, PDF) não falha a ação.
  }
}

/** Esconde o ponteiro: capturas para documentação saem sem o cursor em cima. */
export async function hideCursor(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () => {
        window.__piCursor?.hide()
      },
    })
  } catch {
    // ignore
  }
}
