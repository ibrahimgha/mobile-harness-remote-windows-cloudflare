import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChatDetail, ChatMessageExcerpt, ChatProjectGroup, ChatSummary, ChatTranscriptMessage } from "./types.js";

const sessionsRoot = process.env.CODEX_SESSIONS_DIR ?? path.join(os.homedir(), ".codex", "sessions");
const sessionIndexPath = process.env.CODEX_SESSION_INDEX ?? path.join(os.homedir(), ".codex", "session_index.jsonl");
const maxSessionFiles = Number(process.env.CODEX_MAX_SESSION_FILES ?? 300);
const cacheMs = Number(process.env.CODEX_SESSION_CACHE_MS ?? 5000);
const tailBytes = Number(process.env.CODEX_SESSION_TAIL_BYTES ?? 4 * 1024 * 1024);
const headBytes = Math.max(16 * 1024, Number(process.env.CODEX_SESSION_HEAD_BYTES ?? 256 * 1024) || 256 * 1024);

let sessionsCache: { expiresAt: number; sessions: ParsedSession[] } | null = null;

type IndexedSession = {
  threadName: string;
  updatedAt: string;
};

type ParsedSession = ChatDetail & {
  indexed: boolean;
  source?: string;
  sortTime: number;
};

export function clearSessionCache() {
  sessionsCache = null;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function previewText(text: string, fallback: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.length > 84 ? `${normalized.slice(0, 81)}...` : normalized;
}

function isPromptText(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed) {
    return false;
  }

  return !trimmed.startsWith("<environment_context>");
}

function isHeartbeatText(text: string): boolean {
  return /^(\*\*)?heartbeat(\*\*)?\s*:/i.test(text.trim());
}

function transcriptId(role: ChatTranscriptMessage["role"], createdAt: string, index: number): string {
  return `${role}-${Date.parse(createdAt) || 0}-${index}`;
}

function projectNameFromPath(projectPath: string): string {
  if (!projectPath || projectPath === "Unknown project") {
    return "Unknown project";
  }

  return path.basename(projectPath) || projectPath;
}

function idFromFilename(filePath: string): string {
  const base = path.basename(filePath, ".jsonl");
  const match = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);

  return match?.[1] ?? base;
}

function safeDate(value: string | undefined, fallbackMs: number): { iso: string; ms: number } {
  const ms = value ? Date.parse(value) : Number.NaN;

  if (Number.isFinite(ms)) {
    return { iso: new Date(ms).toISOString(), ms };
  }

  return { iso: new Date(fallbackMs).toISOString(), ms: fallbackMs };
}

async function collectJsonlFiles(root: string): Promise<string[]> {
  const files: string[] = [];

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
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(entryPath);
      }
    }
  }

  await visit(root);

  const withStats: Array<{ filePath: string; mtimeMs: number }> = [];

  for (const filePath of files) {
    try {
      const stat = await fs.stat(filePath);

      withStats.push({ filePath, mtimeMs: stat.mtimeMs });
    } catch {
      continue;
    }
  }

  return withStats
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxSessionFiles)
    .map((entry) => entry.filePath);
}

export async function findSessionFile(id: string): Promise<string | null> {
  const files = await collectJsonlFiles(sessionsRoot);

  return files.find((filePath) => idFromFilename(filePath) === id) ?? null;
}

export function getSessionsRoot(): string {
  return sessionsRoot;
}

export function getSessionIndexPath(): string {
  return sessionIndexPath;
}

export async function ensureSessionIndexEntry(id: string, threadName: string, updatedAt: string) {
  const name = threadName.replace(/\s+/g, " ").trim();

  if (!id || !name) {
    return;
  }

  try {
    const index = await readSessionIndex();
    const current = index.get(id);

    if (current?.threadName === name && Date.parse(current.updatedAt) >= Date.parse(updatedAt)) {
      return;
    }
  } catch {
    return;
  }

  await fs.mkdir(path.dirname(sessionIndexPath), { recursive: true });
  await fs.appendFile(
    sessionIndexPath,
    `${JSON.stringify({
      id,
      thread_name: name,
      updated_at: updatedAt
    })}\n`,
    "utf8"
  );
}

async function readFileSlice(filePath: string, start: number, length: number): Promise<Buffer> {
  if (length <= 0) {
    return Buffer.alloc(0);
  }

  const handle = await fs.open(filePath, "r");
  const buffer = Buffer.alloc(length);

  try {
    const { bytesRead } = await handle.read(buffer, 0, length, start);

    return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readSessionIndex(): Promise<Map<string, IndexedSession>> {
  const index = new Map<string, IndexedSession>();
  let raw: string;

  try {
    raw = await fs.readFile(sessionIndexPath, "utf8");
  } catch {
    return index;
  }

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line) as { id?: string; thread_name?: string; updated_at?: string };

      if (!entry.id || !entry.thread_name) {
        continue;
      }

      const current = index.get(entry.id);
      if (!current || Date.parse(entry.updated_at ?? "") >= Date.parse(current.updatedAt)) {
        index.set(entry.id, {
          threadName: entry.thread_name,
          updatedAt: entry.updated_at ?? new Date(0).toISOString()
        });
      }
    } catch {
      continue;
    }
  }

  return index;
}

async function parseSessionFile(filePath: string, index: Map<string, IndexedSession>): Promise<ParsedSession | null> {
  const stat = await fs.stat(filePath);
  const fallbackId = idFromFilename(filePath);
  let id = fallbackId;
  let projectPath = "Unknown project";
  let createdAt: string | undefined;
  let source: string | undefined;
  let lastPrompt: ChatMessageExcerpt | null = null;
  let lastAssistant: ChatMessageExcerpt | null = null;
  let lastFinalAssistant: ChatMessageExcerpt | null = null;
  let lastAssistantAfterPrompt: ChatMessageExcerpt | null = null;
  let lastFinalAssistantAfterPrompt: ChatMessageExcerpt | null = null;
  let newestRecordMs = Number.NaN;
  const userMessages: ChatTranscriptMessage[] = [];
  const assistantMessages: ChatTranscriptMessage[] = [];

  const headBuffer = await readFileSlice(filePath, 0, Math.min(stat.size, headBytes));

  for (const line of headBuffer.toString("utf8").split(/\r?\n/)) {
    if (!line.includes('"type":"session_meta"')) {
      continue;
    }

    try {
      const record = JSON.parse(line) as {
        timestamp?: string;
        type?: string;
        payload?: {
          id?: string;
          cwd?: string;
          timestamp?: string;
          type?: string;
          role?: string;
          phase?: string;
          content?: unknown;
          source?: string;
        };
      };

      if (record.type === "session_meta" && record.payload) {
        id = record.payload.id ?? id;
        projectPath = record.payload.cwd ?? projectPath;
        createdAt = record.payload.timestamp ?? record.timestamp ?? createdAt;
        const metaMs = Date.parse(createdAt ?? "");

        if (Number.isFinite(metaMs)) {
          newestRecordMs = Number.isFinite(newestRecordMs) ? Math.max(newestRecordMs, metaMs) : metaMs;
        }

        source = record.payload.source;
        break;
      }
    } catch {
      break;
    }
  }

  const bytesToRead = Math.min(stat.size, tailBytes);
  const start = Math.max(0, stat.size - bytesToRead);
  const buffer = await readFileSlice(filePath, start, bytesToRead);

  for (const line of buffer.toString("utf8").split(/\r?\n/)) {
    if (!line.includes('"timestamp"') && !line.includes('"type":"message"')) {
      continue;
    }

    try {
      const record = JSON.parse(line) as {
        timestamp?: string;
        type?: string;
        payload?: {
          type?: string;
          role?: string;
          phase?: string;
          content?: unknown;
        };
      };
      const recordMs = Date.parse(record.timestamp ?? "");

      if (Number.isFinite(recordMs)) {
        newestRecordMs = Number.isFinite(newestRecordMs) ? Math.max(newestRecordMs, recordMs) : recordMs;
      }

      if (record.payload?.type !== "message") {
        continue;
      }

      const text = textFromContent(record.payload.content);
      const timestamp = record.timestamp ?? new Date(stat.mtimeMs).toISOString();

      if (record.payload.role === "user" && isPromptText(text)) {
        lastPrompt = { text, createdAt: timestamp };
        lastAssistantAfterPrompt = null;
        lastFinalAssistantAfterPrompt = null;
        userMessages.push({
          id: transcriptId("user", timestamp, userMessages.length),
          role: "user",
          text,
          createdAt: timestamp
        });
      }

      if (record.payload.role === "assistant" && text) {
        const isFinalAnswer = record.payload.phase === "final_answer" || !record.payload.phase;
        const isDisplayableAssistant = isFinalAnswer || !isHeartbeatText(text);

        if (!isDisplayableAssistant) {
          continue;
        }

        lastAssistant = { text, createdAt: timestamp };

        if (lastPrompt) {
          lastAssistantAfterPrompt = lastAssistant;
        }

        assistantMessages.push({
          id: transcriptId("assistant", timestamp, assistantMessages.length),
          role: "assistant",
          text,
          createdAt: timestamp,
          isFinal: isFinalAnswer
        });

        if (isFinalAnswer) {
          lastFinalAssistant = lastAssistant;

          if (lastPrompt) {
            lastFinalAssistantAfterPrompt = lastAssistant;
          }
        }
      }
    } catch {
      continue;
    }
  }

  const indexed = index.get(id);
  const indexedUpdated = safeDate(indexed?.updatedAt, stat.mtimeMs);
  const contentUpdatedMs = Number.isFinite(newestRecordMs) ? newestRecordMs : indexedUpdated.ms;
  const updatedMs = Math.max(contentUpdatedMs, Date.parse(createdAt ?? "") || 0);
  const updated = { iso: new Date(updatedMs).toISOString(), ms: updatedMs };
  const response = lastFinalAssistantAfterPrompt ?? lastAssistantAfterPrompt ?? lastFinalAssistant ?? lastAssistant;
  const title = indexed?.threadName ?? previewText(lastPrompt?.text ?? "", id);
  const messages = [...userMessages.slice(-10), ...assistantMessages.slice(-10)].sort((a, b) => {
    const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);

    if (byTime !== 0) {
      return byTime;
    }

    return a.id.localeCompare(b.id);
  });

  return {
    id,
    title,
    projectName: projectNameFromPath(projectPath),
    projectPath,
    createdAt: createdAt ?? new Date(stat.birthtimeMs).toISOString(),
    updatedAt: updated.iso,
    lastPrompt,
    lastResponse: response,
    messages,
    hasResponse: Boolean(response),
    indexed: Boolean(indexed),
    source,
    sortTime: updated.ms
  };
}

function toSummary(session: ParsedSession): ChatSummary {
  return {
    id: session.id,
    title: session.title,
    projectName: session.projectName,
    projectPath: session.projectPath,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastPromptPreview: previewText(session.lastPrompt?.text ?? "", "No prompt yet"),
    lastResponsePreview: previewText(session.lastResponse?.text ?? "", "No response yet"),
    hasResponse: session.hasResponse
  };
}

async function readSessions(): Promise<ParsedSession[]> {
  if (sessionsCache && sessionsCache.expiresAt > Date.now()) {
    return sessionsCache.sessions;
  }

  const index = await readSessionIndex();
  const files = await collectJsonlFiles(sessionsRoot);
  const parsed: Array<ParsedSession | null> = [];

  for (const filePath of files) {
    try {
      parsed.push(await parseSessionFile(filePath, index));
    } catch {
      continue;
    }
  }

  const sessions = parsed
    .filter((session): session is ParsedSession => Boolean(session))
    .sort((a, b) => b.sortTime - a.sortTime);

  sessionsCache = {
    expiresAt: Date.now() + cacheMs,
    sessions
  };

  return sessions;
}

export async function listChats(): Promise<{ projects: ChatProjectGroup[]; totalChats: number }> {
  const sessions = await readSessions();
  const missingIndexSessions = sessions
    .filter((session) => !session.indexed && session.projectName !== "Unknown project")
    .slice(0, 25);

  if (missingIndexSessions.length) {
    await Promise.allSettled(
      missingIndexSessions.map((session) =>
        ensureSessionIndexEntry(
          session.id,
          session.source === "exec" ? session.projectName : session.title,
          session.updatedAt
        )
      )
    );
  }

  const groups = new Map<string, ChatProjectGroup & { sortTime: number }>();

  for (const session of sessions) {
    const summary = toSummary(session);
    const existing = groups.get(session.projectPath);

    if (existing) {
      existing.chats.push(summary);
      existing.updatedAt = existing.sortTime > session.sortTime ? existing.updatedAt : session.updatedAt;
      existing.sortTime = Math.max(existing.sortTime, session.sortTime);
      continue;
    }

    groups.set(session.projectPath, {
      projectName: session.projectName,
      projectPath: session.projectPath,
      updatedAt: session.updatedAt,
      sortTime: session.sortTime,
      chats: [summary]
    });
  }

  return {
    projects: [...groups.values()]
      .sort((a, b) => b.sortTime - a.sortTime)
      .map(({ sortTime: _sortTime, ...group }) => group),
    totalChats: sessions.length
  };
}

export async function getChat(id: string): Promise<ChatDetail | null> {
  const sessions = await readSessions();
  const session = sessions.find((candidate) => candidate.id === id);

  if (!session) {
    return null;
  }

  const { indexed: _indexed, source: _source, sortTime: _sortTime, ...detail } = session;

  return detail;
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);

  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

export async function findNewestChatForProject(projectPath: string, afterMs = 0): Promise<ChatDetail | null> {
  clearSessionCache();

  const sessions = await readSessions();
  const session = sessions.find((candidate) => {
    const createdMs = Date.parse(candidate.createdAt);
    const updatedMs = Date.parse(candidate.updatedAt);
    const isNewEnough =
      !afterMs ||
      (Number.isFinite(createdMs) && createdMs >= afterMs) ||
      (Number.isFinite(updatedMs) && updatedMs >= afterMs);

    return samePath(candidate.projectPath, projectPath) && isNewEnough;
  });

  if (!session) {
    return null;
  }

  const { indexed: _indexed, source: _source, sortTime: _sortTime, ...detail } = session;

  return detail;
}
