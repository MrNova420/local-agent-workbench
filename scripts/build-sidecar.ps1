param([string]$CorePath)
$ErrorActionPreference = 'Stop'
$AppRoot = Split-Path -Parent $PSScriptRoot
if (-not $CorePath) {
    if ($env:LOCAL_AGENT_CORE_PATH) { $CorePath = $env:LOCAL_AGENT_CORE_PATH }
    else { $CorePath = Join-Path (Split-Path -Parent $AppRoot) 'local-9b-dev-app' }
}
if (-not [IO.Path]::IsPathRooted($CorePath)) { $CorePath = Join-Path $AppRoot $CorePath }
$CorePath = (Resolve-Path -LiteralPath $CorePath).Path
$VerifiedCorePath = & python (Join-Path $AppRoot 'scripts\verify_core_checkout.py') `
    --app-root $AppRoot --core-path $CorePath
if ($LASTEXITCODE -ne 0) { throw 'The agent engine checkout does not match the app source pin.' }
$CorePath = $VerifiedCorePath.Trim()
foreach ($RequiredCoreFile in @(
    'desktop_engine.py', 'permission_policy.py', 'task_checkpoint.py',
    'project_knowledge.py', 'project_walk.py', 'mcp_support.py',
    'prompt_manifest.py', 'cancellable_http.py', 'tool_schema_capabilities.py',
    'windows_process_job.py'
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $CorePath $RequiredCoreFile))) {
        throw "Required agent engine source '$RequiredCoreFile' not found under $CorePath"
    }
}
$OutputDir = if ($env:LOCAL_AGENT_WORKER_OUT_DIR) { $env:LOCAL_AGENT_WORKER_OUT_DIR } else { Join-Path $AppRoot 'sidecar\dist' }
$WorkDir = if ($env:LOCAL_AGENT_WORKER_WORK_DIR) { $env:LOCAL_AGENT_WORKER_WORK_DIR } else { Join-Path $AppRoot 'sidecar\build' }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
python -m PyInstaller --noconfirm --clean --onefile --name agent-worker `
    --distpath $OutputDir --workpath $WorkDir --paths $CorePath `
    (Join-Path $AppRoot 'sidecar\worker.py')
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed to build the agent sidecar.' }
