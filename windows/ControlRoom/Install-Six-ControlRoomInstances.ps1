Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$installer = Join-Path $PSScriptRoot "Install-ControlRoom.ps1"
$iconDirectory = Join-Path $PSScriptRoot "icons"
$baseInstallRoot = Join-Path $env:LOCALAPPDATA "CodexControlRoom"
$desktop = [Environment]::GetFolderPath("Desktop")

$instances = @(
  @{ Number = 1; Id = "default"; Name = "Default"; Exe = Join-Path $baseInstallRoot "app\CodexControlRoom.exe" },
  @{ Number = 2; Id = "secondary"; Name = "Secondary"; Exe = Join-Path $baseInstallRoot "instances\secondary\app\CodexControlRoom-secondary.exe" },
  @{ Number = 3; Id = "instance-3"; Name = "Instance 3"; Exe = Join-Path $baseInstallRoot "instances\instance-3\app\CodexControlRoom-instance-3.exe" },
  @{ Number = 4; Id = "instance-4"; Name = "Instance 4"; Exe = Join-Path $baseInstallRoot "instances\instance-4\app\CodexControlRoom-instance-4.exe" },
  @{ Number = 5; Id = "instance-5"; Name = "Instance 5"; Exe = Join-Path $baseInstallRoot "instances\instance-5\app\CodexControlRoom-instance-5.exe" },
  @{ Number = 6; Id = "instance-6"; Name = "Instance 6"; Exe = Join-Path $baseInstallRoot "instances\instance-6\app\CodexControlRoom-instance-6.exe" }
)

function New-DesktopShortcut {
  param([hashtable]$Instance, [string]$IconPath)

  $shortcutPath = Join-Path $desktop ("Codex Control Room {0} - {1}.lnk" -f $Instance.Number, $Instance.Name)
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $Instance.Exe
  $shortcut.WorkingDirectory = Split-Path -Parent $Instance.Exe
  $shortcut.Description = "Open independent Codex Control Room instance $($Instance.Number)"
  $shortcut.IconLocation = "$IconPath,0"
  $shortcut.Save()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) | Out-Null
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
}

if (-not (Test-Path -LiteralPath (Join-Path $iconDirectory "control-room-6.ico"))) {
  & (Join-Path $PSScriptRoot "New-ControlRoomIcons.ps1") -OutputDirectory $iconDirectory
}

foreach ($instance in $instances) {
  $iconPath = Join-Path $iconDirectory "control-room-$($instance.Number).ico"
  if (-not (Test-Path -LiteralPath $instance.Exe)) {
    if ($instance.Id -eq "default") {
      & $installer -NoDesktopShortcut -CustomIconPath $iconPath
    } else {
      & $installer -NoDesktopShortcut -InstanceId $instance.Id -InstanceName $instance.Name -CustomIconPath $iconPath
    }
  }
  New-DesktopShortcut -Instance $instance -IconPath $iconPath
}

# Replace the two legacy desktop aliases with the numbered six-instance set.
@("Codex Control Room.lnk", "Codex Control Room - Secondary.lnk") | ForEach-Object {
  $legacyPath = Join-Path $desktop $_
  if (Test-Path -LiteralPath $legacyPath) { Remove-Item -LiteralPath $legacyPath -Force }
}

Write-Host "Installed six independent Control Room desktop shortcuts."
