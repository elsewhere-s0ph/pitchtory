/* Pitchtory — service worker. Notte di Divisione d'Onore, offline pure lei.
 * Standard studio: precache resiliente (mai addAll che butta giù tutto),
 * navigazioni network-first con fallback shell, asset cache-first,
 * evizione delle cache vecchie, mai skipWaiting silenzioso. */
const BUILD = '__SW_BUILD__'
const CACHE = 'pitchtory-' + BUILD

/* Solo la shell è essenziale all'installazione: senza quelle la PWA non
 * parte. Tutto il resto fallisce in silenzio e arriva dopo, a runtime. */
const ESSENTIAL = ['./']
const NICE_TO_HAVE = ['./index.html', './manifest.webmanifest', './favicon.svg', './icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await Promise.all(
        ESSENTIAL.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }))
          } catch (err) {
            /* niente shell: pazienza, si riprova al prossimo avvio */
          }
        }),
      )
      await Promise.all(
        NICE_TO_HAVE.map(async (url) => {
          try {
            await cache.add(url)
          } catch (err) {
            /* extra: mai fatale */
          }
        }),
      )
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req)
          const cache = await caches.open(CACHE)
          cache.put('./', fresh.clone()).catch(() => {})
          return fresh
        } catch (err) {
          const cached = (await caches.match('./')) || (await caches.match('./index.html')) || (await caches.match(req))
          if (cached) return cached
          return new Response('Offline e senza shell in cache: riapri Pitchtory con la rete attiva.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }
      })(),
    )
    return
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req)
      if (cached) return cached
      try {
        const fresh = await fetch(req)
        const cacheable =
          fresh &&
          fresh.ok &&
          (url.pathname.startsWith('/assets/') ||
            url.pathname.startsWith('/icons/') ||
            /\.(js|css|woff2?|png|svg|webmanifest)$/.test(url.pathname))
        if (cacheable) {
          const cache = await caches.open(CACHE)
          cache.put(req, fresh.clone()).catch(() => {})
        }
        return fresh
      } catch (err) {
        return new Response('', { status: 504 })
      }
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})
