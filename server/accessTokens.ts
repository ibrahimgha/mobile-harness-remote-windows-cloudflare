import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CodexReasoningEffort, CodexRunSettings, CodexRunSpeed } from "./types.js";

export type FullRemoteAccess = {
  mode: "full";
};

export type SingleChatRemoteAccess = {
  mode: "single-chat";
  tokenId: string;
  chatId: string;
  chatTitle: string;
  projectName: string;
  projectPath: string;
  settings: CodexRunSettings;
};

export type RemoteAccess = FullRemoteAccess | SingleChatRemoteAccess;

type StoredAccessToken = {
  id: string;
  tokenHash: string;
  chatId: string;
  chatTitle: string;
  projectName: string;
  projectPath: string;
  model: string;
  reasoningEffort: CodexReasoningEffort;
  speed: CodexRunSpeed;
};

type StoredAccessTokenFile = {
  version: 1;
  tokens: StoredAccessToken[];
};

const accessTokensPath = path.resolve(
  process.env.CODEX_REMOTE_ACCESS_TOKENS_PATH ?? path.join(process.cwd(), ".runtime", "access-tokens.json")
);
let cachedMtimeMs = -1;
let cachedTokens: StoredAccessToken[] = [];

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeHashMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function loadTokens() {
  try {
    const stat = fs.statSync(accessTokensPath);
    if (stat.mtimeMs === cachedMtimeMs) {
      return cachedTokens;
    }

    const parsed = JSON.parse(fs.readFileSync(accessTokensPath, "utf8")) as StoredAccessTokenFile;
    cachedTokens = Array.isArray(parsed.tokens)
      ? parsed.tokens.filter(
          (entry) =>
            typeof entry.id === "string" &&
            /^[a-f0-9]{64}$/i.test(entry.tokenHash) &&
            typeof entry.chatId === "string" &&
            typeof entry.projectPath === "string" &&
            typeof entry.model === "string"
        )
      : [];
    cachedMtimeMs = stat.mtimeMs;
  } catch {
    cachedTokens = [];
    cachedMtimeMs = -1;
  }

  return cachedTokens;
}

export function hasScopedAccessTokens() {
  return loadTokens().length > 0;
}

export function resolveScopedAccessToken(value: unknown): SingleChatRemoteAccess | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const candidateHash = hashToken(value);
  const token = loadTokens().find((entry) => safeHashMatch(candidateHash, entry.tokenHash));

  if (!token) {
    return null;
  }

  return {
    mode: "single-chat",
    tokenId: token.id,
    chatId: token.chatId,
    chatTitle: token.chatTitle,
    projectName: token.projectName,
    projectPath: token.projectPath,
    settings: {
      model: token.model,
      reasoningEffort: token.reasoningEffort,
      speed: token.speed,
      updatedAt: new Date().toISOString()
    }
  };
}

export function scopedRequestAllowed(method: string, requestPath: string, access: SingleChatRemoteAccess) {
  const verb = method.toUpperCase();
  const encodedChatId = encodeURIComponent(access.chatId);
  const exactChatPrefix = `/api/chats/${encodedChatId}`;

  if (verb === "POST" && requestPath === "/api/auth/verify") return true;
  if (verb === "GET" && ["/api/state", "/api/chats", "/api/jobs", "/api/chats/activity"].includes(requestPath)) return true;
  if (verb === "GET" && ["/api/local-image", "/api/local-file", "/api/local-download"].includes(requestPath)) return true;
  if (!requestPath.startsWith(exactChatPrefix)) return false;

  const suffix = requestPath.slice(exactChatPrefix.length);
  if (verb === "GET" && (suffix === "" || suffix === "/jobs" || suffix === "/uploads")) return true;
  if (verb === "POST" && (suffix === "/prompt" || suffix === "/steer" || suffix === "/files")) return true;
  if (verb === "PUT" && suffix === "/files/chunk") return true;
  if (verb === "POST" && /^\/jobs\/[^/]+\/stop$/.test(suffix)) return true;
  if (verb === "DELETE" && /^\/queued-prompts\/[^/]+$/.test(suffix)) return true;
  if (verb === "POST" && /^\/queued-prompts\/[^/]+\/(prioritize|steer)$/.test(suffix)) return true;
  return false;
}

function pathIsWithin(candidatePath: string, rootPath: string) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function scopedLocalPathAllowed(candidatePath: string, access: SingleChatRemoteAccess) {
  const chatUploadsRoot = path.join(
    process.env.CODEX_REMOTE_UPLOAD_ROOT ?? path.join(process.cwd(), ".codex-remote", "uploads"),
    access.chatId
  );
  return pathIsWithin(candidatePath, access.projectPath) || pathIsWithin(candidatePath, chatUploadsRoot);
}

export function scopedAccessTokensFilePath() {
  return accessTokensPath;
}
