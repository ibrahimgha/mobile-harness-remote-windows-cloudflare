type JobActivity = { id: string; chatId: string; status: string; activityUnverified?: boolean };
const terminal = (job: JobActivity) => ["completed", "failed", "stopped"].includes(job.status);

export function preferredJobVersion<T extends JobActivity>(previous: T | undefined, incoming: T): T {
  if (previous && ((!previous.activityUnverified && incoming.activityUnverified) || (terminal(previous) && !terminal(incoming)))) return previous;
  return incoming;
}

export function isConfirmedActiveJob(job: JobActivity | undefined): boolean {
  return Boolean(job && !job.activityUnverified && (job.status === "running" || job.status === "queued"));
}

/** Reconcile versions before filtering: a cached running version must not
 * resurrect a job whose completion arrived through another refresh path. */
export function confirmedActiveJobVersions<T extends JobActivity>(jobs: T[]): T[] {
  const byId = new Map<string, T>();
  for (const job of jobs) {
    byId.set(job.id, preferredJobVersion(byId.get(job.id), job));
  }
  return [...byId.values()].filter(isConfirmedActiveJob);
}

/** Includes unverified cache entries so they are checked, not silently aged out. */
export function activeChatIdsForRevalidation(groups: Record<string, JobActivity[]>): string[] {
  return Object.entries(groups).filter(([, jobs]) => jobs.some(job => job.status === "running" || job.status === "queued")).map(([id]) => id);
}
