/**
 * Синхронизация журнала с сервером (data/pacer-log.json).
 *
 * Задача — не потерять данные:
 *  - каждая правка сразу пишется в localStorage;
 *  - когда доступен сервер, журнал дублируется в файл на диске;
 *  - при загрузке локальный и серверный списки объединяются (ничего не теряется),
 *    после чего объединённый результат уходит обратно на сервер.
 *
 * Если сервера нет (статичный хостинг), всё молча работает в локальном режиме.
 */
import type { Entry } from './types';

export type SyncMode = 'checking' | 'synced' | 'saving' | 'local' | 'error';

export interface SyncState {
  mode: SyncMode;
  /** Когда последний раз данные подтверждены сервером */
  savedAt: string | null;
  message?: string;
}

const ENDPOINT = '/api/entries';

let state: SyncState = { mode: 'checking', savedAt: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export function subscribeSync(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSyncState(): SyncState {
  return state;
}

/** Ключ записи для сравнения локальной и серверной версий. */
export function entryKey(e: Entry): string {
  if (e.pacerId) return `p:${e.pacerId}`;
  if (e.url) return `u:${e.url}`;
  return `m:${e.dateISO ?? ''}|${e.distanceKm}|${e.durationSec}`;
}

function stampOf(e: Entry): string {
  return e.updatedAt ?? e.addedAt ?? '';
}

/** Объединяет списки без потери записей: побеждает более свежая версия. */
export function mergeEntries(base: Entry[], incoming: Entry[]): Entry[] {
  const map = new Map<string, Entry>();
  for (const e of base) map.set(entryKey(e), e);
  for (const e of incoming) {
    const k = entryKey(e);
    const current = map.get(k);
    if (!current || stampOf(e) >= stampOf(current)) map.set(k, e);
  }
  return [...map.values()];
}

function normalize(raw: unknown): Entry[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((e): e is Entry => Boolean(e && typeof e === 'object' && ('url' in e || 'distanceKm' in e)));
}

async function request(init?: RequestInit, timeoutMs = 8000): Promise<Entry[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT, {
      ...init,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(init?.headers ?? {}) },
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) throw new Error('сервер не поддерживает хранение');
    const data = (await res.json()) as { entries?: unknown; savedAt?: string | null };
    const entries = normalize(data.entries);
    if (!entries) throw new Error('неожиданный ответ сервера');
    setState({ savedAt: data.savedAt ?? new Date().toISOString() });
    return entries;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Первичная синхронизация: читает сервер, сливает с локальными записями.
 * Возвращает итоговый список (его же нужно положить в store).
 */
export async function initSync(getLocal: () => Entry[]): Promise<Entry[]> {
  setState({ mode: 'checking', message: undefined });
  try {
    const remote = await request();
    // важно: локальные читаем уже после ответа — за время запроса могли
    // добавиться новые записи, и они не должны потеряться
    const local = getLocal();
    if (remote === null) {
      setState({ mode: 'local' });
      return local;
    }
    const merged = mergeEntries(remote, local);
    setState({ mode: 'synced', savedAt: state.savedAt });

    // локальные записи, которых нет на сервере (созданы офлайн) — отправляем
    const remoteKeys = new Set(remote.map(entryKey));
    const missing = local.filter((e) => !remoteKeys.has(entryKey(e)));
    if (missing.length) await pushEntries(merged, 'merge-local');
    return merged;
  } catch {
    setState({ mode: 'local' });
    return getLocal();
  }
}

/** Отправляет журнал на сервер. Никогда не бросает — статус виден в интерфейсе. */
export async function pushEntries(entries: Entry[], reason = 'save'): Promise<boolean> {
  if (state.mode === 'local') return false;
  setState({ mode: 'saving' });
  try {
    await request({ method: 'PUT', body: JSON.stringify({ entries, reason }) }, 12000);
    setState({ mode: 'synced', savedAt: new Date().toISOString(), message: undefined });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'ошибка';
    setState({ mode: 'error', message: msg });
    return false;
  }
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pending: Entry[] | null = null;

/** Отложенная отправка: не дёргаем сервер на каждое нажатие. */
export function schedulePush(entries: Entry[], reason = 'save', delay = 700): void {
  pending = entries;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = undefined;
    const data = pending;
    pending = null;
    if (data) void pushEntries(data, reason);
  }, delay);
}

/** Отправляет несохранённое прямо сейчас (например, при закрытии вкладки). */
export function flushPush(): void {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = undefined;
  }
  const data = pending ?? null;
  pending = null;
  if (!data) return;
  try {
    const body = JSON.stringify({ entries: data, reason: 'pagehide' });
    void fetch(ENDPOINT, { method: 'PUT', body, headers: { 'content-type': 'application/json' }, keepalive: true });
  } catch {
    /* ничего не поделать */
  }
}
