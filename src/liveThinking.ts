export const liveThinkingStatuses = [
  "Thinking",
  "Working",
  "Exploring",
  "Investigating",
  "Reading",
  "Searching",
  "Planning",
  "Reasoning",
  "Analyzing",
  "Checking",
  "Testing",
  "Verifying",
  "Refining"
] as const;

export type LiveThinkingStatus = (typeof liveThinkingStatuses)[number];

export const liveThinkingDelayMinMs = 6000;
export const liveThinkingDelayMaxMs = 18000;

type RandomSource = () => number;

function normalizedRandom(random: RandomSource): number {
  const value = random();

  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 1 - Number.EPSILON);
}

export function nextLiveThinkingDelayMs(random: RandomSource = Math.random): number {
  const range = liveThinkingDelayMaxMs - liveThinkingDelayMinMs + 1;
  return liveThinkingDelayMinMs + Math.floor(normalizedRandom(random) * range);
}

export function nextLiveThinkingStatus(
  current: LiveThinkingStatus,
  random: RandomSource = Math.random
): LiveThinkingStatus {
  const alternatives = liveThinkingStatuses.filter((status) => status !== current);
  return alternatives[Math.floor(normalizedRandom(random) * alternatives.length)] ?? "Thinking";
}
