// App-shell service worker: makes Hisaab installable and open instantly.
// Data always comes from the network (Supabase); only static assets are cached.
const CACHE = 'hisaab-shell-v3'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['./', './index.html'])))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    // Network first so updates show up; fall back to the cached shell offline.
    event.respondWith(fetch(request).catch(() => caches.match('./index.html')))
    return
  }
  // Hashed build assets never change: cache first.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})

// Push notifications from the "notify" and "digest" Edge Functions.
self.addEventListener('push', (event) => {
  let message = { title: 'Hisaab', body: 'Something changed in your hisaab', url: '#/' }
  try {
    message = { ...message, ...event.data.json() }
  } catch {
    // Not JSON: show the default text.
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: message.url },
      tag: message.url,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(`./${event.notification.data?.url ?? ''}`, self.registration.scope).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.registration.scope))
      if (open) return open.navigate(target).then((w) => w?.focus())
      return self.clients.openWindow(target)
    }),
  )
})
