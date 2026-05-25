import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearSessionCache, findNewestChatForProject } from "./codexSessions.js";
import { promoteChatForDesktop } from "./desktopVisibility.js";
import type { ChatDetail } from "./types.js";

type StartProjectChatOptions = {
  cliPath: string;
  bypassSandbox: boolean;
  skipGitRepoCheck: boolean;
  projectPath: string;
  projectName: string;
  prompt?: string;
};

export type ProjectChatStartResult = {
  projectPath: string;
  chat: ChatDetail;
  logPaths: {
    stdout: string;
    stderr: string;
    lastMessage: string;
  };
};

const defaultProjectsRoot = path.resolve(process.env.CODEX_NEW_PROJECTS_ROOT ?? os.homedir());
const maxProjectNameLength = Number(process.env.CODEX_NEW_PROJECT_NAME_MAX_CHARS ?? 80);
const maxInitialPromptLength = Number(process.env.CODEX_NEW_PROJECT_PROMPT_MAX_CHARS ?? 12000);
const reservedWindowsNames = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9"
]);

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9_.-]/gi, "-").slice(0, 120);
}

function sanitizeProjectFolderName(name: string): string {
  const sanitized = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, maxProjectNameLength);

  if (!sanitized) {
    throw new Error("Project name is required");
  }

  if (reservedWindowsNames.has(sanitized.toLowerCase())) {
    return `${sanitized}-project`;
  }

  return sanitized;
}

function assertInsideRoot(root: string, target: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const comparableRoot = process.platform === "win32" ? resolvedRoot.toLowerCase() : resolvedRoot;
  const comparableTarget = process.platform === "win32" ? resolvedTarget.toLowerCase() : resolvedTarget;

  if (comparableTarget !== comparableRoot && !comparableTarget.startsWith(`${comparableRoot}${path.sep}`)) {
    throw new Error("Project path escaped the configured project root");
  }
}

export function resolveNewProjectPath(name: string): { folderName: string; projectPath: string; root: string } {
  const root = defaultProjectsRoot;
  const folderName = sanitizeProjectFolderName(name);
  const projectPath = path.join(root, folderName);

  assertInsideRoot(root, projectPath);

  return { folderName, projectPath, root };
}

function initialPrompt(projectName: string, prompt: string | undefined): string {
  const trimmed = prompt?.trim();

  if (trimmed) {
    if (trimmed.length > maxInitialPromptLength) {
      throw new Error(`Initial prompt is longer than ${maxInitialPromptLength} characters`);
    }

    return trimmed;
  }

  return `Start a new Codex chat for the project "${projectName}" in this folder. Do not create, edit, or delete files yet. Reply with a brief ready message.`;
}

async function waitForNewChat(projectPath: string, afterMs: number): Promise<ChatDetail | null> {
  const deadline = Date.now() + Number(process.env.CODEX_NEW_PROJECT_CHAT_DISCOVERY_MS ?? 10000);

  while (Date.now() < deadline) {
    const chat = await findNewestChatForProject(projectPath, afterMs);

    if (chat) {
      return chat;
    }

    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  return findNewestChatForProject(projectPath, afterMs);
}

export async function startProjectChat(options: StartProjectChatOptions): Promise<ProjectChatStartResult> {
  const prompt = initialPrompt(options.projectName, options.prompt);
  const startedAtMs = Date.now() - 1000;
  const createdAt = new Date().toISOString();
  const runLogDir = path.resolve(process.cwd(), "logs", "codex-runs");
  const logBase = `${createdAt.replace(/[:.]/g, "-")}-new-project-${safeSegment(options.projectName)}`;
  const logPaths = {
    stdout: path.join(runLogDir, `${logBase}.stdout.log`),
    stderr: path.join(runLogDir, `${logBase}.stderr.log`),
    lastMessage: path.join(runLogDir, `${logBase}.last-message.txt`)
  };
  const args = ["exec", "--json", "--output-last-message", logPaths.lastMessage];

  if (options.bypassSandbox) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  }

  if (options.skipGitRepoCheck) {
    args.push("--skip-git-repo-check");
  }

  args.push("-");

  await fs.mkdir(path.dirname(logPaths.stdout), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const stdout = createWriteStream(logPaths.stdout, { flags: "a" });
    const stderr = createWriteStream(logPaths.stderr, { flags: "a" });
    const child = spawn(options.cliPath, args, {
      cwd: existsSync(options.projectPath) ? options.projectPath : os.homedir(),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    child.stdin.end(prompt);

    child.on("error", (error) => {
      stderr.write(`${error.name}: ${error.message}\n`);
      stdout.end();
      stderr.end();
      reject(error);
    });

    child.on("close", (code) => {
      stdout.end();
      stderr.end();

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Codex new project chat failed with exit code ${code ?? "unknown"}`));
    });
  });

  const chat = await waitForNewChat(options.projectPath, startedAtMs);

  if (!chat) {
    throw new Error("Project folder was created, but the new Codex chat could not be found yet");
  }

  await promoteChatForDesktop(chat, options.projectName, options.projectPath);
  clearSessionCache();

  return {
    projectPath: options.projectPath,
    chat: {
      ...chat,
      title: options.projectName
    },
    logPaths
  };
}
