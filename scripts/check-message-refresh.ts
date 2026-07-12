import assert from "node:assert/strict";
import { mergeTranscriptWindow, preserveOptimisticRunSettings } from "../src/chatRefresh.js";

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
