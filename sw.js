// Offline support: app shell cached, tracker data network-first, Google script never cached.
const CACHE = "npi-v2";
const SHELL = ["./", "index.html", "app.js", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png", "icons/npi-logo-mark.png", "icons/npi-logo-full.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request.url.split("?")[0], copy)); }
      return r;
    }).catch(() => caches.match(e.request.url.split("?")[0]).then(r => r || caches.match("index.html")))
  );
});
