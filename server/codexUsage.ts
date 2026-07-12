import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { CodexUsage } from "./types.js";

const sessionsRoot = process.env.CODEX_SESSIONS_DIR ?? path.join(os.homedir(), ".codex", "sessions");
const tailBytes = 8 * 1024 * 1024;
let cachedUsage: CodexUsage | null = null;

type RateLimitWindow = {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
};

type RateLimitRecord = {
  timestamp?: string;
  payload?: {
    rate_limits?: {
      primary?: RateLimitWindow;
      secondary?: RateLimitWindow;
    };
  };
};

function normalizeUsageWindow(window: RateLimitWindow | undefined) {
  if (!window || typeof window.used_percent !== "number") {
    return undefined;
  }

  return {
    usedPercent: window.used_percent,
    resetsAt: typeof window.resets_at === "number" ? window.resets_at : undefined
  };
}

async function sessionFiles(root: string): Promise<Array<{ path: string; mtimeMs: number }>> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return sessionFiles(entryPath);
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        return [];
      }
      const stat = await fs.stat(entryPath);
      return [{ path: entryPath, mtimeMs: stat.mtimeMs }];
    })
  );
  return nested.flat();
}

async function readTail(filePath: string) {
  const file = await fs.open(filePath, "r");
  try {
    const stat = await file.stat();
    const length = Math.min(stat.size, tailBytes);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, stat.size - length);
    return buffer.toString("utf8");
  } finally {
    await file.close();
  }
}

export async function refreshCodexUsage() {
  try {
    const files = await sessionFiles(sessionsRoot);
    const newest = files.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (!newest) {
      return cachedUsage;
    }

    const lines = (await readTail(newest.path)).split(/\r?\n/);
    let fiveHour: CodexUsage["fiveHour"];
    let weekly: CodexUsage["weekly"];
    let newestUsageTimestamp: string | undefined;

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (!line?.includes('"rate_limits"')) {
        continue;
      }

      try {
        const record = JSON.parse(line) as RateLimitRecord;
        const limits = record.payload?.rate_limits;
        if (!limits) {
          continue;
        }

        const windows = [limits.primary, limits.secondary];
        const recordHasKnownWindow = windows.some(
          (window) => window?.window_minutes === 300 || window?.window_minutes === 10080
        );
        if (!recordHasKnownWindow) {
          continue;
        }

        newestUsageTimestamp ??= record.timestamp;
        fiveHour ??= normalizeUsageWindow(windows.find((window) => window?.window_minutes === 300));
        weekly ??= normalizeUsageWindow(windows.find((window) => window?.window_minutes === 10080));
      } catch {
        continue;
      }

      if (fiveHour && weekly) {
        break;
      }
    }

    const nextFiveHour = fiveHour ?? cachedUsage?.fiveHour;
    const nextWeekly = weekly ?? cachedUsage?.weekly;
    if (nextFiveHour || nextWeekly) {
      cachedUsage = {
        updatedAt: newestUsageTimestamp ?? cachedUsage?.updatedAt ?? new Date(newest.mtimeMs).toISOString(),
        fiveHour: nextFiveHour,
        weekly: nextWeekly
      };
      return cachedUsage;
    }
  } catch {
    return cachedUsage;
  }

  return cachedUsage;
}

export function getCachedCodexUsage() {
  return cachedUsage;
}
