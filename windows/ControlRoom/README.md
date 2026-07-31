# Codex Control Room

The Windows control room opens a configurable grid of independent Codex Remote workspaces in one high-density native WebView2 window. The Settings panel supports 4 through 8 columns and 1 through 3 rows, and persists the selected geometry. Every workspace can switch between configured machines, projects, and chats while retaining the complete Codex Remote controls. Reinstalling the wrapper adds a fresh app-version query so WebView2 does not keep an obsolete cached control-room shell after deployment.

Each workspace has an independent display-power control. Turning a display off replaces that square with a black standby panel while its iframe remains mounted and connected; waking it reveals the same live session without reloading.

Install or refresh the app and its encrypted machine credentials:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\ControlRoom\Install-ControlRoom.ps1
```

The installer reads the local remote token from this repository's `.env`, reads the ThinkCentre 10 and TC1 tokens over their existing SSH profiles, encrypts all three with Windows DPAPI for the current user, builds the native wrapper, and creates Start Menu and Desktop shortcuts.

The app opens:

```text
https://mobile-harness-remote-windows-cloudflare-ibrahim-hp.bit68-infra.com/control-room
```

Machine tokens are posted from the native wrapper into the page at runtime; they are never placed in iframe URLs.
