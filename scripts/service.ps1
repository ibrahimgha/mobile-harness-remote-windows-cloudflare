param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("install", "uninstall", "start", "stop", "restart", "status")]
  [string]$Command
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$LogDir = Join-Path $ProjectRoot "logs"
$AppPidFile = Join-Path $RuntimeDir "codex-window-remote-app.pid"
$TunnelPidFile = Join-Path $RuntimeDir "codex-window-remote-tunnel.pid"
$TaskName = "CodexWindowRemote"
$StartupCmd = Join-Path ([Environment]::GetFolderPath("Startup")) "CodexWindowRemote.cmd"
$TunnelName = "mobile-harness-remote-windows-cloudflare-ibrahim-hp"
$PublicHost = "mobile-harness-remote-windows-cloudflare-ibrahim-hp.bit68-infra.com"
$CloudflaredConfig = Join-Path $ProjectRoot "ops\cloudflared.yml"
$ServerEntry = Join-Path $ProjectRoot "dist-server\server\index.js"
$ClientEntry = Join-Path $ProjectRoot "dist\index.html"
$ServiceLog = Join-Path $LogDir "service-events.log"

function Ensure-Directories {
  New-Item -ItemType Directory -Force -Path $RuntimeDir, $LogDir | Out-Null
}

function Write-ServiceLog {
  param([string]$Message)

  Ensure-Directories
  $timestamp = Get-Date -Format "o"
  Add-Content -LiteralPath $ServiceLog -Value "$timestamp $Message" -Encoding utf8
}

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

function Get-WinGetNodeCandidates {
  param([string]$BinaryName)

  $packageRoot = Join-CandidatePath -Base $env:LOCALAPPDATA -Child "Microsoft\WinGet\Packages"
  if (-not $packageRoot -or -not (Test-Path -LiteralPath $packageRoot)) {
    return @()
  }

  $packageDirs = Get-ChildItem -LiteralPath $packageRoot -Directory -Filter "OpenJS.NodeJS*" -ErrorAction SilentlyContinue
  foreach ($packageDir in $packageDirs) {
    $nodeDirs = Get-ChildItem -LiteralPath $packageDir.FullName -Directory -Filter "node-*-win-*" -ErrorAction SilentlyContinue
    foreach ($nodeDir in $nodeDirs) {
      Join-Path $nodeDir.FullName $BinaryName
    }
  }
}

function Resolve-Executable {
  param(
    [string]$DisplayName,
    [string[]]$Candidates
  )

  foreach ($candidate in $Candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      continue
    }

    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) {
      Write-ServiceLog "Resolved $DisplayName to $($command.Source)"
      return $command.Source
    }

    if (Test-Path -LiteralPath $candidate) {
      $resolved = (Resolve-Path -LiteralPath $candidate).Path
      Write-ServiceLog "Resolved $DisplayName to $resolved"
      return $resolved
    }
  }

  $searched = ($Candidates | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join "; "
  Write-ServiceLog "Could not resolve $DisplayName. Searched: $searched"
  throw "$DisplayName executable was not found. Add it to PATH or install it in one of the expected locations."
}

function Get-NodeExe {
  $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  $candidates = @(
    "node.exe",
    (Join-CandidatePath -Base $env:ProgramFiles -Child "nodejs\node.exe"),
    (Join-CandidatePath -Base $programFilesX86 -Child "nodejs\node.exe"),
    (Join-CandidatePath -Base $env:LOCALAPPDATA -Child "Programs\nodejs\node.exe")
  ) + @(Get-WinGetNodeCandidates -BinaryName "node.exe")

  return Resolve-Executable -DisplayName "node" -Candidates $candidates
}

function Get-NpmCmd {
  $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  $candidates = @(
    "npm.cmd",
    "npm.exe",
    (Join-CandidatePath -Base $env:ProgramFiles -Child "nodejs\npm.cmd"),
    (Join-CandidatePath -Base $programFilesX86 -Child "nodejs\npm.cmd"),
    (Join-CandidatePath -Base $env:LOCALAPPDATA -Child "Programs\nodejs\npm.cmd")
  ) + @(Get-WinGetNodeCandidates -BinaryName "npm.cmd")

  return Resolve-Executable -DisplayName "npm" -Candidates $candidates
}

function Get-CloudflaredExe {
  $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  $candidates = @(
    "cloudflared.exe",
    (Join-CandidatePath -Base "C:\" -Child "cloudflared\cloudflared.exe"),
    (Join-CandidatePath -Base $env:ProgramFiles -Child "cloudflared\cloudflared.exe"),
    (Join-CandidatePath -Base $programFilesX86 -Child "cloudflared\cloudflared.exe"),
    (Join-CandidatePath -Base $env:LOCALAPPDATA -Child "cloudflared\cloudflared.exe"),
    (Join-CandidatePath -Base $env:USERPROFILE -Child ".cloudflared\cloudflared.exe")
  )

  return Resolve-Executable -DisplayName "cloudflared" -Candidates $candidates
}

function Read-Pid {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  $value = (Get-Content -LiteralPath $Path -Raw).Trim()
  if (-not $value) {
    return $null
  }

  return [int]$value
}

function Test-Pid {
  param([Nullable[int]]$ProcessId)

  if ($null -eq $ProcessId) {
    return $false
  }

  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Stop-PidFile {
  param(
    [string]$Name,
    [string]$Path
  )

  $processId = Read-Pid -Path $Path
  if (Test-Pid -ProcessId $processId) {
    Stop-Process -Id $processId -Force
    Write-Host "Stopped $Name (pid $processId)"
  } else {
    Write-Host "$Name is not running"
  }

  Remove-Item -LiteralPath $Path -ErrorAction SilentlyContinue
}

function Start-ManagedProcess {
  param(
    [string]$Name,
    [string]$PidPath,
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$Stdout,
    [string]$Stderr
  )

  $existingPid = Read-Pid -Path $PidPath
  if (Test-Pid -ProcessId $existingPid) {
    Write-Host "$Name is already running (pid $existingPid)"
    Write-ServiceLog "$Name already running pid=$existingPid"
    return
  }

  Write-ServiceLog "Starting $Name with $FilePath $($Arguments -join " ")"
  $process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList $Arguments `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $Stdout `
    -RedirectStandardError $Stderr `
    -PassThru

  Set-Content -LiteralPath $PidPath -Value $process.Id -Encoding ascii
  Write-Host "Started $Name (pid $($process.Id))"
  Write-ServiceLog "Started $Name pid=$($process.Id)"
}

function Ensure-Build {
  if ((Test-Path -LiteralPath $ServerEntry) -and (Test-Path -LiteralPath $ClientEntry)) {
    return
  }

  Write-Host "Build output missing; running npm run build"
  Push-Location $ProjectRoot
  try {
    $npmCmd = Get-NpmCmd
    & $npmCmd run build
  } finally {
    Pop-Location
  }
}

function Start-Remote {
  Ensure-Directories
  Ensure-Build

  $appLog = Join-Path $LogDir "app.stdout.log"
  $appErr = Join-Path $LogDir "app.stderr.log"
  $tunnelLog = Join-Path $LogDir "cloudflared.stdout.log"
  $tunnelErr = Join-Path $LogDir "cloudflared.stderr.log"
  $nodeExe = Get-NodeExe
  $cloudflaredExe = Get-CloudflaredExe

  Start-ManagedProcess `
    -Name "Codex window remote app" `
    -PidPath $AppPidFile `
    -FilePath $nodeExe `
    -Arguments @($ServerEntry) `
    -Stdout $appLog `
    -Stderr $appErr

  Start-Sleep -Seconds 2

  Start-ManagedProcess `
    -Name "Cloudflare tunnel" `
    -PidPath $TunnelPidFile `
    -FilePath $cloudflaredExe `
    -Arguments @("--config", $CloudflaredConfig, "tunnel", "run", $TunnelName) `
    -Stdout $tunnelLog `
    -Stderr $tunnelErr

  Write-Host "Public URL: https://$PublicHost"
}

function Stop-Remote {
  Ensure-Directories
  Stop-PidFile -Name "Cloudflare tunnel" -Path $TunnelPidFile
  Stop-PidFile -Name "Codex window remote app" -Path $AppPidFile
}

function Show-Status {
  Ensure-Directories
  $appPid = Read-Pid -Path $AppPidFile
  $tunnelPid = Read-Pid -Path $TunnelPidFile
  $appRunning = Test-Pid -ProcessId $appPid
  $tunnelRunning = Test-Pid -ProcessId $tunnelPid
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $startupCmdExists = Test-Path -LiteralPath $StartupCmd

  Write-Host "App running: $appRunning $(if ($appPid) { "(pid $appPid)" })"
  Write-Host "Tunnel running: $tunnelRunning $(if ($tunnelPid) { "(pid $tunnelPid)" })"
  Write-Host "Startup installed: $(($null -ne $task) -or $startupCmdExists)"
  Write-Host "Local URL: http://localhost:8787"
  Write-Host "Public URL: https://$PublicHost"

  try {
    $health = Invoke-RestMethod -Uri "http://localhost:8787/api/health" -TimeoutSec 15
    Write-Host "Health: $($health.ok)"
  } catch {
    Write-Host "Health: unavailable"
  }
}

function Install-StartupTask {
  $scriptPath = Join-Path $ProjectRoot "scripts\service.ps1"
  $action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" start"
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Days 0)

  try {
    Register-ScheduledTask `
      -TaskName $TaskName `
      -Action $action `
      -Trigger $trigger `
      -Principal $principal `
      -Settings $settings `
      -Description "Starts the Codex Window Remote app and Cloudflare tunnel at logon." `
      -Force | Out-Null

    Write-Host "Installed startup task: $TaskName"
  } catch {
    $command = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" start`r`n"
    Set-Content -LiteralPath $StartupCmd -Value $command -Encoding ascii
    Write-Host "Scheduled task unavailable; installed startup command: $StartupCmd"
  }
}

function Uninstall-StartupTask {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $StartupCmd -Force -ErrorAction SilentlyContinue
  Write-Host "Removed startup task: $TaskName"
}

switch ($Command) {
  "install" {
    Install-StartupTask
  }
  "uninstall" {
    Uninstall-StartupTask
  }
  "start" {
    Start-Remote
  }
  "stop" {
    Stop-Remote
  }
  "restart" {
    Stop-Remote
    Start-Remote
  }
  "status" {
    Show-Status
  }
}
