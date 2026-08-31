// Cachea solo assets estáticos (JS/CSS con hash, íconos, manifest) para
// cargas más rápidas en visitas repetidas. El resto — páginas, y en
// especial cualquier llamada al API — va siempre a la red. Los datos
// financieros nunca deben servirse desde una copia offline.
const CACHE_NAME = 'trendpay-static-v1';
const STATIC_PATTERNS = [
  /^\/_next\/static\//,
  /^\/tp_icon(_512)?\.png$/,
  /^\/icon\.png/,
  /^\/apple-icon\.png/,
  /^\/manifest\.json$/,
  /^\/bancos\//,
];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isStatic =
    event.request.method === 'GET' &&
    url.origin === self.location.origin &&
    STATIC_PATTERNS.some((p) => p.test(url.pathname));

  if (!isStatic) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    })
  );
});
