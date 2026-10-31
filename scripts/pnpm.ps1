param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$PnpmArgs
)

# Local machine notes:
# - The DSH `pnpm` shim runs under Electron and sets npm_config_runtime=electron,
#   which makes native modules target Electron instead of Node.
# - The system `node` on PATH is v20, but pnpm 11 requires >=22.13.
# This wrapper prefers the installed Node 24 + pnpm CLI, and clears the dead
# local proxy for package operations only.

$node = 'E:\nodejs-v24.20.0\node.exe'
$pnpm = 'E:\Deepseek_Harness\app\resources\app\node_modules\pnpm\bin\pnpm.cjs'

if (-not (Test-Path -LiteralPath $node)) {
  $node = (Get-Command node -ErrorAction Stop).Source
}
if (-not (Test-Path -LiteralPath $pnpm)) {
  $pnpm = $null
}

$env:HTTP_PROXY = ''
$env:HTTPS_PROXY = ''
$env:ALL_PROXY = ''
$env:http_proxy = ''
$env:https_proxy = ''
$env:all_proxy = ''
$env:NODE_USE_ENV_PROXY = '0'
$env:npm_config_runtime = ''
$env:npm_config_target = ''
$env:npm_config_disturl = ''

if ($pnpm) {
  & $node $pnpm @PnpmArgs
} else {
  & pnpm @PnpmArgs
}

exit $LASTEXITCODE
