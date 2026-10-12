$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $projectDir 'release'
$portableDir = Join-Path $releaseDir 'Feishu-Desktop-Todo-0.1.0'
New-Item -ItemType Directory -Force -Path $portableDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $portableDir 'resources') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $portableDir 'docs') | Out-Null
function Copy-BinaryIfChanged {
    param([string]$Source,[string]$Destination)
    if (Test-Path -LiteralPath $Destination) {
        if ((Get-FileHash -LiteralPath $Source).Hash -eq (Get-FileHash -LiteralPath $Destination).Hash) { return }
    }
    Copy-Item -LiteralPath $Source -Destination $Destination
}
Copy-BinaryIfChanged (Join-Path $projectDir 'src-tauri\target\release\feishu-desktop-todo.exe') (Join-Path $portableDir 'feishu-desktop-todo.exe')
Copy-BinaryIfChanged (Join-Path $projectDir 'src-tauri\resources\lark-cli.exe') (Join-Path $portableDir 'resources\lark-cli.exe')
Copy-Item -LiteralPath (Join-Path $projectDir 'src-tauri\resources\LARK-CLI-LICENSE') -Destination (Join-Path $portableDir 'resources\LARK-CLI-LICENSE')
Copy-Item -LiteralPath (Join-Path $projectDir 'README.md') -Destination $portableDir
Get-ChildItem -LiteralPath (Join-Path $projectDir 'docs') -File -Filter '*.md' | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $portableDir 'docs') }
$installer = Get-ChildItem -LiteralPath (Join-Path $projectDir 'src-tauri\target\release\bundle\nsis') -File -Filter '*-setup.exe' | Select-Object -First 1
if (!$installer) { throw 'Build the NSIS installer before exporting.' }
Copy-Item -LiteralPath $installer.FullName -Destination $releaseDir
Compress-Archive -LiteralPath $portableDir -DestinationPath (Join-Path $releaseDir 'Feishu-Desktop-Todo-0.1.0-portable.zip') -Force
Get-ChildItem -LiteralPath $releaseDir -File | Where-Object {$_.Name -ne 'checksums.json'} | ForEach-Object {
    [pscustomobject]@{Name=$_.Name;SizeMB=[math]::Round($_.Length/1MB,2);SHA256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $releaseDir 'checksums.json')
Write-Host ('Portable app: ' + (Join-Path $portableDir 'feishu-desktop-todo.exe'))
