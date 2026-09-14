#requires -Version 5.1
<#
    Local Windows x64 build script. Mirrors the Windows packaging steps from
    .github/workflows/beta-build.yml and release-build.yml.

    Usage:
        .\.scripts\build-local-windows.ps1
        .\.scripts\build-local-windows.ps1 -Version 2.0.1-beta.local
        powershell -ExecutionPolicy Bypass -File .\.scripts\build-local-windows.ps1
#>

[CmdletBinding()]
param(
    [string]$Version = "2.0.1-beta.local",
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

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

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "--- $Message ---" -ForegroundColor Cyan
}

function Invoke-Checked([scriptblock]$Command, [string]$FailureMessage) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
}

$Version = $Version.TrimStart('v')
$RepoRoot = Get-CanonicalCasePath (Resolve-Path "$PSScriptRoot\..").Path
$BuildDir = Join-Path $RepoRoot 'build\windows'
$PublishServer = Join-Path $RepoRoot 'publish-server'
$ClientSrc = Join-Path $RepoRoot 'src\NcSender.Client'
$ClientDist = Join-Path $ClientSrc 'dist'
$DesktopSrc = Join-Path $RepoRoot 'src\NcSender.Desktop'
$DesktopDist = Join-Path $DesktopSrc 'dist-electron'
$DesktopServerResources = Join-Path $DesktopSrc 'resources\server'
$DesktopClientResources = Join-Path $DesktopSrc 'resources\client\dist'

Write-Host "=== Building ncSender Windows installer (x64) - v$Version ==="
Write-Host "Output: $BuildDir"

if ($Clean) {
    Write-Step 'Cleaning previous build outputs'
    Remove-Item -Recurse -Force $BuildDir, $PublishServer, $DesktopDist -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

Write-Step 'Step 1/5: Building client'
Push-Location $ClientSrc
try {
    Invoke-Checked { npm ci } 'npm ci failed in src\NcSender.Client'
    Invoke-Checked { npm run build } 'npm run build failed in src\NcSender.Client'
}
finally {
    Pop-Location
}

if (-not (Test-Path $ClientDist)) {
    throw "Vite build output not found at $ClientDist"
}

Write-Step 'Step 2/5: Publishing server (AOT, win-x64)'
if (Test-Path $PublishServer) { Remove-Item -Recurse -Force $PublishServer }
Invoke-Checked {
    dotnet publish (Join-Path $RepoRoot 'src\NcSender.Server') `
        -c Release `
        -r win-x64 `
        --self-contained `
        /p:PublishAot=true `
        "/p:Version=$Version" `
        -o $PublishServer
} 'dotnet publish failed'

Write-Step 'Step 3/5: Staging resources for Electron'
Remove-Item -Recurse -Force $DesktopServerResources, $DesktopClientResources -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $DesktopServerResources, $DesktopClientResources | Out-Null
Copy-Item -Recurse -Force "$PublishServer\*" $DesktopServerResources
Remove-Item "$DesktopServerResources\*.pdb" -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force "$ClientDist\*" $DesktopClientResources

Write-Step 'Step 4/5: Installing Electron dependencies'
Push-Location $DesktopSrc
try {
    Invoke-Checked { npm ci } 'npm ci failed in src\NcSender.Desktop'

    Write-Step 'Step 5/5: Packaging Windows installer'
    Remove-Item -Recurse -Force $DesktopDist -ErrorAction SilentlyContinue
    Invoke-Checked {
        npx electron-builder --win nsis --x64 --publish never "-c.extraMetadata.version=$Version"
    } 'electron-builder failed'
}
finally {
    Pop-Location
}

$Installer = Get-ChildItem -Path $DesktopDist -Filter '*.exe' -File | Select-Object -First 1
if (-not $Installer) {
    throw "Windows installer not found in $DesktopDist"
}

$Final = Join-Path $BuildDir $Installer.Name
Copy-Item -Force $Installer.FullName $Final

Write-Host ""
Write-Host "=== Build complete ===" -ForegroundColor Green
Write-Host "Installer: $Final"
