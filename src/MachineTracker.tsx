import { Activity, AlertTriangle, Check, Clock3, Loader2, Radio, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CodexUsage, CodexUsageWindow } from "../server/types";
import type { ControlRoomTrackerSnapshot, TrackerRun } from "../server/controlRoomTracker";
import "./machine-tracker.css";

type TrackerStatus = "ready" | "authenticated" | "unauthorized";

const params = new URLSearchParams(window.location.search);
const slotId = params.get("control-room-slot")?.trim() ?? "";
const parentOrigin = params.get("control-room-origin")?.trim() ?? "";

function elapsedLabel(startedAt: string, finishedAt: string | undefined, nowMs: number): string {
  const startMs = Date.parse(startedAt);
  const endMs = finishedAt ? Date.parse(finishedAt) : nowMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "—";
  const totalSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function clockLabel(value?: string | number): string {
  if (value === undefined) return "Reset unavailable";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  if (!Number.isFinite(date.getTime())) return "Reset unavailable";
  return `Resets ${new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  }).format(date)}`;
}

function modelLabel(run: TrackerRun): string {
  return `${run.model.replace(/^gpt-/, "")} · ${run.reasoningEffort}`;
}

function UsageLimit({ label, window }: { label: string; window?: CodexUsageWindow }) {
  const used = Math.min(100, Math.max(0, window?.usedPercent ?? 0));
  const pressure = used >= 90 ? "is-critical" : used >= 75 ? "is-warning" : "";
  return (
    <div className={`machine-tracker-limit ${pressure}`}>
      <div>
        <span>{label}</span>
        <strong>{window ? `${Math.round(100 - used)}% left` : "Measuring"}</strong>
      </div>
      <div className="machine-tracker-limit-track" aria-label={`${label}: ${Math.round(used)} percent used`}>
        <span style={{ width: `${used}%` }} />
      </div>
      <small>{window ? `${Math.round(used)}% used · ${clockLabel(window.resetsAt)}` : "Waiting for Codex usage data"}</small>
    </div>
  );
}

function RunRow({ run, nowMs, active = false }: { run: TrackerRun; nowMs: number; active?: boolean }) {
  return (
    <li className={active ? "is-active" : `is-${run.status}`}>
      <span className="machine-tracker-run-status" aria-label={run.status}>
        {active ? <Radio size={12} /> : run.status === "completed" ? <Check size={12} /> : <AlertTriangle size={12} />}
      </span>
      <span className="machine-tracker-run-copy">
        <strong title={run.title}>{run.title}</strong>
        <small title={run.projectName}>{run.projectName}</small>
      </span>
      <span className="machine-tracker-run-meta">
        <strong>{elapsedLabel(run.startedAt, run.finishedAt, nowMs)}</strong>
        <small>{modelLabel(run)}</small>
      </span>
    </li>
  );
}

export function MachineTracker() {
  const [token, setToken] = useState("");
  const [snapshot, setSnapshot] = useState<ControlRoomTrackerSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(Date.now());

  const notifyParent = useCallback((status: TrackerStatus, serverName?: string) => {
    if (window.parent === window) return;
    window.parent.postMessage(
      { type: "codex-control-room-status", slotId, status, serverName },
      parentOrigin || "*"
    );
  }, []);

  const refresh = useCallback(async (accessToken: string, quiet = false) => {
    if (!accessToken) return;
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/control-room/tracker", {
        headers: accessToken ? { "x-control-token": accessToken } : undefined
      });
      const payload = (await response.json()) as ControlRoomTrackerSnapshot & { message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? "Could not load machine status");
      setSnapshot(payload);
      setError("");
      notifyParent("authenticated", payload.serverName);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load machine status");
      if (cause instanceof Error && /auth|token|access/i.test(cause.message)) notifyParent("unauthorized");
    } finally {
      setLoading(false);
    }
  }, [notifyParent]);

  useEffect(() => {
    const receiveAuthentication = (event: MessageEvent<unknown>) => {
      if (parentOrigin && event.origin !== parentOrigin) return;
      if (event.source !== window.parent || !event.data || typeof event.data !== "object") return;
      const message = event.data as Record<string, unknown>;
      if (message.type === "codex-control-room-scroll-bottom" && message.slotId === slotId) {
        document.querySelector<HTMLElement>(".machine-tracker-shell")?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: "auto" });
        return;
      }
      if (message.type !== "codex-control-room-auth" || message.slotId !== slotId || typeof message.token !== "string") return;
      setToken(message.token);
      void refresh(message.token);
    };
    const requestGlobalScroll = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === "ArrowDown") {
        event.preventDefault();
        window.parent.postMessage(
          { type: "codex-control-room-scroll-all-request", slotId },
          parentOrigin || "*"
        );
      }
    };
    window.addEventListener("message", receiveAuthentication);
    window.addEventListener("keydown", requestGlobalScroll);
    notifyParent("ready");
    return () => {
      window.removeEventListener("message", receiveAuthentication);
      window.removeEventListener("keydown", requestGlobalScroll);
    };
  }, [notifyParent, refresh]);

  useEffect(() => {
    if (!token) return;
    const refreshTimer = window.setInterval(() => void refresh(token, true), 5000);
    const clockTimer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [refresh, token]);

  const updatedLabel = useMemo(() => {
    if (!snapshot) return "Waiting for machine";
    return `Updated ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(snapshot.generatedAt))}`;
  }, [snapshot]);

  return (
    <main className="machine-tracker-shell">
      <header className="machine-tracker-header">
        <div className="machine-tracker-identity">
          <span className="machine-tracker-pulse"><Activity size={16} /></span>
          <div><span>LIVE MACHINE</span><strong>{snapshot?.serverName ?? "Connecting"}</strong></div>
        </div>
        <button type="button" onClick={() => void refresh(token)} disabled={!token || loading} aria-label="Refresh live tracker" title="Refresh now">
          <RefreshCw className={loading ? "spin" : ""} size={14} />
        </button>
      </header>

      {error && !snapshot ? (
        <section className="machine-tracker-state is-error"><AlertTriangle size={22} /><strong>Tracker unavailable</strong><span>{error}</span></section>
      ) : !snapshot ? (
        <section className="machine-tracker-state"><Loader2 className="spin" size={22} /><strong>Connecting to machine</strong><span>Authenticating and reading Codex activity…</span></section>
      ) : (
        <div className="machine-tracker-content">
          <section className="machine-tracker-scoreboard" aria-label="Machine job summary">
            <div className={snapshot.runningCount ? "is-live" : ""}>
              <span>RUNNING NOW</span>
              <strong>{snapshot.runningCount}</strong>
              <small>{snapshot.runningCount === 1 ? "active job" : "active jobs"}</small>
            </div>
            <div>
              <span>DONE SINCE 05:00</span>
              <strong>{snapshot.completedSinceDayStart}</strong>
              <small>completed jobs</small>
            </div>
          </section>

          <section className="machine-tracker-section is-running">
            <div className="machine-tracker-section-title"><span><Radio size={12} /> CURRENTLY RUNNING</span><small>{updatedLabel}</small></div>
            {snapshot.running.length ? <ul>{snapshot.running.map((run) => <RunRow key={run.id} run={run} nowMs={nowMs} active />)}</ul> : (
              <div className="machine-tracker-empty"><Clock3 size={15} /><span>No active jobs on this machine</span></div>
            )}
          </section>

          <section className="machine-tracker-section is-recent">
            <div className="machine-tracker-section-title"><span><Check size={12} /> RECENT RUNS</span><small>latest first</small></div>
            {snapshot.recent.length ? <ul>{snapshot.recent.map((run) => <RunRow key={run.id} run={run} nowMs={nowMs} />)}</ul> : (
              <div className="machine-tracker-empty"><span>No recent runs recorded</span></div>
            )}
          </section>

          <section className="machine-tracker-usage" aria-label="Codex subscription limits">
            <UsageLimit label="5-HOUR LIMIT" window={(snapshot.usage as CodexUsage | null)?.fiveHour} />
            <UsageLimit label="WEEKLY LIMIT" window={(snapshot.usage as CodexUsage | null)?.weekly} />
          </section>
        </div>
      )}
    </main>
  );
}
