import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
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

function rewriteSessionFile(raw: string, oldId: string, newId: string, nowIso: string): string {
  const lines = raw.split(/\r?\n/);
  let sessionMetaUpdated = false;
  const rewritten: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      rewritten.push(line);
      continue;
    }

    if (line.includes('"type":"session_meta"')) {
      if (!sessionMetaUpdated) {
        sessionMetaUpdated = true;
        rewritten.push(rewriteSessionMeta(line, oldId, newId, nowIso));
      }

      continue;
    }

    rewritten.push(line.replaceAll(oldId, newId));
  }

  return rewritten.join("\n").replace(/\n*$/, "\n");
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
  const raw = await fs.readFile(sourcePath, "utf8");
  const rewritten = `${rewriteSessionFile(raw, sourceChatId, newId, nowIso).trimEnd()}\n${forkMarkerEvent(
    nowIso,
    sourceChatId,
    sourceChat?.title ?? sourceChatId
  )}`;

  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(targetPath, rewritten, { flag: "wx" });
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
