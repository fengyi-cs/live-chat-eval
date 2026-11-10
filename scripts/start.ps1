# scripts/start.ps1
# Windows PowerShell 薄入口。需要 Node >= 22 已安装并在 PATH 中。
# 用法：powershell -ExecutionPolicy Bypass -File scripts\start.ps1

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Error: 'node' not found in PATH. Install Node.js 22 LTS from https://nodejs.org/"
    exit 1
}

$nodeMajor = [int](node -e "process.stdout.write(process.versions.node.split('.')[0])")
if ($nodeMajor -lt 22) {
    Write-Error "Error: Node.js >= 22 required, got $(node --version). Please upgrade."
    exit 1
}

Write-Host "[start.ps1] Starting live-chat-eval..."
node "$scriptDir\launcher.mjs" @args
