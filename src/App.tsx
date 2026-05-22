import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Folder,
  Loader2,
  LogOut,
  MessageSquareText,
  MonitorUp,
  RefreshCw,
  Send,
  ShieldCheck,
  Wifi,
  WifiOff
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

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
  createdAt: string;
  promptPreview: string;
  textLength: number;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  message?: string;
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
  const [chatJobs, setChatJobs] = useState<Record<string, CodexRunJob>>({});

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

  const selectedJob = selectedChatId ? chatJobs[selectedChatId] : undefined;

  const apiFetch = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(url, {
        ...init,
        headers: {
          ...authHeaders,
          ...(init?.headers ?? {})
        }
      });
      const payload = (await response.json()) as T & { message?: string };

      if (!response.ok) {
        throw new Error(payload.message ?? "Request failed");
      }

      return payload;
    },
    [authHeaders]
  );

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
        const payload = (await response.json()) as ApiResult;

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

  const rememberJob = useCallback((job: CodexRunJob) => {
    setChatJobs((current) => ({
      ...current,
      [job.chatId]: job
    }));
  }, []);

  useEffect(() => {
    async function bootstrap() {
      try {
        const response = await fetch("/api/auth/status");
        const status = (await response.json()) as { tokenRequired: boolean };

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
  }, [authenticated, loadChatDetail, selectedChatId]);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const encodedToken = token ? `?token=${encodeURIComponent(token)}` : "";
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws${encodedToken}`);

    socket.addEventListener("open", () => setSocketLive(true));
    socket.addEventListener("close", () => setSocketLive(false));
    socket.addEventListener("error", () => setSocketLive(false));
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data as string) as { state?: BridgeState; event?: BridgeEvent };

      if (payload.state) {
        setState(payload.state);
      }

      const job = payload.event?.detail?.job;
      if (job) {
        rememberJob(job);

        if (job.chatId === selectedChatId && (job.status === "completed" || job.status === "failed")) {
          void loadChats();
          void loadChatDetail(job.chatId, true);
        }
      }
    });

    return () => socket.close();
  }, [authenticated, loadChatDetail, loadChats, rememberJob, selectedChatId, token]);

  useEffect(() => {
    if (!authenticated || !selectedChatId || !selectedJob || !["queued", "running"].includes(selectedJob.status)) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadChats();
      void loadChatDetail(selectedChatId, true);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [authenticated, loadChatDetail, loadChats, selectedChatId, selectedJob]);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await verifyToken(loginToken.trim());
  }

  async function sendPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedChatId || !draft.trim()) {
      return;
    }

    setSending(true);
    setNotice("");

    try {
      const result = await apiFetch<ApiResult>(`/api/chats/${encodeURIComponent(selectedChatId)}/prompt`, {
        method: "POST",
        body: JSON.stringify({ text: draft })
      });

      if (result.job) {
        rememberJob(result.job);
      }

      setDraft("");
      setNotice(result.message ?? "Prompt sent");
      window.setTimeout(() => {
        void loadChats();
        void loadChatDetail(selectedChatId, true);
      }, 1600);
    } catch (error) {
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
    <main className="remote-shell">
      <aside className="chat-sidebar" aria-label="Project chats">
        <div className="sidebar-header">
          <div>
            <h1>Codex Remote</h1>
            <span>{chatIndex?.totalChats ?? 0} chats</span>
          </div>
          <button className="icon-button" type="button" onClick={loadChats} aria-label="Refresh chats">
            {loadingChats ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          </button>
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
                    {project.chats.map((chat) => (
                      <button
                        key={chat.id}
                        type="button"
                        className={`chat-link ${selectedChatId === chat.id ? "is-active" : ""}`}
                        onClick={() => {
                          setSelectedChat(null);
                          setSelectedChatId(chat.id);
                        }}
                      >
                        <span>{chat.title}</span>
                        <small>{formatRelative(chat.updatedAt)}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </aside>

      <section className="chat-workspace" aria-label="Selected chat">
        <header className="chat-topbar">
          <div>
            <p className="overline">{selectedChat?.projectName ?? "Project"}</p>
            <h2>{selectedChat?.title ?? "Select a chat"}</h2>
          </div>
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
            <button className="icon-button" type="button" onClick={logout} aria-label="Sign out">
              <LogOut size={18} />
            </button>
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
                <pre>{selectedChat.lastPrompt?.text ?? "No prompt found."}</pre>
              </section>

              <section className="message-block response-block">
                <div className="message-heading">
                  <MessageSquareText size={17} />
                  <h3>Last response</h3>
                  {selectedChat.lastResponse ? <time>{formatDate(selectedChat.lastResponse.createdAt)}</time> : null}
                </div>
                <pre>{selectedChat.lastResponse?.text ?? "No response found yet."}</pre>
              </section>
            </>
          ) : (
            <div className="empty-chat">
              <Clock3 size={26} />
            </div>
          )}
        </div>

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
