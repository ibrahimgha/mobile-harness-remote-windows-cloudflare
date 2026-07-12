import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-usage-"));
const sessionPath = path.join(tempDir, "session.jsonl");
const completeRecord = {
  timestamp: "2026-07-12T18:25:00.000Z",
  payload: {
    rate_limits: {
      primary: { used_percent: 19, window_minutes: 300, resets_at: 1783893830 },
      secondary: { used_percent: 43, window_minutes: 10080, resets_at: 1784358016 }
    }
  }
};
const weeklyOnlyRecords = Array.from({ length: 16 }, (_, index) => ({
  timestamp: `2026-07-12T18:36:${String(index).padStart(2, "0")}.000Z`,
  payload: {
    rate_limits: {
      primary: { used_percent: 44, window_minutes: 10080, resets_at: 1784358016 },
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

  assert.deepEqual(usage?.fiveHour, { usedPercent: 19, resetsAt: 1783893830 });
  assert.deepEqual(usage?.weekly, { usedPercent: 44, resetsAt: 1784358016 });
  assert.equal(usage?.updatedAt, "2026-07-12T18:36:15.000Z");

  fs.writeFileSync(sessionPath, JSON.stringify(weeklyOnlyRecords.at(-1)), "utf8");
  const partialRefresh = await refreshCodexUsage();
  assert.deepEqual(
    partialRefresh?.fiveHour,
    { usedPercent: 19, resetsAt: 1783893830 },
    "a partial weekly-only refresh preserves the last valid five-hour window"
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
