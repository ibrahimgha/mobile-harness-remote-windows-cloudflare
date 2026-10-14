# Codex Window Remote

## Transcript caching and diagnostic retention

Native chat transcripts are never trimmed by Remote. Unchanged file parses are
cached by file metadata, parse options and indexed chat metadata, with concurrent
reads coalesced and a 64 MiB / 320-entry LRU limit. Heartbeats invalidate the chat
list but retain validated per-file results and tail-window sizing.

New native-run diagnostics store abbreviated JSON records, with approximately
256 KiB per stdout/stderr file and a separate 16 KiB terminal-record allowance.
The live protocol, native session history and final-response recovery files stay
complete. Existing large log files are not rewritten.

Preview retention with `npm run logs:retention`. Only stdout/stderr pairs for
provably completed runs older than 30 days are eligible. Pending jobs, unknown or
failed runs, symlinks, native transcripts and final-response files are preserved.
After reviewing the preview, explicitly apply with
`npm run logs:retention -- --apply --days=30`. There is no scheduled purge.
This diagnostic-retention command is separate from routine task-temp cleanup.

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

## Reordering queued prompts

In a chat's command queue, drag a card's grip left or right on a laptop. On touch screens, hold the grip for 350 ms before dragging. Hold near an edge to scroll through off-screen cards; swipe the card body to browse without reordering. Release to save. Tap the grip for **Move earlier / Move later**, or focus it and use the arrow keys, Home, or End.

The saved order determines execution order and persists across service restarts and machine reboots. Each job retains its prompt, attachments, model, reasoning and speed. Other chats and running jobs are unchanged. If the queue changes during a drag, the latest server order is refreshed instead of overwriting it. Sorting controls appear after the matching backend update is installed.

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

It opens a configurable workspace wall optimized for 4K and ultrawide monitors. Settings provides 1 through 8 columns and 1 through 3 rows, with the selected geometry persisted across restarts. Each workspace independently selects a machine, project, and chat while exposing the full remote controls. A per-workspace display control blanks an individual square while preserving its live remote session for instant wake. The installer authenticates the local, ThinkCentre 10, ThinkCentre 11, and TC1 remotes using current-user DPAPI-encrypted credentials.

Install independently remembered copies that can run at the same time by naming each instance:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\ControlRoom\Install-ControlRoom.ps1 -InstanceName "Operations"
```

The existing no-argument app remains the Default instance and retains its current memory. See `windows\ControlRoom\README.md` for instance listing and fixed-ID options.

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

Remote prompts use `codex app-server --listen stdio://`, with `thread/resume` and `turn/start` targeting the same native Codex session read by the desktop app. Each chat has one active turn and a durable server-side queue. Completed jobs verify that the prompt and response are present in the Codex transcript; the command queue shows that visibility status.

Queue, Steer, and Stop are separate operations:

- Queue waits for the active job to finish and then starts a new turn with that prompt's saved model, reasoning level, and speed.
- Moving a queued prompt back to the composer restores its original editable text and attachment chips. The uploaded file metadata is journaled with the queue across service restarts, and resending reuses those files instead of uploading them again.
- Steer uses native `turn/steer` with the expected active turn ID. It adds the selected queued prompt to that same turn without stopping the worker or starting another one. Native steering keeps the active model, reasoning level, and speed; a queued prompt with different settings remains queued instead of silently changing settings. A steering message is not another completed job.
- Stop requests `turn/interrupt`. Process termination is only a safeguard if an explicit Stop gets stuck, never a steering implementation.

Native steering is available for turns owned by this remote's app-server connection, not arbitrary pre-existing CLI or desktop workers. Retries of a queued steering action use its job ID. The direct `/steer` endpoint requires a stable `clientRequestId`; reuse it for HTTP retries. If delivery is uncertain after disconnection/restart, the complete prompt is saved and held rather than replayed. A late native input confirmation resolves the held prompt automatically; otherwise check the chat before moving it back to the composer and resubmitting. Interrupted running jobs retain the existing same-settings `resume` recovery.

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

## Bundled mobile workflow skill

Each Remote startup installs or updates `skills/codex-remote-mobile` into the service user's `~/.agents/skills/codex-remote-mobile`. `npm run skill:install` installs it separately. Updated installed files receive content-addressed backups under `.runtime/skill-backups`. `CODEX_REMOTE_SKILLS_DIR` selects a custom skills parent directory.

The Remote invokes the skill with each prompt and native steering input. It covers mobile-readable responses, compact tables, real downloadable Markdown artifacts, contextual interpretation of voice transcripts, and visible worker handoffs through the authenticated Remote API. Its guidance is affirmative and follows the user's requested scope and format. Voice provenance travels with the queued job and survives draft restoration and service restarts; the transport context stays out of displayed prompt bubbles.

The installed helper, `scripts/remote-chat.mjs` inside the skill, uses a generated `connection.json` to locate this Remote and its existing `.env` access token. The connection file stores paths and URLs, while authenticated calls load the token into memory. Handoff receipts contain token-free chat links. Set `CODEX_REMOTE_PUBLIC_URL` or `.runtime/codex-remote-connection.json` with `{ "publicUrl": "https://your-remote.example" }` when the public origin cannot be inferred from the tunnel configuration.

`POST /api/chats/:id/prompt` accepts `inputSource` (`typed`, `voice`, or `mixed`) and optional per-prompt `settings` (`model`, `reasoningEffort`, `speed`). Settings apply to that job, leaving the machine's global model slider unchanged. `GET /api/state` reports the active skill name/path under `runner.skill`.

## API

Completion push notifications use a compact result headline with project/chat context underneath. The mobile skill supplies a three- or four-word result as trailing `codex-notification` HTML metadata in normal prose responses; transcript rendering removes that metadata. The same run generates it, and notification formatting also handles earlier jobs using their own result/prompt context. Native jobs retain the label for local notifications as well as Web Push.

Notification taps hand the chat ID directly to an open app and persist the tapped target for cold-launch/auth recovery. The app acknowledges selection, and the requested chat remains selected even when it is absent from the limited sidebar index. Untapped pushes leave selection unchanged. Release packages include the service worker and web manifest, and the app checks worker updates without rotating push subscriptions or VAPID keys.

```http
GET /api/state
GET /api/debug/events
GET /api/jobs
POST /api/projects
POST /api/chats
POST /api/chats/:id/prompt
POST /api/chats/:id/steer
POST /api/chats/:id/queued-prompts/:jobId/steer
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
