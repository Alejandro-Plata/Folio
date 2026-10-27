# Compila Folio en Windows (ventana de Electron y núcleo Go). Uso: .\build.ps1 [-Version 1.3.0]
# Necesita Go y Node. El instalador se hace desde Linux (./build.sh installer) o con NSIS para Windows.
param([string]$Version = "1.0.0")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Push-Location frontend; if (-not (Test-Path node_modules)) { npm ci }; npm run build; Pop-Location
Push-Location desktop; if (-not (Test-Path node_modules)) { npm ci }; npm run build
node package.mjs win32 $Version "$PSScriptRoot\build\bin\whisper-cli.exe"
Pop-Location
Get-ChildItem build\desktop\win32\Folio
