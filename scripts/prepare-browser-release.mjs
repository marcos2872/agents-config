import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const REPOSITORY = "marcos2872/opencode-browser-extension"
const API_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`
const ASSET_NAME = "opencode-browser-extension.zip"
const MAX_ASSET_BYTES = 50 * 1024 * 1024
const USER_AGENT = "agents-config-sync"

function homeDirectory() {
  return process.env.HOME || process.env.USERPROFILE || homedir()
}

function dataHome() {
  return process.env.XDG_DATA_HOME?.trim() || path.join(homeDirectory(), ".local", "share")
}

function cacheHome() {
  return process.env.XDG_CACHE_HOME?.trim() || path.join(homeDirectory(), ".cache")
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function verifyPackage(packageRoot, tag, digest) {
  const marker = path.join(path.dirname(packageRoot), ".release-sha256")
  if (!existsSync(marker) || readFileSync(marker, "utf8").trim() !== `sha256:${digest}`) {
    throw new Error(`O diretório da release ${tag} não confere com o digest esperado: ${marker}`)
  }

  const manifestPath = path.join(packageRoot, "extension", "manifest.json")
  const required = [
    manifestPath,
    path.join(packageRoot, "plugin", "browser-relay.ts"),
    path.join(packageRoot, "plugin", "opencode-browser.agent.md"),
    path.join(packageRoot, "scripts", "install-plugin.mjs"),
    path.join(packageRoot, "scripts", "lib", "opencode-paths.mjs"),
  ]
  for (const file of required) {
    if (!existsSync(file)) throw new Error(`O pacote da release está incompleto: ${file}`)
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const expectedVersion = tag.replace(/^v/, "")
  if (manifest.version !== expectedVersion) {
    throw new Error(`A extensão no pacote é v${manifest.version}, mas a release é ${tag}.`)
  }

  const agentPath = path.join(packageRoot, "plugin", "opencode-browser.agent.md")
  const agentText = readFileSync(agentPath, "utf8")
  const agentMarker = /<!--\s*opencode-browser-agent v(\d+)\s*-->/.exec(agentText)
  if (!agentMarker) throw new Error("O template da release não tem marcador de versão do agente.")
  const skillPath = path.join(packageRoot, "plugin", "skills", "browser-relay", "SKILL.md")
  if (Number(agentMarker[1]) >= 6 && !existsSync(skillPath)) {
    throw new Error(`O template do agente v${agentMarker[1]} exige a skill browser-relay, mas ela não está no pacote.`)
  }
}

function extractZip(archive, destination) {
  const windows = process.platform === "win32"
  const command = windows ? "powershell.exe" : "unzip"
  const args = windows
    ? [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Expand-Archive -LiteralPath $env:OPENCODE_BROWSER_ARCHIVE -DestinationPath $env:OPENCODE_BROWSER_STAGE -Force",
      ]
    : ["-q", archive, "-d", destination]
  const env = windows
    ? {
        ...process.env,
        OPENCODE_BROWSER_ARCHIVE: archive,
        OPENCODE_BROWSER_STAGE: destination,
      }
    : process.env

  const result = spawnSync(command, args, { encoding: "utf8", env })
  if (result.error) {
    throw new Error(`Não foi possível extrair o ZIP (${command}): ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`A extração do pacote falhou (${command}): ${(result.stderr || "").trim()}`)
  }
}

async function latestRelease() {
  const response = await fetch(API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`GitHub Releases respondeu HTTP ${response.status}.`)

  const release = await response.json()
  const tag = typeof release.tag_name === "string" ? release.tag_name : ""
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error("A release estável do OpenCode Browser tem um tag inválido.")
  }

  const asset = release.assets?.find((item) => item.name === ASSET_NAME)
  if (!asset || typeof asset.browser_download_url !== "string") {
    throw new Error(`A release ${tag} não contém ${ASSET_NAME}.`)
  }
  const downloadUrl = new URL(asset.browser_download_url)
  if (
    downloadUrl.hostname !== "github.com" ||
    downloadUrl.pathname !== `/${REPOSITORY}/releases/download/${tag}/${ASSET_NAME}`
  ) {
    throw new Error("A URL do asset da release aponta para um endereço inesperado.")
  }
  const match = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest ?? "")
  if (!match) throw new Error(`A release ${tag} não publicou um digest SHA-256 válido.`)
  if (typeof asset.size !== "number" || asset.size <= 0 || asset.size > MAX_ASSET_BYTES) {
    throw new Error(`O tamanho declarado do pacote ${ASSET_NAME} é inválido.`)
  }

  return {
    tag,
    url: downloadUrl.href,
    digest: match[1].toLowerCase(),
    assetSize: asset.size,
  }
}

async function downloadAsset(url, expectedSize, digest) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`O download do pacote respondeu HTTP ${response.status}.`)

  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length !== expectedSize) {
    throw new Error(`O pacote baixado tem ${bytes.length} bytes; eram esperados ${expectedSize}.`)
  }
  const actual = sha256(bytes)
  if (actual !== digest) throw new Error(`Digest SHA-256 incorreto: esperado ${digest}, recebido ${actual}.`)
  return bytes
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 20) {
    throw new Error("A instalação da extensão requer Node.js 20 ou mais recente.")
  }

  const release = await latestRelease()
  const dataRoot = path.join(dataHome(), "opencode-browser-extension")
  const cacheRoot = path.join(cacheHome(), "opencode-browser-extension", "releases")
  const releaseKey = `${release.tag}-${release.digest.slice(0, 12)}`
  const releaseDir = path.join(dataRoot, releaseKey)
  const packageRoot = path.join(releaseDir, "opencode-browser")
  const archive = path.join(cacheRoot, `${releaseKey}.zip`)

  mkdirSync(dataRoot, { recursive: true })
  mkdirSync(cacheRoot, { recursive: true })

  if (existsSync(releaseDir)) {
    verifyPackage(packageRoot, release.tag, release.digest)
    console.log(packageRoot)
    return
  }

  let bytes
  if (existsSync(archive)) {
    const cached = readFileSync(archive)
    if (sha256(cached) === release.digest) bytes = cached
    else rmSync(archive, { force: true })
  }
  if (!bytes) bytes = await downloadAsset(release.url, release.assetSize, release.digest)

  if (!existsSync(archive)) {
    const temporaryArchive = `${archive}.tmp-${process.pid}`
    writeFileSync(temporaryArchive, bytes, { flag: "wx", mode: 0o600 })
    renameSync(temporaryArchive, archive)
  }

  const staging = mkdtempSync(path.join(dataRoot, ".staging-"))
  try {
    extractZip(archive, staging)
    const stagedPackage = path.join(staging, "opencode-browser")
    writeFileSync(path.join(staging, ".release-sha256"), `sha256:${release.digest}\n`, "utf8")
    verifyPackage(stagedPackage, release.tag, release.digest)
    renameSync(staging, releaseDir)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }

  console.log(packageRoot)
}

main().catch((error) => {
  console.error(`Não foi possível preparar a release do OpenCode Browser: ${error.message}`)
  process.exitCode = 1
})
