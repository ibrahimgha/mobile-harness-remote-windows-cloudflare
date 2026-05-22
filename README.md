# Codex Window Remote

A local web control surface for a running Codex desktop window. It is designed to be served from this laptop and exposed through a Cloudflare tunnel.

## What Is Scaffolded

- React/Vite authenticated chat UI at `http://localhost:5173`
- Express bridge API at `http://localhost:8787`
- WebSocket event stream at `/ws`
- Codex session browser grouped by project folder
- Exact-session prompt routing through `codex exec resume <session-id>`
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

## Enabling Remote Control

Edit `.env` before exposing the app:

```dotenv
CONTROL_TOKEN=use-a-long-random-secret
```

Chat prompts are routed by session id through the local Codex CLI, so they do not depend on whichever Codex window has focus. The UI stores the token in browser local storage and sends it with control actions.

Remote prompts use `codex exec resume <session-id>`, which appends the prompt and assistant response to the same native Codex session files read by the desktop app. Completed jobs verify that the prompt and response are present in the Codex transcript; the command queue shows that visibility status.

Optional knobs:

```dotenv
CODEX_CLI_PATH=C:\Users\ibrah\AppData\Local\OpenAI\Codex\bin\codex.exe
CODEX_RUN_BYPASS_SANDBOX=true
CODEX_RUN_SKIP_GIT_REPO_CHECK=true
CODEX_RUN_MODE=simulation
ENABLE_WINDOW_CONTROL=false
CODEX_WINDOW_TITLE=Codex
```

`ENABLE_WINDOW_CONTROL` only affects the lower-level focus/hotkey endpoints. Leave it off for normal exact-session prompt routing.

## API

```http
GET /api/state
GET /api/debug/events
GET /api/jobs
POST /api/chats/:id/prompt
POST /api/actions/focus
POST /api/actions/send-text
POST /api/actions/hotkey
```

Control requests use:

```http
x-control-token: your-token
```

Supported hotkeys: `enter`, `escape`, `ctrl-c`, `ctrl-v`, `ctrl-a`, `ctrl-l`, `page-up`, `page-down`.

## Debugging Logs

The service writes process logs, structured bridge events, and Codex CLI run logs under `logs/`:

```powershell
Get-Content logs\bridge-events.jsonl -Tail 20
Get-Content logs\app.stderr.log -Tail 80
Get-ChildItem logs\codex-runs | Sort-Object LastWriteTime -Descending | Select-Object -First 10
```

Prompt audit events include prompt length, a short whitespace-normalized preview, a SHA-256 hash, request metadata, and the exact Codex CLI job/log paths. Full prompt text is not logged unless `LOG_FULL_PROMPTS=true` is set.

## Safety Notes

The server listens on `0.0.0.0` because the app is meant to be reachable through a tunnel. Keep `ENABLE_WINDOW_CONTROL=false` until `CONTROL_TOKEN` is set. Prefer Cloudflare Access in front of the tunnel for another authentication layer.
