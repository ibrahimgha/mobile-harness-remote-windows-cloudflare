import "dotenv/config";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
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

function hasValidToken(value: unknown): boolean {
  return typeof value === "string" && controlToken.length > 0 && value === controlToken;
}

function requireControlAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!tokenRequired) {
    next();
    return;
  }

  if (!controlToken) {
    res.status(403).json({
      ok: false,
      message: "Set CONTROL_TOKEN before enabling real window control"
    });
    return;
  }

  if (!hasValidToken(req.header("x-control-token"))) {
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

app.get("/api/chats", requireControlAuth, async (_req, res) => {
  try {
    res.json(await listChats());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Codex chats";

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
    simulated: result.simulated,
    textLength: text.trimEnd().length
  });

  res.status(result.ok ? 200 : 400).json(result);
});

app.post("/api/actions/focus", requireControlAuth, async (_req, res) => {
  const result = await bridge.focus();
  pushEvent(result.ok ? "action" : "error", result.message, { action: "focus", simulated: result.simulated });
  res.status(result.ok ? 200 : 400).json(result);
});

app.post("/api/actions/send-text", requireControlAuth, async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  const submit = Boolean(req.body?.submit);
  const result = await bridge.sendText(text, submit);

  pushEvent(result.ok ? "action" : "error", result.message, {
    action: submit ? "send-submit" : "send-text",
    simulated: result.simulated,
    textLength: text.trimEnd().length
  });
  res.status(result.ok ? 200 : 400).json(result);
});

app.post("/api/actions/hotkey", requireControlAuth, async (req, res) => {
  const key = typeof req.body?.key === "string" ? req.body.key : "";
  const result = await bridge.hotkey(key);

  pushEvent(result.ok ? "action" : "error", result.message, { action: "hotkey", key, simulated: result.simulated });
  res.status(result.ok ? 200 : 400).json(result);
});

app.post("/api/events/status", requireControlAuth, (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.slice(0, 200) : "Manual status";
  pushEvent("status", message);
  res.json({ ok: true });
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
