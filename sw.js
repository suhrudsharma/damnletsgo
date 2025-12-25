const CACHE_NAME = 'damnletsgo-v4';

// Cache ONLY your own app shell
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './sw.js',

  // App icons
  'https://cdn-icons-png.flaticon.com/512/854/854878.png',
  'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png'
];

// ================= INSTALL =================
self.addEventListener('install', (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
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

  // 1️⃣ Navigation requests → cache first, then network fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => {
        return cached || fetch(req);
      })
    );
    return;
  }

  // 2️⃣ App shell assets → cache first
  if (APP_SHELL.includes(new URL(req.url).pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
    return;
  }

  // 3️⃣ Everything else (OSRM, tiles, APIs) → network first
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});
