$ErrorActionPreference = 'Stop'
$AppRoot = Split-Path -Parent $PSScriptRoot
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
$CandidateName = "candidate-$Timestamp-$Suffix"
$OutputPath = Join-Path $AppRoot "out\candidates\$CandidateName"
if (Test-Path -LiteralPath $OutputPath) {
    throw "Refusing to overwrite existing candidate output: $OutputPath"
}
$EnginePath = if ($env:LOCAL_AGENT_CORE_PATH) { $env:LOCAL_AGENT_CORE_PATH } else { Join-Path (Split-Path -Parent $AppRoot) 'local-9b-dev-app' }
if (-not [IO.Path]::IsPathRooted($EnginePath)) { $EnginePath = Join-Path $AppRoot $EnginePath }
$EnginePath = (Resolve-Path -LiteralPath $EnginePath).Path
$PinnedEngine = (Get-Content -Raw -LiteralPath (Join-Path $AppRoot 'core-revision.txt')).Trim()
$ActualEngine = (& git -C $EnginePath rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $ActualEngine -ne $PinnedEngine) {
    throw "Refusing candidate build: engine HEAD $ActualEngine does not match app pin $PinnedEngine"
}
$AppCommit = (& git -C $AppRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to identify app source commit.' }
$AppBranch = (& git -C $AppRoot branch --show-current).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to identify app branch.' }
$EngineBranch = (& git -C $EnginePath branch --show-current).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to identify engine branch.' }
$NodeVersion = (& node --version).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Node.js is required to create a candidate.' }
$NpmVersion = (& npm --version).Trim()
if ($LASTEXITCODE -ne 0) { throw 'npm is required to create a candidate.' }
$PythonVersion = (& python --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Python is required to create the bundled worker.' }
$PyInstallerVersion = (& python -m PyInstaller --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller is required to create the bundled worker.' }
$LockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $AppRoot 'package-lock.json')).Hash
$Manifest = [ordered]@{
    candidate = $CandidateName
    created_at = (Get-Date).ToString('o')
    app_commit = $AppCommit
    engine_commit = $ActualEngine
    engine_pin = $PinnedEngine
    app_branch = $AppBranch
    engine_branch = $EngineBranch
    node_version = $NodeVersion
    npm_version = $NpmVersion
    python_version = $PythonVersion
    pyinstaller_version = $PyInstallerVersion
    package_lock_sha256 = $LockHash
}
New-Item -ItemType Directory -Force -Path $OutputPath | Out-Null
$Manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputPath 'candidate-manifest.json') -Encoding UTF8
$WorkerOutPath = Join-Path $OutputPath 'worker'
$WorkerWorkPath = Join-Path $OutputPath 'worker-build'
$PreviousOutDir = $env:LOCAL_AGENT_OUT_DIR
$PreviousWorkerOutDir = $env:LOCAL_AGENT_WORKER_OUT_DIR
$PreviousWorkerWorkDir = $env:LOCAL_AGENT_WORKER_WORK_DIR
$env:LOCAL_AGENT_OUT_DIR = Join-Path $OutputPath 'artifacts'
$env:LOCAL_AGENT_WORKER_OUT_DIR = $WorkerOutPath
$env:LOCAL_AGENT_WORKER_WORK_DIR = $WorkerWorkPath
$LocationPushed = $false
try {
    Push-Location $AppRoot
    $LocationPushed = $true
    npm run make
    if ($LASTEXITCODE -ne 0) { throw "Unique candidate package failed with exit code $LASTEXITCODE" }
} finally {
    if ($LocationPushed) { Pop-Location }
    if ($null -eq $PreviousOutDir) { Remove-Item Env:LOCAL_AGENT_OUT_DIR -ErrorAction SilentlyContinue }
    else { $env:LOCAL_AGENT_OUT_DIR = $PreviousOutDir }
    if ($null -eq $PreviousWorkerOutDir) { Remove-Item Env:LOCAL_AGENT_WORKER_OUT_DIR -ErrorAction SilentlyContinue }
    else { $env:LOCAL_AGENT_WORKER_OUT_DIR = $PreviousWorkerOutDir }
    if ($null -eq $PreviousWorkerWorkDir) { Remove-Item Env:LOCAL_AGENT_WORKER_WORK_DIR -ErrorAction SilentlyContinue }
    else { $env:LOCAL_AGENT_WORKER_WORK_DIR = $PreviousWorkerWorkDir }
}
Write-Output "Unique candidate artifacts written to: $OutputPath"
Write-Output "Source provenance recorded in candidate-manifest.json"
