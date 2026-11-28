#Requires -Version 5.1
<#
.SYNOPSIS
    Instala este repo como pacote do Pi e garante as dependências globais no Windows.

.DESCRIPTION
    O pacote é carregado no lugar, sem cópia: depois de um `git pull`, basta
    `/reload` numa sessão aberta (ou abrir o Pi de novo). Rode o sync de novo só
    quando este script, o pacote ou o ai-memory mudarem.

    Depois de instalar o pacote, garante o ponytail, a extensão de perguntas, o MCP context7 e o
    ai-memory (binário oficial, serviço do usuário em 127.0.0.1:49375 e
    integração do Pi). Tudo é idempotente.

.PARAMETER AgentDir
    Agent dir do Pi. Padrão: $env:PI_CODING_AGENT_DIR ou ~\.pi\agent.

.EXAMPLE
    .\sync.ps1

.EXAMPLE
    .\sync.ps1 -AgentDir C:\pi\agent
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$AgentDir
)

$ErrorActionPreference = 'Stop'
try {
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
}
catch {
    # Console legado sem suporte a UTF-8: segue com a codificação padrão.
}

$Root = $PSScriptRoot
if (-not $AgentDir) {
    if ($env:PI_CODING_AGENT_DIR) {
        $AgentDir = $env:PI_CODING_AGENT_DIR
    }
    else {
        $AgentDir = Join-Path $HOME '.pi\agent'
    }
}
$AgentDir = [IO.Path]::GetFullPath($AgentDir)

if (-not (Test-Path -LiteralPath (Join-Path $Root 'package.json') -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $Root 'pi\skills') -PathType Container)) {
    throw "pacote incompleto em $Root (falta package.json ou pi\skills)"
}

$Pi = Get-Command pi -ErrorAction SilentlyContinue
if (-not $Pi) { throw "comando 'pi' não encontrado no PATH" }

function Invoke-Pi {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    & $Pi.Source --agent-dir $AgentDir @Arguments
    if ($LASTEXITCODE -ne 0) { throw "pi $($Arguments -join ' ') falhou" }
}

Write-Host "-> pacote: instalando $Root"
Invoke-Pi install $Root

Write-Host '-> ponytail: garantindo @dietrichgebert/ponytail'
Invoke-Pi install 'npm:@dietrichgebert/ponytail'

Write-Host '-> question: garantindo @juicesharp/rpiv-ask-user-question'
Invoke-Pi install 'npm:@juicesharp/rpiv-ask-user-question'

# O diálogo recolhe com Ctrl+] (shift no teclado ABNT); alt+o é o que usamos.
# O pacote só lê o arquivo, então ele é criado aqui — sem sobrescrever o do usuário.
$QuestionConfig = if ($env:XDG_CONFIG_HOME) {
    Join-Path $env:XDG_CONFIG_HOME 'rpiv-ask-user-question/config.json'
} else {
    Join-Path $HOME '.config/rpiv-ask-user-question/config.json'
}
if (-not (Test-Path -LiteralPath $QuestionConfig)) {
    Write-Host "-> question: gravando $QuestionConfig (collapseKey alt+o)"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $QuestionConfig) | Out-Null
    # ascii: o JSON é só `collapseKey`/`alt+o`, e o `utf8` do PowerShell 5.1 grava BOM,
    # que o JSON.parse do pacote não remove (a config seria ignorada).
    Set-Content -LiteralPath $QuestionConfig -Value "{`n  `"collapseKey`": `"alt+o`"`n}" -Encoding ascii
}

# Pacote local que sumiu deixa o settings.json apontando para um caminho inválido.
$packages = & $Pi.Source --agent-dir $AgentDir list 2>$null
foreach ($line in $packages) {
    if ($line -match '^\s{4}(/.+|[A-Za-z]:\\.+)$') {
        $declared = $Matches[1]
        if (-not (Test-Path -LiteralPath $declared)) {
            Write-Host "aviso: pacote declarado não existe mais: $declared (remova com: pi remove $declared)"
        }
    }
}

Write-Host '-> mcp: garantindo context7'
Invoke-Pi mcp add context7 --url https://mcp.context7.com/mcp

# --- ai-memory ---------------------------------------------------------------
$AiMemoryPort = if ($env:AI_MEMORY_PORT) { $env:AI_MEMORY_PORT } else { '49375' }
$AiMemoryDataDir = if ($env:AI_MEMORY_DATA_DIR) { $env:AI_MEMORY_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'ai-memory' }
$AiMemoryConfig = Join-Path $AiMemoryDataDir 'config.toml'

function Get-AiMemoryExe {
    $command = Get-Command ai-memory -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $candidate = Join-Path $env:LOCALAPPDATA 'Programs\ai-memory\ai-memory.exe'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    return $null
}

$AiMemoryExe = Get-AiMemoryExe
if (-not $AiMemoryExe) {
    Write-Host '-> ai-memory: baixando o release oficial (binário não encontrado)'
    $installerUrl = 'https://github.com/akitaonrails/ai-memory/releases/latest/download/install.ps1'
    $installer = (Invoke-WebRequest -Uri $installerUrl -UseBasicParsing).Content
    Invoke-Expression $installer
    $AiMemoryExe = Get-AiMemoryExe
}
if (-not $AiMemoryExe) {
    throw 'ai-memory não ficou disponível após a instalação'
}

$created = $false
if (-not (Test-Path -LiteralPath $AiMemoryConfig -PathType Leaf)) {
    Write-Host "-> ai-memory: inicializando $AiMemoryDataDir"
    & $AiMemoryExe init | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'ai-memory init falhou' }
    $created = $true
}

# Instalação nova: fixa a porta 49375 e o idioma pt-BR no config gerado.
if ($created) {
    $text = [IO.File]::ReadAllText($AiMemoryConfig)
    if ($text -match '(?m)^\s*bind\s*=') {
        $text = [Text.RegularExpressions.Regex]::Replace(
            $text, '(?m)^\s*bind\s*=.*$', "bind = `"127.0.0.1:$AiMemoryPort`"")
    }
    else {
        $text = $text.TrimEnd() + "`nbind = `"127.0.0.1:$AiMemoryPort`"`n"
    }
    if ($text -match '(?m)^\s*language\s*=') {
        $text = [Text.RegularExpressions.Regex]::Replace(
            $text, '(?m)^\s*language\s*=.*$', 'language = "pt-BR"')
    }
    else {
        $text = $text.TrimEnd() + "`nlanguage = `"pt-BR`"`n"
    }
    [IO.File]::WriteAllText($AiMemoryConfig, $text, (New-Object Text.UTF8Encoding($false)))
}

Write-Host '-> ai-memory: aplicando serviço e integração do Pi (extensão + MCP)'
$env:PI_CODING_AGENT_DIR = $AgentDir
& $AiMemoryExe setup --yes --agent pi
if ($LASTEXITCODE -ne 0) { throw 'ai-memory setup falhou (veja as mensagens acima)' }

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$AiMemoryPort/healthz" -TimeoutSec 10
}
catch {
    throw "ai-memory não respondeu em http://127.0.0.1:$AiMemoryPort/healthz"
}
if ($health.status -ne 'ok') {
    throw "ai-memory respondeu status '$($health.status)' em http://127.0.0.1:$AiMemoryPort/healthz"
}
Write-Host "-> ai-memory: ok (http://127.0.0.1:$AiMemoryPort)"

Write-Host ''
Write-Host 'Sync concluído:'
Write-Host "  pacote:    $Root"
Write-Host "  agent dir: $AgentDir"
Write-Host "  memória:   http://127.0.0.1:$AiMemoryPort"
Write-Host ''
Write-Host 'Abra o Pi (ou rode /reload numa sessão aberta) para carregar skills, prompts e a extensão guard.'
