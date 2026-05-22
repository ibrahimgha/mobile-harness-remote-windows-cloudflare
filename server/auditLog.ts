import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { BridgeEvent } from "./types.js";

const logDir = path.resolve(process.cwd(), process.env.LOG_DIR?.trim() || "logs");
const auditLogPath = path.join(logDir, "bridge-events.jsonl");
const defaultPromptPreviewLength = 240;
const maxAuditReadLimit = 500;

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
    const data = await fs.readFile(auditLogPath, "utf8");
    const lines = data.trimEnd().split(/\r?\n/);
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

    return entries;
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
}
