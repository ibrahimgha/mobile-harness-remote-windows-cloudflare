import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodexRunner, isActiveWriterConflict } from "../server/codexRunner.js";

process.env.CODEX_RUN_MODE = "simulation";

const chatId = "01a03847-fb6c-7670-b8a0-897ccd60f92a";
let externalRuns = [{ chatId, startedAt: "2026-09-13T09:17:00.000Z" }];
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-external-queue-"));
const statePath = path.join(tempRoot, "runner-state.json");

try {
  const runner = new CodexRunner({
    statePath,
    externalRunPollMs: 60_000,
    getExternalActiveRuns: async () => externalRuns
  });
  runner.start();
  await runner.refreshExternalActivity(true);

  const job = runner.enqueue({
    clientRequestId: "external-writer-test",
    chatId,
    projectPath: tempRoot,
    text: "Queue this behind the existing writer",
    promptPreview: "Queue this behind the existing writer",
    promptHash: "external-writer-test",
    textLength: 37
  });

  assert.equal(job.status, "queued", "a prompt must remain queued while any Codex client owns the chat");
  assert.equal(runner.willQueueBehindExistingJob(chatId), true);
  assert.equal(runner.activeJobs, 1);
  assert.equal(runner.externalJobs[0]?.source, "external");
  assert.equal(runner.recentJobs.some((visibleJob) => visibleJob.id === runner.externalJobs[0]?.id), true);
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).pending[0].job.id, job.id);

  externalRuns = [];
  await runner.refreshExternalActivity(true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(job.status, "completed", "the queued prompt must start after the external writer releases the chat");

  assert.equal(
    isActiveWriterConflict(`thread-store conflict: thread ${chatId} already has an active writer`),
    true,
    "last-millisecond writer conflicts must be recognized for automatic requeue"
  );
  assert.equal(isActiveWriterConflict("capacity unavailable"), false);
  console.log("External Codex jobs: visibility, queue reservation, persistence, release and conflict recovery checks passed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
