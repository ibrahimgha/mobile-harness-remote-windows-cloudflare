param(
  [switch]$NoDesktopShortcut
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AppName = "Ibrahim HP"
$AppUrl = "https://mobile-harness-remote-windows-cloudflare-ibrahim-hp.bit68-infra.com/"
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$IconPath = Join-Path $AppDir "ibrahim-hp.ico"

function Join-CandidatePath {
  param(
    [AllowNull()]
    [string]$Base,
    [string]$Child
  )

  if ([string]::IsNullOrWhiteSpace($Base)) {
    return $null
  }

  return Join-Path $Base $Child
}

function Resolve-Browser {
  $candidates = @(
    (Join-CandidatePath -Base ${env:ProgramFiles(x86)} -Child "Microsoft\Edge\Application\msedge.exe"),
    (Join-CandidatePath -Base $env:ProgramFiles -Child "Microsoft\Edge\Application\msedge.exe"),
    "msedge.exe",
    (Join-CandidatePath -Base $env:LOCALAPPDATA -Child "Google\Chrome\Application\chrome.exe"),
    (Join-CandidatePath -Base $env:ProgramFiles -Child "Google\Chrome\Application\chrome.exe"),
    "chrome.exe"
  )

  foreach ($candidate in $candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      continue
    }

    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }

    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  throw "Microsoft Edge or Google Chrome was not found."
}

function New-AppShortcut {
  param(
    [string]$ShortcutPath,
    [string]$BrowserPath
  )

  $shortcutDir = Split-Path -Parent $ShortcutPath
  New-Item -ItemType Directory -Force -Path $shortcutDir | Out-Null

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $BrowserPath
  $shortcut.Arguments = "--app=$AppUrl --new-window"
  $shortcut.WorkingDirectory = Split-Path -Parent $BrowserPath
  $shortcut.Description = "Open Codex Remote for Ibrahim HP"

  if (Test-Path -LiteralPath $IconPath) {
    $shortcut.IconLocation = "$IconPath,0"
  }

  $shortcut.Save()
}

if (-not (Test-Path -LiteralPath $IconPath)) {
  & (Join-Path $AppDir "Build-Icon.ps1")
}

$browserPath = Resolve-Browser
$startMenuPath = Join-Path ([Environment]::GetFolderPath("Programs")) "$AppName.lnk"
New-AppShortcut -ShortcutPath $startMenuPath -BrowserPath $browserPath

if (-not $NoDesktopShortcut) {
  $desktopPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "$AppName.lnk"
  New-AppShortcut -ShortcutPath $desktopPath -BrowserPath $browserPath
}

Write-Host "Installed $AppName"
Write-Host "Start Menu: $startMenuPath"
if (-not $NoDesktopShortcut) {
  Write-Host "Desktop: $desktopPath"
}
