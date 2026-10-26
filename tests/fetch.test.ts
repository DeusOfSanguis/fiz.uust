import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPacerTrack, PacerFetchError } from '../src/lib/pacer';

const url = 'https://share.mypacer.com/track/OXxdWKozfoIOzHAnr4OLFE';
const html = readFileSync(fileURLToPath(new URL('./fixtures/pacer-page.html', import.meta.url)), 'utf8');

interface Call {
  url: string;
  signal?: AbortSignal;
}

function stubFetch(handler: (call: Call) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url: href });
    return handler({ url: href, signal: init?.signal ?? undefined });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('загрузка страницы Pacer', () => {
  it('использует свой сервер, если он доступен', async () => {
    const calls = stubFetch(() => new Response(html, { status: 200 }));
    const res = await loadPacerTrack(url);
    expect(res.via).toBe('server');
    expect(res.track.distanceKm).toBe(6.8);
    expect(calls[0].url).toContain('/api/fetch?url=');
  });

  it('переключается на прокси, если сервер не ответил', async () => {
    stubFetch(({ url: href }) => {
      if (href.startsWith('/api/fetch')) return new Response('nope', { status: 502 });
      if (href.includes('allorigins')) return new Response(html, { status: 200 });
      return new Response('down', { status: 503 });
    });
    const res = await loadPacerTrack(url);
    expect(res.via).toBe('allorigins');
    expect(res.track.durationSec).toBe(10594);
  });

  it('пропускает прокси, отдавший мусор вместо страницы', async () => {
    stubFetch(({ url: href }) => {
      if (href.includes('allorigins')) return new Response('<html>Access denied</html>', { status: 200 });
      if (href.includes('jina')) return new Response(html, { status: 200 });
      return new Response('err', { status: 500 });
    });
    const res = await loadPacerTrack(url);
    expect(res.via).toBe('jina');
  });

  it('кидает понятную ошибку и список попыток, когда всё упало', async () => {
    stubFetch(() => new Response('error', { status: 500 }));
    const err = await loadPacerTrack(url).catch((e) => e);
    expect(err).toBeInstanceOf(PacerFetchError);
    expect((err as PacerFetchError).attempts.length).toBeGreaterThan(1);
    expect((err as PacerFetchError).message).toMatch(/Pacer/);
  });

  it('уважает отмену', async () => {
    stubFetch(({ url: href, signal }) => {
      if (href.startsWith('/api/fetch')) {
        return new Promise<Response>((resolve) => setTimeout(() => resolve(new Response('x', { status: 500 })), 5));
      }
      // прокси «висят», пока их не отменят
      return new Promise<Response>((_resolve, reject) => {
        const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (signal?.aborted) fail();
        else signal?.addEventListener('abort', fail);
      });
    });
    const ctrl = new AbortController();
    const promise = loadPacerTrack(url, undefined, ctrl.signal);
    setTimeout(() => ctrl.abort(), 60);
    await expect(promise).rejects.toBeInstanceOf(PacerFetchError);
  }, 5000);
});
