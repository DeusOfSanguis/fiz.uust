// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { setEntries } from '../src/lib/store';

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
    expect(el.textContent).toContain('2 ч 57 мин');
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
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(el.textContent).toContain('1 ч 2 мин');
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
