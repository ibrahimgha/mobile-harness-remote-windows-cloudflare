import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CodexRunner } from "../server/codexRunner.js";
import type { CodexRunJob } from "../server/types.js";

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

console.log("Run control checks passed");
