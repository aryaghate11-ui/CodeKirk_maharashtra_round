$ErrorActionPreference = "Stop"

$anvil = $env:QUORUM_ANVIL_BINARY
if (-not $anvil) {
    $localAnvil = Join-Path $PSScriptRoot "..\.quorum\tools\foundry\anvil.exe"
    if (Test-Path -LiteralPath $localAnvil) {
        $anvil = (Resolve-Path -LiteralPath $localAnvil).Path
    } else {
        $command = Get-Command anvil -ErrorAction SilentlyContinue
        if ($command) { $anvil = $command.Source }
    }
}

if (-not $anvil) {
    throw "Anvil was not found. Install Foundry or set QUORUM_ANVIL_BINARY."
}

& $anvil --host 127.0.0.1 --port 8545 --chain-id 31337
