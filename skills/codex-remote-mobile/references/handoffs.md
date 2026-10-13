# Codex Remote worker handoffs

## Installed helper

Run `node scripts/remote-chat.mjs ...` with the script path resolved relative to this skill. `CODEX_REMOTE_CONNECTION_FILE` is supplied to workers launched by the Remote; otherwise the helper reads this skill's `connection.json`.

The connection file identifies the Remote's project root, local API URL, public URL, and `.env` path. The helper reads the existing `CONTROL_TOKEN` and authenticates each call. Its output is a compact JSON receipt with token-free links and job metadata. A `--connection /path/to/connection.json` argument selects another configured connection. For another machine, run its installed helper through the existing SSH connection so that machine supplies its own local credentials.

Examples below use `HELPER` for the absolute path to `scripts/remote-chat.mjs` and a real chat UUID selected from `chats`.

```text
node HELPER state
node HELPER chats --query "billing"
node HELPER prompt --chat CHAT_UUID --text-file handoff.md --request-id UNIQUE_REQUEST_ID
node HELPER prompt --chat CHAT_UUID --text-file handoff.md --request-id UNIQUE_REQUEST_ID --model MODEL --reasoning EFFORT --speed default
node HELPER status --chat CHAT_UUID --job JOB_ID
node HELPER read --chat CHAT_UUID --turns 10
node HELPER steer --chat CHAT_UUID --job QUEUED_JOB_ID
node HELPER stop --chat CHAT_UUID --job RUNNING_JOB_ID
```

Use a stable request ID for one logical prompt and reuse it when reconciling a lost HTTP response. `status` and `read` are read-only. `prompt` returns the accepted job immediately, leaving progress visible in the target chat. `--source voice` preserves voice provenance for a directly forwarded transcript; `--source mixed` describes combined typed and spoken text. Ordinary task briefs use typed provenance.

To create a worker in an existing project:

```text
node HELPER create --project /absolute/project/path --title "Billing worker"
node HELPER creation --id RETURNED_PENDING_ID
```

`create` requests a brief ready message. `creation` reports the new chat ID when ready; submit the actual task using `prompt` so it receives a tracked runner job. Save the pending creation ID and check that request through `creation` while it is pending. If the creation response is lost, reconcile the project/chat index by the requested title and creation time before proceeding.

## API equivalents

Use JSON bodies and the `x-control-token` header. Relative endpoints are resolved against the selected Remote's base URL.

- `GET /api/chats` → projects containing chat IDs, titles, paths, and activity.
- `POST /api/chats/:id/prompt` with `{ "text": "...", "clientRequestId": "...", "inputSource": "typed", "settings": { "model": "...", "reasoningEffort": "...", "speed": "default" } }` → queued/started disposition and job. Omitted settings inherit that Remote's current defaults; supplied settings apply to this prompt.
- `GET /api/chats/:id/jobs` → tracked jobs and their status.
- `GET /api/chats/:id?mode=final&turns=10` → visible conversation progress/results.
- `POST /api/chats/:id/queued-prompts/:jobId/steer` → native steering of that queued prompt into the active turn.
- `POST /api/chats/:id/steer` with text and a stable `clientRequestId` → direct native steering. An active native turn is the delivery target, with its model/reasoning/speed retained.
- `POST /api/chats/:id/jobs/:jobId/stop` → explicit cancellation of that tracked running job.
- `POST /api/chats` with `{ "projectPath": "/absolute/project", "title": "Worker name" }` → pending creation ID.
- `GET /api/chat-starts/:pendingId` → creation progress and resulting chat.

The phone link is `<public-remote-url>/?chat=<encoded-chat-id>`. The public origin comes from this Remote's installed connection configuration. API calls can use loopback while receipts use that public origin. For a local-only installation, configure its reachable browser URL in `.runtime/codex-remote-connection.json` or `CODEX_REMOTE_PUBLIC_URL`.

## Handoff brief and receipt

A useful task brief includes the requested outcome, relevant background, exact project/file context available on the target machine, expected artifact formats, verification expectations, and the source chat's URL. Cross-machine files can be transferred through the existing authorized connection and referenced by their target-local paths.

Report the machine and chat name, accepted/queued/running state, job ID, and clickable target-chat URL. State completion after the job status and visible result establish it. For subsequent dependent tasks, pass forward the relevant verified results and accessible artifacts.
