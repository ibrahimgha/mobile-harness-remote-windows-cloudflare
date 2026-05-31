export type BridgeMode = "simulation" | "window-control";

export type BridgeEventType = "action" | "error" | "status";

export type BridgeEvent = {
  id: string;
  type: BridgeEventType;
  createdAt: string;
  message: string;
  detail?: Record<string, unknown>;
};

export type BridgeState = {
  bridge: {
    mode: BridgeMode;
    targetTitle: string;
    controlEnabled: boolean;
    promptDelivery: PromptDeliveryMode;
    tokenConfigured: boolean;
    tokenRequired: boolean;
    platform: NodeJS.Platform;
  };
  server: {
    uptimeSeconds: number;
    port: number;
    clients: number;
  };
  runner: {
    mode: CodexRunMode;
    cliPath: string;
    bypassSandbox: boolean;
    skipGitRepoCheck: boolean;
    settings: CodexRunSettings;
    settingsOptions: CodexRunSettingsOptions;
    activeJobs: number;
    queuedJobs: number;
    recentJobs: CodexRunJob[];
  };
  recentEvents: BridgeEvent[];
};

export type CodexRunMode = "codex-cli" | "simulation";
export type PromptDeliveryMode = "cli";

export type CodexRunStatus = "queued" | "running" | "completed" | "failed";

export type CodexRunSettings = {
  model: string;
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  speed: "default" | "priority";
  updatedAt: string;
};

export type CodexRunSettingsOptions = {
  models: string[];
  reasoningEfforts: CodexRunSettings["reasoningEffort"][];
  speeds: CodexRunSettings["speed"][];
};

export type CodexRunJob = {
  id: string;
  chatId: string;
  projectPath: string;
  status: CodexRunStatus;
  kind?: "prompt" | "steer";
  queuePosition?: number;
  createdAt: string;
  promptPreview: string;
  promptHash: string;
  textLength: number;
  command: string[];
  settings?: CodexRunSettings;
  logPaths: {
    stdout: string;
    stderr: string;
    lastMessage: string;
  };
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  message?: string;
  heartbeat?: string;
  heartbeatAt?: string;
  heartbeatHistory?: string[];
  codexTranscript?: CodexTranscriptStatus;
};

export type CodexTranscriptStatus = {
  checkedAt: string;
  promptVisible: boolean;
  responseVisible: boolean;
  sessionPath?: string;
  message: string;
};

export type ControlResult = {
  ok: boolean;
  simulated: boolean;
  message: string;
  diagnostics?: ControlDiagnostics;
};

export type ControlDiagnostics = {
  label: string;
  elapsedMs: number;
  targetTitle: string;
  platform: NodeJS.Platform;
  enabled: boolean;
  stdout?: string;
  stderr?: string;
  errorName?: string;
  exitCode?: number | string;
  signal?: string;
};

export type ChatMessageExcerpt = {
  text: string;
  createdAt: string;
};

export type ChatTranscriptMessage = ChatMessageExcerpt & {
  id: string;
  role: "user" | "assistant";
  isFinal?: boolean;
};

export type ChatSummary = {
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

export type ChatDetail = {
  id: string;
  title: string;
  projectName: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  lastPrompt: ChatMessageExcerpt | null;
  lastResponse: ChatMessageExcerpt | null;
  messages: ChatTranscriptMessage[];
  messagePage: {
    visibleTurns: number;
    totalTurns: number;
    hasMore: boolean;
  };
  hasResponse: boolean;
};

export type ChatProjectGroup = {
  projectName: string;
  projectPath: string;
  updatedAt: string;
  chats: ChatSummary[];
};

export type UploadedPromptFile = {
  name: string;
  originalName: string;
  type: string;
  size: number;
  path: string;
  relativePath: string;
  uploadedAt: string;
};

export type ShortcutInstructionFile = {
  name: string;
  path: string;
  relativePath: string;
  size: number;
  updatedAt: string;
  content: string;
};
