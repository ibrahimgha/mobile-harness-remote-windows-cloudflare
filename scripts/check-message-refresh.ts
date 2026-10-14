import assert from "node:assert/strict";
import "./check-scroll-top";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mergeRunStatusTimeline, mergeTranscriptWindow, preserveOptimisticRunSettings, transcriptRenderItems } from "../src/chatRefresh.js";
import { capturePrependScrollSnapshot, keepPrependScrollAnchor, restoredPrependScrollTop } from "../src/chatScroll.js";
import { parseSessionFile, resolveTranscriptTailBytes } from "../server/codexSessions.js";
import { attachPromptRunSettings } from "../server/promptRunSettings.js";
import { createHash } from "node:crypto";
import type { ChatDetail, CodexRunJob } from "../server/types.js";

type TestMessage = {
  id: string;
  createdAt: string;
  text: string;
};

const atMinute = (minute: number) => `2026-10-14T08:${String(minute).padStart(2, "0")}:00.000Z`;
const stopTranscript: TestMessage[] = [
  { id: "prompt", createdAt: atMinute(14), text: "New task" },
  { id: "response-15", createdAt: atMinute(15), text: "Newer response" },
  { id: "response-17", createdAt: atMinute(17), text: "Latest response" }
];
const stoppedNotice = { id: "run-status-old", createdAt: atMinute(14), text: "Stopped from the remote" };
assert.deepEqual(mergeRunStatusTimeline(stopTranscript, [stoppedNotice]).map(m => m.id), ["prompt", "run-status-old", "response-15", "response-17"]);
assert.equal(mergeRunStatusTimeline(stopTranscript, [stoppedNotice, stoppedNotice]).length, 4, "Polling must not duplicate the stop notice");
assert.deepEqual(mergeRunStatusTimeline(stopTranscript, [
  { id: "failed", createdAt: atMinute(16), text: "Failed" }, stoppedNotice
]).map(m => m.id), ["prompt", "run-status-old", "response-15", "failed", "response-17"]);
assert.deepEqual(stopTranscript.map(m => m.id), ["prompt", "response-15", "response-17"], "Timeline merge must not mutate cached transcript");

const repeatedPrompts: TestMessage[] = Array.from({ length: 30 }, (_, index) => ({
  id: `prompt-${index}`,
  createdAt: new Date(Date.UTC(2026, 8, 1, 10, index)).toISOString(),
  text: "resume"
}));
const signature = (message: TestMessage) => message.text;
const originalKeys = transcriptRenderItems(repeatedPrompts.slice(10, 20), signature);
const prependedKeys = transcriptRenderItems(repeatedPrompts.slice(0, 20), signature);
const appendedKeys = transcriptRenderItems(repeatedPrompts, signature);
for (const original of originalKeys) {
  assert.equal(prependedKeys.find((item) => item.message.id === original.message.id)?.renderKey, original.renderKey, "loading older repeated prompts must not reassign the reader's anchor");
  assert.equal(appendedKeys.find((item) => item.message.id === original.message.id)?.renderKey, original.renderKey, "appending another identical prompt must not reassign older anchors");
}
assert.deepEqual(
  transcriptRenderItems(repeatedPrompts.slice(10, 20).map((message) => ({ ...message, id: `new-${message.id}` })), signature).map((item) => item.renderKey),
  originalKeys.map((item) => item.renderKey),
  "backend ID churn must not remount unchanged message bubbles"
);
assert.equal(new Set(appendedKeys.map((item) => item.renderKey)).size, repeatedPrompts.length, "identical text in different turns must have distinct keys");

const appSource = await fs.readFile(path.join(process.cwd(), "src/App.tsx"), "utf8");
const loadDetailSource = appSource.slice(appSource.indexOf("const loadChatDetail = useCallback("), appSource.indexOf("const loadChatJobs = useCallback("));
assert(loadDetailSource.indexOf("loadingMoreMessagesRef.current") < loadDetailSource.indexOf("chatDetailRequestRef.current + 1"), "skipped background refreshes must not invalidate the pending history request");
assert.match(appSource, /useLayoutEffect\(\(\) => \{[\s\S]*?keepPrependScrollAnchor/, "history anchors are restored before painting the expanded page");

assert.equal(
  restoredPrependScrollTop(
    { scrollHeight: 1_000, scrollTop: 200, anchorOffset: 40 },
    200,
    1_500,
    540
  ),
  700,
  "prepending history must retain the visible message offset"
);
assert.equal(
  restoredPrependScrollTop(
    { scrollHeight: 1_000, scrollTop: 200, anchorOffset: 40 },
    700,
    1_500,
    40
  ),
  700,
  "native browser scroll anchoring must not be applied twice"
);
assert.equal(
  restoredPrependScrollTop(
    { scrollHeight: 1_000, scrollTop: 200 },
    200,
    1_500
  ),
  700,
  "scroll-height preservation remains available when no message anchor is visible"
);

// Exercise the real anchor keeper without a live chat or production browser.
const fixtureWindow = new EventTarget();
let resized: (() => void) | undefined;
let disconnected = false;
let cancelledFrame = false;
let clearedTimeout = false;
Object.assign(fixtureWindow, {
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => { cancelledFrame = true; },
  setTimeout: () => 2,
  clearTimeout: () => { clearedTimeout = true; }
});
const fixtureScroller = new EventTarget() as EventTarget & Record<string, any>;
let messageTop = 260;
const fixtureMessage = {
  dataset: { renderKey: "stable-turn" },
  getBoundingClientRect: () => ({ top: 100 + messageTop - fixtureScroller.scrollTop, bottom: 300 + messageTop - fixtureScroller.scrollTop, height: 200 })
};
Object.assign(fixtureScroller, {
  ownerDocument: { defaultView: fixtureWindow, scrollingElement: null },
  scrollTop: 200, scrollHeight: 1000, clientTop: 0, isConnected: true,
  getBoundingClientRect: () => ({ top: 100 }),
  querySelectorAll: () => [fixtureMessage], querySelector: () => fixtureMessage
});
const previousResizeObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class {
  constructor(callback: () => void) { resized = callback; }
  observe() {}
  disconnect() { disconnected = true; }
} });
try {
  const scroller = fixtureScroller as unknown as HTMLElement;
  const snapshot = capturePrependScrollSnapshot(scroller, "fixture-chat");
  messageTop += 500;
  fixtureScroller.scrollHeight += 500;
  const keeper = keepPrependScrollAnchor(scroller, snapshot);
  assert.equal(fixtureScroller.scrollTop, 700, "restore must happen synchronously, before an animation frame");
  messageTop += 200;
  fixtureScroller.scrollHeight += 200;
  resized?.();
  assert.equal(fixtureScroller.scrollTop, 900, "late image/layout expansion must retain the same reading position");
  fixtureWindow.dispatchEvent(new Event("wheel"));
  fixtureScroller.scrollTop = 960;
  messageTop += 100;
  fixtureScroller.scrollHeight += 100;
  resized?.();
  assert.equal(fixtureScroller.scrollTop, 960, "scrolling must release the anchor instead of fighting the reader");
  assert.equal(keeper.active, false);
  assert(disconnected && cancelledFrame && clearedTimeout, "release must clean up observers and pending callbacks");
} finally {
  if (previousResizeObserver) Object.defineProperty(globalThis, "ResizeObserver", previousResizeObserver);
  else Reflect.deleteProperty(globalThis, "ResizeObserver");
}

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
