/**
 * Push notification handlers, loaded into the generated Workbox service
 * worker via `workbox.importScripts` (see vite.config.ts). This runs even
 * when the app isn't the active tab — that's the whole point: it's what
 * lets a "Call Waiter" tap ring on a waiter's phone with the screen off.
 */

self.addEventListener('push', (event) => {
  let payload = { title: 'NF Restro', body: 'You have a new alert' };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    // Non-JSON push payload — fall back to the default above.
  }

  const options = {
    body: payload.body,
    icon: '/icon-512.png',
    badge: '/icon-512.png',
    tag: payload.tag || 'auraos-alert',
    renotify: true, // re-alert (sound/vibration/heads-up) even if a not-yet-dismissed
                     // notification with the same tag (same table) is already showing
    vibrate: [300, 100, 300, 100, 300],
    requireInteraction: true, // stays on screen until the waiter dismisses/taps it
    data: payload.data || {},
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// Tapping the notification focuses an already-open tab if there is one,
// otherwise opens a new one straight to the tables screen.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Alerts can carry a target screen (e.g. '/kitchen', '/orders'); default to home.
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          if ('navigate' in client && target !== '/') client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
