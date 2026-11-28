/**
 * Cotas das assinaturas que uso no dia a dia: GitHub Copilot e OpenCode Go.
 *
 * Parsers e formatação puros (sem API do Pi, sem I/O), testados com fixtures em
 * `quota.test.ts`. O percentual é sempre o **usado** da janela.
 */

export interface Janela {
  id: string
  rotulo: string
  percentualUsado?: number
  usado?: number
  total?: number
  ilimitado?: boolean
  status?: string
  resetsAt?: string
}

export interface Resumo {
  id: "copilot" | "opencode-go"
  titulo: string
  curto: string
  plano?: string
  janelas: Janela[]
  resetsAt?: string
}

type Json = Record<string, unknown>

function objeto(valor: unknown): Json | undefined {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor) ? (valor as Json) : undefined
}

function numero(valor: unknown): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? valor : undefined
}

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.trim() !== "" ? valor : undefined
}

function dataValida(valor: string | undefined): string | undefined {
  return valor && Number.isFinite(Date.parse(valor)) ? valor : undefined
}

export function clampPercent(valor: number): number {
  if (!Number.isFinite(valor)) return 0
  return Math.max(0, Math.min(100, valor))
}

// --- GitHub Copilot ---------------------------------------------------------

const ROTULOS_COPILOT: Record<string, string> = {
  premium_interactions: "Premium",
  ai_credits: "Créditos",
  chat: "Chat",
  completions: "Conclusões",
}

const ORDEM_COPILOT = ["premium_interactions", "ai_credits", "chat", "completions"]

function rotuloCopilot(id: string): string {
  return ROTULOS_COPILOT[id] ?? id.replaceAll(/[_-]+/g, " ").replace(/\b\w/g, (letra) => letra.toUpperCase())
}

/** Lê `quota_snapshots` do endpoint interno do Copilot (`copilot_internal/user`). */
export function parseCopilot(corpo: unknown): Resumo | undefined {
  const raiz = objeto(corpo)
  const snapshots = raiz ? objeto(raiz.quota_snapshots) : undefined
  if (!raiz || !snapshots) return undefined

  const janelas: Janela[] = []
  for (const [id, bruto] of Object.entries(snapshots)) {
    const cota = objeto(bruto)
    if (!cota) continue
    if (cota.has_quota === false && cota.unlimited !== true) continue

    if (cota.unlimited === true) {
      janelas.push({ id, rotulo: rotuloCopilot(id), ilimitado: true })
      continue
    }

    const total = numero(cota.entitlement)
    if (total === undefined || total <= 0) continue
    const restante = numero(cota.quota_remaining) ?? numero(cota.remaining)
    const usado = numero(cota.credits_used) ?? (restante === undefined ? undefined : Math.max(0, total - restante))
    if (usado === undefined) continue

    const restantePercentual = numero(cota.percent_remaining)
    const percentualUsado =
      restantePercentual === undefined ? clampPercent((usado / total) * 100) : clampPercent(100 - restantePercentual)

    janelas.push({ id, rotulo: rotuloCopilot(id), usado, total, percentualUsado })
  }
  if (janelas.length === 0) return undefined

  janelas.sort((a, b) => {
    const ia = ORDEM_COPILOT.indexOf(a.id)
    const ib = ORDEM_COPILOT.indexOf(b.id)
    return (ia < 0 ? ORDEM_COPILOT.length : ia) - (ib < 0 ? ORDEM_COPILOT.length : ib)
  })

  const reset = texto(raiz.quota_reset_date_utc) ?? texto(raiz.quota_reset_date)
  return {
    id: "copilot",
    titulo: "Copilot",
    curto: "Copilot",
    plano: texto(raiz.copilot_plan),
    janelas,
    resetsAt: dataValida(reset),
  }
}

// --- OpenCode Go ------------------------------------------------------------

const ROTULOS_GO: Array<[key: string, rotulo: string]> = [
  ["rolling", "5h"],
  ["weekly", "7d"],
  ["monthly", "mês"],
]

/** Lê `usage.{rolling,weekly,monthly}` de `opencode.ai/zen/go/v1/usage`. */
export function parseGo(corpo: unknown): Resumo | undefined {
  const raiz = objeto(corpo)
  const usage = raiz ? objeto(raiz.usage) : undefined
  if (!usage) return undefined

  const janelas: Janela[] = []
  for (const [chave, rotulo] of ROTULOS_GO) {
    const janela = objeto(usage[chave])
    if (!janela) continue
    const percentual = numero(janela.percent)
    janelas.push({
      id: chave,
      rotulo,
      status: texto(janela.status),
      percentualUsado: percentual === undefined ? undefined : clampPercent(percentual),
      resetsAt: dataValida(texto(janela.resetsAt)),
    })
  }
  return janelas.length === 0 ? undefined : { id: "opencode-go", titulo: "OpenCode Go", curto: "Go", janelas }
}

// --- Formatação -------------------------------------------------------------

/** Segundos até `resetsAt` (NaN quando ausente/inválido; nunca negativo). */
export function segundosAte(resetsAt: string | undefined, agora = Date.now()): number {
  if (!resetsAt) return Number.NaN
  const alvo = Date.parse(resetsAt)
  return Number.isFinite(alvo) ? Math.max(0, (alvo - agora) / 1000) : Number.NaN
}

/** Contagem regressiva compacta: `2d3h` | `4h10m` | `45m` | `30s` | `—`. */
export function formatarEspera(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 0) return "—"
  const total = Math.round(segundos)
  const minutos = Math.floor(total / 60)
  const horas = Math.floor(minutos / 60)
  const dias = Math.floor(horas / 24)
  if (dias >= 1) return horas % 24 ? `${dias}d${horas % 24}h` : `${dias}d`
  if (horas >= 1) return minutos % 60 ? `${horas}h${minutos % 60}m` : `${horas}h`
  if (minutos >= 1) return `${minutos}m`
  return `${total}s`
}

function detalheJanela(janela: Janela): string {
  if (janela.ilimitado) return `${janela.rotulo} ilimitado`
  if (janela.percentualUsado === undefined) return `${janela.rotulo} —`
  const valores =
    janela.usado !== undefined && janela.total !== undefined ? ` (${janela.usado}/${janela.total})` : ""
  return `${janela.rotulo} ${Math.round(janela.percentualUsado)}%${valores}`
}

/** Linhas do painel para um resumo (título + janelas + quando renova). */
export function formatarResumo(resumo: Resumo, agora = Date.now()): string[] {
  const titulo = resumo.plano ? `${resumo.titulo} (${resumo.plano})` : resumo.titulo
  const linhas = [`${titulo}: ${resumo.janelas.map(detalheJanela).join(" · ")}`]
  const espera = formatarEspera(segundosAte(resumo.resetsAt, agora))
  if (espera !== "—") linhas.push(`  renova em ${espera}`)
  return linhas
}

/** Linha compacta para o rodapé: `Copilot 75% · Go 12%` (primeira janela medida). */
export function formatarStatus(resumos: Resumo[]): string {
  const partes: string[] = []
  for (const resumo of resumos) {
    const principal = resumo.janelas.find((janela) => !janela.ilimitado && janela.percentualUsado !== undefined)
    if (!principal) continue
    partes.push(`${resumo.curto} ${Math.round(principal.percentualUsado!)}%`)
  }
  return partes.join(" · ")
}
