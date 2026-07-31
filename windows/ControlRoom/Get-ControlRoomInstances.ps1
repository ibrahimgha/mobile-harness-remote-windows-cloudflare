Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$baseInstallRoot = Join-Path $env:LOCALAPPDATA "CodexControlRoom"
$metadataFiles = @()
$defaultMetadata = Join-Path $baseInstallRoot "instance.json"
$namedInstancesRoot = Join-Path $baseInstallRoot "instances"

if (Test-Path -LiteralPath $defaultMetadata) {
  $metadataFiles += Get-Item -LiteralPath $defaultMetadata
}
if (Test-Path -LiteralPath $namedInstancesRoot) {
  $metadataFiles += Get-ChildItem -LiteralPath $namedInstancesRoot -Filter "instance.json" -File -Recurse -Depth 1
}

$instances = foreach ($metadataFile in $metadataFiles) {
  try {
    $metadata = Get-Content -LiteralPath $metadataFile.FullName -Raw | ConvertFrom-Json
    [pscustomobject]@{
      Id = [string]$metadata.id
      Name = [string]$metadata.name
      Installed = Test-Path -LiteralPath ([string]$metadata.executable)
      Running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -eq [string]$metadata.executable } catch { $false }
      }).Count -gt 0
      Executable = [string]$metadata.executable
      MemoryFolder = Join-Path (Join-Path $env:LOCALAPPDATA "CodexRemoteWindowsApps") ([string]$metadata.userDataFolder)
    }
  } catch {
    Write-Warning "Ignoring unreadable instance metadata: $($metadataFile.FullName)"
  }
}

$instances | Sort-Object @{ Expression = { if ($_.Id -eq "default") { 0 } else { 1 } } }, Name
