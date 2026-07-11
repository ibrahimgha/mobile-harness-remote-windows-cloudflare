import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { CodexUsage } from "./types.js";

const sessionsRoot = process.env.CODEX_SESSIONS_DIR ?? path.join(os.homedir(), ".codex", "sessions");
const tailBytes = 8 * 1024 * 1024;
let cachedUsage: CodexUsage | null = null;

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
    const candidates: Array<{
      timestamp?: string;
      primary?: { used_percent?: number; window_minutes?: number; resets_at?: number };
      secondary?: { used_percent?: number; window_minutes?: number; resets_at?: number };
    }> = [];
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (!line?.includes('"rate_limits"')) {
        continue;
      }

      try {
        const record = JSON.parse(line) as {
          timestamp?: string;
          payload?: {
            rate_limits?: {
              primary?: { used_percent?: number; window_minutes?: number; resets_at?: number };
              secondary?: { used_percent?: number; window_minutes?: number; resets_at?: number };
            };
          };
        };
        if (record.payload?.rate_limits) {
          candidates.push({ timestamp: record.timestamp, ...record.payload.rate_limits });
        }
      } catch {
        continue;
      }

      if (candidates.length >= 12) {
        break;
      }
    }

    const grouped = new Map<string, { count: number; candidate: (typeof candidates)[number] }>();
    for (const candidate of candidates) {
      const key = `${candidate.primary?.resets_at ?? ""}:${candidate.secondary?.resets_at ?? ""}`;
      const group = grouped.get(key);
      grouped.set(key, { count: (group?.count ?? 0) + 1, candidate: group?.candidate ?? candidate });
    }
    const selected = [...grouped.values()].sort((a, b) => b.count - a.count)[0]?.candidate;
    if (selected) {
      const windows = [selected.primary, selected.secondary];
      const fiveHour = windows.find((window) => window?.window_minutes === 300);
      const weekly = windows.find((window) => window?.window_minutes === 10080);
      if (fiveHour || weekly) {
        cachedUsage = {
          updatedAt: selected.timestamp ?? new Date(newest.mtimeMs).toISOString(),
          fiveHour: fiveHour ? { usedPercent: fiveHour.used_percent ?? 0, resetsAt: fiveHour.resets_at } : undefined,
          weekly: weekly ? { usedPercent: weekly.used_percent ?? 0, resetsAt: weekly.resets_at } : undefined
        };
        return cachedUsage;
      }
    }
  } catch {
    return cachedUsage;
  }

  return cachedUsage;
}

export function getCachedCodexUsage() {
  return cachedUsage;
}
