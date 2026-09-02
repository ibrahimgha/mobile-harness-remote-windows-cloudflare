param(
  [string]$Target = "vm13",
  [string]$DisplayUser = "ibrahim",
  [switch]$ResetState
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

function Unprotect-Value([string]$Ciphertext) {
  if ([string]::IsNullOrWhiteSpace($Ciphertext)) { return "" }
  $bytes = [Convert]::FromBase64String($Ciphertext)
  $clear = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  return [Text.Encoding]::UTF8.GetString($clear)
}

$root = Split-Path -Parent $PSScriptRoot
$profilePath = Join-Path $env:LOCALAPPDATA "CodexControlRoom\instances\secondary\machine-profiles.json"
$dashboardPath = Join-Path $env:LOCALAPPDATA "CodexRemoteWindowsApps\Shared\saved-dashboards.json"
foreach ($path in @($profilePath, $dashboardPath)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Required shared control-room library is missing: $path" }
}

$profiles = (Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json).machines
$machines = @{}
foreach ($machine in $profiles) {
  $machines[$machine.id] = @{
    id = $machine.id
    name = $machine.name
    url = $machine.url
    token = Unprotect-Value $machine.encryptedToken
  }
}

$saved = (Get-Content -LiteralPath $dashboardPath -Raw | ConvertFrom-Json).dashboards
$dashboards = @{}
foreach ($dashboard in $saved) {
  $dashboards[$dashboard.id] = @{
    id = $dashboard.id
    name = $dashboard.name
    url = $dashboard.url
    credential = @{
      mode = $dashboard.credentialMode
      username = Unprotect-Value $dashboard.encryptedUsername
      password = Unprotect-Value $dashboard.encryptedPassword
      autoSubmit = [bool]$dashboard.autoSubmit
    }
  }
}

$config = [ordered]@{ version = 2; dashboards = @(); machines = @() }
foreach ($dashboard in $dashboards.Values) {
  $config.dashboards += @{
    id = $dashboard.id; type = "dashboard"; name = $dashboard.name; url = $dashboard.url
    credential = $dashboard.credential
  }
}
foreach ($machine in $machines.Values) {
  $config.machines += @{ id = $machine.id; type = "machine"; name = $machine.name; url = $machine.url; token = $machine.token }
}

$json = $config | ConvertTo-Json -Depth 10 -Compress
$remoteBase = "/home/$DisplayUser/.local/share/codex-control-room-native"
$remoteConfig = "/home/$DisplayUser/.config/codex-control-room-native"
$remoteBin = "/home/$DisplayUser/.local/bin"
$remoteAutostart = "/home/$DisplayUser/.config/autostart"

ssh $Target "sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 libwebkit2gtk-4.1-0 && sudo install -d -o $DisplayUser -g $DisplayUser -m 700 '$remoteBase' '$remoteConfig' '$remoteBin' '$remoteAutostart'"
scp (Join-Path $root "native\rpi-control-room\control_room.py") "${Target}:/tmp/codex-control-room-native.py"
scp (Join-Path $root "native\rpi-control-room\codex-control-room-native.desktop") "${Target}:/tmp/codex-control-room-native.desktop"
scp (Join-Path $root "native\rpi-control-room\control-room.svg") "${Target}:/tmp/control-room.svg"
$json | ssh $Target "sudo -u $DisplayUser sh -c 'umask 077; tr -d \\r > $remoteConfig/config.json'"
if ($ResetState) {
  $blankState = [ordered]@{ version = 2; columns = 5; rows = 3; fullscreen = $true; nextId = 16; tiles = @() }
  for ($index = 0; $index -lt 15; $index++) {
    $blankState.tiles += @{ id = "tab-$($index + 1)"; row = [math]::Floor($index / 5); column = $index % 5; rowSpan = 1; columnSpan = 1; mode = "empty"; url = ""; title = "" }
  }
  ($blankState | ConvertTo-Json -Depth 6 -Compress) | ssh $Target "sudo -u $DisplayUser sh -c 'umask 077; tr -d \\r > $remoteConfig/state.json'"
}
ssh $Target "sudo install -o $DisplayUser -g $DisplayUser -m 755 /tmp/codex-control-room-native.py '$remoteBase/control_room.py' && sudo install -o $DisplayUser -g $DisplayUser -m 644 /tmp/control-room.svg '$remoteBase/control-room.svg' && sudo ln -sfn '$remoteBase/control_room.py' '$remoteBin/codex-control-room-native' && sudo install -o $DisplayUser -g $DisplayUser -m 644 /tmp/codex-control-room-native.desktop '$remoteAutostart/codex-control-room-native.desktop' && sudo install -d -o $DisplayUser -g $DisplayUser -m 755 '/home/$DisplayUser/Desktop' '/home/$DisplayUser/.local/share/applications' && sudo install -o $DisplayUser -g $DisplayUser -m 755 /tmp/codex-control-room-native.desktop '/home/$DisplayUser/Desktop/Codex Control Room.desktop' && sudo install -o $DisplayUser -g $DisplayUser -m 644 /tmp/codex-control-room-native.desktop '/home/$DisplayUser/.local/share/applications/codex-control-room-native.desktop' && sudo rm -f /tmp/codex-control-room-native.py /tmp/codex-control-room-native.desktop /tmp/control-room.svg && sudo chmod 600 '$remoteConfig/config.json'"

Write-Host "Native control room deployed to $Target for display user $DisplayUser (secrets not displayed)."
