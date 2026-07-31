# Codex Window Remote

A local web control surface for a running Codex desktop window. It is designed to be served from this laptop and exposed through a Cloudflare tunnel.

## What Is Scaffolded

- React/Vite authenticated chat UI at `http://localhost:5173`
- Express bridge API at `http://localhost:8787`
- WebSocket event stream at `/ws`
- Codex session browser grouped by project folder
- Exact-session prompt routing through `codex exec resume <session-id>`
- Remote project folder creation and remote new-chat creation inside an existing project
- Windows-focused Codex window control through PowerShell and `WScript.Shell`
- Simulation mode by default
- Token-gated control actions for tunneled use

## Quick Start

Prerequisites:

- Node.js 20+
- Git
- Codex CLI installed and signed in as the same OS user that owns the Codex chats
- Optional: `cloudflared` for public tunnel access

Install:

```powershell
git clone https://github.com/ibrahimgha/mobile-harness-remote-windows-cloudflare.git
cd mobile-harness-remote-windows-cloudflare
npm ci
Copy-Item .env.example .env
```

Edit `.env` and set at least:

```dotenv
CONTROL_TOKEN=use-a-long-random-secret
ENABLE_WINDOW_CONTROL=false
CODEX_RUN_BYPASS_SANDBOX=true
CODEX_RUN_SKIP_GIT_REPO_CHECK=true
CODEX_NEW_PROJECTS_ROOT=C:\Users\your-user
```

Run for development:

```powershell
npm run dev
```

Open `http://localhost:5173`.

Run for production:

```powershell
npm run build
npm run start
```

On Windows, use the bundled service commands:

```powershell
npm run service:start
npm run service:stop
npm run service:status
```

On Linux, run the app with `npm run start` behind your own process manager such as `systemd`; keep `ENABLE_WINDOW_CONTROL=false`.

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

## Windows App Wrapper

Install the multi-device `Codex Control Room` Windows app:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\ControlRoom\Install-ControlRoom.ps1
```

It opens a ten-workspace wall optimized for 4K and ultrawide monitors. Each workspace independently selects a machine, project, and chat while exposing the full remote controls. A per-workspace display control blanks an individual square while preserving its live remote session for instant wake. The installer authenticates the local, ThinkCentre 10, and TC1 remotes using current-user DPAPI-encrypted credentials.

Install the `Ibrahim HP` Windows app shortcut for the public remote URL:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\IbrahimHP\Install-IbrahimHP.ps1
```

It opens the remote in Microsoft Edge or Google Chrome app mode with a custom icon. To remove it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\IbrahimHP\Uninstall-IbrahimHP.ps1
```

Install the `seo-man` Windows app shortcut for the VM13 remote URL:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\SeoMan\Install-SeoMan.ps1
```

## Enabling Remote Control

Edit `.env` before exposing the app:

```dotenv
CONTROL_TOKEN=use-a-long-random-secret
```

Chat prompts are routed by session id through the local Codex CLI, so they do not depend on whichever Codex window has focus. The UI stores the token in browser local storage and sends it with control actions.

Remote prompts use `codex exec resume <session-id>`, which appends the prompt and assistant response to the same native Codex session files read by the desktop app. Chat prompt submissions always enter the serialized runner queue; a queued prompt is not launched until the active Codex run exits. Completed jobs verify that the prompt and response are present in the Codex transcript; the command queue shows that visibility status.

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

Remote project creation uses `CODEX_NEW_PROJECTS_ROOT` as the parent folder. If unset, it defaults to the OS user home directory.

## API

```http
GET /api/state
GET /api/debug/events
GET /api/jobs
POST /api/projects
POST /api/chats
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
