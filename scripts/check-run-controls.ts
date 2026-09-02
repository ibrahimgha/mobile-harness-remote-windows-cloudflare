import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodexRunner } from "../server/codexRunner.js";
import type { CodexRunJob, CodexRunSettings } from "../server/types.js";

const runner = new CodexRunner({ statePath: null });
const job: CodexRunJob = {
  id: "stale-running-job",
  chatId: "chat-1",
  projectPath: process.cwd(),
  status: "running",
  kind: "prompt",
  createdAt: new Date().toISOString(),
  promptPreview: "test",
  promptHash: "test",
  textLength: 4,
  command: [],
  logPaths: {
    stdout: "stdout.log",
    stderr: "stderr.log",
    lastMessage: "last-message.txt"
  }
};
const internals = runner as unknown as {
  jobs: Map<string, CodexRunJob>;
  runningChildren: Map<string, { exitCode: number | null; signalCode: NodeJS.Signals | null }>;
  stoppedJobFinalizers: Map<string, (code?: number | null, signal?: NodeJS.Signals | null) => void>;
};
let finalized = false;

internals.jobs.set(job.id, job);
internals.runningChildren.set(job.id, { exitCode: 0, signalCode: null });
internals.stoppedJobFinalizers.set(job.id, () => {
  finalized = true;
  job.status = "stopped";
});

assert.equal(runner.stopRunningJob(job.id, job.chatId), job);
assert.equal(finalized, true, "a stop requested after process exit must still finalize the job");
assert.equal(job.status, "stopped");

const source = readFileSync(new URL("../server/codexRunner.ts", import.meta.url), "utf8");

assert.match(
  source,
  /child\.on\("exit", \(code, signal\) => \{\s*finishStoppedJob\(code, signal\);\s*\}\);/,
  "stopped jobs must finalize on process exit without waiting for inherited stdio handles"
);
assert.match(
  source,
  /taskkill\.on\("close", \(code\) => \{[\s\S]*code !== 0[\s\S]*child\.kill\(\);/,
  "a failed Windows taskkill must fall back to terminating the child"
);
assert.match(
  source,
  /stoppedJobFinalizers\.delete\(job\.id\)/,
  "stopped-job finalizers must be released after a run settles"
);

let selectedSettings: CodexRunSettings = {
  model: "gpt-5.6-sol",
  reasoningEffort: "low",
  speed: "default",
  updatedAt: "2026-07-12T00:00:00.000Z"
};
let settingsReadCount = 0;
let startedWithSettings: CodexRunSettings | undefined;
const queuedSettingsRunner = new CodexRunner({
  statePath: null,
  getRunSettings: () => {
    settingsReadCount += 1;
    return { ...selectedSettings };
  }
});
const queuedSettingsInternals = queuedSettingsRunner as unknown as {
  runningChatIds: Set<string>;
  processNext: () => void;
  runJob: (job: CodexRunJob, text: string) => Promise<void>;
};
queuedSettingsInternals.runningChatIds.add("settings-chat");
queuedSettingsInternals.runJob = async (queuedJob) => {
  startedWithSettings = queuedJob.settings ? { ...queuedJob.settings } : undefined;
};

const queuedSettingsJob = queuedSettingsRunner.enqueue({
  clientRequestId: "settings-request-1",
  chatId: "settings-chat",
  projectPath: process.cwd(),
  text: "Use the model selected when this starts",
  promptPreview: "Use the model selected when this starts",
  promptHash: "settings-test",
  textLength: 39
});
const queuedSettingsSnapshot = { ...selectedSettings };

assert.equal(settingsReadCount, 1, "enqueueing must snapshot run settings before the prompt enters the queue");
assert.deepEqual(queuedSettingsJob.settings, queuedSettingsSnapshot, "queued jobs must advertise their submission settings");
assert.equal(
  queuedSettingsRunner.jobForClientRequest("settings-chat", "settings-request-1"),
  queuedSettingsJob,
  "accepted prompts must remain discoverable by their client request ID"
);

selectedSettings = {
  model: "gpt-5.6-sol",
  reasoningEffort: "ultra",
  speed: "priority",
  updatedAt: "2026-07-12T00:05:00.000Z"
};
queuedSettingsInternals.runningChatIds.delete("settings-chat");
queuedSettingsInternals.processNext();

assert.equal(settingsReadCount, 1, "starting a queued worker must not replace its submission settings");
assert.deepEqual(startedWithSettings, queuedSettingsSnapshot, "the worker must receive the settings selected at queue submission");
assert.deepEqual(queuedSettingsJob.settings, queuedSettingsSnapshot, "the started job event must preserve its submission settings");

const persistenceRoot = mkdtempSync(path.join(os.tmpdir(), "codex-runner-state-"));
try {
  const statePath = path.join(persistenceRoot, "runner.json");
  const persistentRunner = new CodexRunner({ statePath, getRunSettings: () => ({ ...queuedSettingsSnapshot }) });
  const persistentInternals = persistentRunner as unknown as { runningChatIds: Set<string> };
  persistentInternals.runningChatIds.add("persistent-chat");
  persistentRunner.enqueue({
    chatId: "persistent-chat",
    projectPath: process.cwd(),
    text: "Original queued prompt",
    promptPreview: "Original queued prompt",
    promptHash: "persistent-hash",
    textLength: 22
  });
  const persisted = JSON.parse(readFileSync(statePath, "utf8")) as { pending: Array<{ job: CodexRunJob; text: string }> };
  assert.equal(persisted.pending[0]?.text, "Original queued prompt", "queued prompt text must be journaled for a reboot");
  persisted.pending[0].job.status = "running";
  persisted.pending[0].job.startedAt = "2026-08-02T10:00:00.000Z";
  writeFileSync(statePath, JSON.stringify({ version: 1, pending: persisted.pending }), "utf8");

  const recoveredRunner = new CodexRunner({ statePath });
  const recoveredInternals = recoveredRunner as unknown as { queue: Array<{ job: CodexRunJob; text: string }> };
  assert.equal(recoveredInternals.queue[0]?.text, "resume", "an interrupted running prompt must restart with a resume prompt");
  assert.deepEqual(recoveredInternals.queue[0]?.job.settings, queuedSettingsSnapshot, "restart recovery must retain the interrupted model and reasoning level");
  assert.equal(recoveredInternals.queue[0]?.job.recoveredAfterRestart, true, "recovery jobs should remain identifiable in diagnostics");
} finally {
  rmSync(persistenceRoot, { recursive: true, force: true });
}

console.log("Run control checks passed");
