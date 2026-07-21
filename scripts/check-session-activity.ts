import assert from "node:assert/strict";
import fs from "node:fs";
import { activeRunFromSessionText, sessionRunEndedAt } from "../server/sessionActivity.js";

const chatId = "8665be6a-f0d3-4d96-b2a3-7a35c3ddf900";
const started =
  '{"timestamp":"2026-07-19T07:47:35.687Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1","started_at":1784447255}}';
const completed =
  '{"timestamp":"2026-07-19T07:49:35.687Z","type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1"}}';
const failed =
  '{"timestamp":"2026-07-19T07:49:35.687Z","type":"turn.failed","error":{"message":"capacity"}}';

assert.deepEqual(activeRunFromSessionText(chatId, started), {
  chatId,
  startedAt: "2026-07-19T07:47:35.000Z"
});
assert.equal(activeRunFromSessionText(chatId, `${started}\n${completed}`), null);
assert.equal(activeRunFromSessionText(chatId, `${started}\n${failed}`), null);
assert.deepEqual(activeRunFromSessionText(chatId, `${completed}\n${started}`), {
  chatId,
  startedAt: "2026-07-19T07:47:35.000Z"
});
assert.equal(
  activeRunFromSessionText(
    chatId,
    '{"timestamp":"2026-07-19T07:50:00.000Z","type":"response_item","payload":{"type":"message","content":[{"text":"\\\"type\\\":\\\"task_started\\\""}]}}'
  ),
  null
);
assert.equal(
  sessionRunEndedAt(
    { chatId, startedAt: "2026-07-19T07:47:35.000Z" },
    "2026-07-19T07:48:00.000Z"
  ),
  true,
  "a terminal job after a session start must suppress stale external activity"
);
assert.equal(
  sessionRunEndedAt(
    { chatId, startedAt: "2026-07-19T07:50:00.000Z" },
    "2026-07-19T07:48:00.000Z"
  ),
  false,
  "a genuinely newer external run must remain visible"
);

const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

assert.match(appSource, /api\/chats\/activity/);
assert.match(appSource, /session-run-/);
assert.match(appSource, /knownJobs\.some\(\(job\) => terminalJobEndsSessionRun\(job, run\)\)/);
assert.match(appSource, /Running \$\{formatElapsedSeconds\(activeJob\.startedAt/);
assert.match(stylesSource, /\.chat-link small\.chat-running-since/);

console.log("Session activity lifecycle checks passed.");
