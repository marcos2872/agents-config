/**
 * Política de foco da extensão.
 *
 * Sem UI de configuração: as actions do agente nunca ativam abas/janelas por
 * padrão, para não interromper o usuário. Quem quiser ver o navegador sendo
 * conduzido pode ativar manualmente a aba.
 */
export async function shouldBringTabsToFront(): Promise<boolean> {
  return false
}

/**
 * Coloca a aba em primeiro plano **somente** quando permitido (nunca, por
 * padrão). Devolve `true` quando a aba ficou ativa de fato.
 */
export async function activateTab(tabId: number, reason: string): Promise<boolean> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  if (!tab) return false
  if (tab.active) return true
  console.debug(`[foco] aba ${tabId} não foi ativada (${reason})`)
  return false
}
