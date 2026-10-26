// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearQueue, dequeue, enqueue, getQueue, markFailed, queueUrls } from '../src/lib/queue';
import { mergeEntries } from '../src/lib/sync';
import type { Entry } from '../src/lib/types';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  clearQueue();
});

describe('очередь незавершённых ссылок', () => {
  it('сохраняет ссылки и переживает перезагрузку', () => {
    enqueue(['https://share.mypacer.com/track/a', 'https://share.mypacer.com/track/b']);
    expect(queueUrls()).toHaveLength(2);

    // имитируем перезагрузку: читаем прямо из localStorage
    const raw = JSON.parse(localStorage.getItem('pacer-log.queue.v1') ?? '[]');
    expect(raw.map((i: { url: string }) => i.url)).toEqual([
      'https://share.mypacer.com/track/a',
      'https://share.mypacer.com/track/b',
    ]);
  });

  it('не добавляет дубликаты', () => {
    enqueue(['https://share.mypacer.com/track/a', 'https://share.mypacer.com/track/a']);
    expect(queueUrls()).toHaveLength(1);
  });

  it('убирает успешно загруженные и оставляет проблемные', () => {
    enqueue(['https://share.mypacer.com/track/a', 'https://share.mypacer.com/track/b']);
    dequeue('https://share.mypacer.com/track/a');
    markFailed('https://share.mypacer.com/track/b', 'таймаут');

    const items = getQueue();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ url: 'https://share.mypacer.com/track/b', error: 'таймаут' });
  });

  it('очищается полностью', () => {
    enqueue(['https://share.mypacer.com/track/a']);
    clearQueue();
    expect(getQueue()).toEqual([]);
  });
});

describe('слияние локального и серверного журнала', () => {
  const base: Entry = {
    id: '1',
    pacerId: 'p1',
    url: 'https://share.mypacer.com/track/p1',
    dateISO: '2026-10-01T10:00',
    distanceKm: 5,
    durationSec: 3600,
    source: 'pacer',
    addedAt: '2026-10-01T10:00:00.000Z',
  };

  it('не теряет записи, созданные офлайн', () => {
    const localOnly: Entry = { ...base, id: '2', pacerId: 'p2', url: 'https://share.mypacer.com/track/p2' };
    const merged = mergeEntries([base], [localOnly]);
    expect(merged.map((e) => e.pacerId).sort()).toEqual(['p1', 'p2']);
  });

  it('не дублирует одну и ту же тренировку', () => {
    const merged = mergeEntries([base], [{ ...base, distanceKm: 5.1 }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].distanceKm).toBe(5.1);
  });
});

describe('только правдивые данные', () => {
  it('при загрузке отбрасывает записи без ссылки на Pacer', async () => {
    const raw = [
      {
        id: 'ok',
        pacerId: 'ok',
        url: 'https://share.mypacer.com/track/ok',
        distanceKm: 5,
        durationSec: 3000,
        addedAt: '2026-10-01T10:00:00.000Z',
      },
      {
        id: 'manual',
        pacerId: 'manual',
        url: '',
        distanceKm: 99,
        durationSec: 9000,
        source: 'manual',
        addedAt: '2026-10-01T10:00:00.000Z',
      },
      {
        id: 'foreign',
        pacerId: 'foreign',
        url: 'https://strava.example/act/1',
        distanceKm: 12,
        durationSec: 4000,
        addedAt: '2026-10-01T10:00:00.000Z',
      },
    ];
    localStorage.setItem('pacer-log.entries.v1', JSON.stringify(raw));

    const { getEntries } = await import('../src/lib/store');
    const entries = getEntries();
    expect(entries.map((e) => e.id)).toEqual(['ok']);
  });
});
