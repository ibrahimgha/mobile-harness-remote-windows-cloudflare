import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { ensureSessionIndexEntry, findSessionFile } from "./codexSessions.js";
import type { ChatDetail } from "./types.js";

type PromotableChat = Pick<ChatDetail, "id" | "updatedAt"> &
  Partial<Pick<ChatDetail, "createdAt" | "lastPrompt">>;

const maxSessionMetaBytes = 1024 * 1024;

export function desktopCwd(projectPath: string) {
  const resolved = path.resolve(projectPath);

  if (process.platform !== "win32" || resolved.startsWith("\\\\?\\")) {
    return resolved;
  }

  return `\\\\?\\${resolved}`;
}

function sqlString(value: string | null | undefined) {
  if (value == null) {
    return "NULL";
  }

  return `'${value.replace(/'/g, "''")}'`;
}

async function runSqlite(sql: string) {
  const dbPath = path.join(os.homedir(), ".codex", "state_5.sqlite");

  if (!existsSync(dbPath)) {
    return;
  }

  await new Promise<void>((resolve) => {
    const child = spawn("sqlite3", [dbPath, sql], {
      windowsHide: true,
      stdio: "ignore"
    });

    child.on("error", () => resolve());
    child.on("close", () => resolve());
  });
}

async function rewriteSessionMetaForDesktop(chatId: string, projectPath: string) {
  const sessionPath = await findSessionFile(chatId);

  if (!sessionPath) {
    return;
  }

  const stat = await fs.stat(sessionPath);
  const normalizedCwd = desktopCwd(projectPath);
  const handle = await fs.open(sessionPath, "r");
  let header = Buffer.alloc(0);
  let newlineIndex = -1;
  try {
    while (header.length < maxSessionMetaBytes && newlineIndex < 0) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maxSessionMetaBytes - header.length));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, header.length);
      if (!bytesRead) break;
      header = header.length
        ? Buffer.concat([header, chunk.subarray(0, bytesRead)])
        : Buffer.from(chunk.subarray(0, bytesRead));
      newlineIndex = header.indexOf(0x0a);
    }
  } finally {
    await handle.close();
  }

  if (newlineIndex < 0) return;
  const lineEnd = newlineIndex > 0 && header[newlineIndex - 1] === 0x0d
    ? newlineIndex - 1
    : newlineIndex;
  const originalLine = header.subarray(0, lineEnd).toString("utf8");
  let rewrittenLine: string;
  try {
    const record = JSON.parse(originalLine) as {
      type?: string;
      payload?: {
        id?: string;
        cwd?: string;
        source?: string;
        thread_source?: string;
      };
    };
    if (record.type !== "session_meta" || record.payload?.id !== chatId) return;
    if (
      record.payload.cwd === normalizedCwd &&
      record.payload.source === "vscode" &&
      record.payload.thread_source === "user"
    ) {
      return;
    }
    record.payload.cwd = normalizedCwd;
    record.payload.source = "vscode";
    record.payload.thread_source = "user";
    rewrittenLine = JSON.stringify(record);
  } catch {
    return;
  }

  const newline = lineEnd < newlineIndex ? "\r\n" : "\n";
  const remainderStart = newlineIndex + 1;
  const temporaryPath = `${sessionPath}.desktop-meta-${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${rewrittenLine}${newline}`, { flag: "wx", mode: stat.mode });
    await pipeline(
      createReadStream(sessionPath, { start: remainderStart }),
      createWriteStream(temporaryPath, { flags: "a" })
    );
    await fs.chmod(temporaryPath, stat.mode);
    if (process.platform !== "win32") await fs.chown(temporaryPath, stat.uid, stat.gid);
    await fs.rename(temporaryPath, sessionPath);
    await fs.utimes(sessionPath, stat.atime, stat.mtime);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function epochMs(value: string | undefined, fallback: number) {
  const parsed = value ? Date.parse(value) : Number.NaN;

  return Number.isFinite(parsed) ? parsed : fallback;
}

function compactText(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export async function promoteChatForDesktop(chat: PromotableChat, title: string, projectPath: string) {
  const normalizedCwd = desktopCwd(projectPath);
  const nowMs = Date.now();
  const updatedMs = epochMs(chat.updatedAt, nowMs);
  const createdMs = epochMs(chat.createdAt, updatedMs);
  const updatedSeconds = Math.floor(updatedMs / 1000);
  const createdSeconds = Math.floor(createdMs / 1000);
  const sessionPath = await findSessionFile(chat.id);
  const firstUserMessage = compactText(chat.lastPrompt?.text ?? "", 4000);
  const preview = compactText(firstUserMessage || title, 1000);

  await rewriteSessionMetaForDesktop(chat.id, projectPath);
  await ensureSessionIndexEntry(chat.id, title, chat.updatedAt);

  if (!sessionPath) {
    return;
  }

  await runSqlite(
    [
      "INSERT INTO threads (",
      [
        "id",
        "rollout_path",
        "created_at",
        "updated_at",
        "source",
        "model_provider",
        "cwd",
        "title",
        "sandbox_policy",
        "approval_mode",
        "tokens_used",
        "has_user_event",
        "archived",
        "cli_version",
        "first_user_message",
        "memory_mode",
        "created_at_ms",
        "updated_at_ms",
        "thread_source",
        "preview"
      ].join(", "),
      ") VALUES (",
      [
        sqlString(chat.id),
        sqlString(sessionPath),
        String(createdSeconds),
        String(updatedSeconds),
        "'vscode'",
        "'openai'",
        sqlString(normalizedCwd),
        sqlString(title),
        sqlString('{"type":"danger-full-access"}'),
        "'never'",
        "0",
        "1",
        "0",
        "''",
        sqlString(firstUserMessage),
        "'enabled'",
        String(createdMs),
        String(updatedMs),
        "'user'",
        sqlString(preview)
      ].join(", "),
      ") ON CONFLICT(id) DO UPDATE SET",
      "rollout_path=excluded.rollout_path,",
      "source='vscode',",
      "thread_source='user',",
      "cwd=excluded.cwd,",
      "title=excluded.title,",
      "has_user_event=1,",
      "archived=0,",
      "first_user_message=CASE WHEN threads.first_user_message='' THEN excluded.first_user_message ELSE threads.first_user_message END,",
      "preview=CASE WHEN threads.preview='' THEN excluded.preview ELSE threads.preview END,",
      "updated_at=MAX(threads.updated_at, excluded.updated_at),",
      "updated_at_ms=MAX(COALESCE(threads.updated_at_ms, 0), excluded.updated_at_ms);"
    ].join(" ")
  );
}
