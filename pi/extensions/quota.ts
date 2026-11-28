/**
 * Cotas do dia a dia: GitHub Copilot e OpenCode Go.
 *
 * Lê as credenciais do `auth.json` do Pi (só leitura), consulta os endpoints de
 * uso e mostra o resultado no rodapé e no painel de `/cota`. Nada entra no
 * contexto do modelo.
 *
 * Os endpoints não são públicos; por isso qualquer falha é tratada como aviso e
 * o último valor bom continua no rodapé.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent"
import { formatarResumo, formatarStatus, parseCopilot, parseGo, type Resumo } from "../lib/quota.ts"

const INTERVALO_MS = 10 * 60 * 1000
const TIMEOUT_MS = 15_000
const URL_COPILOT = "https://api.github.com/copilot_internal/user"
const URL_GO = "https://opencode.ai/zen/go/v1/usage"

type Credenciais = { github?: string; go?: string }

/** O token do GitHub fica em `refresh`; `access` é o token curto do Copilot. */
function lerCredenciais(): Credenciais {
  try {
    const auth = JSON.parse(readFileSync(join(getAgentDir(), "auth.json"), "utf8")) as Record<
      string,
      Record<string, unknown>
    >
    const copilot = auth["github-copilot"] ?? {}
    const go = auth["opencode-go"] ?? {}
    const github = [copilot.refresh, copilot.access].find((valor): valor is string => typeof valor === "string")
    return { github, go: typeof go.key === "string" ? go.key : undefined }
  } catch {
    return {}
  }
}

async function buscar(url: string, headers: Record<string, string>): Promise<unknown> {
  const resposta = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`)
  return resposta.json()
}

type Consulta = { resumos: Resumo[]; falhas: string[] }

async function consultar(): Promise<Consulta> {
  const { github, go } = lerCredenciais()
  const resumos: Resumo[] = []
  const falhas: string[] = []

  if (github) {
    try {
      const resumo = parseCopilot(
        await buscar(URL_COPILOT, {
          authorization: `token ${github}`,
          "editor-version": "vscode/1.96.2",
          "editor-plugin-version": "copilot-chat/0.26.7",
          "x-github-api-version": "2025-04-01",
        }),
      )
      if (resumo) resumos.push(resumo)
    } catch (erro) {
      falhas.push(`Copilot: ${erro instanceof Error ? erro.message : String(erro)}`)
    }
  }

  if (go) {
    try {
      const resumo = parseGo(await buscar(URL_GO, { authorization: `Bearer ${go}`, accept: "application/json" }))
      if (resumo) resumos.push(resumo)
    } catch (erro) {
      falhas.push(`OpenCode Go: ${erro instanceof Error ? erro.message : String(erro)}`)
    }
  }

  return { resumos, falhas }
}

export default function (pi: ExtensionAPI) {
  let resumos: Resumo[] = []
  let falhas: string[] = []
  let emAndamento = false
  let timer: ReturnType<typeof setInterval> | undefined

  async function atualizar(ctx: ExtensionContext) {
    if (emAndamento) return
    emAndamento = true
    try {
      const consulta = await consultar()
      if (consulta.resumos.length > 0) resumos = consulta.resumos
      falhas = consulta.falhas
      if (ctx.hasUI) {
        const linha = formatarStatus(resumos)
        if (linha) ctx.ui.setStatus("cota", linha)
      }
    } finally {
      emAndamento = false
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    if (timer) clearInterval(timer)
    await atualizar(ctx)
    timer = setInterval(() => void atualizar(ctx), INTERVALO_MS)
  })

  pi.on("session_shutdown", () => {
    if (timer) clearInterval(timer)
    timer = undefined
  })

  pi.registerCommand("cota", {
    description: "Mostra as cotas do GitHub Copilot e do OpenCode Go (/cota fechar fecha o painel)",
    handler: async (args, ctx) => {
      const argumento = args.trim().toLowerCase()

      if (argumento === "fechar" || argumento === "close") {
        if (ctx.hasUI) ctx.ui.setWidget("cota", undefined)
        else process.stdout.write("Painel da cota não está aberto.\n")
        return
      }

      await atualizar(ctx)

      const selecionados = resumos.filter(
        (resumo) => !argumento || resumo.id === argumento || resumo.titulo.toLowerCase().includes(argumento),
      )

      // Arrow: flatMap passa o índice como segundo argumento (e ele viraria `agora`).
      const linhas = selecionados.flatMap((resumo) => formatarResumo(resumo))
      const avisos = falhas.map((falha) => `aviso: ${falha}`)
      if (linhas.length === 0 && avisos.length === 0) {
        linhas.push("Sem credencial de Copilot ou OpenCode Go no auth.json (ou cota indisponível).")
      }
      if (falhas.length > 0 && selecionados.length === 0 && resumos.length > 0) {
        linhas.push(...resumos.flatMap((resumo) => formatarResumo(resumo)), "  (valores antigos; a consulta falhou)")
      }

      const saida = [...linhas, ...avisos]
      if (ctx.hasUI) {
        ctx.ui.setWidget("cota", saida)
        if (avisos.length > 0) ctx.ui.notify(avisos.join(" · "), "warning")
      } else {
        const fluxo = ctx.mode === "json" ? process.stderr : process.stdout
        fluxo.write(`${saida.join("\n")}\n`)
      }
    },
  })
}
