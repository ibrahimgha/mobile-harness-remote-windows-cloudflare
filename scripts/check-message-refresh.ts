import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mergeTranscriptWindow, preserveOptimisticRunSettings } from "../src/chatRefresh.js";
import { resolveTranscriptTailBytes } from "../server/codexSessions.js";

type TestMessage = {
  id: string;
  createdAt: string;
  text: string;
};

const sameItem = (a: TestMessage, b: TestMessage) =>
  a.id === b.id || (a.createdAt === b.createdAt && a.text === b.text);

const current: TestMessage[] = [
  { id: "turn-1", createdAt: "2026-07-10T00:00:01.000Z", text: "first" },
  { id: "turn-2", createdAt: "2026-07-10T00:00:02.000Z", text: "second" }
];
const incoming: TestMessage[] = [
  { id: "turn-2", createdAt: "2026-07-10T00:00:02.000Z", text: "second updated" },
  { id: "turn-3", createdAt: "2026-07-10T00:00:03.000Z", text: "third" }
];

assert.deepEqual(
  mergeTranscriptWindow(current, incoming, sameItem).map((message) => message.id),
  ["turn-1", "turn-2", "turn-3"],
  "a moving server window must not evict the already-rendered prefix"
);
assert.equal(
  mergeTranscriptWindow(current, incoming, sameItem)[1]?.text,
  "second updated",
  "incoming content must replace the matching rendered item"
);

const reidentifiedIncoming: TestMessage[] = [
  { id: "server-turn-2", createdAt: "2026-07-10T00:00:02.000Z", text: "second" }
];

assert.deepEqual(
  mergeTranscriptWindow(current, reidentifiedIncoming, sameItem).map((message) => message.id),
  ["turn-1", "server-turn-2"],
  "the same transcript item with a new backend ID must not render twice"
);

assert.deepEqual(
  preserveOptimisticRunSettings(
    { id: "server-prompt", model: undefined, reasoningEffort: undefined },
    { model: "gpt-5.6-sol", reasoningEffort: "ultra" }
  ),
  { id: "server-prompt", model: "gpt-5.6-sol", reasoningEffort: "ultra" },
  "the first server echo must not erase optimistic model metadata"
);
assert.deepEqual(
  preserveOptimisticRunSettings(
    { id: "server-prompt", model: "gpt-5.6-terra", reasoningEffort: "low" },
    { model: "gpt-5.6-sol", reasoningEffort: "ultra" }
  ),
  { id: "server-prompt", model: "gpt-5.6-terra", reasoningEffort: "low" },
  "authoritative server metadata must replace optimistic settings when present"
);

const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-remote-history-"));
const sessionPath = path.join(temporaryDirectory, "session.jsonl");

try {
  const records: string[] = [];
  for (let turn = 1; turn <= 20; turn += 1) {
    records.push(
      JSON.stringify({
        timestamp: `2026-07-10T00:${String(turn).padStart(2, "0")}:00.000Z`,
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: `prompt ${turn}` }] }
      }),
      JSON.stringify({
        timestamp: `2026-07-10T00:${String(turn).padStart(2, "0")}:01.000Z`,
        type: "response_item",
        payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: `response ${turn}` }] }
      }),
      JSON.stringify({
        timestamp: `2026-07-10T00:${String(turn).padStart(2, "0")}:02.000Z`,
        type: "response_item",
        payload: { type: "function_call_output", output: "x".repeat(32_000) }
      })
    );
  }

  await fs.writeFile(sessionPath, `${records.join("\n")}\n`);
  const stat = await fs.stat(sessionPath);
  const resolvedBytes = await resolveTranscriptTailBytes(sessionPath, stat.size, 1024, 11);

  assert.ok(resolvedBytes > 1024, "a tool-heavy transcript must expand beyond its initial byte tail");
  assert.ok(resolvedBytes < stat.size, "history pagination should not require reading the whole session when enough turns are near the tail");
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
