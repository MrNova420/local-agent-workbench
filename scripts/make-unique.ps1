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
$Manifest = [ordered]@{
    candidate = $CandidateName
    created_at = (Get-Date).ToString('o')
    app_commit = $AppCommit
    engine_commit = $ActualEngine
    engine_pin = $PinnedEngine
    app_branch = $AppBranch
    engine_branch = $EngineBranch
}
New-Item -ItemType Directory -Force -Path $OutputPath | Out-Null
$Manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputPath 'candidate-manifest.json') -Encoding UTF8
$PreviousOutDir = $env:LOCAL_AGENT_OUT_DIR
$env:LOCAL_AGENT_OUT_DIR = $OutputPath
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
}
Write-Output "Unique candidate artifacts written to: $OutputPath"
Write-Output "Source provenance recorded in candidate-manifest.json"
