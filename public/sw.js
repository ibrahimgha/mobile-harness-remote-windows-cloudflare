const defaultIcon = "/icon-192.png";
const defaultBadge = "/apple-touch-icon.png";
const navigationCache = "codex-notification-navigation-v1";
const navigationKey = new URL("/__codex_notification_target__", self.location.origin).href;
let pendingNavigation = null;
let navigationStorage = Promise.resolve();
let lastNavigationTime = 0;

function serializedNavigation(operation) {
  const result = navigationStorage.then(operation);
  navigationStorage = result.catch(() => {});
  return result;
}

async function storedNavigation() {
  try {
    const cached = await (await caches.open(navigationCache)).match(navigationKey);
    if (cached) pendingNavigation = await cached.json();
  } catch { /* Memory still delivers a click when persistent storage is unavailable. */ }
  return pendingNavigation && Date.now() - pendingNavigation.createdAt < 15 * 60 * 1000 ? pendingNavigation : null;
}

function saveNavigation(target) {
  return serializedNavigation(async () => {
    pendingNavigation = target;
    try { await (await caches.open(navigationCache)).put(navigationKey, new Response(JSON.stringify(target), { headers: { "Content-Type": "application/json" } })); } catch {}
  });
}

function acknowledgeNavigation(id) {
  return serializedNavigation(async () => {
    if ((await storedNavigation())?.id !== id) return;
    pendingNavigation = null;
    try { await (await caches.open(navigationCache)).delete(navigationKey); } catch {}
  });
}

function chatClient(client) {
  try {
    const url = new URL(client.url);
    return client.frameType !== "nested" && url.origin === self.location.origin &&
      ["/", "/index.html"].includes(url.pathname) && url.searchParams.get("control-room-tile") !== "1";
  } catch { return false; }
}

function notificationTarget(data = {}) {
  let url;
  try { url = new URL(data.url || "/", self.location.origin); } catch { url = new URL("/", self.location.origin); }
  if (url.origin !== self.location.origin) url = new URL("/", self.location.origin);
  const chatId = typeof data.chatId === "string" ? data.chatId.trim() : url.searchParams.get("chat")?.trim();
  const targetUrl = new URL("/", self.location.origin);
  if (chatId && chatId.length <= 200) targetUrl.searchParams.set("chat", chatId);
  lastNavigationTime = Math.max(Date.now(), lastNavigationTime + 1);
  return { id: `${lastNavigationTime}-${Math.random().toString(36).slice(2)}`, createdAt: lastNavigationTime, chatId: targetUrl.searchParams.get("chat") || "", jobId: data.jobId, url: targetUrl.href };
}

function deliverNavigation(client, target) {
  try { if (target.chatId) client?.postMessage({ type: "codex-open-chat", target }); } catch {}
}

async function openNotificationTarget(target) {
  if (target.chatId) await saveNavigation(target);
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true }).catch(() => []);
  const candidates = clients.filter(chatClient);
  const client = candidates.find(item => item.url === target.url) || candidates.find(item => item.focused) || candidates[0];
  if (client) {
    deliverNavigation(client, target);
    const focused = await client.focus().catch(() => null);
    if (focused) {
      // The app acknowledges after preserving and selecting the target, avoiding a reload.
      if (!target.chatId) return;
      await new Promise(resolve => setTimeout(resolve, 1200));
      if ((await serializedNavigation(storedNavigation))?.id !== target.id) return;
      try {
        const navigated = await client.navigate(target.url);
        if (navigated) { deliverNavigation(navigated, target); return; }
      } catch { /* A suspended iOS client can reject navigate; openWindow still gets a chance. */ }
    }
  }
  try {
    const opened = await self.clients.openWindow(target.url);
    deliverNavigation(opened, target);
    if (opened) await opened.focus().catch(() => {});
  } catch { /* The saved click is recovered when the PWA next becomes ready. */ }
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function notificationOptions(payload) {
  return {
    body: payload.body || "A remote Codex run finished.",
    icon: payload.icon || defaultIcon,
    badge: payload.badge || defaultBadge,
    tag: payload.tag || "codex-remote",
    renotify: true,
    data: {
      url: payload.url || "/",
      jobId: payload.jobId,
      chatId: payload.chatId
    }
  };
}

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      title: "Codex Remote",
      body: event.data ? event.data.text() : "A remote Codex run finished."
    };
  }

  event.waitUntil(self.registration.showNotification(payload.title || "Codex Remote", notificationOptions(payload)));
});

self.addEventListener("message", (event) => {
  const payload = event.data || {};

  if (payload.type === "codex-notification-ack" && chatClient(event.source)) {
    event.waitUntil(acknowledgeNavigation(payload.id));
    return;
  }
  if (payload.type === "codex-notification-ready" && chatClient(event.source)) {
    event.waitUntil(serializedNavigation(storedNavigation).then(target => { if (target) deliverNavigation(event.source, target); }));
    return;
  }

  if (payload.type !== "show-notification") {
    return;
  }

  event.waitUntil(self.registration.showNotification(payload.title || "Codex Remote", notificationOptions(payload)));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openNotificationTarget(notificationTarget(event.notification.data)));
});
