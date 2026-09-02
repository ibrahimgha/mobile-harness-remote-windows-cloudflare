import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mergeTranscriptWindow, preserveOptimisticRunSettings } from "../src/chatRefresh.js";
import { parseSessionFile, resolveTranscriptTailBytes } from "../server/codexSessions.js";
import { attachPromptRunSettings } from "../server/promptRunSettings.js";
import { createHash } from "node:crypto";
import type { ChatDetail, CodexRunJob } from "../server/types.js";

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
    { id: "server-prompt", model: undefined, reasoningEffort: undefined, speed: undefined },
    { model: "gpt-5.6-sol", reasoningEffort: "ultra", speed: "priority" }
  ),
  { id: "server-prompt", model: "gpt-5.6-sol", reasoningEffort: "ultra", speed: "priority" },
  "the first server echo must not erase optimistic model, reasoning, or speed metadata"
);
assert.deepEqual(
  preserveOptimisticRunSettings(
    { id: "server-prompt", model: "gpt-5.6-terra", reasoningEffort: "low", speed: "default" },
    { model: "gpt-5.6-sol", reasoningEffort: "ultra", speed: "priority" }
  ),
  { id: "server-prompt", model: "gpt-5.6-terra", reasoningEffort: "low", speed: "default" },
  "authoritative server metadata must replace optimistic settings when present"
);

const submittedText = "Ship the exact prompt metadata";
const submittedAt = "2026-07-10T00:00:00.000Z";
const settings = { model: "gpt-5.6-sol", reasoningEffort: "high" as const, speed: "priority" as const, updatedAt: submittedAt };
const chat = {
  id: "chat-settings",
  messages: [
    { id: "prompt", role: "user" as const, kind: "user_prompt" as const, label: "You", text: submittedText, createdAt: submittedAt },
    { id: "reply", role: "assistant" as const, kind: "assistant_final" as const, isFinal: true, text: "Done", createdAt: "2026-07-10T00:00:05.000Z" }
  ]
} as ChatDetail;
const job = {
  id: "job-settings",
  chatId: chat.id,
  projectPath: "C:\\work",
  status: "completed",
  kind: "prompt",
  createdAt: submittedAt,
  promptPreview: submittedText,
  promptHash: createHash("sha256").update(submittedText).digest("hex"),
  textLength: submittedText.length,
  command: [],
  settings,
  logPaths: { stdout: "out", stderr: "err", lastMessage: "last" }
} as CodexRunJob;
const enriched = attachPromptRunSettings(chat, [job]);
assert.equal(enriched.messages[0]?.speed, "priority", "the exact submitted speed is restored onto a reloaded prompt");
assert.equal(enriched.messages[1]?.speed, "priority", "the response retains the speed of its prompt turn");

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
        timestamp: `2026-07-10T00:${String(turn).padStart(2, "0")}:00.250Z`,
        type: "response_item",
        payload: { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: `update one ${turn}` }] }
      }),
      JSON.stringify({
        timestamp: `2026-07-10T00:${String(turn).padStart(2, "0")}:00.500Z`,
        type: "response_item",
        payload: { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: `update two ${turn}` }] }
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

  const parsed = await parseSessionFile(sessionPath, new Map(), {
    maxTailBytes: stat.size,
    detailedTailBytes: 70_000,
    detailTurns: 10,
    messageMode: "codex"
  });
  const messages = parsed?.messages ?? [];
  const assistantsAfterPrompt = (promptText: string) => {
    const promptIndex = messages.findIndex((message) => message.role === "user" && message.text === promptText);
    const nextPromptIndex = messages.findIndex((message, index) => index > promptIndex && message.role === "user");
    return messages.slice(promptIndex + 1, nextPromptIndex >= 0 ? nextPromptIndex : undefined).filter((message) => message.role === "assistant");
  };

  assert.deepEqual(
    assistantsAfterPrompt("prompt 11").map((message) => message.text),
    ["response 11"],
    "turns older than the detailed byte window must keep only their last response"
  );
  assert.deepEqual(
    assistantsAfterPrompt("prompt 20").map((message) => message.text),
    ["update one 20", "update two 20", "response 20"],
    "turns inside the detailed byte window must retain their Codex updates"
  );
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
