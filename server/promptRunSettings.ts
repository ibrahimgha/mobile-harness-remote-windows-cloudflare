import { createHash } from "node:crypto";

import type { ChatDetail, CodexRunJob } from "./types.js";

function promptHash(text: string): string {
  return createHash("sha256").update(text.trimEnd(), "utf8").digest("hex");
}

function jobTime(job: CodexRunJob): number {
  return Date.parse(job.startedAt ?? job.createdAt) || Date.parse(job.createdAt) || 0;
}

/**
 * Codex session JSONL contains model and reasoning, but not the speed tier.
 * Remote jobs contain the submitted settings and an exact prompt hash, so join
 * them back onto transcript prompts without guessing for external prompts.
 */
export function attachPromptRunSettings(chat: ChatDetail, jobs: CodexRunJob[]): ChatDetail {
  const uniqueJobs = new Map<string, CodexRunJob>();
  for (const job of jobs) {
    if (job.chatId === chat.id && job.kind !== "steer" && job.settings && job.promptHash) {
      if (!uniqueJobs.has(job.id)) uniqueJobs.set(job.id, job);
    }
  }

  const jobsByHash = new Map<string, CodexRunJob[]>();
  for (const job of uniqueJobs.values()) {
    const matches = jobsByHash.get(job.promptHash) ?? [];
    matches.push(job);
    jobsByHash.set(job.promptHash, matches);
  }
  for (const matches of jobsByHash.values()) matches.sort((left, right) => jobTime(left) - jobTime(right));

  const usedJobIds = new Set<string>();
  let activeSettings: CodexRunJob["settings"];
  const messages = chat.messages.map((message) => {
    if (message.role === "user" && message.kind === "user_prompt") {
      const messageTime = Date.parse(message.createdAt) || 0;
      const matches = (jobsByHash.get(promptHash(message.text)) ?? []).filter((job) => !usedJobIds.has(job.id));
      const job = matches.sort(
        (left, right) => Math.abs(jobTime(left) - messageTime) - Math.abs(jobTime(right) - messageTime)
      )[0];
      activeSettings = job?.settings;
      if (!job?.settings) return message;
      usedJobIds.add(job.id);
      return {
        ...message,
        model: message.model ?? job.settings.model,
        reasoningEffort: message.reasoningEffort ?? job.settings.reasoningEffort,
        speed: job.settings.speed
      };
    }

    if (message.role === "assistant" && activeSettings) {
      return {
        ...message,
        model: message.model ?? activeSettings.model,
        reasoningEffort: message.reasoningEffort ?? activeSettings.reasoningEffort,
        speed: activeSettings.speed
      };
    }
    return message;
  });

  return { ...chat, messages };
}
