import assert from "node:assert/strict";
import { buildControlRoomTrackerSnapshot, trackerDayStart } from "../server/controlRoomTracker.js";
import type { CodexRunJob, CodexRunSettings } from "../server/types.js";

const settings: CodexRunSettings = {
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  speed: "default",
  updatedAt: "2026-07-31T00:00:00.000Z"
};
const job = (patch: Partial<CodexRunJob>): CodexRunJob => ({
  id: "job-1",
  chatId: "chat-1",
  projectPath: "C:\\work\\remote",
  status: "completed",
  createdAt: "2026-07-31T05:59:00.000Z",
  startedAt: "2026-07-31T06:00:00.000Z",
  finishedAt: "2026-07-31T06:02:30.000Z",
  promptPreview: "Ship tracker",
  promptHash: "hash",
  textLength: 12,
  command: [],
  settings,
  logPaths: { stdout: "out", stderr: "err", lastMessage: "last" },
  ...patch
});

assert.equal(trackerDayStart(new Date("2026-07-31T04:00:00")).getDate(), 30, "before 5am belongs to the previous operating day");
assert.equal(trackerDayStart(new Date("2026-07-31T06:00:00")).getDate(), 31, "after 5am belongs to the current operating day");

const completed = job({});
const running = job({ id: "job-2", status: "running", finishedAt: undefined, startedAt: "2026-07-31T07:00:00.000Z" });
const snapshot = buildControlRoomTrackerSnapshot({
  serverName: "TC1",
  now: new Date("2026-07-31T08:00:00.000Z"),
  projects: [{
    projectName: "Remote",
    projectPath: "C:\\work\\remote",
    updatedAt: "2026-07-31T08:00:00.000Z",
    chats: [{
      id: "chat-1",
      title: "Fleet tracker",
      projectName: "Remote",
      projectPath: "C:\\work\\remote",
      createdAt: "2026-07-31T05:00:00.000Z",
      updatedAt: "2026-07-31T08:00:00.000Z",
      lastPromptPreview: "Ship tracker",
      lastResponsePreview: "Done",
      hasResponse: true
    }]
  }],
  jobs: [running],
  auditEvents: [{ id: "event-1", type: "action", createdAt: completed.finishedAt!, message: "done", detail: { job: completed } }],
  activeSessionRuns: [{ chatId: "external-chat", startedAt: "2026-07-31T07:30:00.000Z" }],
  defaultSettings: settings,
  usage: { updatedAt: "2026-07-31T08:00:00.000Z", fiveHour: { usedPercent: 20 }, weekly: { usedPercent: 40 } }
});

assert.equal(snapshot.runningCount, 2, "runner and externally detected sessions are both counted");
assert.equal(snapshot.completedSinceDayStart, 1, "completed jobs after the 5am boundary are counted");
assert.equal(snapshot.recent[0]?.durationMs, 150_000, "recent run duration is derived from terminal timestamps");
assert.equal(snapshot.running[0]?.model, "gpt-5.6-sol", "running jobs retain their submitted model metadata");

console.log("Control room tracker checks passed");
