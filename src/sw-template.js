/**
 * Шаблон service worker'а: плагин сборки подставляет сюда версию кэша
 * и список файлов приложения (см. offlinePlugin в vite.config.ts).
 *
 * Задачи:
 *  1. офлайн: всё приложение (HTML, JS, CSS, иконки) лежит в кэше,
 *     поэтому журнал открывается и Excel выгружается без интернета;
 *  2. «Поделиться» с телефона: принимает POST на /share-target.
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `pacer-log-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // «Поделиться» из Pacer: POST /share-target -> редирект в приложение со ссылкой
  if (request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(
      (async () => {
        let payload = '';
        try {
          const form = await request.formData();
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
    return;
  }

  if (request.method !== 'GET') return;

  // чужие домены (прокси к Pacer, CDN) не кэшируем
  if (url.origin !== self.location.origin) return;

  // переходы по страницам: сначала кэш, иначе сеть, иначе index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).catch(() =>
            caches.match(new URL('index.html', self.registration.scope).toString()).then((r) => r || Response.error()),
          ),
      ),
    );
    return;
  }

  // статика: кэш -> сеть, и складываем в кэш на будущее
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || Response.error());
    }),
  );
});
