import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dataPaths, mergeEntries, readEntries, writeEntries } from '../server/store.mjs';
import type { Entry } from '../src/lib/types';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pacer-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: 'a',
    pacerId: 'OXxdWKozfoIOzHAnr4OLFE',
    url: 'https://share.mypacer.com/track/OXxdWKozfoIOzHAnr4OLFE',
    dateISO: '2026-10-20T07:37',
    distanceKm: 6.8,
    durationSec: 10594,
    source: 'pacer',
    addedAt: '2026-10-21T10:00:00.000Z',
    ...over,
  };
}

describe('хранилище на диске', () => {
  it('пишет и читает журнал', async () => {
    await writeEntries(dir, [entry()]);
    const state = await readEntries(dir);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ distanceKm: 6.8, dateISO: '2026-10-20T07:37' });
    expect(state.savedAt).toBeTruthy();
  });

  it('на старте отдаёт пустой журнал, а не падает', async () => {
    const state = await readEntries(dir);
    expect(state).toEqual({ entries: [], updatedAt: null, savedAt: null });
  });

  it('делает бэкап предыдущей версии при каждой записи', async () => {
    await writeEntries(dir, [entry()]);
    await writeEntries(dir, [entry(), entry({ id: 'b', pacerId: 'second', distanceKm: 3.1 })]);
    await writeEntries(dir, [entry()]);

    const { backups } = dataPaths(dir);
    const files = await readdir(backups);
    expect(files.length).toBeGreaterThanOrEqual(2);

    // в бэкапе лежит состояние ДО перезаписи — то есть две записи
    const contents = await Promise.all(files.map((f) => readFile(join(backups, f), 'utf8')));
    const counts = contents.map((c) => JSON.parse(c).entries.length);
    expect(counts).toContain(2);
  });

  it('не оставляет半-записанных файлов — данные всегда валидный JSON'.replace('半','по́л'), async () => {
    await Promise.all([writeEntries(dir, [entry()]), writeEntries(dir, [entry({ distanceKm: 7.7 })])]);
    const raw = await readFile(dataPaths(dir).file, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    const tmpFiles = (await readdir(dir)).filter((f) => f.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('переживает повреждённый файл', async () => {
    const { file } = dataPaths(dir);
    await writeEntries(dir, [entry()]);
    await writeFile(file, '{ это не json', 'utf8');
    const state = await readEntries(dir);
    expect(state.entries).toEqual([]);

    // и после этого запись снова работает
    await writeEntries(dir, [entry()]);
    expect((await readEntries(dir)).entries).toHaveLength(1);
  });
});

describe('слияние записей', () => {
  it('объединяет по id и не теряет записи', () => {
    const merged = mergeEntries(
      [entry({ id: 'a' }), entry({ id: 'b', pacerId: 'second' })],
      [entry({ id: 'c', pacerId: 'third' })],
    );
    expect(merged).toHaveLength(3);
  });

  it('побеждает более свежая версия', () => {
    const old = entry({ updatedAt: '2026-10-21T10:00:00.000Z', distanceKm: 6.8 });
    const fresh = entry({ updatedAt: '2026-10-22T10:00:00.000Z', distanceKm: 7.2 });
    expect(mergeEntries([old], [fresh])[0].distanceKm).toBe(7.2);
    expect(mergeEntries([fresh], [old])[0].distanceKm).toBe(7.2);
  });

  it('не дублирует записи без id по ссылке', () => {
    const a = { url: 'https://share.mypacer.com/track/x', distanceKm: 1, durationSec: 60 };
    const merged = mergeEntries([a as never], [{ ...a, distanceKm: 2 } as never]);
    expect(merged).toHaveLength(1);
  });
});
