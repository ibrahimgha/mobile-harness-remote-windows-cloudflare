import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectConfirmation, splitConfirmationMetadata } from "../shared/confirmation.js";
import { ConfirmationDecisions, confirmationForChat } from "../server/confirmations.js";
import type { ChatDetail, CodexRunJob } from "../server/types.js";

for (const [text, reply] of [
  ["The patch passed. Shall I deploy it?", "proceed"],
  ["Would you like me to apply this fix?", "proceed"],
  ['Reply "ok" to start.', "ok"],
  ['Please reply with "confirmed".', "confirmed"],
  ['Reply "ship it" to deploy.', "ship it"],
  ["Waiting for your approval to deploy.", "confirmed"],
  ['Ready?\n<!-- codex-confirmation: {"reply":"GO AHEAD","summary":"Apply fix"} -->\n<!-- codex-notification: Awaiting deployment approval -->', "GO AHEAD"]
]) assert.equal(detectConfirmation(text)?.reply, reply, text);
for (const text of [
  "Done. I will proceed.", "Which machine should I deploy to?", "Should I deploy or wait?",
  "Please confirm your address.", "What model should I use?", 'Do not reply "proceed".',
  '> Shall I deploy it?', 'Example:\n```\nReply "proceed"\n```',
  '```\n<!-- codex-confirmation: {"reply":"proceed","summary":"Example"} -->\n```'
]) assert.equal(detectConfirmation(text), undefined, text);
const parsed = splitConfirmationMetadata('Ready?\n<!-- codex-confirmation: {"reply":"ok","summary":"Run tests"} -->\n<!-- codex-notification: Tests awaiting approval -->');
assert.equal(parsed.text.includes("codex-confirmation"), false);
assert.equal(parsed.text.includes("codex-notification"), true);
const chat = { id: "test-chat", messages: [{ id: "unstable-page-id", role: "assistant", text: "Shall I deploy it?",
  createdAt: "2026-09-13T10:00:00Z", model: "gpt-6-astra", reasoningEffort: "max", speed: "priority" }] } as ChatDetail;
const first = confirmationForChat(chat, [])!;
assert.equal(first.settings.model, "gpt-6-astra");
assert.equal(first.settings.reasoningEffort, "max");
assert.equal(first.settings.speed, "priority");
chat.messages[0].id = "different-pagination-id";
assert.equal(confirmationForChat(chat, [])?.id, first.id);
assert.equal(confirmationForChat(chat, [{ chatId: chat.id, status: "queued", createdAt: "2026-09-13T10:01:00Z" } as CodexRunJob]), undefined);
assert.equal(confirmationForChat({ ...chat, messages: [...chat.messages, { ...chat.messages[0], role: "user", text: "Do something else" }] }, []), undefined);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "remote-confirmations-"));
try {
  const file = path.join(temp, "decisions.json");
  const store = new ConfirmationDecisions(file);
  let count = 0;
  await Promise.all(Array.from({ length: 10 }, () => store.exclusive(chat.id, async () => {
    if (store.get(chat.id, first.id)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
    store.set(chat.id, first.id, "accepted");
    count++;
  })));
  assert.equal(count, 1, "concurrent clicks make only one decision");
  assert.equal(new ConfirmationDecisions(file).get(chat.id, first.id)?.status, "accepted");
  store.set(chat.id, "next", "dismissed");
  assert.equal(new ConfirmationDecisions(file).get(chat.id, "next")?.status, "dismissed");
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log("Confirmation detection, negative cases, originating settings, pagination, stale requests, concurrency and persistence passed.");
