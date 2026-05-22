import "dotenv/config";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { appendAuditEvent, getAuditLogPath, readAuditEvents, summarizePrompt } from "./auditLog.js";
import { CodexBridge } from "./codexBridge.js";
import { getChat, listChats } from "./codexSessions.js";
import type { BridgeEvent, BridgeState } from "./types.js";

const port = Number(process.env.PORT ?? 8787);
const clientOrigin = process.env.CLIENT_ORIGIN;
const controlToken = process.env.CONTROL_TOKEN?.trim() ?? "";
const controlEnabled = process.env.ENABLE_WINDOW_CONTROL === "true";
const targetTitle = process.env.CODEX_WINDOW_TITLE?.trim() || "Codex";
const tokenRequired = controlEnabled || controlToken.length > 0;

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });
const bridge = new CodexBridge({ enabled: controlEnabled, targetTitle });
const events: BridgeEvent[] = [];

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

app.use(express.json({ limit: "64kb" }));

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
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}

function getState(): BridgeState {
  return {
    bridge: {
      mode: bridge.mode,
      targetTitle: bridge.title,
      controlEnabled,
      tokenConfigured: controlToken.length > 0,
      tokenRequired,
      platform: process.platform
    },
    server: {
      uptimeSeconds: Math.round(process.uptime()),
      port,
      clients: wss.clients.size
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

  if (!hasValidToken(req.header("x-control-token"))) {
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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) });
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

app.get("/api/chats/:id", requireControlAuth, async (req, res) => {
  const chatId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    const chat = await getChat(chatId);

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

app.post("/api/chats/:id/prompt", requireControlAuth, async (req, res) => {
  const chatId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  const result = await bridge.sendText(text, true);

  pushEvent(result.ok ? "action" : "error", result.message, {
    action: "chat-prompt",
    chatId,
    route: "POST /api/chats/:id/prompt",
    submit: true,
    simulated: result.simulated,
    request: requestContext(req),
    ...summarizePrompt(text),
    diagnostics: result.diagnostics
  });

  res.status(result.ok ? 200 : 400).json(result);
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
  socket.send(JSON.stringify({ kind: "state", state: getState() }));
});

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
