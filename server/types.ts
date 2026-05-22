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
    tokenConfigured: boolean;
    tokenRequired: boolean;
    platform: NodeJS.Platform;
  };
  server: {
    uptimeSeconds: number;
    port: number;
    clients: number;
  };
  recentEvents: BridgeEvent[];
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
  hasResponse: boolean;
};

export type ChatProjectGroup = {
  projectName: string;
  projectPath: string;
  updatedAt: string;
  chats: ChatSummary[];
};
