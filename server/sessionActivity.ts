import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ActiveSessionRun = {
  chatId: string;
  startedAt: string;
};

type SessionFileCacheEntry = {
  size: number;
  mtimeMs: number;
  run: ActiveSessionRun | null;
};

type RecentSessionFile = {
  filePath: string;
  size: number;
  mtimeMs: number;
};

const sessionsRoot = process.env.CODEX_SESSIONS_DIR ?? path.join(os.homedir(), ".codex", "sessions");
const maxRecentSessionFiles = Math.max(8, Number(process.env.CODEX_ACTIVITY_SESSION_FILES ?? 48) || 48);
const scanChunkBytes = Math.max(64 * 1024, Number(process.env.CODEX_ACTIVITY_SCAN_CHUNK_BYTES ?? 256 * 1024) || 256 * 1024);
const maxScanBytes = Math.max(scanChunkBytes, Number(process.env.CODEX_ACTIVITY_MAX_SCAN_BYTES ?? 16 * 1024 * 1024) || 16 * 1024 * 1024);
const recentFilesCacheMs = Math.max(1000, Number(process.env.CODEX_ACTIVITY_FILE_CACHE_MS ?? 4000) || 4000);
const maxActivityInactivityMs = Math.max(
  60 * 60 * 1000,
  Number(process.env.CODEX_ACTIVITY_MAX_INACTIVITY_MS ?? 6 * 60 * 60 * 1000) || 6 * 60 * 60 * 1000
);
const markerOverlapBytes = 256;

const lifecycleMarkers = [
  { value: '"type":"task_started"', kind: "started" as const },
  { value: '"type":"task_complete"', kind: "terminal" as const },
  { value: '"type":"task_cancelled"', kind: "terminal" as const },
  { value: '"type":"task_canceled"', kind: "terminal" as const },
  { value: '"type":"turn.completed"', kind: "terminal" as const },
  { value: '"type":"turn.failed"', kind: "terminal" as const }
];

const fileCache = new Map<string, SessionFileCacheEntry>();
let recentFilesCache: { expiresAt: number; files: RecentSessionFile[] } | null = null;

function chatIdFromFilePath(filePath: string): string | null {
  const base = path.basename(filePath, ".jsonl");
  return base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1] ?? null;
}

function timestampNearMarker(text: string, markerIndex: number): string | null {
  const lineStart = Math.max(text.lastIndexOf("\n", markerIndex) + 1, markerIndex - 512);
  const nearby = text.slice(lineStart, Math.min(text.length, markerIndex + 512));
  const startedAtMatch = nearby.match(/"started_at":\s*(\d+(?:\.\d+)?)/);

  if (startedAtMatch) {
    const raw = Number(startedAtMatch[1]);
    const milliseconds = raw < 1_000_000_000_000 ? raw * 1000 : raw;

    if (Number.isFinite(milliseconds)) {
      return new Date(milliseconds).toISOString();
    }
  }

  const timestampMatch = nearby.match(/"timestamp":"([^"]+)"/);
  const timestampMs = Date.parse(timestampMatch?.[1] ?? "");
  return Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null;
}

export function activeRunFromSessionText(chatId: string, text: string): ActiveSessionRun | null {
  let latest: { index: number; kind: "started" | "terminal"; startedAt: string | null } | null = null;

  for (const marker of lifecycleMarkers) {
    let markerIndex = text.lastIndexOf(marker.value);

    while (markerIndex >= 0) {
      if (!latest || markerIndex > latest.index) {
        latest = {
          index: markerIndex,
          kind: marker.kind,
          startedAt: marker.kind === "started" ? timestampNearMarker(text, markerIndex) : null
        };
      }

      markerIndex = text.lastIndexOf(marker.value, markerIndex - 1);
    }
  }

  if (!latest || latest.kind === "terminal" || !latest.startedAt) {
    return null;
  }

  return { chatId, startedAt: latest.startedAt };
}

async function readFileSlice(filePath: string, start: number, length: number): Promise<Buffer> {
  const handle = await fs.open(filePath, "r");
  const buffer = Buffer.alloc(length);

  try {
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readLatestRun(file: RecentSessionFile): Promise<ActiveSessionRun | null> {
  const chatId = chatIdFromFilePath(file.filePath);

  if (!chatId || file.size <= 0 || Date.now() - file.mtimeMs > maxActivityInactivityMs) {
    return null;
  }

  let scannedBytes = 0;
  let end = file.size;
  let newerOverlap = "";

  while (end > 0 && scannedBytes < maxScanBytes) {
    const length = Math.min(scanChunkBytes, end, maxScanBytes - scannedBytes);
    const start = end - length;
    const chunk = await readFileSlice(file.filePath, start, length);
    const text = chunk.toString("utf8") + newerOverlap;
    const run = activeRunFromSessionText(chatId, text);

    if (run) {
      return run;
    }

    if (lifecycleMarkers.some((marker) => text.includes(marker.value))) {
      return null;
    }

    newerOverlap = text.slice(0, markerOverlapBytes);
    scannedBytes += length;
    end = start;
  }

  return null;
}

async function collectRecentSessionFiles(): Promise<RecentSessionFile[]> {
  if (recentFilesCache && recentFilesCache.expiresAt > Date.now()) {
    return recentFilesCache.files;
  }

  const candidates: string[] = [];

  async function visit(dir: string) {
    let entries: Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;

    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        candidates.push(entryPath);
      }
    }
  }

  await visit(sessionsRoot);

  const files = (
    await Promise.all(
      candidates.map(async (filePath) => {
        try {
          const stat = await fs.stat(filePath);
          return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
        } catch {
          return null;
        }
      })
    )
  )
    .filter((file): file is RecentSessionFile => file !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, maxRecentSessionFiles);

  recentFilesCache = { expiresAt: Date.now() + recentFilesCacheMs, files };
  return files;
}

export async function listActiveSessionRuns(): Promise<ActiveSessionRun[]> {
  const files = await collectRecentSessionFiles();
  const runs = await Promise.all(
    files.map(async (file) => {
      const cached = fileCache.get(file.filePath);

      if (cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs) {
        return Date.now() - file.mtimeMs <= maxActivityInactivityMs ? cached.run : null;
      }

      const run = await readLatestRun(file);
      fileCache.set(file.filePath, { size: file.size, mtimeMs: file.mtimeMs, run });
      return run;
    })
  );

  const newestByChat = new Map<string, ActiveSessionRun>();

  for (const run of runs) {
    if (!run) {
      continue;
    }

    const current = newestByChat.get(run.chatId);
    if (!current || Date.parse(run.startedAt) > Date.parse(current.startedAt)) {
      newestByChat.set(run.chatId, run);
    }
  }

  return [...newestByChat.values()].sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
}
