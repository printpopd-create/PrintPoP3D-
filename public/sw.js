/* ==========================================================================
   Service worker — only job is showing the notification banner.

   The push itself carries no data (see lib/push.js), so we try to fetch the
   unread count to make the banner specific, and fall back to a generic
   message when the admin session has expired.
   ========================================================================== */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let body = 'Someone sent you a message. Tap to read it.';

      try {
        const res = await fetch('/api/messages/unread', { credentials: 'include' });
        if (res.ok) {
          const { unread } = await res.json();
          if (unread > 1) body = `You have ${unread} unread messages. Tap to read them.`;
        }
      } catch {
        /* offline or logged out — the generic wording still does the job */
      }

      await self.registration.showNotification('📬 New message — PrintPoP 3D', {
        body,
        icon: '/assets/logo.jpeg',
        badge: '/assets/logo.jpeg',
        tag: 'printpop-message',   // replaces the previous one instead of stacking
        renotify: true,
        data: { url: '/admin#messages' },
      });
    })()
  );
});

/* Focus the admin tab if it's already open, otherwise open a new one. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/admin';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        if (client.url.includes('/admin') && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })()
  );
});
