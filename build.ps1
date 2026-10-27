# Compila Folio en Windows. Uso: .\build.ps1 [-Version 1.0.0]
param([string]$Version = "1.0.0")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
wails build -platform windows/amd64 -trimpath -ldflags "-s -w -X main.Version=$Version" -o folio.exe
Get-ChildItem build\bin
