import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { CodexAppServerSession, CodexRpcError } from "../server/codexAppServer.js";
import { CodexRunner } from "../server/codexRunner.js";
import type { CodexRunJob, CodexRunSettings } from "../server/types.js";
import { advanceCompletionGlow } from "../src/controlRoomCompletion.js";

const settings: CodexRunSettings = { model: "gpt-5.6-sol", reasoningEffort: "low", speed: "default", updatedAt: "2026-09-07T00:00:00Z" };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function transport(options: Partial<ConstructorParameters<typeof CodexAppServerSession>[0]> = {}) {
  const sent: any[] = [];
  const messages: Array<{ text: string; final: boolean }> = [];
  const completions: string[] = [];
  const confirmed: string[] = [];
  const turnIds: string[] = [];
  const child = { stdin: { destroyed: false, write: (value: string) => { sent.push(JSON.parse(value)); } } } as unknown as ChildProcessWithoutNullStreams;
  const session = new CodexAppServerSession({
    child, threadId: "thread", cwd: "/fixture", settings, bypassSandbox: true, requestTimeoutMs: 80,
    onTurnId: (id) => { turnIds.push(id); },
    onMessage: (text, final) => { messages.push({ text, final }); },
    onUserMessage: (id) => { confirmed.push(id); },
    onComplete: (status) => { completions.push(status); },
    ...options
  });
  const response = (method: string, result: unknown, error?: string) => {
    const request = sent.findLast((message) => message.method === method);
    assert.ok(request, method);
    session.handleLine(JSON.stringify({ id: request.id, ...(error ? { error: { message: error } } : { result }) }));
  };
  const notify = (method: string, params: unknown) => session.handleLine(JSON.stringify({ method, params }));
  const start = async () => {
    const starting = session.start("Original prompt", "original-id");
    response("initialize", {});
    await flush();
    assert.equal(sent[1].method, "initialized");
    assert.equal(sent[2].params.excludeTurns, true, "do not transfer full transcripts just to resume");
    response("thread/resume", { thread: { id: "thread" } });
    await flush();
    notify("turn/started", { threadId: "thread", turn: { id: "turn" } });
    response("turn/start", { turn: { id: "turn" } });
    await starting;
  };
  return { session, sent, response, notify, start, messages, completions, confirmed, turnIds };
}

{
  const skill = { name: "codex-remote-mobile", path: "/fixture/skill/SKILL.md", connectionFile: "/fixture/skill/connection.json" };
  const f = transport({ remoteSkill: skill, inputSource: "voice" });
  await f.start();
  const input = f.sent.find((request) => request.method === "turn/start").params.input;
  assert.match(input[0].text, /Use \$codex-remote-mobile/);
  assert.match(input[0].text, /"inputSource":"voice"/);
  assert.ok(input[0].text.endsWith("Original prompt"));
  assert.deepEqual(input[1], { type: "skill", name: skill.name, path: skill.path });
  const steering = f.session.steer("Spoken correction", "voice-steer", "mixed");
  await flush();
  const steered = f.sent.at(-1).params.input;
  assert.match(steered[0].text, /"inputSource":"mixed"/);
  f.response("turn/steer", { turnId: "turn" });
  await steering;
  f.session.dispose();
}

{
  const f = transport();
  await f.start();
  const start = f.sent.find((request) => request.method === "turn/start");
  assert.equal(start.params.model, settings.model);
  assert.equal(start.params.effort, settings.reasoningEffort);
  assert.equal(start.params.serviceTierForTurn, "default");
  assert.equal(start.params.serviceTier, null, "older app-server versions must explicitly clear priority speed");
  assert.equal(start.params.approvalPolicy, "never");
  assert.deepEqual(start.params.sandboxPolicy, { type: "dangerFullAccess" });
  const steering = f.session.steer("Correction", "steer-id");
  await flush();
  const steer = f.sent.at(-1);
  assert.equal(steer.method, "turn/steer");
  assert.deepEqual(steer.params, { threadId: "thread", expectedTurnId: "turn", clientUserMessageId: "steer-id", input: [{ type: "text", text: "Correction", text_elements: [] }] });
  f.notify("item/started", { threadId: "thread", turnId: "turn", item: { type: "userMessage", clientId: "steer-id" } });
  f.response("turn/steer", { turnId: "turn" });
  assert.equal(await steering, "turn");
  assert.equal(f.session.hasConfirmedInput("steer-id"), true);
  assert.equal(f.sent.filter((message) => message.method === "turn/start").length, 1);
  assert.equal(f.sent.filter((message) => message.method === "turn/interrupt").length, 0);
  f.notify("turn/completed", { threadId: "subagent", turn: { id: "subturn", status: "completed" } });
  f.notify("turn/completed", { threadId: "thread", turn: { id: "old-turn", status: "completed" } });
  assert.deepEqual(f.completions, [], "subagent or old turn completion must not finish the parent");
  f.notify("item/completed", { threadId: "thread", turnId: "turn", item: { type: "agentMessage", text: "Working", phase: "commentary" } });
  f.notify("item/completed", { threadId: "thread", turnId: "turn", item: { type: "agentMessage", text: "Done", phase: "final_answer" } });
  assert.deepEqual(f.messages, [{ text: "Working", final: false }, { text: "Done", final: true }]);
  f.notify("turn/completed", { threadId: "thread", turn: { id: "turn", status: "completed" } });
  assert.deepEqual(f.completions, ["completed"]);
  await assert.rejects(f.session.steer("Too late", "late"), /already ended/);
  f.session.dispose();
}
{
  const f = transport();
  for (const line of ["null", "[]", "42", "not json"]) f.session.handleLine(line);
  assert.equal(f.sent.length, 0, "non-protocol stdout must not crash the remote");
  f.session.dispose();
}
{
  const f = transport();
  await f.start();
  const stopped = f.session.interrupt();
  await flush();
  assert.equal(f.sent.at(-1).method, "turn/interrupt");
  assert.equal(f.sent.at(-1).params.turnId, "turn");
  f.response("turn/interrupt", {});
  await stopped;
  f.notify("turn/completed", { threadId: "thread", turn: { id: "turn", status: "interrupted" } });
  assert.deepEqual(f.completions, ["stopped"]);
  f.session.dispose();
}
{
  const f = transport();
  await f.start();
  const request = f.session.steer("Maybe delivered", "unknown");
  const assertion = assert.rejects(request, (error) => error instanceof CodexRpcError && error.outcomeUnknown);
  await assertion;
  f.session.dispose();
}
{
  const f = transport();
  await f.start();
  const request = f.session.steer("Persisted input", "confirmed-before-disconnect");
  await flush();
  f.notify("item/started", { threadId: "thread", turnId: "turn", item: { type: "userMessage", clientId: "confirmed-before-disconnect" } });
  f.session.dispose();
  assert.equal(await request, "turn", "an input event confirms delivery even if the RPC reply is lost");
}
{
  const f = transport();
  const starting = f.session.start("Do not start", "cancelled");
  const stopped = f.session.interrupt();
  const rejected = Promise.all([assert.rejects(starting, /cancelled before startup/), assert.rejects(stopped, /cancelled before startup/)]);
  f.response("initialize", {});
  await rejected;
  assert.equal(f.sent.some((message) => message.method === "turn/start"), false);
  f.session.dispose();
}

const temp = mkdtempSync(path.join(os.tmpdir(), "codex-native-steering-"));
function runnerFixture(name: string) {
  const events: string[] = [];
  const statePath = path.join(temp, `${name}.json`);
  const runner = new CodexRunner({ statePath, getRunSettings: () => ({ ...settings }), onJobChange: (_, event) => { events.push(event); } });
  const internals = runner as unknown as {
    jobs: Map<string, CodexRunJob>; jobTexts: Map<string, string>; runningChatIds: Set<string>;
    nativeSessions: Map<string, Pick<CodexAppServerSession, "steer" | "hasConfirmedInput">>;
    queue: Array<{ job: CodexRunJob; text: string }>;
    processNext: () => void; runJob: (job: CodexRunJob, text: string) => Promise<void>;
    holdUnconfirmedSteers: (parentId: string) => void;
    confirmSteeredInput: (parentId: string, clientId: string) => void;
  };
  const parent: CodexRunJob = { id: "parent", chatId: "chat", projectPath: temp, status: "running", createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), promptPreview: "Original", promptHash: "parent", textLength: 8, command: [], logPaths: { stdout: "stdout", stderr: "stderr", lastMessage: "last" }, settings: { ...settings }, nativeTurnId: "turn" };
  internals.jobs.set(parent.id, parent);
  internals.jobTexts.set(parent.id, "Original");
  internals.runningChatIds.add(parent.chatId);
  runner.stopRunningJob = () => { throw new Error("Steering must never call Stop"); };
  const enqueue = (text: string, override = settings) => runner.enqueue({ chatId: "chat", projectPath: temp, text, promptPreview: text, promptHash: text, textLength: text.length, settings: override });
  return { runner, internals, parent, enqueue, events, statePath };
}
try {
  {
    const f = runnerFixture("late-confirmation");
    f.internals.nativeSessions.set("parent", { steer: async () => { throw new CodexRpcError("Timed out", true); }, hasConfirmedInput: () => false });
    const queued = f.enqueue("Late delivery");
    await assert.rejects(f.runner.steerQueuedJob(queued.id, "chat"), /Timed out/);
    assert.equal(queued.steeringState, "uncertain");
    f.internals.confirmSteeredInput("wrong-parent", queued.id);
    assert.equal(f.runner.queuedJobs, 1);
    f.internals.confirmSteeredInput("parent", queued.id);
    assert.equal(queued.status, "steered");
    assert.equal(queued.steeringState, "confirmed");
    assert.equal(f.runner.queuedJobs, 0);
    assert.equal((await f.runner.steerQueuedJob(queued.id, "chat"))?.steered, true);
  }
  {
    const f = runnerFixture("confirmation-before-restart");
    const pending = deferred<string>();
    f.internals.nativeSessions.set("parent", { steer: () => pending.promise, hasConfirmedInput: () => true });
    const queued = f.enqueue("Known delivered before RPC reply");
    const steering = f.runner.steerQueuedJob(queued.id, "chat");
    f.internals.confirmSteeredInput("parent", queued.id);
    const restored = new CodexRunner({ statePath: f.statePath });
    assert.equal(restored.jobsForChat("chat").find((job) => job.id === queued.id)?.status, "steered");
    assert.equal(restored.queuedJobs, 1, "only the parent resumes when input confirmation preceded the crash");
    pending.resolve("turn");
    await steering;
  }
  {
    const f = runnerFixture("accepted");
    const pending = deferred<string>();
    let calls = 0;
    f.internals.nativeSessions.set("parent", { steer: () => { calls++; return pending.promise; }, hasConfirmedInput: () => true });
    const queued = f.enqueue("Correction");
    const first = f.runner.steerQueuedJob(queued.id, "chat");
    const duplicate = f.runner.steerQueuedJob(queued.id, "chat");
    assert.equal(calls, 1, "double taps share a single native request");
    assert.throws(() => f.runner.cancelQueuedJob(queued.id), /acknowledgement/);
    pending.resolve("turn");
    const result = await first;
    assert.equal((await duplicate)?.job, result?.job);
    assert.equal(result?.job.status, "steered");
    assert.equal(f.runner.activeJobs, 1);
    assert.equal(f.parent.status, "running");
    assert.equal(f.runner.queuedJobs, 0);
    assert.equal(f.events.includes("completed") || f.events.includes("stopped"), false, "steering is not job completion");
    assert.equal((await f.runner.steerQueuedJob(queued.id, "chat"))?.steered, true);
    assert.equal(calls, 1, "an HTTP retry after acceptance must not deliver twice");
    const recovered = new CodexRunner({ statePath: f.statePath });
    assert.equal(recovered.jobsForChat("chat").find((job) => job.id === queued.id)?.status, "steered");
    assert.equal(recovered.queuedJobs, 1, "only the interrupted parent gets a resume prompt after restart");
  }
  {
    const f = runnerFixture("different-model");
    f.internals.nativeSessions.set("parent", { steer: () => { throw new Error("must not send"); }, hasConfirmedInput: () => false });
    const queued = f.enqueue("Use new settings", { ...settings, reasoningEffort: "high" });
    await assert.rejects(f.runner.steerQueuedJob(queued.id, "chat"), /different settings/);
    assert.equal(queued.steeringState, undefined);
    assert.equal(f.runner.queuedJobs, 1);
  }
  {
    const f = runnerFixture("unmanaged");
    const queued = f.enqueue("Do not stop external worker");
    await assert.rejects(f.runner.steerQueuedJob(queued.id, "chat"), /not connected to native steering/);
    assert.equal(queued.steeringState, undefined);
    assert.equal(f.parent.status, "running");
  }
  {
    const f = runnerFixture("rejected");
    f.internals.nativeSessions.set("parent", { steer: async () => { throw new CodexRpcError("Turn already completed"); }, hasConfirmedInput: () => false });
    const first = f.enqueue("First");
    const second = f.enqueue("Second");
    await assert.rejects(f.runner.steerQueuedJob(second.id, "chat"), /already completed/);
    assert.deepEqual(f.internals.queue.map((item) => item.job.id), [first.id, second.id], "rejection preserves the queue order");
    assert.equal(second.steeringState, undefined);
  }
  {
    const f = runnerFixture("uncertain");
    f.internals.nativeSessions.set("parent", { steer: async () => { throw new CodexRpcError("Lost reply", true); }, hasConfirmedInput: () => false });
    const queued = f.enqueue("Never duplicate this input");
    await assert.rejects(f.runner.steerQueuedJob(queued.id, "chat"), /Lost reply/);
    assert.equal(queued.steeringState, "uncertain");
    await assert.rejects(f.runner.steerQueuedJob(queued.id, "chat"), /awaiting confirmation/);
    const restored = new CodexRunner({ statePath: f.statePath });
    const state = restored as unknown as { queue: Array<{ job: CodexRunJob; text: string }> };
    const held = state.queue.find((item) => item.job.id === queued.id)!;
    assert.equal(held.text, "Never duplicate this input");
    assert.equal(held.job.steeringState, "uncertain");
    assert.equal(state.queue.find((item) => item.job.id === "parent")?.text, "resume");
  }
  {
    const f = runnerFixture("unconfirmed");
    f.internals.nativeSessions.set("parent", { steer: async () => "turn", hasConfirmedInput: () => false });
    const queued = f.enqueue("Accepted but not yet applied");
    await f.runner.steerQueuedJob(queued.id, "chat");
    f.internals.holdUnconfirmedSteers("parent");
    assert.equal(queued.status, "queued");
    assert.equal(queued.steeringState, "uncertain");
    assert.equal(f.internals.queue[0].text, "Accepted but not yet applied");
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}

const glow = advanceCompletionGlow({ chatId: "chat", pendingJobIds: ["parent", "steer"] }, "chat", [{ id: "parent", status: "running" }, { id: "steer", status: "steered" }]);
assert.equal(glow.completedJobId, null);
assert.deepEqual(glow.tracker.pendingJobIds, ["parent"]);
const runnerSource = readFileSync("server/codexRunner.ts", "utf8");
assert.match(runnerSource, /return \["app-server", "--listen", "stdio:\/\/"\]/);
const steeringBody = runnerSource.slice(runnerSource.indexOf("async steerQueuedJob"), runnerSource.indexOf("stopRunningJob(jobId"));
assert.doesNotMatch(steeringBody, /stopRunningJob\(|terminateChild\(|\.kill\(/);
assert.match(readFileSync("src/App.tsx", "utf8"), /Steer the active turn with this queued prompt/);
console.log("Native steering: protocol, same-turn delivery, Stop separation, duplicate prevention, settings, queue recovery, and completion accounting passed.");
