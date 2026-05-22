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
  MonitorUp,
  Paperclip,
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
    promptDelivery?: "cli";
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
  codexTranscript?: CodexTranscriptStatus;
};

type CodexTranscriptStatus = {
  checkedAt: string;
  promptVisible: boolean;
  responseVisible: boolean;
  sessionPath?: string;
  message: string;
};

type ChatMessageExcerpt = {
  text: string;
  createdAt: string;
};

type ChatTranscriptMessage = ChatMessageExcerpt & {
  id: string;
  role: "user" | "assistant";
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
  messages: ChatTranscriptMessage[];
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

type PendingAttachment = {
  id: string;
  file: File;
};

type LocalQueuedCommand = {
  id: string;
  chatId: string;
  text: string;
  createdAt: string;
  status: "pending" | "sending" | "failed";
  message?: string;
  attempts?: number;
  retryAfter?: string;
};

type UploadedPromptFile = {
  name: string;
  originalName: string;
  type: string;
  size: number;
  path: string;
  relativePath: string;
  uploadedAt: string;
};

type FileUploadResult = {
  ok: boolean;
  files: UploadedPromptFile[];
};

const tokenKey = "control-token";
const collapsedProjectsKey = "collapsed-projects";
const localCommandQueueKey = "local-command-queue";
const maxAttachmentFiles = 5;
const maxAttachmentBytes = 10 * 1024 * 1024;
const socketReconnectMs = 1500;
const socketWatchdogMs = 5000;
const socketConnectTimeoutMs = 12000;
const socketStaleMs = 45000;

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

function formatElapsedSeconds(startValue: string | undefined, endValue: string | undefined, nowMs: number) {
  const startMs = Date.parse(startValue ?? "");
  const endMs = endValue ? Date.parse(endValue) : nowMs;

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return "0:00";
  }

  const totalSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }

  return `${minutes}:${paddedSeconds}`;
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

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(kilobytes >= 100 ? 0 : 1)} KB`;
  }

  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(megabytes >= 10 ? 1 : 2)} MB`;
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");

      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read file")));
    reader.readAsDataURL(file);
  });
}

function isLocalCommandDue(command: LocalQueuedCommand) {
  const retryAt = command.retryAfter ? Date.parse(command.retryAfter) : Number.NaN;

  return command.status === "pending" && (!Number.isFinite(retryAt) || retryAt <= Date.now());
}

function localCommandRetryDelay(attempts: number) {
  return Math.min(30000, 3000 * 2 ** Math.min(attempts, 3));
}

function localCommandStatusText(command: LocalQueuedCommand) {
  if (command.status === "sending") {
    return "Sending";
  }

  const retryAt = command.retryAfter ? Date.parse(command.retryAfter) : Number.NaN;

  if (Number.isFinite(retryAt) && retryAt > Date.now()) {
    return "Retry queued";
  }

  return "Local queued";
}

function localCommandDetailText(command: LocalQueuedCommand) {
  if (command.message) {
    return command.message;
  }

  return command.status === "sending" ? "Sending to target laptop" : "Waiting for previous task to finish";
}

function readLocalCommandQueue(): LocalQueuedCommand[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(localCommandQueueKey) ?? "[]");

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (item): item is LocalQueuedCommand =>
        item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.chatId === "string" &&
        typeof item.text === "string" &&
        typeof item.createdAt === "string" &&
        (item.status === "pending" || item.status === "sending" || item.status === "failed")
      )
      .map((item) => ({
        ...item,
        status: item.status === "failed" ? "pending" : item.status,
        attempts: typeof item.attempts === "number" ? item.attempts : 0,
        retryAfter: typeof item.retryAfter === "string" ? item.retryAfter : undefined
      }));
  } catch {
    return [];
  }
}

function resizeTextareaElement(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";

  const styles = window.getComputedStyle(textarea);
  const minHeight = Number.parseFloat(styles.minHeight) || 44;
  const maxHeight = Number.parseFloat(styles.maxHeight) || 180;
  const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);

  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";

  return nextHeight > minHeight + 6;
}

function promptWithUploadedFiles(text: string, files: UploadedPromptFile[]) {
  const baseText = text.trimEnd() || "Please review the attached file(s).";

  if (!files.length) {
    return baseText;
  }

  const fileLines = files
    .map((file, index) => `${index + 1}. ${file.originalName} (${formatBytes(file.size)})\n   ${file.path}`)
    .join("\n");

  return `${baseText}\n\nAttached files saved on the target laptop:\n${fileLines}\n\nUse these local file paths when working on this request.`;
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
  if (job.status === "completed" && job.codexTranscript?.message) {
    return job.codexTranscript.message;
  }

  if (job.codexTranscript?.message) {
    return job.codexTranscript.message;
  }

  if (job.message) {
    return job.message;
  }

  return job.status === "queued" ? "Waiting for the target laptop." : "No status details yet.";
}

function deliveryLabel(state: BridgeState | null) {
  if (state?.runner.mode === "codex-cli" || state?.bridge.promptDelivery === "cli") {
    return "session-send";
  }

  return state?.runner.mode ?? state?.bridge.mode ?? "ready";
}

const localImageExtensions = /\.(?:png|jpe?g|gif|webp|bmp)$/i;
const localImageLinePattern = /^((?:[a-zA-Z]:[\\/]|\\\\|\/).+\.(?:png|jpe?g|gif|webp|bmp))$/i;
const windowsImageInLinePattern = /((?:[a-zA-Z]:[\\/]|\\\\)[^\n\r]*?\.(?:png|jpe?g|gif|webp|bmp))/i;
const markdownWindowsImagePattern = /(!\[[^\]]*\]\()([a-zA-Z]:\\[^)\n]+\.(?:png|jpe?g|gif|webp|bmp))(\))/gi;

function normalizeImagePathForMarkdown(value: string) {
  return value.replace(/\\/g, "/");
}

function normalizeScreenshotMarkdown(value: string) {
  const withNormalizedImageLinks = value.replace(markdownWindowsImagePattern, (_match, open: string, imagePath: string, close: string) => {
    return `${open}${normalizeImagePathForMarkdown(imagePath)}${close}`;
  });

  return withNormalizedImageLinks
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("![")) {
        return line;
      }

      const exactPath = trimmed.match(localImageLinePattern)?.[1];
      const inlinePath = trimmed.match(windowsImageInLinePattern)?.[1];
      const imagePath = exactPath ?? inlinePath;

      if (!imagePath) {
        return line;
      }

      const indent = line.slice(0, line.indexOf(trimmed));

      return `${indent}![Screenshot](${normalizeImagePathForMarkdown(imagePath)})`;
    })
    .join("\n");
}

function localImagePathFromSrc(src: string | undefined) {
  if (!src) {
    return null;
  }

  let value = src.trim();

  try {
    value = decodeURIComponent(value);
  } catch {
    try {
      value = decodeURI(value);
    } catch {
      return null;
    }
  }

  if (value.startsWith("file://")) {
    try {
      const url = new URL(value);
      value = url.pathname;
    } catch {
      value = value.replace(/^file:\/+/i, "");
    }
  }

  value = value.replace(/\\/g, "/");

  if (/^\/[a-zA-Z]:\//.test(value)) {
    value = value.slice(1);
  }

  if (!localImageExtensions.test(value)) {
    return null;
  }

  return /^(?:[a-zA-Z]:\/|\/\/|\/)/.test(value) ? value : null;
}

function AuthenticatedImage({ src, alt, token }: { src: string | undefined; alt: string | undefined; token: string }) {
  const localPath = useMemo(() => localImagePathFromSrc(src), [src]);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!localPath) {
      setFailed(false);
      setObjectUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous);
        }

        return null;
      });
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;
    const controller = new AbortController();
    const imagePath = localPath;

    setFailed(false);
    setObjectUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }

      return null;
    });

    async function loadImage() {
      try {
        const response = await fetch(`/api/local-image?path=${encodeURIComponent(imagePath)}`, {
          headers: token ? { "x-control-token": token } : {},
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("Screenshot unavailable");
        }

        const blob = await response.blob();
        createdUrl = URL.createObjectURL(blob);

        if (cancelled) {
          URL.revokeObjectURL(createdUrl);
          return;
        }

        setObjectUrl(createdUrl);
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    }

    void loadImage();

    return () => {
      cancelled = true;
      controller.abort();

      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [localPath, token]);

  if (!localPath) {
    return <img className="chat-image" src={src} alt={alt || "Image"} loading="lazy" />;
  }

  if (failed) {
    return <span className="image-placeholder">Screenshot unavailable</span>;
  }

  if (!objectUrl) {
    return <span className="image-placeholder">Loading screenshot...</span>;
  }

  return <img className="chat-image" src={objectUrl} alt={alt || "Screenshot"} loading="lazy" />;
}

function FormattedMessage({ text, emptyText, token }: { text: string | undefined; emptyText: string; token: string }) {
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
          ),
          img: ({ src, alt }) => <AuthenticatedImage src={src} alt={alt} token={token} />
        }}
      >
        {normalizeScreenshotMarkdown(text)}
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
        {deliveryLabel(state)}
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
  const [, setNotice] = useState("");
  const [socketLive, setSocketLive] = useState(false);
  const [chatJobs, setChatJobs] = useState<Record<string, CodexRunJob[]>>({});
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [localCommandQueue, setLocalCommandQueue] = useState<LocalQueuedCommand[]>(() => readLocalCommandQueue());
  const [menuOpen, setMenuOpen] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [durationNow, setDurationNow] = useState(Date.now());
  const selectedChatIdRef = useRef<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const localQueueSendingRef = useRef(false);
  const edgeSwipeStartRef = useRef<{ x: number; y: number } | null>(null);

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
  const selectedLocalCommands = useMemo(
    () => (selectedChatId ? localCommandQueue.filter((command) => command.chatId === selectedChatId) : []),
    [localCommandQueue, selectedChatId]
  );
  const selectedQueuedJobs = useMemo(() => selectedJobs.filter((job) => job.status === "queued"), [selectedJobs]);
  const selectedQueuedLocalCommands = useMemo(
    () => selectedLocalCommands.filter((command) => command.status === "pending" || command.status === "sending"),
    [selectedLocalCommands]
  );
  const selectedJob = selectedJobs.find(isActiveJob);
  const selectedQueueCount = selectedQueuedJobs.length + selectedQueuedLocalCommands.length;
  const selectedJobDuration =
    selectedJob?.status === "running"
      ? formatElapsedSeconds(selectedJob.startedAt ?? selectedJob.createdAt, selectedJob.finishedAt, durationNow)
      : "";
  const transcriptMessages = useMemo<ChatTranscriptMessage[]>(() => {
    if (!selectedChat) {
      return [];
    }

    if ((selectedChat.messages ?? []).length) {
      return selectedChat.messages ?? [];
    }

    const fallback: ChatTranscriptMessage[] = [];

    if (selectedChat.lastPrompt) {
      fallback.push({
        id: "last-prompt",
        role: "user",
        text: selectedChat.lastPrompt.text,
        createdAt: selectedChat.lastPrompt.createdAt
      });
    }

    if (selectedChat.lastResponse) {
      fallback.push({
        id: "last-response",
        role: "assistant",
        text: selectedChat.lastResponse.text,
        createdAt: selectedChat.lastResponse.createdAt
      });
    }

    return fallback;
  }, [selectedChat]);
  const visibleMessages = transcriptMessages;
  const lastVisibleMessageId = visibleMessages.at(-1)?.id ?? "";

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
        messages: [
          ...(current.messages ?? []),
          {
            id: `optimistic-user-${Date.parse(createdAt) || Date.now()}`,
            role: "user" as const,
            text,
            createdAt
          }
        ].slice(-20),
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
    setPendingAttachments([]);
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
    if (!authenticated) {
      return;
    }

    function onTouchStart(event: TouchEvent) {
      const touch = event.touches[0];

      if (!touch || menuOpen || touch.clientX > 24) {
        edgeSwipeStartRef.current = null;
        return;
      }

      edgeSwipeStartRef.current = { x: touch.clientX, y: touch.clientY };
    }

    function onTouchMove(event: TouchEvent) {
      const start = edgeSwipeStartRef.current;
      const touch = event.touches[0];

      if (!start || !touch) {
        return;
      }

      const deltaX = touch.clientX - start.x;
      const deltaY = Math.abs(touch.clientY - start.y);

      if (deltaX > 72 && deltaY < 48) {
        setMenuOpen(true);
        edgeSwipeStartRef.current = null;
      }
    }

    function onTouchEnd() {
      edgeSwipeStartRef.current = null;
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [authenticated, menuOpen]);

  useEffect(() => {
    localStorage.setItem(collapsedProjectsKey, JSON.stringify([...collapsedProjects]));
  }, [collapsedProjects]);

  useEffect(() => {
    localStorage.setItem(localCommandQueueKey, JSON.stringify(localCommandQueue));
  }, [localCommandQueue]);

  useEffect(() => {
    if (selectedJob?.status !== "running") {
      return;
    }

    setDurationNow(Date.now());

    const interval = window.setInterval(() => {
      setDurationNow(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [selectedJob?.id, selectedJob?.status]);

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
    if (!selectedChatId || loadingDetail) {
      return;
    }

    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [lastVisibleMessageId, loadingDetail, selectedChatId]);

  useEffect(() => {
    if (composerTextareaRef.current) {
      setComposerExpanded(resizeTextareaElement(composerTextareaRef.current));
    }
  }, [draft]);

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
    let watchdogTimer: number | undefined;
    let lastSocketActivity = 0;
    let stopped = false;

    const scheduleReconnect = (delay = socketReconnectMs) => {
      if (stopped || reconnectTimer !== undefined) {
        return;
      }

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };

    const reviveSocket = () => {
      if (stopped) {
        return;
      }

      if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        setSocketLive(false);
        scheduleReconnect(0);
        return;
      }

      const staleFor = Date.now() - lastSocketActivity;
      const staleLimit = socket.readyState === WebSocket.CONNECTING ? socketConnectTimeoutMs : socketStaleMs;

      if (staleFor > staleLimit) {
        setSocketLive(false);
        socket.close();
        scheduleReconnect(250);
      }
    };

    const connect = () => {
      const nextSocket = new WebSocket(`${protocol}://${window.location.host}/ws${encodedToken}`);

      socket = nextSocket;
      lastSocketActivity = Date.now();

      nextSocket.addEventListener("open", () => {
        if (socket !== nextSocket) {
          return;
        }

        lastSocketActivity = Date.now();
        setSocketLive(true);
        void loadState();
      });
      nextSocket.addEventListener("close", () => {
        if (socket !== nextSocket) {
          return;
        }

        setSocketLive(false);

        if (!stopped) {
          scheduleReconnect();
        }
      });
      nextSocket.addEventListener("error", () => {
        if (socket !== nextSocket) {
          return;
        }

        setSocketLive(false);
        nextSocket.close();
      });
      nextSocket.addEventListener("message", (event) => {
        if (socket !== nextSocket) {
          return;
        }

        lastSocketActivity = Date.now();
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
    watchdogTimer = window.setInterval(reviveSocket, socketWatchdogMs);
    window.addEventListener("focus", reviveSocket);
    window.addEventListener("online", reviveSocket);
    document.addEventListener("visibilitychange", reviveSocket);

    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(watchdogTimer);
      window.removeEventListener("focus", reviveSocket);
      window.removeEventListener("online", reviveSocket);
      document.removeEventListener("visibilitychange", reviveSocket);
      socket?.close();
    };
  }, [authenticated, loadChatDetail, loadChatJobs, loadChats, loadState, rememberJob, token]);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadState();

      const chatId = selectedChatIdRef.current;
      if (chatId) {
        void loadChatJobs(chatId);
        void loadChatDetail(chatId, true);
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [authenticated, loadChatDetail, loadChatJobs, loadState]);

  useEffect(() => {
    if (!authenticated || !state || localQueueSendingRef.current) {
      return;
    }

    if (state.runner.activeJobs > 0 || state.runner.queuedJobs > 0) {
      return;
    }

    const nextCommand = localCommandQueue.find(isLocalCommandDue);
    if (!nextCommand) {
      return;
    }

    localQueueSendingRef.current = true;
    setLocalCommandQueue((current) =>
      current.map((command) =>
      command.id === nextCommand.id
          ? { ...command, status: "sending", retryAfter: undefined, message: "Sending to target laptop" }
          : command
      )
    );

    void apiFetch<ApiResult>(`/api/chats/${encodeURIComponent(nextCommand.chatId)}/prompt`, {
      method: "POST",
      body: JSON.stringify({ text: nextCommand.text })
    })
      .then(async (result) => {
        if (result.job) {
          rememberJob(result.job);
        }

        setLocalCommandQueue((current) => current.filter((command) => command.id !== nextCommand.id));
        setNotice(result.message ?? "Prompt queued on target laptop");
        await Promise.all([
          loadState(),
          loadChatJobs(nextCommand.chatId),
          selectedChatIdRef.current === nextCommand.chatId ? loadChatDetail(nextCommand.chatId, true) : Promise.resolve()
        ]);
      })
      .catch((error: unknown) => {
        const attempts = (nextCommand.attempts ?? 0) + 1;
        const retryDelayMs = localCommandRetryDelay(nextCommand.attempts ?? 0);
        const retryAfter = new Date(Date.now() + retryDelayMs).toISOString();
        const message =
          error instanceof Error
            ? `${error.message}; retrying in ${Math.round(retryDelayMs / 1000)}s`
            : `Could not send queued command; retrying in ${Math.round(retryDelayMs / 1000)}s`;

        setLocalCommandQueue((current) =>
          current.map((command) =>
            command.id === nextCommand.id
              ? {
                  ...command,
                  status: "pending",
                  attempts,
                  retryAfter,
                  message
                }
              : command
          )
        );
        setNotice(message);
      })
      .finally(() => {
        localQueueSendingRef.current = false;
      });
  }, [apiFetch, authenticated, loadChatDetail, loadChatJobs, loadState, localCommandQueue, rememberJob, state]);

  useEffect(() => {
    if (!authenticated || !selectedChatId || !selectedJob || !["queued", "running"].includes(selectedJob.status)) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadChats();
      void loadChatJobs(selectedChatId);
      void loadChatDetail(selectedChatId, true);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [authenticated, loadChatDetail, loadChatJobs, loadChats, selectedChatId, selectedJob]);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await verifyToken(loginToken.trim());
  }

  function addAttachments(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    const availableSlots = Math.max(0, maxAttachmentFiles - pendingAttachments.length);
    const accepted = Array.from(files).slice(0, availableSlots);
    const rejectedCount = files.length - accepted.length;
    const tooLarge = accepted.filter((file) => file.size > maxAttachmentBytes);
    const valid = accepted.filter((file) => file.size <= maxAttachmentBytes);

    if (tooLarge.length > 0) {
      setNotice(`Files must be ${formatBytes(maxAttachmentBytes)} or smaller.`);
    } else if (rejectedCount > 0) {
      setNotice(`Attach up to ${maxAttachmentFiles} files at a time.`);
    } else {
      setNotice("");
    }

    setPendingAttachments((current) => [
      ...current,
      ...valid.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(16).slice(2)}`,
        file
      }))
    ]);
  }

  function removeAttachment(id: string) {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function uploadAttachments(chatId: string) {
    if (!pendingAttachments.length) {
      return [];
    }

    const files = await Promise.all(
      pendingAttachments.map(async ({ file }) => ({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        data: await readFileAsBase64(file)
      }))
    );

    const result = await apiFetch<FileUploadResult>(`/api/chats/${encodeURIComponent(chatId)}/files`, {
      method: "POST",
      body: JSON.stringify({ files })
    });

    return result.files;
  }

  async function sendPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedChatId || (!draft.trim() && !pendingAttachments.length)) {
      return;
    }

    const optimisticAt = new Date().toISOString();
    const previousSelectedChat = selectedChat;
    const previousChatIndex = chatIndex;
    const previousAttachments = pendingAttachments;

    setSending(true);
    setNotice(pendingAttachments.length ? "Uploading files..." : "");

    try {
      const uploadedFiles = await uploadAttachments(selectedChatId);
      const promptText = promptWithUploadedFiles(draft, uploadedFiles);

      applyOptimisticPrompt(selectedChatId, promptText, optimisticAt);
      setLocalCommandQueue((current) => [
        ...current,
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          chatId: selectedChatId,
          text: promptText,
          createdAt: optimisticAt,
          status: "pending",
          message: "Waiting for previous task to finish"
        }
      ]);

      setDraft("");
      setPendingAttachments([]);
      setNotice("Queued locally; it will send after the previous task is done");
      void loadState();
      window.setTimeout(() => {
        void loadChats();
        void loadChatJobs(selectedChatId);
        void loadChatDetail(selectedChatId, true);
      }, 1600);
    } catch (error) {
      setSelectedChat(previousSelectedChat);
      setChatIndex(previousChatIndex);
      setPendingAttachments(previousAttachments);
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
    setPendingAttachments([]);
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
            <div className="chat-thread" aria-label="Recent chat messages">
              {visibleMessages.length ? (
                visibleMessages.map((message) => (
                  <article key={message.id} className={`chat-bubble is-${message.role}`}>
                    <div className="bubble-meta">
                      <span>{message.role === "user" ? "You" : "Codex"}</span>
                      <time>{formatDate(message.createdAt)}</time>
                    </div>
                    <FormattedMessage
                      text={message.text}
                      emptyText={message.role === "user" ? "No prompt text." : "No response text."}
                      token={token}
                    />
                  </article>
                ))
              ) : (
                <div className="empty-chat">
                  <Clock3 size={26} />
                </div>
              )}
              <div ref={chatEndRef} aria-hidden="true" />
            </div>
          ) : (
            <div className="empty-chat">
              <Clock3 size={26} />
            </div>
          )}
        </div>

        {selectedChat && selectedQueueCount ? (
          <section className="command-queue" aria-labelledby="command-queue-title">
            <div className="queue-header">
              <div className="queue-title">
                <ListChecks size={17} />
                <h3 id="command-queue-title">Command queue</h3>
              </div>
              <span className="queue-count">
                {selectedQueueCount ? `${selectedQueueCount} queued` : "No commands"}
              </span>
            </div>

            <div className="queue-list" aria-label="Commands for this chat">
              {selectedQueuedLocalCommands.map((command) => (
                <article key={command.id} className="queue-item is-queued">
                  <div className="queue-status-row">
                    <span className="queue-status">
                      {command.status === "sending" ? <Loader2 className="spin" size={15} /> : <Clock3 size={15} />}
                      {localCommandStatusText(command)}
                    </span>
                    <time>{formatRelative(command.createdAt)}</time>
                  </div>
                  <p className="queue-preview">{previewText(command.text, "Prompt")}</p>
                  <p className="queue-detail">{localCommandDetailText(command)}</p>
                </article>
              ))}
              {selectedQueuedJobs.map((job) => (
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
          </section>
        ) : null}

        {selectedJob && ["queued", "running"].includes(selectedJob.status) ? (
          <div className="job-strip">
            <Loader2 className={selectedJob.status === "running" ? "spin" : ""} size={16} />
            <span className="job-strip-status">
              {selectedJob.status === "running" ? "Running on target laptop" : "Queued on target laptop"}
              {selectedJob.status === "running" ? (
                <span className="job-duration" aria-label={`Elapsed ${selectedJobDuration}`}>
                  <Clock3 size={13} />
                  {selectedJobDuration}
                </span>
              ) : null}
            </span>
            <small>{selectedJob.promptPreview}</small>
          </div>
        ) : null}

        <form className={`composer ${composerExpanded ? "is-expanded" : ""}`} onSubmit={sendPrompt}>
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            multiple
            onChange={(event) => {
              addAttachments(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <div className="composer-field">
            <button
              className="attach-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!selectedChatId || sending || pendingAttachments.length >= maxAttachmentFiles}
              aria-label="Attach files"
              title="Attach files"
            >
              <Paperclip size={18} />
            </button>
            <textarea
              ref={composerTextareaRef}
              rows={1}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setComposerExpanded(resizeTextareaElement(event.currentTarget));
              }}
              placeholder="New prompt"
              spellCheck={false}
            />
            <button type="submit" disabled={!selectedChatId || (!draft.trim() && !pendingAttachments.length) || sending}>
              {sending ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
              Send
            </button>
            {pendingAttachments.length ? (
              <div className="attachment-list" aria-label="Files to send">
                {pendingAttachments.map((attachment) => (
                  <span key={attachment.id} className="attachment-chip">
                    <span className="attachment-copy">
                      <strong>{attachment.file.name}</strong>
                      <small>{formatBytes(attachment.file.size)}</small>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.id)}
                      aria-label={`Remove ${attachment.file.name}`}
                      disabled={sending}
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </form>

      </section>
    </main>
  );
}
