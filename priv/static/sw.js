const CACHE_NAME = "messaging-pwa-v1";
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

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request)
        .then(response => {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
          return response;
        })
        .catch(() => caches.match("/"));
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

