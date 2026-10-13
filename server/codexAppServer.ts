import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { CodexRunSettings } from "./types.js";
import { withRemotePromptContext, type PromptInputSource, type RemoteSkillContext } from "./remotePromptContext.js";

type JsonRecord = Record<string, any>;
type PendingRequest = {
  resolve: (value: JsonRecord) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class CodexRpcError extends Error {
  constructor(message: string, readonly outcomeUnknown = false) {
    super(message);
    this.name = "CodexRpcError";
  }
}

type SessionOptions = {
  child: ChildProcessWithoutNullStreams;
  threadId: string;
  cwd: string;
  settings?: CodexRunSettings;
  remoteSkill?: RemoteSkillContext;
  inputSource?: PromptInputSource;
  bypassSandbox: boolean;
  onTurnId: (turnId: string) => void;
  onMessage: (text: string, final: boolean) => void;
  onUserMessage: (clientId: string) => void;
  onComplete: (status: "completed" | "failed" | "stopped", message?: string) => void;
  requestTimeoutMs?: number;
};

/** One active Codex thread over the CLI's native, bidirectional stdio protocol. */
export class CodexAppServerSession {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly confirmedInputs = new Set<string>();
  private turnId: string | null = null;
  private ended = false;
  private disposed = false;
  private interruptionRequested = false;
  private startPromise?: Promise<void>;

  constructor(private readonly options: SessionOptions) {}

  private send(message: JsonRecord) {
    if (this.disposed || this.options.child.stdin.destroyed) throw new CodexRpcError("Codex connection closed", true);
    this.options.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(method: string, params: JsonRecord): Promise<JsonRecord> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexRpcError(`Codex ${method} acknowledgement timed out`, true));
      }, this.options.requestTimeoutMs ?? 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  start(text: string, clientId: string): Promise<void> {
    this.startPromise ??= this.startTurn(text, clientId);
    return this.startPromise;
  }

  private input(text: string, inputSource = this.options.inputSource) {
    const skill = this.options.remoteSkill;
    return [
      { type: "text", text: withRemotePromptContext(text, { chatId: this.options.threadId, inputSource, skill }), text_elements: [] },
      ...(skill ? [{ type: "skill", name: skill.name, path: skill.path }] : [])
    ];
  }

  private async startTurn(text: string, clientId: string) {
    const { threadId, cwd, settings, bypassSandbox } = this.options;
    await this.request("initialize", {
      clientInfo: { name: "codex-remote", title: "Codex Remote", version: "0.1.0" },
      capabilities: { experimentalApi: true }
    });
    this.send({ method: "initialized" });
    if (this.interruptionRequested) throw new CodexRpcError("Turn cancelled before startup");
    await this.request("thread/resume", {
      threadId, cwd, excludeTurns: true,
      approvalPolicy: "never",
      ...(bypassSandbox ? { sandbox: "danger-full-access" } : {}),
      ...(settings?.model && settings.model !== "default" ? { model: settings.model } : {})
    });
    if (this.interruptionRequested) throw new CodexRpcError("Turn cancelled before startup");
    const result = await this.request("turn/start", {
      threadId,
      clientUserMessageId: clientId,
      input: this.input(text),
      cwd,
      approvalPolicy: "never",
      ...(bypassSandbox ? { sandboxPolicy: { type: "dangerFullAccess" } } : {}),
      ...(settings?.model && settings.model !== "default" ? { model: settings.model } : {}),
      ...(settings?.reasoningEffort ? { effort: settings.reasoningEffort } : {}),
      // Older installed app-servers expose only serviceTier. Each connection
      // runs one turn, so explicitly set/clear that tier as well. Never silently
      // inherit a previous priority run when this queued prompt is standard.
      serviceTier: settings?.speed === "priority" ? "priority" : null,
      serviceTierForTurn: settings?.speed === "priority" ? "priority" : "default"
    });
    if (typeof result.turn?.id !== "string") throw new CodexRpcError("Codex did not return a turn ID", true);
    // A very short turn can complete before the start acknowledgement arrives.
    if (!this.ended) this.setTurnId(result.turn.id);
  }

  private setTurnId(turnId: string) {
    this.turnId = turnId;
    this.options.onTurnId(turnId);
  }

  async steer(text: string, clientId: string, inputSource: PromptInputSource = "typed"): Promise<string> {
    await this.startPromise;
    const expectedTurnId = this.turnId;
    if (this.ended || !expectedTurnId) throw new CodexRpcError("The active turn has already ended; the prompt is still queued");
    try {
      const result = await this.request("turn/steer", {
        threadId: this.options.threadId,
        expectedTurnId,
        clientUserMessageId: clientId,
        input: this.input(text, inputSource)
      });
      if (result.turnId !== expectedTurnId) throw new CodexRpcError("Codex acknowledged a different turn", true);
      return expectedTurnId;
    } catch (error) {
      // A persisted input event is stronger evidence than a lost RPC reply.
      if (this.confirmedInputs.has(clientId)) return expectedTurnId;
      throw error;
    }
  }

  async interrupt() {
    this.interruptionRequested = true;
    await this.startPromise;
    if (this.ended || !this.turnId) return;
    await this.request("turn/interrupt", { threadId: this.options.threadId, turnId: this.turnId });
  }

  hasConfirmedInput(clientId: string) { return this.confirmedInputs.has(clientId); }

  handleLine(line: string) {
    if (this.disposed) return;
    let message: JsonRecord;
    try { message = JSON.parse(line); } catch { return; }
    if (!message || typeof message !== "object" || Array.isArray(message)) return;
    if (message.id !== undefined && typeof message.method !== "string") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new CodexRpcError(message.error.message ?? "Codex rejected the request"));
      else pending.resolve(message.result ?? {});
      return;
    }
    if (message.id !== undefined && typeof message.method === "string") {
      // Never auto-approve an unexpected permission/tool request. Noninteractive
      // runs use approvalPolicy=never, just as the previous exec driver did.
      this.send({ id: message.id, error: { code: -32601, message: `Codex Remote cannot answer ${message.method}` } });
      return;
    }
    const params = message.params;
    if (!params || params.threadId !== this.options.threadId) return;
    if (message.method === "turn/started" && typeof params.turn?.id === "string" && !this.ended) {
      this.setTurnId(params.turn.id);
    }
    if (params.turnId && this.turnId && params.turnId !== this.turnId) return;
    if (message.method === "item/started" || message.method === "item/completed") {
      const item = params.item;
      if (item?.type === "userMessage" && typeof item.clientId === "string" && !this.confirmedInputs.has(item.clientId)) {
        this.confirmedInputs.add(item.clientId);
        this.options.onUserMessage(item.clientId);
      }
      if (message.method === "item/completed" && item?.type === "agentMessage" && typeof item.text === "string") {
        this.options.onMessage(item.text, item.phase === "final_answer" || item.phase === "final" || !item.phase);
      }
    }
    if (message.method === "turn/completed" && params.turn?.id === this.turnId && !this.ended) {
      this.ended = true;
      const status = params.turn.status === "completed" ? "completed" : params.turn.status === "interrupted" ? "stopped" : "failed";
      this.options.onComplete(status, params.turn.error?.message);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new CodexRpcError("Codex connection closed before acknowledging the request", true));
    }
    this.pending.clear();
  }
}
