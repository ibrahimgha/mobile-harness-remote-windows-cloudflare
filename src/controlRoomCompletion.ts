export type CompletionTrackedJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "stopped";
  finishedAt?: string;
};

export type CompletionGlowTracker = {
  chatId: string | null;
  pendingJobIds: string[];
};

export type CompletionGlowAdvance = {
  tracker: CompletionGlowTracker;
  completedJobId: string | null;
};

const isPending = (job: CompletionTrackedJob) => job.status === "queued" || job.status === "running";

export function advanceCompletionGlow(
  previous: CompletionGlowTracker,
  chatId: string | null,
  jobs: CompletionTrackedJob[]
): CompletionGlowAdvance {
  const currentPendingIds = jobs.filter(isPending).map((job) => job.id);

  if (!chatId || previous.chatId !== chatId) {
    return {
      tracker: { chatId, pendingJobIds: currentPendingIds },
      completedJobId: null
    };
  }

  const currentById = new Map(jobs.map((job) => [job.id, job]));
  const previouslyPending = new Set(previous.pendingJobIds);

  if (currentPendingIds.length) {
    const unresolvedPreviousIds = previous.pendingJobIds.filter((jobId) => !currentById.has(jobId));
    return {
      tracker: {
        chatId,
        pendingJobIds: [...new Set([...currentPendingIds, ...unresolvedPreviousIds])]
      },
      completedJobId: null
    };
  }

  const completedJob = jobs
    .filter((job) => previouslyPending.has(job.id) && job.status === "completed")
    .sort((left, right) => Date.parse(right.finishedAt ?? "") - Date.parse(left.finishedAt ?? ""))[0];

  if (completedJob) {
    return {
      tracker: { chatId, pendingJobIds: [] },
      completedJobId: completedJob.id
    };
  }

  const endedWithoutCompletion = jobs.some(
    (job) => previouslyPending.has(job.id) && (job.status === "failed" || job.status === "stopped")
  );

  return {
    tracker: {
      chatId,
      pendingJobIds: endedWithoutCompletion ? [] : previous.pendingJobIds
    },
    completedJobId: null
  };
}
