/* =========================
   SERVICE WORKER
   DamnLetsGo PWA
========================= */

const CACHE_VERSION = "v2";
const STATIC_CACHE = `damnletsgo-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `damnletsgo-runtime-${CACHE_VERSION}`;

/* =========================
   APP SHELL (LOCAL ONLY)
========================= */
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

/* =========================
   INSTALL
========================= */
self.addEventListener("install", (event) => {
  console.log("[SW] Install");

  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );

  // Activate immediately
  self.skipWaiting();
});

/* =========================
   ACTIVATE
========================= */
self.addEventListener("activate", (event) => {
  console.log("[SW] Activate");

  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (![STATIC_CACHE, RUNTIME_CACHE].includes(key)) {
            console.log("[SW] Removing old cache:", key);
            return caches.delete(key);
          }
        })
      )
    )
  );

  // Take control immediately
  self.clients.claim();
});

/* =========================
   FETCH
========================= */
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only handle GET
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  /* -------------------------
     1. App Shell (Offline First)
  ------------------------- */
  if (APP_SHELL.includes(url.pathname) || url.origin === location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return (
          cached ||
          fetch(request).then((response) => {
            return caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, response.clone());
              return response;
            });
          })
        );
      })
    );
    return;
  }

  /* -------------------------
     2. External Libraries & Map Tiles (Network First)
  ------------------------- */
  event.respondWith(
    fetch(request)
      .then((response) => {
        return caches.open(RUNTIME_CACHE).then((cache) => {
          cache.put(request, response.clone());
          return response;
        });
      })
      .catch(() => caches.match(request))
  );
});
