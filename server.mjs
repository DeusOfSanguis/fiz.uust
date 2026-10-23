#!/usr/bin/env node
/**
 * Продакшн-сервер: отдаёт собранное приложение (dist) и проксирует Pacer.
 *
 *   npm run build && npm start
 *
 * Прокси нужен, потому что браузер не может запросить share.mypacer.com
 * напрямую (CORS). С этим сервером импорт ссылок работает без сторонних
 * сервисов и заметно стабильнее.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('./dist', import.meta.url)));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const ALLOWED_HOSTS = /(^|\.)(mypacer\.com|pacer\.cc)$/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function fetchPacer(target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return { status: 400, body: 'bad url' };
  }
  if (!/^https?:$/.test(url.protocol) || !ALLOWED_HOSTS.test(url.hostname)) {
    return { status: 403, body: 'host not allowed' };
  }
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.text();
    return { status: res.ok ? 200 : 502, body };
  } catch (e) {
    return { status: 502, body: `fetch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function serveFile(res, path, cache = true) {
  try {
    const data = await readFile(path);
    res.writeHead(200, {
      'content-type': MIME[extname(path)] ?? 'application/octet-stream',
      'cache-control': cache ? 'public, max-age=3600' : 'no-cache',
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/api/fetch') {
    const { status, body } = await fetchPacer(url.searchParams.get('url') ?? '');
    res.writeHead(status, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(body);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('method not allowed');
    return;
  }

  // защита от выхода за пределы dist
  const safePath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(ROOT, safePath === '/' ? 'index.html' : safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  let exists = false;
  try {
    exists = (await stat(filePath)).isFile();
  } catch {
    exists = false;
  }
  if (exists && (await serveFile(res, filePath))) return;

  // SPA-fallback
  if (await serveFile(res, join(ROOT, 'index.html'), false)) return;

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found. Сначала выполните npm run build.');
});

server.listen(PORT, HOST, () => {
  console.log(`Pacer Log: http://${HOST}:${PORT}`);
});
