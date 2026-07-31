# Codex Control Room

The Windows control room opens a configurable grid of independent Codex Remote workspaces in one high-density native WebView2 window. The Settings panel supports 4 through 8 columns and 1 through 3 rows, and persists the selected geometry. Every workspace can switch between configured machines, projects, and chats while retaining the complete Codex Remote controls. Reinstalling the wrapper adds a fresh app-version query so WebView2 does not keep an obsolete cached control-room shell after deployment.

Each workspace has an independent display-power control. Turning a display off replaces that square with a black standby panel while its iframe remains mounted and connected; waking it reveals the same live session without reloading.

The control room remembers its grid, machine assignments, terminated and display-off states, tracker/chat modes, selected chat, side-menu state, and native window size, position, and maximized state. Relaunching restores the previous operating layout; invalid off-screen window coordinates safely fall back to the centered default.

Any square can load and remember a custom HTTP or HTTPS dashboard URL. Custom dashboard squares retain reload, display-off, terminate, URL-edit, and open-separately controls, while the Codex statistics toggle is intentionally omitted. The remote site must permit iframe embedding through its own CSP and `X-Frame-Options` headers.

Install or refresh the app and its encrypted machine credentials:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\ControlRoom\Install-ControlRoom.ps1
```

## Independent instances

Install any number of named instances when separate persistent walls are needed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\ControlRoom\Install-ControlRoom.ps1 -InstanceName "Operations"
powershell -NoProfile -ExecutionPolicy Bypass -File windows\ControlRoom\Install-ControlRoom.ps1 -InstanceName "Dashboards"
```

The no-argument installation remains the **Default** instance and keeps its existing memory. Each named instance receives a separate executable and Windows app identity, WebView2 profile, encrypted credentials, window placement, Start Menu shortcut, and optional Desktop shortcut. Instances can run side by side without sharing layout, selected machines/projects/chats, custom URLs, display states, or cookies. A compact badge in the app header identifies named instances at a glance.

Names automatically produce stable lowercase IDs. Supply `-InstanceId operations-east` when a fixed automation-friendly ID is desired; rerunning the same name or ID upgrades that instance in place and preserves its memory. List installed instances and their current running state with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\ControlRoom\Get-ControlRoomInstances.ps1
```

Create the standard six-instance desktop set with numbered, high-contrast icons:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\ControlRoom\Install-Six-ControlRoomInstances.ps1
```

This preserves Default and Secondary, installs instances 3 through 6 when missing, and creates exactly six numbered Desktop shortcuts. Their lime, cyan, amber, magenta, violet, and coral icon accents remain distinguishable at Windows shortcut sizes. The icon generator is `New-ControlRoomIcons.ps1`; individual installations may also use `Install-ControlRoom.ps1 -CustomIconPath <path-to-ico>`.

The installer reads the local remote token from this repository's `.env`, reads the ThinkCentre 10 and TC1 tokens over their existing SSH profiles, encrypts all three with Windows DPAPI for the current user, builds the native wrapper, and creates Start Menu and Desktop shortcuts.

The app opens:

```text
https://mobile-harness-remote-windows-cloudflare-ibrahim-hp.bit68-infra.com/control-room
```

Machine tokens are posted from the native wrapper into the page at runtime; they are never placed in iframe URLs.
