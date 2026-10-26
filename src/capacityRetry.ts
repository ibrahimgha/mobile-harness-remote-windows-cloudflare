/** A scheduled capacity retry is deliberately waiting, not a stalled worker. */
export function capacityRetryStatus(job: {
  status: string;
  capacityRetryOfJobId?: string;
  rateLimitRetryOfJobId?: string;
  notBefore?: string;
}, nowMs: number): string | null {
  if (job.status !== "queued" || !(job.capacityRetryOfJobId || job.rateLimitRetryOfJobId)) return null;
  const label = job.rateLimitRetryOfJobId ? "Rate limit retry" : "Capacity retry";
  const due = Date.parse(job.notBefore ?? "");
  if (!Number.isFinite(due)) return `${label} queued`;
  const seconds = Math.max(0, Math.ceil((due - nowMs) / 1000));
  if (seconds === 0) return `${label} ready`;
  return `${label} in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
