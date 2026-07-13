import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-usage-"));
const sessionPath = path.join(tempDir, "session.jsonl");
const futureFiveHourReset = Math.floor(Date.now() / 1000) + 60 * 60;
const futureWeeklyReset = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
const completeRecord = {
  timestamp: "2026-07-12T18:25:00.000Z",
  payload: {
    rate_limits: {
      primary: { used_percent: 19, window_minutes: 300, resets_at: futureFiveHourReset },
      secondary: { used_percent: 43, window_minutes: 10080, resets_at: futureWeeklyReset }
    }
  }
};
const weeklyOnlyRecords = Array.from({ length: 16 }, (_, index) => ({
  timestamp: `2026-07-12T18:36:${String(index).padStart(2, "0")}.000Z`,
  payload: {
    rate_limits: {
      primary: { used_percent: 44, window_minutes: 10080, resets_at: futureWeeklyReset },
      secondary: null
    }
  }
}));

fs.writeFileSync(
  sessionPath,
  [completeRecord, ...weeklyOnlyRecords].map((record) => JSON.stringify(record)).join("\n"),
  "utf8"
);
process.env.CODEX_SESSIONS_DIR = tempDir;

try {
  const { refreshCodexUsage } = await import("../server/codexUsage.js");
  const usage = await refreshCodexUsage();

  assert.deepEqual(usage?.fiveHour, { usedPercent: 19, resetsAt: futureFiveHourReset });
  assert.deepEqual(usage?.weekly, { usedPercent: 44, resetsAt: futureWeeklyReset });
  assert.equal(usage?.updatedAt, "2026-07-12T18:36:15.000Z");

  fs.writeFileSync(sessionPath, JSON.stringify(weeklyOnlyRecords.at(-1)), "utf8");
  const partialRefresh = await refreshCodexUsage();
  assert.deepEqual(
    partialRefresh?.fiveHour,
    { usedPercent: 19, resetsAt: futureFiveHourReset },
    "a partial weekly-only refresh preserves the last valid five-hour window"
  );

  const expiredReset = Math.floor(Date.now() / 1000) - 60;
  fs.writeFileSync(
    sessionPath,
    JSON.stringify({
      timestamp: "2026-07-13T08:00:00.000Z",
      payload: {
        rate_limits: {
          primary: { used_percent: 81, window_minutes: 300, resets_at: expiredReset },
          secondary: { used_percent: 8, window_minutes: 10080, resets_at: futureWeeklyReset }
        }
      }
    }),
    "utf8"
  );
  const expiredRefresh = await refreshCodexUsage();
  assert.deepEqual(
    expiredRefresh?.fiveHour,
    { usedPercent: 0, resetsAt: expiredReset },
    "an expired five-hour window is ready rather than showing stale usage"
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
