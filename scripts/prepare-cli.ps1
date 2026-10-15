$ErrorActionPreference = 'Stop'
node (Join-Path $PSScriptRoot 'prepare-cli.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Unable to prepare the embedded CLI.' }
