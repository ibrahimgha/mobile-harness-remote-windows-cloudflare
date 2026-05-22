import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CodexRunJob } from "./types.js";

type CodexRunnerOptions = {
  onJobChange?: (job: CodexRunJob, event: "queued" | "started" | "completed" | "failed") => void;
};

type EnqueueOptions = {
  chatId: string;
  projectPath: string;
  text: string;
  promptPreview: string;
  promptHash: string;
  textLength: number;
};

const maxRecentJobs = 40;

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
    return [...this.jobs.values()]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, maxRecentJobs);
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
      const child = spawn(this.cliPath, this.argsForJob(job), {
        cwd: existsSync(job.projectPath) ? job.projectPath : os.homedir(),
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });

      child.stdout.pipe(stdout);
      child.stderr.pipe(stderr);
      child.stdin.end(text);

      child.on("error", (error) => {
        stderr.write(`${error.name}: ${error.message}\n`);
      });

      child.on("close", (code, signal) => {
        stdout.end();
        stderr.end();
        job.exitCode = code;
        job.signal = signal;
        job.finishedAt = new Date().toISOString();
        job.status = code === 0 ? "completed" : "failed";
        job.message = code === 0 ? "Codex CLI completed" : `Codex CLI failed with exit code ${code ?? "unknown"}`;
        this.emit(job, job.status === "completed" ? "completed" : "failed");
        resolve();
      });
    });
  }

  private emit(job: CodexRunJob, event: "queued" | "started" | "completed" | "failed") {
    this.onJobChange?.({ ...job, logPaths: { ...job.logPaths }, command: [...job.command] }, event);
  }
}
