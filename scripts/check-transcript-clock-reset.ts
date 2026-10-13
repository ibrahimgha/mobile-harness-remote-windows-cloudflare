import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mergeTranscriptWindow } from "../src/chatRefresh.js";

const earlier = { id: "old", createdAt: "2026-10-13T19:00:00Z" };
const later = { id: "new", createdAt: "2026-10-13T17:00:00Z" };
assert.deepEqual(mergeTranscriptWindow([earlier], [later], (a, b) => a.id === b.id), [earlier, later]);

const root = await fs.mkdtemp(path.join(os.tmpdir(), "remote-clock-reset-"));
process.env.CODEX_SESSIONS_DIR = root;
process.env.CODEX_SESSION_INDEX = path.join(root, "index.jsonl");
const id = "11111111-2222-4333-8444-555555555555";
const record = (timestamp: string, role: string, text: string) => ({
  timestamp, type: "response_item",
  payload: { type: "message", role, ...(role === "assistant" ? { phase: "final_answer" } : {}),
    content: [{ type: role === "user" ? "input_text" : "output_text", text }] }
});
try {
  const records = [
    { timestamp: "2026-10-13T19:00:00Z", type: "session_meta", payload: { id, cwd: root, timestamp: "2026-10-13T19:00:00Z" } },
    record("2026-10-13T19:00:01Z", "user", "before reboot"),
    record("2026-10-13T19:00:02Z", "assistant", "old answer"),
    record("2026-10-13T17:00:01Z", "user", "after reboot"),
    record("2026-10-13T17:00:02Z", "assistant", "new answer")
  ];
  await fs.writeFile(path.join(root, `rollout-${id}.jsonl`), records.map(r => JSON.stringify(r)).join("\n") + "\n");
  const { getChat } = await import("../server/codexSessions.js");
  for (const messageMode of ["final", "codex"] as const) {
    const chat = await getChat(id, { detailTurns: 1, messageMode });
    assert.deepEqual(chat?.messages.filter(m => m.role !== "system").map(m => m.text), ["after reboot", "new answer"]);
    const full = await getChat(id, { detailTurns: 10, messageMode });
    assert.deepEqual(full?.messages.filter(m => m.role !== "system").map(m => m.text), ["before reboot", "old answer", "after reboot", "new answer"]);
  }
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log("Transcript order and pagination survive clock rollback in Final and Codex modes.");
