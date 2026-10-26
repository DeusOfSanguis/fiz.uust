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
  window.history.replaceState({}, '', '/?desktop=1');
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

/** Подменяет страницу Pacer нужным километражем. */
function pageWithKm(km: number): string {
  return html.replace('<span class="num">6.8</span>', `<span class="num">${km}</span>`);
}

function stubFetch(pageHtml: string = html) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href.endsWith('/api/entries')) {
      return new Response(JSON.stringify({ entries: [], savedAt: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(pageHtml, { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function addLink(el: HTMLElement, link = url) {
  act(() => typeInto(el.querySelector<HTMLTextAreaElement>('#share-input')!, link));
  act(() => (el.querySelector('.btn-primary') as HTMLButtonElement).click());
  await flush(6);
}

describe('доступ с любого устройства', () => {
  it('открывается и на компьютере — без заглушек и ограничений', () => {
    window.history.replaceState({}, '', '/');
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 0, configurable: true });
    stubFetch();

    const el = mount();
    expect(el.textContent).not.toContain('Только с телефона');
    expect(el.querySelector('#share-input')).not.toBeNull();
    expect(el.textContent).toContain('Добавить тренировку');
  });
});

describe('журнал', () => {
  it('показывает пустое состояние и правила', () => {
    stubFetch();
    const el = mount();
    expect(el.textContent).toContain('Пока пусто');
    expect(el.textContent).toContain('от 3 км');
    expect(el.textContent).toContain('6 км');
  });

  it('добавляет тренировку и не даёт её редактировать', async () => {
    stubFetch();
    const el = mount();

    await addLink(el);

    const saved = JSON.parse(localStorage.getItem('pacer-log.entries.v1') ?? '[]');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ url, distanceKm: 6.8, durationSec: 10594 });

    expect(el.textContent).toContain('2:56');
    // кнопок редактирования и ручного ввода больше нет
    expect(el.querySelector('button[aria-label="Изменить"]')).toBeNull();
    expect(el.textContent).not.toContain('Вручную');
  });

  it('не добавляет прогулку короче 3 км и объясняет почему', async () => {
    stubFetch(pageWithKm(2.4));
    const el = mount();

    await addLink(el);

    expect(JSON.parse(localStorage.getItem('pacer-log.entries.v1') ?? '[]')).toHaveLength(0);
    expect(el.textContent).toContain('2,40');
    expect(el.textContent).toContain('не добавлено');
  });

  it('добавляет прогулку ровно 3 км', async () => {
    stubFetch(pageWithKm(3));
    const el = mount();
    await addLink(el);
    expect(JSON.parse(localStorage.getItem('pacer-log.entries.v1') ?? '[]')).toHaveLength(1);
  });

  it('для длинной прогулки показывает 6 км и фактические в скобках', async () => {
    stubFetch(pageWithKm(9.35));
    const el = mount();
    await addLink(el);

    const saved = JSON.parse(localStorage.getItem('pacer-log.entries.v1') ?? '[]');
    // храним правду, ограничиваем только в зачёте
    expect(saved[0].distanceKm).toBe(9.35);

    // в списке: зачётные километры и фактическое значение в скобках
    expect(el.querySelector('.distance-counted')?.textContent).toBe('6,00');
    expect(el.querySelector('.distance-actual')?.textContent).toBe('(9,35)');
    expect(el.textContent).toContain('6,00 км (фактически 9,35)');
  });

  it('считает накопительный итог по зачётным километрам', async () => {
    stubFetch();
    const el = mount();

    setEntries([
      {
        id: '1',
        pacerId: 'p1',
        url: 'https://share.mypacer.com/track/p1',
        dateISO: '2026-10-01T10:00',
        distanceKm: 4,
        durationSec: 3600,
        source: 'pacer',
        addedAt: '2026-10-01T10:00:00.000Z',
      },
      {
        id: '2',
        pacerId: 'p2',
        url: 'https://share.mypacer.com/track/p2',
        dateISO: '2026-10-02T10:00',
        distanceKm: 9.5,
        durationSec: 5400,
        source: 'pacer',
        addedAt: '2026-10-02T10:00:00.000Z',
      },
    ]);
    await flush(4);

    // 4 + 6 = 10 в зачёт, по факту 13.5
    expect(el.textContent).toContain('10,00');
    expect(el.textContent).toContain('13,50');
    expect(el.querySelector('.list-foot-total')?.textContent).toContain('10,00');
  });

  it('не добавляет ссылку не из Pacer', async () => {
    const fetchMock = stubFetch();
    const el = mount();

    act(() => typeInto(el.querySelector<HTMLTextAreaElement>('#share-input')!, 'https://example.com/foo'));
    act(() => (el.querySelector('.btn-primary') as HTMLButtonElement).click());
    await flush();

    expect(el.textContent).toContain('Это не ссылка Pacer');
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/fetch'))).toBe(false);
  });

  it('обновляет запись, а не дублирует её', async () => {
    stubFetch();
    const el = mount();

    await addLink(el);
    await addLink(el);

    expect(JSON.parse(localStorage.getItem('pacer-log.entries.v1') ?? '[]')).toHaveLength(1);
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

    await addLink(el);
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

    expect(JSON.parse(localStorage.getItem('pacer-log.entries.v1') ?? '[]')).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('pacer-log.queue.v1') ?? '[]')).toHaveLength(0);
  });

  it('импортирует копию и отбрасывает записи без ссылки на Pacer', async () => {
    stubServer([serverEntry]);
    const el = mount();
    await flush(5);

    const backup = {
      entries: [
        { ...serverEntry, id: 'other', pacerId: 'other', url: 'https://share.mypacer.com/track/OTHER', distanceKm: 9.9 },
        { ...serverEntry, id: 'fake', pacerId: 'fake', url: '', distanceKm: 50 },
        { ...serverEntry, id: 'short', pacerId: 'short', url: 'https://share.mypacer.com/track/short', distanceKm: 1.1 },
      ],
    };
    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
    const input = el.querySelector<HTMLInputElement>('.import-btn input')!;

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
    });
    await flush(5);

    const saved = JSON.parse(localStorage.getItem('pacer-log.entries.v1') ?? '[]');
    expect(saved.map((e: { pacerId: string }) => e.pacerId).sort()).toEqual(['other', 'srv-1']);
  });
});

describe('офлайн', () => {
  it('показывает журнал и считает итоги без сети', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));

    setEntries([
      {
        id: 'off-1',
        pacerId: 'off-1',
        url: 'https://share.mypacer.com/track/off1',
        dateISO: '2026-10-05T09:00',
        distanceKm: 7.4,
        durationSec: 5400,
        source: 'pacer',
        addedAt: '2026-10-05T09:00:00.000Z',
      },
    ]);

    const el = mount();
    await flush(4);

    // записи на месте, километраж обрезан до 6, итог посчитан
    expect(el.textContent).toContain('6,00');
    expect(el.textContent).toContain('(7,40)');
    expect(el.querySelector('.stat-value')?.textContent).toBe('6,00');
    // и видно, что сети нет
    expect(el.textContent).toContain('Нет интернета');

    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));
  });

  it('не пытается загрузить ссылку без сети', async () => {
    const fetchMock = vi.fn(async () => new Response(html, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));

    const el = mount();
    await flush(3);

    const button = el.querySelector('.btn-primary') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Нужен интернет');

    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));
  });
});

describe('ссылка из iPhone-шортката', () => {
  it('принимает ссылку из #share=…', async () => {
    stubFetch();
    window.history.replaceState({}, '', `/#share=${encodeURIComponent(url)}`);

    const el = mount();
    await flush(6);

    const saved = JSON.parse(localStorage.getItem('pacer-log.entries.v1') ?? '[]');
    expect(saved).toHaveLength(1);
    expect(saved[0].url).toBe(url);
    // параметр убран из адреса, чтобы не добавилось повторно при обновлении
    expect(window.location.hash).toBe('');
    expect(el.textContent).toContain('2:56');
  });

  it('принимает обычный текст в #text=…', async () => {
    stubFetch();
    window.history.replaceState(
      {},
      '',
      `/#text=${encodeURIComponent(`Смотрите мою прогулку ${url}`)}`,
    );

    const el = mount();
    await flush(6);

    expect(JSON.parse(localStorage.getItem('pacer-log.entries.v1') ?? '[]')).toHaveLength(1);
  });
});
