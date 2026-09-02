import assert from "node:assert/strict";
import fs from "node:fs";
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
const staleAuditRunning = job({
  id: "stale-audit-running",
  chatId: "stale-chat",
  status: "running",
  finishedAt: undefined,
  startedAt: "2026-06-23T18:43:04.101Z"
});
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
  auditEvents: [
    { id: "event-stale", type: "action", createdAt: staleAuditRunning.startedAt!, message: "running", detail: { job: staleAuditRunning } },
    { id: "event-1", type: "action", createdAt: completed.finishedAt!, message: "done", detail: { job: completed } }
  ],
  activeSessionRuns: [{ chatId: "external-chat", startedAt: "2026-07-31T07:30:00.000Z" }],
  defaultSettings: settings,
  usage: { updatedAt: "2026-07-31T08:00:00.000Z", fiveHour: { usedPercent: 20 }, weekly: { usedPercent: 40 } }
});

assert.equal(snapshot.runningCount, 2, "runner and externally detected sessions are both counted");
assert.equal(
  snapshot.running.some((run) => run.id === staleAuditRunning.id),
  false,
  "historical running audit entries must not survive a service restart"
);
assert.equal(snapshot.completedSinceDayStart, 1, "completed jobs after the 5am boundary are counted");
assert.equal(snapshot.recent[0]?.durationMs, 150_000, "recent run duration is derived from terminal timestamps");
assert.equal(snapshot.running[0]?.model, "gpt-5.6-sol", "running jobs retain their submitted model metadata");
assert.equal(snapshot.running[0]?.speed, "default", "running jobs expose their submitted prompt speed");
assert.equal(snapshot.running.find((run) => run.chatId === "external-chat")?.source, "external", "outside tasks must be marked for the neutral stop control");

const trackerSource = fs.readFileSync(new URL("../src/MachineTracker.tsx", import.meta.url), "utf8");
const trackerStyles = fs.readFileSync(new URL("../src/machine-tracker.css", import.meta.url), "utf8");
assert.match(trackerSource, /snapshot\.running\.slice\(0, 8\)/, "the distance view should devote its expanded row budget to active work");
assert.match(trackerSource, /snapshot\.recent\.slice\(0, snapshot\.running\.length \? 2 : 3\)/, "recent history should yield a third row only when the active queue is empty");
assert.match(trackerSource, /machine-tracker-header-metrics/, "active and completed totals should share the machine identity bar");
assert.match(trackerSource, /refreshInFlightRef\.current/, "a tracker square should never overlap its own refresh requests");
assert.match(trackerSource, /setInterval\(\(\) => void refresh\(token, true\), 15_000\)/, "tracker squares should refresh economically while their local clocks stay live");
const serverSource = fs.readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
assert.match(serverSource, /controlRoomTrackerInFlight/, "simultaneous tracker squares should share one server snapshot request");
assert.match(serverSource, /controlRoomTrackerCacheMs = 4_000/, "tracker snapshots should be briefly cached across wall squares");
assert.match(serverSource, /return controlRoomTrackerCache\.snapshot/, "expired tracker data should remain available while one background refresh runs");
assert.match(trackerSource, /MORE ACTIVE/, "hidden active jobs should remain visible as an aggregate count");
assert.match(trackerSource, /run\.speed === "priority" \? "Fast" : "Standard"/, "tracker rows should show the current prompt speed");
assert.match(trackerSource, /resetCreditsAvailable/, "tracker usage should show the account reset credits available");
assert.match(trackerStyles, /overflow: hidden/, "the tracker should fit its square without an internal scrollbar");
assert.match(trackerStyles, /@media \(max-height: 520px\)/, "three-row wall layouts should receive a dedicated ultra-compact tracker mode");
assert.match(trackerStyles, /machine-tracker-header-metrics strong \{[\s\S]{0,160}font-size: 28px/, "header metrics should remain readable without consuming a scoreboard row");
assert.match(trackerStyles, /@media \(min-width: 560px\)/, "five-column wall tiles should use their horizontal space instead of retaining the narrow stacked layout");
assert.match(trackerStyles, /grid-template-columns: 20px minmax\(120px, 1\.25fr\) minmax\(100px, 1fr\)/, "wide run rows should expose title, project, model, elapsed time, and controls as readable columns");
assert.match(trackerStyles, /@media \(min-width: 560px\) and \(max-height: 800px\)[\s\S]*?machine-tracker-section li \{ min-height: 44px/, "short wide wall tiles should use compact single-line run rows");
assert.match(trackerStyles, /machine-tracker-external-stop[^}]*background: #000/, "outside tasks should use a black stop button instead of a destructive red control");
assert.match(trackerSource, /machine-tracker-overflow is-ultra-compact/, "ultra-compact trackers should summarize hidden active jobs explicitly");
assert.match(trackerStyles, /width: 4px; background: var\(--board-live\)/, "active rows should carry a strong live status rail");

console.log("Control room tracker checks passed");
