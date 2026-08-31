import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { clearSessionCache, ensureSessionIndexEntry, findSessionFile, getSessionsRoot, getChat } from "./codexSessions.js";
import { promoteChatForDesktop } from "./desktopVisibility.js";
import type { ChatDetail } from "./types.js";

export type ForkChatResult = {
  chat: ChatDetail;
  sourceChatId: string;
  sessionPath: string;
};

export type RenameChatResult = {
  chat: ChatDetail;
};

const maxForkNameLength = Number(process.env.CODEX_FORK_NAME_MAX_CHARS ?? 120);
const maxSessionMetaBytes = 1024 * 1024;
const forkStreamChunkBytes = 1024 * 1024;

function cleanChatName(value: string): string {
  const name = value.replace(/\s+/g, " ").trim().slice(0, maxForkNameLength);

  if (!name) {
    throw new Error("Chat name is required");
  }

  return name;
}

function filenameTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "").replace(/:/g, "-");
}

function sessionDirFor(date: Date): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return path.join(getSessionsRoot(), year, month, day);
}

function rewriteSessionMeta(line: string, oldId: string, newId: string, nowIso: string): string {
  try {
    const record = JSON.parse(line) as {
      timestamp?: string;
      type?: string;
      payload?: {
        id?: string;
        timestamp?: string;
        source?: string;
        thread_source?: string;
      };
    };

    if (record.type !== "session_meta" || !record.payload) {
      return line.replaceAll(oldId, newId);
    }

    record.timestamp = nowIso;
    record.payload.id = newId;
    record.payload.timestamp = nowIso;
    record.payload.source = "vscode";
    record.payload.thread_source = "user";

    return JSON.stringify(record);
  } catch {
    return line.replaceAll(oldId, newId);
  }
}

function forkMarkerEvent(nowIso: string, sourceChatId: string, sourceTitle: string) {
  return `${JSON.stringify({
    timestamp: nowIso,
    type: "event_msg",
    payload: {
      type: "chat_forked",
      source_chat_id: sourceChatId,
      source_title: sourceTitle
    }
  })}\n`;
}

function createForkTransform(oldId: string, newId: string, nowIso: string, marker: string) {
  const oldIdBytes = Buffer.from(oldId, "utf8");
  const newIdBytes = Buffer.from(newId, "utf8");
  if (oldIdBytes.length !== newIdBytes.length) {
    throw new Error("Forked session IDs must have the same encoded length");
  }

  let sessionMetaPending = Buffer.alloc(0);
  let sessionMetaWritten = false;
  let replacementTail = Buffer.alloc(0);
  let lastOutputByte: number | undefined;

  const transform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        let remaining = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (!sessionMetaWritten) {
          const combined = sessionMetaPending.length
            ? Buffer.concat([sessionMetaPending, remaining])
            : remaining;
          const newlineIndex = combined.indexOf(0x0a);
          if (newlineIndex < 0) {
            if (combined.length > maxSessionMetaBytes) {
              throw new Error("Session metadata header is unexpectedly large");
            }
            sessionMetaPending = Buffer.from(combined);
            callback();
            return;
          }

          const lineEnd = newlineIndex > 0 && combined[newlineIndex - 1] === 0x0d
            ? newlineIndex - 1
            : newlineIndex;
          pushOutput(Buffer.from(`${rewriteSessionMeta(combined.subarray(0, lineEnd).toString("utf8"), oldId, newId, nowIso)}\n`));
          sessionMetaPending = Buffer.alloc(0);
          sessionMetaWritten = true;
          remaining = combined.subarray(newlineIndex + 1);
        }

        replaceAndPush(remaining, false);
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        if (!sessionMetaWritten && sessionMetaPending.length) {
          pushOutput(Buffer.from(`${rewriteSessionMeta(sessionMetaPending.toString("utf8"), oldId, newId, nowIso)}\n`));
          sessionMetaPending = Buffer.alloc(0);
          sessionMetaWritten = true;
        }
        replaceAndPush(Buffer.alloc(0), true);
        if (lastOutputByte !== 0x0a) pushOutput(Buffer.from("\n"));
        pushOutput(Buffer.from(marker));
        callback();
      } catch (error) {
        callback(error as Error);
      }
    }
  });

  function pushOutput(value: Buffer) {
    if (!value.length) return;
    lastOutputByte = value[value.length - 1];
    transform.push(value);
  }

  function replaceAndPush(chunk: Buffer, final: boolean) {
    const combined = replacementTail.length
      ? Buffer.concat([replacementTail, chunk])
      : Buffer.from(chunk);
    const safeLength = final
      ? combined.length
      : Math.max(0, combined.length - oldIdBytes.length + 1);
    const rewritten = Buffer.from(combined);
    let matchIndex = rewritten.indexOf(oldIdBytes);
    while (matchIndex >= 0 && (final || matchIndex < safeLength)) {
      newIdBytes.copy(rewritten, matchIndex);
      matchIndex = rewritten.indexOf(oldIdBytes, matchIndex + oldIdBytes.length);
    }

    pushOutput(rewritten.subarray(0, safeLength));
    replacementTail = Buffer.from(rewritten.subarray(safeLength));
  }

  return transform;
}

export async function streamForkSessionFile(
  sourcePath: string,
  targetPath: string,
  oldId: string,
  newId: string,
  nowIso: string,
  marker: string
) {
  await pipeline(
    createReadStream(sourcePath, { highWaterMark: forkStreamChunkBytes }),
    createForkTransform(oldId, newId, nowIso, marker),
    createWriteStream(targetPath, { flags: "wx" })
  );
}

export async function forkChatSession(sourceChatId: string, rawName: string): Promise<ForkChatResult> {
  const name = cleanChatName(rawName);
  const sourcePath = await findSessionFile(sourceChatId);

  if (!sourcePath) {
    throw new Error("Source chat session file was not found");
  }

  const sourceChat = await getChat(sourceChatId);
  const now = new Date();
  const nowIso = now.toISOString();
  const newId = randomUUID();
  const targetDir = sessionDirFor(now);
  const targetPath = path.join(targetDir, `rollout-${filenameTimestamp(now)}-${newId}.jsonl`);
  await fs.mkdir(targetDir, { recursive: true });
  await streamForkSessionFile(
    sourcePath,
    targetPath,
    sourceChatId,
    newId,
    nowIso,
    forkMarkerEvent(nowIso, sourceChatId, sourceChat?.title ?? sourceChatId)
  );
  await ensureSessionIndexEntry(newId, name, nowIso);

  clearSessionCache();

  let chat = await getChat(newId);

  if (!chat) {
    throw new Error("Forked chat was created, but could not be read yet");
  }

  await promoteChatForDesktop(chat, name, chat.projectPath);
  clearSessionCache();
  chat = (await getChat(newId)) ?? chat;

  return {
    chat,
    sourceChatId,
    sessionPath: targetPath
  };
}

export async function renameChatSession(chatId: string, rawName: string): Promise<RenameChatResult> {
  const name = cleanChatName(rawName);
  const chat = await getChat(chatId);

  if (!chat) {
    throw new Error("Chat was not found");
  }

  const renamedAt = new Date().toISOString();
  await ensureSessionIndexEntry(chatId, name, renamedAt);
  await promoteChatForDesktop({ ...chat, updatedAt: renamedAt }, name, chat.projectPath);
  clearSessionCache();

  return {
    chat: (await getChat(chatId)) ?? {
      ...chat,
      title: name,
      updatedAt: renamedAt
    }
  };
}
