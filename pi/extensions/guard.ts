import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { bloqueioDeCaminho, bloqueioDeComando } from "../lib/guard-rules.ts"

const FERRAMENTAS_DE_SHELL = new Set(["bash", "powershell"])
const FERRAMENTAS_DE_ARQUIVO = new Set(["read", "write", "edit"])

/** Aplica as regras de `lib/guard-rules.ts`; roda em toda chamada de ferramenta. */
export default function (pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    const entrada = event.input as Record<string, unknown>

    if (FERRAMENTAS_DE_SHELL.has(event.toolName) && typeof entrada.command === "string") {
      return bloqueioDeComando(entrada.command)
    }

    if (FERRAMENTAS_DE_ARQUIVO.has(event.toolName) && typeof entrada.path === "string") {
      return bloqueioDeCaminho(entrada.path)
    }

    return undefined
  })
}
