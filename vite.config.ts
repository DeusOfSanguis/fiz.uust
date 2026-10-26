import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createEntriesHandler } from './server/store.mjs';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const ALLOWED = /(^|\.)(mypacer\.com|pacer\.cc)$/i;

/**
 * /api/entries — хранение журнала в файле data/pacer-log.json (с бэкапами).
 * Работает и в dev, и в preview: данные не теряются при очистке браузера.
 */
function entriesPlugin(): Plugin {
  return {
    name: 'pacer-entries',
    configureServer(server) {
      server.middlewares.use(createEntriesHandler());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createEntriesHandler());
    },
  };
}

/**
 * /api/fetch?url=… — серверный прокси к Pacer.
 *
 * Нужен, потому что из браузера страницу Pacer напрямую не получить (CORS).
 * Работает и в dev, и в preview; в статичной сборке его нет, и приложение
 * автоматически переключается на публичные прокси.
 */
function pacerProxyPlugin(): Plugin {
  const handler = async (req: any, res: any, next: () => void) => {
    const parsed = new URL(req.url ?? '/', 'http://localhost');
    if (!parsed.pathname.startsWith('/api/fetch')) return next();

    const target = parsed.searchParams.get('url') ?? '';
    let targetUrl: URL;
    try {
      targetUrl = new URL(target);
    } catch {
      res.statusCode = 400;
      res.end('bad url');
      return;
    }
    if (!/^https?:$/.test(targetUrl.protocol) || !ALLOWED.test(targetUrl.hostname)) {
      res.statusCode = 403;
      res.end('host not allowed');
      return;
    }

    try {
      const upstream = await fetch(targetUrl, {
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });
      const body = await upstream.text();
      res.statusCode = upstream.ok ? 200 : 502;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.setHeader('x-pacer-status', String(upstream.status));
      res.end(body);
    } catch (e) {
      res.statusCode = 502;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(`fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return {
    name: 'pacer-proxy',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  // относительные пути — сборка работает и в корне домена, и в подпапке
  base: './',
  plugins: [react(), entriesPlugin(), pacerProxyPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    headers: {
      // превью открывается в iframe на другом домене
      'access-control-allow-origin': '*',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
