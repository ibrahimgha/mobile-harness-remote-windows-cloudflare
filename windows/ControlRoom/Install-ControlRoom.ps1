param(
  [switch]$NoDesktopShortcut,
  [string]$LocalRemoteUrl = "https://mobile-harness-remote-windows-cloudflare-ibrahim-hp.bit68-infra.com",
  [string]$ThinkCentre10RemoteUrl = "https://mobile-harness-remote-windows-cloudflare-thinkcentre-10.bit68-infra.com",
  [string]$ThinkCentre1RemoteUrl = "https://mobile-harness-remote-windows-cloudflare-thinkcentre-1.bit68-infra.com"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

$AppName = "Codex Control Room"
$AppUserModelId = "CodexRemote.ControlRoom"
$ExeName = "CodexControlRoom"
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $AppDir "..\..")).Path
$BuildScript = Join-Path $RepoRoot "windows\Build-WebViewWrapper.ps1"
$IconPath = Join-Path $RepoRoot "windows\IbrahimHP\ibrahim-hp.ico"
$InstallRoot = Join-Path $env:LOCALAPPDATA "CodexControlRoom"
$OutputDir = Join-Path $InstallRoot "app"
$ProfilePath = Join-Path $InstallRoot "machine-profiles.json"
$LocalEnvPath = Join-Path $RepoRoot ".env"
$AppUrl = "$($LocalRemoteUrl.TrimEnd('/'))/control-room"

function Read-EnvToken {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Codex Remote environment file was not found: $Path"
  }

  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match '^CONTROL_TOKEN=' } | Select-Object -First 1
  if (-not $line) {
    throw "CONTROL_TOKEN is missing from $Path"
  }

  $value = $line.Substring("CONTROL_TOKEN=".Length).Trim().Trim('"').Trim("'")
  if (-not $value) {
    throw "CONTROL_TOKEN is empty in $Path"
  }

  return $value
}

function Protect-ForCurrentUser {
  param([string]$Value)

  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
  $protected = [System.Security.Cryptography.ProtectedData]::Protect(
    $bytes,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  return [Convert]::ToBase64String($protected)
}

function Read-RemoteToken {
  param([string]$SshHost, [string]$MachineName)

  $line = & ssh $SshHost "grep -m1 '^CONTROL_TOKEN=' /var/www/html/mobile-harness-remote-windows-cloudflare/.env" 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $line) {
    throw "Could not read the $MachineName Codex Remote token over SSH."
  }

  $value = ([string]$line).Substring("CONTROL_TOKEN=".Length).Trim().Trim('"').Trim("'")
  if (-not $value) {
    throw "$MachineName returned an empty CONTROL_TOKEN."
  }

  return $value
}

function New-AppShortcut {
  param([string]$ShortcutPath, [string]$ExecutablePath)

  $shortcutDir = Split-Path -Parent $ShortcutPath
  New-Item -ItemType Directory -Force -Path $shortcutDir | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $ExecutablePath
  $shortcut.WorkingDirectory = Split-Path -Parent $ExecutablePath
  $shortcut.Description = "Open the multi-device Codex Control Room"
  $shortcut.IconLocation = "$IconPath,0"
  $shortcut.Save()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) | Out-Null
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
}

$localToken = Read-EnvToken -Path $LocalEnvPath
$thinkCentre10Token = Read-RemoteToken -SshHost "thinkcentre-10" -MachineName "ThinkCentre 10"
$thinkCentre1Token = Read-RemoteToken -SshHost "thinkcentre-1" -MachineName "TC1"

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$profileConfig = @{
  version = 1
  machines = @(
    @{
      id = "ibrahim-hp"
      name = "Ibrahim HP"
      url = $LocalRemoteUrl.TrimEnd('/')
      encryptedToken = Protect-ForCurrentUser -Value $localToken
    },
    @{
      id = "thinkcentre-10"
      name = "ThinkCentre 10"
      url = $ThinkCentre10RemoteUrl.TrimEnd('/')
      encryptedToken = Protect-ForCurrentUser -Value $thinkCentre10Token
    },
    @{
      id = "thinkcentre-1"
      name = "TC1"
      url = $ThinkCentre1RemoteUrl.TrimEnd('/')
      encryptedToken = Protect-ForCurrentUser -Value $thinkCentre1Token
    }
  )
}
$profileConfig | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ProfilePath -Encoding UTF8

& $BuildScript `
  -AppName $AppName `
  -AppUrl $AppUrl `
  -AppUserModelId $AppUserModelId `
  -IconPath $IconPath `
  -OutputDir $OutputDir `
  -ExeName $ExeName `
  -ProfileConfigPath $ProfilePath

$exePath = Join-Path $OutputDir "$ExeName.exe"
$startMenuPath = Join-Path ([Environment]::GetFolderPath("Programs")) "$AppName.lnk"
New-AppShortcut -ShortcutPath $startMenuPath -ExecutablePath $exePath

if (-not $NoDesktopShortcut) {
  $desktopPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "$AppName.lnk"
  New-AppShortcut -ShortcutPath $desktopPath -ExecutablePath $exePath
}

Write-Host "Installed $AppName"
Write-Host "Executable: $exePath"
Write-Host "Start Menu: $startMenuPath"
