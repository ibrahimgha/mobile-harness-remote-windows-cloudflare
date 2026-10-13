export function sameQueueOrder(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function isQueueOrder(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string" && id.length > 0) && new Set(value).size === value.length;
}

export function moveQueuedId(order: readonly string[], id: string, targetIndex: number): string[] {
  if (!order.includes(id)) return [...order];
  const next = order.filter((item) => item !== id);
  next.splice(Math.max(0, Math.min(next.length, targetIndex)), 0, id);
  return next;
}
