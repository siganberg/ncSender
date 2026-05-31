#requires -Version 5.1
<#
    Dev runner for Windows. Builds the Vite client, stages it where the
    server expects (<repo>/client/dist), and runs the server on port 8090
    serving both the API and the UI from the same origin.

    Usage:
        ./scripts/dev-windows.ps1                # full build + run
        ./scripts/dev-windows.ps1 -SkipClient    # skip client rebuild (server only)
        ./scripts/dev-windows.ps1 -SkipServer    # build client only (no run)
#>

[CmdletBinding()]
param(
    [switch]$SkipClient,
    [switch]$SkipServer,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

# Resolve repo root to its actual on-disk casing (two levels up from
# this script). Get-Item / Resolve-Path / .FullName all preserve the
# case used to address the path on Windows — they don't query the
# filesystem for the stored case. Vite's html-inline-proxy plugin
# normalizes paths through Node, which DOES use the on-disk case, so
# when the two disagree it fails with
#   "[vite:html-inline-proxy] Could not load … No matching HTML proxy module"
# Walk each path component and ask the directory for the actual entry
# name; that's the only reliable way to get canonical case in PS.
function Get-CanonicalCasePath([string]$path) {
    $absolute = [System.IO.Path]::GetFullPath($path)
    $sep = [System.IO.Path]::DirectorySeparatorChar
    $parts = $absolute.Split($sep)
    $current = $parts[0]
    if (-not $current.EndsWith($sep)) { $current += $sep }
    for ($i = 1; $i -lt $parts.Length; $i++) {
        if ([string]::IsNullOrEmpty($parts[$i])) { continue }
        $entry = [System.IO.Directory]::EnumerateFileSystemEntries($current, $parts[$i]) | Select-Object -First 1
        if ($entry) { $current = $entry } else { $current = Join-Path $current $parts[$i] }
    }
    return $current
}
$RepoRoot = Get-CanonicalCasePath (Resolve-Path "$PSScriptRoot\..").Path
$ClientSrc = Join-Path $RepoRoot 'src\NcSender.Client'
$ClientDistSrc = Join-Path $ClientSrc 'dist'
$ServerProj = Join-Path $RepoRoot 'src\NcSender.Server'
# Stage next to the server binary so FindClientDist's BaseDirectory\client\dist
# candidate resolves regardless of cwd. dotnet run uses the project dir as
# cwd, so the repo-root staging path doesn't get hit during dev.
$ClientDistStaged = Join-Path $ServerProj 'bin\Debug\net10.0\client\dist'

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

if ($Clean -and (Test-Path $ClientDistStaged)) {
    Write-Step "Cleaning $ClientDistStaged"
    Remove-Item -Recurse -Force $ClientDistStaged
}

if (-not $SkipClient) {
    Push-Location $ClientSrc
    try {
        if (-not (Test-Path 'node_modules')) {
            Write-Step 'Installing client dependencies (npm install)…'
            npm install
            if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
        }

        Write-Step 'Building client (npm run build)…'
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
    }
    finally {
        Pop-Location
    }

    if (-not (Test-Path $ClientDistSrc)) {
        throw "Vite build output not found at $ClientDistSrc"
    }

    Write-Step "Staging client to $ClientDistStaged"
    if (Test-Path $ClientDistStaged) { Remove-Item -Recurse -Force $ClientDistStaged }
    New-Item -ItemType Directory -Force -Path $ClientDistStaged | Out-Null
    Copy-Item -Recurse -Force "$ClientDistSrc\*" $ClientDistStaged
}

if ($SkipServer) {
    Write-Step 'Skipping server (–SkipServer). Done.'
    return
}

Write-Step 'Building server (dotnet build)…'
dotnet build $ServerProj
if ($LASTEXITCODE -ne 0) { throw 'dotnet build failed' }

Write-Step 'Running server on http://localhost:8090 (Ctrl-C to stop)'
Push-Location $RepoRoot
try {
    dotnet run --project $ServerProj --no-build
}
finally {
    Pop-Location
}
