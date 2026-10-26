import type { Entry } from './types';
import { entryKey, mergeEntries } from './sync';

const KEY = 'pacer-log.entries.v1';

let cache: Entry[] | null = null;
const listeners = new Set<() => void>();

function safeParse(raw: string | null): Entry[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter((e): e is Entry => Boolean(e && typeof e === 'object' && typeof e.url === 'string'))
      .map((e) => ({
        ...e,
        id: e.id || crypto.randomUUID(),
        pacerId: e.pacerId || e.url,
        distanceKm: Number(e.distanceKm) || 0,
        durationSec: Number(e.durationSec) || 0,
        source: e.source === 'manual' ? 'manual' : 'pacer',
      }));
  } catch {
    return [];
  }
}

function persist(entries: Entry[]): void {
  cache = entries;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* приватный режим / переполнение — работаем в памяти */
  }
  listen();
}

let listening = false;
function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    cache = safeParse(e.newValue);
    notify();
  });
}

function notify() {
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listen();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getEntries(): Entry[] {
  listen();
  if (cache === null) {
    cache = safeParse(typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null);
  }
  return cache;
}

export function setEntries(entries: Entry[]): void {
  persist(entries);
}

export type UpsertStatus = 'added' | 'updated';

/** Добавляет запись; при совпадении pacerId обновляет существующую. */
export function upsertEntry(entry: Entry): UpsertStatus {
  const entries = getEntries();
  const idx = entries.findIndex((e) => e.pacerId === entry.pacerId);
  if (idx >= 0) {
    const next = entries.slice();
    next[idx] = { ...entry, id: entries[idx].id, addedAt: entries[idx].addedAt, updatedAt: new Date().toISOString() };
    persist(next);
    return 'updated';
  }
  persist([...entries, entry]);
  return 'added';
}

export function saveEntry(entry: Entry): void {
  const entries = getEntries();
  const idx = entries.findIndex((e) => e.id === entry.id);
  if (idx < 0) {
    persist([...entries, entry]);
    return;
  }
  const next = entries.slice();
  next[idx] = { ...entry, updatedAt: new Date().toISOString() };
  persist(next);
}

export function removeEntry(id: string): void {
  persist(getEntries().filter((e) => e.id !== id));
}

export function clearEntries(): void {
  persist([]);
}

/**
 * Импорт резервной копии: сливает файл с текущим журналом.
 * Ничего не перезаписывает «вслепую» — только добавляет и обновляет.
 */
export function importEntries(incoming: Entry[]): { added: number; updated: number; total: number } {
  const current = getEntries();
  const before = new Map(current.map((e) => [entryKey(e), e] as const));
  const merged = mergeEntries(current, incoming);
  let added = 0;
  let updated = 0;
  for (const e of merged) {
    const prev = before.get(entryKey(e));
    if (!prev) added++;
    else if (prev !== e) updated++;
  }
  persist(merged);
  return { added, updated, total: merged.length };
}

export function newEntryId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `e${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}
