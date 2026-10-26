// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { setEntries } from '../src/lib/store';
import { clearQueue, enqueue } from '../src/lib/queue';

const html = readFileSync(resolve(process.cwd(), 'tests/fixtures/pacer-page.html'), 'utf8');
const url = 'https://share.mypacer.com/track/OXxdWKozfoIOzHAnr4OLFE';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  setEntries([]);
  clearQueue();
  window.history.replaceState({}, '', '/');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function mount() {
  act(() => root.render(<App />));
  return container;
}

function typeInto(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function flush(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('приложение', () => {
  it('показывает пустое состояние и подсказку', () => {
    const el = mount();
    expect(el.textContent).toContain('Пока пусто');
    expect(el.textContent).toContain('Добавить тренировку');
  });

  it('добавляет тренировку по ссылке и показывает итоги', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(html, { status: 200 })),
    );
    const el = mount();

    const textarea = el.querySelector<HTMLTextAreaElement>('#share-input')!;
    act(() => typeInto(textarea, url));
    act(() => (el.querySelector('.btn-primary') as HTMLButtonElement).click());
    await flush(6);

    expect(el.textContent).toContain('6,80');
    expect(el.textContent).toContain('2:56');
    expect(el.querySelector('.stat-value')?.textContent).toBe('1');
    expect(el.querySelector('.stat-label')?.textContent).toBe('запись');
    expect(el.textContent).not.toContain('Пока пусто');
    expect(el.querySelectorAll('.entries-table tbody tr').length).toBe(1);

    // сохранилось в localStorage
    const saved = JSON.parse(localStorage.getItem('pacer-log.entries.v1') ?? '[]');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ url, distanceKm: 6.8, durationSec: 10594, dateISO: '2026-10-20T07:37' });
  });

  it('не добавляет ссылку не из Pacer', async () => {
    const fetchMock = vi.fn(async () => new Response(html, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const el = mount();

    const textarea = el.querySelector<HTMLTextAreaElement>('#share-input')!;
    act(() => typeInto(textarea, 'https://example.com/foo'));
    act(() => (el.querySelector('.btn-primary') as HTMLButtonElement).click());
    await flush();

    expect(el.textContent).toContain('Это не ссылка Pacer');
    // ни одной попытки скачать страницу Pacer
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/fetch'))).toBe(false);
  });

  it('добавляет запись вручную', async () => {
    const el = mount();

    const manualBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Вручную')!;
    act(() => manualBtn.click());

    const dialog = el.querySelector('.dialog')!;
    expect(dialog.textContent).toContain('Добавить вручную');

    const inputs = dialog.querySelectorAll<HTMLInputElement>('input');
    // [0] — дата, [1] — километраж, [2] — время, [3] — активность, [4] — ссылка
    act(() => typeInto(inputs[1], '5,25'));
    act(() => typeInto(inputs[2], '1:02:00'));
    const submit = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Добавить')!;
    act(() => (submit as HTMLButtonElement).click());
    await flush();

    expect(el.textContent).toContain('5,25');
    expect(el.textContent).toContain('1:02');
    const saved = JSON.parse(localStorage.getItem('pacer-log.entries.v1') ?? '[]');
    expect(saved[0]).toMatchObject({ distanceKm: 5.25, durationSec: 3720, source: 'manual' });
  });

  it('обновляет запись, а не дублирует её при повторном добавлении', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(html, { status: 200 })),
    );
    const el = mount();
    const textarea = el.querySelector<HTMLTextAreaElement>('#share-input')!;

    act(() => typeInto(textarea, url));
    act(() => (el.querySelector('.btn-primary') as HTMLButtonElement).click());
    await flush(6);

    act(() => typeInto(el.querySelector<HTMLTextAreaElement>('#share-input')!, url));
    act(() => (el.querySelector('.btn-primary') as HTMLButtonElement).click());
    await flush(6);

    const saved = JSON.parse(localStorage.getItem('pacer-log.entries.v1') ?? '[]');
    expect(saved).toHaveLength(1);
    expect(el.textContent).toContain('обновлено');
  });
});

describe('сохранность данных', () => {
  const serverEntry = {
    id: 'srv-1',
    pacerId: 'srv-1',
    url: 'https://share.mypacer.com/track/SRV1',
    dateISO: '2026-09-30T08:00',
    distanceKm: 4.2,
    durationSec: 3000,
    source: 'pacer' as const,
    addedAt: '2026-09-30T08:00:00.000Z',
  };

  function stubServer(initial: unknown[] = []) {
    const puts: unknown[][] = [];
    const store = { entries: initial };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const href = String(input);
        if (href.endsWith('/api/entries')) {
          if (init?.method === 'PUT') {
            const body = JSON.parse(String(init.body)) as { entries: unknown[] };
            store.entries = body.entries;
            puts.push(body.entries);
            return new Response(JSON.stringify({ entries: body.entries, savedAt: new Date().toISOString() }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ entries: store.entries, savedAt: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(html, { status: 200 });
      }),
    );
    return { puts, store };
  }

  it('подхватывает записи, сохранённые на сервере', async () => {
    stubServer([serverEntry]);
    const el = mount();
    await flush(6);

    expect(el.textContent).toContain('4,20');
    expect(JSON.parse(localStorage.getItem('pacer-log.entries.v1') ?? '[]')).toHaveLength(1);
    expect(el.textContent).toContain('Сохранено');
  });

  it('отправляет новые записи на сервер', async () => {
    const { puts } = stubServer();
    const el = mount();
    await flush(4);

    act(() => typeInto(el.querySelector<HTMLTextAreaElement>('#share-input')!, url));
    act(() => (el.querySelector('.btn-primary') as HTMLButtonElement).click());
    await flush(8);
    // дожидаемся отложенной отправки
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
    await flush(3);

    expect(puts.length).toBeGreaterThan(0);
    expect(puts.at(-1)?.length).toBe(1);
  });

  it('продолжает незавершённую очередь после перезагрузки', async () => {
    stubServer();
    enqueue([url]);

    const el = mount();
    await flush(4);
    expect(el.textContent).toContain('незавершённая загрузка');
    expect(el.textContent).toContain('1 ссылка');

    const resume = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Продолжить')!;
    act(() => (resume as HTMLButtonElement).click());
    await flush(8);

    const saved = JSON.parse(localStorage.getItem('pacer-log.entries.v1') ?? '[]');
    expect(saved).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('pacer-log.queue.v1') ?? '[]')).toHaveLength(0);
  });

  it('импортирует резервную копию, не затирая текущие записи', async () => {
    stubServer([serverEntry]);
    const el = mount();
    await flush(5);

    const backup = [
      { ...serverEntry, id: 'other', pacerId: 'other', url: 'https://share.mypacer.com/track/OTHER', distanceKm: 9.9 },
    ];
    const file = new File([JSON.stringify({ entries: backup })], 'backup.json', { type: 'application/json' });
    const input = el.querySelector<HTMLInputElement>('.import-btn input')!;

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
    });
    await flush(5);

    const saved = JSON.parse(localStorage.getItem('pacer-log.entries.v1') ?? '[]');
    expect(saved.map((e: { pacerId: string }) => e.pacerId).sort()).toEqual(['other', 'srv-1']);
    expect(el.textContent).toContain('Копия загружена');
  });
});
