import assert from "node:assert/strict"
import { test } from "node:test"
import { formatarEspera, formatarResumo, formatarStatus, parseCopilot, parseGo, segundosAte } from "./quota.ts"

test("Copilot: quotas medidas, ilimitadas, plano e reset", () => {
  const resumo = parseCopilot({
    copilot_plan: "business",
    quota_reset_date_utc: "2026-12-01T00:00:00.000Z",
    quota_snapshots: {
      chat: { unlimited: true, has_quota: false },
      premium_interactions: { entitlement: 300, remaining: 75, percent_remaining: 25, has_quota: true },
      completions: { entitlement: 0, remaining: 0, unlimited: true },
    },
  })

  assert.deepEqual(resumo, {
    id: "copilot",
    titulo: "Copilot",
    curto: "Copilot",
    plano: "business",
    resetsAt: "2026-12-01T00:00:00.000Z",
    janelas: [
      { id: "premium_interactions", rotulo: "Premium", usado: 225, total: 300, percentualUsado: 75 },
      { id: "chat", rotulo: "Chat", ilimitado: true },
      { id: "completions", rotulo: "Conclusões", ilimitado: true },
    ],
  })
})

test("Copilot: calcula o usado quando falta percent_remaining e ignora cota sem limite", () => {
  const resumo = parseCopilot({
    quota_snapshots: {
      premium_interactions: { entitlement: 100, quota_remaining: 40 },
      chat: { entitlement: 0, remaining: 0, has_quota: false },
    },
  })

  assert.deepEqual(resumo?.janelas, [
    { id: "premium_interactions", rotulo: "Premium", usado: 60, total: 100, percentualUsado: 60 },
  ])
})

test("Copilot: corpo sem snapshots ou sem cota exibível vira undefined", () => {
  assert.equal(parseCopilot({}), undefined)
  assert.equal(parseCopilot({ quota_snapshots: { chat: { has_quota: false } } }), undefined)
  assert.equal(parseCopilot(null), undefined)
})

test("OpenCode Go: lê as três janelas, ignora percentual inválido e aceita reset inválido", () => {
  const resumo = parseGo({
    usage: {
      rolling: { status: "ok", percent: 12.4, resetsAt: "2026-11-28T12:00:00.000Z" },
      weekly: { status: "ok", percent: 140 },
      monthly: { status: "exhausted", percent: "n/a", resetsAt: "amanhã" },
    },
  })

  assert.deepEqual(resumo, {
    id: "opencode-go",
    titulo: "OpenCode Go",
    curto: "Go",
    janelas: [
      { id: "rolling", rotulo: "5h", status: "ok", percentualUsado: 12.4, resetsAt: "2026-11-28T12:00:00.000Z", destaque: false },
      { id: "weekly", rotulo: "7d", status: "ok", percentualUsado: 100, resetsAt: undefined, destaque: false },
      { id: "monthly", rotulo: "mês", status: "exhausted", percentualUsado: undefined, resetsAt: undefined, destaque: true },
    ],
  })
})

test("formatarResumo: título com plano, valores e renovação", () => {
  const agora = Date.parse("2026-11-28T00:00:00.000Z")
  const linhas = formatarResumo(
    {
      id: "copilot",
      titulo: "Copilot",
      curto: "Copilot",
      plano: "business",
      resetsAt: "2026-12-01T03:00:00.000Z",
      janelas: [
        { id: "premium_interactions", rotulo: "Premium", usado: 225, total: 300, percentualUsado: 75 },
        { id: "chat", rotulo: "Chat", ilimitado: true },
      ],
    },
    agora,
  )

  assert.deepEqual(linhas, ["Copilot (business): Premium 75% (225/300) renova em 3d3h"])
})

test("formatarResumo: janela ilimitada não aparece; só ilimitadas viram 'ilimitado'", () => {
  const soIlimitadas = formatarResumo({
    id: "copilot",
    titulo: "Copilot",
    curto: "Copilot",
    janelas: [{ id: "chat", rotulo: "Chat", ilimitado: true }],
  })
  assert.equal(soIlimitadas[0], "Copilot: ilimitado")
})

test("formatarStatus: uma janela vira percentual, várias usam o rótulo real", () => {
  const go = formatarStatus([
    {
      id: "opencode-go",
      titulo: "OpenCode Go",
      curto: "Go",
      janelas: [
        { id: "rolling", rotulo: "5h", percentualUsado: 12 },
        { id: "weekly", rotulo: "7d", percentualUsado: 40 },
        { id: "monthly", rotulo: "mês", percentualUsado: undefined },
      ],
    },
  ])
  assert.equal(go, "Go 5h:12% 7d:40% mês:—")

  const copilot = formatarStatus([
    {
      id: "copilot",
      titulo: "Copilot",
      curto: "Copilot",
      janelas: [{ id: "premium_interactions", rotulo: "Premium", percentualUsado: 80 }],
    },
  ])
  assert.equal(copilot, "Copilot 80%")
  assert.equal(formatarStatus([]), "")
})

test("espera: formatos compactos e ausência", () => {
  assert.equal(formatarEspera(2 * 86400 + 3 * 3600), "2d3h")
  assert.equal(formatarEspera(4 * 3600 + 10 * 60), "4h10m")
  assert.equal(formatarEspera(45 * 60), "45m")
  assert.equal(formatarEspera(30), "30s")
  assert.equal(formatarEspera(Number.NaN), "—")
  assert.equal(segundosAte(undefined), Number.NaN)
  assert.equal(segundosAte("26/11/2026"), Number.NaN)
  assert.equal(segundosAte(new Date(0).toISOString(), 0), 0)
})

test("formatarResumo: janela do Go mostra a contagem até o próprio reset", () => {
  const agora = Date.parse("2026-11-28T14:00:00.000Z")
  const [linha] = formatarResumo(
    {
      id: "opencode-go",
      titulo: "OpenCode Go",
      curto: "Go",
      janelas: [
        { id: "rolling", rotulo: "5h", percentualUsado: 4, resetsAt: "2026-11-28T15:50:37.000Z" },
        { id: "weekly", rotulo: "7d", percentualUsado: 25, resetsAt: "2026-11-30T00:00:00.000Z" },
        { id: "monthly", rotulo: "mês", percentualUsado: 66, resetsAt: "2026-12-02T19:04:41.000Z" },
      ],
    },
    agora,
  )
  assert.equal(linha, "OpenCode Go: 5h 4% (1h50m) · 7d 25% (1d10h) · mês 66% (4d5h)")
})

test("formatarStatus: rodapé do Go mostra só a janela mensal", () => {
  const resumo = parseGo({
    usage: {
      rolling: { status: "ok", percent: 4, resetsAt: "2026-11-28T15:50:37.000Z" },
      weekly: { status: "ok", percent: 25, resetsAt: "2026-11-30T00:00:00.000Z" },
      monthly: { status: "ok", percent: 66, resetsAt: "2026-12-02T19:04:41.000Z" },
    },
  })
  assert.ok(resumo)
  assert.equal(formatarStatus([resumo]), "Go 66%")
})
