// Service worker minimal : rend l'application installable. Aucune donnée de l'API n'est mise en cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => new Response('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:32px;text-align:center"><h2>Pas de connexion</h2><p>Vérifiez votre connexion Internet puis rouvrez l’application.</p></body>', { headers: { 'content-type': 'text/html; charset=utf-8' } })));
  }
});
