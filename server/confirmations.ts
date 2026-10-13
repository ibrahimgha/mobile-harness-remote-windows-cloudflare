import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { detectConfirmation, type PendingConfirmation } from "../shared/confirmation.js";
import type { ChatDetail, CodexRunJob, CodexRunSettings } from "./types.js";

type Decision = { status: "dismissed" | "sending" | "accepted"; at: string; job?: CodexRunJob };

export function confirmationForChat(chat: ChatDetail, jobs: CodexRunJob[]): (PendingConfirmation & { settings: CodexRunSettings }) | undefined {
  const latest = [...chat.messages].reverse().find((message) => message.role === "user" || message.role === "assistant");
  if (!latest || latest.role !== "assistant") return;
  const hint = detectConfirmation(latest.text, latest.confirmationHint);
  if (!hint || !latest.model || !latest.reasoningEffort) return;
  if (jobs.some((job) => job.chatId === chat.id && ["queued", "running"].includes(job.status)
    && Date.parse(job.createdAt) > Date.parse(latest.createdAt))) return;
  const id = createHash("sha256").update(JSON.stringify([chat.id, latest.createdAt, latest.text, hint])).digest("hex");
  return { ...hint, id, model: latest.model, reasoningEffort: latest.reasoningEffort,
    settings: { model: latest.model, reasoningEffort: latest.reasoningEffort, speed: latest.speed ?? "default", updatedAt: latest.createdAt } };
}

export class ConfirmationDecisions {
  private decisions: Record<string, Decision> = {};
  private locks = new Map<string, Promise<unknown>>();
  constructor(private file = path.resolve(".runtime/confirmation-decisions.json")) {
    if (fs.existsSync(file)) this.decisions = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  get(chatId: string, id: string) { return this.decisions[`${chatId}:${id}`]; }
  set(chatId: string, id: string, status: Decision["status"], job?: CodexRunJob) {
    const next = { ...this.decisions, [`${chatId}:${id}`]: { status, at: new Date().toISOString(), job } };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(next), "utf8");
    fs.renameSync(`${this.file}.tmp`, this.file);
    this.decisions = next;
  }
  async exclusive<T>(chatId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(chatId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.locks.set(chatId, next);
    try { return await next; }
    finally { if (this.locks.get(chatId) === next) this.locks.delete(chatId); }
  }
}
