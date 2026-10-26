/**
 * Очередь ссылок, которые ещё не обработаны.
 *
 * Если закрыть вкладку на середине списка из 20+ ссылок, очередь останется
 * в localStorage, и при следующем открытии можно продолжить с того же места.
 */
const KEY = 'pacer-log.queue.v1';

export interface QueueItem {
  url: string;
  addedAt: string;
  /** последняя ошибка, если ссылка уже пыталась загрузиться */
  error?: string;
}

const listeners = new Set<() => void>();
let listening = false;
/** Стабильный снимок для useSyncExternalStore: новый массив — только при изменениях. */
let snapshot: QueueItem[] = [];
let initialized = false;

function loadFromStorage(): QueueItem[] {
  listen();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((i): i is QueueItem => Boolean(i && typeof i.url === 'string')) : [];
  } catch {
    return [];
  }
}

function refresh() {
  snapshot = loadFromStorage();
  initialized = true;
  for (const fn of listeners) fn();
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) refresh();
  });
  // вернулись на вкладку — забираем то, что записали другие вкладки/сессии
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
}

function persist(items: QueueItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* приватный режим */
  }
  snapshot = items;
  initialized = true;
  for (const fn of listeners) fn();
}

export function subscribeQueue(fn: () => void): () => void {
  listen();
  if (!initialized) refresh();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Стабильный снимок очереди (для useSyncExternalStore). */
export function getQueue(): QueueItem[] {
  if (!initialized) {
    snapshot = loadFromStorage();
    initialized = true;
  }
  return snapshot;
}

/** Перечитать очередь из localStorage (например, после ручного импорта). */
export function reloadQueue(): void {
  refresh();
}

/** Добавляет ссылки в очередь (дубликаты игнорируются). */
export function enqueue(urls: string[]): void {
  const items = loadFromStorage().slice();
  const known = new Set(items.map((i) => i.url));
  for (const url of urls) {
    if (known.has(url)) continue;
    known.add(url);
    items.push({ url, addedAt: new Date().toISOString() });
  }
  persist(items);
}

/** Убирает ссылку из очереди — успешно обработанную или вручную отброшенную. */
export function dequeue(url: string): void {
  const current = loadFromStorage();
  const items = current.filter((i) => i.url !== url);
  if (items.length !== current.length) persist(items);
}

export function markFailed(url: string, error?: string): void {
  persist(loadFromStorage().map((i) => (i.url === url ? { ...i, error } : i)));
}

export function clearQueue(): void {
  persist([]);
}

export function queueUrls(): string[] {
  return loadFromStorage().map((i) => i.url);
}
