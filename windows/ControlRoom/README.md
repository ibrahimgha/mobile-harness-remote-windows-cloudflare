# Codex Control Room

The Windows control room opens ten independent Codex Remote workspaces in one high-density native WebView2 window. Every workspace can switch between configured machines, projects, and chats while retaining the complete Codex Remote controls.

Install or refresh the app and its encrypted machine credentials:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\ControlRoom\Install-ControlRoom.ps1
```

The installer reads the local remote token from this repository's `.env`, reads the ThinkCentre 10 token over the existing SSH profile, encrypts both with Windows DPAPI for the current user, builds the native wrapper, and creates Start Menu and Desktop shortcuts.

The app opens:

```text
https://mobile-harness-remote-windows-cloudflare-ibrahim-hp.bit68-infra.com/control-room
```

Machine tokens are posted from the native wrapper into the page at runtime; they are never placed in iframe URLs.

