import type { BridgeEvent, ChatProjectGroup, CodexRunJob, CodexRunSettings, CodexUsage } from "./types.js";
import type { ActiveSessionRun } from "./sessionActivity.js";

export type TrackerRun = {
  id: string;
  chatId: string;
  title: string;
  projectName: string;
  status: "running" | "completed" | "failed" | "stopped";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  model: string;
  reasoningEffort: string;
};

export type ControlRoomTrackerSnapshot = {
  ok: true;
  generatedAt: string;
  dayStartedAt: string;
  serverName: string;
  runningCount: number;
  completedSinceDayStart: number;
  running: TrackerRun[];
  recent: TrackerRun[];
  usage: CodexUsage | null;
};

type ChatMetadata = {
  title: string;
  projectName: string;
};

export function trackerDayStart(now = new Date()): Date {
  const start = new Date(now);
  start.setHours(5, 0, 0, 0);
  if (now.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
  return start;
}

function jobFromAuditEvent(event: BridgeEvent): CodexRunJob | null {
  const job = event.detail?.job;
  if (!job || typeof job !== "object") return null;
  const candidate = job as Partial<CodexRunJob>;
  return typeof candidate.id === "string" && typeof candidate.chatId === "string" && typeof candidate.status === "string"
    ? (candidate as CodexRunJob)
    : null;
}

function chatMetadata(projects: ChatProjectGroup[]): Map<string, ChatMetadata> {
  return new Map(
    projects.flatMap((project) =>
      project.chats.map((chat) => [chat.id, { title: chat.title, projectName: chat.projectName }] as const)
    )
  );
}

function runFromJob(job: CodexRunJob, chats: Map<string, ChatMetadata>, fallbackSettings: CodexRunSettings): TrackerRun | null {
  if (!job.startedAt || !["running", "completed", "failed", "stopped"].includes(job.status)) return null;
  const metadata = chats.get(job.chatId);
  const settings = job.settings ?? fallbackSettings;
  const finishedMs = job.finishedAt ? Date.parse(job.finishedAt) : NaN;
  const startedMs = Date.parse(job.startedAt);
  return {
    id: job.id,
    chatId: job.chatId,
    title: metadata?.title ?? job.promptPreview ?? "Untitled job",
    projectName: metadata?.projectName ?? job.projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? "Unknown project",
    status: job.status as TrackerRun["status"],
    startedAt: job.startedAt,
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    ...(Number.isFinite(finishedMs) && Number.isFinite(startedMs) ? { durationMs: Math.max(0, finishedMs - startedMs) } : {}),
    model: settings.model,
    reasoningEffort: settings.reasoningEffort
  };
}

export function buildControlRoomTrackerSnapshot(options: {
  serverName: string;
  now?: Date;
  projects: ChatProjectGroup[];
  jobs: CodexRunJob[];
  auditEvents: BridgeEvent[];
  activeSessionRuns: ActiveSessionRun[];
  defaultSettings: CodexRunSettings;
  externalSettings?: Map<string, Pick<CodexRunSettings, "model" | "reasoningEffort">>;
  usage: CodexUsage | null;
}): ControlRoomTrackerSnapshot {
  const now = options.now ?? new Date();
  const dayStart = trackerDayStart(now);
  const chats = chatMetadata(options.projects);
  const jobsById = new Map<string, CodexRunJob>();

  for (const event of options.auditEvents) {
    const job = jobFromAuditEvent(event);
    if (job && !jobsById.has(job.id)) jobsById.set(job.id, job);
  }
  for (const job of options.jobs) jobsById.set(job.id, job);

  const jobRuns = [...jobsById.values()]
    .map((job) => runFromJob(job, chats, options.defaultSettings))
    .filter((run): run is TrackerRun => Boolean(run));
  const runningChatIds = new Set(jobRuns.filter((run) => run.status === "running").map((run) => run.chatId));
  const externalRuns = options.activeSessionRuns
    .filter((run) => !runningChatIds.has(run.chatId))
    .map((run) => {
      const metadata = chats.get(run.chatId);
      const settings = options.externalSettings?.get(run.chatId) ?? options.defaultSettings;
      return {
        id: `session-${run.chatId}-${run.startedAt}`,
        chatId: run.chatId,
        title: metadata?.title ?? "External Codex session",
        projectName: metadata?.projectName ?? "Unknown project",
        status: "running" as const,
        startedAt: run.startedAt,
        model: settings.model,
        reasoningEffort: settings.reasoningEffort
      };
    });
  const running = [...jobRuns.filter((run) => run.status === "running"), ...externalRuns]
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const terminalRuns = jobRuns
    .filter((run) => run.status !== "running" && run.finishedAt)
    .sort((a, b) => Date.parse(b.finishedAt!) - Date.parse(a.finishedAt!));

  return {
    ok: true,
    generatedAt: now.toISOString(),
    dayStartedAt: dayStart.toISOString(),
    serverName: options.serverName,
    runningCount: running.length,
    completedSinceDayStart: terminalRuns.filter(
      (run) => run.status === "completed" && Date.parse(run.finishedAt!) >= dayStart.getTime()
    ).length,
    running,
    recent: terminalRuns.slice(0, 10),
    usage: options.usage
  };
}
