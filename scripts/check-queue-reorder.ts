import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodexRunner } from "../server/codexRunner.js";
import type { CodexRunJob } from "../server/types.js";
import { isQueueOrder, moveQueuedId, sameQueueOrder } from "../shared/queueOrder.js";

assert.deepEqual(moveQueuedId(["a", "b", "c"], "a", 2), ["b", "c", "a"]);
assert.deepEqual(moveQueuedId(["a", "b", "c"], "c", -1), ["c", "a", "b"]);
assert.deepEqual(moveQueuedId(["a", "b", "c"], "b", 99), ["a", "c", "b"]);
assert.deepEqual(moveQueuedId(["a", "b"], "unknown", 1), ["a", "b"]);
assert.ok(isQueueOrder(["a", "b"]));
for (const invalid of [null, "a", ["a", "a"], ["a", 3], [""]]) assert.equal(isQueueOrder(invalid), false);
assert.equal(sameQueueOrder(["a", "b"], ["b", "a"]), false);

const root = mkdtempSync(path.join(os.tmpdir(), "codex-queue-order-"));
try {
  const journal = path.join(root, "runner.json");
  let events = 0;
  const runner = new CodexRunner({ statePath: journal, onJobChange: () => { events++; } });
  type Internals = {
    runningChatIds: Set<string>; queue: Array<{ job: CodexRunJob; text: string }>;
    statePath: string; processNext: () => void; runJob: (job: CodexRunJob, text: string) => Promise<void>;
  };
  const internal = runner as unknown as Internals;
  internal.runningChatIds.add("a"); internal.runningChatIds.add("b");
  const enqueue = (chatId: string, label: string) => runner.enqueue({
    chatId, projectPath: root, clientRequestId: label, text: `Full ${label} with attachment path`,
    composerText: label, promptPreview: label, promptHash: label, textLength: 33, inputSource: "voice",
    settings: { model: "gpt-6-astra", reasoningEffort: "max", speed: "priority", updatedAt: new Date(0).toISOString() },
    attachments: [{ path: path.join(root, `${label}.png`), relativePath: `${label}.png`, name: `${label}.png`, originalName: `${label}.png`, type: "image/png", size: 120, uploadedAt: new Date(0).toISOString() }]
  });
  const a1 = enqueue("a", "a1"), b1 = enqueue("b", "b1"), a2 = enqueue("a", "a2"), a3 = enqueue("a", "a3"), b2 = enqueue("b", "b2");
  const original = [a1.id, a2.id, a3.id], next = [a3.id, a1.id, a2.id];
  const payloads = new Map(internal.queue.map((item) => [item.job.id, JSON.stringify({ ...item, job: { ...item.job, queuePosition: undefined } })]));
  assert.deepEqual(runner.reorderQueuedJobs("a", next, original).map((job) => job.id), next);
  assert.deepEqual(internal.queue.map((item) => item.job.id), [a3.id, b1.id, a1.id, a2.id, b2.id], "other chats retain their queue slots");
  for (const [index, item] of internal.queue.entries()) {
    assert.equal(item.job.queuePosition, index + 1);
    assert.equal(JSON.stringify({ ...item, job: { ...item.job, queuePosition: undefined } }), payloads.get(item.job.id), "reordering preserves the entire original job and payload");
  }
  assert.equal(internal.queue[0].job, a3, "sort references, never recreate jobs");
  const saved = readFileSync(journal, "utf8");
  const restored = new CodexRunner({ statePath: journal }) as unknown as Internals;
  assert.deepEqual(restored.queue.map((item) => item.job.id), internal.queue.map((item) => item.job.id), "order persists through reboot recovery");
  assert.deepEqual(restored.queue[0].job.attachments, a3.attachments);
  assert.deepEqual(restored.queue[0].job.settings, a3.settings);
  events = 0;
  assert.deepEqual(runner.reorderQueuedJobs("a", next, next).map((job) => job.id), next);
  assert.equal(events, 0, "no-op does not emit duplicate queue events");
  for (const [order, expected] of [[original, original], [[a1.id, a2.id, b1.id], next], [[a1.id, a1.id, a2.id], next], [[a1.id], next]]) {
    assert.throws(() => runner.reorderQueuedJobs("a", order, expected), /queue changed/);
  }
  a2.steeringState = "sending";
  assert.throws(() => runner.reorderQueuedJobs("a", original, next), /steering/);
  a2.steeringState = undefined;
  assert.equal(events, 0);
  assert.equal(readFileSync(journal, "utf8"), saved, "failed or stale mutations leave the journal unchanged");
  const blocker = path.join(root, "not-a-directory"); writeFileSync(blocker, "test");
  internal.statePath = path.join(blocker, "runner.json");
  assert.throws(() => runner.reorderQueuedJobs("a", original, next), /Could not save/);
  assert.deepEqual(internal.queue.filter((item) => item.job.chatId === "a").map((item) => item.job.id), next, "disk failure rolls back memory as well");
  assert.equal(events, 0, "disk failure never broadcasts an unsaved order");
  internal.statePath = journal;

  // Execute only a stub; no Codex child, live prompt, notification or remote API is used.
  const started: string[] = [];
  const finish: Array<() => void> = [];
  internal.runJob = (job) => { started.push(job.id); return new Promise<void>((resolve) => finish.push(() => { job.status = "completed"; resolve(); })); };
  internal.runningChatIds.delete("a"); internal.processNext();
  assert.deepEqual(started, [a3.id]);
  assert.throws(() => runner.reorderQueuedJobs("a", original, next), /queue changed/, "a drag cannot put a started job back in the queue");
  finish.shift()!(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, [a3.id, a1.id]);
  finish.shift()!(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, [a3.id, a1.id, a2.id], "execution follows the saved order");
  finish.shift()!(); await new Promise((resolve) => setTimeout(resolve, 0));
} finally { rmSync(root, { recursive: true, force: true }); }
console.log("Queue reordering checks passed: persistence, execution, attachments/settings, cross-chat isolation, races, steering and disk rollback");
