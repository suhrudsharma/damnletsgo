const CACHE_NAME = 'damnletsgo-v2.2'; 

// ================= APP SHELL =================
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/data/vit_campus_graph_v2.json'
];

// ================= INSTALL =================
self.addEventListener('install', (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of APP_SHELL) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('SW: failed to cache', asset);
        }
      }
    })
  );
});

// ================= ACTIVATE =================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('SW: Deleting old cache', key);
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// ================= FETCH =================
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1️⃣ Navigation (HTML)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) =>
            cache.put('/index.html', copy)
          );
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 2️⃣ App shell assets → cache-first
  if (APP_SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
    return;
  }

  // 3️⃣ Everything else (OSRM, tiles, APIs) → network-first
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});