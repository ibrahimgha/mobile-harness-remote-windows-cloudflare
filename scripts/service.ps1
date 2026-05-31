param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("install", "uninstall", "start", "watchdog", "stop", "restart", "status")]
  [string]$Command
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$LogDir = Join-Path $ProjectRoot "logs"
$AppPidFile = Join-Path $RuntimeDir "codex-window-remote-app.pid"
$TunnelPidFile = Join-Path $RuntimeDir "codex-window-remote-tunnel.pid"
$DisabledFlag = Join-Path $RuntimeDir "codex-window-remote.disabled"
$TaskName = "CodexWindowRemote"
$StartupCmd = Join-Path ([Environment]::GetFolderPath("Startup")) "CodexWindowRemote.cmd"
$TunnelName = "mobile-harness-remote-windows-cloudflare-ibrahim-hp"
$PublicHost = "mobile-harness-remote-windows-cloudflare-ibrahim-hp.bit68-infra.com"
$CloudflaredConfig = Join-Path $ProjectRoot "ops\cloudflared.yml"
$ServerEntry = Join-Path $ProjectRoot "dist-server\server\index.js"
$ClientEntry = Join-Path $ProjectRoot "dist\index.html"
$WatchdogScript = Join-Path $PSScriptRoot "watchdog.vbs"
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

function Get-CodexNodeCandidates {
  $codexBinRoot = Join-CandidatePath -Base $env:LOCALAPPDATA -Child "OpenAI\Codex\bin"
  if (-not $codexBinRoot -or -not (Test-Path -LiteralPath $codexBinRoot)) {
    return @()
  }

  Get-ChildItem -LiteralPath $codexBinRoot -Directory -ErrorAction SilentlyContinue |
    ForEach-Object {
      $candidate = Join-Path $_.FullName "node.exe"
      if (Test-Path -LiteralPath $candidate) {
        Get-Item -LiteralPath $candidate
      }
    } |
    Sort-Object LastWriteTime -Descending |
    ForEach-Object { $_.FullName }
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
      if ($DisplayName -eq "node" -and $command.Source -like "*\WindowsApps\*") {
        Write-ServiceLog "Ignoring WindowsApps node alias $($command.Source)"
        continue
      }

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
    (Join-CandidatePath -Base $env:ProgramFiles -Child "nodejs\node.exe"),
    (Join-CandidatePath -Base $programFilesX86 -Child "nodejs\node.exe"),
    (Join-CandidatePath -Base $env:LOCALAPPDATA -Child "Programs\nodejs\node.exe")
  ) + @(Get-WinGetNodeCandidates -BinaryName "node.exe") + @(Get-CodexNodeCandidates) + @("node.exe")

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

function Test-WatchdogTaskInstalled {
  try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -ne $task) {
      return $true
    }
  } catch {
    Write-ServiceLog "Get-ScheduledTask status check failed: $($_.Exception.Message)"
  }

  try {
    $null = & schtasks.exe /Query /TN $TaskName 2>$null
    return $LASTEXITCODE -eq 0
  } catch {
    Write-ServiceLog "schtasks.exe status check failed: $($_.Exception.Message)"
    return $false
  }
}

function Test-RemoteDisabled {
  return Test-Path -LiteralPath $DisabledFlag
}

function Disable-Remote {
  Ensure-Directories
  Set-Content -LiteralPath $DisabledFlag -Value (Get-Date -Format "o") -Encoding ascii
  Write-ServiceLog "Remote auto-start disabled"
}

function Enable-Remote {
  Remove-Item -LiteralPath $DisabledFlag -Force -ErrorAction SilentlyContinue
  Write-ServiceLog "Remote auto-start enabled"
}

function Update-WatchdogTaskSettings {
  try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $task.Settings.DisallowStartIfOnBatteries = $false
    $task.Settings.StopIfGoingOnBatteries = $false
    $task.Settings.StartWhenAvailable = $true
    $task.Settings.WakeToRun = $true
    $task.Settings.MultipleInstances = "IgnoreNew"
    $task.Settings.ExecutionTimeLimit = "PT5M"
    $task | Set-ScheduledTask | Out-Null
    Write-ServiceLog "Updated watchdog scheduled task settings $TaskName"
  } catch {
    Write-ServiceLog "Could not update watchdog task settings: $($_.Exception.Message)"
  }
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

function Get-PidAgeSeconds {
  param([Nullable[int]]$ProcessId)

  if ($null -eq $ProcessId) {
    return [double]::PositiveInfinity
  }

  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    return ((Get-Date) - $process.StartTime).TotalSeconds
  } catch {
    return [double]::PositiveInfinity
  }
}

function Test-LocalHealth {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/health" -TimeoutSec 8
    return [bool]$health.ok
  } catch {
    Write-ServiceLog "Local health check failed: $($_.Exception.Message)"
    return $false
  }
}

function Test-PublicHealth {
  try {
    $health = Invoke-RestMethod -Uri "https://$PublicHost/api/health" -TimeoutSec 15
    return [bool]$health.ok
  } catch {
    Write-ServiceLog "Public health check failed: $($_.Exception.Message)"
    return $false
  }
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
    Write-ServiceLog "Stopped $Name pid=$processId"
  } else {
    Write-Host "$Name is not running"
    if ($null -ne $processId) {
      Write-ServiceLog "$Name was not running; removed stale pid=$processId"
    } else {
      Write-ServiceLog "$Name was not running; no pid file"
    }
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
  param([switch]$FromWatchdog)

  Ensure-Directories

  if ($FromWatchdog -and (Test-RemoteDisabled)) {
    Write-Host "Codex window remote is stopped; watchdog will not restart it until service:start is run."
    return
  }

  if (-not $FromWatchdog) {
    Enable-Remote
  }

  Ensure-Build

  $appPid = Read-Pid -Path $AppPidFile
  $tunnelPid = Read-Pid -Path $TunnelPidFile
  $appRunning = Test-Pid -ProcessId $appPid
  $tunnelRunning = Test-Pid -ProcessId $tunnelPid

  if ($appRunning -and (Get-PidAgeSeconds -ProcessId $appPid) -gt 25 -and -not (Test-LocalHealth)) {
    Write-Host "Codex window remote app is running but unhealthy; restarting it."
    Write-ServiceLog "App pid=$appPid failed local health check; restarting"
    Stop-PidFile -Name "Codex window remote app" -Path $AppPidFile
    $appPid = $null
    $appRunning = $false
  }

  if ($tunnelRunning -and $appRunning -and (Get-PidAgeSeconds -ProcessId $tunnelPid) -gt 35 -and -not (Test-PublicHealth)) {
    Write-Host "Cloudflare tunnel is running but public health failed; restarting it."
    Write-ServiceLog "Tunnel pid=$tunnelPid failed public health check; restarting"
    Stop-PidFile -Name "Cloudflare tunnel" -Path $TunnelPidFile
    $tunnelPid = $null
    $tunnelRunning = $false
  }

  if ($appRunning -and $tunnelRunning) {
    Write-Host "Codex window remote app is already running (pid $appPid)"
    Write-Host "Cloudflare tunnel is already running (pid $tunnelPid)"
    Write-Host "Public URL: https://$PublicHost"
    return
  }

  $appLog = Join-Path $LogDir "app.stdout.log"
  $appErr = Join-Path $LogDir "app.stderr.log"
  $tunnelLog = Join-Path $LogDir "cloudflared.stdout.log"
  $tunnelErr = Join-Path $LogDir "cloudflared.stderr.log"
  $nodeExe = if ($appRunning) { "node.exe" } else { Get-NodeExe }
  $cloudflaredExe = if ($tunnelRunning) { "cloudflared.exe" } else { Get-CloudflaredExe }

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
  Disable-Remote
  Stop-PidFile -Name "Cloudflare tunnel" -Path $TunnelPidFile
  Stop-PidFile -Name "Codex window remote app" -Path $AppPidFile
}

function Show-Status {
  Ensure-Directories
  $appPid = Read-Pid -Path $AppPidFile
  $tunnelPid = Read-Pid -Path $TunnelPidFile
  $appRunning = Test-Pid -ProcessId $appPid
  $tunnelRunning = Test-Pid -ProcessId $tunnelPid
  $watchdogInstalled = Test-WatchdogTaskInstalled
  $startupCmdExists = Test-Path -LiteralPath $StartupCmd
  $remoteDisabled = Test-RemoteDisabled

  Write-Host "App running: $appRunning $(if ($appPid) { "(pid $appPid)" })"
  Write-Host "Tunnel running: $tunnelRunning $(if ($tunnelPid) { "(pid $tunnelPid)" })"
  Write-Host "Auto-start disabled: $remoteDisabled"
  Write-Host "Watchdog task installed: $watchdogInstalled"
  Write-Host "Startup command installed: $startupCmdExists"
  Write-Host "Startup installed: $($watchdogInstalled -or $startupCmdExists)"
  Write-Host "Local URL: http://localhost:8787"
  Write-Host "Public URL: https://$PublicHost"

  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/health" -TimeoutSec 15
    Write-Host "Health: $($health.ok)"
  } catch {
    Write-Host "Health: unavailable"
  }
}

function Install-StartupTask {
  $action = New-ScheduledTaskAction `
    -Execute "wscript.exe" `
    -Argument "//B `"$WatchdogScript`"" `
    -WorkingDirectory $ProjectRoot
  $logonTrigger = New-ScheduledTaskTrigger -AtLogOn
  $watchdogTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
  $principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -WakeToRun `
    -Hidden `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

  try {
    Register-ScheduledTask `
      -TaskName $TaskName `
      -Action $action `
      -Trigger @($logonTrigger, $watchdogTrigger) `
      -Principal $principal `
      -Settings $settings `
      -Description "Keeps the Codex Window Remote app and Cloudflare tunnel running." `
      -Force | Out-Null

    Remove-Item -LiteralPath $StartupCmd -Force -ErrorAction SilentlyContinue
    Write-Host "Installed watchdog task: $TaskName"
    Write-ServiceLog "Installed watchdog scheduled task $TaskName"
    Update-WatchdogTaskSettings
  } catch {
    Write-ServiceLog "Scheduled task install failed: $($_.Exception.Message)"
    $taskRun = "wscript.exe //B `"$WatchdogScript`""
    & schtasks.exe /Create /TN $TaskName /SC MINUTE /MO 1 /TR $taskRun /F | Out-Host
    if ($LASTEXITCODE -eq 0) {
      Remove-Item -LiteralPath $StartupCmd -Force -ErrorAction SilentlyContinue
      Write-Host "Installed watchdog task with schtasks.exe: $TaskName"
      Write-ServiceLog "Installed watchdog scheduled task with schtasks.exe $TaskName"
      Update-WatchdogTaskSettings
      return
    }

    Write-ServiceLog "schtasks.exe install failed with exit code $LASTEXITCODE"
    $command = "@echo off`r`nwscript.exe //B `"$WatchdogScript`"`r`n"
    Set-Content -LiteralPath $StartupCmd -Value $command -Encoding ascii
    Write-Host "Scheduled task unavailable; installed startup command: $StartupCmd"
  }
}

function Uninstall-StartupTask {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  & schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null
  Remove-Item -LiteralPath $StartupCmd -Force -ErrorAction SilentlyContinue
  Write-Host "Removed startup task/watchdog: $TaskName"
  Write-ServiceLog "Removed startup task/watchdog $TaskName"
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
  "watchdog" {
    Start-Remote -FromWatchdog
  }
  "stop" {
    Stop-Remote
  }
  "restart" {
    Enable-Remote
    Stop-Remote
    Start-Remote
  }
  "status" {
    Show-Status
  }
}
