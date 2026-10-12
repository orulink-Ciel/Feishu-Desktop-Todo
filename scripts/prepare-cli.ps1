$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$packageDir = Join-Path $env:APPDATA 'npm\node_modules\@larksuite\cli'
$binary = Join-Path $packageDir 'bin\lark-cli.exe'
$license = Join-Path $packageDir 'LICENSE'
if (!(Test-Path -LiteralPath $binary) -or !(Test-Path -LiteralPath $license)) {
    throw 'Install and configure @larksuite/cli first. No credentials will be copied.'
}
$resourceDir = Join-Path $projectDir 'src-tauri\resources'
New-Item -ItemType Directory -Force -Path $resourceDir | Out-Null
Copy-Item -LiteralPath $binary -Destination (Join-Path $resourceDir 'lark-cli.exe')
Copy-Item -LiteralPath $license -Destination (Join-Path $resourceDir 'LARK-CLI-LICENSE')
Write-Host 'CLI executable and MIT license copied. No configuration or tokens copied.'
