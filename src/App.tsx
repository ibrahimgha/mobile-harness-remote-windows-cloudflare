import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleX,
  Clock3,
  Folder,
  ListChecks,
  Loader2,
  LogOut,
  Menu,
  MessageSquareText,
  MonitorUp,
  RefreshCw,
  Send,
  ShieldCheck,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type BridgeState = {
  bridge: {
    mode: "simulation" | "window-control";
    targetTitle: string;
    tokenRequired: boolean;
    platform: string;
  };
  server: {
    uptimeSeconds: number;
    clients: number;
  };
  runner: {
    mode: "codex-cli" | "simulation";
    activeJobs: number;
    queuedJobs: number;
    recentJobs: CodexRunJob[];
  };
};

type BridgeEvent = {
  type: "action" | "error" | "status";
  message: string;
  detail?: {
    action?: string;
    chatId?: string;
    job?: CodexRunJob;
  };
};

type CodexRunJob = {
  id: string;
  chatId: string;
  projectPath: string;
  status: "queued" | "running" | "completed" | "failed";
  queuePosition?: number;
  createdAt: string;
  promptPreview: string;
  textLength: number;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  message?: string;
  heartbeat?: string;
  heartbeatAt?: string;
  heartbeatHistory?: string[];
};

type ChatMessageExcerpt = {
  text: string;
  createdAt: string;
};

type ChatSummary = {
  id: string;
  title: string;
  projectName: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  lastPromptPreview: string;
  lastResponsePreview: string;
  hasResponse: boolean;
};

type ChatDetail = {
  id: string;
  title: string;
  projectName: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  lastPrompt: ChatMessageExcerpt | null;
  lastResponse: ChatMessageExcerpt | null;
  hasResponse: boolean;
};

type ChatProjectGroup = {
  projectName: string;
  projectPath: string;
  updatedAt: string;
  chats: ChatSummary[];
};

type ChatIndex = {
  projects: ChatProjectGroup[];
  totalChats: number;
};

type ApiResult = {
  ok: boolean;
  message?: string;
  state?: BridgeState;
  job?: CodexRunJob;
};

type ChatJobsResult = {
  ok: boolean;
  chatId: string;
  jobs: CodexRunJob[];
};

const tokenKey = "control-token";
const collapsedProjectsKey = "collapsed-projects";

function formatRelative(value: string) {
  const ms = Date.parse(value);

  if (!Number.isFinite(ms)) {
    return "";
  }

  const diffSeconds = Math.max(0, Math.round((Date.now() - ms) / 1000));

  if (diffSeconds < 60) {
    return "just now";
  }

  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString();
}

function firstChatId(index: ChatIndex | null) {
  return index?.projects[0]?.chats[0]?.id ?? null;
}

function previewText(text: string, fallback: string) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.length > 84 ? `${normalized.slice(0, 81)}...` : normalized;
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T & { message?: string }> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (!contentType.toLowerCase().includes("application/json")) {
    const htmlHint = text.trimStart().startsWith("<") ? " The server returned an HTML page instead of API JSON." : "";
    throw new Error(`${fallbackMessage}.${htmlHint}`);
  }

  try {
    return JSON.parse(text) as T & { message?: string };
  } catch {
    throw new Error(`${fallbackMessage}. The API response was not valid JSON.`);
  }
}

function isActiveJob(job: CodexRunJob | undefined) {
  return job?.status === "queued" || job?.status === "running";
}

function sortJobsForChat(jobs: CodexRunJob[]) {
  const activeRank: Record<CodexRunJob["status"], number> = {
    running: 0,
    queued: 1,
    failed: 2,
    completed: 3
  };

  return [...jobs].sort((a, b) => {
    const aActive = isActiveJob(a);
    const bActive = isActiveJob(b);

    if (aActive !== bActive) {
      return aActive ? -1 : 1;
    }

    if (aActive && bActive) {
      const statusDelta = activeRank[a.status] - activeRank[b.status];
      if (statusDelta !== 0) {
        return statusDelta;
      }

      return (a.queuePosition ?? 0) - (b.queuePosition ?? 0) || Date.parse(a.createdAt) - Date.parse(b.createdAt);
    }

    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

function mergeJobsForChat(current: CodexRunJob[], incoming: CodexRunJob[]) {
  const merged = new Map(current.map((job) => [job.id, job]));

  for (const job of incoming) {
    merged.set(job.id, { ...merged.get(job.id), ...job });
  }

  return sortJobsForChat([...merged.values()]).slice(0, 40);
}

function activeJobCount(jobs: CodexRunJob[] | undefined) {
  return jobs?.filter(isActiveJob).length ?? 0;
}

function jobStatusLabel(job: CodexRunJob) {
  if (job.status === "queued") {
    return job.queuePosition ? `Queued #${job.queuePosition}` : "Queued";
  }

  if (job.status === "running") {
    return "Running";
  }

  if (job.status === "failed") {
    return "Failed";
  }

  return "Completed";
}

function jobDetailText(job: CodexRunJob) {
  if (job.heartbeat) {
    return job.heartbeat;
  }

  if (job.message) {
    return job.message;
  }

  return job.status === "queued" ? "Waiting for the target laptop." : "No status details yet.";
}

function formattedJobHeartbeat(job: CodexRunJob) {
  const heartbeat = job.heartbeat ?? job.message ?? "Waiting for the target laptop to start the Codex run.";
  const status = job.status === "running" ? "Running on target laptop" : "Queued on target laptop";

  return `**Heartbeat:** ${heartbeat}\n\n**Status:** ${status}`;
}

function FormattedMessage({ text, emptyText }: { text: string | undefined; emptyText: string }) {
  if (!text?.trim()) {
    return <div className="message-empty">{emptyText}</div>;
  }

  return (
    <div className="message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          )
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function JobStatusIcon({ job }: { job: CodexRunJob }) {
  if (job.status === "running") {
    return <Loader2 className="spin" size={15} />;
  }

  if (job.status === "completed") {
    return <CheckCircle2 size={15} />;
  }

  if (job.status === "failed") {
    return <CircleX size={15} />;
  }

  return <Clock3 size={15} />;
}

function StatusControls({
  socketLive,
  state,
  onLogout
}: {
  socketLive: boolean;
  state: BridgeState | null;
  onLogout: () => void;
}) {
  return (
    <div className="status-row">
      <span className={`status-pill ${socketLive ? "is-live" : "is-offline"}`}>
        {socketLive ? <Wifi size={15} /> : <WifiOff size={15} />}
        {socketLive ? "Live" : "Offline"}
      </span>
      <span className="status-pill is-muted">
        <CheckCircle2 size={15} />
        {state?.runner.mode ?? state?.bridge.mode ?? "ready"}
      </span>
      <span className="status-pill is-muted">
        <MonitorUp size={15} />
        {state ? `${state.runner.activeJobs}/${state.runner.queuedJobs}` : "0/0"}
      </span>
      <button className="icon-button" type="button" onClick={onLogout} aria-label="Sign out">
        <LogOut size={18} />
      </button>
    </div>
  );
}

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey) ?? "");
  const [loginToken, setLoginToken] = useState(() => localStorage.getItem(tokenKey) ?? "");
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(collapsedProjectsKey);

    if (!saved) {
      return new Set();
    }

    try {
      const parsed = JSON.parse(saved) as unknown;

      return Array.isArray(parsed) ? new Set(parsed.filter((value): value is string => typeof value === "string")) : new Set();
    } catch {
      return new Set();
    }
  });
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authError, setAuthError] = useState("");
  const [state, setState] = useState<BridgeState | null>(null);
  const [chatIndex, setChatIndex] = useState<ChatIndex | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [selectedChat, setSelectedChat] = useState<ChatDetail | null>(null);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [socketLive, setSocketLive] = useState(false);
  const [chatJobs, setChatJobs] = useState<Record<string, CodexRunJob[]>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const selectedChatIdRef = useRef<string | null>(null);

  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(token ? { "x-control-token": token } : {})
    }),
    [token]
  );

  const selectedProjectPath = useMemo(() => {
    if (!chatIndex || !selectedChatId) {
      return null;
    }

    for (const project of chatIndex.projects) {
      if (project.chats.some((chat) => chat.id === selectedChatId)) {
        return project.projectPath;
      }
    }

    return null;
  }, [chatIndex, selectedChatId]);

  const selectedJobs = useMemo(() => (selectedChatId ? chatJobs[selectedChatId] ?? [] : []), [chatJobs, selectedChatId]);
  const selectedJob = selectedJobs.find(isActiveJob);
  const selectedActiveJobCount = activeJobCount(selectedJobs);
  const responseIsHeartbeat = Boolean(selectedJob);
  const responseText =
    responseIsHeartbeat && selectedJob ? formattedJobHeartbeat(selectedJob) : selectedChat?.lastResponse?.text;

  const apiFetch = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(url, {
        ...init,
        headers: {
          ...authHeaders,
          ...(init?.headers ?? {})
        }
      });
      const payload = await readJsonResponse<T>(response, "API request failed");

      if (!response.ok) {
        throw new Error(payload.message ?? "Request failed");
      }

      return payload;
    },
    [authHeaders]
  );

  const loadState = useCallback(async () => {
    if (!authenticated) {
      return;
    }

    try {
      setState(await apiFetch<BridgeState>("/api/state"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load bridge state");
    }
  }, [apiFetch, authenticated]);

  const verifyToken = useCallback(
    async (value: string) => {
      setCheckingAuth(true);
      setAuthError("");

      try {
        const response = await fetch("/api/auth/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(value ? { "x-control-token": value } : {})
          }
        });
        const payload = await readJsonResponse<ApiResult>(response, "Could not verify control token");

        if (!response.ok || !payload.ok) {
          throw new Error(payload.message ?? "Invalid token");
        }

        localStorage.setItem(tokenKey, value);
        setToken(value);
        setLoginToken(value);
        setState(payload.state ?? null);
        setAuthenticated(true);
      } catch (error) {
        setAuthenticated(false);
        setAuthError(error instanceof Error ? error.message : "Invalid token");
      } finally {
        setCheckingAuth(false);
      }
    },
    []
  );

  const loadChats = useCallback(async () => {
    if (!authenticated) {
      return;
    }

    setLoadingChats(true);
    try {
      const index = await apiFetch<ChatIndex>("/api/chats");
      setChatIndex(index);
      setSelectedChatId((current) => current ?? firstChatId(index));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load chats");
    } finally {
      setLoadingChats(false);
    }
  }, [apiFetch, authenticated]);

  const loadChatDetail = useCallback(
    async (chatId: string, quiet = false) => {
      if (!quiet) {
        setLoadingDetail(true);
      }

      try {
        const detail = await apiFetch<ChatDetail>(`/api/chats/${encodeURIComponent(chatId)}`);
        setSelectedChat(detail);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not load chat");
      } finally {
        if (!quiet) {
          setLoadingDetail(false);
        }
      }
    },
    [apiFetch]
  );

  const loadChatJobs = useCallback(
    async (chatId: string) => {
      try {
        const result = await apiFetch<ChatJobsResult>(`/api/chats/${encodeURIComponent(chatId)}/jobs`);
        setChatJobs((current) => ({
          ...current,
          [chatId]: sortJobsForChat(result.jobs).slice(0, 40)
        }));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not load command queue");
      }
    },
    [apiFetch]
  );

  const rememberJob = useCallback((job: CodexRunJob) => {
    setChatJobs((current) => ({
      ...current,
      [job.chatId]: mergeJobsForChat(current[job.chatId] ?? [], [job])
    }));
  }, []);

  const refreshWorkspace = useCallback(async () => {
    if (!authenticated) {
      return;
    }

    setNotice("");
    await Promise.all([
      loadChats(),
      loadState(),
      selectedChatId ? loadChatDetail(selectedChatId, true) : Promise.resolve(),
      selectedChatId ? loadChatJobs(selectedChatId) : Promise.resolve()
    ]);
  }, [authenticated, loadChatDetail, loadChatJobs, loadChats, loadState, selectedChatId]);

  const applyOptimisticPrompt = useCallback((chatId: string, text: string, createdAt: string) => {
    setSelectedChat((current) => {
      if (!current || current.id !== chatId) {
        return current;
      }

      return {
        ...current,
        updatedAt: createdAt,
        lastPrompt: { text, createdAt },
        lastResponse: null,
        hasResponse: false
      };
    });

    setChatIndex((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        projects: current.projects.map((project) => ({
          ...project,
          updatedAt: project.chats.some((chat) => chat.id === chatId) ? createdAt : project.updatedAt,
          chats: project.chats.map((chat) =>
            chat.id === chatId
              ? {
                  ...chat,
                  updatedAt: createdAt,
                  lastPromptPreview: previewText(text, "No prompt yet"),
                  lastResponsePreview: "Waiting for response...",
                  hasResponse: false
                }
              : chat
          )
        }))
      };
    });
  }, []);

  useEffect(() => {
    async function bootstrap() {
      try {
        const response = await fetch("/api/auth/status");
        const status = await readJsonResponse<{ tokenRequired: boolean }>(response, "Bridge unavailable");

        if (!status.tokenRequired) {
          await verifyToken("");
          return;
        }

        if (token) {
          await verifyToken(token);
          return;
        }

        setCheckingAuth(false);
      } catch {
        setAuthError("Bridge unavailable");
        setCheckingAuth(false);
      }
    }

    void bootstrap();
  }, [token, verifyToken]);

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    if (!selectedChatId) {
      return;
    }

    setMenuOpen(false);
  }, [selectedChatId]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  useEffect(() => {
    localStorage.setItem(collapsedProjectsKey, JSON.stringify([...collapsedProjects]));
  }, [collapsedProjects]);

  useEffect(() => {
    if (!selectedProjectPath) {
      return;
    }

    setCollapsedProjects((current) => {
      if (!current.has(selectedProjectPath)) {
        return current;
      }

      const next = new Set(current);
      next.delete(selectedProjectPath);

      return next;
    });
  }, [selectedProjectPath]);

  useEffect(() => {
    if (!authenticated || !selectedChatId) {
      return;
    }

    void loadChatDetail(selectedChatId);
    void loadChatJobs(selectedChatId);
  }, [authenticated, loadChatDetail, loadChatJobs, selectedChatId]);

  useEffect(() => {
    if (!state?.runner.recentJobs.length) {
      return;
    }

    setChatJobs((current) => {
      const next = { ...current };

      for (const job of state.runner.recentJobs) {
        next[job.chatId] = mergeJobsForChat(next[job.chatId] ?? [], [job]);
      }

      return next;
    });
  }, [state]);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const encodedToken = token ? `?token=${encodeURIComponent(token)}` : "";
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let stopped = false;

    const connect = () => {
      socket = new WebSocket(`${protocol}://${window.location.host}/ws${encodedToken}`);

      socket.addEventListener("open", () => setSocketLive(true));
      socket.addEventListener("close", () => {
        setSocketLive(false);

        if (!stopped) {
          reconnectTimer = window.setTimeout(connect, 1500);
        }
      });
      socket.addEventListener("error", () => {
        setSocketLive(false);
        socket?.close();
      });
      socket.addEventListener("message", (event) => {
        let payload: { state?: BridgeState; event?: BridgeEvent };

        try {
          payload = JSON.parse(event.data as string) as { state?: BridgeState; event?: BridgeEvent };
        } catch {
          setNotice("Received an invalid socket message");
          return;
        }

        if (payload.state) {
          setState(payload.state);
        }

        const job = payload.event?.detail?.job;
        if (job) {
          rememberJob(job);

          if (job.chatId === selectedChatIdRef.current && (job.status === "completed" || job.status === "failed")) {
            void loadChats();
            void loadChatJobs(job.chatId);
            void loadChatDetail(job.chatId, true);
          }
        }
      });
    };

    connect();

    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [authenticated, loadChatDetail, loadChatJobs, loadChats, rememberJob, token]);

  useEffect(() => {
    if (!authenticated || !selectedChatId || !selectedJob || !["queued", "running"].includes(selectedJob.status)) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadChats();
      void loadChatJobs(selectedChatId);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [authenticated, loadChatJobs, loadChats, selectedChatId, selectedJob]);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await verifyToken(loginToken.trim());
  }

  async function sendPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedChatId || !draft.trim()) {
      return;
    }

    const promptText = draft.trimEnd();
    const optimisticAt = new Date().toISOString();
    const previousSelectedChat = selectedChat;
    const previousChatIndex = chatIndex;

    applyOptimisticPrompt(selectedChatId, promptText, optimisticAt);
    setSending(true);
    setNotice("");

    try {
      const result = await apiFetch<ApiResult>(`/api/chats/${encodeURIComponent(selectedChatId)}/prompt`, {
        method: "POST",
        body: JSON.stringify({ text: promptText })
      });

      if (result.job) {
        rememberJob(result.job);
      }

      setDraft("");
      setNotice(result.message ?? "Prompt sent");
      window.setTimeout(() => {
        void loadChats();
        void loadChatJobs(selectedChatId);
        void loadChatDetail(selectedChatId, true);
      }, 1600);
    } catch (error) {
      setSelectedChat(previousSelectedChat);
      setChatIndex(previousChatIndex);
      setNotice(error instanceof Error ? error.message : "Prompt failed");
    } finally {
      setSending(false);
    }
  }

  function logout() {
    localStorage.removeItem(tokenKey);
    setToken("");
    setLoginToken("");
    setAuthenticated(false);
    setChatIndex(null);
    setSelectedChat(null);
    setSelectedChatId(null);
  }

  function toggleProject(projectPath: string) {
    setCollapsedProjects((current) => {
      const next = new Set(current);

      if (next.has(projectPath)) {
        next.delete(projectPath);
      } else {
        next.add(projectPath);
      }

      return next;
    });
  }

  if (checkingAuth) {
    return (
      <main className="auth-shell">
        <Loader2 className="spin" size={24} />
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="auth-shell">
        <form className="auth-panel" onSubmit={submitLogin}>
          <div className="auth-mark" aria-hidden="true">
            <ShieldCheck size={26} />
          </div>
          <h1>Codex Remote</h1>
          <label htmlFor="control-token">Control token</label>
          <div className="auth-row">
            <input
              id="control-token"
              type="password"
              value={loginToken}
              onChange={(event) => setLoginToken(event.target.value)}
              autoComplete="current-password"
            />
            <button type="submit" aria-label="Unlock">
              <ArrowRight size={18} />
            </button>
          </div>
          {authError ? <p className="auth-error">{authError}</p> : null}
        </form>
      </main>
    );
  }

  return (
    <main className={`remote-shell ${menuOpen ? "is-menu-open" : ""}`}>
      <aside className="chat-sidebar" aria-label="Project chats">
        <div className="sidebar-header">
          <div>
            <h1>Codex Remote</h1>
            <span>{chatIndex?.totalChats ?? 0} chats</span>
          </div>
          <div className="sidebar-actions">
            <button className="icon-button" type="button" onClick={refreshWorkspace} aria-label="Refresh chats">
              {loadingChats ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
            </button>
            <button className="icon-button mobile-close-button" type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="mobile-menu-controls">
          <StatusControls socketLive={socketLive} state={state} onLogout={logout} />
        </div>

        <div className="project-list">
          {chatIndex?.projects.map((project) => {
            const listId = `project-${project.projectPath.replace(/[^a-z0-9]/gi, "-")}`;
            const isCollapsed = collapsedProjects.has(project.projectPath) && selectedProjectPath !== project.projectPath;
            const ChevronIcon = isCollapsed ? ChevronRight : ChevronDown;

            return (
              <section key={project.projectPath} className="project-group">
                <button
                  type="button"
                  className="project-heading"
                  aria-expanded={!isCollapsed}
                  aria-controls={listId}
                  onClick={() => toggleProject(project.projectPath)}
                >
                  <ChevronIcon className="project-chevron" size={16} />
                  <Folder size={16} />
                  <span className="project-copy">
                    <span className="project-title">{project.projectName}</span>
                    <span className="project-path" title={project.projectPath}>
                      {project.projectPath}
                    </span>
                  </span>
                  <span className="project-count">{project.chats.length}</span>
                </button>
                {!isCollapsed ? (
                  <div id={listId} className="chat-list">
                    {project.chats.map((chat) => {
                      const queuedCommands = activeJobCount(chatJobs[chat.id]);

                      return (
                        <button
                          key={chat.id}
                          type="button"
                          className={`chat-link ${selectedChatId === chat.id ? "is-active" : ""}`}
                          onClick={() => {
                            setSelectedChat(null);
                            setSelectedChatId(chat.id);
                            setMenuOpen(false);
                          }}
                        >
                          <span>{chat.title}</span>
                          <span className="chat-meta">
                            <small>{formatRelative(chat.updatedAt)}</small>
                            {queuedCommands ? <span className="chat-queue-badge">{queuedCommands}</span> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </aside>
      <button className="menu-backdrop" type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)} />

      <section className="chat-workspace" aria-label="Selected chat">
        <header className="chat-topbar">
          <button
            className="icon-button mobile-menu-button"
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
          >
            <Menu size={18} />
          </button>
          <div className="chat-title-copy">
            <p className="overline">{selectedChat?.projectName ?? "Project"}</p>
            <h2>{selectedChat?.title ?? "Select a chat"}</h2>
          </div>
          <div className="desktop-status-controls">
            <StatusControls socketLive={socketLive} state={state} onLogout={logout} />
          </div>
        </header>

        <div className="chat-content">
          {loadingDetail ? (
            <div className="loading-state">
              <Loader2 className="spin" size={24} />
            </div>
          ) : selectedChat ? (
            <>
              <section className="message-block prompt-block">
                <div className="message-heading">
                  <MessageSquareText size={17} />
                  <h3>Last prompt</h3>
                  {selectedChat.lastPrompt ? <time>{formatDate(selectedChat.lastPrompt.createdAt)}</time> : null}
                </div>
                <FormattedMessage text={selectedChat.lastPrompt?.text} emptyText="No prompt found." />
              </section>

              <section className="message-block response-block">
                <div className="message-heading">
                  <MessageSquareText size={17} />
                  <h3>{responseIsHeartbeat ? "Heartbeat" : "Last response"}</h3>
                  {responseIsHeartbeat && selectedJob?.heartbeatAt ? <time>{formatDate(selectedJob.heartbeatAt)}</time> : null}
                  {!responseIsHeartbeat && selectedChat.lastResponse ? (
                    <time>{formatDate(selectedChat.lastResponse.createdAt)}</time>
                  ) : null}
                </div>
                <FormattedMessage text={responseText} emptyText="No response found yet." />
              </section>
            </>
          ) : (
            <div className="empty-chat">
              <Clock3 size={26} />
            </div>
          )}
        </div>

        {selectedChat ? (
          <section className="command-queue" aria-labelledby="command-queue-title">
            <div className="queue-header">
              <div className="queue-title">
                <ListChecks size={17} />
                <h3 id="command-queue-title">Command queue</h3>
              </div>
              <span className="queue-count">
                {selectedActiveJobCount
                  ? `${selectedActiveJobCount} active / ${selectedJobs.length} recent`
                  : selectedJobs.length
                    ? `${selectedJobs.length} recent`
                    : "No commands"}
              </span>
            </div>

            {selectedJobs.length ? (
              <div className="queue-list" aria-label="Commands for this chat">
                {selectedJobs.map((job) => (
                  <article key={job.id} className={`queue-item is-${job.status}`}>
                    <div className="queue-status-row">
                      <span className="queue-status">
                        <JobStatusIcon job={job} />
                        {jobStatusLabel(job)}
                      </span>
                      <time>{formatRelative(job.finishedAt ?? job.startedAt ?? job.createdAt)}</time>
                    </div>
                    <p className="queue-preview">{job.promptPreview || "Prompt"}</p>
                    <p className="queue-detail">{jobDetailText(job)}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="queue-empty">No commands queued for this chat yet.</p>
            )}
          </section>
        ) : null}

        {selectedJob && ["queued", "running"].includes(selectedJob.status) ? (
          <div className="job-strip">
            <Loader2 className={selectedJob.status === "running" ? "spin" : ""} size={16} />
            <span>{selectedJob.status === "running" ? "Running on target laptop" : "Queued on target laptop"}</span>
            <small>{selectedJob.promptPreview}</small>
          </div>
        ) : null}

        <form className="composer" onSubmit={sendPrompt}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="New prompt"
            spellCheck={false}
          />
          <button type="submit" disabled={!selectedChatId || !draft.trim() || sending}>
            {sending ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
            Send
          </button>
        </form>

        {notice ? <p className="notice">{notice}</p> : null}
      </section>
    </main>
  );
}
