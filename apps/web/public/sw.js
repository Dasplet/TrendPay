// Service worker mínimo — existe solo para que el navegador reconozca la
// app como instalable (PWA). No cachea nada: los datos financieros deben
// venir siempre en vivo del servidor, nunca de una copia offline.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
