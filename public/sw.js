const defaultIcon = "/icon-192.png";
const defaultBadge = "/apple-touch-icon.png";

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

  if (payload.type !== "show-notification") {
    return;
  }

  event.waitUntil(self.registration.showNotification(payload.title || "Codex Remote", notificationOptions(payload)));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const exactClient = clients.find((client) => client.url === targetUrl);
      if (exactClient) return exactClient.focus();

      const sameOriginClient = clients.find((client) => new URL(client.url).origin === self.location.origin);
      if (sameOriginClient) {
        const navigatedClient = await sameOriginClient.navigate(targetUrl);
        return (navigatedClient || sameOriginClient).focus();
      }

      return self.clients.openWindow(targetUrl);
    })
  );
});
