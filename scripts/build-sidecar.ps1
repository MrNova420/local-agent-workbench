param([string]$CorePath)
$ErrorActionPreference = 'Stop'
$AppRoot = Split-Path -Parent $PSScriptRoot
if (-not $CorePath) {
    if ($env:LOCAL_AGENT_CORE_PATH) { $CorePath = $env:LOCAL_AGENT_CORE_PATH }
    else { $CorePath = Join-Path (Split-Path -Parent $AppRoot) 'local-9b-dev-app' }
}
$CorePath = (Resolve-Path -LiteralPath $CorePath).Path
if (-not (Test-Path -LiteralPath (Join-Path $CorePath 'desktop_engine.py'))) {
    throw "Agent engine source not found under $CorePath"
}
$OutputDir = Join-Path $AppRoot 'sidecar\dist'
$WorkDir = Join-Path $AppRoot 'sidecar\build'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
python -m PyInstaller --noconfirm --clean --onefile --name agent-worker `
    --distpath $OutputDir --workpath $WorkDir --paths $CorePath `
    (Join-Path $AppRoot 'sidecar\worker.py')
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed to build the agent sidecar.' }
