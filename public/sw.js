/**
 * Service Worker - Astuce Tracker (Phase 4)
 */

const CACHE_NAME = 'astuce-tracker-v3';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/app.js',
    '/js/api.js',
    '/js/favorites.js',
    '/js/map.js',
    '/data/gtfs/stops.txt',
    '/data/gtfs/shapes.txt',
    'https://unpkg.com/lucide@latest',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('SW: Mise en cache des ressources statiques');
                return cache.addAll(STATIC_ASSETS);
            })
            // Force l'activation immédiate sans attendre que les vieux SW s'arrêtent
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // Stratégie pour l'API temps réel: Network only (ne pas cacher les vieux horaires)
    if (e.request.url.includes('/api/')) {
        e.respondWith(fetch(e.request).catch(() => {
            // Optionnel : On pourrait renvoyer un mock JSON d'erreur propre
            return new Response(JSON.stringify({ status: 'error', message: 'Mode hors-ligne, données temps réel indisponibles.' }), {
               headers: { 'Content-Type': 'application/json' }
            });
        }));
        return;
    }

    // Stratégie Stale-While-Revalidate pour le reste
    e.respondWith(
        caches.match(e.request).then(cachedResponse => {
            const fetchPromise = fetch(e.request).then(networkResponse => {
                // Ne mettre en cache que les requêtes GET valides
                if (e.request.method === 'GET' && networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(e.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Si le réseau tombe, on espère que c'est dans le cache
            });

            return cachedResponse || fetchPromise;
        })
    );
});
