import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Command,
  CornerDownLeft,
  KeyRound,
  Loader2,
  MonitorDot,
  Play,
  PlugZap,
  Radio,
  RefreshCw,
  Send,
  Shield,
  SquareTerminal,
  Wifi,
  WifiOff
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type BridgeEvent = {
  id: string;
  type: "action" | "error" | "status";
  createdAt: string;
  message: string;
  detail?: Record<string, unknown>;
};

type BridgeState = {
  bridge: {
    mode: "simulation" | "window-control";
    targetTitle: string;
    controlEnabled: boolean;
    tokenConfigured: boolean;
    tokenRequired: boolean;
    platform: string;
  };
  server: {
    uptimeSeconds: number;
    port: number;
    clients: number;
  };
  recentEvents: BridgeEvent[];
};

type ApiResult = {
  ok: boolean;
  simulated: boolean;
  message: string;
};

const quickPrompts = [
  "Summarize the current workspace state.",
  "Run the relevant checks and report blockers.",
  "Continue the current implementation task."
];

const hotkeys = [
  { key: "enter", label: "Enter", icon: CornerDownLeft },
  { key: "escape", label: "Esc", icon: Command },
  { key: "ctrl-c", label: "Ctrl C", icon: Command },
  { key: "ctrl-l", label: "Ctrl L", icon: Command }
];

function formatUptime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 1) {
    return `${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return hours > 0 ? `${hours}h ${remainingMinutes}m` : `${minutes}m ${seconds}s`;
}

function getEventIcon(type: BridgeEvent["type"]) {
  if (type === "error") {
    return AlertTriangle;
  }

  if (type === "action") {
    return CheckCircle2;
  }

  return Activity;
}

export function App() {
  const [state, setState] = useState<BridgeState | null>(null);
  const [connected, setConnected] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem("control-token") ?? "");
  const [draft, setDraft] = useState("");
  const [statusMessage, setStatusMessage] = useState("Connecting");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const tokenRequired = state?.bridge.tokenRequired ?? false;
  const canControl = !tokenRequired || token.length > 0;

  useEffect(() => {
    localStorage.setItem("control-token", token);
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      try {
        const response = await fetch("/api/state");
        const payload = (await response.json()) as BridgeState;

        if (!cancelled) {
          setState(payload);
          setStatusMessage("Ready");
        }
      } catch {
        if (!cancelled) {
          setStatusMessage("Bridge unavailable");
        }
      }
    }

    void loadState();
    const interval = window.setInterval(loadState, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const encodedToken = token ? `?token=${encodeURIComponent(token)}` : "";
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws${encodedToken}`);

    socketRef.current = socket;
    socket.addEventListener("open", () => {
      setConnected(true);
      setStatusMessage("Live");
    });
    socket.addEventListener("close", () => {
      setConnected(false);
      setStatusMessage("Socket closed");
    });
    socket.addEventListener("error", () => {
      setConnected(false);
      setStatusMessage("Socket error");
    });
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data as string) as { kind: string; state?: BridgeState };

      if (payload.state) {
        setState(payload.state);
      }
    });

    return () => {
      socket.close();
    };
  }, [token]);

  const events = useMemo(() => state?.recentEvents ?? [], [state]);
  const modeLabel = state?.bridge.mode === "window-control" ? "Window control" : "Simulation";

  async function callAction<T extends object>(action: string, body?: T) {
    setBusyAction(action);

    try {
      const response = await fetch(`/api/actions/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-control-token": token } : {})
        },
        body: body ? JSON.stringify(body) : "{}"
      });
      const payload = (await response.json()) as ApiResult;

      setStatusMessage(payload.message);

      if (!response.ok) {
        throw new Error(payload.message);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <MonitorDot size={22} />
          </span>
          <div>
            <h1>Codex Window Remote</h1>
            <p>{state?.bridge.targetTitle ?? "Codex"} on this laptop</p>
          </div>
        </div>

        <div className="topbar-status" aria-live="polite">
          <span className={`status-pill ${connected ? "is-live" : "is-offline"}`}>
            {connected ? <Wifi size={16} /> : <WifiOff size={16} />}
            {statusMessage}
          </span>
          <span className={`status-pill ${state?.bridge.mode === "window-control" ? "is-danger" : "is-muted"}`}>
            <Shield size={16} />
            {modeLabel}
          </span>
        </div>
      </header>

      <section className="workspace-grid">
        <section className="codex-surface" aria-label="Codex window representation">
          <div className="surface-toolbar">
            <div>
              <span className="eyebrow">Live surface</span>
              <h2>Remote session</h2>
            </div>
            <div className="metric-row">
              <span>
                <Radio size={15} />
                {state?.server.clients ?? 0} clients
              </span>
              <span>
                <PlugZap size={15} />
                {formatUptime(state?.server.uptimeSeconds ?? 0)}
              </span>
            </div>
          </div>

          <div className="terminal-pane">
            <div className="terminal-title">
              <SquareTerminal size={16} />
              <span>activity</span>
            </div>
            <div className="event-stream">
              {events.length === 0 ? (
                <div className="empty-state">
                  <Activity size={26} />
                  <span>No bridge events yet</span>
                </div>
              ) : (
                events.map((event) => {
                  const EventIcon = getEventIcon(event.type);

                  return (
                    <article key={event.id} className={`event-item event-${event.type}`}>
                      <EventIcon size={16} />
                      <div>
                        <p>{event.message}</p>
                        <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <aside className="control-panel" aria-label="Controls">
          <div className="panel-section">
            <div className="section-heading">
              <KeyRound size={17} />
              <h2>Access</h2>
            </div>
            <label className="field-label" htmlFor="token">
              Control token
            </label>
            <input
              id="token"
              className="text-input"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={tokenRequired ? "Required" : "Optional"}
              autoComplete="off"
            />
            <div className="state-grid">
              <span>{state?.bridge.platform ?? "platform"}</span>
              <span>{state?.bridge.tokenConfigured ? "token set" : "no token"}</span>
            </div>
          </div>

          <div className="panel-section">
            <div className="section-heading">
              <Send size={17} />
              <h2>Prompt</h2>
            </div>
            <textarea
              className="prompt-box"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Type text for the Codex window"
              spellCheck={false}
            />
            <div className="quick-prompts" aria-label="Quick prompts">
              {quickPrompts.map((prompt) => (
                <button key={prompt} type="button" className="quick-chip" onClick={() => setDraft(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
            <div className="action-row">
              <button
                type="button"
                className="primary-button"
                disabled={!canControl || !draft.trim() || busyAction !== null}
                onClick={() => callAction("send-text", { text: draft, submit: true })}
                title="Paste text and submit"
              >
                {busyAction === "send-text" ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
                Send
              </button>
              <button
                type="button"
                className="icon-button"
                disabled={!canControl || !draft.trim() || busyAction !== null}
                onClick={() => callAction("send-text", { text: draft, submit: false })}
                title="Paste text"
                aria-label="Paste text"
              >
                <Clipboard size={17} />
              </button>
            </div>
          </div>

          <div className="panel-section">
            <div className="section-heading">
              <Command size={17} />
              <h2>Window</h2>
            </div>
            <div className="button-grid">
              <button
                type="button"
                className="tool-button"
                disabled={!canControl || busyAction !== null}
                onClick={() => callAction("focus")}
              >
                <MonitorDot size={17} />
                Focus
              </button>
              <button
                type="button"
                className="tool-button"
                disabled={busyAction !== null}
                onClick={() => window.location.reload()}
              >
                <RefreshCw size={17} />
                Refresh
              </button>
            </div>
            <div className="hotkey-grid">
              {hotkeys.map((hotkey) => {
                const HotkeyIcon = hotkey.icon;

                return (
                  <button
                    key={hotkey.key}
                    type="button"
                    className="tool-button"
                    disabled={!canControl || busyAction !== null}
                    onClick={() => callAction("hotkey", { key: hotkey.key })}
                    title={hotkey.label}
                  >
                    <HotkeyIcon size={16} />
                    {hotkey.label}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
