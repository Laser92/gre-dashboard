const CACHE_NAME = 'gre-dashboard-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/login.html',
  '/index.css',
  '/script.js',
  '/favicon.svg',
  '/questions_bank.js'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  // Only intercept GET requests, skip API calls
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached response if found, else fetch from network
        return response || fetch(event.request).then((fetchRes) => {
          return caches.open(CACHE_NAME).then((cache) => {
            // Cache the new resource
            if (event.request.url.startsWith('http')) {
              cache.put(event.request, fetchRes.clone());
            }
            return fetchRes;
          });
        });
      })
      .catch(() => {
        // Fallback for offline if not in cache (e.g., return cached index.html)
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      })
  );
});
