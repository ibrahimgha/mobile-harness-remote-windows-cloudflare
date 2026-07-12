import {
  ArrowDown,
  ArrowUp,
  ArrowRight,
  Bell,
  BellOff,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleX,
  Clock3,
  Copy,
  CornerDownLeft,
  Delete,
  Download,
  Eye,
  FileText,
  Folder,
  FolderPlus,
  GitFork,
  ListChecks,
  Loader2,
  LogOut,
  Menu,
  MessageSquarePlus,
  Mic,
  MonitorUp,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Zap,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import {
  FormEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  KeyboardEvent as ReactKeyboardEvent,
  TouchEvent as ReactTouchEvent,
  isValidElement,
  memo,
  type CSSProperties,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { mergeTranscriptWindow } from "./chatRefresh";
import { composerInputId, readChatDraft, writeChatDraft } from "./chatDrafts";
import {
  deleteTextBackward,
  insertTextAtSelection,
  normalizeTextSelection,
  type TextSelection
} from "./composerEditing";
import {
  nextLiveThinkingDelayMs,
  nextLiveThinkingStatus,
  type LiveThinkingStatus
} from "./liveThinking";
import { applySidebarOrder, captureSidebarOrder, type SidebarOrderSnapshot } from "./sidebarOrder";

type BridgeState = {
  bridge: {
    mode: "simulation" | "window-control";
    targetTitle: string;
    promptDelivery?: "cli";
    tokenRequired: boolean;
    platform: string;
  };
  server: {
    name: string;
    uptimeSeconds: number;
    clients: number;
  };
  runner: {
    mode: "codex-cli" | "simulation";
    activeJobs: number;
    queuedJobs: number;
    recentJobs: CodexRunJob[];
    settings: CodexRunSettings;
    settingsOptions: CodexRunSettingsOptions;
    usage: CodexUsage | null;
  };
};

type CodexUsageWindow = {
  usedPercent: number;
  resetsAt?: number;
};

type CodexUsage = {
  updatedAt: string;
  fiveHour?: CodexUsageWindow;
  weekly?: CodexUsageWindow;
};

type CodexRunSettings = {
  model: string;
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  speed: "default" | "priority";
  updatedAt: string;
};

type CodexModelCapability = {
  model: string;
  label: string;
  description?: string;
  reasoningEfforts: CodexRunSettings["reasoningEffort"][];
  defaultReasoningEffort: CodexRunSettings["reasoningEffort"];
  speeds: CodexRunSettings["speed"][];
};

type CodexRunSettingsOptions = {
  models: string[];
  reasoningEfforts: CodexRunSettings["reasoningEffort"][];
  speeds: CodexRunSettings["speed"][];
  modelCapabilities?: Record<string, CodexModelCapability>;
};

type BridgeEvent = {
  type: "action" | "error" | "status";
  message: string;
  detail?: {
    action?: string;
    chatId?: string;
    pendingId?: string;
    status?: string;
    chat?: ChatDetail;
    job?: CodexRunJob;
  };
};

type CodexRunJob = {
  id: string;
  chatId: string;
  projectPath: string;
  status: "queued" | "running" | "completed" | "failed" | "stopped";
  kind?: "prompt" | "steer";
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
  settings?: CodexRunSettings;
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
  role: "user" | "assistant" | "tool" | "system";
  kind?:
    | "user_prompt"
    | "assistant_commentary"
    | "assistant_final"
    | "tool_call"
    | "tool_output"
    | "error"
    | "task_complete"
    | "forked_from"
    | "voice_note";
  isFinal?: boolean;
  label?: string;
  toolName?: string;
  callId?: string;
  status?: string;
  durationMs?: number;
  voiceNoteUrl?: string;
  voiceNoteMimeType?: string;
  model?: string;
  reasoningEffort?: CodexRunSettings["reasoningEffort"];
};

type VisibleChatMessage = ChatTranscriptMessage & {
  isRunFailure?: boolean;
  isLiveThinking?: boolean;
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
  messagePage?: {
    visibleTurns: number;
    totalTurns: number;
    hasMore: boolean;
  };
  hasResponse: boolean;
};

type CachedChatHistory = {
  chat: ChatDetail;
  cachedAt: string;
  mode?: ChatMessageViewMode;
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

type ProjectChatStartResult = {
  ok: boolean;
  accepted?: boolean;
  pendingId?: string;
  status?: "pending" | "completed" | "failed";
  message?: string;
  root?: string;
  folderName?: string;
  projectPath: string;
  projectName?: string;
  createdAt?: string;
  updatedAt?: string;
  chat?: ChatDetail;
  logPaths?: {
    stdout: string;
    stderr: string;
    lastMessage: string;
  };
  error?: string;
};

type ChatMutationResult = {
  ok: boolean;
  message?: string;
  sourceChatId?: string;
  sessionPath?: string;
  chat: ChatDetail;
};

type ApiResult = {
  ok: boolean;
  message?: string;
  state?: BridgeState;
  job?: CodexRunJob;
};

type PromptSubmitResult = ApiResult & {
  disposition?: "started" | "queued";
};

type ChatJobsResult = {
  ok: boolean;
  chatId: string;
  jobs: CodexRunJob[];
};

type QueuedPromptMutationResult = ApiResult & {
  chatId: string;
  job: CodexRunJob;
  stoppedJob?: CodexRunJob;
  text?: string;
};

type RunSettingsResult = {
  ok: boolean;
  settings: CodexRunSettings;
  options: CodexRunSettingsOptions;
};

type PendingAttachment = {
  id: string;
  file: File;
};

type AttachmentUploadStatus = {
  status: "idle" | "uploading" | "uploaded" | "failed";
  progress: number;
  message?: string;
  uploadedFile?: UploadedPromptFile;
};

type FileUploadChunkResult = {
  ok: boolean;
  complete: boolean;
  receivedBytes?: number;
  file?: UploadedPromptFile;
  files?: UploadedPromptFile[];
  message?: string;
};

type DictationVoiceNote = {
  url: string;
  mimeType: string;
};

type SpeechRecognitionAlternativeLike = {
  transcript: string;
  confidence?: number;
};

type SpeechRecognitionResultLike = ArrayLike<SpeechRecognitionAlternativeLike> & {
  isFinal: boolean;
};

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type DictationCleanupResult = {
  ok: boolean;
  text?: string;
  source?: "codex" | "browser";
  message?: string;
};

type PromptReceipt = {
  id: string;
  chatId: string;
  status: "sending" | "received";
  promptPreview: string;
  message: string;
  createdAt: string;
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

type ShortcutInstructionFile = {
  name: string;
  path: string;
  relativePath: string;
  mediaUrl: string;
  size: number;
  updatedAt: string;
  content: string;
};

type SelectedLocalPdfFile = {
  path: string;
  label: string;
  mediaUrl: string;
  downloadUrl: string;
};

type ShortcutInstructionsResult = {
  ok: boolean;
  root: string;
  files: ShortcutInstructionFile[];
  loadedAt: string;
};

type PushPublicKeyResult = {
  ok: boolean;
  publicKey: string;
  subscriptions: number;
};

type PushTestResult = {
  ok: boolean;
  result: {
    attempted: number;
    sent: number;
    removed: number;
    failed: number;
  };
};

type RemoteNotificationState = "unsupported" | "default" | "denied" | "enabled" | "local";
type ChatMessageViewMode = "final" | "codex";

const tokenKey = "control-token";
const collapsedProjectsKey = "collapsed-projects";
const legacyChatHistoryCacheKeys = ["chat-history-cache-v1"];
const chatHistoryCacheKey = "chat-history-cache-v3";
const activeJobsCacheKey = "active-jobs-cache-v1";
const selectedChatIdKey = "selected-chat-id";
const chatMessageViewModesKey = "chat-message-view-modes-v1";
const defaultChatMessageViewMode: ChatMessageViewMode = "codex";
const chatMessageViewModeOrder: ChatMessageViewMode[] = ["codex", "final"];
const maxCachedChatHistories = 20;
const maxCachedChatStorageBytes = 2 * 1024 * 1024;
const maxCachedChatBytes = 160 * 1024;
const maxCachedMessageTextLength = 16000;
const defaultChatTurns = 10;
const chatTurnPageSize = 10;
const maxAttachmentFiles = 5;
const maxAttachmentBytes = 512 * 1024 * 1024;
const maxAttachmentTotalBytes = 1024 * 1024 * 1024;
const attachmentChunkBytes = 8 * 1024 * 1024;
const shortcutInstructionSyncIntervalMs = 3000;
const backgroundSyncIntervalMs = 5000;
const activeJobSyncIntervalMs = 4000;
const socketReconnectMs = 1500;
const socketWatchdogMs = 5000;
const socketConnectTimeoutMs = 12000;
const socketStaleMs = 45000;
const queuedJobMoveNextGuardMs = 1500;

function isTemporaryChatId(chatId: string | null | undefined) {
  return Boolean(chatId && (chatId.startsWith("optimistic-fork-") || chatId.startsWith("pending-chat-")));
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isChatMessageViewMode(value: unknown): value is ChatMessageViewMode {
  return value === "final" || value === "codex";
}

function readChatMessageViewModes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(chatMessageViewModesKey) ?? "{}");

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, ChatMessageViewMode] => {
        const [chatId, mode] = entry;
        return typeof chatId === "string" && isChatMessageViewMode(mode);
      })
    );
  } catch {
    return {};
  }
}

function chatMessageViewModeMeta(mode: ChatMessageViewMode) {
  if (mode === "final") {
    return {
      label: "Final",
      title: "Latest update, then final response",
      description: "Shows one live Thinking update while Codex runs, then only the final response."
    };
  }

  if (mode === "codex") {
    return {
      label: "Codex",
      title: "Codex updates",
      description: "Showing prompts, Codex updates, final Codex responses, and run separators. Tool chatter is hidden."
    };
  }

  return chatMessageViewModeMeta(defaultChatMessageViewMode);
}

function nextChatMessageViewMode(mode: ChatMessageViewMode) {
  const index = chatMessageViewModeOrder.indexOf(mode);

  return chatMessageViewModeOrder[(index + 1) % chatMessageViewModeOrder.length];
}

function isFinalCodexMessage(message: ChatTranscriptMessage | VisibleChatMessage) {
  return (
    message.role === "assistant" &&
    (message.isFinal || message.kind === "assistant_final" || !message.kind)
  );
}

function messageVisibleForViewMode(message: VisibleChatMessage, mode: ChatMessageViewMode) {
  if (message.isRunFailure || message.role === "user" || message.kind === "task_complete" || message.kind === "forked_from") {
    return true;
  }

  if (mode === "final") {
    return isFinalCodexMessage(message);
  }

  return message.role === "assistant";
}

function messagesForViewMode(
  messages: VisibleChatMessage[],
  mode: ChatMessageViewMode,
  activeJob: CodexRunJob | undefined
) {
  if (mode === "codex") {
    return messages.filter((message) => messageVisibleForViewMode(message, mode));
  }

  const settledMessages = messages.filter(
    (message) =>
      message.isRunFailure ||
      message.role === "user" ||
      message.kind === "task_complete" ||
      message.kind === "forked_from" ||
      isFinalCodexMessage(message)
  );

  // Transcript order remains reliable when websocket job state arrives late or is
  // lost across a service/PWA restart, so use the latest turn as the authority.
  let latestPromptIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestPromptIndex = index;
      break;
    }
  }
  const latestTurnMessages = latestPromptIndex >= 0 ? messages.slice(latestPromptIndex + 1) : [];
  const finalArrived = latestTurnMessages.some(isFinalCodexMessage);

  if (finalArrived) {
    return settledMessages;
  }

  const latestUpdate = [...latestTurnMessages]
    .reverse()
    .find((message) => message.role === "assistant" && !isFinalCodexMessage(message));

  if (!latestUpdate && activeJob?.status !== "running") {
    return settledMessages;
  }

  const latestPrompt = latestPromptIndex >= 0 ? messages[latestPromptIndex] : undefined;
  const thinkingId = activeJob?.id ?? (latestPrompt ? stableHash(chatMessageStableSignature(latestPrompt)) : "latest-turn");
  const thinkingMessage: VisibleChatMessage = latestUpdate
    ? { ...latestUpdate, id: `live-thinking-${thinkingId}`, label: "Thinking", isLiveThinking: true }
    : {
        id: `live-thinking-${thinkingId}`,
        role: "assistant",
        kind: "assistant_commentary",
        label: "Thinking",
        text: "",
        createdAt: activeJob?.startedAt ?? activeJob?.createdAt ?? new Date().toISOString(),
        isLiveThinking: true
      };

  return [...settledMessages, thinkingMessage];
}

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

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function messageAgeSeconds(createdAt: string, nowMs: number) {
  const createdMs = Date.parse(createdAt);
  return Number.isFinite(createdMs) ? Math.max(0, Math.floor((nowMs - createdMs) / 1000)) : 0;
}

function formatMessageAge(createdAt: string, nowMs: number) {
  const totalSeconds = messageAgeSeconds(createdAt, nowMs);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function messageRunSettingsLabel(message: VisibleChatMessage, options: CodexRunSettingsOptions | undefined) {
  if (!message.model && !message.reasoningEffort) {
    return "";
  }

  const modelLabel = message.model
    ? options?.modelCapabilities?.[message.model]?.label ?? settingLabel(message.model)
    : "Default";
  const reasoningLabel = message.reasoningEffort ? settingLabel(message.reasoningEffort) : "Default";
  return `${modelLabel} · ${reasoningLabel}`;
}

function responseRunDuration(messages: ChatTranscriptMessage[], responseIndex: number) {
  const response = messages[responseIndex];

  if (!response || response.role !== "assistant" || response.kind === "assistant_commentary") {
    return "";
  }

  for (let index = responseIndex - 1; index >= 0; index -= 1) {
    const prompt = messages[index];

    if (prompt.role === "user") {
      return formatElapsedSeconds(prompt.createdAt, response.createdAt, Date.parse(response.createdAt));
    }
  }

  return "";
}

function formatDurationMs(durationMs: number | undefined) {
  if (!Number.isFinite(durationMs) || !durationMs) {
    return "";
  }

  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function separatorText(message: ChatTranscriptMessage) {
  if (message.kind === "forked_from") {
    return `${message.text || "Forked from source chat"} at ${formatDate(message.createdAt)}`;
  }

  if (message.kind === "task_complete") {
    const completeDuration = formatDurationMs(message.durationMs);
    return completeDuration ? `Run complete ${completeDuration}` : "Run complete";
  }

  return message.text;
}

function chatMessageEmptyText(message: VisibleChatMessage) {
  if (message.role === "user") {
    return "No prompt text.";
  }

  if (message.role === "tool") {
    return "No tool details.";
  }

  if (message.role === "system") {
    return "No system details.";
  }

  return "No response text.";
}

function chatMessageClassName(message: VisibleChatMessage) {
  return [
    "chat-bubble",
    `is-${message.role}`,
    message.kind ? `is-${message.kind}` : "",
    message.isLiveThinking ? "is-live-thinking" : "",
    message.isRunFailure || message.kind === "error" ? "is-error" : ""
  ]
    .filter(Boolean)
    .join(" ");
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

function cleanDictatedPrompt(text: string) {
  return text
    .replace(/\bnew line\b/gi, "\n")
    .replace(/\bnew paragraph\b/gi, "\n\n")
    .replace(/\bcomma\b/gi, ",")
    .replace(/\bperiod\b/gi, ".")
    .replace(/\bfull stop\b/gi, ".")
    .replace(/\bquestion mark\b/gi, "?")
    .replace(/\bexclamation mark\b/gi, "!")
    .replace(/\s+([,.?!])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bestSpeechRecognitionTranscript(result: SpeechRecognitionResultLike | undefined) {
  if (!result?.length) {
    return "";
  }

  let best = result[0];
  for (let index = 1; index < result.length; index += 1) {
    const candidate = result[index];
    if ((candidate?.confidence ?? -1) > (best?.confidence ?? -1)) {
      best = candidate;
    }
  }

  return best?.transcript?.trim() ?? "";
}

function speechRecognitionConstructor() {
  const candidate = window as typeof window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };

  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition;
}

function supportedAudioMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }

  return ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm"].find((type) =>
    MediaRecorder.isTypeSupported(type)
  ) ?? "";
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

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read audio recording")));
    reader.readAsDataURL(blob);
  });
}

function queuedJobCanMoveNext(queuedJob: CodexRunJob, job: CodexRunJob | undefined, nowMs: number) {
  const createdMs = Date.parse(queuedJob.createdAt);
  const oldEnough = Number.isFinite(createdMs) ? nowMs - createdMs >= queuedJobMoveNextGuardMs : true;

  return queuedJob.status === "queued" && job?.status === "running" && oldEnough;
}

function optimisticPromptId(createdAt: string) {
  return `optimistic-user-${Date.parse(createdAt) || Date.now()}`;
}

function optimisticVoiceNoteId(createdAt: string) {
  return `optimistic-voice-${Date.parse(createdAt) || Date.now()}`;
}

function isOptimisticPromptMessage(message: ChatTranscriptMessage) {
  return message.role === "user" && message.id.startsWith("optimistic-user-");
}

function isOptimisticVoiceNoteMessage(message: ChatTranscriptMessage) {
  return message.kind === "voice_note" && message.id.startsWith("optimistic-voice-");
}

function isPersistentVoiceNoteMessage(message: ChatTranscriptMessage) {
  return isOptimisticVoiceNoteMessage(message) && Boolean(message.voiceNoteUrl?.startsWith("data:"));
}

function createOptimisticPromptMessages(
  text: string,
  createdAt: string,
  messageId = optimisticPromptId(createdAt),
  voiceNote?: DictationVoiceNote
) {
  const messages: ChatTranscriptMessage[] = [];

  if (voiceNote) {
    messages.push({
      id: optimisticVoiceNoteId(createdAt),
      role: "user" as const,
      kind: "voice_note",
      label: "Voice note",
      text: "Voice note",
      createdAt,
      voiceNoteUrl: voiceNote.url,
      voiceNoteMimeType: voiceNote.mimeType
    });
  }

  messages.push({
    id: messageId,
    role: "user" as const,
    kind: "user_prompt",
    label: voiceNote ? "Transcribed prompt" : "You",
    text,
    createdAt
  });

  return messages;
}

function findServerPromptMatchIndex(messages: ChatTranscriptMessage[], optimistic: ChatTranscriptMessage) {
  const optimisticTime = Date.parse(optimistic.createdAt);

  return messages.findIndex((message) => {
    if (message.role !== "user" || message.text.trimEnd() !== optimistic.text.trimEnd()) {
      return false;
    }

    const messageTime = Date.parse(message.createdAt);

    if (!Number.isFinite(optimisticTime) || !Number.isFinite(messageTime)) {
      return true;
    }

    return messageTime >= optimisticTime - 60000;
  });
}

function dedupeMessagesById(messages: ChatTranscriptMessage[]) {
  return [...messages.reduce((byId, message) => byId.set(message.id, message), new Map<string, ChatTranscriptMessage>()).values()];
}

function messagesRepresentSameTranscriptItem(a: ChatTranscriptMessage, b: ChatTranscriptMessage) {
  return (
    a.id === b.id ||
    (a.createdAt === b.createdAt && chatMessageStableSignature(a) === chatMessageStableSignature(b))
  );
}

function mergeChatDetailPreservingOptimistic(
  current: ChatDetail | null,
  incoming: ChatDetail,
  preserveExistingMessages = false
) {
  if (!current || current.id !== incoming.id) {
    return incoming;
  }

  const incomingMessages = [...(incoming.messages ?? [])];
  let replacedOptimisticPrompt = false;
  const optimisticMessages = (current.messages ?? []).filter((message) => {
    if (isOptimisticVoiceNoteMessage(message)) {
      return true;
    }

    if (!isOptimisticPromptMessage(message)) {
      return false;
    }

    const matchingPromptIndex = findServerPromptMatchIndex(incomingMessages, message);

    if (matchingPromptIndex >= 0) {
      const serverMessage = incomingMessages[matchingPromptIndex];

      // Keep the optimistic prompt's render identity after the server echo arrives.
      // Replacing it with a fresh transcript node during polling makes iOS PWAs jump
      // upward a few seconds after send, especially while the keyboard/composer is active.
      incomingMessages[matchingPromptIndex] = {
        ...serverMessage,
        id: message.id,
        createdAt: message.createdAt,
        label: message.label ?? serverMessage.label
      };
      replacedOptimisticPrompt = true;
      return false;
    }

    return true;
  });

  const mergedWindow = preserveExistingMessages
    ? mergeTranscriptWindow(current.messages ?? [], incomingMessages, messagesRepresentSameTranscriptItem)
    : incomingMessages;
  const preservedMessageCount = Math.max(0, mergedWindow.length - incomingMessages.length);
  const messages = dedupeMessagesById([...mergedWindow, ...optimisticMessages])
    .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
  const lastOptimisticPrompt = optimisticMessages.filter(isOptimisticPromptMessage).at(-1);

  if (!lastOptimisticPrompt && !preservedMessageCount) {
    return replacedOptimisticPrompt ? { ...incoming, messages } : incoming;
  }

  const lastResponseTime = incoming.lastResponse ? Date.parse(incoming.lastResponse.createdAt) || 0 : 0;
  const lastPromptTime = lastOptimisticPrompt ? Date.parse(lastOptimisticPrompt.createdAt) || 0 : 0;

  return {
    ...incoming,
    updatedAt:
      lastOptimisticPrompt && lastPromptTime > (Date.parse(incoming.updatedAt) || 0)
        ? lastOptimisticPrompt.createdAt
        : incoming.updatedAt,
    lastPrompt:
      lastOptimisticPrompt && lastPromptTime >= lastResponseTime
        ? { text: lastOptimisticPrompt.text, createdAt: lastOptimisticPrompt.createdAt }
        : incoming.lastPrompt,
    lastResponse: lastOptimisticPrompt && lastPromptTime >= lastResponseTime ? null : incoming.lastResponse,
    messages,
    hasResponse: lastOptimisticPrompt && lastPromptTime >= lastResponseTime ? false : incoming.hasResponse
  };
}

function sameChatDetailForRender(a: ChatDetail | null, b: ChatDetail) {
  if (!a || a.id !== b.id) {
    return false;
  }

  if (
    a.title !== b.title ||
    a.projectName !== b.projectName ||
    a.projectPath !== b.projectPath ||
    a.createdAt !== b.createdAt ||
    a.updatedAt !== b.updatedAt ||
    a.hasResponse !== b.hasResponse ||
    (a.lastPrompt?.text ?? "") !== (b.lastPrompt?.text ?? "") ||
    (a.lastPrompt?.createdAt ?? "") !== (b.lastPrompt?.createdAt ?? "") ||
    (a.lastResponse?.text ?? "") !== (b.lastResponse?.text ?? "") ||
    (a.lastResponse?.createdAt ?? "") !== (b.lastResponse?.createdAt ?? "") ||
    (a.messagePage?.visibleTurns ?? defaultChatTurns) !== (b.messagePage?.visibleTurns ?? defaultChatTurns) ||
    (a.messagePage?.totalTurns ?? 0) !== (b.messagePage?.totalTurns ?? 0) ||
    Boolean(a.messagePage?.hasMore) !== Boolean(b.messagePage?.hasMore)
  ) {
    return false;
  }

  if ((a.messages ?? []).length !== (b.messages ?? []).length) {
    return false;
  }

  return (a.messages ?? []).every((message, index) => {
    const other = b.messages[index];

    return (
      other &&
      message.id === other.id &&
      message.role === other.role &&
      message.kind === other.kind &&
      message.createdAt === other.createdAt &&
      message.text === other.text &&
      (message.label ?? "") === (other.label ?? "") &&
      (message.toolName ?? "") === (other.toolName ?? "") &&
      (message.callId ?? "") === (other.callId ?? "") &&
      (message.status ?? "") === (other.status ?? "") &&
      (message.durationMs ?? 0) === (other.durationMs ?? 0) &&
      (message.voiceNoteUrl ?? "") === (other.voiceNoteUrl ?? "") &&
      (message.voiceNoteMimeType ?? "") === (other.voiceNoteMimeType ?? "") &&
      Boolean(message.isFinal) === Boolean(other.isFinal)
    );
  });
}

function sameChatDetailForQuietRefresh(a: ChatDetail | null, b: ChatDetail) {
  if (!a || a.id !== b.id) {
    return false;
  }

  if (
    a.title !== b.title ||
    a.projectName !== b.projectName ||
    a.projectPath !== b.projectPath
  ) {
    return false;
  }

  if ((a.messages ?? []).length !== (b.messages ?? []).length) {
    return false;
  }

  return (a.messages ?? []).every((message, index) => {
    const other = b.messages[index];

    return (
      other &&
      chatMessageStableSignature(message) === chatMessageStableSignature(other)
    );
  });
}

function jobStableSignature(job: CodexRunJob) {
  return [
    job.id,
    job.chatId,
    job.status,
    job.kind ?? "",
    job.queuePosition ?? "",
    job.createdAt,
    job.promptPreview,
    job.textLength,
    job.startedAt ?? "",
    job.finishedAt ?? "",
    job.exitCode ?? "",
    job.message ?? "",
    job.heartbeat ?? "",
    job.codexTranscript?.message ?? "",
    job.settings?.model ?? "",
    job.settings?.reasoningEffort ?? "",
    job.settings?.speed ?? ""
  ].join("\u001f");
}

function sameJobsForRender(a: CodexRunJob[] | undefined, b: CodexRunJob[]) {
  const current = a ?? [];

  if (current.length !== b.length) {
    return false;
  }

  return current.every((job, index) => jobStableSignature(job) === jobStableSignature(b[index]));
}

function stableHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function chatMessageStableSignature(message: ChatTranscriptMessage | VisibleChatMessage) {
  return [
    message.role,
    message.kind ?? "",
    message.text,
    message.label ?? "",
    message.toolName ?? "",
    message.callId ?? "",
    message.voiceNoteUrl ?? "",
    message.voiceNoteMimeType ?? "",
    message.isFinal ? "final" : ""
  ].join("\u001f");
}

function chatMessageStableRenderKey(message: ChatTranscriptMessage | VisibleChatMessage, occurrence: number) {
  return `${message.role}-${message.kind ?? "message"}-${stableHash(chatMessageStableSignature(message))}-${occurrence}`;
}

function formatShortcutInstructions(files: ShortcutInstructionFile[]) {
  return files
    .map((file) => `# ${file.relativePath}\n${file.content.trimEnd()}`)
    .join("\n\n---\n\n");
}

function readCachedActiveJobs(): Record<string, CodexRunJob[]> {
  try {
    const parsed = JSON.parse(localStorage.getItem(activeJobsCacheKey) ?? "{}") as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const result: Record<string, CodexRunJob[]> = {};

    for (const [chatId, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) {
        continue;
      }

      const jobs = value.filter((job): job is CodexRunJob => {
        if (!job || typeof job !== "object") {
          return false;
        }

        const candidate = job as Partial<CodexRunJob>;
        return (
          candidate.chatId === chatId &&
          typeof candidate.id === "string" &&
          typeof candidate.createdAt === "string" &&
          typeof candidate.promptPreview === "string" &&
          (candidate.status === "queued" || candidate.status === "running")
        );
      });

      if (jobs.length) {
        result[chatId] = sortJobsForChat(jobs).slice(0, 8);
      }
    }

    return result;
  } catch {
    return {};
  }
}

function writeCachedActiveJobs(chatJobs: Record<string, CodexRunJob[]>, recentJobs: CodexRunJob[] = []) {
  const result: Record<string, CodexRunJob[]> = {};
  const addJob = (job: CodexRunJob) => {
    if (!isActiveJob(job)) {
      return;
    }

    result[job.chatId] = mergeJobsForChat(result[job.chatId] ?? [], [job]).filter(isActiveJob).slice(0, 8);
  };

  for (const jobs of Object.values(chatJobs)) {
    for (const job of jobs) {
      addJob(job);
    }
  }

  for (const job of recentJobs) {
    addJob(job);
  }

  try {
    localStorage.setItem(activeJobsCacheKey, JSON.stringify(result));
  } catch {
    return;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isCachedChatDetail(value: unknown): value is ChatDetail {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.projectName === "string" &&
    typeof value.projectPath === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.messages)
  );
}

function cachedAtMs(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cachedChatMode(item: CachedChatHistory): ChatMessageViewMode {
  return isChatMessageViewMode(item.mode) ? item.mode : "codex";
}

function cachedChatCanSatisfyMode(item: CachedChatHistory, mode: ChatMessageViewMode) {
  const cachedMode = cachedChatMode(item);

  return cachedMode === mode || (cachedMode === "codex" && mode === "final") || (cachedMode === "final" && mode === "codex");
}

function readCachedChatHistories(): CachedChatHistory[] {
  try {
    const raw = localStorage.getItem(chatHistoryCacheKey) ?? "[]";

    if (raw.length > maxCachedChatStorageBytes) {
      localStorage.removeItem(chatHistoryCacheKey);
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (item): item is CachedChatHistory =>
          isRecord(item) && isCachedChatDetail(item.chat) && typeof item.cachedAt === "string"
      )
      .sort((a, b) => cachedAtMs(b.cachedAt) - cachedAtMs(a.cachedAt))
      .slice(0, maxCachedChatHistories);
  } catch {
    return [];
  }
}

function getCachedChatHistory(chatId: string, mode: ChatMessageViewMode = defaultChatMessageViewMode) {
  return readCachedChatHistories().find((item) => item.chat.id === chatId && cachedChatCanSatisfyMode(item, mode))?.chat ?? null;
}

function newestCachedChatHistory() {
  return readCachedChatHistories()[0]?.chat ?? null;
}

function trimCachedMessage(message: ChatTranscriptMessage): ChatTranscriptMessage {
  const text =
    message.text.length > maxCachedMessageTextLength
      ? `${message.text.slice(0, maxCachedMessageTextLength)}\n\n[Cached preview truncated. Refresh this chat for the full message.]`
      : message.text;

  return {
    ...message,
    text,
    voiceNoteUrl: undefined,
    voiceNoteMimeType: undefined
  };
}

function cacheableChatDetail(chat: ChatDetail): ChatDetail {
  const cacheable: ChatDetail = {
    ...chat,
    lastPrompt: chat.lastPrompt
      ? {
          ...chat.lastPrompt,
          text:
            chat.lastPrompt.text.length > maxCachedMessageTextLength
              ? `${chat.lastPrompt.text.slice(0, maxCachedMessageTextLength)}\n\n[Cached preview truncated. Refresh this chat for the full prompt.]`
              : chat.lastPrompt.text
        }
      : null,
    lastResponse: chat.lastResponse
      ? {
          ...chat.lastResponse,
          text:
            chat.lastResponse.text.length > maxCachedMessageTextLength
              ? `${chat.lastResponse.text.slice(0, maxCachedMessageTextLength)}\n\n[Cached preview truncated. Refresh this chat for the full response.]`
              : chat.lastResponse.text
        }
      : null,
    messages: (chat.messages ?? [])
      .filter((message) => !isOptimisticVoiceNoteMessage(message))
      .slice(-20)
      .map(trimCachedMessage)
  };

  let serialized = JSON.stringify(cacheable);

  if (serialized.length <= maxCachedChatBytes) {
    return cacheable;
  }

  const compact = {
    ...cacheable,
    messages: cacheable.messages.slice(-8)
  };
  serialized = JSON.stringify(compact);

  if (serialized.length <= maxCachedChatBytes) {
    return compact;
  }

  return {
    ...compact,
    messages: compact.messages.slice(-4).map((message) => ({
      ...message,
      text:
        message.text.length > 4000
          ? `${message.text.slice(0, 4000)}\n\n[Cached preview truncated. Refresh this chat for the full message.]`
          : message.text
    }))
  };
}

function cleanupLegacyChatHistoryCache() {
  try {
    for (const key of legacyChatHistoryCacheKeys) {
      localStorage.removeItem(key);
    }
  } catch {
    return;
  }
}

function readStoredSelectedChatId() {
  try {
    const value = localStorage.getItem(selectedChatIdKey)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

function rememberSelectedChatId(chatId: string | null) {
  try {
    if (isTemporaryChatId(chatId)) {
      return;
    }

    if (chatId) {
      localStorage.setItem(selectedChatIdKey, chatId);
      return;
    }

    localStorage.removeItem(selectedChatIdKey);
  } catch {
    return;
  }
}

function rememberCachedChatHistory(chat: ChatDetail, mode: ChatMessageViewMode = defaultChatMessageViewMode) {
  const cacheableChat = cacheableChatDetail(chat);
  let next = [
    { chat: cacheableChat, mode, cachedAt: new Date().toISOString() },
    ...readCachedChatHistories().filter((item) => !(item.chat.id === chat.id && cachedChatMode(item) === mode))
  ]
    .sort((a, b) => cachedAtMs(b.cachedAt) - cachedAtMs(a.cachedAt))
    .slice(0, maxCachedChatHistories);

  try {
    while (next.length > 1 && JSON.stringify(next).length > maxCachedChatStorageBytes) {
      next = next.slice(0, -1);
    }

    localStorage.setItem(chatHistoryCacheKey, JSON.stringify(next));
  } catch {
    try {
      localStorage.setItem(chatHistoryCacheKey, JSON.stringify(next.slice(0, Math.floor(maxCachedChatHistories / 2))));
    } catch {
      return;
    }
  }
}

function removeCachedChatHistory(chatId: string) {
  try {
    localStorage.setItem(
      chatHistoryCacheKey,
      JSON.stringify(readCachedChatHistories().filter((item) => item.chat.id !== chatId))
    );
  } catch {
    return;
  }
}

function summaryFromChat(chat: ChatDetail): ChatSummary {
  return {
    id: chat.id,
    title: chat.title,
    projectName: chat.projectName,
    projectPath: chat.projectPath,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    lastPromptPreview: previewText(chat.lastPrompt?.text ?? "", "No prompt yet"),
    lastResponsePreview: previewText(chat.lastResponse?.text ?? "", "No response yet"),
    hasResponse: chat.hasResponse
  };
}

function chatIndexContainsChat(index: ChatIndex, chatId: string) {
  return index.projects.some((project) => project.chats.some((chat) => chat.id === chatId));
}

function composerShouldExpand(element: HTMLElement) {
  const styles = window.getComputedStyle(element);
  const minHeight = Number.parseFloat(styles.minHeight) || 44;

  return element.scrollHeight > minHeight + 6 || Boolean(element.textContent?.includes("\n"));
}

function rawTextFromComposerEditor(element: HTMLElement) {
  const customKeyboard = element.dataset.customKeyboard === "true";
  const source = customKeyboard ? (element.textContent ?? "") : element.innerText;
  const text = source.replace(/\u00a0/g, " ").replace(/\r\n/g, "\n");
  return customKeyboard ? text : text.replace(/\n$/, "");
}

function syncComposerEditorText(element: HTMLElement, text: string) {
  const currentText = rawTextFromComposerEditor(element);
  if (currentText === text) {
    return;
  }

  const onlyChild = element.childNodes.length === 1 ? element.firstChild : null;
  if (onlyChild instanceof Text) {
    const nodeText = onlyChild.data;
    let prefixLength = 0;
    const sharedLength = Math.min(nodeText.length, text.length);
    while (prefixLength < sharedLength && nodeText[prefixLength] === text[prefixLength]) {
      prefixLength += 1;
    }

    let oldSuffixStart = nodeText.length;
    let newSuffixStart = text.length;
    while (
      oldSuffixStart > prefixLength &&
      newSuffixStart > prefixLength &&
      nodeText[oldSuffixStart - 1] === text[newSuffixStart - 1]
    ) {
      oldSuffixStart -= 1;
      newSuffixStart -= 1;
    }

    onlyChild.replaceData(
      prefixLength,
      oldSuffixStart - prefixLength,
      text.slice(prefixLength, newSuffixStart)
    );
    return;
  }

  element.textContent = text;
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

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);

  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }

  return output;
}

function supportsServiceWorkerNotifications() {
  return "serviceWorker" in navigator && "Notification" in window;
}

function supportsPushNotifications() {
  return supportsServiceWorkerNotifications() && "PushManager" in window;
}

function pushKeysMatch(existingKey: ArrayBuffer | null, publicKey: string) {
  if (!existingKey) {
    return true;
  }

  const existing = new Uint8Array(existingKey);
  const expected = urlBase64ToUint8Array(publicKey);

  if (existing.length !== expected.length) {
    return false;
  }

  return existing.every((value, index) => value === expected[index]);
}

async function getFreshPushSubscription(registration: ServiceWorkerRegistration, publicKey: string) {
  let subscription = await registration.pushManager.getSubscription();

  if (subscription && !pushKeysMatch(subscription.options.applicationServerKey, publicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }

  return subscription;
}

function projectNameFromPath(projectPath: string) {
  const parts = projectPath.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || "Codex";
}

function completionNotificationCopy(
  job: CodexRunJob,
  chat?: Pick<ChatDetail, "projectName" | "title"> | null
) {
  const projectName = chat?.projectName?.replace(/\s+/g, " ").trim() || projectNameFromPath(job.projectPath);
  const chatName = chat?.title?.replace(/\s+/g, " ").trim() || previewText(job.promptPreview, `Chat ${job.chatId.slice(0, 8)}`);

  return {
    title: projectName,
    body: `${chatName} · ${job.status === "completed" ? "Done" : "Failed"}`
  };
}

function notificationLabel(status: RemoteNotificationState) {
  if (status === "enabled") {
    return "Notify on";
  }

  if (status === "local") {
    return "Local notify";
  }

  if (status === "denied") {
    return "Notify blocked";
  }

  if (status === "unsupported") {
    return "No notify";
  }

  return "Notify";
}

function isActiveJob(job: CodexRunJob | undefined) {
  return job?.status === "queued" || job?.status === "running";
}

function sortJobsForChat(jobs: CodexRunJob[]) {
  const activeRank: Record<CodexRunJob["status"], number> = {
    running: 0,
    queued: 1,
    failed: 2,
    stopped: 3,
    completed: 4
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

  if (job.status === "stopped") {
    return "Stopped";
  }

  return "Completed";
}

function jobDetailText(job: CodexRunJob) {
  if (job.status === "stopped") {
    return job.message ?? "Stopped from the remote for this chat.";
  }

  if (job.status === "failed" && job.message) {
    return job.message;
  }

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
const localTextFileExtensions = /\.(?:md|markdown|txt|log|json|jsonl|ya?ml|toml|ini|csv|tsv)(?::\d+(?::\d+)?)?$/i;
const localPdfFileExtensions = /\.pdf(?::\d+(?::\d+)?)?$/i;
const localDownloadableFileExtensions = /\.(?:[a-z0-9][a-z0-9_-]{0,15})(?::\d+(?::\d+)?)?$/i;
const localImageLinePattern = /^((?:[a-zA-Z]:[\\/]|\\\\|\/).+\.(?:png|jpe?g|gif|webp|bmp))$/i;
const markdownWindowsImagePattern = /(!\[[^\]]*\]\()([a-zA-Z]:\\[^)\n]+\.(?:png|jpe?g|gif|webp|bmp))(\))/gi;

function normalizeImagePathForMarkdown(value: string) {
  return value.replace(/\\/g, "/");
}

function markdownImageDestination(value: string) {
  const normalized = normalizeImagePathForMarkdown(value);

  return /[\s()<>]/.test(normalized) ? `<${normalized.replace(/>/g, "%3E")}>` : normalized;
}

function normalizeScreenshotMarkdown(value: string) {
  const withNormalizedImageLinks = value.replace(markdownWindowsImagePattern, (_match, open: string, imagePath: string, close: string) => {
    return `${open}${markdownImageDestination(imagePath)}${close}`;
  });

  const lines = withNormalizedImageLinks.split(/\r?\n/);
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const nextLine = lines[index + 1];
    const nextPath = nextLine?.trim().match(localImageLinePattern)?.[1];
    const attachment = trimmed.match(/^(\d+\.\s+)(.+?)(\s+\([^)]*\))$/);

    if (attachment && nextPath) {
      const indent = line.slice(0, line.indexOf(trimmed));
      output.push(`${indent}${attachment[1]}[${attachment[2]}](${markdownImageDestination(nextPath)})${attachment[3]}`);
      index += 1;
      continue;
    }

    if (!trimmed || /!?\[[^\]]*\]\([^)]*\)/.test(trimmed)) {
      output.push(line);
      continue;
    }

    const imagePath = trimmed.match(localImageLinePattern)?.[1];

    if (!imagePath) {
      output.push(line);
      continue;
    }

    const indent = line.slice(0, line.indexOf(trimmed));
    output.push(`${indent}[View screenshot](${markdownImageDestination(imagePath)})`);
  }

  return output.join("\n");
}

function localImagePathFromSrc(src: string | undefined, basePath?: string) {
  if (!src) {
    return null;
  }

  let value = src.trim();

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) && !/^[a-zA-Z]:[\\/]/.test(value) && !value.startsWith("file://")) {
    return null;
  }

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

  if (/^(?:[a-zA-Z]:\/|\/\/|\/)/.test(value)) {
    return value;
  }

  if (!basePath?.trim()) {
    return null;
  }

  return `${basePath.replace(/\\/g, "/").replace(/\/+$/, "")}/${value.replace(/^\.?\//, "")}`;
}

function localTextFilePathFromHref(href: string | undefined, basePath?: string) {
  if (!href) {
    return null;
  }

  let value = href.trim();

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) && !/^[a-zA-Z]:[\\/]/.test(value) && !value.startsWith("file://")) {
    return null;
  }

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

  if (!localTextFileExtensions.test(value)) {
    return null;
  }

  if (/^(?:[a-zA-Z]:\/|\/\/|\/)/.test(value)) {
    return value;
  }

  if (!basePath?.trim()) {
    return null;
  }

  return `${basePath.replace(/\\/g, "/").replace(/\/+$/, "")}/${value.replace(/^\.?\//, "")}`;
}

function localDownloadFilePathFromHref(href: string | undefined, basePath?: string) {
  if (!href) {
    return null;
  }

  let value = href.trim();

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) && !/^[a-zA-Z]:[\\/]/.test(value) && !value.startsWith("file://")) {
    return null;
  }

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

  if (!localDownloadableFileExtensions.test(value)) {
    return null;
  }

  if (/^(?:[a-zA-Z]:\/|\/\/|\/)/.test(value)) {
    return value;
  }

  if (!basePath?.trim()) {
    return null;
  }

  return `${basePath.replace(/\\/g, "/").replace(/\/+$/, "")}/${value.replace(/^\.?\//, "")}`;
}

function localPdfFilePathFromHref(href: string | undefined, basePath?: string) {
  const localPath = localDownloadFilePathFromHref(href, basePath);

  if (!localPath || !localPdfFileExtensions.test(localPath)) {
    return null;
  }

  return localPath;
}

function localFileLabel(filePath: string, fallback: string) {
  const withoutLine = filePath.replace(/:\d+(?::\d+)?$/, "");
  const name = withoutLine.split(/[\\/]/).filter(Boolean).at(-1);

  return fallback.trim() || name || filePath;
}

function localFileDownloadName(filePath: string, fallback: string, extension?: string) {
  const withoutLine = filePath.replace(/:\d+(?::\d+)?$/, "");
  const pathName = withoutLine.split(/[\\/]/).filter(Boolean).at(-1);
  const rawName = pathName || fallback.trim() || "download";
  const safeName = rawName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");

  if (extension && !safeName.toLowerCase().endsWith(extension.toLowerCase())) {
    return `${safeName}${extension}`;
  }

  return safeName;
}

function localDownloadUrl(filePath: string, token: string, disposition: "inline" | "attachment" = "attachment") {
  const params = new URLSearchParams({ path: filePath, disposition });

  if (token) {
    params.set("token", token);
  }

  return `/api/local-download?${params.toString()}`;
}

function markdownUrlTransform(url: string) {
  if (localImagePathFromSrc(url) || localTextFilePathFromHref(url) || localDownloadFilePathFromHref(url)) {
    return url;
  }

  return defaultUrlTransform(url);
}

function AuthenticatedImage({
  src,
  alt,
  token,
  basePath
}: {
  src: string | undefined;
  alt: string | undefined;
  token: string;
  basePath?: string;
}) {
  const localPath = useMemo(() => localImagePathFromSrc(src, basePath), [basePath, src]);
  const [failed, setFailed] = useState(false);
  const imageUrl = useMemo(() => {
    if (!localPath) {
      return src;
    }

    const params = new URLSearchParams({ path: localPath });

    if (token) {
      params.set("token", token);
    }

    return `/api/local-image?${params.toString()}`;
  }, [localPath, src, token]);

  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  if (!localPath) {
    return <img className="chat-image" src={imageUrl} alt={alt || "Image"} loading="lazy" />;
  }

  if (failed) {
    return <span className="image-placeholder">Image unavailable</span>;
  }

  return <img className="chat-image" src={imageUrl} alt={alt || "Image"} loading="lazy" onError={() => setFailed(true)} />;
}

function LocalImageAttachment({
  href,
  label,
  token,
  basePath
}: {
  href: string | undefined;
  label: ReactNode;
  token: string;
  basePath?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <span className="image-attachment">
      <button className="image-attachment-toggle" type="button" onClick={() => setOpen((current) => !current)}>
        {label}
      </button>
      {open ? <AuthenticatedImage src={href} alt={typeof label === "string" ? label : "Screenshot"} token={token} basePath={basePath} /> : null}
    </span>
  );
}

function LocalFileDownload({
  filePath,
  label,
  token
}: {
  filePath: string;
  label: ReactNode;
  token: string;
}) {
  const href = useMemo(() => localDownloadUrl(filePath, token, "attachment"), [filePath, token]);

  return (
    <a className="markdown-file-link local-file-download" href={href} download={localFileDownloadName(filePath, textFromReactNode(label))}>
      {label}
    </a>
  );
}

function textFromReactNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(textFromReactNode).join("");
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textFromReactNode(node.props.children);
  }

  return "";
}

function CopyButton({
  text,
  label,
  className = "copy-button"
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }, [text]);

  return (
    <button className={className} type="button" onClick={copy} aria-label={label} title={label}>
      {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
    </button>
  );
}

const FormattedMessage = memo(function FormattedMessage({
  text,
  emptyText,
  token,
  basePath,
  onOpenLocalTextFile,
  onOpenLocalPdfFile
}: {
  text: string | undefined;
  emptyText: string;
  token: string;
  basePath?: string;
  onOpenLocalTextFile?: (filePath: string, label: string) => void;
  onOpenLocalPdfFile?: (filePath: string, label: string) => void;
}) {
  if (!text?.trim()) {
    return <div className="message-empty">{emptyText}</div>;
  }

  return (
    <div className="message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={markdownUrlTransform}
        components={{
          a: ({ children, href }) => {
            const localImagePath = localImagePathFromSrc(href, basePath);
            const localTextFilePath = localTextFilePathFromHref(href, basePath);
            const localPdfFilePath = localPdfFilePathFromHref(href, basePath);
            const localDownloadFilePath = localDownloadFilePathFromHref(href, basePath);
            const label = textFromReactNode(children);

            return localImagePath ? (
              <LocalImageAttachment href={href} label={children} token={token} basePath={basePath} />
            ) : localTextFilePath && onOpenLocalTextFile ? (
              <button
                className="markdown-file-link"
                type="button"
                onClick={() => onOpenLocalTextFile(localTextFilePath, localFileLabel(localTextFilePath, label))}
              >
                {children}
              </button>
            ) : localPdfFilePath && onOpenLocalPdfFile ? (
              <button
                className="markdown-file-link"
                type="button"
                onClick={() => onOpenLocalPdfFile(localPdfFilePath, localFileLabel(localPdfFilePath, label))}
              >
                {children}
              </button>
            ) : localDownloadFilePath ? (
              <LocalFileDownload filePath={localDownloadFilePath} label={children} token={token} />
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          img: ({ src, alt }) =>
            localImagePathFromSrc(src, basePath) ? (
              <LocalImageAttachment href={src} label={alt || "Screenshot"} token={token} basePath={basePath} />
            ) : (
              <AuthenticatedImage src={src} alt={alt} token={token} basePath={basePath} />
            ),
          pre: ({ children }) => (
            <div className="code-block">
              <CopyButton className="code-copy-button" text={textFromReactNode(children).trimEnd()} label="Copy code" />
              <pre>{children}</pre>
            </div>
            )
        }}
      >
        {normalizeScreenshotMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
});

function VoiceNotePlayer({ message }: { message: VisibleChatMessage }) {
  if (!message.voiceNoteUrl) {
    return <div className="message-empty">Voice note unavailable.</div>;
  }

  return (
    <div className="voice-note-player">
      <audio controls src={message.voiceNoteUrl}>
        Voice note
      </audio>
    </div>
  );
}

function DictationWaveform({ processing, barsRef }: { processing: boolean; barsRef?: Ref<HTMLDivElement> }) {
  return (
    <div className={`dictation-waveform ${processing ? "is-processing" : ""}`} aria-live="polite">
      <span>{processing ? "Processing" : "Recording"}</span>
      <div className="dictation-bars" aria-hidden="true" ref={barsRef}>
        {Array.from({ length: 22 }, (_value, index) => {
          const barHeight = 8 + (index % 7) * 3;

          return <i key={index} style={{ "--bar-index": index, "--bar-height": `${barHeight}px` } as CSSProperties} />;
        })}
      </div>
    </div>
  );
}

type CustomKeyboardMode = "letters" | "numbers" | "symbols";
type KeyboardTraceData = {
  phase: string;
  [key: string]: string | number | boolean | null | undefined;
};
type KeyboardTraceEvent = KeyboardTraceData & {
  sequence: number;
  capturedAt: number;
  chatId: string | null;
};
const keyboardTraceStorageKey = "ios-keyboard-trace-pending-v1";

function readPendingKeyboardTrace() {
  try {
    const parsed = JSON.parse(localStorage.getItem(keyboardTraceStorageKey) ?? "[]");
    return Array.isArray(parsed) ? (parsed.slice(-1000) as KeyboardTraceEvent[]) : [];
  } catch {
    return [];
  }
}

const customKeyboardExitDurationMs = 240;
const customKeyboardTapSlopPx = 10;
const customKeyboardDraftSyncDelayMs = 750;

function shouldUseCustomKeyboard() {
  const override = new URLSearchParams(window.location.search).get("customKeyboard");
  if (override === "1") {
    return true;
  }
  if (override === "0") {
    return false;
  }

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  const isIOS =
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone =
    navigatorWithStandalone.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  return isIOS && isStandalone;
}

function selectionInsideComposer(editor: HTMLDivElement, fallback: TextSelection) {
  const editorText = rawTextFromComposerEditor(editor);
  const normalizedFallback = normalizeTextSelection(editorText, fallback);
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return normalizedFallback;
  }

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return normalizedFallback;
  }

  const offsetWithinEditor = (container: Node, offset: number) => {
    const probe = document.createRange();
    probe.selectNodeContents(editor);
    probe.setEnd(container, offset);
    return probe.toString().length;
  };

  return normalizeTextSelection(editorText, {
    start: offsetWithinEditor(range.startContainer, range.startOffset),
    end: offsetWithinEditor(range.endContainer, range.endOffset)
  });
}

function restoreComposerSelection(editor: HTMLDivElement, text: string, selection: TextSelection) {
  if (document.activeElement !== editor) {
    editor.focus({ preventScroll: true });
  }

  const normalized = normalizeTextSelection(text, selection);
  const browserSelection = window.getSelection();
  if (!browserSelection) {
    return normalized;
  }

  const range = document.createRange();
  const textNode = editor.firstChild;
  if (textNode?.nodeType === Node.TEXT_NODE) {
    range.setStart(textNode, normalized.start);
    range.setEnd(textNode, normalized.end);
  } else {
    range.selectNodeContents(editor);
    range.collapse(true);
  }

  browserSelection.removeAllRanges();
  browserSelection.addRange(range);
  return normalized;
}

function applyComposerMutation(editor: HTMLDivElement, text: string, selection: TextSelection) {
  syncComposerEditorText(editor, text);
  return restoreComposerSelection(editor, text, selection);
}

function patchComposerInsertion(
  editor: HTMLDivElement,
  currentText: string,
  selection: TextSelection,
  insertedText: string,
  expectedText: string
) {
  const textNode = editor.childNodes.length === 1 && editor.firstChild instanceof Text ? editor.firstChild : null;
  if (!textNode || textNode.length !== currentText.length) {
    syncComposerEditorText(editor, expectedText);
    return false;
  }

  const normalized = normalizeTextSelection(currentText, selection);
  textNode.replaceData(normalized.start, normalized.end - normalized.start, insertedText);
  return textNode.length === expectedText.length;
}

function patchComposerDeletion(
  editor: HTMLDivElement,
  currentText: string,
  selection: TextSelection,
  mutation: { text: string; selection: TextSelection }
) {
  const textNode = editor.childNodes.length === 1 && editor.firstChild instanceof Text ? editor.firstChild : null;
  if (!textNode || textNode.length !== currentText.length) {
    syncComposerEditorText(editor, mutation.text);
    return false;
  }

  const normalized = normalizeTextSelection(currentText, selection);
  const deleteFrom = mutation.selection.start;
  textNode.replaceData(deleteFrom, normalized.end - deleteFrom, "");
  return textNode.length === mutation.text.length;
}

function insertIntoComposer(editor: HTMLDivElement, text: string, fallback: TextSelection) {
  const currentText = rawTextFromComposerEditor(editor);
  const mutation = insertTextAtSelection(currentText, fallback, text);
  return applyComposerMutation(editor, mutation.text, mutation.selection);
}

function deleteFromComposer(editor: HTMLDivElement, fallback: TextSelection) {
  const currentText = rawTextFromComposerEditor(editor);
  const mutation = deleteTextBackward(currentText, fallback);
  return applyComposerMutation(editor, mutation.text, mutation.selection);
}

const customKeyboardRows: Record<CustomKeyboardMode, string[][]> = {
  letters: [
    [..."qwertyuiop"],
    [..."asdfghjkl"],
    [..."zxcvbnm"]
  ],
  numbers: [
    [..."1234567890"],
    ["-", "/", ":", ";", "(", ")", "$", "&", "@", '"'],
    [".", ",", "?", "!", "'"]
  ],
  symbols: [
    ["[", "]", "{", "}", "#", "%", "^", "*", "+", "="],
    ["_", "\\", "|", "~", "<", ">", "`"],
    [".", ",", "?", "!", "'", '"']
  ]
};

const CustomKeyboard = memo(function CustomKeyboard({
  onText,
  onBackspace,
  onRequestComposerFocus,
  onTrace,
  onClose
}: {
  onText: (text: string) => void;
  onBackspace: () => void;
  onRequestComposerFocus: () => void;
  onTrace: (event: KeyboardTraceData) => void;
  onClose: () => void;
}) {
  const keyboardRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<CustomKeyboardMode>("letters");
  const [shifted, setShifted] = useState(false);
  const modeRef = useRef<CustomKeyboardMode>(mode);
  const shiftedRef = useRef(shifted);
  const backspaceDelayRef = useRef<number | undefined>(undefined);
  const backspaceRepeatRef = useRef<number | undefined>(undefined);

  modeRef.current = mode;
  shiftedRef.current = shifted;

  const stopBackspaceRepeat = useCallback(() => {
    window.clearTimeout(backspaceDelayRef.current);
    window.clearInterval(backspaceRepeatRef.current);
    backspaceDelayRef.current = undefined;
    backspaceRepeatRef.current = undefined;
  }, []);

  const setKeyboardMode = useCallback((nextMode: CustomKeyboardMode) => {
    modeRef.current = nextMode;
    setMode(nextMode);
  }, []);

  const setKeyboardShifted = useCallback((nextShifted: boolean) => {
    shiftedRef.current = nextShifted;
    setShifted(nextShifted);
  }, []);

  const pressText = useCallback((text: string) => {
    const shouldShift = modeRef.current === "letters" && shiftedRef.current;
    onText(shouldShift ? text.toUpperCase() : text);
    if (shouldShift) {
      shiftedRef.current = false;
      setShifted(false);
    }
  }, [onText]);

  const toggleShift = useCallback(() => {
    setKeyboardShifted(!shiftedRef.current);
  }, [setKeyboardShifted]);

  const toggleAlternateMode = useCallback(() => {
    setKeyboardMode(modeRef.current === "numbers" ? "symbols" : "numbers");
  }, [setKeyboardMode]);

  const toggleLettersMode = useCallback(() => {
    setKeyboardMode(modeRef.current === "letters" ? "numbers" : "letters");
    setKeyboardShifted(false);
  }, [setKeyboardMode, setKeyboardShifted]);

  // iOS can defer or drop synthesized click events during rapid multi-key tapping.
  // Mutate the composer on pointerdown; reserve detail=0 clicks for assistive activation.
  const pressOnPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, action: () => void) => {
    if (event.pointerType === "touch") {
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.preventDefault();
    action();
  };

  const pressOnAccessibleClick = (event: ReactMouseEvent<HTMLButtonElement>, action: () => void) => {
    // Prevent WebKit's synthesized click from focusing the key after pointerdown.
    // That focus transfer collapses the mobile composer and changes the scroll geometry.
    event.preventDefault();
    if (event.detail !== 0) {
      return;
    }
    action();
  };

  const beginBackspaceRepeat = useCallback(() => {
    onBackspace();
    stopBackspaceRepeat();
    backspaceDelayRef.current = window.setTimeout(() => {
      backspaceRepeatRef.current = window.setInterval(onBackspace, 70);
    }, 360);
  }, [onBackspace, stopBackspaceRepeat]);

  const startBackspaceRepeat = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (event.pointerType !== "touch") {
      beginBackspaceRepeat();
    }
  };

  const commitTouchAction = useCallback(
    (action: string, value: string) => {
      switch (action) {
        case "text":
          pressText(value);
          break;
        case "shift":
          toggleShift();
          break;
        case "alternate-mode":
          toggleAlternateMode();
          break;
        case "letters-mode":
          toggleLettersMode();
          break;
        case "close":
          onClose();
          break;
      }
    },
    [onClose, pressText, toggleAlternateMode, toggleLettersMode, toggleShift]
  );

  useEffect(() => {
    const keyboard = keyboardRef.current;
    if (!keyboard) {
      return;
    }

    type TrackedTouch = {
      action: string;
      button: HTMLButtonElement;
      source: "target" | "point";
      value: string;
    };

    const activeTouches = new Map<number, TrackedTouch>();
    const keyAtTouch = (touch: Touch): TrackedTouch | null => {
      // Touch.target is fixed at contact start and avoids a second synchronous
      // hit-test while animated previews and another finger may be on screen.
      const targetHit = touch.target instanceof Element ? touch.target : null;
      const pointHit = targetHit ? null : document.elementFromPoint(touch.clientX, touch.clientY);
      const button = (targetHit ?? pointHit)?.closest("button[data-keyboard-action]") ?? null;
      if (!(button instanceof HTMLButtonElement) || !keyboard.contains(button)) {
        return null;
      }

      return {
        action: button.dataset.keyboardAction ?? "",
        button,
        source: targetHit ? "target" : "point",
        value: button.dataset.keyboardValue ?? ""
      };
    };

    const releaseTouch = (touch: Touch, phase: "touch-end" | "touch-cancel") => {
      const tracked = activeTouches.get(touch.identifier);
      if (phase === "touch-cancel" || !tracked) {
        onTrace({
          phase,
          identifier: touch.identifier,
          tracked: Boolean(tracked),
          activeBefore: activeTouches.size
        });
      }
      if (!tracked) {
        return;
      }

      activeTouches.delete(touch.identifier);
      tracked.button.classList.remove("is-touch-active");
      if (tracked.action === "backspace") {
        stopBackspaceRepeat();
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      event.preventDefault();
      for (const touch of Array.from(event.changedTouches)) {
        const stale = activeTouches.get(touch.identifier);
        if (stale) {
          // WebKit occasionally omits a release while focus is moving. Touch IDs
          // are then reused, so discard the stale visual instead of dropping the
          // first key of the next contact.
          stale.button.classList.remove("is-touch-active");
          if (stale.action === "backspace") {
            stopBackspaceRepeat();
          }
          activeTouches.delete(touch.identifier);
          onTrace({
            phase: "stale-touch-replaced",
            identifier: touch.identifier,
            staleAction: stale.action,
            staleValue: stale.value
          });
        }

        const tracked = keyAtTouch(touch);
        if (!tracked) {
          onTrace({
            phase: "touch-unresolved",
            identifier: touch.identifier,
            x: Math.round(touch.clientX),
            y: Math.round(touch.clientY),
            touches: event.touches.length,
            changedTouches: event.changedTouches.length
          });
          continue;
        }

        onTrace({
          phase: "touch-start",
          identifier: touch.identifier,
          action: tracked.action,
          value: tracked.value,
          source: tracked.source,
          x: Math.round(touch.clientX),
          y: Math.round(touch.clientY),
          activeBefore: activeTouches.size,
          touches: event.touches.length,
          changedTouches: event.changedTouches.length,
          eventTime: Math.round(event.timeStamp)
        });
        activeTouches.set(touch.identifier, tracked);
        tracked.button.classList.add("is-touch-active");
        if (tracked.action === "backspace") {
          beginBackspaceRepeat();
        } else {
          // Character order is the order fingers land, not the order they lift.
          // Do not move this commit to touchend: overlapping iPhone taps commonly
          // release in reverse order and touchcancel would silently drop a key.
          commitTouchAction(tracked.action, tracked.value);
        }
      }
    };

    const handleTouchEnd = (event: TouchEvent) => {
      event.preventDefault();
      for (const touch of Array.from(event.changedTouches)) {
        releaseTouch(touch, "touch-end");
      }
    };

    const handleTouchCancel = (event: TouchEvent) => {
      for (const touch of Array.from(event.changedTouches)) {
        releaseTouch(touch, "touch-cancel");
      }
    };

    keyboard.addEventListener("touchstart", handleTouchStart, { passive: false });
    keyboard.addEventListener("touchend", handleTouchEnd, { passive: false });
    keyboard.addEventListener("touchcancel", handleTouchCancel, { passive: false });
    return () => {
      keyboard.removeEventListener("touchstart", handleTouchStart);
      keyboard.removeEventListener("touchend", handleTouchEnd);
      keyboard.removeEventListener("touchcancel", handleTouchCancel);
      for (const tracked of activeTouches.values()) {
        tracked.button.classList.remove("is-touch-active");
      }
      stopBackspaceRepeat();
    };
  }, [beginBackspaceRepeat, commitTouchAction, onTrace, stopBackspaceRepeat]);

  useEffect(() => stopBackspaceRepeat, [stopBackspaceRepeat]);

  const rows = customKeyboardRows[mode];

  return (
    <div
      ref={keyboardRef}
      className="custom-keyboard"
      role="group"
      aria-label="On-screen keyboard"
      onPointerDown={(event) => {
        if (event.pointerType !== "touch") {
          event.preventDefault();
        }
      }}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLButtonElement) {
          onRequestComposerFocus();
        }
      }}
    >
      {rows.map((row, rowIndex) => (
        <div className={`custom-keyboard-row row-${rowIndex + 1}`} key={`${mode}-${rowIndex}`}>
          {rowIndex === 2 && mode === "letters" ? (
            <button
              className={`custom-key is-modifier ${shifted ? "is-active" : ""}`}
              type="button"
              tabIndex={-1}
              data-keyboard-action="shift"
              onPointerDown={(event) => pressOnPointerDown(event, toggleShift)}
              onClick={(event) => pressOnAccessibleClick(event, toggleShift)}
              aria-label={shifted ? "Turn off shift" : "Shift"}
              aria-pressed={shifted}
            >
              <ArrowUp size={20} strokeWidth={2.2} />
            </button>
          ) : rowIndex === 2 ? (
            <button
              className="custom-key is-modifier"
              type="button"
              tabIndex={-1}
              data-keyboard-action="alternate-mode"
              onPointerDown={(event) => pressOnPointerDown(event, toggleAlternateMode)}
              onClick={(event) => pressOnAccessibleClick(event, toggleAlternateMode)}
            >
              {mode === "numbers" ? "#+=" : "123"}
            </button>
          ) : null}
          {row.map((key) => (
            <button
              className="custom-key"
              type="button"
              tabIndex={-1}
              data-keyboard-action="text"
              data-keyboard-value={key}
              onPointerDown={(event) => pressOnPointerDown(event, () => pressText(key))}
              onClick={(event) => pressOnAccessibleClick(event, () => pressText(key))}
              key={key}
            >
              <span className="custom-key-label">{mode === "letters" && shifted ? key.toUpperCase() : key}</span>
              {mode === "letters" ? (
                <span className="custom-key-preview" aria-hidden="true">
                  {shifted ? key.toUpperCase() : key}
                </span>
              ) : null}
            </button>
          ))}
          {rowIndex === 2 ? (
            <button
              className="custom-key is-modifier"
              type="button"
              tabIndex={-1}
              data-keyboard-action="backspace"
              onPointerDown={startBackspaceRepeat}
              onPointerUp={stopBackspaceRepeat}
              onPointerCancel={stopBackspaceRepeat}
              onPointerLeave={stopBackspaceRepeat}
              onClick={(event) => pressOnAccessibleClick(event, onBackspace)}
              aria-label="Backspace"
            >
              <Delete size={20} />
            </button>
          ) : null}
        </div>
      ))}
      <div className="custom-keyboard-row is-command-row">
        <button
          className="custom-key is-modifier is-mode-key"
          type="button"
          tabIndex={-1}
          data-keyboard-action="letters-mode"
          onPointerDown={(event) => pressOnPointerDown(event, toggleLettersMode)}
          onClick={(event) => pressOnAccessibleClick(event, toggleLettersMode)}
        >
          {mode === "letters" ? "123" : "ABC"}
        </button>
        <button
          className="custom-key"
          type="button"
          tabIndex={-1}
          data-keyboard-action="text"
          data-keyboard-value=","
          onPointerDown={(event) => pressOnPointerDown(event, () => pressText(","))}
          onClick={(event) => pressOnAccessibleClick(event, () => pressText(","))}
          aria-label="Comma"
        >
          ,
        </button>
        <button
          className="custom-key is-space-key"
          type="button"
          tabIndex={-1}
          data-keyboard-action="text"
          data-keyboard-value=" "
          onPointerDown={(event) => pressOnPointerDown(event, () => pressText(" "))}
          onClick={(event) => pressOnAccessibleClick(event, () => pressText(" "))}
        >
          space
        </button>
        <button
          className="custom-key"
          type="button"
          tabIndex={-1}
          data-keyboard-action="text"
          data-keyboard-value="."
          onPointerDown={(event) => pressOnPointerDown(event, () => pressText("."))}
          onClick={(event) => pressOnAccessibleClick(event, () => pressText("."))}
          aria-label="Period"
        >
          .
        </button>
        <button
          className="custom-key is-modifier is-return-key"
          type="button"
          tabIndex={-1}
          data-keyboard-action="text"
          data-keyboard-value={"\n"}
          onPointerDown={(event) => pressOnPointerDown(event, () => pressText("\n"))}
          onClick={(event) => pressOnAccessibleClick(event, () => pressText("\n"))}
          aria-label="Return"
        >
          <CornerDownLeft size={19} />
        </button>
      </div>
      <div className="custom-keyboard-footer">
        <button
          className="custom-keyboard-dismiss"
          type="button"
          tabIndex={-1}
          data-keyboard-action="close"
          onPointerDown={(event) => pressOnPointerDown(event, onClose)}
          onClick={(event) => pressOnAccessibleClick(event, onClose)}
          aria-label="Hide keyboard"
        >
          <ChevronDown size={21} />
        </button>
      </div>
    </div>
  );
});

function JobStatusIcon({ job }: { job: CodexRunJob }) {
  if (job.status === "running") {
    return <Loader2 className="spin" size={15} />;
  }

  if (job.status === "completed") {
    return <CheckCircle2 size={15} />;
  }

  if (job.status === "failed" || job.status === "stopped") {
    return <CircleX size={15} />;
  }

  return <Clock3 size={15} />;
}

function NotificationButton({
  status,
  busy,
  onClick
}: {
  status: RemoteNotificationState;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`icon-button notification-button ${status === "enabled" ? "is-active" : ""}`}
      type="button"
      onClick={onClick}
      disabled={busy || status === "unsupported" || status === "denied"}
      aria-label={status === "enabled" ? "Send test notification" : "Enable notifications"}
      title={
        status === "enabled"
          ? "Send test notification"
          : status === "denied"
            ? "Notifications are blocked in browser settings"
            : "Enable notifications"
      }
    >
      {busy ? (
        <Loader2 className="spin" size={18} />
      ) : status === "denied" || status === "unsupported" ? (
        <BellOff size={18} />
      ) : (
        <Bell size={18} />
      )}
      <span className="notification-label">{notificationLabel(status)}</span>
    </button>
  );
}

function StatusControls({
  socketLive,
  state,
  notificationStatus,
  notificationBusy,
  onNotifications,
  onLogout
}: {
  socketLive: boolean;
  state: BridgeState | null;
  notificationStatus: RemoteNotificationState;
  notificationBusy: boolean;
  onNotifications: () => void;
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
      <NotificationButton status={notificationStatus} busy={notificationBusy} onClick={onNotifications} />
      <button className="icon-button" type="button" onClick={onLogout} aria-label="Sign out">
        <LogOut size={18} />
      </button>
    </div>
  );
}

function settingLabel(value: string) {
  if (value === "default") {
    return "Default";
  }

  if (value === "xhigh") {
    return "X High";
  }

  if (value === "priority") {
    return "Fast";
  }

  return value
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const codexPowerSettings: Array<{
  model: string;
  reasoningEffort: CodexRunSettings["reasoningEffort"];
  modelLabel: string;
  effortLabel: string;
}> = [
  { model: "gpt-5.6-terra", reasoningEffort: "low", modelLabel: "5.6 Terra", effortLabel: "Low" },
  { model: "gpt-5.6-sol", reasoningEffort: "low", modelLabel: "5.6 Sol", effortLabel: "Low" },
  { model: "gpt-5.6-sol", reasoningEffort: "medium", modelLabel: "5.6 Sol", effortLabel: "Standard" },
  { model: "gpt-5.6-sol", reasoningEffort: "high", modelLabel: "5.6 Sol", effortLabel: "Extended" },
  { model: "gpt-5.6-sol", reasoningEffort: "xhigh", modelLabel: "5.6 Sol", effortLabel: "High" },
  { model: "gpt-5.6-sol", reasoningEffort: "ultra", modelLabel: "5.6 Sol", effortLabel: "Ultra" }
];

function powerSettingLabel(setting: (typeof codexPowerSettings)[number]) {
  return `${setting.modelLabel} ${setting.effortLabel}`;
}

function UsageBar({ label, usage }: { label: string; usage: CodexUsageWindow | undefined }) {
  const usedPercent = Math.min(100, Math.max(0, usage?.usedPercent ?? 0));
  const remainingPercent = 100 - usedPercent;
  const resetDate = usage?.resetsAt ? new Date(usage.resetsAt * 1000) : null;
  const resetLabel = resetDate && !Number.isNaN(resetDate.getTime())
    ? label === "Weekly"
      ? resetDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : resetDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    : "Waiting for Codex usage data";

  return (
    <div className="usage-meter" title={`Resets ${resetLabel}`}>
      <div className="usage-meter-label">
        <span>{label}</span>
        <strong>{usage ? `${Math.round(remainingPercent)}% left` : "--"}</strong>
      </div>
      <div className="usage-meter-track" role="progressbar" aria-label={`${label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(remainingPercent)}>
        <span style={{ width: `${remainingPercent}%` }} />
      </div>
      <small>{usage ? `Resets ${resetLabel}` : resetLabel}</small>
    </div>
  );
}

function RunSettingsPanel({
  settings,
  options,
  usage,
  busy,
  onChange,
  compactOnly = false
}: {
  settings?: CodexRunSettings;
  options?: CodexRunSettingsOptions;
  usage?: CodexUsage | null;
  busy: boolean;
  onChange: (patch: Partial<Pick<CodexRunSettings, "model" | "reasoningEffort" | "speed">>) => void;
  compactOnly?: boolean;
}) {
  const current = settings ?? {
    model: "default",
    reasoningEffort: "xhigh" as const,
    speed: "default" as const,
    updatedAt: ""
  };
  const available = options ?? {
    models: ["default"],
    reasoningEfforts: ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as CodexRunSettings["reasoningEffort"][],
    speeds: ["default", "priority"] as CodexRunSettings["speed"][],
    modelCapabilities: {}
  };
  const selectedCapability = available.modelCapabilities?.[current.model];
  const availableReasoningEfforts = selectedCapability?.reasoningEfforts ?? available.reasoningEfforts;
  const availableSpeeds = selectedCapability?.speeds ?? available.speeds;
  const powerSettings = useMemo(
    () =>
      codexPowerSettings.filter((setting) => {
        if (!available.models.includes(setting.model)) {
          return false;
        }

        const capability = available.modelCapabilities?.[setting.model];
        return capability ? capability.reasoningEfforts.includes(setting.reasoningEffort) : true;
      }),
    [available.modelCapabilities, available.models]
  );
  const selectedPowerIndex = powerSettings.findIndex(
    (setting) => setting.model === current.model && setting.reasoningEffort === current.reasoningEffort
  );
  const [powerPreviewIndex, setPowerPreviewIndex] = useState(Math.max(selectedPowerIndex, 0));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const powerCommitTimerRef = useRef<number | undefined>(undefined);
  const compactModeAvailable = powerSettings.length >= 2 && selectedPowerIndex >= 0;
  const advancedVisible = advancedOpen || !compactModeAvailable;
  const safePowerPreviewIndex = Math.min(Math.max(powerPreviewIndex, 0), Math.max(powerSettings.length - 1, 0));
  const previewPowerSetting = powerSettings[safePowerPreviewIndex];
  const powerPercent = powerSettings.length > 1 ? (safePowerPreviewIndex / (powerSettings.length - 1)) * 100 : 0;
  const powerFillWidth = `calc(${powerPercent}% + ${14 - powerPercent * 0.28}px)`;
  const fastModeSupported = availableSpeeds.includes("priority");
  const fastModeEnabled = current.speed === "priority";
  const ultraSelected = previewPowerSetting?.reasoningEffort === "ultra";

  useEffect(() => {
    if (selectedPowerIndex >= 0) {
      setPowerPreviewIndex(selectedPowerIndex);
    }
  }, [selectedPowerIndex]);

  useEffect(
    () => () => {
      if (powerCommitTimerRef.current !== undefined) {
        window.clearTimeout(powerCommitTimerRef.current);
      }
    },
    []
  );

  const commitPowerSetting = (index: number) => {
    const selection = powerSettings[index];
    if (!selection || (selection.model === current.model && selection.reasoningEffort === current.reasoningEffort)) {
      return;
    }

    onChange({ model: selection.model, reasoningEffort: selection.reasoningEffort });
  };

  const previewAndQueuePowerSetting = (index: number) => {
    setPowerPreviewIndex(index);
    if (powerCommitTimerRef.current !== undefined) {
      window.clearTimeout(powerCommitTimerRef.current);
    }
    powerCommitTimerRef.current = window.setTimeout(() => {
      powerCommitTimerRef.current = undefined;
      commitPowerSetting(index);
    }, 160);
  };

  const commitQueuedPowerSetting = (index: number) => {
    if (powerCommitTimerRef.current !== undefined) {
      window.clearTimeout(powerCommitTimerRef.current);
      powerCommitTimerRef.current = undefined;
    }
    commitPowerSetting(index);
  };

  const currentLabel = compactModeAvailable && previewPowerSetting
    ? powerSettingLabel(previewPowerSetting)
    : `${available.modelCapabilities?.[current.model]?.label ?? settingLabel(current.model)} ${settingLabel(current.reasoningEffort)}`;

  const compactPowerControl = compactModeAvailable ? (
    <div className="run-settings-power-row" data-ultra={ultraSelected}>
      <div className="run-settings-power-slider">
        <span className="run-settings-power-track" aria-hidden="true">
          <span className="run-settings-power-fill" style={{ width: powerFillWidth }} />
          {powerSettings.map((setting, index) => {
            const tickPercent = powerSettings.length > 1 ? (index / (powerSettings.length - 1)) * 100 : 0;
            const tickLeft = `calc(${tickPercent}% + ${14 - tickPercent * 0.28}px)`;
            return (
              <span
                className="run-settings-power-tick"
                data-selected={index <= safePowerPreviewIndex}
                key={`${setting.model}:${setting.reasoningEffort}`}
                style={{ left: tickLeft }}
              />
            );
          })}
        </span>
        <input
          aria-label={compactOnly ? "Composer global power" : "Global power"}
          aria-valuetext={currentLabel}
          type="range"
          min={0}
          max={Math.max(powerSettings.length - 1, 1)}
          step={1}
          value={safePowerPreviewIndex}
          disabled={busy || powerSettings.length < 2}
          onChange={(event) => previewAndQueuePowerSetting(Number(event.currentTarget.value))}
          onPointerUp={(event) => commitQueuedPowerSetting(Number(event.currentTarget.value))}
          onKeyUp={(event) => {
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
              commitQueuedPowerSetting(Number(event.currentTarget.value));
            }
          }}
        />
      </div>
      {compactOnly ? (
        <span className="composer-power-model" title={previewPowerSetting.modelLabel}>
          {previewPowerSetting.modelLabel}
        </span>
      ) : (
        <button
          className="run-settings-fast-toggle"
          type="button"
          aria-label={fastModeEnabled ? "Enable standard speed" : "Enable fast mode"}
          aria-pressed={fastModeEnabled}
          disabled={busy || !fastModeSupported}
          title="1.5x speed, more usage"
          onClick={() => onChange({ speed: fastModeEnabled ? "default" : "priority" })}
        >
          <Zap size={17} fill={fastModeEnabled ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      )}
    </div>
  ) : null;

  if (compactOnly) {
    return compactPowerControl ? (
      <div className="composer-power-control" aria-label={`${currentLabel} run settings`}>
        {compactPowerControl}
      </div>
    ) : null;
  }

  return (
    <section className="run-settings-panel" aria-label="Global Codex run settings" data-advanced={advancedVisible}>
      <div className="run-settings-summary">
        <span className="run-settings-power-value">
          {busy ? <Loader2 className="spin" size={13} /> : null}
          {currentLabel}
        </span>
        <button
          className="run-settings-advanced-toggle"
          type="button"
          aria-expanded={advancedVisible}
          disabled={!compactModeAvailable}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          <span>Advanced</span>
          <ChevronRight size={13} aria-hidden="true" />
        </button>
      </div>

      {!advancedVisible ? compactPowerControl : null}

      {advancedVisible ? (
        <>
          <div className="run-settings-grid">
            <label>
            <span>Model</span>
            <select
              value={current.model}
              disabled={busy}
              onChange={(event) => onChange({ model: event.currentTarget.value })}
              aria-label="Global model"
            >
              {available.models.map((model) => (
                <option key={model} value={model}>
                  {available.modelCapabilities?.[model]?.label ?? (model === "default" ? "Default" : model)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Reasoning</span>
            <select
              value={current.reasoningEffort}
              disabled={busy}
              onChange={(event) => onChange({ reasoningEffort: event.currentTarget.value as CodexRunSettings["reasoningEffort"] })}
              aria-label="Global reasoning level"
            >
              {availableReasoningEfforts.map((effort) => (
                <option key={effort} value={effort}>
                  {settingLabel(effort)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Speed</span>
            <select
              value={current.speed}
              disabled={busy}
              onChange={(event) => onChange({ speed: event.currentTarget.value as CodexRunSettings["speed"] })}
              aria-label="Global speed"
            >
              {availableSpeeds.map((speed) => (
                <option key={speed} value={speed}>
                  {settingLabel(speed)}
                </option>
              ))}
            </select>
            </label>
          </div>
          <div className="usage-meters" aria-label="Codex usage limits">
            <UsageBar label="5 hours" usage={usage?.fiveHour} />
            <UsageBar label="Weekly" usage={usage?.weekly} />
          </div>
        </>
      ) : null}
    </section>
  );
}

function RunBoard({
  open,
  jobs,
  chatById,
  nowMs,
  onClose
}: {
  open: boolean;
  jobs: CodexRunJob[];
  chatById: Map<string, ChatSummary>;
  nowMs: number;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  const runningCount = jobs.filter((job) => job.status === "running").length;
  const queuedCount = jobs.filter((job) => job.status === "queued").length;

  return (
    <section className="run-board-overlay" aria-label="Active Codex runs">
      <header className="run-board-header">
        <div>
          <p>Codex Remote</p>
          <h2>Active Runs</h2>
        </div>
        <div className="run-board-header-side">
          <div className="run-board-counts" aria-label="Run counts">
            <span>
              <strong>{runningCount}</strong>
              running
            </span>
            <span>
              <strong>{queuedCount}</strong>
              queued
            </span>
          </div>
          <button className="run-board-close" type="button" onClick={onClose} aria-label="Close run board">
            <X size={36} />
          </button>
        </div>
      </header>

      {jobs.length ? (
        <div className="run-board-grid">
          {jobs.map((job) => {
            const chat = chatById.get(job.chatId);
            const projectName = chat?.projectName ?? projectNameFromPath(job.projectPath);
            const chatTitle = chat?.title ?? previewText(job.promptPreview || job.chatId, "Codex chat");
            const timer =
              job.status === "running"
                ? formatElapsedSeconds(job.startedAt ?? job.createdAt, job.finishedAt, nowMs)
                : formatElapsedSeconds(job.createdAt, undefined, nowMs);

            return (
              <article className={`run-board-card is-${job.status}`} key={job.id}>
                <div className="run-board-card-top">
                  <span className="run-board-status">
                    <Loader2 className={job.status === "running" ? "spin" : ""} size={48} />
                    {job.status === "running" ? "Running" : "Queued"}
                  </span>
                  {job.status === "queued" && job.queuePosition ? <span className="run-board-position">#{job.queuePosition}</span> : null}
                </div>
                <div className="run-board-timer">{timer}</div>
                <div className="run-board-copy">
                  <p>{projectName}</p>
                  <h3>{chatTitle}</h3>
                  <strong>{previewText(job.promptPreview, "Prompt")}</strong>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="run-board-empty">
          <CheckCircle2 size={96} />
          <h3>All Clear</h3>
          <p>No active Codex runs right now.</p>
        </div>
      )}
    </section>
  );
}

export function App() {
  const initialChatSelection = useMemo(() => {
    const storedChatId = readStoredSelectedChatId();
    const storedChat = storedChatId ? getCachedChatHistory(storedChatId) : null;
    const fallbackChat = storedChat ?? (!storedChatId ? newestCachedChatHistory() : null);

    return {
      id: storedChatId ?? fallbackChat?.id ?? null,
      chat: storedChat ?? fallbackChat
    };
  }, []);
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
  const [selectedChatId, setSelectedChatId] = useState<string | null>(initialChatSelection.id);
  const [selectedChat, setSelectedChat] = useState<ChatDetail | null>(initialChatSelection.chat);
  const [chatMessageViewModes, setChatMessageViewModes] = useState<Record<string, ChatMessageViewMode>>(() =>
    readChatMessageViewModes()
  );
  const [chatScrollVersion, setChatScrollVersion] = useState(0);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [draftsByChat, setDraftsByChat] = useState<Record<string, string>>(() =>
    initialChatSelection.id ? { [initialChatSelection.id]: readChatDraft(localStorage, initialChatSelection.id) } : {}
  );
  const [sending, setSending] = useState(false);
  const [stoppingJobIds, setStoppingJobIds] = useState<Set<string>>(() => new Set());
  const [, setNotice] = useState("");
  const [socketLive, setSocketLive] = useState(false);
  const [chatJobs, setChatJobs] = useState<Record<string, CodexRunJob[]>>(() => readCachedActiveJobs());
  const [promptReceipt, setPromptReceipt] = useState<PromptReceipt | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentUploadStatuses, setAttachmentUploadStatuses] = useState<Record<string, AttachmentUploadStatus>>({});
  const [unreadChatIds, setUnreadChatIds] = useState<Set<string>>(() => new Set());
  const [refreshingChat, setRefreshingChat] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState<RemoteNotificationState>("default");
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [chatTurnLimits, setChatTurnLimits] = useState<Record<string, number>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOrderSnapshot, setSidebarOrderSnapshot] = useState<SidebarOrderSnapshot | null>(null);
  const [runBoardOpen, setRunBoardOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [instructionsLoading, setInstructionsLoading] = useState(false);
  const [instructionsError, setInstructionsError] = useState("");
  const [shortcutInstructions, setShortcutInstructions] = useState<ShortcutInstructionsResult | null>(null);
  const [selectedInstructionFile, setSelectedInstructionFile] = useState<ShortcutInstructionFile | null>(null);
  const [selectedInstructionContent, setSelectedInstructionContent] = useState("");
  const [selectedInstructionLoading, setSelectedInstructionLoading] = useState(false);
  const [selectedInstructionError, setSelectedInstructionError] = useState("");
  const [selectedPdfFile, setSelectedPdfFile] = useState<SelectedLocalPdfFile | null>(null);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [projectActionMode, setProjectActionMode] = useState<"project" | "chat" | null>(null);
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const [projectActionError, setProjectActionError] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPrompt, setNewProjectPrompt] = useState("");
  const [newChatTitle, setNewChatTitle] = useState("");
  const [newChatPrompt, setNewChatPrompt] = useState("");
  const [newChatProjectPath, setNewChatProjectPath] = useState("");
  const [chatActionMode, setChatActionMode] = useState<"rename" | "fork" | null>(null);
  const [chatActionName, setChatActionName] = useState("");
  const [chatActionBusy, setChatActionBusy] = useState(false);
  const [chatActionError, setChatActionError] = useState("");
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [customKeyboardEnabled] = useState(shouldUseCustomKeyboard);
  const [customKeyboardOpen, setCustomKeyboardOpen] = useState(false);
  const [customKeyboardMounted, setCustomKeyboardMounted] = useState(false);
  const [dictationRecording, setDictationRecording] = useState(false);
  const [dictationProcessing, setDictationProcessing] = useState(false);
  const [durationNow, setDurationNow] = useState(Date.now());
  const [liveThinkingDisplay, setLiveThinkingDisplay] = useState<{ runKey: string; status: LiveThinkingStatus }>({
    runKey: "",
    status: "Thinking"
  });
  const [scrollDistanceFromBottom, setScrollDistanceFromBottom] = useState(0);
  const selectedChatIdRef = useRef<string | null>(initialChatSelection.id);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatContentRef = useRef<HTMLDivElement | null>(null);
  const composerEditorRef = useRef<HTMLDivElement | null>(null);
  const composerSelectionRef = useRef<TextSelection>({ start: 0, end: 0 });
  const chatDetailRequestRef = useRef(0);
  const sendHandledOnPointerDownRef = useRef(false);
  const promptReceiptClearTimerRef = useRef<number | undefined>(undefined);
  const customKeyboardExitTimerRef = useRef<number | undefined>(undefined);
  const customKeyboardDomSyncFrameRef = useRef<number | undefined>(undefined);
  const customKeyboardDraftSyncTimerRef = useRef<number | undefined>(undefined);
  const pendingCustomKeyboardDraftRef = useRef<{ chatId: string; text: string } | null>(null);
  const customKeyboardEditRef = useRef<{ chatId: string; text: string; selection: TextSelection } | null>(null);
  const keyboardTraceBufferRef = useRef<KeyboardTraceEvent[]>(readPendingKeyboardTrace());
  const keyboardTraceSequenceRef = useRef(0);
  const keyboardTraceSessionRef = useRef(
    globalThis.crypto?.randomUUID?.() ?? "keyboard-" + Date.now() + "-" + Math.random().toString(16).slice(2)
  );
  const scrollButtonLastActivationRef = useRef(0);
  const activeScrollElementRef = useRef<HTMLElement | null>(null);
  const lastScrollPointRef = useRef<{ x: number; y: number } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const dictationStreamRef = useRef<MediaStream | null>(null);
  const dictationChunksRef = useRef<Blob[]>([]);
  const dictationRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const dictationFinalTranscriptRef = useRef("");
  const dictationTranscriptRef = useRef("");
  const dictationChatIdRef = useRef<string | null>(null);
  const dictationDraftSnapshotRef = useRef("");
  const dictationBarsRef = useRef<HTMLDivElement | null>(null);
  const dictationAudioContextRef = useRef<AudioContext | null>(null);
  const dictationAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const dictationWaveformFrameRef = useRef<number | undefined>(undefined);
  const chatShouldAutoScrollRef = useRef(true);
  const forceNextChatScrollRef = useRef(false);
  const preserveChatScrollRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const menuOpenRef = useRef(menuOpen);
  const activeServerJobIdsByChatRef = useRef<Map<string, Set<string>>>(new Map());
  const chatTurnLimitsRef = useRef<Record<string, number>>({});
  const chatMessageViewModesRef = useRef<Record<string, ChatMessageViewMode>>(chatMessageViewModes);
  const edgeSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const notificationStatusRef = useRef<RemoteNotificationState>("default");
  const recordKeyboardTrace = useCallback((event: KeyboardTraceData) => {
    keyboardTraceSequenceRef.current += 1;
    keyboardTraceBufferRef.current.push({
      ...event,
      sequence: keyboardTraceSequenceRef.current,
      capturedAt: Math.round(performance.now() * 100) / 100,
      chatId: selectedChatIdRef.current
    });
    if (keyboardTraceBufferRef.current.length > 3000) {
      keyboardTraceBufferRef.current.splice(0, keyboardTraceBufferRef.current.length - 3000);
    }
  }, []);
  const draft = selectedChatId ? (draftsByChat[selectedChatId] ?? readChatDraft(localStorage, selectedChatId)) : "";
  const latestDraftRef = useRef(draft);
  const customKeyboardDraftPresenceRef = useRef(Boolean(draft.trim()));
  latestDraftRef.current = draft;
  const setDraftForChat = useCallback((chatId: string, text: string) => {
    if (!writeChatDraft(localStorage, chatId, text)) {
      console.warn("[composer] Failed to persist chat draft", { chatId, length: text.length });
    }
    setDraftsByChat((current) => {
      if ((current[chatId] ?? "") === text) {
        return current;
      }

      const next = { ...current };
      if (text) {
        next[chatId] = text;
      } else {
        delete next[chatId];
      }
      return next;
    });
  }, []);
  const setDraft = useCallback(
    (text: string) => {
      const chatId = selectedChatIdRef.current;
      if (chatId) {
        setDraftForChat(chatId, text);
      }
    },
    [setDraftForChat]
  );
  const flushCustomKeyboardDomSync = useCallback(() => {
    window.cancelAnimationFrame(customKeyboardDomSyncFrameRef.current ?? 0);
    customKeyboardDomSyncFrameRef.current = undefined;

    const editor = composerEditorRef.current;
    const chatId = editor?.dataset.chatId;
    const model = customKeyboardEditRef.current;
    if (!editor || !chatId || model?.chatId !== chatId) {
      return;
    }

    composerSelectionRef.current = applyComposerMutation(editor, model.text, model.selection);
    recordKeyboardTrace({
      phase: "dom-flush",
      modelLength: model.text.length,
      domLength: rawTextFromComposerEditor(editor).length,
      caret: model.selection.end
    });
  }, [recordKeyboardTrace]);
  const scheduleCustomKeyboardDomSync = useCallback(() => {
    if (customKeyboardDomSyncFrameRef.current !== undefined) {
      return;
    }

    customKeyboardDomSyncFrameRef.current = window.requestAnimationFrame(() => {
      customKeyboardDomSyncFrameRef.current = undefined;
      const editor = composerEditorRef.current;
      const chatId = editor?.dataset.chatId;
      const model = customKeyboardEditRef.current;
      if (!editor || !chatId || model?.chatId !== chatId) {
        return;
      }

      composerSelectionRef.current = applyComposerMutation(editor, model.text, model.selection);
      recordKeyboardTrace({
        phase: "dom-frame",
        modelLength: model.text.length,
        domLength: rawTextFromComposerEditor(editor).length,
        caret: model.selection.end
      });
    });
  }, [recordKeyboardTrace]);
  const flushCustomKeyboardDraftSync = useCallback(() => {
    window.clearTimeout(customKeyboardDraftSyncTimerRef.current);
    customKeyboardDraftSyncTimerRef.current = undefined;

    const pending = pendingCustomKeyboardDraftRef.current;
    pendingCustomKeyboardDraftRef.current = null;
    if (!pending) {
      return;
    }

    setDraftForChat(pending.chatId, pending.text);
    const editor = composerEditorRef.current;
    if (editor?.dataset.chatId === pending.chatId) {
      setComposerExpanded(composerShouldExpand(editor));
    }
  }, [setDraftForChat]);
  const scheduleCustomKeyboardDraftSync = useCallback((textOverride?: string) => {
    const editor = composerEditorRef.current;
    const chatId = editor?.dataset.chatId;
    if (!editor || !chatId) {
      return;
    }

    const text = textOverride ?? rawTextFromComposerEditor(editor);
    pendingCustomKeyboardDraftRef.current = { chatId, text };
    window.clearTimeout(customKeyboardDraftSyncTimerRef.current);

    // React renders the complete transcript, so do not schedule one for every key.
    // Empty/non-empty transitions stay immediate for Send-button state; full draft
    // persistence happens once the rapid touch stream has been idle briefly.
    const hasContent = customKeyboardDraftPresenceRef.current ? text.length > 0 : /\S/.test(text);
    if (hasContent !== customKeyboardDraftPresenceRef.current) {
      customKeyboardDraftPresenceRef.current = hasContent;
      flushCustomKeyboardDraftSync();
      return;
    }

    customKeyboardDraftSyncTimerRef.current = window.setTimeout(
      flushCustomKeyboardDraftSync,
      customKeyboardDraftSyncDelayMs
    );
  }, [flushCustomKeyboardDraftSync]);
  const rememberComposerSelection = useCallback((editor: HTMLDivElement) => {
    const text = rawTextFromComposerEditor(editor);
    const selection = selectionInsideComposer(editor, composerSelectionRef.current);
    composerSelectionRef.current = selection;
    customKeyboardDraftPresenceRef.current = Boolean(text.trim());
    const chatId = editor.dataset.chatId;
    if (chatId) {
      customKeyboardEditRef.current = { chatId, text, selection };
    }
  }, []);
  const commitComposerEditorState = useCallback(
    (editor: HTMLDivElement, selectionOverride?: TextSelection) => {
      const chatId = editor.dataset.chatId;
      if (!chatId) {
        return;
      }

      const text = rawTextFromComposerEditor(editor);
      const selection = selectionOverride ?? selectionInsideComposer(editor, composerSelectionRef.current);
      window.cancelAnimationFrame(customKeyboardDomSyncFrameRef.current ?? 0);
      customKeyboardDomSyncFrameRef.current = undefined;
      window.clearTimeout(customKeyboardDraftSyncTimerRef.current);
      customKeyboardDraftSyncTimerRef.current = undefined;
      pendingCustomKeyboardDraftRef.current = null;
      composerSelectionRef.current = selection;
      customKeyboardEditRef.current = { chatId, text, selection };
      customKeyboardDraftPresenceRef.current = Boolean(text.trim());
      setDraftForChat(chatId, text);
      setComposerExpanded(composerShouldExpand(editor));
    },
    [setDraftForChat]
  );
  const preserveComposerForTransientFocus = useCallback(() => {
    flushCustomKeyboardDomSync();
    const editor = composerEditorRef.current;
    const chatId = editor?.dataset.chatId;
    if (!editor || !chatId) {
      return null;
    }

    const liveText = rawTextFromComposerEditor(editor);
    const currentModel = customKeyboardEditRef.current?.chatId === chatId ? customKeyboardEditRef.current : null;
    const selection =
      document.activeElement === editor
        ? selectionInsideComposer(editor, currentModel?.selection ?? composerSelectionRef.current)
        : normalizeTextSelection(liveText, currentModel?.selection ?? composerSelectionRef.current);
    const snapshot = {
      chatId,
      text: liveText,
      selection
    };
    window.clearTimeout(customKeyboardDraftSyncTimerRef.current);
    customKeyboardDraftSyncTimerRef.current = undefined;
    pendingCustomKeyboardDraftRef.current = null;
    composerSelectionRef.current = selection;
    customKeyboardEditRef.current = snapshot;
    customKeyboardDraftPresenceRef.current = Boolean(liveText.trim());
    recordKeyboardTrace({
      phase: "attachment-snapshot",
      textLength: liveText.length,
      caret: selection.end,
      editorFocused: document.activeElement === editor
    });
    setDraftForChat(chatId, liveText);
    return snapshot;
  }, [flushCustomKeyboardDomSync, recordKeyboardTrace, setDraftForChat]);
  const restoreComposerAfterTransientFocus = useCallback((snapshot: { chatId: string; text: string; selection: TextSelection } | null, reopenKeyboard: boolean) => {
    const editor = composerEditorRef.current;
    const chatId = editor?.dataset.chatId;
    if (!editor || !chatId || snapshot?.chatId !== chatId) {
      return;
    }

    customKeyboardEditRef.current = snapshot;
    customKeyboardDraftPresenceRef.current = Boolean(snapshot.text.trim());
    recordKeyboardTrace({
      phase: "attachment-restore",
      textLength: snapshot.text.length,
      caret: snapshot.selection.end,
      reopenKeyboard
    });
    if (reopenKeyboard) {
      composerSelectionRef.current = applyComposerMutation(editor, snapshot.text, snapshot.selection);
      setCustomKeyboardOpen(true);
    } else {
      syncComposerEditorText(editor, snapshot.text);
      composerSelectionRef.current = snapshot.selection;
    }
  }, [recordKeyboardTrace]);
  const attachComposerEditor = useCallback((editor: HTMLDivElement | null) => {
    composerEditorRef.current = editor;
    if (!editor) {
      return;
    }

    // Authentication can finish after the draft effect has already run. Restore on the
    // stable editor node itself so a delayed mount never leaves a persisted draft invisible.
    syncComposerEditorText(editor, latestDraftRef.current);
    const end = rawTextFromComposerEditor(editor).length;
    composerSelectionRef.current = { start: end, end };
    customKeyboardDraftPresenceRef.current = Boolean(latestDraftRef.current.trim());
    const chatId = editor.dataset.chatId;
    if (chatId) {
      customKeyboardEditRef.current = {
        chatId,
        text: rawTextFromComposerEditor(editor),
        selection: composerSelectionRef.current
      };
    }
    setComposerExpanded(composerShouldExpand(editor));
  }, []);
  const insertCustomKeyboardText = useCallback(
    (text: string) => {
      const editor = composerEditorRef.current;
      const chatId = editor?.dataset.chatId;
      if (!editor || !chatId) {
        return;
      }

      const current =
        customKeyboardEditRef.current?.chatId === chatId
          ? customKeyboardEditRef.current
          : { chatId, text: rawTextFromComposerEditor(editor), selection: composerSelectionRef.current };
      const mutation = insertTextAtSelection(current.text, current.selection, text);
      const domPatched = patchComposerInsertion(editor, current.text, current.selection, text, mutation.text);
      customKeyboardEditRef.current = { chatId, ...mutation };
      composerSelectionRef.current = mutation.selection;
      recordKeyboardTrace({
        phase: "model-insert",
        value: text,
        beforeLength: current.text.length,
        afterLength: mutation.text.length,
        beforeCaret: current.selection.end,
        afterCaret: mutation.selection.end,
        domPatched,
        domLength: editor.firstChild instanceof Text ? editor.firstChild.length : -1
      });
      scheduleCustomKeyboardDomSync();
      scheduleCustomKeyboardDraftSync(mutation.text);
    },
    [recordKeyboardTrace, scheduleCustomKeyboardDomSync, scheduleCustomKeyboardDraftSync]
  );
  const backspaceCustomKeyboardText = useCallback(() => {
    const editor = composerEditorRef.current;
    const chatId = editor?.dataset.chatId;
    if (!editor || !chatId) {
      return;
    }

    const current =
      customKeyboardEditRef.current?.chatId === chatId
        ? customKeyboardEditRef.current
        : { chatId, text: rawTextFromComposerEditor(editor), selection: composerSelectionRef.current };
    const mutation = deleteTextBackward(current.text, current.selection);
    const domPatched = patchComposerDeletion(editor, current.text, current.selection, mutation);
    customKeyboardEditRef.current = { chatId, ...mutation };
    composerSelectionRef.current = mutation.selection;
    recordKeyboardTrace({
      phase: "model-backspace",
      beforeLength: current.text.length,
      afterLength: mutation.text.length,
      beforeCaret: current.selection.end,
      afterCaret: mutation.selection.end,
      domPatched,
      domLength: editor.firstChild instanceof Text ? editor.firstChild.length : -1
    });
    scheduleCustomKeyboardDomSync();
    scheduleCustomKeyboardDraftSync(mutation.text);
  }, [recordKeyboardTrace, scheduleCustomKeyboardDomSync, scheduleCustomKeyboardDraftSync]);
  const closeCustomKeyboard = useCallback(() => {
    flushCustomKeyboardDomSync();
    flushCustomKeyboardDraftSync();
    setCustomKeyboardOpen(false);
    composerEditorRef.current?.blur();
  }, [flushCustomKeyboardDomSync, flushCustomKeyboardDraftSync]);
  const restoreCustomKeyboardComposerFocus = useCallback(() => {
    flushCustomKeyboardDomSync();
    const editor = composerEditorRef.current;
    if (editor && document.activeElement !== editor) {
      composerSelectionRef.current = restoreComposerSelection(
        editor,
        rawTextFromComposerEditor(editor),
        composerSelectionRef.current
      );
    }
  }, [flushCustomKeyboardDomSync]);

  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(token ? { "x-control-token": token } : {})
    }),
    [token]
  );

  useEffect(() => {
    cleanupLegacyChatHistoryCache();
  }, []);

  useEffect(() => {
    const flushOnPageHide = () => {
      flushCustomKeyboardDomSync();
      flushCustomKeyboardDraftSync();
    };
    const flushOnVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushCustomKeyboardDomSync();
        flushCustomKeyboardDraftSync();
      }
    };

    window.addEventListener("pagehide", flushOnPageHide);
    document.addEventListener("visibilitychange", flushOnVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushOnPageHide);
      document.removeEventListener("visibilitychange", flushOnVisibilityChange);
      flushCustomKeyboardDomSync();
      flushCustomKeyboardDraftSync();
    };
  }, [flushCustomKeyboardDomSync, flushCustomKeyboardDraftSync]);

  useEffect(() => {
    flushCustomKeyboardDomSync();
    flushCustomKeyboardDraftSync();
    composerSelectionRef.current = { start: 0, end: 0 };
    customKeyboardEditRef.current = null;
    customKeyboardDraftPresenceRef.current = Boolean(draft.trim());
  }, [flushCustomKeyboardDomSync, flushCustomKeyboardDraftSync, selectedChatId]);

  useEffect(() => {
    if (!customKeyboardOpen) {
      flushCustomKeyboardDomSync();
      flushCustomKeyboardDraftSync();
    }

    // Do not subscribe to document selectionchange while the virtual keyboard is open.
    // iOS WebKit can deliver stale selection events after rapid pointer taps; those events
    // must never overwrite the explicit caret offset maintained by each custom-key mutation.
  }, [customKeyboardOpen, flushCustomKeyboardDomSync, flushCustomKeyboardDraftSync]);

  useEffect(() => {
    chatTurnLimitsRef.current = chatTurnLimits;
  }, [chatTurnLimits]);

  const selectedJobs = useMemo(() => {
    if (!selectedChatId) {
      return [];
    }

    return mergeJobsForChat(
      chatJobs[selectedChatId] ?? [],
      (state?.runner.recentJobs ?? []).filter((job) => job.chatId === selectedChatId)
    );
  }, [chatJobs, selectedChatId, state?.runner.recentJobs]);
  const selectedChatMessageViewMode = selectedChatId ? (chatMessageViewModes[selectedChatId] ?? defaultChatMessageViewMode) : defaultChatMessageViewMode;
  const selectedChatMessageViewMeta = chatMessageViewModeMeta(selectedChatMessageViewMode);
  const projectOptions = useMemo(() => chatIndex?.projects ?? [], [chatIndex?.projects]);
  const normalizedSidebarSearch = sidebarSearch.trim().toLowerCase();

  useEffect(() => {
    if (!menuOpen) {
      setSidebarOrderSnapshot(null);
      return;
    }

    if (chatIndex) {
      setSidebarOrderSnapshot((current) => current ?? captureSidebarOrder(chatIndex.projects));
    }
  }, [chatIndex, menuOpen]);

  const sidebarProjectGroups = useMemo(() => {
    if (!chatIndex) {
      return [];
    }

    return menuOpen && sidebarOrderSnapshot
      ? applySidebarOrder(chatIndex.projects, sidebarOrderSnapshot)
      : chatIndex.projects;
  }, [chatIndex, menuOpen, sidebarOrderSnapshot]);

  const filteredProjectGroups = useMemo(() => {
    if (!normalizedSidebarSearch) {
      return sidebarProjectGroups;
    }

    return sidebarProjectGroups
      .map((project) => {
        const projectMatches = project.projectName.toLowerCase().includes(normalizedSidebarSearch);
        const chats = projectMatches
          ? project.chats
          : project.chats.filter((chat) => chat.title.toLowerCase().includes(normalizedSidebarSearch));

        return chats.length
          ? {
              ...project,
              chats
            }
          : null;
      })
      .filter((project): project is ChatProjectGroup => Boolean(project));
  }, [normalizedSidebarSearch, sidebarProjectGroups]);
  const queuedServerJobs = useMemo(() => {
    const jobsById = new Map<string, CodexRunJob>();

    for (const job of state?.runner.recentJobs ?? []) {
      if (job.status === "queued") {
        jobsById.set(job.id, job);
      }
    }

    for (const jobs of Object.values(chatJobs)) {
      for (const job of jobs) {
        if (job.status === "queued") {
          jobsById.set(job.id, job);
        }
      }
    }

    return sortJobsForChat([...jobsById.values()]);
  }, [chatJobs, state?.runner.recentJobs]);
  const selectedQueuedServerJobs = useMemo(
    () => (selectedChatId ? queuedServerJobs.filter((job) => job.chatId === selectedChatId) : []),
    [queuedServerJobs, selectedChatId]
  );
  const activeRunJobs = useMemo(() => {
    const jobsById = new Map<string, CodexRunJob>();

    const addJob = (job: CodexRunJob) => {
      if (!isActiveJob(job)) {
        return;
      }

      jobsById.set(job.id, { ...jobsById.get(job.id), ...job });
    };

    for (const job of state?.runner.recentJobs ?? []) {
      addJob(job);
    }

    for (const jobs of Object.values(chatJobs)) {
      for (const job of jobs) {
        addJob(job);
      }
    }

    return sortJobsForChat([...jobsById.values()]);
  }, [chatJobs, state?.runner.recentJobs]);
  const activeRunJobKey = useMemo(
    () =>
      activeRunJobs
        .filter((job) => job.status === "running")
        .map((job) => job.id)
        .join("|"),
    [activeRunJobs]
  );
  const chatSummaryById = useMemo(() => {
    const chats = new Map<string, ChatSummary>();

    for (const project of chatIndex?.projects ?? []) {
      for (const chat of project.chats) {
        chats.set(chat.id, chat);
      }
    }

    return chats;
  }, [chatIndex]);
  const firstIndexedChatId = useMemo(() => firstChatId(chatIndex), [chatIndex]);
  const selectedChatSummaryId =
    selectedChatId && (isTemporaryChatId(selectedChatId) || chatSummaryById.has(selectedChatId)) ? selectedChatId : firstIndexedChatId;
  const selectedChatSummary = selectedChatSummaryId ? (chatSummaryById.get(selectedChatSummaryId) ?? null) : null;
  const selectedChatForActions = useMemo<ChatDetail | null>(() => {
    if (selectedChat) {
      return selectedChat;
    }

    if (!selectedChatSummary) {
      return null;
    }

    return {
      id: selectedChatSummary.id,
      title: selectedChatSummary.title,
      projectName: selectedChatSummary.projectName,
      projectPath: selectedChatSummary.projectPath,
      createdAt: selectedChatSummary.createdAt,
      updatedAt: selectedChatSummary.updatedAt,
      lastPrompt: null,
      lastResponse: null,
      messages: [],
      messagePage: {
        visibleTurns: 0,
        totalTurns: 0,
        hasMore: false
      },
      hasResponse: selectedChatSummary.hasResponse
    };
  }, [selectedChat, selectedChatSummary]);
  const busyServerChatIds = useMemo(() => {
    const chatIds = new Set<string>();

    for (const job of state?.runner.recentJobs ?? []) {
      if (isActiveJob(job)) {
        chatIds.add(job.chatId);
      }
    }

    for (const jobs of Object.values(chatJobs)) {
      for (const job of jobs) {
        if (isActiveJob(job)) {
          chatIds.add(job.chatId);
        }
      }
    }

    return chatIds;
  }, [chatJobs, state?.runner.recentJobs]);
  const activeJobsByChatId = useMemo(() => {
    const activeJobs = new Map<string, { count: number; running: boolean }>();
    const seenJobIds = new Set<string>();

    const addJob = (job: CodexRunJob) => {
      if (!isActiveJob(job) || seenJobIds.has(job.id)) {
        return;
      }

      seenJobIds.add(job.id);
      const current = activeJobs.get(job.chatId) ?? { count: 0, running: false };
      activeJobs.set(job.chatId, {
        count: current.count + 1,
        running: current.running || job.status === "running"
      });
    };

    for (const job of state?.runner.recentJobs ?? []) {
      addJob(job);
    }

    for (const jobs of Object.values(chatJobs)) {
      for (const job of jobs) {
        addJob(job);
      }
    }

    return activeJobs;
  }, [chatJobs, state?.runner.recentJobs]);
  const trackServerJob = useCallback((job: CodexRunJob) => {
    const activeJobs = activeServerJobIdsByChatRef.current;
    const current = new Set(activeJobs.get(job.chatId));

    if (isActiveJob(job)) {
      current.add(job.id);
      activeJobs.set(job.chatId, current);
      return;
    }

    current.delete(job.id);

    if (current.size) {
      activeJobs.set(job.chatId, current);
    } else {
      activeJobs.delete(job.chatId);
    }
  }, []);
  const replaceTrackedServerJobsForChat = useCallback((chatId: string, jobs: CodexRunJob[]) => {
    const activeJobs = activeServerJobIdsByChatRef.current;

    if (!jobs.length) {
      activeJobs.delete(chatId);
      return;
    }

    const current = new Set(activeJobs.get(chatId));

    for (const job of jobs) {
      if (isActiveJob(job)) {
        current.add(job.id);
      } else {
        current.delete(job.id);
      }
    }

    if (current.size) {
      activeJobs.set(chatId, current);
    } else {
      activeJobs.delete(chatId);
    }
  }, []);
  const serverChatIsBusyNow = useCallback((chatId: string) => {
    return Boolean(activeServerJobIdsByChatRef.current.get(chatId)?.size);
  }, []);
  const selectedJob = selectedJobs.find(isActiveJob);
  const selectedPromptReceipt = promptReceipt?.chatId === selectedChatId ? promptReceipt : null;
  const selectedQueueCount = selectedQueuedServerJobs.length;
  const selectedMessagePage = selectedChat?.messagePage;
  const selectedCanLoadMoreMessages = Boolean(selectedChatId && selectedMessagePage?.hasMore);
  const runFailureMessages = useMemo<VisibleChatMessage[]>(
    () =>
      selectedJobs
        .filter((job) => job.status === "failed" || job.status === "stopped")
        .map((job) => ({
          id: `run-status-${job.id}`,
          role: "assistant" as const,
          text: jobDetailText(job),
          createdAt: job.finishedAt ?? job.createdAt,
          isRunFailure: true
        })),
    [selectedJobs]
  );
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
        kind: "user_prompt",
        label: "You",
        text: selectedChat.lastPrompt.text,
        createdAt: selectedChat.lastPrompt.createdAt
      });
    }

    if (selectedChat.lastResponse) {
      fallback.push({
        id: "last-response",
        role: "assistant",
        kind: "assistant_final",
        label: "Codex",
        text: selectedChat.lastResponse.text,
        createdAt: selectedChat.lastResponse.createdAt,
        isFinal: true
      });
    }

    return fallback;
  }, [selectedChat]);
  const timelineMessages = useMemo<VisibleChatMessage[]>(
    () => {
      const firstTranscriptMs = Date.parse(transcriptMessages[0]?.createdAt ?? "");
      const scopedRunFailures = Number.isFinite(firstTranscriptMs)
        ? runFailureMessages.filter((message) => (Date.parse(message.createdAt) || 0) >= firstTranscriptMs)
        : runFailureMessages;

      return [...transcriptMessages, ...scopedRunFailures]
        .sort((a, b) => {
          const byTime = (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0);

          if (byTime !== 0) {
            return byTime;
          }

          return a.id.localeCompare(b.id);
        });
    },
    [runFailureMessages, transcriptMessages]
  );
  const visibleMessages = useMemo(
    () => messagesForViewMode(timelineMessages, selectedChatMessageViewMode, selectedJob),
    [durationNow, selectedChatMessageViewMode, selectedJob, timelineMessages]
  );
  const visibleMessageItems = useMemo(() => {
    const occurrences = new Map<string, number>();

    return visibleMessages.map((message) => {
      const signature = chatMessageStableSignature(message);
      const occurrence = occurrences.get(signature) ?? 0;
      occurrences.set(signature, occurrence + 1);

      // Do not key rendered chat bubbles by backend message.id here. Quiet polling can re-read
      // identical transcript content with different IDs/metadata, and iOS PWAs visibly repaint
      // the transcript when React remounts those bubbles every polling tick.
      return {
        message,
        renderKey: chatMessageStableRenderKey(message, occurrence)
      };
    });
  }, [visibleMessages]);
  const liveThinkingMessage = visibleMessages.find((message) => message.isLiveThinking);
  const selectedViewHasLiveThinking = Boolean(liveThinkingMessage);
  const liveThinkingRunKey = liveThinkingMessage ? `${selectedChatId ?? "chat"}:${liveThinkingMessage.id}` : "";
  const liveThinkingStatus =
    liveThinkingDisplay.runKey === liveThinkingRunKey ? liveThinkingDisplay.status : "Thinking";
  const lastVisibleMessageKey = visibleMessageItems.at(-1)?.renderKey ?? "";
  const chatShellIsLoading =
    loadingDetail || (loadingChats && !selectedChat) || Boolean(authenticated && selectedChatId && !selectedChat && !chatIndex);
  const topbarTitle = selectedChat?.title ?? selectedChatSummary?.title ?? (chatShellIsLoading ? "Loading chat" : "Select a chat");
  const serverDisplayName = state?.server.name || "Codex";

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

      if (response.status === 401) {
        localStorage.removeItem(tokenKey);
        setToken("");
        setLoginToken("");
        setAuthenticated(false);
        setState(null);
        setAuthError("Authentication expired. Enter the current control token.");
      }

      if (!response.ok) {
        throw new Error(payload.message ?? "Request failed");
      }

      return payload;
    },
    [authHeaders]
  );
  const flushKeyboardTrace = useCallback(
    async (reason: string) => {
      const events = keyboardTraceBufferRef.current.splice(0);
      if (!events.length) {
        return;
      }

      try {
        await apiFetch<{ ok: boolean }>("/api/debug/keyboard-events", {
          method: "POST",
          body: JSON.stringify({
            sessionId: keyboardTraceSessionRef.current,
            reason,
            userAgent: navigator.userAgent,
            events
          })
        });
        localStorage.removeItem(keyboardTraceStorageKey);
      } catch {
        keyboardTraceBufferRef.current.unshift(...events);
        if (keyboardTraceBufferRef.current.length > 3000) {
          keyboardTraceBufferRef.current.length = 3000;
        }
        try {
          localStorage.setItem(
            keyboardTraceStorageKey,
            JSON.stringify(keyboardTraceBufferRef.current.slice(-1000))
          );
        } catch {
          // A trace must never interfere with prompt delivery.
        }
      }
    },
    [apiFetch]
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

  const updateRunSettings = useCallback(
    async (patch: Partial<Pick<CodexRunSettings, "model" | "reasoningEffort" | "speed">>) => {
      if (!authenticated) {
        return;
      }

      setSettingsSaving(true);

      try {
        const result = await apiFetch<RunSettingsResult>("/api/run-settings", {
          method: "PATCH",
          body: JSON.stringify(patch)
        });

        setState((current) =>
          current
            ? {
                ...current,
                runner: {
                  ...current.runner,
                  settings: result.settings,
                  settingsOptions: result.options
                }
              }
            : current
        );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not update run settings");
      } finally {
        setSettingsSaving(false);
      }
    },
    [apiFetch, authenticated]
  );

  const ensureNotificationRegistration = useCallback(async () => {
    if (!supportsServiceWorkerNotifications()) {
      throw new Error("Notifications are not supported in this browser mode");
    }

    return navigator.serviceWorker.register("/sw.js");
  }, []);

  const refreshNotificationStatus = useCallback(async () => {
    if (!authenticated) {
      return;
    }

    if (!supportsServiceWorkerNotifications()) {
      setNotificationStatus("unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      setNotificationStatus("denied");
      return;
    }

    if (!supportsPushNotifications()) {
      setNotificationStatus(Notification.permission === "granted" ? "local" : "default");
      return;
    }

    try {
      const registration = await ensureNotificationRegistration();
      const { publicKey } = await apiFetch<PushPublicKeyResult>("/api/notifications/public-key");
      let subscription = await getFreshPushSubscription(registration, publicKey);

      if (!subscription && Notification.permission === "granted") {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
      }

      if (Notification.permission === "granted" && subscription) {
        await apiFetch<ApiResult>("/api/notifications/subscribe", {
          method: "POST",
          body: JSON.stringify({ subscription: subscription.toJSON() })
        });
        setNotificationStatus("enabled");
        return;
      }

      setNotificationStatus(Notification.permission === "granted" ? "default" : Notification.permission);
    } catch {
      setNotificationStatus(Notification.permission === "granted" ? "local" : "default");
    }
  }, [apiFetch, authenticated, ensureNotificationRegistration]);

  const showLocalNotification = useCallback(
    async (payload: { title: string; body: string; tag: string; chatId?: string; jobId?: string }) => {
      if (!supportsServiceWorkerNotifications() || Notification.permission !== "granted") {
        return;
      }

      try {
        const registration = await ensureNotificationRegistration();
        await registration.showNotification(payload.title, {
          body: payload.body,
          tag: payload.tag,
          icon: "/icon-192.png",
          badge: "/apple-touch-icon.png",
          data: {
            url: "/",
            chatId: payload.chatId,
            jobId: payload.jobId
          }
        });
      } catch {
        return;
      }
    },
    [ensureNotificationRegistration]
  );

  const localNotificationCopyForJob = useCallback(
    async (job: CodexRunJob) => {
      try {
        const chat = await apiFetch<ChatDetail>(`/api/chats/${encodeURIComponent(job.chatId)}`);
        return completionNotificationCopy(job, chat);
      } catch {
        return completionNotificationCopy(job);
      }
    },
    [apiFetch]
  );

  const sendTestNotification = useCallback(async () => {
    const result = await apiFetch<PushTestResult>("/api/notifications/test", {
      method: "POST",
      body: JSON.stringify({})
    });

    if (result.result.sent === 0) {
      await showLocalNotification({
        title: "Codex notifications are on",
        body: "You will get a notification when a remote Codex run finishes.",
        tag: "codex-remote-test"
      });
    }
  }, [apiFetch, showLocalNotification]);

  const enableNotifications = useCallback(async () => {
    if (!supportsServiceWorkerNotifications()) {
      setNotificationStatus("unsupported");
      setNotice("Notifications are not supported in this browser mode.");
      return;
    }

    setNotificationBusy(true);

    try {
      const registration = await ensureNotificationRegistration();
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();

      if (permission === "denied") {
        setNotificationStatus("denied");
        setNotice("Notifications are blocked. Enable them in browser settings, then try again.");
        return;
      }

      if (permission !== "granted") {
        setNotificationStatus("default");
        setNotice("Notification permission was not granted.");
        return;
      }

      if (!supportsPushNotifications()) {
        setNotificationStatus("local");
        await showLocalNotification({
          title: "Codex notifications are on",
          body: "This browser can show notifications while the app is open.",
          tag: "codex-remote-local-test"
        });
        return;
      }

      const { publicKey } = await apiFetch<PushPublicKeyResult>("/api/notifications/public-key");
      let subscription = await getFreshPushSubscription(registration, publicKey);

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
      }

      await apiFetch<ApiResult>("/api/notifications/subscribe", {
        method: "POST",
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });

      setNotificationStatus("enabled");
      await sendTestNotification();
      setNotice("Notifications enabled. A test notification was sent.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not enable notifications");
      await refreshNotificationStatus();
    } finally {
      setNotificationBusy(false);
    }
  }, [apiFetch, ensureNotificationRegistration, refreshNotificationStatus, sendTestNotification, showLocalNotification]);

  const handleNotificationsClick = useCallback(() => {
    if (notificationStatusRef.current === "enabled") {
      setNotificationBusy(true);
      void sendTestNotification()
        .then(() => setNotice("Test notification sent."))
        .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not send test notification"))
        .finally(() => setNotificationBusy(false));
      return;
    }

    void enableNotifications();
  }, [enableNotifications, sendTestNotification]);

  const verifyToken = useCallback(
    async (value: string) => {
      const verifiesStoredToken = localStorage.getItem(tokenKey) === value;
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
        if (verifiesStoredToken) {
          localStorage.removeItem(tokenKey);
          setToken("");
          setLoginToken("");
        }
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
      setSelectedChatId((current) => {
        const next = current && (isTemporaryChatId(current) || chatIndexContainsChat(index, current)) ? current : firstChatId(index);

        if (next) {
          selectedChatIdRef.current = next;
        }

        return next;
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load chats");
    } finally {
      setLoadingChats(false);
    }
  }, [apiFetch, authenticated]);

  const chatIsNearBottom = useCallback((element = activeScrollElementRef.current ?? chatContentRef.current) => {
    if (!element) {
      return true;
    }

    return element.scrollHeight - element.scrollTop - element.clientHeight < 96;
  }, []);

  const isScrollableElement = useCallback((element: Element | null | undefined): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    return element.scrollHeight > element.clientHeight + 1;
  }, []);

  const isChatScrollElement = useCallback((element: HTMLElement) => {
    return element === chatContentRef.current || Boolean(element.closest(".chat-workspace"));
  }, []);

  const findScrollableAncestor = useCallback(
    (target: EventTarget | Element | null | undefined) => {
      let current = target instanceof Element ? target : null;

      while (current) {
        if (isScrollableElement(current) && isChatScrollElement(current)) {
          return current;
        }

        current = current.parentElement;
      }

      return isScrollableElement(chatContentRef.current) ? chatContentRef.current : null;
    },
    [isChatScrollElement, isScrollableElement]
  );

  const findScrollElementAtPoint = useCallback(() => {
    const point = lastScrollPointRef.current ?? {
      x: Math.round(window.innerWidth / 2),
      y: Math.round(window.innerHeight / 2)
    };
    const elements = document.elementsFromPoint(point.x, point.y);

    for (const element of elements) {
      const scroller = findScrollableAncestor(element);

      if (scroller) {
        return scroller;
      }
    }

    return null;
  }, [findScrollableAncestor]);

  const resolveScrollElement = useCallback(
    (preferred?: HTMLElement | null) => {
      if (isScrollableElement(preferred) && isChatScrollElement(preferred)) {
        return preferred;
      }

      const active = activeScrollElementRef.current;

      if (active && document.contains(active) && isScrollableElement(active) && isChatScrollElement(active)) {
        return active;
      }

      const pointScroller = findScrollElementAtPoint();

      if (pointScroller) {
        return pointScroller;
      }

      if (isScrollableElement(chatContentRef.current)) {
        return chatContentRef.current;
      }

      const documentScroller = document.scrollingElement;
      return documentScroller instanceof HTMLElement ? documentScroller : null;
    },
    [findScrollElementAtPoint, isScrollableElement]
  );

  const collectScrollTargets = useCallback(() => {
    const seen = new Set<HTMLElement>();
    const targets: HTMLElement[] = [];

    const addTarget = (element: Element | null | undefined) => {
      if (!isScrollableElement(element) || seen.has(element)) {
        return;
      }

      seen.add(element);
      targets.push(element);
    };

    addTarget(resolveScrollElement());
    addTarget(findScrollElementAtPoint());
    addTarget(chatContentRef.current);

    document.querySelectorAll<HTMLElement>(".chat-content, .chat-thread, .chat-workspace, .remote-shell").forEach((element) => {
      addTarget(element);
    });

    return targets;
  }, [findScrollElementAtPoint, isScrollableElement, resolveScrollElement]);

  const updateScrollDebugPosition = useCallback((element?: HTMLElement | null) => {
    const target = resolveScrollElement(element);

    if (!target) {
      setScrollDistanceFromBottom(0);
      return;
    }

    activeScrollElementRef.current = target;

    const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
    const distanceFromBottom = Math.max(0, Math.round(maxScrollTop - target.scrollTop));

    setScrollDistanceFromBottom(distanceFromBottom);
  }, [resolveScrollElement]);

  const updateChatAutoScrollState = useCallback((event?: { currentTarget?: HTMLDivElement }) => {
    const scroller = event?.currentTarget ?? resolveScrollElement();
    chatShouldAutoScrollRef.current = chatIsNearBottom(scroller);
    updateScrollDebugPosition(scroller);
  }, [chatIsNearBottom, resolveScrollElement, updateScrollDebugPosition]);

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const refreshScrollPosition = () => {
      updateScrollDebugPosition(resolveScrollElement());
    };

    const performScroll = (nextBehavior: ScrollBehavior) => {
      const targets = collectScrollTargets();

      for (const element of targets) {
        const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
        if (nextBehavior === "smooth") {
          element.scrollTo({ top: maxScrollTop, left: 0, behavior: "smooth" });
        } else {
          element.scrollTop = maxScrollTop;
          element.scrollTo({ top: maxScrollTop, left: 0, behavior: "auto" });
        }
      }

      if (!targets.length) {
        chatEndRef.current?.scrollIntoView({ block: "end", inline: "nearest" });
      }

      refreshScrollPosition();
    };

    performScroll(behavior);

    if (behavior === "smooth") {
      window.requestAnimationFrame(refreshScrollPosition);
      window.setTimeout(refreshScrollPosition, 300);
      window.setTimeout(() => performScroll("auto"), 900);
    } else {
      window.requestAnimationFrame(() => performScroll("auto"));
      window.setTimeout(() => performScroll("auto"), 80);
      window.setTimeout(() => performScroll("auto"), 300);
    }

    chatShouldAutoScrollRef.current = true;
  }, [collectScrollTargets, resolveScrollElement, updateScrollDebugPosition]);

  const requestChatScroll = useCallback((force = true) => {
    if (force) {
      forceNextChatScrollRef.current = true;
    }

    setChatScrollVersion((version) => version + 1);
  }, []);

  const loadChatDetail = useCallback(
    async (
      chatId: string,
      quiet = false,
      requestedTurns?: number,
      requestedMode?: ChatMessageViewMode
    ) => {
      const requestId = chatDetailRequestRef.current + 1;
      chatDetailRequestRef.current = requestId;
      const messageMode = requestedMode ?? chatMessageViewModesRef.current[chatId] ?? defaultChatMessageViewMode;
      const cachedDetail = getCachedChatHistory(chatId, messageMode);
      const turns = Math.max(1, requestedTurns ?? chatTurnLimitsRef.current[chatId] ?? defaultChatTurns);
      const preserveExistingMessages = quiet && requestedMode === undefined;

      if (!quiet) {
        setLoadingDetail(!cachedDetail);
      }

      const cachedTurns = cachedDetail?.messagePage?.visibleTurns ?? defaultChatTurns;

      // Cache is for foreground loads only. Applying cached detail during quiet polling causes a
      // cache-to-server transcript bounce every interval, which is visible as flicker in iOS PWAs.
      if (!quiet && cachedDetail && cachedTurns >= turns && requestId === chatDetailRequestRef.current && selectedChatIdRef.current === chatId) {
        setSelectedChat((current) => {
          const next = mergeChatDetailPreservingOptimistic(current, cachedDetail, preserveExistingMessages);

          // Quiet polling is a freshness check. Do not replace the rendered chat for volatile IDs/status/metadata churn:
          // iOS PWAs repaint and can jump scroll every polling tick when the transcript array is needlessly replaced.
          if (quiet && sameChatDetailForQuietRefresh(current, next)) {
            return current;
          }

          return sameChatDetailForRender(current, next) ? current : next;
        });
        if (!quiet) {
          requestChatScroll();
        }
      }

      try {
        const detail = await apiFetch<ChatDetail>(
          `/api/chats/${encodeURIComponent(chatId)}?turns=${encodeURIComponent(String(turns))}&mode=${encodeURIComponent(messageMode)}`
        );

        if (requestId !== chatDetailRequestRef.current || selectedChatIdRef.current !== chatId) {
          return;
        }

        setSelectedChat((current) => {
          // Quiet refreshes return a moving last-N-turn window. Keep the already-rendered
          // prefix and merge the new tail into it; dropping the first turn here changes the
          // scroll height underneath mobile Safari every time a new prompt reaches Codex.
          const next = mergeChatDetailPreservingOptimistic(current, detail, preserveExistingMessages);

          // Quiet polling is a freshness check. Do not replace the rendered chat for volatile IDs/status/metadata churn:
          // iOS PWAs repaint and can jump scroll every polling tick when the transcript array is needlessly replaced.
          if (quiet && sameChatDetailForQuietRefresh(current, next)) {
            return current;
          }

          return sameChatDetailForRender(current, next) ? current : next;
        });
        if (!quiet) {
          requestChatScroll();
        }
      } catch (error) {
        if (requestId !== chatDetailRequestRef.current || selectedChatIdRef.current !== chatId) {
          return;
        }

        setNotice(error instanceof Error ? error.message : "Could not load chat");
      } finally {
        if (requestId === chatDetailRequestRef.current && selectedChatIdRef.current === chatId) {
          setLoadingDetail(false);
        }
      }
    },
    [apiFetch, requestChatScroll]
  );

  const loadChatJobs = useCallback(
    async (chatId: string) => {
      try {
        const result = await apiFetch<ChatJobsResult>(`/api/chats/${encodeURIComponent(chatId)}/jobs`);
        replaceTrackedServerJobsForChat(chatId, result.jobs);
        setChatJobs((current) => {
          const nextJobs = sortJobsForChat(result.jobs).slice(0, 40);

          return sameJobsForRender(current[chatId], nextJobs)
            ? current
            : {
                ...current,
                [chatId]: nextJobs
              };
        });
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not load command queue");
      }
    },
    [apiFetch, replaceTrackedServerJobsForChat]
  );

  const loadShortcutInstructions = useCallback(async () => {
    if (!authenticated) {
      return;
    }

    setInstructionsLoading(true);
    setInstructionsError("");

    try {
      setShortcutInstructions(await apiFetch<ShortcutInstructionsResult>("/api/shortcut-instructions"));
    } catch (error) {
      setInstructionsError(error instanceof Error ? error.message : "Could not load shortcut instructions");
    } finally {
      setInstructionsLoading(false);
    }
  }, [apiFetch, authenticated]);

  const copyInstructions = useCallback(
    async (files: ShortcutInstructionFile[]) => {
      try {
        await navigator.clipboard.writeText(formatShortcutInstructions(files));
        setNotice(files.length === 1 ? "Instruction file copied" : "Shortcut instructions copied");
      } catch {
        setNotice("Clipboard copy is unavailable in this browser");
      }
    },
    []
  );

  const openInstructionFile = useCallback((file: ShortcutInstructionFile) => {
    setSelectedInstructionFile(file);
    setSelectedInstructionContent(file.content ?? "");
    setSelectedInstructionError("");
    setSelectedInstructionLoading(true);
  }, []);

  const openLocalTextFile = useCallback((filePath: string, label: string) => {
    const params = new URLSearchParams({ path: filePath });
    const name = localFileLabel(filePath, label);

    setSelectedInstructionFile({
      name,
      path: filePath,
      relativePath: name,
      mediaUrl: `/api/local-file?${params.toString()}`,
      size: 0,
      updatedAt: new Date().toISOString(),
      content: ""
    });
    setSelectedInstructionContent("");
    setSelectedInstructionError("");
    setSelectedInstructionLoading(true);
  }, []);

  const openLocalPdfFile = useCallback((filePath: string, label: string) => {
    setSelectedPdfFile({
      path: filePath,
      label: localFileLabel(filePath, label),
      mediaUrl: localDownloadUrl(filePath, token, "inline"),
      downloadUrl: localDownloadUrl(filePath, token, "attachment")
    });
  }, [token]);

  const closeInstructionFile = useCallback(() => {
    setSelectedInstructionFile(null);
    setSelectedInstructionContent("");
    setSelectedInstructionError("");
    setSelectedInstructionLoading(false);
  }, []);

  const closePdfFile = useCallback(() => {
    setSelectedPdfFile(null);
    setPdfDownloading(false);
  }, []);

  const downloadSelectedPdfFile = useCallback(async () => {
    if (!selectedPdfFile || pdfDownloading) {
      return;
    }

    setPdfDownloading(true);

    try {
      const response = await fetch(selectedPdfFile.downloadUrl, {
        headers: token ? { "x-control-token": token } : undefined
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Could not download PDF");
      }

      const blob = await response.blob();
      const fileName = localFileDownloadName(selectedPdfFile.path, selectedPdfFile.label, ".pdf");
      const file = new File([blob], fileName, { type: blob.type || "application/pdf" });
      const sharePayload: ShareData = {
        files: [file],
        title: selectedPdfFile.label
      };

      if (navigator.canShare?.(sharePayload) && navigator.share) {
        await navigator.share(sharePayload);
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not download PDF");
    } finally {
      setPdfDownloading(false);
    }
  }, [pdfDownloading, selectedPdfFile, token]);

  const rememberJob = useCallback(
    (job: CodexRunJob) => {
      trackServerJob(job);
      setChatJobs((current) => ({
        ...current,
        [job.chatId]: mergeJobsForChat(current[job.chatId] ?? [], [job])
      }));
    },
    [trackServerJob]
  );

  const startPromptReceipt = useCallback((chatId: string, promptText: string, message = "Sending to server") => {
    const receipt: PromptReceipt = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      chatId,
      status: "sending",
      promptPreview: previewText(promptText, "Prompt"),
      message,
      createdAt: new Date().toISOString()
    };

    if (promptReceiptClearTimerRef.current !== undefined) {
      window.clearTimeout(promptReceiptClearTimerRef.current);
      promptReceiptClearTimerRef.current = undefined;
    }

    setPromptReceipt(receipt);
    return receipt.id;
  }, []);

  const finishPromptReceipt = useCallback((receiptId: string, message = "Server received") => {
    setPromptReceipt((current) => (current?.id === receiptId ? { ...current, status: "received", message } : current));

    if (promptReceiptClearTimerRef.current !== undefined) {
      window.clearTimeout(promptReceiptClearTimerRef.current);
    }

    promptReceiptClearTimerRef.current = window.setTimeout(() => {
      setPromptReceipt((current) => (current?.id === receiptId ? null : current));
      promptReceiptClearTimerRef.current = undefined;
    }, 1400);
  }, []);

  const clearPromptReceipt = useCallback((receiptId?: string) => {
    if (promptReceiptClearTimerRef.current !== undefined) {
      window.clearTimeout(promptReceiptClearTimerRef.current);
      promptReceiptClearTimerRef.current = undefined;
    }

    setPromptReceipt((current) => (!receiptId || current?.id === receiptId ? null : current));
  }, []);

  const refreshWorkspace = useCallback(async () => {
    if (!authenticated) {
      return;
    }

    setNotice("");
    await Promise.all([
      loadChats(),
      loadState(),
      selectedChatId
        ? loadChatDetail(selectedChatId, true)
        : Promise.resolve(),
      selectedChatId ? loadChatJobs(selectedChatId) : Promise.resolve()
    ]);
  }, [authenticated, loadChatDetail, loadChatJobs, loadChats, loadState, selectedChatId]);

  const refreshSelectedChat = useCallback(async () => {
    const chatId = selectedChatIdRef.current;

    if (!authenticated || !chatId || refreshingChat) {
      return;
    }

    setNotice("");
    setRefreshingChat(true);

    try {
      await loadChatJobs(chatId);
      await loadChatDetail(chatId, true);
    } finally {
      setRefreshingChat(false);
    }
  }, [authenticated, loadChatDetail, loadChatJobs, refreshingChat]);

  const cycleSelectedChatMessageViewMode = useCallback(() => {
    const chatId = selectedChatIdRef.current;

    if (!chatId) {
      return;
    }

    const nextMode = nextChatMessageViewMode(chatMessageViewModesRef.current[chatId] ?? defaultChatMessageViewMode);
    setChatMessageViewModes((current) => {
      const next = {
        ...current,
        [chatId]: nextMode
      };
      chatMessageViewModesRef.current = next;
      return next;
    });
    setSelectedChat((current) => getCachedChatHistory(chatId, nextMode) ?? current);
    void loadChatDetail(chatId, true, undefined, nextMode);
  }, [loadChatDetail]);

  const loadMoreMessages = useCallback(async () => {
    const chatId = selectedChatIdRef.current;

    if (!authenticated || !chatId || loadingMoreMessages) {
      return;
    }

    const currentLimit = chatTurnLimitsRef.current[chatId] ?? selectedChat?.messagePage?.visibleTurns ?? defaultChatTurns;
    const nextLimit = currentLimit + chatTurnPageSize;
    const scroller = chatContentRef.current;

    preserveChatScrollRef.current = scroller
      ? {
          scrollHeight: scroller.scrollHeight,
          scrollTop: scroller.scrollTop
        }
      : null;

    setLoadingMoreMessages(true);
    setChatTurnLimits((current) => {
      const next = { ...current, [chatId]: nextLimit };
      chatTurnLimitsRef.current = next;
      return next;
    });

    try {
      await loadChatDetail(chatId, true, nextLimit);
      requestChatScroll(false);
    } finally {
      setLoadingMoreMessages(false);
    }
  }, [authenticated, loadChatDetail, loadingMoreMessages, requestChatScroll, selectedChat?.messagePage?.visibleTurns]);

  const openRunBoard = useCallback(() => {
    setRunBoardOpen(true);
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);

  const closeRunBoard = useCallback(() => {
    setRunBoardOpen(false);

    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => undefined);
    }
  }, []);

  const selectStartedChat = useCallback(
    async (chat: ChatDetail) => {
      rememberCachedChatHistory(chat);
      chatDetailRequestRef.current += 1;
      selectedChatIdRef.current = chat.id;
      setSelectedChatId(chat.id);
      setSelectedChat(chat);
      setChatTurnLimits((current) => ({ ...current, [chat.id]: Math.max(chat.messagePage?.visibleTurns ?? defaultChatTurns, defaultChatTurns) }));
      setProjectActionMode(null);
      setProjectActionError("");
      setChatActionMode(null);
      setChatActionError("");
      setInstructionsOpen(false);
      setMenuOpen(false);
      requestChatScroll();
      await loadChats();
      selectedChatIdRef.current = chat.id;
      setSelectedChatId(chat.id);
      setSelectedChat(chat);
      void loadChatJobs(chat.id);
      void loadChatDetail(chat.id, true);
    },
    [loadChatDetail, loadChatJobs, loadChats, requestChatScroll]
  );

  function upsertChatSummary(chat: ChatDetail, previousChatId?: string) {
    setChatIndex((current) => {
      if (!current) {
        return current;
      }

      const summary = summaryFromChat(chat);
      let foundProject = false;
      let addedNewChat = false;
      const projects = current.projects.map((project) => {
        const filteredChats = project.chats.filter((candidate) => candidate.id !== chat.id && candidate.id !== previousChatId);

        if (project.projectPath !== chat.projectPath) {
          return {
            ...project,
            chats: filteredChats
          };
        }

        foundProject = true;
        addedNewChat = !project.chats.some((candidate) => candidate.id === chat.id || candidate.id === previousChatId);

        return {
          ...project,
          updatedAt: chat.updatedAt,
          chats: [summary, ...filteredChats]
        };
      });

      if (!foundProject) {
        addedNewChat = true;
        projects.unshift({
          projectName: chat.projectName,
          projectPath: chat.projectPath,
          updatedAt: chat.updatedAt,
          chats: [summary]
        });
      }

      return {
        ...current,
        totalChats: current.totalChats + (addedNewChat ? 1 : 0),
        projects
      };
    });
  }

  function removeChatSummary(chatId: string) {
    setChatIndex((current) => {
      if (!current) {
        return current;
      }

      let removed = false;
      const projects = current.projects.map((project) => {
        const chats = project.chats.filter((chat) => {
          const keep = chat.id !== chatId;

          if (!keep) {
            removed = true;
          }

          return keep;
        });

        return { ...project, chats };
      });

      return {
        ...current,
        totalChats: Math.max(0, current.totalChats - (removed ? 1 : 0)),
        projects
      };
    });
  }

  function selectOptimisticFork(sourceChat: ChatDetail, name: string) {
    const createdAt = new Date().toISOString();
    const optimisticId = `optimistic-fork-${Date.parse(createdAt) || Date.now()}`;
    const forkMarker: ChatTranscriptMessage = {
      id: `forked-from-${optimisticId}`,
      role: "system",
      kind: "forked_from",
      label: "Forked chat",
      text: `Forked from ${sourceChat.title}`,
      createdAt
    };
    const optimisticChat: ChatDetail = {
      ...sourceChat,
      id: optimisticId,
      title: name,
      createdAt,
      updatedAt: createdAt,
      messages: [...(sourceChat.messages ?? []), forkMarker],
      messagePage: sourceChat.messagePage
        ? { ...sourceChat.messagePage }
        : {
            visibleTurns: defaultChatTurns,
            totalTurns: 0,
            hasMore: false
          }
    };

    upsertChatSummary(optimisticChat);
    chatDetailRequestRef.current += 1;
    selectedChatIdRef.current = optimisticId;
    setSelectedChatId(optimisticId);
    setSelectedChat(optimisticChat);
    setChatTurnLimits((current) => ({ ...current, [optimisticId]: Math.max(optimisticChat.messagePage?.visibleTurns ?? defaultChatTurns, defaultChatTurns) }));
    setChatActionMode(null);
    setChatActionError("");
    requestChatScroll();

    return { optimisticId, optimisticChat };
  }

  function selectPendingStartedChat(input: {
    pendingId: string;
    projectPath: string;
    projectName: string;
    title: string;
    prompt?: string;
    createdAt?: string;
  }) {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const optimisticId = `pending-chat-${input.pendingId}`;
    const prompt = input.prompt?.trim() ?? "";
    const messages: ChatTranscriptMessage[] = prompt
      ? [
          {
            id: `pending-prompt-${input.pendingId}`,
            role: "user",
            kind: "user_prompt",
            text: prompt,
            createdAt
          }
        ]
      : [];
    const optimisticChat: ChatDetail = {
      id: optimisticId,
      title: input.title,
      projectName: input.projectName,
      projectPath: input.projectPath,
      createdAt,
      updatedAt: createdAt,
      lastPrompt: prompt ? { text: prompt, createdAt } : null,
      lastResponse: null,
      messages,
      messagePage: {
        visibleTurns: defaultChatTurns,
        totalTurns: prompt ? 1 : 0,
        hasMore: false
      },
      hasResponse: false
    };

    upsertChatSummary(optimisticChat);
    chatDetailRequestRef.current += 1;
    selectedChatIdRef.current = optimisticId;
    setSelectedChatId(optimisticId);
    setSelectedChat(optimisticChat);
    setChatTurnLimits((current) => ({ ...current, [optimisticId]: defaultChatTurns }));
    setProjectActionMode(null);
    setProjectActionError("");
    setInstructionsOpen(false);
    setMenuOpen(false);
    requestChatScroll();

    return { optimisticId, optimisticChat };
  }

  async function waitForStartedChat(pendingId: string, optimisticId: string) {
    const deadline = Date.now() + 4 * 60 * 1000;
    let lastStatus: ProjectChatStartResult | null = null;

    while (Date.now() < deadline) {
      await delay(1500);

      try {
        const result = await apiFetch<ProjectChatStartResult>(`/api/chat-starts/${encodeURIComponent(pendingId)}`);
        lastStatus = result;

        if (result.status === "completed" && result.chat) {
          removeCachedChatHistory(optimisticId);
          upsertChatSummary(result.chat, optimisticId);
          rememberCachedChatHistory(result.chat);
          setNotice(result.message ?? "Chat started");

          if (selectedChatIdRef.current === optimisticId) {
            chatDetailRequestRef.current += 1;
            selectedChatIdRef.current = result.chat.id;
            setSelectedChatId(result.chat.id);
            setSelectedChat(result.chat);
            setChatTurnLimits((current) => ({
              ...current,
              [result.chat!.id]: Math.max(result.chat!.messagePage?.visibleTurns ?? defaultChatTurns, defaultChatTurns)
            }));
            requestChatScroll();
            void loadChatJobs(result.chat.id);
            void loadChatDetail(result.chat.id, true);
          } else {
            setUnreadChatIds((current) => new Set(current).add(result.chat!.id));
          }

          void loadChats();
          return;
        }

        if (result.status === "failed") {
          removeCachedChatHistory(optimisticId);
          removeChatSummary(optimisticId);

          if (selectedChatIdRef.current === optimisticId) {
            selectedChatIdRef.current = null;
            setSelectedChatId(null);
            setSelectedChat(null);
          }

          setProjectActionError(result.error ?? result.message ?? "Could not start chat");
          setNotice(result.error ?? result.message ?? "Could not start chat");
          void loadChats();
          return;
        }
      } catch (error) {
        lastStatus = null;
      }
    }

    setNotice(lastStatus?.message ?? "Chat start is still running. Refresh the chat list in a moment.");
  }

  function openProjectAction(mode: "project" | "chat") {
    setProjectActionMode((current) => (current === mode ? null : mode));
    setProjectActionError("");
    setChatActionMode(null);
    setChatActionError("");
    setInstructionsOpen(false);

    if (mode === "chat" && !newChatProjectPath) {
      setNewChatProjectPath(selectedChat?.projectPath ?? projectOptions[0]?.projectPath ?? "");
    }
  }

  function openChatAction(mode: "rename" | "fork") {
    if (!selectedChatForActions) {
      return;
    }

    setChatActionMode((current) => (current === mode ? null : mode));
    setChatActionName(mode === "rename" ? selectedChatForActions.title : `${selectedChatForActions.title} fork`);
    setChatActionError("");
    setProjectActionMode(null);
    setProjectActionError("");
    setInstructionsOpen(false);
  }

  async function submitChatAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedChatForActions || !chatActionMode || chatActionBusy) {
      return;
    }

    const name = chatActionName.replace(/\s+/g, " ").trim();

    if (!name) {
      setChatActionError("Chat name is required");
      return;
    }

    const mode = chatActionMode;
    const sourceChat = selectedChatForActions;
    const optimisticFork = mode === "fork" ? selectOptimisticFork(sourceChat, name) : null;

    setChatActionBusy(true);
    setChatActionError("");

    try {
      const result = await apiFetch<ChatMutationResult>(
        mode === "rename" ? `/api/chats/${encodeURIComponent(sourceChat.id)}` : `/api/chats/${encodeURIComponent(sourceChat.id)}/fork`,
        {
          method: mode === "rename" ? "PATCH" : "POST",
          body: JSON.stringify(mode === "rename" ? { title: name } : { name })
        }
      );

      setNotice(result.message ?? (mode === "rename" ? "Chat renamed" : "Chat forked"));
      setChatActionMode(null);
      setChatActionName("");

      if (mode === "fork") {
        if (optimisticFork) {
          removeCachedChatHistory(optimisticFork.optimisticId);
          upsertChatSummary(result.chat, optimisticFork.optimisticId);
        }

        rememberCachedChatHistory(result.chat);
        chatDetailRequestRef.current += 1;
        selectedChatIdRef.current = result.chat.id;
        setSelectedChatId(result.chat.id);
        setSelectedChat(result.chat);
        setChatTurnLimits((current) => ({ ...current, [result.chat.id]: Math.max(result.chat.messagePage?.visibleTurns ?? defaultChatTurns, defaultChatTurns) }));
        requestChatScroll();
        await loadChats();
        void loadChatJobs(result.chat.id);
        void loadChatDetail(result.chat.id, true);
        return;
      }

      rememberCachedChatHistory(result.chat);
      selectedChatIdRef.current = result.chat.id;
      setSelectedChatId(result.chat.id);
      setSelectedChat(result.chat);
      await loadChats();
      void loadChatDetail(result.chat.id, true);
    } catch (error) {
      if (optimisticFork) {
        removeCachedChatHistory(optimisticFork.optimisticId);
        removeChatSummary(optimisticFork.optimisticId);
        selectedChatIdRef.current = sourceChat.id;
        setSelectedChatId(sourceChat.id);
        setSelectedChat(sourceChat);
        setChatActionMode("fork");
        setChatActionName(name);
      }

      setChatActionError(error instanceof Error ? error.message : mode === "rename" ? "Could not rename chat" : "Could not fork chat");
    } finally {
      setChatActionBusy(false);
    }
  }

  async function submitNewProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (projectActionBusy) {
      return;
    }

    const name = newProjectName.trim();

    if (!name) {
      setProjectActionError("Project name is required");
      return;
    }

    setProjectActionBusy(true);
    setProjectActionError("");

    try {
      const result = await apiFetch<ProjectChatStartResult>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          prompt: newProjectPrompt.trim() || undefined
        })
      });

      setNewProjectName("");
      setNewProjectPrompt("");
      setNotice(result.message ?? "Project created");
      if (result.chat) {
        await selectStartedChat(result.chat);
        return;
      }

      if (result.accepted && result.pendingId) {
        const pending = selectPendingStartedChat({
          pendingId: result.pendingId,
          projectPath: result.projectPath,
          projectName: result.projectName ?? result.folderName ?? name,
          title: result.projectName ?? result.folderName ?? name,
          prompt: newProjectPrompt.trim() || undefined,
          createdAt: result.createdAt
        });
        void waitForStartedChat(result.pendingId, pending.optimisticId);
        return;
      }

      throw new Error("Project creation did not return a chat or pending request");
    } catch (error) {
      setProjectActionError(error instanceof Error ? error.message : "Could not create project");
    } finally {
      setProjectActionBusy(false);
    }
  }

  async function submitNewChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (projectActionBusy) {
      return;
    }

    const title = newChatTitle.trim();
    const projectPath = newChatProjectPath || selectedChat?.projectPath || projectOptions[0]?.projectPath || "";

    if (!projectPath) {
      setProjectActionError("Project folder is required");
      return;
    }

    if (!title) {
      setProjectActionError("Chat name is required");
      return;
    }

    setProjectActionBusy(true);
    setProjectActionError("");

    try {
      const result = await apiFetch<ProjectChatStartResult>("/api/chats", {
        method: "POST",
        body: JSON.stringify({
          projectPath,
          title,
          prompt: newChatPrompt.trim() || undefined
        })
      });

      setNewChatTitle("");
      setNewChatPrompt("");
      setNotice(result.message ?? "Chat started");
      if (result.chat) {
        await selectStartedChat(result.chat);
        return;
      }

      if (result.accepted && result.pendingId) {
        const selectedProject = projectOptions.find((project) => project.projectPath === projectPath);
        const pending = selectPendingStartedChat({
          pendingId: result.pendingId,
          projectPath,
          projectName: result.projectName ?? selectedProject?.projectName ?? title,
          title,
          prompt: newChatPrompt.trim() || undefined,
          createdAt: result.createdAt
        });
        void waitForStartedChat(result.pendingId, pending.optimisticId);
        return;
      }

      throw new Error("Chat start did not return a chat or pending request");
    } catch (error) {
      setProjectActionError(error instanceof Error ? error.message : "Could not start chat");
    } finally {
      setProjectActionBusy(false);
    }
  }

  const applyOptimisticPrompt = useCallback((
    chatId: string,
    text: string,
    createdAt: string,
    messageId = optimisticPromptId(createdAt),
    voiceNote?: DictationVoiceNote
  ) => {
    setSelectedChat((current) => {
      if (!current || current.id !== chatId) {
        return current;
      }

      const newMessages = createOptimisticPromptMessages(text, createdAt, messageId, voiceNote);
      const messages = [...(current.messages ?? [])];

      for (const message of newMessages) {
        if (isOptimisticPromptMessage(message)) {
          const matchingPromptIndex = findServerPromptMatchIndex(messages, message);

          if (matchingPromptIndex >= 0) {
            const serverMessage = messages[matchingPromptIndex];
            messages[matchingPromptIndex] = {
              ...serverMessage,
              id: message.id,
              createdAt: message.createdAt,
              label: message.label ?? serverMessage.label
            };
            continue;
          }
        }

        if (!messages.some((candidate) => candidate.id === message.id)) {
          messages.push(message);
        }
      }

      const lastResponseTime = Date.parse(current.lastResponse?.createdAt ?? "") || 0;
      const promptTime = Date.parse(createdAt) || 0;
      const responseIsNewer = lastResponseTime >= promptTime;

      return {
        ...current,
        updatedAt: promptTime >= (Date.parse(current.updatedAt) || 0) ? createdAt : current.updatedAt,
        lastPrompt: { text, createdAt },
        lastResponse: responseIsNewer ? current.lastResponse : null,
        messages: dedupeMessagesById(messages).sort(
          (a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)
        ),
        hasResponse: responseIsNewer ? current.hasResponse : false
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

  function closeMobileMenuPanels() {
    setMenuOpen(false);
    setInstructionsOpen(false);
    setProjectActionMode(null);
    setProjectActionError("");
    setChatActionMode(null);
    setChatActionError("");
  }

  function selectChat(chatId: string) {
    setUnreadChatIds((current) => {
      if (!current.has(chatId)) {
        return current;
      }

      const next = new Set(current);
      next.delete(chatId);
      return next;
    });

    if (selectedChatIdRef.current !== chatId) {
      chatDetailRequestRef.current += 1;
      selectedChatIdRef.current = chatId;
      setSelectedChat(getCachedChatHistory(chatId, chatMessageViewModesRef.current[chatId] ?? defaultChatMessageViewMode));
      setSelectedChatId(chatId);
    }

    closeMobileMenuPanels();
  }

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
    rememberSelectedChatId(selectedChatId);
  }, [selectedChatId]);

  useEffect(() => {
    notificationStatusRef.current = notificationStatus;
  }, [notificationStatus]);

  useEffect(() => {
    void refreshNotificationStatus();
  }, [refreshNotificationStatus]);

  useEffect(() => {
    if (selectedChatId && selectedChat?.id && selectedChat.id !== selectedChatId) {
      setSelectedChat(null);
    }
  }, [selectedChat?.id, selectedChatId]);

  useEffect(() => {
    if (!selectedChatId) {
      return;
    }

    closeMobileMenuPanels();
    chatShouldAutoScrollRef.current = true;
    forceNextChatScrollRef.current = true;
    preserveChatScrollRef.current = null;
    setPendingAttachments([]);
    setAttachmentUploadStatuses({});
  }, [selectedChatId]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMobileMenuPanels();
      }
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  useEffect(() => {
    if (!runBoardOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeRunBoard();
      }
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeRunBoard, runBoardOpen]);

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
    chatMessageViewModesRef.current = chatMessageViewModes;
    localStorage.setItem(chatMessageViewModesKey, JSON.stringify(chatMessageViewModes));
  }, [chatMessageViewModes]);

  useEffect(() => {
    writeCachedActiveJobs(chatJobs, state?.runner.recentJobs ?? []);
  }, [chatJobs, state?.runner.recentJobs]);

  useEffect(() => {
    if (selectedChat && !isTemporaryChatId(selectedChat.id)) {
      rememberCachedChatHistory(selectedChat, selectedChatMessageViewMode);
    }
  }, [selectedChat, selectedChatMessageViewMode]);

  useEffect(
    () => () => {
      if (promptReceiptClearTimerRef.current !== undefined) {
        window.clearTimeout(promptReceiptClearTimerRef.current);
      }

      dictationRecognitionRef.current?.abort();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      stopDictationTracks();
    },
    []
  );

  useEffect(() => {
    if (!authenticated || !instructionsOpen) {
      return;
    }

    void loadShortcutInstructions();

    const interval = window.setInterval(() => {
      void loadShortcutInstructions();
    }, shortcutInstructionSyncIntervalMs);

    return () => window.clearInterval(interval);
  }, [authenticated, instructionsOpen, loadShortcutInstructions]);

  useEffect(() => {
    if (!authenticated || !selectedInstructionFile) {
      return;
    }

    let cancelled = false;
    let loadedOnce = false;

    const fetchInstructionContent = async () => {
      if (!selectedInstructionFile.mediaUrl) {
        setSelectedInstructionError("Instruction file does not have a media URL");
        setSelectedInstructionLoading(false);
        return;
      }

      if (!loadedOnce) {
        setSelectedInstructionLoading(true);
      }

      try {
        const response = await fetch(selectedInstructionFile.mediaUrl, {
          headers: token ? { "x-control-token": token } : undefined
        });
        const text = await response.text();

        if (!response.ok) {
          throw new Error(text || "Could not load markdown file");
        }

        if (cancelled) {
          return;
        }

        loadedOnce = true;
        setSelectedInstructionContent((current) => (current === text ? current : text));
        setSelectedInstructionError("");
      } catch (error) {
        if (!cancelled) {
          setSelectedInstructionError(error instanceof Error ? error.message : "Could not load markdown file");
        }
      } finally {
        if (!cancelled) {
          setSelectedInstructionLoading(false);
        }
      }
    };

    void fetchInstructionContent();
    const interval = window.setInterval(() => {
      void fetchInstructionContent();
    }, shortcutInstructionSyncIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authenticated, selectedInstructionFile, token]);

  useEffect(() => {
    if (selectedJob?.status !== "running" && !activeRunJobKey && !selectedViewHasLiveThinking) {
      return;
    }

    setDurationNow(Date.now());

    const interval = window.setInterval(() => {
      setDurationNow(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [activeRunJobKey, selectedJob?.id, selectedJob?.status, selectedViewHasLiveThinking]);

  useEffect(() => {
    if (!liveThinkingRunKey) {
      return;
    }

    let timeoutId: number | undefined;
    let stopped = false;

    setLiveThinkingDisplay({ runKey: liveThinkingRunKey, status: "Thinking" });

    const scheduleNextStatus = () => {
      timeoutId = window.setTimeout(() => {
        if (stopped) {
          return;
        }

        setLiveThinkingDisplay((current) => ({
          runKey: liveThinkingRunKey,
          status: nextLiveThinkingStatus(current.runKey === liveThinkingRunKey ? current.status : "Thinking")
        }));
        scheduleNextStatus();
      }, nextLiveThinkingDelayMs());
    };

    scheduleNextStatus();

    return () => {
      stopped = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [liveThinkingRunKey]);

  useEffect(() => {
    if (!authenticated || !selectedChatId || isTemporaryChatId(selectedChatId)) {
      return;
    }

    void loadChatDetail(selectedChatId);
    void loadChatJobs(selectedChatId);
  }, [authenticated, loadChatDetail, loadChatJobs, selectedChatId]);

  useEffect(() => {
    if (!selectedChatId || chatShellIsLoading) {
      return;
    }

    const scroller = chatContentRef.current;
    const preservedScroll = preserveChatScrollRef.current;

    if (preservedScroll) {
      preserveChatScrollRef.current = null;

      const restorePosition = () => {
        const nextScroller = chatContentRef.current;
        if (!nextScroller) {
          return;
        }

        nextScroller.scrollTop = preservedScroll.scrollTop + (nextScroller.scrollHeight - preservedScroll.scrollHeight);
        updateScrollDebugPosition(nextScroller);
        chatShouldAutoScrollRef.current = chatIsNearBottom(nextScroller);
      };

      const firstFrame = window.requestAnimationFrame(() => {
        restorePosition();
        window.requestAnimationFrame(restorePosition);
      });

      return () => window.cancelAnimationFrame(firstFrame);
    }

    const shouldScroll = forceNextChatScrollRef.current || chatShouldAutoScrollRef.current || chatIsNearBottom(scroller);
    forceNextChatScrollRef.current = false;

    if (!shouldScroll) {
      updateScrollDebugPosition(scroller);
      return;
    }

    const scrollToBottom = () => {
      scrollChatToBottom();
    };
    const firstFrame = window.requestAnimationFrame(() => {
      scrollToBottom();
      window.requestAnimationFrame(scrollToBottom);
    });
    const imageLoadFallback = window.setTimeout(scrollToBottom, 250);

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.clearTimeout(imageLoadFallback);
    };
  }, [
    chatIsNearBottom,
    chatScrollVersion,
    chatShellIsLoading,
    lastVisibleMessageKey,
    scrollChatToBottom,
    selectedChatId,
    updateScrollDebugPosition
  ]);

  useEffect(() => {
    if (!selectedChatId || chatShellIsLoading) {
      updateScrollDebugPosition();
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      updateScrollDebugPosition();
      chatShouldAutoScrollRef.current = chatIsNearBottom();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [chatIsNearBottom, chatShellIsLoading, lastVisibleMessageKey, selectedChatId, updateScrollDebugPosition]);

  useEffect(() => {
    if (!selectedChatId || chatShellIsLoading) {
      return;
    }

    let frame: number | undefined;
    const scrollListenerOptions: AddEventListenerOptions = { capture: true, passive: true };

    const refreshPosition = (target?: EventTarget | Element | null) => {
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }

      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        const scroller = findScrollableAncestor(target) ?? resolveScrollElement();
        updateScrollDebugPosition(scroller);
        chatShouldAutoScrollRef.current = chatIsNearBottom(scroller);
      });
    };

    const trackScrollPoint = (point: { clientX: number; clientY: number }) => {
      lastScrollPointRef.current = {
        x: Math.max(0, Math.min(window.innerWidth - 1, Math.round(point.clientX))),
        y: Math.max(0, Math.min(window.innerHeight - 1, Math.round(point.clientY)))
      };
    };

    const handleCapturedScroll = (event: Event) => refreshPosition(event.target);
    const handleWheel = (event: WheelEvent) => {
      trackScrollPoint(event);
      refreshPosition(event.target);
    };
    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0] ?? event.changedTouches[0];

      if (touch) {
        trackScrollPoint(touch);
      }

      refreshPosition(event.target);
    };

    // Keep this capture-phase listener. Mobile Safari can scroll an ancestor that is
    // not chatContentRef, and binding only the guessed node makes diagnostics stale.
    window.addEventListener("scroll", handleCapturedScroll, scrollListenerOptions);
    window.addEventListener("wheel", handleWheel, scrollListenerOptions);
    window.addEventListener("touchmove", handleTouchMove, scrollListenerOptions);
    window.addEventListener("touchend", handleCapturedScroll, scrollListenerOptions);
    window.addEventListener("resize", handleCapturedScroll);
    window.visualViewport?.addEventListener("resize", handleCapturedScroll);
    const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(() => refreshPosition()) : null;
    const initialScroller = resolveScrollElement();
    if (initialScroller) {
      resizeObserver?.observe(initialScroller);
    }
    refreshPosition();

    return () => {
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }

      window.removeEventListener("scroll", handleCapturedScroll, scrollListenerOptions);
      window.removeEventListener("wheel", handleWheel, scrollListenerOptions);
      window.removeEventListener("touchmove", handleTouchMove, scrollListenerOptions);
      window.removeEventListener("touchend", handleCapturedScroll, scrollListenerOptions);
      window.removeEventListener("resize", handleCapturedScroll);
      window.visualViewport?.removeEventListener("resize", handleCapturedScroll);
      resizeObserver?.disconnect();
    };
  }, [
    chatIsNearBottom,
    chatShellIsLoading,
    findScrollableAncestor,
    lastVisibleMessageKey,
    resolveScrollElement,
    selectedChatId,
    updateScrollDebugPosition
  ]);

  useEffect(() => {
    menuOpenRef.current = menuOpen;
    chatShouldAutoScrollRef.current = chatIsNearBottom();
    updateScrollDebugPosition();
  }, [chatIsNearBottom, menuOpen, updateScrollDebugPosition]);

  useEffect(() => {
    setCustomKeyboardOpen(false);
  }, [dictationProcessing, dictationRecording, menuOpen, selectedChatId, sending]);

  useEffect(() => {
    window.clearTimeout(customKeyboardExitTimerRef.current);
    customKeyboardExitTimerRef.current = undefined;

    if (customKeyboardOpen) {
      setCustomKeyboardMounted(true);
      return;
    }

    if (!customKeyboardMounted) {
      return;
    }

    customKeyboardExitTimerRef.current = window.setTimeout(() => {
      setCustomKeyboardMounted(false);
      customKeyboardExitTimerRef.current = undefined;
    }, customKeyboardExitDurationMs);

    return () => {
      window.clearTimeout(customKeyboardExitTimerRef.current);
      customKeyboardExitTimerRef.current = undefined;
    };
  }, [customKeyboardMounted, customKeyboardOpen]);

  useEffect(() => {
    if (!customKeyboardOpen) {
      return;
    }

    let pendingOutsideTap: { pointerId: number; x: number; y: number } | null = null;

    const isKeyboardDismissalExempt = (target: EventTarget | null) => {
      if (!(target instanceof Element)) {
        return false;
      }

      return Boolean(
        target.closest('[data-composer="chat"]') ||
          target.closest('[data-custom-keyboard-root="true"]') ||
          target.closest(".scroll-bottom-control")
      );
    };

    const armOutsideTap = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || isKeyboardDismissalExempt(event.target)) {
        pendingOutsideTap = null;
        return;
      }

      pendingOutsideTap = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY
      };
    };

    const cancelOutsideTapOnMove = (event: PointerEvent) => {
      if (!pendingOutsideTap || event.pointerId !== pendingOutsideTap.pointerId) {
        return;
      }

      if (
        Math.hypot(event.clientX - pendingOutsideTap.x, event.clientY - pendingOutsideTap.y) >
        customKeyboardTapSlopPx
      ) {
        pendingOutsideTap = null;
      }
    };

    const finishOutsideTap = (event: PointerEvent) => {
      if (!pendingOutsideTap || event.pointerId !== pendingOutsideTap.pointerId) {
        return;
      }

      const completedTap = pendingOutsideTap;
      pendingOutsideTap = null;
      if (isKeyboardDismissalExempt(event.target)) {
        return;
      }

      const movement = Math.hypot(event.clientX - completedTap.x, event.clientY - completedTap.y);
      if (movement <= customKeyboardTapSlopPx) {
        setCustomKeyboardOpen(false);
      }
    };

    const cancelOutsideTap = (event: PointerEvent) => {
      if (pendingOutsideTap?.pointerId === event.pointerId) {
        pendingOutsideTap = null;
      }
    };

    document.addEventListener("pointerdown", armOutsideTap, true);
    document.addEventListener("pointermove", cancelOutsideTapOnMove, true);
    document.addEventListener("pointerup", finishOutsideTap, true);
    document.addEventListener("pointercancel", cancelOutsideTap, true);
    return () => {
      document.removeEventListener("pointerdown", armOutsideTap, true);
      document.removeEventListener("pointermove", cancelOutsideTapOnMove, true);
      document.removeEventListener("pointerup", finishOutsideTap, true);
      document.removeEventListener("pointercancel", cancelOutsideTap, true);
    };
  }, [customKeyboardOpen]);

  useEffect(() => {
    const editor = composerEditorRef.current;

    if (editor) {
      const chatId = editor.dataset.chatId;
      const activeCustomModel =
        customKeyboardOpen && chatId && customKeyboardEditRef.current?.chatId === chatId
          ? customKeyboardEditRef.current
          : null;

      if (activeCustomModel) {
        // The custom keyboard model remains authoritative while focus temporarily
        // moves to the attachment picker. A draft render must never reset its caret
        // to the end or replace text that was pasted immediately before the picker.
        syncComposerEditorText(editor, activeCustomModel.text);
        composerSelectionRef.current = activeCustomModel.selection;
      } else if (document.activeElement !== editor || !draft) {
        syncComposerEditorText(editor, draft);
        const end = rawTextFromComposerEditor(editor).length;
        composerSelectionRef.current = { start: end, end };
        if (chatId) {
          customKeyboardEditRef.current = {
            chatId,
            text: rawTextFromComposerEditor(editor),
            selection: composerSelectionRef.current
          };
        }
      } else if (!customKeyboardOpen) {
        rememberComposerSelection(editor);
      }

      setComposerExpanded(composerShouldExpand(editor));
    }
  }, [customKeyboardOpen, draft, rememberComposerSelection, selectedChatId]);

  useEffect(() => {
    if (!state?.runner.recentJobs.length) {
      return;
    }

    setChatJobs((current) => {
      const next = { ...current };

      for (const job of state.runner.recentJobs) {
        trackServerJob(job);
        next[job.chatId] = mergeJobsForChat(next[job.chatId] ?? [], [job]);
      }

      return next;
    });
  }, [state, trackServerJob]);

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
          // A token rotation rejects the reconnect before the socket can open.
          // Probe authenticated HTTP immediately so a stale PWA returns to Unlock.
          void loadState();
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

          if (job.chatId === selectedChatIdRef.current) {
            void loadChatJobs(job.chatId);
            void loadChatDetail(job.chatId, true);
          }

          if (job.status === "completed" || job.status === "failed") {
            if (notificationStatusRef.current === "local") {
              void localNotificationCopyForJob(job).then(({ title, body }) =>
                showLocalNotification({
                  title,
                  body,
                  tag: `codex-job-${job.id}`,
                  chatId: job.chatId,
                  jobId: job.id
                })
              );
            }

            void loadChats();

            if (job.chatId !== selectedChatIdRef.current) {
              setUnreadChatIds((current) => {
                if (current.has(job.chatId)) {
                  return current;
                }

                return new Set(current).add(job.chatId);
              });
            }
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
  }, [
    authenticated,
    loadChatDetail,
    loadChatJobs,
    loadChats,
    loadState,
    localNotificationCopyForJob,
    rememberJob,
    showLocalNotification,
    token
  ]);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadState();

      const chatId = selectedChatIdRef.current;
      if (chatId && !isTemporaryChatId(chatId)) {
        void loadChatJobs(chatId);
        void loadChatDetail(chatId, true);
      }

      const queuedChatIds = new Set(queuedServerJobs.map((job) => job.chatId));

      for (const queuedChatId of queuedChatIds) {
        if (queuedChatId && queuedChatId !== chatId && !isTemporaryChatId(queuedChatId)) {
          void loadChatJobs(queuedChatId);
        }
      }
    }, backgroundSyncIntervalMs);

    return () => window.clearInterval(interval);
  }, [authenticated, loadChatDetail, loadChatJobs, loadState, queuedServerJobs]);

  async function restoreQueuedJobToComposer(job: CodexRunJob) {
    if (job.status !== "queued") {
      return;
    }

    try {
      const result = await apiFetch<QueuedPromptMutationResult>(
        `/api/chats/${encodeURIComponent(job.chatId)}/queued-prompts/${encodeURIComponent(job.id)}`,
        { method: "DELETE" }
      );
      setDraft(result.text ?? "");
      setPendingAttachments([]);
      setAttachmentUploadStatuses({});
      setNotice(result.message ?? "Queued prompt moved back to composer");
      selectChat(job.chatId);
      await Promise.all([
        loadState(),
        loadChatJobs(job.chatId),
        selectedChatIdRef.current === job.chatId ? loadChatDetail(job.chatId, true) : Promise.resolve()
      ]);
      window.requestAnimationFrame(() => {
        const editor = composerEditorRef.current;

        if (editor) {
          setComposerExpanded(composerShouldExpand(editor));
        }
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not remove queued prompt");
    }
  }

  async function steerQueuedJob(job: CodexRunJob) {
    if (!queuedJobCanMoveNext(job, selectedJob, Date.now())) {
      return;
    }

    try {
      const result = await apiFetch<QueuedPromptMutationResult>(
        `/api/chats/${encodeURIComponent(job.chatId)}/queued-prompts/${encodeURIComponent(job.id)}/steer`,
        { method: "POST" }
      );

      if (result.job) {
        rememberJob(result.job);
      }

      if (result.stoppedJob) {
        rememberJob(result.stoppedJob);
      }

      setNotice(result.message ?? "Stopping current worker; queued prompt will run next");
      await Promise.all([loadState(), loadChatJobs(job.chatId)]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not steer queued prompt");
    }
  }

  async function stopRunningJob(job: CodexRunJob) {
    if (job.status !== "running" || stoppingJobIds.has(job.id)) {
      return;
    }

    setStoppingJobIds((current) => new Set(current).add(job.id));

    try {
      const result = await apiFetch<ApiResult>(
        `/api/chats/${encodeURIComponent(job.chatId)}/jobs/${encodeURIComponent(job.id)}/stop`,
        { method: "POST" }
      );

      if (result.job) {
        rememberJob(result.job);
      }

      setNotice(result.message ?? "Stop requested for this chat");
      await Promise.all([loadState(), loadChatJobs(job.chatId)]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not stop running worker");
    } finally {
      setStoppingJobIds((current) => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
    }
  }

  useEffect(() => {
    if (!authenticated || !selectedChatId || !selectedJob || !["queued", "running"].includes(selectedJob.status)) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadChats();
      void loadChatJobs(selectedChatId);
      void loadChatDetail(selectedChatId, true);
    }, activeJobSyncIntervalMs);

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
    const nextTotalBytes = pendingAttachments.reduce((total, attachment) => total + attachment.file.size, 0) + valid.reduce((total, file) => total + file.size, 0);

    if (tooLarge.length > 0) {
      setNotice(`Files must be ${formatBytes(maxAttachmentBytes)} or smaller.`);
    } else if (nextTotalBytes > maxAttachmentTotalBytes) {
      setNotice(`Attached files must be ${formatBytes(maxAttachmentTotalBytes)} or smaller in total.`);
      return;
    } else if (rejectedCount > 0) {
      setNotice(`Attach up to ${maxAttachmentFiles} files at a time.`);
    } else {
      setNotice("");
    }

    const nextAttachments = valid.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(16).slice(2)}`,
      file
    }));

    setPendingAttachments((current) => [
      ...current,
      ...nextAttachments
    ]);
    setAttachmentUploadStatuses((current) => ({
      ...current,
      ...Object.fromEntries(nextAttachments.map((attachment) => [attachment.id, { status: "idle" as const, progress: 0 }]))
    }));
  }

  function openAttachmentPicker() {
    const reopenKeyboard = customKeyboardOpen;
    const composerSnapshot = preserveComposerForTransientFocus();
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.tabIndex = -1;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.width = "1px";
    input.style.height = "1px";
    input.setAttribute("aria-hidden", "true");

    let removed = false;
    let restored = false;
    const restoreComposer = () => {
      if (restored) {
        return;
      }

      restored = true;
      window.requestAnimationFrame(() => restoreComposerAfterTransientFocus(composerSnapshot, reopenKeyboard));
    };
    const removeInput = () => {
      if (removed) {
        return;
      }

      removed = true;
      window.removeEventListener("focus", restoreComposer);
      input.remove();
    };

    input.addEventListener(
      "change",
      () => {
        addAttachments(input.files);
        restoreComposer();
        removeInput();
      },
      { once: true }
    );

    input.addEventListener(
      "cancel",
      () => {
        restoreComposer();
        removeInput();
      },
      { once: true }
    );

    document.body.append(input);
    window.addEventListener("focus", restoreComposer, { once: true });
    input.click();
    window.setTimeout(removeInput, 60000);
  }

  function removeAttachment(id: string) {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id));
    setAttachmentUploadStatuses((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function updateAttachmentUploadStatus(id: string, patch: Partial<AttachmentUploadStatus>) {
    setAttachmentUploadStatuses((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? { status: "idle", progress: 0 }),
        ...patch
      }
    }));
  }

  function uploadAttachmentChunk({
    chatId,
    attachment,
    uploadedAt,
    fileIndex,
    chunkIndex,
    totalChunks,
    start,
    end
  }: {
    chatId: string;
    attachment: PendingAttachment;
    uploadedAt: string;
    fileIndex: number;
    chunkIndex: number;
    totalChunks: number;
    start: number;
    end: number;
  }) {
    const { file } = attachment;
    const chunk = file.slice(start, end, file.type || "application/octet-stream");
    const params = new URLSearchParams({
      name: file.name,
      type: file.type || "application/octet-stream",
      index: String(fileIndex),
      chunkIndex: String(chunkIndex),
      totalChunks: String(totalChunks),
      totalSize: String(file.size),
      uploadedAt
    });

    return new Promise<FileUploadChunkResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `/api/chats/${encodeURIComponent(chatId)}/files/chunk?${params.toString()}`);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      if (token) {
        xhr.setRequestHeader("x-control-token", token);
      }

      xhr.upload.onprogress = (event) => {
        const loaded = event.lengthComputable ? event.loaded : Math.min(chunk.size, event.loaded || 0);
        const progress = file.size ? Math.min(99, Math.round(((start + loaded) / file.size) * 100)) : 0;
        updateAttachmentUploadStatus(attachment.id, {
          status: "uploading",
          progress,
          message: `Uploading ${chunkIndex + 1}/${totalChunks}`
        });
      };
      xhr.onload = () => {
        let payload: FileUploadChunkResult | null = null;

        try {
          payload = JSON.parse(xhr.responseText || "{}") as FileUploadChunkResult;
        } catch {
          reject(new Error("Upload returned an invalid response"));
          return;
        }

        if (xhr.status < 200 || xhr.status >= 300 || !payload.ok) {
          reject(new Error(payload.message ?? `Upload failed with HTTP ${xhr.status}`));
          return;
        }

        resolve(payload);
      };
      xhr.onerror = () => reject(new Error("Network error while uploading file"));
      xhr.onabort = () => reject(new Error("Upload was interrupted"));
      xhr.ontimeout = () => reject(new Error("Upload timed out"));
      xhr.send(chunk);
    });
  }

  async function uploadAttachmentFile(chatId: string, attachment: PendingAttachment, fileIndex: number, uploadedAt: string) {
    const { file } = attachment;

    if (!file.size) {
      throw new Error(`${file.name} is empty`);
    }

    if (file.size > maxAttachmentBytes) {
      throw new Error(`${file.name} must be ${formatBytes(maxAttachmentBytes)} or smaller`);
    }

    const totalChunks = Math.max(1, Math.ceil(file.size / attachmentChunkBytes));
    updateAttachmentUploadStatus(attachment.id, {
      status: "uploading",
      progress: 0,
      message: totalChunks > 1 ? `Uploading 1/${totalChunks}` : "Uploading"
    });

    try {
      let uploadedFile: UploadedPromptFile | undefined;

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const start = chunkIndex * attachmentChunkBytes;
        const end = Math.min(file.size, start + attachmentChunkBytes);
        const result = await uploadAttachmentChunk({
          chatId,
          attachment,
          uploadedAt,
          fileIndex,
          chunkIndex,
          totalChunks,
          start,
          end
        });

        if (result.complete) {
          uploadedFile = result.file ?? result.files?.[0];
        }
      }

      if (!uploadedFile) {
        throw new Error("Upload finished without a saved file path");
      }

      updateAttachmentUploadStatus(attachment.id, {
        status: "uploaded",
        progress: 100,
        message: "Uploaded",
        uploadedFile
      });
      return uploadedFile;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      updateAttachmentUploadStatus(attachment.id, {
        status: "failed",
        message
      });
      throw error;
    }
  }

  async function uploadAttachments(chatId: string) {
    if (!pendingAttachments.length) {
      return [];
    }

    const totalBytes = pendingAttachments.reduce((total, attachment) => total + attachment.file.size, 0);
    if (totalBytes > maxAttachmentTotalBytes) {
      throw new Error(`Attached files must be ${formatBytes(maxAttachmentTotalBytes)} or smaller in total`);
    }

    const uploadedAt = new Date().toISOString();
    const uploadedFiles: UploadedPromptFile[] = [];

    for (const [index, attachment] of pendingAttachments.entries()) {
      const status = attachmentUploadStatuses[attachment.id];

      if (status?.uploadedFile) {
        uploadedFiles.push(status.uploadedFile);
        continue;
      }

      uploadedFiles.push(await uploadAttachmentFile(chatId, attachment, index, uploadedAt));
    }

    return uploadedFiles;
  }

  async function retryAttachmentUpload(attachment: PendingAttachment) {
    if (!selectedChatId || sending) {
      return;
    }

    const fileIndex = Math.max(0, pendingAttachments.findIndex((candidate) => candidate.id === attachment.id));
    setNotice(`Retrying ${attachment.file.name}...`);

    try {
      await uploadAttachmentFile(selectedChatId, attachment, fileIndex, new Date().toISOString());
      setNotice("Upload ready. Press Send to submit the prompt.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Upload failed");
    }
  }

  function resetDictationWaveformBars() {
    dictationBarsRef.current?.querySelectorAll("i").forEach((bar) => {
      bar.style.setProperty("--bar-level", "0.25");
    });
  }

  function stopDictationWaveform() {
    if (dictationWaveformFrameRef.current !== undefined) {
      window.cancelAnimationFrame(dictationWaveformFrameRef.current);
      dictationWaveformFrameRef.current = undefined;
    }

    dictationAudioSourceRef.current?.disconnect();
    dictationAudioSourceRef.current = null;

    const audioContext = dictationAudioContextRef.current;
    dictationAudioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }

    resetDictationWaveformBars();
  }

  function startDictationWaveform(stream: MediaStream) {
    stopDictationWaveform();

    const AudioContextCtor =
      window.AudioContext ?? (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      return;
    }

    try {
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();

      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.78;
      const data = new Uint8Array(analyser.frequencyBinCount);
      source.connect(analyser);

      dictationAudioContextRef.current = audioContext;
      dictationAudioSourceRef.current = source;
      void audioContext.resume().catch(() => undefined);

      const update = () => {
        analyser.getByteFrequencyData(data);

        const bars = Array.from(dictationBarsRef.current?.querySelectorAll("i") ?? []);
        const barCount = bars.length;
        if (barCount) {
          const bucketSize = Math.max(2, Math.floor((data.length * 0.72) / barCount));

          bars.forEach((bar, index) => {
            const start = index * bucketSize;
            const end = Math.min(data.length, start + bucketSize);
            let total = 0;

            for (let dataIndex = start; dataIndex < end; dataIndex += 1) {
              total += data[dataIndex] ?? 0;
            }

            const average = total / Math.max(1, end - start);
            const level = Math.max(0.18, Math.min(1.35, average / 145));
            bar.style.setProperty("--bar-level", level.toFixed(3));
          });
        }

        dictationWaveformFrameRef.current = window.requestAnimationFrame(update);
      };

      update();
    } catch {
      stopDictationWaveform();
    }
  }

  function stopDictationTracks() {
    stopDictationWaveform();
    dictationStreamRef.current?.getTracks().forEach((track) => track.stop());
    dictationStreamRef.current = null;
  }

  function currentDictationTranscript() {
    return cleanDictatedPrompt(dictationTranscriptRef.current || dictationFinalTranscriptRef.current);
  }

  async function waitForDictationTranscript(timeoutMs = 2200) {
    const startedAt = Date.now();
    let bestTranscript = currentDictationTranscript();

    while (Date.now() - startedAt < timeoutMs) {
      await delay(120);
      const nextTranscript = currentDictationTranscript();

      if (nextTranscript) {
        bestTranscript = nextTranscript;
      }
    }

    return bestTranscript;
  }

  async function improveDictationTranscript(chatId: string, rawTranscript: string) {
    setNotice("Improving transcription...");

    try {
      const result = await apiFetch<DictationCleanupResult>(`/api/chats/${encodeURIComponent(chatId)}/dictation/clean`, {
        method: "POST",
        body: JSON.stringify({
          rawTranscript,
          draftContext: dictationDraftSnapshotRef.current,
          language: navigator.language || "en-US"
        })
      });
      const cleaned = cleanDictatedPrompt(result.text ?? rawTranscript);
      return cleaned || rawTranscript;
    } catch (error) {
      setNotice(error instanceof Error ? `${error.message}; using browser transcript` : "Using browser transcript");
      return rawTranscript;
    }
  }

  function stopDictation() {
    dictationRecognitionRef.current?.stop();
    dictationRecognitionRef.current = null;

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      setDictationProcessing(true);
      setNotice("Processing dictation...");
      recorder.stop();
      return;
    }

    stopDictationTracks();
    dictationChatIdRef.current = null;
    dictationDraftSnapshotRef.current = "";
    setDictationRecording(false);
    setDictationProcessing(false);
  }

  async function startDictation() {
    if (!selectedChatId || sending || dictationRecording || dictationProcessing) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setNotice("Audio recording is not supported in this browser.");
      return;
    }

    const SpeechRecognition = speechRecognitionConstructor();

    if (!SpeechRecognition) {
      setNotice("Speech transcription is not supported in this browser.");
      return;
    }

    try {
      const dictationChatId = selectedChatId;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = supportedAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const recognition = new SpeechRecognition();

      dictationStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      dictationRecognitionRef.current = recognition;
      dictationChunksRef.current = [];
      dictationFinalTranscriptRef.current = "";
      dictationTranscriptRef.current = "";
      dictationChatIdRef.current = dictationChatId;
      dictationDraftSnapshotRef.current = draft;
      startDictationWaveform(stream);

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 5;
      recognition.lang = navigator.language || "en-US";
      recognition.onresult = (event) => {
        let interim = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = bestSpeechRecognitionTranscript(result);

          if (result?.isFinal) {
            dictationFinalTranscriptRef.current = `${dictationFinalTranscriptRef.current} ${transcript}`.trim();
          } else {
            interim = `${interim} ${transcript}`.trim();
          }
        }

        const cleaned = cleanDictatedPrompt(`${dictationFinalTranscriptRef.current} ${interim}`.trim());
        dictationTranscriptRef.current = cleaned;
      };
      recognition.onerror = (event) => {
        setNotice(event.error ? `Dictation error: ${event.error}` : "Dictation error");
      };
      recognition.onend = () => {
        dictationRecognitionRef.current = null;
      };

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          dictationChunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener(
        "stop",
        async () => {
          const blob = new Blob(dictationChunksRef.current, { type: recorder.mimeType || "audio/webm" });

          mediaRecorderRef.current = null;
          stopDictationTracks();
          setDictationRecording(false);

          const rawTranscript = await waitForDictationTranscript();
          const targetChatId = dictationChatIdRef.current;

          if (!rawTranscript || !targetChatId) {
            setNotice("No speech was transcribed. Try recording again.");
            dictationChatIdRef.current = null;
            dictationDraftSnapshotRef.current = "";
            setDictationProcessing(false);
            return;
          }

          const transcript = await improveDictationTranscript(targetChatId, rawTranscript);

          const voiceNoteUrl = await readBlobAsDataUrl(blob).catch(() => URL.createObjectURL(blob));
          const voiceNote = {
            url: voiceNoteUrl,
            mimeType: blob.type || "audio recording"
          };

          try {
            await sendPrompt({ textOverride: transcript, voiceNote, chatIdOverride: targetChatId, preserveDraft: true });
          } finally {
            dictationChatIdRef.current = null;
            dictationDraftSnapshotRef.current = "";
            setDictationProcessing(false);
          }
        },
        { once: true }
      );

      recorder.start();
      recognition.start();
      setDictationRecording(true);
      setNotice("Recording dictation...");
    } catch (error) {
      stopDictationTracks();
      mediaRecorderRef.current = null;
      dictationRecognitionRef.current = null;
      dictationChatIdRef.current = null;
      dictationDraftSnapshotRef.current = "";
      setDictationRecording(false);
      setDictationProcessing(false);
      setNotice(error instanceof Error ? error.message : "Could not start dictation");
    }
  }

  async function sendPrompt(
    options: {
      textOverride?: string;
      voiceNote?: DictationVoiceNote;
      chatIdOverride?: string;
      preserveDraft?: boolean;
    } = {}
  ) {
    flushCustomKeyboardDomSync();
    void flushKeyboardTrace("prompt-send");
    const targetChatId = options.chatIdOverride ?? selectedChatId;
    const editor = composerEditorRef.current;
    const liveComposerDraft =
      targetChatId && editor?.dataset.chatId === targetChatId ? rawTextFromComposerEditor(editor) : undefined;
    const outgoingDraft = options.textOverride ?? liveComposerDraft ?? draft;
    const outgoingAttachments = options.voiceNote ? [] : pendingAttachments;

    flushCustomKeyboardDraftSync();

    if (sending || !targetChatId || (!outgoingDraft.trim() && !outgoingAttachments.length)) {
      return;
    }

    const optimisticAt = new Date().toISOString();
    const previousAttachments = pendingAttachments;
    let receiptId: string | undefined;

    setSending(true);
    setNotice(outgoingAttachments.length ? "Uploading files..." : "");

    try {
      const uploadedFiles = outgoingAttachments.length ? await uploadAttachments(targetChatId) : [];
      const promptText = promptWithUploadedFiles(outgoingDraft, uploadedFiles);
      const optimisticMessageId = optimisticPromptId(optimisticAt);

      const sameChatIsBusy = busyServerChatIds.has(targetChatId) || serverChatIsBusyNow(targetChatId);
      const expectedDisposition = sameChatIsBusy ? "queued" : "started";
      receiptId = startPromptReceipt(
        targetChatId,
        promptText,
        expectedDisposition === "queued" ? "Queueing prompt on server" : "Sending to server"
      );
      setNotice(expectedDisposition === "queued" ? "Queueing prompt on server..." : "Sending to target laptop...");

      const result = await apiFetch<PromptSubmitResult>(`/api/chats/${encodeURIComponent(targetChatId)}/prompt`, {
        method: "POST",
        body: JSON.stringify({ text: promptText })
      });
      const disposition = result.disposition ?? expectedDisposition;

      if (result.job) {
        rememberJob(result.job);
      }

      if (disposition === "started") {
        applyOptimisticPrompt(targetChatId, promptText, optimisticAt, optimisticMessageId, options.voiceNote);
        chatShouldAutoScrollRef.current = true;
        requestChatScroll(true);
        window.requestAnimationFrame(() => scrollChatToBottom("auto"));
        finishPromptReceipt(receiptId, "Server received");
        setNotice(result.message ?? "Prompt sent to target laptop");
      } else {
        finishPromptReceipt(receiptId, "Queued on server");
        setNotice(result.message ?? "Queued on server for this chat");
      }

      if (!options.preserveDraft) {
        setDraftForChat(targetChatId, "");
        if (selectedChatIdRef.current === targetChatId && composerEditorRef.current) {
          syncComposerEditorText(composerEditorRef.current, "");
          composerSelectionRef.current = { start: 0, end: 0 };
          customKeyboardEditRef.current = {
            chatId: targetChatId,
            text: "",
            selection: composerSelectionRef.current
          };
          customKeyboardDraftPresenceRef.current = false;
        }
      }
      if (!options.voiceNote) {
        setPendingAttachments([]);
        setAttachmentUploadStatuses({});
      }
      void loadState();
      void loadChatJobs(targetChatId);
    } catch (error) {
      if (!options.voiceNote) {
        setPendingAttachments(previousAttachments);
      }
      if (receiptId) {
        clearPromptReceipt(receiptId);
      }
      setNotice(error instanceof Error ? error.message : "Prompt failed");
    } finally {
      setSending(false);
    }
  }

  function sendPromptFromPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return;
    }

    if (dictationRecording) {
      event.preventDefault();
      sendHandledOnPointerDownRef.current = true;
      event.currentTarget.blur();
      stopDictation();
      return;
    }

    if (sending || dictationProcessing || !selectedChatId || (!draft.trim() && !pendingAttachments.length)) {
      return;
    }

    event.preventDefault();
    sendHandledOnPointerDownRef.current = true;
    event.currentTarget.blur();
    void sendPrompt();
  }

  function activateScrollButton(event: ReactPointerEvent<HTMLButtonElement> | ReactTouchEvent<HTMLButtonElement> | ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.blur();

    const now = Date.now();
    if (now - scrollButtonLastActivationRef.current < 250) {
      return;
    }

    scrollButtonLastActivationRef.current = now;
    scrollChatToBottom("smooth");
  }

  function sendPromptFromClick() {
    if (sendHandledOnPointerDownRef.current) {
      sendHandledOnPointerDownRef.current = false;
      return;
    }

    if (dictationRecording) {
      stopDictation();
      return;
    }

    void sendPrompt();
  }

  function sendPromptFromKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing ||
      window.matchMedia("(pointer: coarse)").matches ||
      sending ||
      dictationRecording ||
      dictationProcessing ||
      !selectedChatId ||
      (!draft.trim() && !pendingAttachments.length)
    ) {
      return;
    }

    event.preventDefault();
    void sendPrompt();
  }

  function logout() {
    stopDictation();
    localStorage.removeItem(tokenKey);
    setToken("");
    setLoginToken("");
    setAuthenticated(false);
    setChatIndex(null);
    setSelectedChat(null);
    selectedChatIdRef.current = null;
    activeServerJobIdsByChatRef.current.clear();
    chatDetailRequestRef.current += 1;
    setSelectedChatId(null);
    setInstructionsOpen(false);
    setShortcutInstructions(null);
    setSelectedInstructionFile(null);
    setProjectActionMode(null);
    setProjectActionError("");
    setPendingAttachments([]);
    setAttachmentUploadStatuses({});
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
              name="control-token-field"
              type="password"
              value={loginToken}
              onChange={(event) => setLoginToken(event.target.value)}
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
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
    <main className={`remote-shell ${menuOpen ? "is-menu-open" : ""} ${customKeyboardMounted ? "has-custom-keyboard" : ""}`}>
      <aside className="chat-sidebar" aria-label="Project chats">
        <div className="sidebar-header">
          <div className="sidebar-heading-row">
            <div className="sidebar-title-copy">
              <h1>{serverDisplayName}</h1>
              <span>{chatIndex?.totalChats ?? 0} chats</span>
            </div>
            <div className="sidebar-account-actions">
              <NotificationButton status={notificationStatus} busy={notificationBusy} onClick={handleNotificationsClick} />
              <button className="icon-button" type="button" onClick={logout} aria-label="Sign out" title="Sign out">
                <LogOut size={18} />
              </button>
            </div>
          </div>
          <div className="sidebar-actions">
            <button
              className={`icon-button ${projectActionMode === "project" ? "is-active" : ""}`}
              type="button"
              onClick={() => openProjectAction("project")}
              aria-label="Create project"
              aria-pressed={projectActionMode === "project"}
              title="Create project"
            >
              <FolderPlus size={18} />
            </button>
            <button
              className={`icon-button ${projectActionMode === "chat" ? "is-active" : ""}`}
              type="button"
              onClick={() => openProjectAction("chat")}
              aria-label="Start chat"
              aria-pressed={projectActionMode === "chat"}
              title="Start chat"
            >
              <MessageSquarePlus size={18} />
            </button>
            <button
              className={`icon-button ${instructionsOpen ? "is-active" : ""}`}
              type="button"
              onClick={() => {
                setProjectActionMode(null);
                setProjectActionError("");
                setInstructionsOpen((open) => !open);
              }}
              aria-label="Show shortcut instructions"
              aria-pressed={instructionsOpen}
              title="Shortcut instructions"
            >
              <FileText size={18} />
            </button>
            <button className="icon-button" type="button" onClick={refreshWorkspace} aria-label="Refresh chats">
              {loadingChats ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
            </button>
            <button className="icon-button mobile-close-button" type="button" onClick={closeMobileMenuPanels} aria-label="Close menu">
              <X size={18} />
            </button>
          </div>
        </div>

        <RunSettingsPanel
          settings={state?.runner.settings}
          options={state?.runner.settingsOptions}
          usage={state?.runner.usage}
          busy={settingsSaving}
          onChange={updateRunSettings}
        />

        <label className="sidebar-search" aria-label="Search projects and chats">
          <Search size={16} />
          <input
            value={sidebarSearch}
            onChange={(event) => setSidebarSearch(event.currentTarget.value)}
            placeholder="Search projects or chats"
            type="text"
            autoComplete="off"
            spellCheck={false}
          />
          {sidebarSearch ? (
            <button type="button" onClick={() => setSidebarSearch("")} aria-label="Clear sidebar search">
              <X size={15} />
            </button>
          ) : null}
        </label>

        {projectActionMode ? (
          <form
            className="new-project-panel"
            onSubmit={projectActionMode === "project" ? submitNewProject : submitNewChat}
            aria-label={projectActionMode === "project" ? "Create project" : "Start chat"}
          >
            <div className="new-project-panel-header">
              <h2>{projectActionMode === "project" ? "New project" : "New chat"}</h2>
              <button
                className="icon-button"
                type="button"
                onClick={() => {
                  setProjectActionMode(null);
                  setProjectActionError("");
                }}
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>
            {projectActionMode === "project" ? (
              <>
                <label>
                  <span>Project name</span>
                  <input
                    value={newProjectName}
                    onChange={(event) => setNewProjectName(event.currentTarget.value)}
                    disabled={projectActionBusy}
                    autoComplete="off"
                  />
                </label>
                <label>
                  <span>Initial prompt</span>
                  <textarea
                    value={newProjectPrompt}
                    onChange={(event) => setNewProjectPrompt(event.currentTarget.value)}
                    disabled={projectActionBusy}
                    placeholder="Optional"
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  <span>Project folder</span>
                  <select
                    value={newChatProjectPath || selectedChat?.projectPath || projectOptions[0]?.projectPath || ""}
                    onChange={(event) => setNewChatProjectPath(event.currentTarget.value)}
                    disabled={projectActionBusy || !projectOptions.length}
                  >
                    {projectOptions.map((project) => (
                      <option key={project.projectPath} value={project.projectPath}>
                        {project.projectName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Chat name</span>
                  <input
                    value={newChatTitle}
                    onChange={(event) => setNewChatTitle(event.currentTarget.value)}
                    disabled={projectActionBusy}
                    autoComplete="off"
                  />
                </label>
                <label>
                  <span>Initial prompt</span>
                  <textarea
                    value={newChatPrompt}
                    onChange={(event) => setNewChatPrompt(event.currentTarget.value)}
                    disabled={projectActionBusy}
                    placeholder="Optional"
                  />
                </label>
              </>
            )}
            {projectActionError ? <p className="new-project-error">{projectActionError}</p> : null}
            <button type="submit" disabled={projectActionBusy || (projectActionMode === "chat" && !projectOptions.length)}>
              {projectActionBusy ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
              {projectActionMode === "project" ? "Create" : "Start"}
            </button>
          </form>
        ) : null}

        {instructionsOpen ? (
          <div className="instructions-panel" aria-label="Shortcut instruction files">
            <div className="instructions-header">
              <div>
                <h2>Shortcut instructions</h2>
                <p>{shortcutInstructions?.root ?? "C:\\Users\\ibrah\\shortcut-instructions"}</p>
              </div>
              <div className="instructions-actions">
                <button className="icon-button" type="button" onClick={loadShortcutInstructions} aria-label="Refresh shortcut instructions">
                  {instructionsLoading ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => copyInstructions(shortcutInstructions?.files ?? [])}
                  disabled={!shortcutInstructions?.files.length}
                  aria-label="Copy all shortcut instructions"
                >
                  <Copy size={17} />
                </button>
              </div>
            </div>

            {instructionsError ? <p className="instructions-error">{instructionsError}</p> : null}
            {!instructionsError && !shortcutInstructions?.files.length && !instructionsLoading ? (
              <p className="instructions-empty">No instruction files found.</p>
            ) : null}

            <div className="instructions-list">
              {shortcutInstructions?.files.map((file) => (
                <article className="instruction-file" key={file.path}>
                  <div className="instruction-file-header">
                    <div>
                      <h3>{file.relativePath}</h3>
                      <p>
                        {formatBytes(file.size)} · updated {formatRelative(file.updatedAt)}
                      </p>
                    </div>
                    <div className="instruction-file-actions">
                      <button className="icon-button" type="button" onClick={() => openInstructionFile(file)} aria-label={`Open ${file.name}`}>
                        <FileText size={15} />
                      </button>
                      <button className="icon-button" type="button" onClick={() => copyInstructions([file])} aria-label={`Copy ${file.name}`}>
                        <Copy size={15} />
                      </button>
                    </div>
                  </div>
                  <button className="instruction-file-open" type="button" onClick={() => openInstructionFile(file)}>
                    Open Markdown viewer
                  </button>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="project-list">
            {filteredProjectGroups.length ? (
              filteredProjectGroups.map((project) => {
                const listId = `project-${project.projectPath.replace(/[^a-z0-9]/gi, "-")}`;
                const isCollapsed = !normalizedSidebarSearch && collapsedProjects.has(project.projectPath);
                const ChevronIcon = isCollapsed ? ChevronRight : ChevronDown;
                let projectActiveCount = 0;
                let projectHasRunningJob = false;

                for (const chat of project.chats) {
                  const activeJob = activeJobsByChatId.get(chat.id);
                  if (activeJob) {
                    projectActiveCount += activeJob.count;
                    projectHasRunningJob ||= activeJob.running;
                  }
                }

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
                      <span className="project-meta">
                        {isCollapsed && projectActiveCount > 0 ? (
                          <span
                            className={`chat-active-indicator project-active-indicator ${projectHasRunningJob ? "is-running" : ""}`}
                            title={`${projectActiveCount} active command${projectActiveCount === 1 ? "" : "s"} in this project`}
                          >
                            <Loader2 className="spin" size={13} />
                            {projectActiveCount > 1 ? <span>{projectActiveCount}</span> : null}
                          </span>
                        ) : null}
                        <span className="project-count">{project.chats.length}</span>
                      </span>
                    </button>
                    {!isCollapsed ? (
                      <div id={listId} className="chat-list">
                        {project.chats.map((chat) => {
                          const activeJob = activeJobsByChatId.get(chat.id);
                          const hasUnread = unreadChatIds.has(chat.id);

                          return (
                            <button
                              key={chat.id}
                              type="button"
                              className={`chat-link ${selectedChatId === chat.id ? "is-active" : ""} ${hasUnread ? "has-unread" : ""}`}
                              onClick={() => selectChat(chat.id)}
                            >
                              <span className="chat-title-row">
                                <span className="chat-title-text">{chat.title}</span>
                                {hasUnread ? <span className="chat-unread-dot" aria-label="Unread completed response" /> : null}
                              </span>
                              <span className="chat-meta">
                                <small>{formatRelative(chat.updatedAt)}</small>
                                {activeJob ? (
                                  <span
                                    className={`chat-active-indicator ${activeJob.running ? "is-running" : ""}`}
                                    title={`${activeJob.count} active command${activeJob.count === 1 ? "" : "s"}`}
                                  >
                                    <Loader2 className="spin" size={13} />
                                    {activeJob.count > 1 ? <span>{activeJob.count}</span> : null}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </section>
                );
              })
            ) : (
              <div className="sidebar-empty-state">
                <Search size={20} />
                <span>No matching projects or chats</span>
              </div>
            )}
          </div>
        )}
      </aside>

      {selectedInstructionFile ? (
        <div className="markdown-viewer-overlay" role="dialog" aria-modal="true" aria-labelledby="markdown-viewer-title">
          <section className="markdown-viewer">
            <header className="markdown-viewer-header">
              <div>
                <h2 id="markdown-viewer-title">{selectedInstructionFile.relativePath}</h2>
                <p>{selectedInstructionFile.path}</p>
              </div>
              <button className="icon-button" type="button" onClick={closeInstructionFile} aria-label="Close Markdown viewer">
                <X size={18} />
              </button>
            </header>
            <div className="markdown-viewer-body">
              {selectedInstructionLoading && !selectedInstructionContent ? (
                <div className="markdown-viewer-state">
                  <Loader2 className="spin" size={18} />
                  <span>Loading markdown</span>
                </div>
              ) : null}
              {selectedInstructionError ? <p className="markdown-viewer-error">{selectedInstructionError}</p> : null}
              {selectedInstructionContent ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedInstructionContent}</ReactMarkdown> : null}
            </div>
          </section>
        </div>
      ) : null}

      {selectedPdfFile ? (
        <div className="markdown-viewer-overlay pdf-viewer-overlay" role="dialog" aria-modal="true" aria-labelledby="pdf-viewer-title">
          <section className="markdown-viewer pdf-viewer">
            <header className="markdown-viewer-header pdf-viewer-header">
              <div>
                <h2 id="pdf-viewer-title">{selectedPdfFile.label}</h2>
                <p>{selectedPdfFile.path}</p>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={downloadSelectedPdfFile}
                disabled={pdfDownloading}
                aria-label="Download PDF to Files"
                title="Download PDF to Files"
              >
                {pdfDownloading ? <Loader2 className="spin" size={18} /> : <Download size={18} />}
              </button>
              <button className="icon-button" type="button" onClick={closePdfFile} aria-label="Close PDF viewer">
                <X size={18} />
              </button>
            </header>
            <div className="pdf-viewer-body">
              <iframe className="pdf-frame" src={selectedPdfFile.mediaUrl} title={selectedPdfFile.label} />
            </div>
          </section>
        </div>
      ) : null}

      <section className={`chat-workspace ${customKeyboardMounted ? "has-custom-keyboard" : ""}`} aria-label="Selected chat">
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
            <p className="overline">{serverDisplayName}</p>
            <h2>{topbarTitle}</h2>
          </div>
          <div className="chat-topbar-actions">
            <button
              className={`icon-button ${chatActionMode === "rename" ? "is-active" : ""}`}
              type="button"
              onClick={() => openChatAction("rename")}
              disabled={!selectedChatForActions || chatActionBusy}
              aria-label="Rename chat"
              aria-pressed={chatActionMode === "rename"}
              title="Rename chat"
            >
              <Pencil size={18} />
            </button>
            <button
              className={`icon-button ${chatActionMode === "fork" ? "is-active" : ""}`}
              type="button"
              onClick={() => openChatAction("fork")}
              disabled={!selectedChatForActions || chatActionBusy}
              aria-label="Fork chat"
              aria-pressed={chatActionMode === "fork"}
              title="Fork chat"
            >
              <GitFork size={18} />
            </button>
            <button
              className={`icon-button message-view-button is-${selectedChatMessageViewMode}`}
              type="button"
              onClick={cycleSelectedChatMessageViewMode}
              disabled={!selectedChatId}
              aria-label={`Message view: ${selectedChatMessageViewMeta.title}. Press to switch.`}
              aria-pressed={selectedChatMessageViewMode === "final"}
              title={`${selectedChatMessageViewMeta.description} Press to switch.`}
            >
              <Eye size={18} />
              <span className="message-view-label">{selectedChatMessageViewMeta.label}</span>
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={refreshSelectedChat}
              disabled={!selectedChatId || refreshingChat}
              aria-label="Refresh this chat"
              title="Refresh this chat"
            >
              {refreshingChat ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
            </button>
            <div className="desktop-status-controls">
              <StatusControls
                socketLive={socketLive}
                state={state}
                notificationStatus={notificationStatus}
                notificationBusy={notificationBusy}
                onNotifications={handleNotificationsClick}
                onLogout={logout}
              />
            </div>
          </div>
        </header>

        {chatActionMode && selectedChatForActions ? (
          <form className="chat-action-panel" onSubmit={submitChatAction} aria-label={chatActionMode === "rename" ? "Rename chat" : "Fork chat"}>
            <label>
              <span>{chatActionMode === "rename" ? "New chat name" : "Fork name"}</span>
              <input
                value={chatActionName}
                onChange={(event) => setChatActionName(event.currentTarget.value)}
                disabled={chatActionBusy}
                autoComplete="off"
              />
            </label>
            {chatActionError ? <p>{chatActionError}</p> : null}
            <div className="chat-action-buttons">
              <button className="ghost-button" type="button" onClick={() => setChatActionMode(null)} disabled={chatActionBusy}>
                Cancel
              </button>
              <button type="submit" disabled={chatActionBusy}>
                {chatActionBusy ? <Loader2 className="spin" size={15} /> : chatActionMode === "rename" ? <Pencil size={15} /> : <GitFork size={15} />}
                {chatActionMode === "rename" ? "Rename" : "Fork"}
              </button>
            </div>
          </form>
        ) : null}

        <div className="chat-content" ref={chatContentRef} onScroll={updateChatAutoScrollState}>
          {chatShellIsLoading ? (
            <div className="loading-state">
              <Loader2 className="spin" size={24} />
            </div>
          ) : selectedChat ? (
            <div className="chat-thread" aria-label="Recent chat messages">
              {selectedCanLoadMoreMessages ? (
                <button className="load-more-messages" type="button" onClick={loadMoreMessages} disabled={loadingMoreMessages}>
                  {loadingMoreMessages ? <Loader2 className="spin" size={15} /> : <ChevronDown size={15} />}
                  Load 10 more
                </button>
              ) : null}
              {visibleMessageItems.length ? (
                visibleMessageItems.map(({ message, renderKey }, index) => {
                  const runDuration = message.isRunFailure ? "" : responseRunDuration(visibleMessages, index);
                  const runSettingsLabel =
                    message.role === "user" || isFinalCodexMessage(message)
                      ? messageRunSettingsLabel(message, state?.runner.settingsOptions)
                      : "";
                  const showFinalFallbackSeparator =
                    message.role === "assistant" &&
                    message.isFinal &&
                    visibleMessageItems[index + 1]?.message.kind !== "task_complete" &&
                    visibleMessageItems[index + 1]?.message.kind !== "forked_from";

                  if (message.kind === "task_complete" || message.kind === "forked_from") {
                    return (
                      <div className="run-complete-separator" role="separator" aria-label={message.kind === "forked_from" ? "Forked chat" : "Run complete"} data-render-key={renderKey} key={renderKey}>
                        <span>{separatorText(message)}</span>
                      </div>
                    );
                  }

                  return (
                    <div className={`chat-message-group ${message.isLiveThinking ? "is-live-thinking-group" : ""}`} data-render-key={renderKey} key={renderKey}>
                      {message.isLiveThinking ? (
                        <div className="thinking-status">
                          <span className="thinking-label">{liveThinkingStatus}</span>
                          <span className="thinking-age" aria-label={`${messageAgeSeconds(message.createdAt, durationNow)} seconds since latest Codex update`}>
                            {formatMessageAge(message.createdAt, durationNow)}
                          </span>
                        </div>
                      ) : null}
                      <article className={chatMessageClassName(message)} data-render-key={renderKey}>
                        {!message.isLiveThinking ? (
                          <div className="bubble-meta">
                            <time>{formatDate(message.createdAt)}</time>
                            {runSettingsLabel ? <span className="bubble-run-settings">{runSettingsLabel}</span> : null}
                            {runDuration ? (
                              <span className="bubble-duration" title="Run duration">
                                <Clock3 size={12} />
                                {runDuration}
                              </span>
                            ) : null}
                            {message.role === "user" && message.kind !== "voice_note" ? (
                              <CopyButton className="bubble-copy-button" text={message.text} label="Copy prompt" />
                            ) : null}
                          </div>
                        ) : null}
                        {message.isLiveThinking && !message.text ? null : message.kind === "voice_note" ? (
                          <VoiceNotePlayer message={message} />
                        ) : (
                          <FormattedMessage
                            text={message.text}
                            emptyText={chatMessageEmptyText(message)}
                            token={token}
                            basePath={selectedChat.projectPath}
                            onOpenLocalTextFile={openLocalTextFile}
                            onOpenLocalPdfFile={openLocalPdfFile}
                          />
                        )}
                      </article>
                      {showFinalFallbackSeparator ? (
                        <div className="run-complete-separator" role="separator" aria-label="Run complete" data-render-key={`${renderKey}-complete`} key={`${renderKey}-complete`}>
                          <span>Run complete</span>
                        </div>
                      ) : null}
                    </div>
                  );
                })
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

        {selectedQueueCount ? (
          <section className="command-queue" aria-labelledby="command-queue-title">
            <div className="queue-header">
              <div className="queue-title">
                <ListChecks size={17} />
                <h3 id="command-queue-title">Command queue</h3>
              </div>
              <span className="queue-count">
                {selectedQueueCount} queued
              </span>
            </div>

            <div className="queue-list" aria-label="Selected chat command queue">
              {selectedQueuedServerJobs.map((job) => (
                <article key={job.id} className={`queue-item is-${job.status}`}>
                  <div className="queue-status-row">
                    <span className="queue-status">
                      <JobStatusIcon job={job} />
                      {jobStatusLabel(job)}
                    </span>
                    <span className="queue-actions">
                      <time>{formatRelative(job.finishedAt ?? job.startedAt ?? job.createdAt)}</time>
                      <button
                        className="queue-steer"
                        type="button"
                        onClick={() => void steerQueuedJob(job)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                          }
                        }}
                        disabled={!queuedJobCanMoveNext(job, selectedJob, durationNow)}
                        aria-label="Stop current worker and run this queued prompt next"
                        title="Stop the current worker for this chat, then run this queued prompt next"
                      >
                        <ArrowRight size={14} />
                      </button>
                      <button
                        className="queue-remove"
                        type="button"
                        onClick={() => void restoreQueuedJobToComposer(job)}
                        aria-label="Move queued prompt back to composer"
                        title="Move back to composer"
                      >
                        <X size={14} />
                      </button>
                    </span>
                  </div>
                  <p className="queue-preview">{job.promptPreview || "Prompt"}</p>
                  <p className="queue-detail">{jobDetailText(job)}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {selectedPromptReceipt ? (
          <div className={`job-strip is-${selectedPromptReceipt.status}`}>
            {selectedPromptReceipt.status === "sending" ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
            <span className="job-strip-status">
              <span className="job-strip-label">{selectedPromptReceipt.message}</span>
            </span>
            <small>{selectedPromptReceipt.promptPreview}</small>
          </div>
        ) : selectedJob && ["queued", "running"].includes(selectedJob.status) ? (
          <div className="job-strip">
            <Loader2 className={selectedJob.status === "running" ? "spin" : ""} size={16} />
            <span className="job-strip-status">
              <span className="job-strip-label">
                {selectedJob.status === "running" ? "Running on target laptop" : "Queued on target laptop"}
              </span>
              {selectedJob.status === "running" ? (
                <span className="job-duration" aria-label={`Elapsed ${selectedJobDuration}`}>
                  <Clock3 size={13} />
                  {selectedJobDuration}
                </span>
              ) : null}
            </span>
            <small>{selectedJob.promptPreview}</small>
            {selectedJob.status === "running" ? (
              <button
                className="job-stop-button"
                type="button"
                onClick={() => void stopRunningJob(selectedJob)}
                disabled={stoppingJobIds.has(selectedJob.id)}
                aria-label="Stop this chat's running worker"
                title="Stop this chat's running worker"
              >
                {stoppingJobIds.has(selectedJob.id) ? <Loader2 className="spin" size={14} /> : <CircleX size={15} />}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className={`composer ${composerExpanded ? "is-expanded" : ""}`} data-composer="chat">
          <RunSettingsPanel
            compactOnly
            settings={state?.runner.settings}
            options={state?.runner.settingsOptions}
            busy={settingsSaving}
            onChange={updateRunSettings}
          />
          <div className="composer-field">
            <button
              className="attach-button"
              type="button"
              onPointerDown={preserveComposerForTransientFocus}
              onClick={openAttachmentPicker}
              disabled={!selectedChatId || sending || dictationRecording || dictationProcessing || pendingAttachments.length >= maxAttachmentFiles}
              aria-label="Attach files"
              title="Attach files"
            >
              <Paperclip size={18} />
            </button>
            <button
              className={`dictation-button ${dictationRecording ? "is-recording" : ""} ${dictationProcessing ? "is-processing" : ""}`}
              type="button"
              onClick={() => void startDictation()}
              disabled={!selectedChatId || sending || dictationRecording || dictationProcessing}
              aria-label={dictationProcessing ? "Processing dictation" : dictationRecording ? "Recording" : "Start dictation"}
              title={dictationProcessing ? "Processing dictation" : dictationRecording ? "Recording" : "Start dictation"}
            >
              {dictationProcessing ? <Loader2 className="spin" size={18} /> : <Mic size={18} />}
            </button>
            {dictationRecording || dictationProcessing ? (
              <DictationWaveform processing={dictationProcessing} barsRef={dictationBarsRef} />
            ) : (
              <div
                id={composerInputId(selectedChatId)}
                ref={attachComposerEditor}
                className="composer-editor"
                role="textbox"
                aria-label="New prompt"
                aria-multiline="true"
                aria-disabled={!selectedChatId || sending}
                data-placeholder="New prompt"
                data-disabled={!selectedChatId || sending ? "true" : "false"}
                data-chat-id={selectedChatId ?? ""}
                contentEditable={Boolean(selectedChatId && !sending)}
                suppressContentEditableWarning
                inputMode={customKeyboardEnabled ? "none" : "text"}
                data-custom-keyboard={customKeyboardEnabled ? "true" : "false"}
                aria-controls={customKeyboardEnabled ? "custom-chat-keyboard" : undefined}
                autoCapitalize="sentences"
                autoCorrect="on"
                spellCheck={false}
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                onPointerDown={() => {
                  if (customKeyboardEnabled && selectedChatId && !sending) {
                    setCustomKeyboardOpen(true);
                  }
                }}
                onPointerUp={(event) => {
                  const editor = event.currentTarget;
                  window.requestAnimationFrame(() => rememberComposerSelection(editor));
                }}
                onFocus={(event) => {
                  if (customKeyboardEnabled && selectedChatId && !sending) {
                    setCustomKeyboardOpen(true);
                  }
                  const editor = event.currentTarget;
                  window.requestAnimationFrame(() => rememberComposerSelection(editor));
                }}
                onInput={(event) => {
                  commitComposerEditorState(event.currentTarget);
                }}
                onPaste={(event) => {
                  event.preventDefault();
                  flushCustomKeyboardDomSync();
                  const pastedText = event.clipboardData.getData("text/plain");
                  const beforeLength = rawTextFromComposerEditor(event.currentTarget).length;
                  const selection = insertIntoComposer(
                    event.currentTarget,
                    pastedText,
                    selectionInsideComposer(event.currentTarget, composerSelectionRef.current)
                  );
                  commitComposerEditorState(event.currentTarget, selection);
                  recordKeyboardTrace({
                    phase: "paste",
                    pastedLength: pastedText.length,
                    beforeLength,
                    afterLength: rawTextFromComposerEditor(event.currentTarget).length,
                    caret: selection.end
                  });
                }}
                onKeyDown={sendPromptFromKeyboard}
              />
            )}
            <button
              className="send-button"
              type="button"
              onPointerDown={sendPromptFromPointer}
              onClick={sendPromptFromClick}
              disabled={!selectedChatId || dictationProcessing || sending || (!dictationRecording && !draft.trim() && !pendingAttachments.length)}
              aria-label={dictationRecording ? "Stop and send dictation" : "Send prompt"}
              title={dictationRecording ? "Stop and send dictation" : "Send prompt"}
            >
              {sending || dictationProcessing ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
              Send
            </button>
            {pendingAttachments.length ? (
              <div className="attachment-list" aria-label="Files to send">
                {pendingAttachments.map((attachment) => {
                  const uploadStatus = attachmentUploadStatuses[attachment.id] ?? { status: "idle", progress: 0 };
                  const statusText =
                    uploadStatus.status === "uploading"
                      ? uploadStatus.message ?? `Uploading ${uploadStatus.progress}%`
                      : uploadStatus.status === "uploaded"
                        ? "Uploaded"
                        : uploadStatus.status === "failed"
                          ? uploadStatus.message ?? "Upload failed"
                          : "";

                  return (
                    <span key={attachment.id} className={`attachment-chip is-${uploadStatus.status}`}>
                      <span className="attachment-copy">
                        <strong>{attachment.file.name}</strong>
                        <small>{formatBytes(attachment.file.size)}</small>
                        {uploadStatus.status !== "idle" ? (
                          <span className="attachment-upload-status">
                            <span className="attachment-progress" aria-hidden="true">
                              <span style={{ width: `${Math.max(0, Math.min(100, uploadStatus.progress))}%` }} />
                            </span>
                            <small>{statusText}</small>
                          </span>
                        ) : null}
                      </span>
                      {uploadStatus.status === "failed" ? (
                        <button
                          className="attachment-retry-button"
                          type="button"
                          onClick={() => void retryAttachmentUpload(attachment)}
                          disabled={sending}
                        >
                          Retry
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => removeAttachment(attachment.id)}
                        aria-label={`Remove ${attachment.file.name}`}
                        disabled={sending && uploadStatus.status === "uploading"}
                      >
                        <X size={14} />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        {customKeyboardEnabled && customKeyboardMounted ? (
          <div
            id="custom-chat-keyboard"
            className={`custom-keyboard-slot ${customKeyboardOpen ? "is-open" : "is-closing"}`}
            data-custom-keyboard-root="true"
            aria-hidden={!customKeyboardOpen}
          >
            <CustomKeyboard
              onText={insertCustomKeyboardText}
              onBackspace={backspaceCustomKeyboardText}
              onRequestComposerFocus={restoreCustomKeyboardComposerFocus}
              onTrace={recordKeyboardTrace}
              onClose={closeCustomKeyboard}
            />
          </div>
        ) : null}

      </section>
      {selectedChat ? (
        <div className={`scroll-bottom-control ${scrollDistanceFromBottom < 100 ? "is-near-bottom" : ""}`} aria-live="off">
          <button
            className="scroll-to-bottom-button"
            type="button"
            onTouchStart={activateScrollButton}
            onPointerDown={activateScrollButton}
            onMouseDown={activateScrollButton}
            onClick={activateScrollButton}
            aria-label="Scroll to latest message"
            title="Scroll to latest message"
          >
            <ArrowDown size={21} strokeWidth={2.7} />
          </button>
        </div>
      ) : null}
      <RunBoard open={runBoardOpen} jobs={activeRunJobs} chatById={chatSummaryById} nowMs={durationNow} onClose={closeRunBoard} />
    </main>
  );
}
