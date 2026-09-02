import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveCodexCliPath } from "./codexCli.js";
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

type AppServerRateLimitWindow = {
  usedPercent?: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
};

type AppServerRateLimitSnapshot = {
  primary?: AppServerRateLimitWindow | null;
  secondary?: AppServerRateLimitWindow | null;
};

export type AccountRateLimitsResponse = {
  rateLimits?: AppServerRateLimitSnapshot | null;
  rateLimitsByLimitId?: Record<string, AppServerRateLimitSnapshot | undefined> | null;
  rateLimitResetCredits?: {
    availableCount?: number | null;
    credits?: unknown[] | null;
  } | null;
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

function normalizeAppServerWindow(window: AppServerRateLimitWindow | undefined) {
  if (!window || typeof window.usedPercent !== "number") {
    return undefined;
  }

  return {
    usedPercent: window.usedPercent,
    resetsAt: typeof window.resetsAt === "number" ? window.resetsAt : undefined
  };
}

export function usageFromAccountRateLimits(response: AccountRateLimitsResponse): CodexUsage | null {
  const snapshot = response.rateLimitsByLimitId?.codex ?? response.rateLimits;
  if (!snapshot) {
    return null;
  }

  const windows = [snapshot.primary, snapshot.secondary].filter(
    (window): window is AppServerRateLimitWindow => Boolean(window)
  );
  const fiveHour = normalizeAppServerWindow(windows.find((window) => window.windowDurationMins === 300));
  const weekly = normalizeAppServerWindow(windows.find((window) => window.windowDurationMins === 10080));
  const resetCreditsAvailable = response.rateLimitResetCredits?.availableCount;
  if (!fiveHour && !weekly) {
    return null;
  }

  return {
    updatedAt: new Date().toISOString(),
    fiveHour,
    weekly,
    ...(typeof resetCreditsAvailable === "number" && Number.isFinite(resetCreditsAvailable)
      ? { resetCreditsAvailable: Math.max(0, Math.trunc(resetCreditsAvailable)) }
      : {})
  };
}

function readAccountRateLimits(): Promise<AccountRateLimitsResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveCodexCliPath(), ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error?: Error, response?: AccountRateLimitsResponse) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.kill();
      if (error) {
        reject(error);
      } else {
        resolve(response ?? {});
      }
    };
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const timeout = setTimeout(() => finish(new Error("Codex rate limit request timed out")), 15_000);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2000);
    });
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (!settled) {
        finish(new Error(`Codex app-server exited before returning rate limits (${code ?? "unknown"}): ${stderr}`));
      }
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      let newline = stdout.indexOf("\n");
      while (newline >= 0) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        newline = stdout.indexOf("\n");
        if (!line) {
          continue;
        }

        try {
          const message = JSON.parse(line) as {
            id?: number;
            result?: AccountRateLimitsResponse;
            error?: { message?: string };
          };
          if (message.id === 1) {
            send({ method: "initialized" });
            send({ method: "account/rateLimits/read", id: 2 });
          } else if (message.id === 2) {
            if (message.error) {
              finish(new Error(message.error.message ?? "Codex rate limit request failed"));
            } else {
              finish(undefined, message.result);
            }
          }
        } catch {
          continue;
        }
      }
    });

    send({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: { name: "codex-remote", title: "Codex Remote", version: "0.1.0" },
        capabilities: null
      }
    });
  });
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

export async function refreshCodexUsage(_options: { force?: boolean } = {}) {
  if (process.env.CODEX_USAGE_SOURCE !== "sessions") {
    try {
      const measuredUsage = usageFromAccountRateLimits(await readAccountRateLimits());
      if (measuredUsage) {
        cachedUsage = measuredUsage;
        return cachedUsage;
      }
    } catch {
      // Older Codex builds may not expose account/rateLimits/read; retain the session-log fallback.
    }
  }

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
        weekly: nextWeekly,
        ...(cachedUsage?.resetCreditsAvailable !== undefined
          ? { resetCreditsAvailable: cachedUsage.resetCreditsAvailable }
          : {})
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
