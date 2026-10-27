// RentPro service worker: makes the site installable and lets the app shell open on a weak connection.
// Pages and scripts are fetched fresh when online (network first) and served from cache when offline.
// API calls to Apps Script and Firebase are never cached.
const CACHE = "rentpro-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([
    "./", "./index.html", "./dashboard.html", "./global.js", "./styles/app.css", "./js/shell.js", "./js/dev-auth.js", "./js/splash.js",
    "./icons/icon-192.png"
  ]).catch(() => {})));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
