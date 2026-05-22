import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CodexRunJob, CodexTranscriptStatus } from "./types.js";

type CodexRunnerOptions = {
  onJobChange?: (job: CodexRunJob, event: JobEvent) => void;
};

type JobEvent = "queued" | "started" | "heartbeat" | "completed" | "failed";

type EnqueueOptions = {
  chatId: string;
  projectPath: string;
  text: string;
  promptPreview: string;
  promptHash: string;
  textLength: number;
};

const maxRecentJobs = 160;
const maxHeartbeatLength = 1200;
const maxHeartbeatHistory = 8;
const sessionsRoot = process.env.CODEX_SESSIONS_DIR ?? path.join(os.homedir(), ".codex", "sessions");
const transcriptVerifyAttempts = Number(process.env.CODEX_TRANSCRIPT_VERIFY_ATTEMPTS ?? 5);
const transcriptVerifyDelayMs = Number(process.env.CODEX_TRANSCRIPT_VERIFY_DELAY_MS ?? 350);

function resolveCliPath(): string {
  const configured = process.env.CODEX_CLI_PATH?.trim();
  if (configured) {
    return configured;
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const localCli = path.join(localAppData, "OpenAI", "Codex", "bin", process.platform === "win32" ? "codex.exe" : "codex");
    if (existsSync(localCli)) {
      return localCli;
    }
  }

  return "codex";
}

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9_.-]/gi, "-").slice(0, 120);
}

function shouldBypassSandbox(): boolean {
  return process.env.CODEX_RUN_BYPASS_SANDBOX !== "false";
}

function shouldSkipGitRepoCheck(): boolean {
  return process.env.CODEX_RUN_SKIP_GIT_REPO_CHECK !== "false";
}

function isSimulationMode(): boolean {
  return process.env.CODEX_RUN_MODE === "simulation" || process.env.CODEX_RUN_ENABLED === "false";
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeTranscriptText(text: string): string {
  return text.replace(/\r\n/g, "\n").trimEnd();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampHeartbeat(text: string): string {
  const normalized = text.trim();
  return normalized.length > maxHeartbeatLength ? `${normalized.slice(0, maxHeartbeatLength)}...` : normalized;
}

function isHeartbeatText(text: string): boolean {
  return /^(\*\*)?heartbeat(\*\*)?\s*:/i.test(text.trim());
}

function heartbeatFromRecord(record: unknown): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const candidate = record as {
    type?: string;
    message?: unknown;
    payload?: {
      type?: string;
      message?: unknown;
      role?: string;
      phase?: string;
      content?: unknown;
    };
  };

  if (candidate.type === "agent_message" && typeof candidate.message === "string") {
    return clampHeartbeat(candidate.message);
  }

  if (candidate.payload?.type === "agent_message" && typeof candidate.payload.message === "string") {
    return clampHeartbeat(candidate.payload.message);
  }

  if (
    candidate.payload?.type === "message" &&
    candidate.payload.role === "assistant" &&
    candidate.payload.phase === "commentary"
  ) {
    const text = textFromContent(candidate.payload.content);
    return text ? clampHeartbeat(text) : null;
  }

  return null;
}

export class CodexRunner {
  private readonly onJobChange?: CodexRunnerOptions["onJobChange"];
  private readonly queue: Array<{ job: CodexRunJob; text: string }> = [];
  private readonly jobs = new Map<string, CodexRunJob>();
  private processing = false;

  readonly cliPath = resolveCliPath();
  readonly bypassSandbox = shouldBypassSandbox();
  readonly skipGitRepoCheck = shouldSkipGitRepoCheck();
  readonly simulationMode = isSimulationMode();

  constructor(options: CodexRunnerOptions = {}) {
    this.onJobChange = options.onJobChange;
  }

  get mode() {
    return this.simulationMode ? "simulation" : "codex-cli";
  }

  get activeJobs() {
    return this.processing ? 1 : 0;
  }

  get queuedJobs() {
    return this.queue.length;
  }

  get recentJobs(): CodexRunJob[] {
    return this.sortedJobs.slice(0, maxRecentJobs);
  }

  jobsForChat(chatId: string): CodexRunJob[] {
    return this.sortedJobs.filter((job) => job.chatId === chatId);
  }

  private get sortedJobs(): CodexRunJob[] {
    return [...this.jobs.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  enqueue(options: EnqueueOptions): CodexRunJob {
    const createdAt = new Date().toISOString();
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const runLogDir = path.resolve(process.cwd(), "logs", "codex-runs");
    const logBase = `${createdAt.replace(/[:.]/g, "-")}-${safeSegment(options.chatId)}-${safeSegment(id)}`;
    const job: CodexRunJob = {
      id,
      chatId: options.chatId,
      projectPath: options.projectPath,
      status: "queued",
      createdAt,
      promptPreview: options.promptPreview,
      promptHash: options.promptHash,
      textLength: options.textLength,
      command: [],
      logPaths: {
        stdout: path.join(runLogDir, `${logBase}.stdout.log`),
        stderr: path.join(runLogDir, `${logBase}.stderr.log`),
        lastMessage: path.join(runLogDir, `${logBase}.last-message.txt`)
      },
      message: "Queued for Codex CLI on the target laptop"
    };

    job.command = [this.cliPath, ...this.argsForJob(job)];
    this.jobs.set(id, job);
    this.queue.push({ job, text: options.text });
    this.refreshQueuePositions();
    this.emit(job, "queued");
    void this.processNext();

    return job;
  }

  private argsForJob(job: CodexRunJob): string[] {
    const args = [
      "exec",
      "resume",
      "--all",
      "--json",
      "--output-last-message",
      job.logPaths.lastMessage
    ];

    if (this.bypassSandbox) {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    }

    if (this.skipGitRepoCheck) {
      args.push("--skip-git-repo-check");
    }

    args.push(job.chatId, "-");
    return args;
  }

  private async processNext(): Promise<void> {
    if (this.processing) {
      return;
    }

    const next = this.queue.shift();
    if (!next) {
      return;
    }

    next.job.queuePosition = undefined;
    this.refreshQueuePositions(true);
    this.processing = true;

    try {
      await this.runJob(next.job, next.text);
    } finally {
      this.processing = false;
      void this.processNext();
    }
  }

  private async runJob(job: CodexRunJob, text: string): Promise<void> {
    await fs.mkdir(path.dirname(job.logPaths.stdout), { recursive: true });
    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.command = [this.cliPath, ...this.argsForJob(job)];
    job.message = this.simulationMode ? "Simulating Codex CLI run" : "Running Codex CLI on target laptop";
    this.emit(job, "started");

    if (this.simulationMode) {
      await fs.writeFile(job.logPaths.stdout, `simulation prompt for ${job.chatId}\n`, "utf8");
      await fs.writeFile(job.logPaths.stderr, "", "utf8");
      await fs.writeFile(job.logPaths.lastMessage, "Simulation mode: no Codex command was run.", "utf8");
      this.updateHeartbeat(job, "Simulation heartbeat: prompt accepted by the target laptop queue.");
      job.status = "completed";
      job.exitCode = 0;
      job.signal = null;
      job.finishedAt = new Date().toISOString();
      job.message = "Simulation completed";
      this.emit(job, "completed");
      return;
    }

    await new Promise<void>((resolve) => {
      const stdout = createWriteStream(job.logPaths.stdout, { flags: "a" });
      const stderr = createWriteStream(job.logPaths.stderr, { flags: "a" });
      let stdoutBuffer = "";
      const child = spawn(this.cliPath, this.argsForJob(job), {
        cwd: existsSync(job.projectPath) ? job.projectPath : os.homedir(),
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });

      child.stdout.on("data", (chunk: Buffer) => {
        stdout.write(chunk);
        stdoutBuffer += chunk.toString("utf8");

        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";

        for (const line of lines) {
          this.handleStdoutLine(job, line);
        }
      });
      child.stderr.pipe(stderr);
      child.stdin.end(text);

      child.on("error", (error) => {
        stderr.write(`${error.name}: ${error.message}\n`);
      });

      child.on("close", (code, signal) => {
        void (async () => {
          if (stdoutBuffer.trim()) {
            this.handleStdoutLine(job, stdoutBuffer);
          }

          stdout.end();
          stderr.end();
          job.exitCode = code;
          job.signal = signal;
          job.finishedAt = new Date().toISOString();
          job.status = code === 0 ? "completed" : "failed";

          if (code === 0) {
            job.codexTranscript = await this.verifyCodexTranscript(job, text);
            job.message = job.codexTranscript.responseVisible
              ? "Codex CLI completed and saved to Codex transcript"
              : "Codex CLI completed; Codex transcript visibility was not fully confirmed";
          } else {
            job.codexTranscript = await this.verifyCodexTranscript(job, text);
            job.message = `Codex CLI failed with exit code ${code ?? "unknown"}`;
          }

          this.emit(job, job.status === "completed" ? "completed" : "failed");
          resolve();
        })().catch((error: unknown) => {
          stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
          stderr.end();
          stdout.end();
          job.exitCode = code;
          job.signal = signal;
          job.finishedAt = new Date().toISOString();
          job.status = "failed";
          job.message = error instanceof Error ? error.message : "Codex CLI transcript verification failed";
          this.emit(job, "failed");
          resolve();
        });
      });
    });
  }

  private async findSessionPath(chatId: string): Promise<string | null> {
    async function visit(dir: string): Promise<string | null> {
      let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;

      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return null;
      }

      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);

        if (entry.isFile() && entry.name.endsWith(`${chatId}.jsonl`)) {
          return entryPath;
        }

        if (entry.isDirectory()) {
          const found = await visit(entryPath);
          if (found) {
            return found;
          }
        }
      }

      return null;
    }

    return visit(sessionsRoot);
  }

  private async readTranscriptStatus(job: CodexRunJob, text: string): Promise<CodexTranscriptStatus> {
    const sessionPath = await this.findSessionPath(job.chatId);
    const checkedAt = new Date().toISOString();

    if (!sessionPath) {
      return {
        checkedAt,
        promptVisible: false,
        responseVisible: false,
        message: "Codex session file was not found"
      };
    }

    const expectedPrompt = normalizeTranscriptText(text);
    let promptVisible = false;
    let responseVisible = false;

    try {
      const raw = await fs.readFile(sessionPath, "utf8");

      for (const line of raw.split(/\r?\n/)) {
        if (!line.includes('"type":"message"')) {
          continue;
        }

        try {
          const record = JSON.parse(line) as {
            payload?: {
              type?: string;
              role?: string;
              phase?: string;
              content?: unknown;
            };
          };

          if (record.payload?.type !== "message") {
            continue;
          }

          const contentText = normalizeTranscriptText(textFromContent(record.payload.content));

          if (record.payload.role === "user" && contentText === expectedPrompt) {
            promptVisible = true;
            responseVisible = false;
            continue;
          }

          const isFinalAssistant = record.payload.phase === "final_answer" || !record.payload.phase;
          const isDisplayableAssistant = isFinalAssistant || !isHeartbeatText(contentText);

          if (promptVisible && record.payload.role === "assistant" && contentText && isDisplayableAssistant) {
            responseVisible = true;
          }
        } catch {
          continue;
        }
      }
    } catch {
      return {
        checkedAt,
        promptVisible: false,
        responseVisible: false,
        sessionPath,
        message: "Codex session file could not be read"
      };
    }

    return {
      checkedAt,
      promptVisible,
      responseVisible,
      sessionPath,
      message:
        promptVisible && responseVisible
          ? "Prompt and response are visible in Codex"
          : promptVisible
            ? "Prompt is visible in Codex; response was not found yet"
            : "Prompt was not found in the Codex transcript"
    };
  }

  private async verifyCodexTranscript(job: CodexRunJob, text: string): Promise<CodexTranscriptStatus> {
    let status = await this.readTranscriptStatus(job, text);

    for (let attempt = 1; attempt < transcriptVerifyAttempts && !(status.promptVisible && status.responseVisible); attempt += 1) {
      await delay(transcriptVerifyDelayMs);
      status = await this.readTranscriptStatus(job, text);
    }

    return status;
  }

  private handleStdoutLine(job: CodexRunJob, line: string) {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      const heartbeat = heartbeatFromRecord(JSON.parse(trimmed));
      if (heartbeat) {
        this.updateHeartbeat(job, heartbeat);
      }
    } catch {
      return;
    }
  }

  private updateHeartbeat(job: CodexRunJob, text: string) {
    job.heartbeat = text;
    job.heartbeatAt = new Date().toISOString();
    job.heartbeatHistory = [...(job.heartbeatHistory ?? []), text].slice(-maxHeartbeatHistory);
    job.message = text;
    this.emit(job, "heartbeat");
  }

  private refreshQueuePositions(emitChanges = false) {
    for (const [index, item] of this.queue.entries()) {
      const queuePosition = index + 1;

      if (item.job.queuePosition !== queuePosition) {
        item.job.queuePosition = queuePosition;

        if (emitChanges) {
          this.emit(item.job, "queued");
        }
      }
    }
  }

  private emit(job: CodexRunJob, event: JobEvent) {
    this.onJobChange?.({ ...job, logPaths: { ...job.logPaths }, command: [...job.command] }, event);
  }
}
