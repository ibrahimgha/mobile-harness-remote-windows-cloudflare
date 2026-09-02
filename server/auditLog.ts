import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { BridgeEvent } from "./types.js";

const logDir = path.resolve(process.cwd(), process.env.LOG_DIR?.trim() || "logs");
const auditLogPath = path.join(logDir, "bridge-events.jsonl");
const defaultPromptPreviewLength = 240;
const maxAuditReadLimit = 5000;
const defaultAuditReadChunkBytes = 256 * 1024;
const defaultAuditMaxScanBytes = 32 * 1024 * 1024;

type AuditReadCache = {
  size: number;
  mtimeMs: number;
  limit: number;
  entries: BridgeEvent[];
};

let auditReadCache: AuditReadCache | null = null;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function getAuditLogPath(): string {
  return auditLogPath;
}

export function summarizePrompt(text: string): Record<string, unknown> {
  const trimmed = text.trimEnd();
  const previewLength = parsePositiveInt(process.env.LOG_PROMPT_PREVIEW_LENGTH, defaultPromptPreviewLength);
  const normalizedPreview = trimmed.replace(/\s+/g, " ").trim();
  const promptPreview =
    normalizedPreview.length > previewLength
      ? `${normalizedPreview.slice(0, previewLength)}...`
      : normalizedPreview;
  const promptHash = createHash("sha256").update(trimmed, "utf8").digest("hex");
  const shouldLogFullPrompt = process.env.LOG_FULL_PROMPTS === "true";

  return {
    textLength: trimmed.length,
    promptPreview,
    promptHash,
    promptLoggedFull: shouldLogFullPrompt,
    ...(shouldLogFullPrompt ? { promptText: trimmed } : {})
  };
}

export async function appendAuditEvent(event: BridgeEvent): Promise<void> {
  await fs.mkdir(logDir, { recursive: true });
  await fs.appendFile(auditLogPath, `${JSON.stringify(event)}\n`, "utf8");
}

export async function readAuditEvents(limit: number): Promise<BridgeEvent[]> {
  const safeLimit = Math.max(1, Math.min(maxAuditReadLimit, Math.trunc(limit) || 50));

  try {
    const stat = await fs.stat(auditLogPath);
    if (
      auditReadCache &&
      auditReadCache.size === stat.size &&
      auditReadCache.mtimeMs === stat.mtimeMs &&
      auditReadCache.limit >= safeLimit
    ) {
      return auditReadCache.entries.slice(0, safeLimit);
    }

    const chunkBytes = parsePositiveInt(process.env.AUDIT_READ_CHUNK_BYTES, defaultAuditReadChunkBytes);
    const maxScanBytes = Math.max(
      chunkBytes,
      parsePositiveInt(process.env.AUDIT_MAX_SCAN_BYTES, defaultAuditMaxScanBytes)
    );
    const handle = await fs.open(auditLogPath, "r");
    const chunks: Buffer[] = [];
    let end = stat.size;
    let scannedBytes = 0;
    let newlineCount = 0;

    try {
      while (end > 0 && scannedBytes < maxScanBytes && newlineCount <= safeLimit) {
        const length = Math.min(chunkBytes, end, maxScanBytes - scannedBytes);
        const start = end - length;
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buffer, 0, length, start);
        const chunk = buffer.subarray(0, bytesRead);
        chunks.unshift(chunk);

        for (const byte of chunk) {
          if (byte === 10) newlineCount += 1;
        }

        scannedBytes += bytesRead;
        end = start;
        if (bytesRead === 0) break;
      }
    } finally {
      await handle.close();
    }

    const lines = Buffer.concat(chunks).toString("utf8").trimEnd().split(/\r?\n/);
    // When scanning starts in the middle of a large JSONL record, that first
    // fragment is incomplete and must not be reported as a parse error.
    if (end > 0) lines.shift();
    const entries: BridgeEvent[] = [];

    for (let index = lines.length - 1; index >= 0 && entries.length < safeLimit; index -= 1) {
      const line = lines[index]?.trim();
      if (!line) {
        continue;
      }

      try {
        entries.push(JSON.parse(line) as BridgeEvent);
      } catch {
        entries.push({
          id: `parse-error-${index}`,
          createdAt: new Date().toISOString(),
          type: "error",
          message: "Could not parse audit log line",
          detail: { lineNumber: index + 1 }
        });
      }
    }

    auditReadCache = {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      limit: safeLimit,
      entries
    };
    return entries;
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
}
