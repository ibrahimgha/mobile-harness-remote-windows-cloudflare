export type NotificationTarget = { id: string; chatId: string; jobId?: string; createdAt: number };
const storageKey = "codex-notification-target-v1";
const maxAge = 15 * 60 * 1000;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export function notificationTarget(value: unknown, now = Date.now()): NotificationTarget | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as NotificationTarget;
  if (typeof candidate.id !== "string" || !candidate.id || typeof candidate.chatId !== "string" || !candidate.chatId.trim() || candidate.chatId.length > 200) return null;
  if (!Number.isFinite(candidate.createdAt) || now - candidate.createdAt > maxAge || candidate.createdAt > now + 60_000) return null;
  return { id: candidate.id, chatId: candidate.chatId.trim(), createdAt: candidate.createdAt, ...(typeof candidate.jobId === "string" ? { jobId: candidate.jobId } : {}) };
}

export function readNotificationTarget(storage: Storage): NotificationTarget | null {
  try { return notificationTarget(JSON.parse(storage.getItem(storageKey) || "null")); } catch { return null; }
}

export function clearNotificationTarget(storage: Storage, chatId?: string): void {
  try { if (!chatId || readNotificationTarget(storage)?.chatId === chatId) storage.removeItem(storageKey); } catch { /* Current URL also carries the target. */ }
}

/** Receive click intent before auth, after a cold launch, and after foregrounding. */
export function installNotificationNavigation(options: {
  serviceWorker: ServiceWorkerContainer;
  storage: Storage;
  onTarget: (target: NotificationTarget) => void;
  root?: Window;
}): () => void {
  const root = options.root ?? window;
  let disposed = false, lastHandled = "", latestCreatedAt = 0;
  const accept = (target: NotificationTarget) => {
    const previous = readNotificationTarget(options.storage);
    if (latestCreatedAt > target.createdAt || (previous && previous.createdAt > target.createdAt)) return;
    if (lastHandled !== target.id) {
      try { options.storage.setItem(storageKey, JSON.stringify(target)); } catch { /* The app also preserves the target in its URL. */ }
      options.onTarget(target);
      lastHandled = target.id;
      latestCreatedAt = target.createdAt;
    }
  };
  const onMessage = (event: MessageEvent) => {
    if (event.origin && event.origin !== root.location.origin) return;
    if (event.data?.type !== "codex-open-chat") return;
    const target = notificationTarget(event.data.target);
    if (!target) return;
    try {
      accept(target);
      (event.source as ServiceWorker | null)?.postMessage({ type: "codex-notification-ack", id: target.id });
    } catch { /* Keep the worker's saved target available while the app becomes ready. */ }
  };
  const requestPending = () => {
    if (root.document.visibilityState === "hidden") return;
    const send = (worker?: ServiceWorker | null) => { if (!disposed) worker?.postMessage({ type: "codex-notification-ready" }); };
    if (options.serviceWorker.controller) send(options.serviceWorker.controller);
    else void options.serviceWorker.getRegistration().then(registration => send(registration?.active)).catch(() => {});
  };
  options.serviceWorker.addEventListener("message", onMessage);
  options.serviceWorker.addEventListener("controllerchange", requestPending);
  root.addEventListener("pageshow", requestPending);
  root.document.addEventListener("visibilitychange", requestPending);
  const pending = readNotificationTarget(options.storage);
  if (pending) accept(pending);
  requestPending();
  return () => {
    disposed = true;
    options.serviceWorker.removeEventListener("message", onMessage);
    options.serviceWorker.removeEventListener("controllerchange", requestPending);
    root.removeEventListener("pageshow", requestPending);
    root.document.removeEventListener("visibilitychange", requestPending);
  };
}
