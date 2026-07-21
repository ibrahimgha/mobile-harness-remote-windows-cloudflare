param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [ValidateRange(1, 60)]
  [int]$PollSeconds = 3,
  [ValidateRange(1, 1440)]
  [int]$MaxWaitMinutes = 120,
  [string]$LogPath = "",
  [string]$TaskName = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$runtimeDir = Join-Path $ProjectRoot ".runtime"
if ([string]::IsNullOrWhiteSpace($LogPath)) {
  $LogPath = Join-Path $runtimeDir "restart-when-idle.log"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null

function Write-RestartLog {
  param([string]$Message)

  Add-Content -LiteralPath $LogPath -Value ("{0} {1}" -f [DateTimeOffset]::Now.ToString("o"), $Message)
}

function Get-ControlToken {
  $envPath = Join-Path $ProjectRoot ".env"
  $line = Get-Content -LiteralPath $envPath |
    Where-Object { $_ -match "^\s*CONTROL_TOKEN\s*=" } |
    Select-Object -Last 1

  if ([string]::IsNullOrWhiteSpace($line)) {
    throw "CONTROL_TOKEN is missing from $envPath"
  }

  return ($line -replace "^\s*CONTROL_TOKEN\s*=\s*", "").Trim().Trim('"').Trim("'")
}

function Get-RemoteState {
  param([string]$Token)

  return Invoke-RestMethod `
    -Uri "http://127.0.0.1:8787/api/state" `
    -Headers @{ "x-control-token" = $Token } `
    -TimeoutSec 10
}

function Append-ProcessOutput {
  param([string]$Path)

  if (Test-Path -LiteralPath $Path) {
    Get-Content -LiteralPath $Path | ForEach-Object { Write-RestartLog $_ }
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  }
}

try {
  Write-RestartLog "Restart helper started"
  $token = Get-ControlToken
  $deadline = (Get-Date).AddMinutes($MaxWaitMinutes)
  $ready = $false

  while ((Get-Date) -lt $deadline) {
    try {
      $state = Get-RemoteState -Token $token
      $activeJobs = [int]$state.runner.activeJobs
      $queuedJobs = [int]$state.runner.queuedJobs
      Write-RestartLog "activeJobs=$activeJobs queuedJobs=$queuedJobs"

      if ($activeJobs -eq 0 -and $queuedJobs -eq 0) {
        $ready = $true
        break
      }
    } catch {
      Write-RestartLog "State check failed: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds $PollSeconds
  }

  if (-not $ready) {
    throw "Timed out waiting for active and queued workers; backend was not restarted"
  }

  Start-Sleep -Seconds 5
  $appPidPath = Join-Path $runtimeDir "codex-window-remote-app.pid"
  $oldAppProcessId = Get-Content -LiteralPath $appPidPath | Select-Object -Last 1
  $serviceScript = Join-Path $ProjectRoot "scripts\service.ps1"
  $stdoutPath = "$LogPath.restart.stdout"
  $stderrPath = "$LogPath.restart.stderr"

  Write-RestartLog "Restarting backend oldPid=$oldAppProcessId"
  $restartProcess = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$serviceScript`"", "restart") `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath

  # Start-Process -Wait follows the restarted service's descendant process tree on
  # Windows, so it never returns while the new backend is healthy and running.
  # Wait only for the short-lived service command itself.
  if (-not $restartProcess.WaitForExit(120000)) {
    throw "Service restart command did not exit within 120 seconds"
  }

  Append-ProcessOutput -Path $stdoutPath
  Append-ProcessOutput -Path $stderrPath

  if ($restartProcess.ExitCode -ne 0) {
    throw "Service restart exited with code $($restartProcess.ExitCode)"
  }

  Start-Sleep -Seconds 8
  $live = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/live" -TimeoutSec 10
  $newAppProcessId = Get-Content -LiteralPath $appPidPath | Select-Object -Last 1

  if (-not [bool]$live.ok) {
    throw "Backend health endpoint did not return ok"
  }

  if ($newAppProcessId -eq $oldAppProcessId) {
    throw "Backend PID did not change from $oldAppProcessId"
  }

  Write-RestartLog "Restart verified newPid=$newAppProcessId health=True"

  if (-not [string]::IsNullOrWhiteSpace($TaskName)) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  }
} catch {
  Write-RestartLog "Restart failed: $($_.Exception.Message)"
  exit 1
}
