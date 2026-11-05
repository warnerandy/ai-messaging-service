const CACHE_NAME = "messaging-pwa-v29";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/assets/css/app.css",
  "/assets/js/app.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  // Never intercept or cache API requests or WebSocket endpoints
  if (
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/socket") ||
    url.pathname.startsWith("/bot") ||
    url.pathname.startsWith("/uploads")
  ) {
    return;
  }

  // For HTML navigation requests, use Network-First to immediately fetch latest app shell
  if (event.request.mode === "navigate" || event.request.destination === "document") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.status === 200) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match("/")))
    );
    return;
  }

  // For scripts and styles (/assets/), use Network-First to immediately load latest code
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.status === 200) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request)
        .then(response => {
          if (response.status === 200) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
          }
          return response;
        })
        .catch(() => (event.request.mode === "navigate" ? caches.match("/") : undefined));
    })
  );
});

self.addEventListener("push", event => {
  if (!event.data) return;

  const notificationData = event.data.json();
  const options = {
    body: notificationData.body || "New message",
    icon: "/manifest.webmanifest",
    badge: "/manifest.webmanifest",
    tag: "bot-message",
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification(notificationData.title || "New message", options)
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ("focus" in client) {
          if (event.notification.data) {
            client.postMessage({
              type: "NOTIFICATION_CLICK",
              data: event.notification.data
            });
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow("/");
      }
    })
  );
});

