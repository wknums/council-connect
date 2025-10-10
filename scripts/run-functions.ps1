<#!
.SYNOPSIS
    Helper script to run the Azure Functions host for the backend inside the local Python virtual environment.

.DESCRIPTION
    Activates the local .venv, (optionally) launches Azurite in a background job, changes to the backend directory,
    and starts the Azure Functions host (func start). Provides a few convenience parameters for common workflows.

.PARAMETER WithAzurite
    If supplied, starts `npm run azurite` in a background job before launching the Functions host (expects package.json script to exist).

.PARAMETER InstallRequirements
    If supplied, (re)installs Python dependencies from requirements.txt after activating the environment.

.PARAMETER FunctionsDir
    Relative path (from repository root) to the directory containing function_app.py. Default: src/backend

.PARAMETER Port
    Override the default Functions host port (7071).

.EXAMPLE
    ./scripts/run-functions.ps1 -WithAzurite

.EXAMPLE
    ./scripts/run-functions.ps1 -Port 8081 -InstallRequirements

.NOTES
    Ctrl+C will stop the Functions host. Azurite (if started) runs as a background job you can stop with Stop-Job.
#>

[CmdletBinding()] param(
    [switch]$WithAzurite,
    [switch]$InstallRequirements,
    [string]$FunctionsDir = "src/backend",
    [int]$Port = 7071,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg) { if(-not $Quiet){ Write-Host "[INFO] $msg" -ForegroundColor Cyan } }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err ($msg) { Write-Host "[ERR ] $msg" -ForegroundColor Red }

# Resolve repo root as the parent directory of this script's folder
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

# Verify virtual environment exists
$VenvActivate = Join-Path $RepoRoot '.venv/Scripts/Activate.ps1'
if(-not (Test-Path $VenvActivate)) {
    Write-Err ".venv not found. Create it with: python -m venv .venv; then activate and install requirements.";
    Write-Err "Example: python -m venv .venv; .\\.venv\\Scripts\\Activate.ps1; pip install -r requirements.txt";
    exit 1
}

Write-Info "Activating virtual environment (.venv)"
. $VenvActivate

# Confirm python version
try {
    $pyVersion = python -c "import platform; print(platform.python_version())"
    Write-Info "Python version: $pyVersion"
} catch {
    Write-Err "Python not available inside the virtual environment."; exit 1
}

if($InstallRequirements) {
    if(Test-Path "$RepoRoot/requirements.txt") {
        Write-Info "Installing Python dependencies from requirements.txt"
        pip install -r requirements.txt | Write-Output
    } else {
        Write-Warn "requirements.txt not found—skipping dependency install"
    }
}

# Ensure Azure Functions Core Tools available
try {
    $funcVersion = func --version 2>$null
    if($LASTEXITCODE -ne 0 -or -not $funcVersion) { throw "func not available" }
    Write-Info "Azure Functions Core Tools version: $funcVersion"
} catch {
    Write-Err "Azure Functions Core Tools (func) not found. Install from: https://learn.microsoft.com/azure/azure-functions/functions-run-local";
    exit 1
}

# Optionally start Azurite
$AzuriteJob = $null
if($WithAzurite) {
    Write-Info "Starting Azurite (npm run azurite) in background job"
    if(-not (Test-Path "$RepoRoot/package.json")) {
        Write-Warn "package.json not found—skipping Azurite start"
    } else {
        $AzuriteJob = Start-Job -ScriptBlock {
            param($Root)
            Set-Location $Root
            npm run azurite | ForEach-Object { "[AZURITE] $_" }
        } -ArgumentList $RepoRoot
        Start-Sleep 2
        if($AzuriteJob.State -ne 'Running') {
            Write-Warn "Azurite job did not start successfully. Check npm script."
        } else {
            Write-Info "Azurite running as Job Id: $($AzuriteJob.Id)"
        }
    }
}

# Move to Functions directory
$FunctionsPath = Join-Path $RepoRoot $FunctionsDir
if(-not (Test-Path $FunctionsPath)) { Write-Err "FunctionsDir '$FunctionsDir' not found."; exit 1 }
Set-Location $FunctionsPath
Write-Info "Changed directory to: $FunctionsPath"

# Helpful environment echo
Write-Info "AzureWebJobsStorage=$env:AzureWebJobsStorage"
Write-Info "APP_ENV=$env:APP_ENV"

# Start Functions host
Write-Info "Starting Functions host on port $Port (Ctrl+C to stop)"
$env:FUNCTIONS_WORKER_RUNTIME = 'python'
$hostParams = @('start', '--port', $Port)

# Launch host in foreground so user can interact
func @hostParams

$funcExit = $LASTEXITCODE
Write-Info "Functions host exited with code $funcExit"

if($AzuriteJob) {
    Write-Info "Stopping Azurite job"
    Stop-Job $AzuriteJob -Force | Out-Null
    Receive-Job $AzuriteJob -Keep | Out-Null
    Remove-Job $AzuriteJob -Force | Out-Null
}

exit $funcExit
