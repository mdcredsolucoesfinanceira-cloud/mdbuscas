self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

self.addEventListener('push', (event) => {
  let dados = { title: '💰 MD BUSCAS', body: 'Nova consulta paga!' };
  try {
    dados = event.data.json();
  } catch (e) { }

  event.waitUntil(
    self.registration.showNotification(dados.title, {
      body: dados.body,
      icon: '/logo1.png',
      badge: '/logo1.png',
      vibrate: [200, 100, 200],
      tag: 'md-buscas-consulta',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/dashboard.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/dashboard.html');
      }
    })
  );
});
