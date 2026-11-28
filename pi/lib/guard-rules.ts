/**
 * Regras do `guard`: bloqueia as ações que o perfil antigo do OpenCode negava.
 *
 * São regras puras (sem API do Pi) para poderem ser testadas com `node --test`.
 * Elas rodam em todo `bash`/`powershell` e em `read`/`write`/`edit`; não são uma
 * sandbox — a proteção real é rodar o Pi com um usuário ou container restrito.
 */

export type Blocked = { block: true; reason: string }

const SEPARADORES = /\n|[;&|()]/
const PREFIXOS = new Set(["env", "command", "nohup", "time", "exec"])

/** Divide o comando em segmentos independentes (`a && b | c`) e remove prefixos comuns. */
function palavras(segmento: string): string[] {
  const lista = segmento.trim().split(/\s+/).filter(Boolean)
  while (lista.length > 0) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(lista[0])) {
      lista.shift()
      continue
    }
    if (PREFIXOS.has(lista[0])) {
      lista.shift()
      continue
    }
    break
  }
  return lista
}

function segmentos(comando: string): string[][] {
  return comando.split(SEPARADORES).map(palavras).filter((p) => p.length > 0)
}

function bandeiras(args: string[]): string {
  return args.filter((arg) => arg.startsWith("-")).join("")
}

function alvos(args: string[]): string[] {
  return args.filter((arg) => !arg.startsWith("-"))
}

function ehPushForcado(args: string[]): boolean {
  const forcado = args.some((arg) => arg === "--force" || /^-[A-Za-z]*f/.test(arg))
  return forcado
}

export function bloqueioDeComando(comando: string): Blocked | undefined {
  for (const args of segmentos(comando)) {
    if (args[0] === "sudo") {
      return { block: true, reason: "`sudo` é bloqueado pelo guard. Use o helper privilegiado do projeto." }
    }

    if (args[0] === "rm") {
      const flags = bandeiras(args)
      const recursivo = flags.includes("r") || flags.includes("R")
      const forcado = flags.includes("f")
      const semPreservar = args.includes("--no-preserve-root")
      const raiz = alvos(args).some((alvo) => alvo === "/" || alvo === "/*")
      if (semPreservar || (recursivo && forcado && raiz)) {
        return { block: true, reason: "Apagar a raiz do sistema é bloqueado pelo guard." }
      }
    }

    if (args[0] === "git" && args[1] === "push" && ehPushForcado(args.slice(2))) {
      return {
        block: true,
        reason: "`git push` forçado é bloqueado pelo guard. Se precisar, faça manualmente fora do agente.",
      }
    }
  }
  return undefined
}

export function bloqueioDeCaminho(caminho: string): Blocked | undefined {
  const normalizado = caminho.replace(/\\/g, "/")
  const nome = normalizado.split("/").filter(Boolean).pop() ?? ""
  // Arquivos de modelo só documentam as chaves, não guardam valores.
  const modeloDeEnv = /\.env\.(example|sample|template|dist)$/.test(nome)
  const segredoDeEnv = (nome === ".env" || nome.startsWith(".env.")) && !modeloDeEnv
  const chaveSsh = /(^|\/)\.ssh(\/|$)/.test(normalizado)
  if (segredoDeEnv || chaveSsh) {
    return { block: true, reason: `\`${caminho}\` guarda credenciais e é bloqueado pelo guard.` }
  }
  return undefined
}
