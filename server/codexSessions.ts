import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { ChatDetail, ChatMessageExcerpt, ChatProjectGroup, ChatSummary, ChatTranscriptMessage } from "./types.js";

const sessionsRoot = process.env.CODEX_SESSIONS_DIR ?? path.join(os.homedir(), ".codex", "sessions");
const sessionIndexPath = process.env.CODEX_SESSION_INDEX ?? path.join(os.homedir(), ".codex", "session_index.jsonl");
const maxSessionFiles = Number(process.env.CODEX_MAX_SESSION_FILES ?? 300);
const cacheMs = Number(process.env.CODEX_SESSION_CACHE_MS ?? 5000);
const tailBytes = Number(process.env.CODEX_SESSION_TAIL_BYTES ?? 4 * 1024 * 1024);
const summaryTailBytes = Number(process.env.CODEX_SESSION_SUMMARY_TAIL_BYTES ?? 768 * 1024);
const headBytes = Math.max(16 * 1024, Number(process.env.CODEX_SESSION_HEAD_BYTES ?? 256 * 1024) || 256 * 1024);
const parseConcurrency = Math.max(1, Number(process.env.CODEX_SESSION_PARSE_CONCURRENCY ?? 8) || 8);
const defaultDetailTurns = Math.max(1, Number(process.env.CODEX_CHAT_DETAIL_TURNS ?? 10) || 10);
const maxDetailTurns = Math.max(defaultDetailTurns, Number(process.env.CODEX_CHAT_DETAIL_MAX_TURNS ?? 200) || 200);
const maxEventTextLength = Math.max(1000, Number(process.env.CODEX_CHAT_EVENT_TEXT_BYTES ?? 12000) || 12000);

let summarySessionsCache: { expiresAt: number; sessions: ParsedSession[] } | null = null;

type IndexedSession = {
  threadName: string;
  updatedAt: string;
};

type ParsedSession = ChatDetail & {
  indexed: boolean;
  source?: string;
  sortTime: number;
};

type ParseSessionOptions = {
  maxTailBytes?: number;
  detailTurns?: number;
};

export function clearSessionCache() {
  summarySessionsCache = null;
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

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function clampEventText(text: string): string {
  const normalized = text.trimEnd();

  if (normalized.length <= maxEventTextLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxEventTextLength)}\n\n[Output truncated in remote view]`;
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

function transcriptId(kind: string, createdAt: string, index: number): string {
  return `${Date.parse(createdAt) || 0}-${String(index).padStart(6, "0")}-${kind}`;
}

function projectNameFromPath(projectPath: string): string {
  if (!projectPath || projectPath === "Unknown project") {
    return "Unknown project";
  }

  return path.basename(projectPath) || projectPath;
}

function normalizeProjectPath(projectPath: string): string {
  if (!projectPath || projectPath === "Unknown project") {
    return projectPath;
  }

  let normalized = projectPath.trim();

  if (process.platform === "win32") {
    normalized = normalized.replace(/\//g, "\\");

    if (/^\\\\\?\\unc\\/i.test(normalized)) {
      normalized = `\\\\${normalized.slice(8)}`;
    } else if (/^\\\\\?\\/i.test(normalized)) {
      normalized = normalized.slice(4);
    }
  }

  try {
    return path.resolve(normalized);
  } catch {
    return normalized;
  }
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

function clampDetailTurns(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return defaultDetailTurns;
  }

  return Math.min(maxDetailTurns, Math.max(1, Math.floor(value ?? defaultDetailTurns)));
}

function paginateTranscriptMessages(messages: ChatTranscriptMessage[], requestedTurns: number) {
  const visibleTurns = clampDetailTurns(requestedTurns);
  const userIndexes = messages.reduce<number[]>((indexes, message, index) => {
    if (message.role === "user") {
      indexes.push(index);
    }

    return indexes;
  }, []);
  const totalTurns = userIndexes.length;

  if (!totalTurns) {
    return {
      messages: messages.slice(-visibleTurns * 2),
      page: {
        visibleTurns: 0,
        totalTurns: 0,
        hasMore: messages.length > visibleTurns * 2
      }
    };
  }

  const firstVisibleTurnIndex = Math.max(0, totalTurns - visibleTurns);
  const firstMessageIndex = userIndexes[firstVisibleTurnIndex] ?? 0;
  const pageMessages = messages.slice(firstMessageIndex);
  const actualVisibleTurns = Math.min(visibleTurns, totalTurns);

  return {
    messages: pageMessages,
    page: {
      visibleTurns: actualVisibleTurns,
      totalTurns,
      hasMore: totalTurns > actualVisibleTurns
    }
  };
}

function tryParseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function formatToolCallText(toolName: string, input: unknown): string {
  const parsed = tryParseJsonObject(input);

  if (parsed && typeof parsed.command === "string") {
    return `\`\`\`powershell\n${parsed.command}\n\`\`\``;
  }

  if (parsed && typeof parsed.mermaidSyntax === "string") {
    return `\`\`\`mermaid\n${parsed.mermaidSyntax}\n\`\`\``;
  }

  if (parsed && typeof parsed.prompt === "string") {
    return parsed.prompt;
  }

  const text = textFromUnknown(input);
  if (!text) {
    return toolName;
  }

  return text.trim().startsWith("{") || text.trim().startsWith("[") ? `\`\`\`json\n${text}\n\`\`\`` : clampEventText(text);
}

function formatStructuredToolText(value: unknown): string {
  const text = textFromUnknown(value);

  if (!text) {
    return "No details.";
  }

  const clamped = clampEventText(text);

  return clamped.trim().startsWith("{") || clamped.trim().startsWith("[") ? `\`\`\`json\n${clamped}\n\`\`\`` : clamped;
}

function formatToolOutputText(output: unknown): string {
  const text = textFromUnknown(output);

  if (!text) {
    return "No output.";
  }

  const clamped = clampEventText(text);
  return clamped.trimStart().startsWith("```") ? clamped : `\`\`\`text\n${clamped}\n\`\`\``;
}

async function parseSessionFile(
  filePath: string,
  index: Map<string, IndexedSession>,
  options: ParseSessionOptions | number = {}
): Promise<ParsedSession | null> {
  const maxTailBytes = typeof options === "number" ? options : options.maxTailBytes ?? tailBytes;
  const detailTurns = typeof options === "number" ? defaultDetailTurns : clampDetailTurns(options.detailTurns);
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
  const transcriptMessages: ChatTranscriptMessage[] = [];
  const appendTranscriptMessage = (message: Omit<ChatTranscriptMessage, "id"> & { id?: string }) => {
    transcriptMessages.push({
      ...message,
      id: message.id ?? transcriptId(message.kind ?? message.role, message.createdAt, transcriptMessages.length)
    });
  };

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
        projectPath = normalizeProjectPath(record.payload.cwd ?? projectPath);
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

  const consumeTranscriptLine = (line: string) => {
    if (!line.includes('"payload"') && !line.includes('"type":"error"') && !line.includes('"type":"turn.failed"')) {
      return;
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
          message?: unknown;
          name?: string;
          arguments?: unknown;
          input?: unknown;
          output?: unknown;
          call_id?: string;
          status?: string;
          stdout?: unknown;
          stderr?: unknown;
          success?: boolean;
          duration_ms?: number;
          time_to_first_token_ms?: number;
          last_agent_message?: unknown;
          action?: unknown;
          query?: unknown;
          changes?: unknown;
          source_chat_id?: unknown;
          source_title?: unknown;
          error?: {
            message?: unknown;
          };
        };
        message?: unknown;
        error?: {
          message?: unknown;
        };
      };
      const recordMs = Date.parse(record.timestamp ?? "");

      if (Number.isFinite(recordMs)) {
        newestRecordMs = Number.isFinite(newestRecordMs) ? Math.max(newestRecordMs, recordMs) : recordMs;
      }

      const timestamp = record.timestamp ?? new Date(stat.mtimeMs).toISOString();
      const payload = record.payload;

      if (record.type === "error" || record.type === "turn.failed") {
        appendTranscriptMessage({
          role: "system",
          kind: "error",
          label: "Codex error",
          text: clampEventText(textFromUnknown(record.message ?? record.error?.message ?? "Codex run failed")),
          createdAt: timestamp
        });
        return;
      }

      if (!payload?.type) {
        return;
      }

      if (record.type === "response_item" && payload.type === "function_call") {
        appendTranscriptMessage({
          role: "tool",
          kind: "tool_call",
          label: payload.name ? `Tool call: ${payload.name}` : "Tool call",
          toolName: payload.name,
          callId: payload.call_id,
          status: payload.status,
          text: formatToolCallText(payload.name ?? "tool", payload.arguments),
          createdAt: timestamp
        });
        return;
      }

      if (record.type === "response_item" && payload.type === "custom_tool_call") {
        appendTranscriptMessage({
          role: "tool",
          kind: "tool_call",
          label: payload.name ? `Tool call: ${payload.name}` : "Tool call",
          toolName: payload.name,
          callId: payload.call_id,
          status: payload.status,
          text: formatToolCallText(payload.name ?? "tool", payload.input),
          createdAt: timestamp
        });
        return;
      }

      if (record.type === "response_item" && payload.type === "function_call_output") {
        appendTranscriptMessage({
          role: "tool",
          kind: "tool_output",
          label: "Tool output",
          callId: payload.call_id,
          status: payload.status,
          text: formatToolOutputText(payload.output),
          createdAt: timestamp
        });
        return;
      }

      if (record.type === "response_item" && payload.type === "custom_tool_call_output") {
        appendTranscriptMessage({
          role: "tool",
          kind: "tool_output",
          label: "Tool output",
          callId: payload.call_id,
          status: payload.status,
          text: formatToolOutputText(payload.output),
          createdAt: timestamp
        });
        return;
      }

      if (record.type === "response_item" && payload.type === "web_search_call") {
        appendTranscriptMessage({
          role: "tool",
          kind: "tool_call",
          label: "Web search",
          status: payload.status,
          text: formatStructuredToolText(payload.action ?? payload.query ?? payload),
          createdAt: timestamp
        });
        return;
      }

      if (record.type === "event_msg" && payload.type === "task_complete") {
        appendTranscriptMessage({
          role: "system",
          kind: "task_complete",
          label: "Run complete",
          durationMs: payload.duration_ms,
          text: payload.duration_ms ? `Completed in ${Math.round(payload.duration_ms / 1000)}s` : "Run complete",
          createdAt: timestamp
        });
        return;
      }

      if (record.type === "event_msg" && payload.type === "chat_forked") {
        const sourceTitle = textFromUnknown(payload.source_title).replace(/\s+/g, " ").trim();
        const sourceChatId = textFromUnknown(payload.source_chat_id).trim();
        const label = sourceTitle || sourceChatId || "source chat";

        appendTranscriptMessage({
          role: "system",
          kind: "forked_from",
          label: "Forked chat",
          text: `Forked from ${label}`,
          createdAt: timestamp
        });
        return;
      }

      if (record.type === "event_msg" && payload.type === "error") {
        appendTranscriptMessage({
          role: "system",
          kind: "error",
          label: "Codex error",
          text: clampEventText(textFromUnknown(payload.message ?? payload.error?.message ?? "Codex error")),
          createdAt: timestamp
        });
        return;
      }

      if (record.type === "event_msg" && /_(end|complete|completed)$/i.test(payload.type)) {
        if (payload.success === false) {
          const output = [payload.stdout, payload.stderr, payload.output, payload.error?.message]
            .map(textFromUnknown)
            .filter(Boolean)
            .join("\n");

          appendTranscriptMessage({
            role: "tool",
            kind: "error",
            label: payload.type.replace(/_/g, " "),
            status: payload.status,
            text: formatToolOutputText(output || "Tool reported failure."),
            createdAt: timestamp
          });
        }

        return;
      }

      if (payload.type !== "message") {
        return;
      }

      const text = textFromContent(payload.content);

      if (payload.role === "user" && isPromptText(text)) {
        lastPrompt = { text, createdAt: timestamp };
        lastAssistantAfterPrompt = null;
        lastFinalAssistantAfterPrompt = null;
        appendTranscriptMessage({
          role: "user",
          kind: "user_prompt",
          label: "You",
          text,
          createdAt: timestamp
        });
      }

      if (payload.role === "assistant" && text) {
        const isFinalAnswer = payload.phase === "final_answer" || !payload.phase;
        const isDisplayableAssistant = isFinalAnswer || !isHeartbeatText(text);

        if (!isDisplayableAssistant) {
          return;
        }

        lastAssistant = { text, createdAt: timestamp };

        if (lastPrompt) {
          lastAssistantAfterPrompt = lastAssistant;
        }

        appendTranscriptMessage({
          role: "assistant",
          kind: isFinalAnswer ? "assistant_final" : "assistant_commentary",
          label: isFinalAnswer ? "Codex" : "Codex update",
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
      return;
    }
  };

  if (maxTailBytes >= stat.size) {
    const lines = createInterface({
      input: createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity
    });

    for await (const line of lines) {
      consumeTranscriptLine(line);
    }
  } else {
    const bytesToRead = Math.min(stat.size, maxTailBytes);
    const start = Math.max(0, stat.size - bytesToRead);
    const buffer = await readFileSlice(filePath, start, bytesToRead);

    for (const line of buffer.toString("utf8").split(/\r?\n/)) {
      consumeTranscriptLine(line);
    }
  }

  const indexed = index.get(id);
  const indexedUpdated = safeDate(indexed?.updatedAt, stat.mtimeMs);
  const contentUpdatedMs = Number.isFinite(newestRecordMs) ? newestRecordMs : indexedUpdated.ms;
  const updatedMs = Math.max(contentUpdatedMs, Date.parse(createdAt ?? "") || 0);
  const updated = { iso: new Date(updatedMs).toISOString(), ms: updatedMs };
  const currentLastPrompt = lastPrompt as ChatMessageExcerpt | null;
  const response = (lastFinalAssistantAfterPrompt ?? lastAssistantAfterPrompt ?? lastFinalAssistant ?? lastAssistant) as
    | ChatMessageExcerpt
    | null;
  const title = indexed?.threadName ?? previewText(currentLastPrompt?.text ?? "", id);
  const sortedMessages = transcriptMessages.sort((a, b) => {
    const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);

    if (byTime !== 0) {
      return byTime;
    }

    return a.id.localeCompare(b.id);
  });
  const messagePage = paginateTranscriptMessages(sortedMessages, detailTurns);

  return {
    id,
    title,
    projectName: projectNameFromPath(projectPath),
    projectPath,
    createdAt: createdAt ?? new Date(stat.birthtimeMs).toISOString(),
    updatedAt: updated.iso,
    lastPrompt: currentLastPrompt,
    lastResponse: response,
    messages: messagePage.messages,
    messagePage: messagePage.page,
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

async function readSessions(maxTailBytes = summaryTailBytes): Promise<ParsedSession[]> {
  const canUseCache = maxTailBytes === summaryTailBytes;

  if (canUseCache && summarySessionsCache && summarySessionsCache.expiresAt > Date.now()) {
    return summarySessionsCache.sessions;
  }

  const index = await readSessionIndex();
  const files = await collectJsonlFiles(sessionsRoot);
  const parsed: Array<ParsedSession | null> = [];

  for (let offset = 0; offset < files.length; offset += parseConcurrency) {
    const batch = await Promise.allSettled(
      files.slice(offset, offset + parseConcurrency).map((filePath) => parseSessionFile(filePath, index, maxTailBytes))
    );

    for (const result of batch) {
      if (result.status === "fulfilled") {
        parsed.push(result.value);
      }
    }
  }

  const sessions = parsed
    .filter((session): session is ParsedSession => Boolean(session))
    .sort((a, b) => b.sortTime - a.sortTime);

  if (canUseCache) {
    summarySessionsCache = {
      expiresAt: Date.now() + cacheMs,
      sessions
    };
  }

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

export async function getChat(id: string, options: { detailTurns?: number } = {}): Promise<ChatDetail | null> {
  const filePath = await findSessionFile(id);

  if (!filePath) {
    return null;
  }

  const session = await parseSessionFile(filePath, await readSessionIndex(), {
    maxTailBytes: Number.POSITIVE_INFINITY,
    detailTurns: options.detailTurns
  });

  if (!session) {
    return null;
  }

  const { indexed: _indexed, source: _source, sortTime: _sortTime, ...detail } = session;

  return detail;
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = normalizeProjectPath(left);
  const normalizedRight = normalizeProjectPath(right);

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
