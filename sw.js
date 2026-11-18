// Service worker di Memento Vini.
// Quando modifichi index.html, aumenta il numero di versione qui sotto per forzare l'aggiornamento.
const CACHE = 'memento-vini-v10';
const DEXIE = 'https://unpkg.com/dexie@4.0.8/dist/dexie.min.js';
const INBOX = 'mv-inbox'; // file ricevuti con "Condividi → Memento Vini"
const FILE_LOCALI =['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' = scarica sempre la copia fresca, mai quella in memoria del browser
    await cache.addAll(FILE_LOCALI.map(u => new Request(u, { cache: 'reload' })));
    try { await cache.add(new Request(DEXIE, { mode: 'cors' })); } catch (e) { /* verrà salvato al primo caricamento */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const nome of await caches.keys()) if (nome !== CACHE && nome !== INBOX) await caches.delete(nome);
    await self.clients.claim();
  })());
});

async function salvaInCache(req, res) {
  if (res && (res.ok || res.type === 'opaque')) {
    const cache = await caches.open(CACHE);
    await cache.put(req, res.clone());
  }
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // ricezione file condivisi da altre app (WhatsApp, Galleria…)
  if (req.method === 'POST' && url.searchParams.has('share-target')) {
    event.respondWith((async () => {
      const dati = await req.formData();
      const cache = await caches.open(INBOX);
      for (const k of await cache.keys()) await cache.delete(k);
      let i = 0;
      for (const f of dati.getAll('files')) {
        if (!(f instanceof File)) continue;
        await cache.put(new Request(`inbox/${Date.now()}-${i++}`),
          new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-nome': encodeURIComponent(f.name || '') } }));
      }
      return Response.redirect('./?condiviso=1', 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;
  if (url.hostname === 'api.anthropic.com') return; // le chiamate AI vanno sempre in rete

  // pagina dell'app: prima la rete (versione sempre aggiornata), la copia salvata solo se offline
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: 'no-store' });
        if (res.ok) { const c = await caches.open(CACHE); await c.put('index.html', res.clone()); }
        return res;
      } catch (e) {
        return (await caches.match('index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // altri file: risposta dalla cache e aggiornamento in background
  event.respondWith((async () => {
    const inCache = await caches.match(req, { ignoreSearch: true });
    if (inCache) {
      if (url.origin === self.location.origin) {
        event.waitUntil(fetch(req, { cache: 'no-cache' }).then(res => salvaInCache(req, res)).catch(() => {}));
      }
      return inCache;
    }
    try {
      return await salvaInCache(req, await fetch(req));
    } catch (e) {
      return Response.error();
    }
  })());
});
