import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CodexRunner } from "../server/codexRunner.js";
import type { CodexRunJob, CodexRunSettings } from "../server/types.js";

const runner = new CodexRunner();
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

console.log("Run control checks passed");
