$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$sshdDir = 'C:\Users\ibrah\.ssh\ibrahim-hp-tc11-sshd'
$sshdConfig = Join-Path $sshdDir 'sshd_config'
$tunnelConfig = Join-Path $projectRoot 'ops\cloudflared-ibrahim-hp-ssh-tc11.yml'
$sshdExe = 'C:\Windows\System32\OpenSSH\sshd.exe'
$cloudflaredExe = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'

# The interactive SSH daemon's child consoles do not inherit its hidden state.
# Suppress only this daemon's console descendants, leaving local terminals alone.
Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $PSScriptRoot 'hide-ssh-worker-consoles.ps1') + '"')) -WindowStyle Hidden

$sshd = Get-CimInstance Win32_Process -Filter "name='sshd.exe'" |
    Where-Object { $_.CommandLine -like '*ibrahim-hp-tc11-sshd*' }
if (-not $sshd) {
    Start-Process -FilePath $sshdExe -ArgumentList @('-D', '-e', '-f', $sshdConfig) -WindowStyle Hidden
}

$tunnel = Get-CimInstance Win32_Process -Filter "name='cloudflared.exe'" |
    Where-Object { $_.CommandLine -like '*cloudflared-ibrahim-hp-ssh-tc11.yml*' }
if (-not $tunnel) {
    Start-Process -FilePath $cloudflaredExe -ArgumentList @('--config', $tunnelConfig, 'tunnel', 'run', '82712dcb-7a71-4902-874f-4d724ebb10c3') -WindowStyle Hidden
}
