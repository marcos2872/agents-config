#Requires -Version 5.1
<#
.SYNOPSIS
    Sincroniza as configurações de opencode\ com o config local do OpenCode no Windows.

.DESCRIPTION
    Copia opencode.json, cli.json, AGENTS.md, agents\, commands\, plugins\ e skills\
    para o destino, substituindo o que existir. O conteúdo anterior é movido para
    <destino>\backup-<data>\.

    Depois da cópia, garante o ai-memory: instala o binário oficial se faltar,
    sobe o serviço local do usuário em 127.0.0.1:49375 (a 49374 é a porta padrão
    do serviço do OpenCode V2) e aplica a integração do OpenCode V2.

.PARAMETER Destination
    Destino do sync. Padrão: $env:XDG_CONFIG_HOME\opencode ou ~\.config\opencode.

.EXAMPLE
    .\sync.ps1

.EXAMPLE
    .\sync.ps1 -Destination C:\Projetos\meu-app\.opencode

.EXAMPLE
    .\sync.ps1 C:\Projetos\meu-app\.opencode
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Destination
)

$ErrorActionPreference = 'Stop'
try {
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
}
catch {
    # Console legado sem suporte a UTF-8: segue com a codificação padrão.
}

$Root = $PSScriptRoot
$Source = Join-Path $Root 'opencode'

if (-not $Destination) {
    if ($env:XDG_CONFIG_HOME) {
        $Destination = Join-Path $env:XDG_CONFIG_HOME 'opencode'
    }
    else {
        $Destination = Join-Path $HOME '.config\opencode'
    }
}
$Destination = [IO.Path]::GetFullPath($Destination)
$BackupDir = Join-Path $Destination ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))

if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    [Console]::Error.WriteLine("erro: pasta opencode\ não encontrada em $Root")
    exit 1
}

function Test-ReparsePoint {
    param([string]$Path)

    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if (-not $item) { return $false }
    return [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

function Remove-Link {
    param([string]$Path)

    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if (-not $item) { return }

    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        if ($item.PSIsContainer) {
            [IO.Directory]::Delete($item.FullName, $false)
        }
        else {
            [IO.File]::Delete($item.FullName)
        }
    }
}

function Copy-ToBackup {
    param([string]$Path)

    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if (-not $item) { return }

    $relative = $Path.Substring($Destination.Length).TrimStart('\', '/')
    $target = Join-Path $BackupDir $relative
    $parent = Split-Path -Parent $target

    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }

    Copy-Item -LiteralPath $Path -Destination $target -Recurse -Force
}

New-Item -ItemType Directory -Path $Destination -Force | Out-Null

# Instalações antigas por symlink/junction são removidas — a partir daqui sincronizamos por cópia.
$entries = 'opencode.json', 'opencode.jsonc', 'cli.json', 'AGENTS.md', 'agents', 'commands', 'plugins', 'skills'
foreach ($entry in $entries) {
    $path = Join-Path $Destination $entry
    if (Test-ReparsePoint -Path $path) {
        Remove-Link -Path $path
    }
}

# Um opencode.jsonc antigo conflitaria com o opencode.json do repo: backup e remove.
$jsonc = Join-Path $Destination 'opencode.jsonc'
if (Test-Path -LiteralPath $jsonc) {
    Copy-ToBackup -Path $jsonc
    Remove-Item -LiteralPath $jsonc -Force
    Write-Host "aviso: opencode.jsonc antigo movido para $BackupDir\"
}

foreach ($file in 'opencode.json', 'cli.json', 'AGENTS.md') {
    $src = Join-Path $Source $file
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) {
        [Console]::Error.WriteLine("erro: arquivo ausente: $src")
        exit 1
    }
    Copy-ToBackup -Path (Join-Path $Destination $file)
    Copy-Item -LiteralPath $src -Destination (Join-Path $Destination $file) -Force
    Write-Host "-> $file"
}

foreach ($dir in 'agents', 'commands', 'plugins') {
    $src = Join-Path $Source $dir
    if (-not (Test-Path -LiteralPath $src -PathType Container)) {
        [Console]::Error.WriteLine("erro: pasta ausente: $src")
        exit 1
    }
    $dst = Join-Path $Destination $dir
    Copy-ToBackup -Path $dst
    if (Test-Path -LiteralPath $dst) {
        Remove-Item -LiteralPath $dst -Recurse -Force
    }
    Copy-Item -LiteralPath $src -Destination $Destination -Recurse -Force
    Write-Host "-> $dir\"
}

$skillsDst = Join-Path $Destination 'skills'
if (-not (Test-Path -LiteralPath $skillsDst)) {
    New-Item -ItemType Directory -Path $skillsDst -Force | Out-Null
}
foreach ($skill in Get-ChildItem -LiteralPath (Join-Path $Source 'skills') -Directory) {
    $target = Join-Path $skillsDst $skill.Name
    Copy-ToBackup -Path $target
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
    Copy-Item -LiteralPath $skill.FullName -Destination $skillsDst -Recurse -Force
    Write-Host "-> skills\$($skill.Name)\"
}

# ─── ai-memory ───────────────────────────────────────────────────────────────
# Porta local: 49375. O ai-memory usa 49374 por padrão, a mesma do serviço
# compartilhado do OpenCode V2; manter as duas separadas evita o conflito.
$AiMemoryPort = if ($env:AI_MEMORY_PORT) { $env:AI_MEMORY_PORT } else { '49375' }
$AiMemoryDataDir = if ($env:AI_MEMORY_DATA_DIR) {
    $env:AI_MEMORY_DATA_DIR
}
else {
    Join-Path $env:LOCALAPPDATA 'ai-memory'
}
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

Write-Host '-> ai-memory: aplicando serviço e integração do OpenCode V2'
& $AiMemoryExe setup --yes --agent opencode2
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
Write-Host "  origem:  $Source"
Write-Host "  destino: $Destination"
if (Test-Path -LiteralPath $BackupDir) {
    Write-Host "  backup:  $BackupDir"
}
Write-Host "  memória: http://127.0.0.1:$AiMemoryPort"
Write-Host ''
Write-Host 'Se plugins/config mudaram, reinicie o OpenCode: opencode service restart'
