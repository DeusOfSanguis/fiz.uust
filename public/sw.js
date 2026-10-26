/**
 * Service worker нужен ровно для одного: принять «поделиться» из мобильного
 * Pacer (POST на /share-target) и открыть приложение со ссылкой в адресе.
 * Ничего не кэширует, поэтому не мешает обновлениям.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;

  event.respondWith(
    (async () => {
      let payload = '';
      try {
        const form = await event.request.formData();
        payload = [form.get('title'), form.get('text'), form.get('url')]
          .filter((v) => typeof v === 'string' && v.trim())
          .join('\n');
      } catch {
        /* пустое тело — просто откроем приложение */
      }
      const target = new URL(self.registration.scope);
      if (payload) target.searchParams.set('share', payload);
      return Response.redirect(target.toString(), 303);
    })(),
  );
});
