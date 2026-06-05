import "dotenv/config";
import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { appendAuditEvent, getAuditLogPath, readAuditEvents, summarizePrompt } from "./auditLog.js";
import { CodexBridge } from "./codexBridge.js";
import { CodexRunner } from "./codexRunner.js";
import { clearSessionCache, getChat, listChats } from "./codexSessions.js";
import {
  getDefaultProjectsRoot,
  resolveNewProjectPath,
  startProjectChat,
  type ProjectChatStartResult
} from "./projectStarter.js";
import { getRunSettings, getRunSettingsOptions, updateRunSettings } from "./runSettings.js";
import { forkChatSession, renameChatSession } from "./sessionForker.js";
import type { BridgeEvent, BridgeState, ChatMessageViewMode, CodexRunSettings, ShortcutInstructionFile, UploadedPromptFile } from "./types.js";
import {
  countPushSubscriptions,
  getPushPublicKey,
  removePushSubscription,
  savePushSubscription,
  sendJobPushNotification,
  sendTestPushNotification
} from "./webPush.js";

const port = Number(process.env.PORT ?? 8787);
const clientOrigin = process.env.CLIENT_ORIGIN;
const controlToken = process.env.CONTROL_TOKEN?.trim() ?? "";
const controlEnabled = process.env.ENABLE_WINDOW_CONTROL === "true";
const targetTitle = process.env.CODEX_WINDOW_TITLE?.trim() || "Codex";
const tokenRequired = controlEnabled || controlToken.length > 0;
const promptDelivery = "cli" as const;
const maxPromptLength = Number(process.env.REMOTE_PROMPT_MAX_CHARS ?? 12000);
const maxUploadFiles = Number(process.env.REMOTE_UPLOAD_MAX_FILES ?? 5);
const maxUploadBytes = Number(process.env.REMOTE_UPLOAD_MAX_BYTES ?? 10 * 1024 * 1024);
const maxUploadTotalBytes = Number(process.env.REMOTE_UPLOAD_MAX_TOTAL_BYTES ?? 20 * 1024 * 1024);
const socketHeartbeatMs = Math.max(5000, Number(process.env.SOCKET_HEARTBEAT_MS ?? 25000) || 25000);
const shortcutInstructionsRoot = path.resolve(
  process.env.SHORTCUT_INSTRUCTIONS_DIR ?? path.join(os.homedir(), "shortcut-instructions")
);
const maxShortcutInstructionBytes = Number(process.env.SHORTCUT_INSTRUCTION_MAX_BYTES ?? 128 * 1024);
const maxShortcutInstructionTotalBytes = Number(process.env.SHORTCUT_INSTRUCTION_MAX_TOTAL_BYTES ?? 768 * 1024);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });
const bridge = new CodexBridge({ enabled: controlEnabled, targetTitle });
const runner = new CodexRunner({
  onJobChange(job, event) {
    clearSessionCache();
    pushEvent(event === "failed" ? "error" : "action", job.message ?? `Codex run ${event}`, {
      action: `codex-run-${event}`,
      chatId: job.chatId,
      job
    });

    if (event === "completed" || event === "failed") {
      void sendJobPushNotification(job, event)
        .then((result) => {
          if (result.attempted || result.removed || result.failed) {
            pushEvent(result.failed ? "error" : "status", "Push notification processed", {
              action: "push-job-notification",
              chatId: job.chatId,
              jobId: job.id,
              result
            });
          }
        })
        .catch((error: unknown) => {
          pushEvent("error", "Push notification failed", {
            action: "push-job-notification-failed",
            chatId: job.chatId,
            jobId: job.id,
            error: describeError(error)
          });
        });
    }
  }
});
const events: BridgeEvent[] = [];
const imageContentTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"]
]);
type LiveWebSocket = WebSocket & { isAlive?: boolean };
type ChatStartMode = "project" | "chat";
type ChatStartTask = {
  id: string;
  mode: ChatStartMode;
  status: "pending" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  root?: string;
  folderName?: string;
  projectPath: string;
  projectName: string;
  message: string;
  chat?: ProjectChatStartResult["chat"];
  logPaths?: ProjectChatStartResult["logPaths"];
  error?: string;
};

const chatStartTasks = new Map<string, ChatStartTask>();
const maxChatStartTasks = 40;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDirCandidates = [
  path.resolve(process.cwd(), "dist"),
  path.resolve(__dirname, "..", "dist"),
  path.resolve(__dirname, "..", "..", "dist")
];
const staticDir =
  staticDirCandidates.find((candidate) => fs.existsSync(path.join(candidate, "index.html"))) ?? staticDirCandidates[0];

if (clientOrigin) {
  app.use(cors({ origin: clientOrigin }));
}

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "32mb" }));

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9_.-]/gi, "-").slice(0, 120) || "item";
}

function safeUploadName(name: unknown, index: number): string {
  const rawName = typeof name === "string" && name.trim() ? name.trim() : `file-${index + 1}`;
  const basename = path.win32.basename(path.posix.basename(rawName));
  const sanitized = basename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

  return sanitized || `file-${index + 1}`;
}

function sanitizedPath(rawPath: string): string {
  const url = new URL(rawPath, "http://local");

  for (const key of [...url.searchParams.keys()]) {
    if (/token|secret|password|key/i.test(key)) {
      url.searchParams.set(key, "[redacted]");
    }
  }

  return `${url.pathname}${url.search}`;
}

function requestContext(req: express.Request): Record<string, unknown> {
  return {
    method: req.method,
    path: sanitizedPath(req.originalUrl),
    ip: req.ip,
    forwardedFor: req.header("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: req.header("user-agent")?.slice(0, 240)
  };
}

function queryStringValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }

  return typeof value === "string" ? value : undefined;
}

function chatMessageViewModeFromQuery(value: unknown): ChatMessageViewMode {
  const mode = queryStringValue(value);

  return mode === "all" || mode === "final" || mode === "codex" ? mode : "codex";
}

function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack?.slice(0, 3000)
  };
}

function pruneChatStartTasks() {
  const tasks = [...chatStartTasks.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  for (const task of tasks.slice(maxChatStartTasks)) {
    if (task.status !== "pending") {
      chatStartTasks.delete(task.id);
    }
  }
}

function publicChatStartTask(task: ChatStartTask) {
  return {
    ok: true,
    accepted: task.status === "pending",
    pendingId: task.id,
    mode: task.mode,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    root: task.root,
    folderName: task.folderName,
    projectPath: task.projectPath,
    projectName: task.projectName,
    message: task.message,
    chat: task.chat,
    logPaths: task.logPaths,
    error: task.error
  };
}

function startChatInBackground(options: {
  mode: ChatStartMode;
  route: string;
  request: Record<string, unknown>;
  projectPath: string;
  projectName: string;
  prompt?: string;
  createDirectory?: boolean;
  root?: string;
  folderName?: string;
}) {
  const now = new Date().toISOString();
  const task: ChatStartTask = {
    id: randomUUID(),
    mode: options.mode,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    root: options.root,
    folderName: options.folderName,
    projectPath: options.projectPath,
    projectName: options.projectName,
    message: options.mode === "project" ? "Project creation accepted" : "Chat start accepted"
  };

  chatStartTasks.set(task.id, task);
  pruneChatStartTasks();

  pushEvent("status", task.message, {
    action: `${options.mode}-create-accepted`,
    route: options.route,
    request: options.request,
    pendingId: task.id,
    projectPath: task.projectPath,
    title: task.projectName
  });

  void (async () => {
    try {
      const result = await startProjectChat({
        cliPath: runner.cliPath,
        bypassSandbox: runner.bypassSandbox,
        skipGitRepoCheck: runner.skipGitRepoCheck,
        projectPath: options.projectPath,
        projectName: options.projectName,
        prompt: options.prompt,
        createDirectory: options.createDirectory,
        settings: getRunSettings()
      });

      task.status = "completed";
      task.updatedAt = new Date().toISOString();
      task.message = options.mode === "project" ? "New project folder and chat started" : "New chat started in project";
      task.projectPath = result.projectPath;
      task.chat = result.chat;
      task.logPaths = result.logPaths;
      pruneChatStartTasks();

      pushEvent("action", task.message, {
        action: `${options.mode}-create-completed`,
        route: options.route,
        request: options.request,
        pendingId: task.id,
        projectPath: result.projectPath,
        chatId: result.chat.id,
        chat: result.chat,
        title: task.projectName,
        logPaths: result.logPaths
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : options.mode === "project"
            ? "Could not create project"
            : "Could not start chat in project";

      task.status = "failed";
      task.updatedAt = new Date().toISOString();
      task.message = message;
      task.error = message;
      pruneChatStartTasks();

      pushEvent("error", message, {
        action: `${options.mode}-create-failed`,
        route: options.route,
        request: options.request,
        pendingId: task.id,
        projectPath: options.projectPath,
        error: describeError(error)
      });
    }
  })();

  return task;
}

function resolveLocalImagePath(rawPath: unknown): { ok: true; path: string; contentType: string } | { ok: false; message: string } {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return { ok: false, message: "Image path is required" };
  }

  let decoded = rawPath.trim();

  if (decoded.startsWith("file://")) {
    try {
      decoded = fileURLToPath(decoded);
    } catch {
      decoded = decoded.replace(/^file:\/+/i, "");
    }
  }

  if (/^\/[a-zA-Z]:\//.test(decoded)) {
    decoded = decoded.slice(1);
  }

  const resolved = path.resolve(decoded);
  const extension = path.extname(resolved).toLowerCase();
  const contentType = imageContentTypes.get(extension);

  if (!contentType) {
    return { ok: false, message: "Only local screenshot image files can be displayed" };
  }

  return { ok: true, path: resolved, contentType };
}

function uploadRootForProject(projectPath: string, chatId: string, createdAt: Date): string {
  const basePath = fs.existsSync(projectPath) ? projectPath : path.join(os.homedir(), "codex-remote-uploads");
  const timestamp = createdAt.toISOString().replace(/[:.]/g, "-");

  return path.join(basePath, ".codex-remote", "uploads", safeSegment(chatId), timestamp);
}

function uploadRootsForChat(projectPath: string, chatId: string): string[] {
  const roots = new Set<string>();

  if (fs.existsSync(projectPath)) {
    roots.add(path.join(projectPath, ".codex-remote", "uploads", safeSegment(chatId)));
  }

  roots.add(path.join(os.homedir(), "codex-remote-uploads", ".codex-remote", "uploads", safeSegment(chatId)));

  return [...roots];
}

async function listChatUploadedImages(chatId: string, projectPath: string): Promise<UploadedPromptFile[]> {
  const files: UploadedPromptFile[] = [];

  async function visit(dir: string, root: string) {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;

    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await visit(entryPath, root);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();

      if (!imageContentTypes.has(extension)) {
        continue;
      }

      try {
        const stat = await fsp.stat(entryPath);
        const relativePath = fs.existsSync(projectPath)
          ? path.relative(projectPath, entryPath)
          : path.relative(root, entryPath);

        files.push({
          name: entry.name,
          originalName: entry.name.replace(/^\d+-/, ""),
          type: imageContentTypes.get(extension) ?? "image/*",
          size: stat.size,
          path: entryPath,
          relativePath,
          uploadedAt: new Date(stat.mtimeMs).toISOString()
        });
      } catch {
        continue;
      }
    }
  }

  for (const root of uploadRootsForChat(projectPath, chatId)) {
    await visit(root, root);
  }

  return files.sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt));
}

async function listShortcutInstructionFiles(): Promise<ShortcutInstructionFile[]> {
  const root = shortcutInstructionsRoot;
  const files: ShortcutInstructionFile[] = [];
  let totalBytes = 0;

  async function visit(dir: string) {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;

    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.resolve(dir, entry.name);
      const relativePath = path.relative(root, entryPath);

      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      try {
        const stat = await fsp.stat(entryPath);
        const bytesToRead = Math.min(stat.size, maxShortcutInstructionBytes);

        if (totalBytes >= maxShortcutInstructionTotalBytes) {
          continue;
        }

        const remainingBytes = Math.max(0, maxShortcutInstructionTotalBytes - totalBytes);
        const content = await fsp.readFile(entryPath, "utf8");
        const truncatedByFile = stat.size > maxShortcutInstructionBytes;
        const truncatedByTotal = stat.size > remainingBytes;
        const visibleContent = content.slice(0, Math.min(bytesToRead, remainingBytes));

        totalBytes += Buffer.byteLength(visibleContent, "utf8");
        files.push({
          name: entry.name,
          path: entryPath,
          relativePath,
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
          content:
            truncatedByFile || truncatedByTotal
              ? `${visibleContent}\n\n[truncated: file is larger than the remote preview limit]`
              : visibleContent
        });
      } catch {
        continue;
      }
    }
  }

  await visit(root);

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function pushEvent(type: BridgeEvent["type"], message: string, detail?: Record<string, unknown>) {
  const event: BridgeEvent = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    type,
    message,
    detail
  };

  events.unshift(event);
  events.splice(80);

  void appendAuditEvent(event).catch((error: unknown) => {
    console.error("Could not write audit event", error);
  });

  const payload = JSON.stringify({ kind: "event", event, state: getState() });
  for (const client of wss.clients) {
    sendSocketPayload(client, payload);
  }
}

function pushState() {
  const payload = JSON.stringify({ kind: "state", state: getState() });

  for (const client of wss.clients) {
    sendSocketPayload(client, payload);
  }
}

function maintainSockets() {
  for (const client of wss.clients) {
    const socket = client as LiveWebSocket;

    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }

    socket.isAlive = false;

    try {
      socket.ping();
    } catch {
      socket.terminate();
    }
  }

  pushState();
}

function sendSocketPayload(client: WebSocket, payload: string) {
  if (client.readyState !== client.OPEN) {
    return;
  }

  try {
    client.send(payload);
  } catch {
    client.terminate();
  }
}

function getState(): BridgeState {
  return {
    bridge: {
      mode: bridge.mode,
      targetTitle: bridge.title,
      controlEnabled,
      promptDelivery,
      tokenConfigured: controlToken.length > 0,
      tokenRequired,
      platform: process.platform
    },
    server: {
      uptimeSeconds: Math.round(process.uptime()),
      port,
      clients: wss.clients.size
    },
    runner: {
      mode: runner.mode,
      cliPath: runner.cliPath,
      bypassSandbox: runner.bypassSandbox,
      skipGitRepoCheck: runner.skipGitRepoCheck,
      settings: getRunSettings(),
      settingsOptions: getRunSettingsOptions(),
      activeJobs: runner.activeJobs,
      queuedJobs: runner.queuedJobs,
      recentJobs: runner.recentJobs
    },
    recentEvents: events
  };
}

process.on("unhandledRejection", (reason) => {
  pushEvent("error", "Unhandled promise rejection", {
    action: "process-unhandled-rejection",
    error: describeError(reason)
  });
});

process.on("uncaughtException", (error) => {
  pushEvent("error", "Uncaught process exception", {
    action: "process-uncaught-exception",
    error: describeError(error)
  });
  setTimeout(() => process.exit(1), 250);
});

function hasValidToken(value: unknown): boolean {
  return typeof value === "string" && controlToken.length > 0 && value === controlToken;
}

function tokenFromRequest(req: express.Request) {
  return req.header("x-control-token") ?? (typeof req.query.token === "string" ? req.query.token : undefined);
}

function requireControlAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!tokenRequired) {
    next();
    return;
  }

  if (!controlToken) {
    pushEvent("error", "Control request rejected because CONTROL_TOKEN is empty", {
      action: "auth-rejected",
      reason: "missing-server-token",
      request: requestContext(req)
    });
    res.status(403).json({
      ok: false,
      message: "Set CONTROL_TOKEN before enabling real window control"
    });
    return;
  }

  if (!hasValidToken(tokenFromRequest(req))) {
    pushEvent("error", "Control request rejected because the token was missing or invalid", {
      action: "auth-rejected",
      reason: "invalid-token",
      request: requestContext(req)
    });
    res.status(401).json({
      ok: false,
      message: "Missing or invalid control token"
    });
    return;
  }

  next();
}

app.get("/api/live", (_req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.round(process.uptime()),
    clients: wss.clients.size
  });
});

app.get("/api/health", async (_req, res) => {
  const checks = {
    chatIndex: {
      ok: false,
      totalChats: 0,
      error: undefined as string | undefined
    },
    auditLog: {
      ok: false,
      error: undefined as string | undefined
    }
  };

  try {
    const chats = await listChats();

    checks.chatIndex.ok = true;
    checks.chatIndex.totalChats = chats.totalChats;
  } catch (error) {
    checks.chatIndex.error = error instanceof Error ? error.message : String(error);
  }

  try {
    await readAuditEvents(1);
    checks.auditLog.ok = true;
  } catch (error) {
    checks.auditLog.error = error instanceof Error ? error.message : String(error);
  }

  const ok = checks.chatIndex.ok && checks.auditLog.ok;

  res.status(ok ? 200 : 503).json({
    ok,
    uptimeSeconds: Math.round(process.uptime()),
    clients: wss.clients.size,
    checks
  });
});

app.get("/api/auth/status", (_req, res) => {
  res.json({
    ok: true,
    tokenRequired,
    tokenConfigured: controlToken.length > 0
  });
});

app.post("/api/auth/verify", requireControlAuth, (_req, res) => {
  res.json({ ok: true, state: getState() });
});

app.get("/api/state", requireControlAuth, (_req, res) => {
  res.json(getState());
});

app.patch("/api/run-settings", requireControlAuth, (req, res) => {
  const patch: Partial<CodexRunSettings> = {};

  if (typeof req.body?.model === "string") {
    patch.model = req.body.model;
  }

  if (typeof req.body?.reasoningEffort === "string") {
    patch.reasoningEffort = req.body.reasoningEffort as CodexRunSettings["reasoningEffort"];
  }

  if (typeof req.body?.speed === "string") {
    patch.speed = req.body.speed as CodexRunSettings["speed"];
  }

  const settings = updateRunSettings(patch);

  pushEvent("status", "Codex run settings updated", {
    action: "codex-run-settings-updated",
    settings
  });

  res.json({
    ok: true,
    settings,
    options: getRunSettingsOptions()
  });
});

app.get("/api/shortcut-instructions", requireControlAuth, async (req, res) => {
  try {
    res.json({
      ok: true,
      root: shortcutInstructionsRoot,
      files: await listShortcutInstructionFiles(),
      loadedAt: new Date().toISOString()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load shortcut instructions";

    pushEvent("error", message, {
      action: "shortcut-instructions",
      request: requestContext(req),
      root: shortcutInstructionsRoot,
      error: describeError(error)
    });
    res.status(500).json({ ok: false, message });
  }
});

app.get("/api/local-image", requireControlAuth, async (req, res) => {
  const resolved = resolveLocalImagePath(req.query.path);

  if (!resolved.ok) {
    res.status(400).json({ ok: false, message: resolved.message });
    return;
  }

  try {
    const stat = await fsp.stat(resolved.path);

    if (!stat.isFile()) {
      res.status(404).json({ ok: false, message: "Screenshot not found" });
      return;
    }

    res.setHeader("Cache-Control", "private, max-age=300");
    res.type(resolved.contentType);
    res.sendFile(resolved.path, { dotfiles: "allow" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read screenshot";

    pushEvent("error", "Local screenshot could not be served", {
      action: "local-image",
      request: requestContext(req),
      path: resolved.path,
      error: describeError(error)
    });
    res.status(404).json({ ok: false, message });
  }
});

app.get("/api/debug/events", requireControlAuth, async (req, res) => {
  const limit = Number.parseInt(String(req.query.limit ?? "80"), 10);

  try {
    res.json({
      ok: true,
      logPath: getAuditLogPath(),
      events: await readAuditEvents(limit)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read audit events";
    pushEvent("error", message, {
      action: "debug-events",
      request: requestContext(req),
      error: describeError(error)
    });
    res.status(500).json({ ok: false, message });
  }
});

app.get("/api/notifications/public-key", requireControlAuth, async (req, res) => {
  try {
    res.json({
      ok: true,
      publicKey: await getPushPublicKey(),
      subscriptions: await countPushSubscriptions()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare notifications";
    pushEvent("error", message, {
      action: "notifications-public-key",
      request: requestContext(req),
      error: describeError(error)
    });
    res.status(500).json({ ok: false, message });
  }
});

app.post("/api/notifications/subscribe", requireControlAuth, async (req, res) => {
  try {
    const stored = await savePushSubscription(req.body?.subscription, req.header("user-agent")?.slice(0, 240));

    pushEvent("status", "Push notifications enabled for a device", {
      action: "notifications-subscribe",
      request: requestContext(req),
      subscriptionId: stored.id
    });

    res.json({
      ok: true,
      subscriptionId: stored.id
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save notification subscription";
    pushEvent("error", message, {
      action: "notifications-subscribe-failed",
      request: requestContext(req),
      error: describeError(error)
    });
    res.status(500).json({ ok: false, message });
  }
});

app.delete("/api/notifications/subscribe", requireControlAuth, async (req, res) => {
  try {
    res.json({
      ok: true,
      removed: await removePushSubscription(req.body?.endpoint)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not remove notification subscription";
    pushEvent("error", message, {
      action: "notifications-unsubscribe-failed",
      request: requestContext(req),
      error: describeError(error)
    });
    res.status(500).json({ ok: false, message });
  }
});

app.post("/api/notifications/test", requireControlAuth, async (req, res) => {
  try {
    const result = await sendTestPushNotification();

    pushEvent(result.failed ? "error" : "status", "Test push notification processed", {
      action: "notifications-test",
      request: requestContext(req),
      result
    });

    res.json({
      ok: result.failed === 0,
      result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send test notification";
    pushEvent("error", message, {
      action: "notifications-test-failed",
      request: requestContext(req),
      error: describeError(error)
    });
    res.status(500).json({ ok: false, message });
  }
});

app.get("/api/jobs", requireControlAuth, (_req, res) => {
  res.json({
    ok: true,
    mode: runner.mode,
    activeJobs: runner.activeJobs,
    queuedJobs: runner.queuedJobs,
    jobs: runner.recentJobs
  });
});

app.get("/api/chats/:id/jobs", requireControlAuth, async (req, res) => {
  const chatId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    res.json({
      ok: true,
      chatId,
      jobs: await runner.reconcileChatJobs(chatId)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load command queue";
    pushEvent("error", message, {
      action: "chat-jobs",
      chatId,
      request: requestContext(req),
      error: describeError(error)
    });
    res.status(500).json({ ok: false, message });
  }
});

app.get("/api/chats", requireControlAuth, async (req, res) => {
  try {
    res.json(await listChats());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Codex chats";

    pushEvent("error", message, {
      action: "list-chats",
      request: requestContext(req),
      error: describeError(error)
    });
    res.status(500).json({ ok: false, message });
  }
});

app.get("/api/chat-starts/:pendingId", requireControlAuth, (req, res) => {
  const pendingId = String(req.params.pendingId ?? "");
  const task = chatStartTasks.get(pendingId);

  if (!task) {
    res.status(404).json({ ok: false, message: "Chat start request was not found" });
    return;
  }

  res.json(publicChatStartTask(task));
});

app.post("/api/chats", requireControlAuth, async (req, res) => {
  const projectPath = typeof req.body?.projectPath === "string" ? path.resolve(req.body.projectPath) : "";
  const title = typeof req.body?.title === "string" ? req.body.title.replace(/\s+/g, " ").trim() : "";
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : undefined;

  if (!projectPath) {
    res.status(400).json({ ok: false, message: "Project path is required" });
    return;
  }

  try {
    const stat = await fsp.stat(projectPath);

    if (!stat.isDirectory()) {
      res.status(400).json({ ok: false, message: "Project path is not a folder" });
      return;
    }

    const projectTitle = title || path.basename(projectPath) || "New chat";
    const task = startChatInBackground({
      mode: "chat",
      route: "POST /api/chats",
      request: requestContext(req),
      projectPath,
      projectName: projectTitle,
      prompt
    });

    res.status(202).json({
      ok: true,
      accepted: true,
      pendingId: task.id,
      status: task.status,
      message: "Chat start accepted on target laptop",
      projectPath: task.projectPath,
      projectName: task.projectName,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start chat in project";
    const missing = error && typeof error === "object" && "code" in error && error.code === "ENOENT";

    pushEvent("error", message, {
      action: "chat-create-rejected",
      route: "POST /api/chats",
      request: requestContext(req),
      projectPath,
      error: describeError(error)
    });
    res.status(missing ? 404 : 500).json({ ok: false, message: missing ? "Project folder was not found" : message });
  }
});

app.post("/api/projects", requireControlAuth, async (req, res) => {
  const rawName = typeof req.body?.name === "string" ? req.body.name : "";
  const title = rawName.replace(/\s+/g, " ").trim();
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : undefined;

  try {
    const { folderName, projectPath, root } = resolveNewProjectPath(rawName);

    if (fs.existsSync(projectPath)) {
      res.status(409).json({ ok: false, message: "Project folder already exists", root, projectPath, folderName });
      return;
    }

    const task = startChatInBackground({
      mode: "project",
      route: "POST /api/projects",
      request: requestContext(req),
      projectPath,
      projectName: title || folderName,
      prompt,
      createDirectory: true,
      root,
      folderName
    });

    res.status(202).json({
      ok: true,
      accepted: true,
      pendingId: task.id,
      status: task.status,
      message: "Project creation accepted on target laptop",
      root,
      folderName,
      projectPath: task.projectPath,
      projectName: task.projectName,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create project";
    const exists = error && typeof error === "object" && "code" in error && error.code === "EEXIST";

    pushEvent("error", message, {
      action: "project-create-rejected",
      route: "POST /api/projects",
      request: requestContext(req),
      root: getDefaultProjectsRoot(),
      error: describeError(error)
    });
    res.status(exists ? 409 : 400).json({ ok: false, message: exists ? "Project folder already exists" : message });
  }
});

app.get("/api/chats/:id", requireControlAuth, async (req, res) => {
  const chatId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const turns = Number(Array.isArray(req.query.turns) ? req.query.turns[0] : req.query.turns);
  const messageMode = chatMessageViewModeFromQuery(req.query.mode);

  try {
    const chat = await getChat(chatId, {
      detailTurns: Number.isFinite(turns) ? turns : undefined,
      messageMode
    });

    if (!chat) {
      res.status(404).json({ ok: false, message: "Chat not found" });
      return;
    }

    res.json(chat);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Codex chat";

    pushEvent("error", message, {
      action: "get-chat",
      chatId,
      request: requestContext(req),
      error: describeError(error)
    });
    res.status(500).json({ ok: false, message });
  }
});

app.patch("/api/chats/:id", requireControlAuth, async (req, res) => {
  const chatId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const title = typeof req.body?.title === "string" ? req.body.title : "";

  try {
    const result = await renameChatSession(chatId, title);

    pushEvent("action", "Codex chat renamed", {
      action: "chat-rename",
      route: "PATCH /api/chats/:id",
      request: requestContext(req),
      chatId,
      title: result.chat.title
    });

    res.json({
      ok: true,
      message: "Chat renamed",
      chat: result.chat
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not rename chat";

    pushEvent("error", message, {
      action: "chat-rename-failed",
      route: "PATCH /api/chats/:id",
      request: requestContext(req),
      chatId,
      error: describeError(error)
    });
    res.status(message === "Chat was not found" ? 404 : 400).json({ ok: false, message });
  }
});

app.post("/api/chats/:id/fork", requireControlAuth, async (req, res) => {
  const chatId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const name = typeof req.body?.name === "string" ? req.body.name : "";

  try {
    const result = await forkChatSession(chatId, name);

    pushEvent("action", "Codex chat forked", {
      action: "chat-fork",
      route: "POST /api/chats/:id/fork",
      request: requestContext(req),
      sourceChatId: chatId,
      chatId: result.chat.id,
      title: result.chat.title,
      sessionPath: result.sessionPath
    });

    res.status(201).json({
      ok: true,
      message: "Chat forked",
      sourceChatId: chatId,
      chat: result.chat,
      sessionPath: result.sessionPath
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fork chat";

    pushEvent("error", message, {
      action: "chat-fork-failed",
      route: "POST /api/chats/:id/fork",
      request: requestContext(req),
      sourceChatId: chatId,
      error: describeError(error)
    });
    res.status(message === "Source chat session file was not found" ? 404 : 400).json({ ok: false, message });
  }
});

app.get("/api/chats/:id/uploads", requireControlAuth, async (req, res) => {
  const chatId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    const chat = await getChat(chatId);

    if (!chat) {
      res.status(404).json({ ok: false, message: "Chat not found" });
      return;
    }

    const files = await listChatUploadedImages(chat.id, chat.projectPath);

    res.json({
      ok: true,
      chatId,
      files
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load uploaded screenshots";

    pushEvent("error", message, {
      action: "chat-uploads-failed",
      request: requestContext(req),
      chatId,
      error: describeError(error)
    });
    res.status(500).json({ ok: false, message });
  }
});

app.post("/api/chats/:id/files", requireControlAuth, async (req, res) => {
  const chatId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const files = Array.isArray(req.body?.files) ? req.body.files : [];

  if (!files.length) {
    res.status(400).json({ ok: false, message: "No files were provided" });
    return;
  }

  if (files.length > maxUploadFiles) {
    res.status(400).json({ ok: false, message: `Upload at most ${maxUploadFiles} files at a time` });
    return;
  }

  try {
    const chat = await getChat(chatId);

    if (!chat) {
      res.status(404).json({ ok: false, message: "Chat not found" });
      return;
    }

    const uploadedAt = new Date();
    const uploadRoot = uploadRootForProject(chat.projectPath, chatId, uploadedAt);
    const savedFiles: UploadedPromptFile[] = [];
    let totalBytes = 0;

    await fsp.mkdir(uploadRoot, { recursive: true });

    for (const [index, file] of files.entries()) {
      const input = file as { name?: unknown; type?: unknown; data?: unknown; size?: unknown };
      const base64 = typeof input.data === "string" ? input.data.replace(/^data:[^,]*,/, "") : "";

      if (!base64) {
        res.status(400).json({ ok: false, message: "Each file must include base64 data" });
        return;
      }

      let bytes: Buffer;

      try {
        bytes = Buffer.from(base64, "base64");
      } catch {
        res.status(400).json({ ok: false, message: "One of the files could not be decoded" });
        return;
      }

      totalBytes += bytes.byteLength;

      if (!bytes.byteLength) {
        res.status(400).json({ ok: false, message: "Empty files are not supported yet" });
        return;
      }

      if (bytes.byteLength > maxUploadBytes) {
        res.status(400).json({ ok: false, message: `Each file must be ${Math.round(maxUploadBytes / 1024 / 1024)} MB or smaller` });
        return;
      }

      if (totalBytes > maxUploadTotalBytes) {
        res.status(400).json({ ok: false, message: `Total upload size must be ${Math.round(maxUploadTotalBytes / 1024 / 1024)} MB or smaller` });
        return;
      }

      const originalName = safeUploadName(input.name, index);
      const storedName = `${String(index + 1).padStart(2, "0")}-${originalName}`;
      const absolutePath = path.join(uploadRoot, storedName);
      const relativePath = fs.existsSync(chat.projectPath)
        ? path.relative(chat.projectPath, absolutePath)
        : path.relative(path.join(os.homedir(), "codex-remote-uploads"), absolutePath);

      await fsp.writeFile(absolutePath, bytes, { flag: "wx" });

      savedFiles.push({
        name: storedName,
        originalName,
        type: typeof input.type === "string" ? input.type.slice(0, 120) : "application/octet-stream",
        size: bytes.byteLength,
        path: absolutePath,
        relativePath,
        uploadedAt: uploadedAt.toISOString()
      });
    }

    pushEvent("action", `${savedFiles.length} file${savedFiles.length === 1 ? "" : "s"} uploaded for chat`, {
      action: "chat-files-uploaded",
      chatId,
      route: "POST /api/chats/:id/files",
      request: requestContext(req),
      files: savedFiles.map((file) => ({
        name: file.originalName,
        size: file.size,
        type: file.type,
        path: file.path
      }))
    });

    res.json({
      ok: true,
      files: savedFiles
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not upload files";

    pushEvent("error", message, {
      action: "chat-files-upload-failed",
      chatId,
      request: requestContext(req),
      error: describeError(error)
    });
    res.status(500).json({ ok: false, message });
  }
});

app.post("/api/chats/:id/prompt", requireControlAuth, async (req, res) => {
  const chatId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const text = typeof req.body?.text === "string" ? req.body.text : "";

  if (!text.trim()) {
    res.status(400).json({ ok: false, message: "Text is empty" });
    return;
  }

  if (text.trimEnd().length > maxPromptLength) {
    res.status(400).json({ ok: false, message: `Text is longer than the ${maxPromptLength} character safety limit` });
    return;
  }

  try {
    const chat = await getChat(chatId);

    if (!chat) {
      res.status(404).json({ ok: false, message: "Chat not found" });
      return;
    }

    const promptSummary = summarizePrompt(text);

    const job = runner.enqueue({
      chatId,
      projectPath: chat.projectPath,
      text: text.trimEnd(),
      promptPreview: String(promptSummary.promptPreview ?? ""),
      promptHash: String(promptSummary.promptHash ?? ""),
      textLength: Number(promptSummary.textLength ?? text.trimEnd().length),
      settings: getRunSettings()
    });

    pushEvent("action", "Prompt queued for exact Codex session on target laptop", {
      action: "chat-prompt-queued",
      chatId,
      route: "POST /api/chats/:id/prompt",
      request: requestContext(req),
      ...promptSummary,
      job
    });

    res.status(202).json({
      ok: true,
      message: "Prompt accepted on target laptop; only earlier commands in the same chat can delay it",
      job
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not queue prompt";
    pushEvent("error", message, {
      action: "chat-prompt-queue-failed",
      chatId,
      request: requestContext(req),
      error: describeError(error)
    });
    res.status(500).json({ ok: false, message });
  }
});

app.post("/api/chats/:id/steer", requireControlAuth, async (req, res) => {
  const chatId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const text = typeof req.body?.text === "string" ? req.body.text : "";

  if (!text.trim()) {
    res.status(400).json({ ok: false, message: "Text is empty" });
    return;
  }

  if (text.trimEnd().length > maxPromptLength) {
    res.status(400).json({ ok: false, message: `Text is longer than the ${maxPromptLength} character safety limit` });
    return;
  }

  try {
    const chat = await getChat(chatId);

    if (!chat) {
      res.status(404).json({ ok: false, message: "Chat not found" });
      return;
    }

    const promptSummary = summarizePrompt(text);
    const job = runner.steer({
      chatId,
      projectPath: chat.projectPath,
      text: text.trimEnd(),
      promptPreview: String(promptSummary.promptPreview ?? ""),
      promptHash: String(promptSummary.promptHash ?? ""),
      textLength: Number(promptSummary.textLength ?? text.trimEnd().length),
      settings: getRunSettings()
    });

    pushEvent("action", "Steering prompt sent to Codex session on target laptop", {
      action: "chat-prompt-steer",
      chatId,
      route: "POST /api/chats/:id/steer",
      request: requestContext(req),
      ...promptSummary,
      job
    });

    res.status(202).json({
      ok: true,
      message: "Steering prompt sent to the running Codex chat",
      job
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send steering prompt";
    pushEvent("error", message, {
      action: "chat-prompt-steer-failed",
      chatId,
      request: requestContext(req),
      error: describeError(error)
    });
    res.status(500).json({ ok: false, message });
  }
});

app.post("/api/actions/focus", requireControlAuth, async (req, res) => {
  const result = await bridge.focus();
  pushEvent(result.ok ? "action" : "error", result.message, {
    action: "focus",
    simulated: result.simulated,
    request: requestContext(req),
    diagnostics: result.diagnostics
  });
  res.status(result.ok ? 200 : 400).json(result);
});

app.post("/api/actions/send-text", requireControlAuth, async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  const submit = Boolean(req.body?.submit);
  const result = await bridge.sendText(text, submit);

  pushEvent(result.ok ? "action" : "error", result.message, {
    action: submit ? "send-submit" : "send-text",
    route: "POST /api/actions/send-text",
    submit,
    simulated: result.simulated,
    request: requestContext(req),
    ...summarizePrompt(text),
    diagnostics: result.diagnostics
  });
  res.status(result.ok ? 200 : 400).json(result);
});

app.post("/api/actions/hotkey", requireControlAuth, async (req, res) => {
  const key = typeof req.body?.key === "string" ? req.body.key : "";
  const result = await bridge.hotkey(key);

  pushEvent(result.ok ? "action" : "error", result.message, {
    action: "hotkey",
    key,
    simulated: result.simulated,
    request: requestContext(req),
    diagnostics: result.diagnostics
  });
  res.status(result.ok ? 200 : 400).json(result);
});

app.post("/api/events/status", requireControlAuth, (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.slice(0, 200) : "Manual status";
  pushEvent("status", message, { action: "manual-status", request: requestContext(req) });
  res.json({ ok: true });
});

app.use("/api", (req, res) => {
  res.status(404).json({
    ok: false,
    message: `API route not found: ${sanitizedPath(req.originalUrl)}`
  });
});

app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : 500;
  const message = error instanceof Error ? error.message : "Unhandled request error";

  pushEvent("error", message, {
    action: "request-error",
    request: requestContext(req),
    error: describeError(error)
  });

  res.status(statusCode).json({ ok: false, message });
});

if (fs.existsSync(path.join(staticDir, "index.html"))) {
  app.use(express.static(staticDir));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

wss.on("connection", (socket: WebSocket) => {
  const liveSocket = socket as LiveWebSocket;

  liveSocket.isAlive = true;
  liveSocket.on("pong", () => {
    liveSocket.isAlive = true;
  });
  socket.on("error", () => {
    socket.terminate();
  });

  sendSocketPayload(socket, JSON.stringify({ kind: "state", state: getState() }));
});

const socketHeartbeat = setInterval(maintainSockets, socketHeartbeatMs);
server.on("close", () => clearInterval(socketHeartbeat));

server.on("upgrade", (request, socket, head) => {
  const host = request.headers.host ?? `localhost:${port}`;
  const url = new URL(request.url ?? "/", `http://${host}`);

  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  if (controlToken && !hasValidToken(url.searchParams.get("token"))) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

server.listen(port, "0.0.0.0", () => {
  pushEvent("status", `Bridge listening on port ${port}`, {
    mode: bridge.mode,
    targetTitle
  });
  console.log(`Codex window remote bridge listening on http://localhost:${port}`);
});
