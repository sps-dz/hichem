// === SERVICE WORKER v6 ===
// v6: passage en stratégie "réseau d'abord" pour éviter le bug d'affichage
// où une ancienne version mise en cache (CSS/JS) s'affichait tant que le
// cache n'était pas invalidé manuellement. Le nom de cache est aussi changé
// pour purger automatiquement l'ancien cache v5 chez tous les utilisateurs.
const CACHE_NAME = 'sponsor-crm-cache-v10';
const urlsToCache = [
  './',
  './index.html',
  './assets/css/style.css',
  './assets/js/theme.js',
  './assets/js/state.js',
  './assets/js/firebase-init.js',
  './assets/js/utils.js',
  './assets/js/calculations.js',
  './assets/js/core.js',
  './assets/js/auth.js',
  './assets/js/data-service.js',
  './assets/js/ui-render.js',
  './assets/js/ui-handlers.js',
  './assets/js/nav-groups.js',
  './assets/js/client-space.js',
  './assets/js/meta-live.js',
  './assets/js/app.js',
  './assets/js/demo.js',
  './assets/js/security.js',
  './assets/js/messaging.js',
  './assets/js/invoice-flow.js',
  './assets/js/invoice-assets.js',
  './assets/js/payroll.js',
  './assets/js/audit.js',
  './assets/js/backup.js',
  './assets/js/ext.js',
  './assets/js/team.js',
  './assets/js/accounting.js',
  './assets/js/operations.js',
  './assets/js/crm.js',
  './assets/js/control.js'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache).catch(() => {}))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Ne pas intercepter les requêtes Firebase ou CDN
  if (event.request.url.includes('firebase') || event.request.url.includes('googleapis') || event.request.url.includes('cdn')) {
    return;
  }
  // Réseau d'abord : on essaie toujours d'avoir la dernière version en ligne,
  // et on ne retombe sur le cache que si le réseau est indisponible (offline).
  // Le cache est aussi remis à jour à chaque requête réussie.
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
