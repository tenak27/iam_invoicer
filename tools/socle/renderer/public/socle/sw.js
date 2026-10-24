// Notifications Web Push des applications IAM (base commune : source iam-erp/tools/socle).
// Portée « socle/ » : ce service worker ne fait qu'afficher les notifications reçues et ouvrir
// l'écran concerné ; il ne met rien en cache et ne remplace pas celui de l'application.
const base = () => self.registration.scope.replace(/socle\/$/, '')

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let d = {}
  try {
    d = e.data ? e.data.json() : {}
  } catch (x) {
    d = { title: e.data ? e.data.text() : '' }
  }
  const url = base() + '#' + (d.url || '/')
  e.waitUntil(
    self.registration.showNotification(d.title || d.app || 'Notification', {
      body: d.body || '',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      icon: base() + 'icon-192.png',
      badge: base() + 'favicon.png',
      data: { url, path: d.url || '/' }
    })
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const data = e.notification.data || {}
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(base()))
      if (open) {
        open.postMessage({ type: 'socle-open', url: data.path || '/' })
        return open.focus()
      }
      return self.clients.openWindow(data.url || base())
    })
  )
})
