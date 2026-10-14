export type TranscriptWindowItem = {
  id: string;
  createdAt: string;
};

/** Insert terminal job notices at their event time, never after newer replies.
 * Keep the transcript's own order (including equal-time/tool messages) intact.
 */
export function mergeRunStatusTimeline<T extends TranscriptWindowItem>(transcript: T[], notices: T[]): T[] {
  const messages = [...transcript];
  const existingIds = new Set(messages.map(message => message.id));
  const orderedNotices = [...notices].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const notice of orderedNotices) {
    if (existingIds.has(notice.id)) continue;
    const eventTime = Date.parse(notice.createdAt);
    const nextMessage = Number.isFinite(eventTime)
      ? messages.findIndex(message => Date.parse(message.createdAt) > eventTime)
      : -1;
    if (nextMessage < 0) messages.push(notice);
    else messages.splice(nextMessage, 0, notice);
    existingIds.add(notice.id);
  }
  return messages;
}

export function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function transcriptRenderItems<T extends TranscriptWindowItem>(messages: T[], signature: (message: T) => string) {
  const occurrences = new Map<string, number>();
  return messages.map((message) => {
    // Identical prompts in different turns are different anchors. Neither a
    // prepended "resume" nor an appended one may steal an existing DOM key.
    // Backend IDs and volatile run metadata deliberately stay out of the key.
    const identity = `${message.createdAt}\u001e${signature(message)}`;
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return { message, renderKey: `${stableHash(identity)}-${occurrence}` };
  });
}

type RunSettingsMessageFields = {
  model?: string;
  reasoningEffort?: string;
  speed?: string;
};

export function preserveOptimisticRunSettings<T extends RunSettingsMessageFields>(
  serverMessage: T,
  optimisticMessage: RunSettingsMessageFields
): T {
  return {
    ...serverMessage,
    model: serverMessage.model ?? optimisticMessage.model,
    reasoningEffort: serverMessage.reasoningEffort ?? optimisticMessage.reasoningEffort,
    speed: serverMessage.speed ?? optimisticMessage.speed
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

  return [...byId.values()];
}
