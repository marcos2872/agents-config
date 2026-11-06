#Requires -Version 5.1
<#
.SYNOPSIS
    Sincroniza as configurações de opencode\ com o config local do OpenCode no Windows.

.DESCRIPTION
    Copia opencode.json, cli.json, AGENTS.md, agents\, commands\, plugins\ e skills\
    para o destino, substituindo o que existir. O conteúdo anterior é movido para
    <destino>\backup-<data>\.

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

Write-Host ''
Write-Host 'Sync concluído:'
Write-Host "  origem:  $Source"
Write-Host "  destino: $Destination"
if (Test-Path -LiteralPath $BackupDir) {
    Write-Host "  backup:  $BackupDir"
}
Write-Host ''
Write-Host 'Se plugins/config mudaram, reinicie o OpenCode: opencode service restart'
