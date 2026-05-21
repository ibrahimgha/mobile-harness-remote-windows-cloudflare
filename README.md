# Codex Window Remote

A local web control surface for a running Codex desktop window. It is designed to be served from this laptop and exposed through a Cloudflare tunnel.

## What Is Scaffolded

- React/Vite control UI at `http://localhost:5173`
- Express bridge API at `http://localhost:8787`
- WebSocket event stream at `/ws`
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

Development tunnel:

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
