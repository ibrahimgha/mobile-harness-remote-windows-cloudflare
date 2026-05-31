Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AppName = "Ibrahim HP"
$paths = @(
  (Join-Path ([Environment]::GetFolderPath("Programs")) "$AppName.lnk"),
  (Join-Path ([Environment]::GetFolderPath("Desktop")) "$AppName.lnk")
)

foreach ($path in $paths) {
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Force
    Write-Host "Removed $path"
  }
}

Write-Host "Uninstalled $AppName"
