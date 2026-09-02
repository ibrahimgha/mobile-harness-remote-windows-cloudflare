import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const [auditPathArgument, ...jobIds] = process.argv.slice(2);

if (!auditPathArgument || jobIds.length === 0) {
  throw new Error("Usage: node scripts/repair-stale-tracker-jobs.mjs <audit-log-path> <job-id> [...job-id]");
}

const auditPath = path.resolve(auditPathArgument);
const lines = (await fs.readFile(auditPath, "utf8")).trimEnd().split(/\r?\n/);
const events = lines.flatMap((line) => {
  try {
    return [JSON.parse(line)];
  } catch {
    return [];
  }
});
const now = new Date().toISOString();
const repairs = [];

for (const jobId of jobIds) {
  const latest = [...events].reverse().find((event) => event?.detail?.job?.id === jobId)?.detail?.job;

  if (!latest) {
    throw new Error(`Could not find audit history for ${jobId}`);
  }

  if (latest.status !== "running") {
    throw new Error(`Refusing to repair ${jobId}: latest audited status is ${latest.status}`);
  }

  repairs.push({
    id: `${Date.now()}-${randomUUID()}`,
    createdAt: now,
    type: "action",
    message: "Reconciled stale tracker job with no live worker",
    detail: {
      action: "codex-run-stopped",
      chatId: latest.chatId,
      repair: "stale-tracker-job",
      job: {
        ...latest,
        status: "stopped",
        message: "Reconciled stale tracker job with no live worker",
        finishedAt: now,
        exitCode: null,
        signal: null
      }
    }
  });
}

await fs.appendFile(auditPath, `${repairs.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
console.log(`Reconciled ${repairs.length} stale tracker jobs in ${auditPath}`);
