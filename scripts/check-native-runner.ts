import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { CodexRunner } from "../server/codexRunner.js";
import type { CodexRunJob } from "../server/types.js";

const root = mkdtempSync(path.join(os.tmpdir(), "codex-native-driver-"));
const previousCli = process.env.CODEX_CLI_PATH;
const previousMode = process.env.CODEX_RUN_MODE;
const previousEnabled = process.env.CODEX_RUN_ENABLED;
process.env.CODEX_CLI_PATH = process.execPath;
process.env.CODEX_RUN_MODE = "codex-cli";
process.env.CODEX_RUN_ENABLED = "true";
copyFileSync(new URL("./fixtures/codex-app-server.cjs", import.meta.url), path.join(root, "app-server"));
const settings = { model: "gpt-5.6-sol", reasoningEffort: "low" as const, speed: "default" as const, updatedAt: new Date().toISOString() };
const events: Array<{ id: string; event: string }> = [];
const runner = new CodexRunner({ statePath: null, getRunSettings: () => settings, onJobChange: (job, event) => { events.push({ id: job.id, event }); } });
const internals = runner as unknown as {
  runningChatIds: Set<string>;
  runningChildren: Map<string, { killed: boolean; exitCode: number | null; signalCode: string | null; kill: () => void }>;
  processNext: () => void;
  verifyCodexTranscript: () => Promise<unknown>;
};
internals.verifyCodexTranscript = async () => ({ checkedAt: new Date().toISOString(), promptVisible: true, responseVisible: true, message: "Fixture transcript verified" });
async function waitFor(test: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!test()) {
    assert.ok(Date.now() < deadline, "Native driver condition timed out");
    await delay(10);
  }
}
function enqueue(chatId: string, text: string) {
  internals.runningChatIds.add(chatId);
  const job = runner.enqueue({ chatId, projectPath: root, text, promptPreview: text, promptHash: text, textLength: text.length });
  job.logPaths = { stdout: path.join(root, `${job.id}.stdout.log`), stderr: path.join(root, `${job.id}.stderr.log`), lastMessage: path.join(root, `${job.id}.last.txt`) };
  return job;
}
function rpcMethods(job: CodexRunJob) {
  return readFileSync(job.logPaths.stdout, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    .filter((record) => record.method === "fixture/rpc").map((record) => record.params.method);
}
try {
  const first = enqueue("native-fixture", "Original");
  internals.runningChatIds.delete(first.chatId);
  internals.processNext();
  await waitFor(() => Boolean(first.nativeTurnId));
  const child = internals.runningChildren.get(first.id)!;
  assert.equal(first.status, "running");
  assert.equal(first.heartbeat, "Fixture is running");
  const queued = enqueue(first.chatId, "Correction");
  const steered = await runner.steerQueuedJob(queued.id, first.chatId);
  assert.equal(steered?.steered, true);
  assert.equal(first.status, "running");
  assert.equal(queued.steeringState, "confirmed");
  await waitFor(() => first.status === "completed" && !internals.runningChildren.has(first.id));
  await waitFor(() => child.exitCode !== null || child.signalCode !== null);
  assert.equal(child.killed, false, "native completion must close gracefully");
  assert.equal(readFileSync(first.logPaths.lastMessage, "utf8"), "Native fixture response");
  const methods = rpcMethods(first);
  assert.deepEqual(methods, ["initialize", "initialized", "thread/resume", "turn/start", "turn/steer"]);
  assert.equal(events.filter((event) => event.event === "completed").length, 1, "only the actual job finishes");
  assert.equal(events.filter((event) => event.id === queued.id && event.event === "completed").length, 0);

  const stopped = enqueue("stop-fixture", "Wait for stop");
  internals.runningChatIds.delete(stopped.chatId);
  internals.processNext();
  await waitFor(() => Boolean(stopped.nativeTurnId));
  const stoppedChild = internals.runningChildren.get(stopped.id)!;
  assert.equal(runner.stopRunningJob(stopped.id), stopped);
  await waitFor(() => stopped.status === "stopped" && !internals.runningChildren.has(stopped.id));
  await waitFor(() => stoppedChild.exitCode !== null || stoppedChild.signalCode !== null);
  assert.equal(stoppedChild.killed, false, "explicit Stop uses turn/interrupt before force-kill safeguards");
  assert.equal(rpcMethods(stopped).at(-1), "turn/interrupt");

  const failed = enqueue("failure-fixture", "Must not start");
  internals.runningChatIds.delete(failed.chatId);
  internals.processNext();
  await waitFor(() => failed.status === "failed" && !internals.runningChildren.has(failed.id));
  assert.equal(failed.message, "Fixture refused resume");
  assert.equal(rpcMethods(failed).includes("turn/start"), false);
  const disconnected = enqueue("disconnect-fixture", "Must not report success on EOF");
  internals.runningChatIds.delete(disconnected.chatId);
  internals.processNext();
  await waitFor(() => disconnected.status === "failed" && !internals.runningChildren.has(disconnected.id));
  assert.match(disconnected.message ?? "", /exited before confirming turn completion/);
  assert.equal(events.some((event) => event.id === disconnected.id && event.event === "completed"), false);
  console.log("Native runner subprocess integration: steering, graceful completion, native Stop, startup rejection, and logging passed.");
} finally {
  for (const child of internals.runningChildren.values()) child.kill();
  if (previousCli === undefined) delete process.env.CODEX_CLI_PATH; else process.env.CODEX_CLI_PATH = previousCli;
  if (previousMode === undefined) delete process.env.CODEX_RUN_MODE; else process.env.CODEX_RUN_MODE = previousMode;
  if (previousEnabled === undefined) delete process.env.CODEX_RUN_ENABLED; else process.env.CODEX_RUN_ENABLED = previousEnabled;
  await delay(100);
  rmSync(root, { recursive: true, force: true });
}
