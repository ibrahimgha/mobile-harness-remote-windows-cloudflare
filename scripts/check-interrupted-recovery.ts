import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "interrupted-recovery-"));
process.env.CODEX_SESSIONS_DIR = path.join(root, "sessions");
process.env.CODEX_ACTIVITY_TERMINAL_STATE = path.join(root, "terminals.json");
const { listActiveSessionRuns } = await import("../server/sessionActivity.js");
const chatId = "01a11648-02a8-7461-b954-da3176fd1eaf";
const liveChatId = "49c181d9-cdf9-48da-ba78-42aa9dcdbfc6";
const startedAt = new Date(Date.now() - 60_000).toISOString();
try {
  fs.mkdirSync(process.env.CODEX_SESSIONS_DIR!, { recursive: true });
  const start = JSON.stringify({ timestamp: startedAt, type: "event_msg", payload: { type: "task_started", turn_id: "old-turn" } });
  const abort = JSON.stringify({ timestamp: new Date().toISOString(), type: "event_msg", payload: { type: "turn_aborted", reason: "interrupted" } });
  fs.writeFileSync(path.join(process.env.CODEX_SESSIONS_DIR!, `rollout-${chatId}.jsonl`), `${start}\n${abort}\n`);
  fs.writeFileSync(path.join(process.env.CODEX_SESSIONS_DIR!, `rollout-${liveChatId}.jsonl`), `${start}\n`);
  let active = await listActiveSessionRuns(true);
  assert.equal(active.some(run => run.chatId === chatId), false, "aborted run cannot block its queued resume as an external writer");
  assert.equal(active.some(run => run.chatId === liveChatId), true, "unrelated live writer remains protected");
  const newerStart = JSON.stringify({ timestamp: new Date().toISOString(), type: "event_msg", payload: { type: "task_started", turn_id: "resumed-turn" } });
  fs.appendFileSync(path.join(process.env.CODEX_SESSIONS_DIR!, `rollout-${chatId}.jsonl`), `${newerStart}\n`);
  active = await listActiveSessionRuns(true);
  assert.equal(active.some(run => run.chatId === chatId), true, "resumed turn becomes active even with a cached previous aborted result");
  fs.appendFileSync(path.join(process.env.CODEX_SESSIONS_DIR!, `rollout-${chatId}.jsonl`), `${abort}\n`);
  active = await listActiveSessionRuns(true);
  assert.equal(active.some(run => run.chatId === chatId), false, "repeated interruption releases the reservation again");
  assert.equal(active.some(run => run.chatId === liveChatId), true);
  console.log("PASS: disk-backed activity scanner releases aborted runs, refreshes cached resumed turns, handles repeated interruptions, and preserves unrelated active writers.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
