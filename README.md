# Codex Window Remote

A local web control surface for a running Codex desktop window. It is designed to be served from this laptop and exposed through a Cloudflare tunnel.

## What Is Scaffolded

- React/Vite authenticated chat UI at `http://localhost:5173`
- Express bridge API at `http://localhost:8787`
- WebSocket event stream at `/ws`
- Codex session browser grouped by project folder
- Windows-focused Codex window control through PowerShell and `WScript.Shell`
- Simulation mode by default
- Token-gated control actions for tunneled use

## Quick Start

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open `http://localhost:5173`.

## Cloudflare Tunnel

This deployment has a named Cloudflare tunnel and DNS route:

```text
https://mobile-harness-remote-windows-cloudflare-ibrahim-hp.bit68-infra.com
```

Start and stop the local production app plus tunnel:

```powershell
npm run service:start
npm run service:stop
npm run service:status
```

Install or remove logon startup persistence:

```powershell
npm run service:install
npm run service:uninstall
```

Ad-hoc development tunnel:

```powershell
npm run tunnel:dev
```

Production build and tunnel:

```powershell
npm run build
npm run start
npm run tunnel:prod
```

## Enabling Real Window Control

Edit `.env` before exposing the app:

```dotenv
ENABLE_WINDOW_CONTROL=true
CONTROL_TOKEN=use-a-long-random-secret
CODEX_WINDOW_TITLE=Codex
```

The UI stores the token in browser local storage and sends it with control actions.

## API

```http
GET /api/state
POST /api/actions/focus
POST /api/actions/send-text
POST /api/actions/hotkey
```

Control requests use:

```http
x-control-token: your-token
```

Supported hotkeys: `enter`, `escape`, `ctrl-c`, `ctrl-v`, `ctrl-a`, `ctrl-l`, `page-up`, `page-down`.

## Safety Notes

The server listens on `0.0.0.0` because the app is meant to be reachable through a tunnel. Keep `ENABLE_WINDOW_CONTROL=false` until `CONTROL_TOKEN` is set. Prefer Cloudflare Access in front of the tunnel for another authentication layer.
