import { en } from "./en"

/**
 * `t()` somente-inglês para esta extensão sem UI. Os módulos do núcleo chamam
 * `t("chave", params)`; aqui resolvemos direto no catálogo inglês, sem locale
 * nem `chrome.storage`. O que o modelo lê é inglês fixo por convenção.
 */
export function t(key: string, params?: unknown): string {
  const value = (en as Record<string, unknown>)[key]
  if (typeof value === "function") {
    return (value as (p: unknown) => string)(params)
  }
  if (typeof value === "string") return value
  return key
}

export function loadLocale(): Promise<string> {
  return Promise.resolve("en")
}

export function watchLocalePreference(): void {}
