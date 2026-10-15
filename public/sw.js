/* Suvakta service worker — app shell caching + safe offline reads.
 * Writes are never cached here: offline mutations go through the in-app IndexedDB queue
 * with idempotency keys, so nothing is ever shown as "saved" before the server confirms it. */
const VERSION = "v2";
const SHELL = `suvakta-shell-${VERSION}`;
const STATIC = `suvakta-static-${VERSION}`;
const PAGES = `suvakta-pages-${VERSION}`;
const DATA = `suvakta-data-${VERSION}`;
const SHELL_URLS = ["/offline.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/favicon.svg"];
/** Read-only API responses worth keeping for offline use (catalogue, parties, dashboard). */
const DATA_PATTERNS = [/^\/api\/me$/, /^\/api\/products(\?|$)/, /^\/api\/customers(\?|$)/, /^\/api\/suppliers(\?|$)/, /^\/api\/reports\/dashboard$/, /^\/api\/expenses\/categories$/, /^\/api\/products\/categories$/];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith("suvakta-") || k.startsWith("dukaan-")) && !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  // Sent on logout / business switch: cached business data must not leak to the next user.
  if (event.data === "clear-data") {
    event.waitUntil(Promise.all([caches.delete(DATA), caches.delete(PAGES)]));
  }
});

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === "basic") cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    if (fallbackUrl) {
      const fb = await caches.match(fallbackUrl);
      if (fb) return fb;
    }
    return new Response(JSON.stringify({ success: false, error: { code: "NETWORK_ERROR", message: "You're offline." } }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    if (DATA_PATTERNS.some((p) => p.test(url.pathname + url.search.replace(/[?&]source=[^&]*/, "")))) {
      event.respondWith(networkFirst(req, DATA));
    }
    return; // everything else under /api is network-only
  }
  // Hashed build assets & fonts: immutable → cache-first.
  if (url.pathname.startsWith("/assets/") || /\.(woff2?|png|svg|ico|webp)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // Page navigations & RSC payloads: network-first, fall back to the last copy, then offline page.
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, PAGES, "/offline.html"));
  } else if (req.headers.get("rsc") || url.searchParams.has("_rsc")) {
    event.respondWith(networkFirst(req, PAGES));
  }
});
