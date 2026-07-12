export type TranscriptWindowItem = {
  id: string;
  createdAt: string;
};

type RunSettingsMessageFields = {
  model?: string;
  reasoningEffort?: string;
};

export function preserveOptimisticRunSettings<T extends RunSettingsMessageFields>(
  serverMessage: T,
  optimisticMessage: RunSettingsMessageFields
): T {
  return {
    ...serverMessage,
    model: serverMessage.model ?? optimisticMessage.model,
    reasoningEffort: serverMessage.reasoningEffort ?? optimisticMessage.reasoningEffort
  };
}

export function mergeTranscriptWindow<T extends TranscriptWindowItem>(
  current: T[],
  incoming: T[],
  representsSameItem: (currentItem: T, incomingItem: T) => boolean
) {
  const preserved = current.filter(
    (currentItem) => !incoming.some((incomingItem) => representsSameItem(currentItem, incomingItem))
  );
  const byId = new Map<string, T>();

  for (const item of [...preserved, ...incoming]) {
    byId.set(item.id, item);
  }

  return [...byId.values()].sort(
    (a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)
  );
}
