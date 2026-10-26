import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  extractPacerUrls,
  loadPacerTrack,
  PacerFetchError,
  type FetchAttempt,
  type ParsedTrack,
} from './lib/pacer';
import { clearEntries, getEntries, importEntries, newEntryId, removeEntry, setEntries, subscribe, upsertEntry } from './lib/store';
import { flushPush, getSyncState, initSync, schedulePush, subscribeSync, type SyncMode } from './lib/sync';
import {
  clearQueue,
  dequeue,
  enqueue,
  getQueue,
  markFailed,
  queueUrls,
  subscribeQueue,
} from './lib/queue';
import type { Entry, SortMode, Toast } from './lib/types';
import { formatHM, formatKm, plural } from './lib/format';
import {
  CAP_KM,
  MIN_KM,
  isCapped,
  isCounted,
  isExcluded,
  rejectReason,
  runningCounted,
  totalActual,
  totalCounted,
} from './lib/rules';
import { exportCsv, exportJson, exportXlsx } from './lib/export';
import { AddPanel, type Job } from './components/AddPanel';
import { EntryTable } from './components/EntryTable';
import { ExportPanel } from './components/ExportPanel';
import { ToastStack } from './components/ToastStack';
import { PhoneGate, isAllowedDevice } from './components/PhoneGate';

const EXAMPLE_URL = 'https://share.mypacer.com/track/OXxdWKozfoIOzHAnr4OLFE';

function useEntries(): Entry[] {
  return useSyncExternalStore(subscribe, getEntries, getEntries);
}

function trackToEntry(track: ParsedTrack): Entry {
  return {
    id: newEntryId(),
    pacerId: track.pacerId,
    url: track.url,
    dateISO: track.dateISO,
    distanceKm: track.distanceKm,
    durationSec: track.durationSec,
    activity: track.activity,
    author: track.author,
    calories: track.calories,
    steps: track.steps,
    elevationM: track.elevationM,
    avgPaceSecPerKm: track.avgPaceSecPerKm,
    cadence: track.cadence,
    source: 'pacer',
    addedAt: new Date().toISOString(),
  };
}

export default function App() {
  if (!isAllowedDevice()) return <PhoneGate />;
  return <Journal />;
}

function Journal() {
  const entries = useEntries();
  const syncState = useSyncExternalStore(subscribeSync, getSyncState, getSyncState);
  const queue = useSyncExternalStore(subscribeQueue, getQueue, getQueue);

  const [input, setInput] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('date-desc');
  const [withExtras, setWithExtras] = useState(false);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [storageReady, setStorageReady] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const toastId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const toast = useCallback((kind: Toast['kind'], title: string, text?: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, title, text }]);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  /* ---------------------------------------------------------------- */
  /* Хранение: сначала читаем сервер и сливаем с локальными записями    */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const merged = await initSync(() => getEntries());
      if (cancelled) return;
      setEntries(merged);
      setStorageReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const retry = () => {
      void (async () => {
        const merged = await initSync(() => getEntries());
        setEntries(merged);
      })();
    };
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('focus', retry);
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    schedulePush(entries);
  }, [entries, storageReady]);

  useEffect(() => {
    const flush = () => flushPush();
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, []);

  const patchJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((list) => list.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const runUrls = useCallback(
    async (urls: string[]) => {
      if (!urls.length) return;
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      enqueue(urls);

      const created: Job[] = urls.map((url) => ({ id: newEntryId(), url, status: 'queued', attempts: [] }));
      setJobs((prev) => [...created, ...prev.filter((j) => j.status === 'loading' || j.status === 'queued')].slice(0, 30));
      setBusy(true);

      let added = 0;
      let updated = 0;
      let failed = 0;
      let skipped = 0;
      let firstSkipped: { km: number; url: string } | null = null;

      for (const job of created) {
        if (ctrl.signal.aborted) {
          patchJob(job.id, { status: 'error', message: 'отменено' });
          markFailed(job.url, 'отменено');
          continue;
        }
        patchJob(job.id, { status: 'loading' });

        try {
          const result = await loadPacerTrack(
            job.url,
            (attempt: FetchAttempt) => {
              setJobs((list) =>
                list.map((j) =>
                  j.id === job.id ? { ...j, lastAttempt: attempt, attempts: [...j.attempts, attempt] } : j,
                ),
              );
            },
            ctrl.signal,
          );

          const entry = trackToEntry(result.track);

          // правило: короткие прогулки в журнал не попадают
          if (!isCounted(entry.distanceKm)) {
            skipped++;
            firstSkipped ??= { km: entry.distanceKm, url: job.url };
            dequeue(job.url);
            patchJob(job.id, { status: 'skipped', message: rejectReason(entry.distanceKm) });
            continue;
          }

          const status = upsertEntry(entry);
          dequeue(job.url);
          if (status === 'added') added++;
          else updated++;

          const shown = isCapped(entry.distanceKm)
            ? `${formatKm(CAP_KM)} км (фактически ${formatKm(entry.distanceKm)})`
            : `${formatKm(entry.distanceKm)} км`;
          patchJob(job.id, {
            status: status === 'added' ? 'ok' : 'updated',
            message: `${shown}${entry.dateISO ? '' : ' · дата не распознана'}`,
          });
        } catch (e) {
          failed++;
          const message =
            e instanceof PacerFetchError
              ? 'не удалось получить страницу Pacer'
              : e instanceof Error && e.name === 'AbortError'
                ? 'отменено'
                : 'ошибка загрузки';
          markFailed(job.url, message);
          patchJob(job.id, { status: 'error', message });
        }
      }

      if (mounted.current) {
        setBusy(false);
        if (added || updated) {
          const parts: string[] = [];
          if (added) parts.push(`добавлено: ${added}`);
          if (updated) parts.push(`обновлено: ${updated}`);
          if (skipped) parts.push(`пропущено: ${skipped}`);
          toast('success', added ? 'Сохранено' : 'Записи обновлены', parts.join(' · '));
        }
        if (skipped && firstSkipped && !added && !updated) {
          toast(
            'info',
            skipped === 1 ? 'Не добавлено' : `Не добавлено: ${skipped}`,
            rejectReason(firstSkipped.km),
          );
        }
        if (failed) {
          toast(
            'error',
            failed === 1 ? 'Одна ссылка не загрузилась' : `Не загрузилось ссылок: ${failed}`,
            'Они остались в очереди — можно повторить позже, уже собранное не пропадёт.',
          );
        }
      }
      abortRef.current = null;
    },
    [patchJob, toast],
  );

  const addFromInput = useCallback(() => {
    const urls = extractPacerUrls(input);
    if (!urls.length) {
      if (!input.trim()) return;
      toast('error', 'Это не ссылка Pacer', 'Ссылка должна вести на share.mypacer.com/track/…');
      return;
    }
    setInput('');
    void runUrls(urls);
  }, [input, runUrls, toast]);

  const addFromText = useCallback(
    (text: string) => {
      const urls = extractPacerUrls(text);
      if (!urls.length) {
        setInput((prev) => (prev ? `${prev}\n${text}` : text).trim());
        toast('error', 'Это не ссылка Pacer', 'Скопируйте ссылку из приложения Pacer.');
        return;
      }
      setInput('');
      void runUrls(urls);
    },
    [runUrls, toast],
  );

  const handleClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      addFromText(text);
    } catch {
      toast('error', 'Нет доступа к буферу', 'Вставьте ссылку в поле вручную.');
    }
  }, [addFromText, toast]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, []);

  const retry = useCallback(
    (id: string) => {
      const job = jobs.find((j) => j.id === id);
      if (!job) return;
      setJobs((list) => list.filter((j) => j.id !== id));
      void runUrls([job.url]);
    },
    [jobs, runUrls],
  );

  const dismissJob = useCallback((id: string) => setJobs((list) => list.filter((j) => j.id !== id)), []);

  const resumeQueue = useCallback(() => {
    const urls = queueUrls();
    if (urls.length) void runUrls(urls);
  }, [runUrls]);

  // Приём «поделиться»: ?share=… / ?text=… / ?url=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payload = ['share', 'text', 'url', 'title']
      .map((k) => params.get(k))
      .filter((v): v is string => Boolean(v))
      .join('\n');
    if (!payload) return;
    const urls = extractPacerUrls(payload);
    if (!urls.length) return;
    window.history.replaceState({}, '', window.location.pathname);
    void runUrls(urls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------- */
  /* Сортировка и подсчёты                                             */
  /* ---------------------------------------------------------------- */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? entries.filter(
          (e) =>
            e.url.toLowerCase().includes(q) ||
            (e.activity ?? '').toLowerCase().includes(q) ||
            (e.author ?? '').toLowerCase().includes(q) ||
            (e.dateISO ?? '').includes(q),
        )
      : entries;
    const sorted = filtered.slice();
    if (sort === 'date-desc' || sort === 'date-asc') {
      const dir = sort === 'date-asc' ? 1 : -1;
      sorted.sort((a, b) => {
        const da = a.dateISO ?? '';
        const db = b.dateISO ?? '';
        if (!da && !db) return b.addedAt.localeCompare(a.addedAt);
        if (!da) return 1;
        if (!db) return -1;
        return dir * da.localeCompare(db);
      });
    } else {
      sorted.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    }
    return sorted;
  }, [entries, search, sort]);

  /** Накопительный итог считается по времени тренировки, а не по порядку в списке. */
  const cumulative = useMemo(() => {
    const chronological = entries.slice().sort((a, b) => {
      const da = a.dateISO ?? a.addedAt;
      const db = b.dateISO ?? b.addedAt;
      return da.localeCompare(db);
    });
    const sums = runningCounted(chronological);
    const map = new Map<string, number>();
    chronological.forEach((e, i) => map.set(e.id, sums[i]));
    return map;
  }, [entries]);

  const totals = useMemo(
    () => ({
      counted: totalCounted(entries),
      actual: totalActual(entries),
      seconds: entries.reduce((sum, e) => sum + e.durationSec, 0),
      excluded: entries.filter(isExcluded).length,
    }),
    [entries],
  );

  const handleDelete = useCallback(() => {
    if (!deleting) return;
    removeEntry(deleting.id);
    setDeleting(null);
    toast('info', 'Запись удалена');
  }, [deleting, toast]);

  const handleClearAll = useCallback(() => {
    clearEntries();
    setConfirmClear(false);
    toast('info', 'Журнал очищен', 'Копию можно достать из data/backups на сервере.');
  }, [toast]);

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const list: unknown = Array.isArray(data) ? data : (data as { entries?: unknown })?.entries;
        if (!Array.isArray(list)) throw new Error('нет массива записей');
        const prepared: Entry[] = list
          .filter((e): e is Record<string, unknown> => Boolean(e && typeof e === 'object'))
          // только настоящие записи Pacer: без ссылки и без источника не принимаем
          .filter((e) => typeof e.url === 'string' && /mypacer\.com\/track\//i.test(e.url))
          .filter((e) => isCounted(Number(e.distanceKm)))
          .map((e) => {
            const now = new Date().toISOString();
            return {
              id: typeof e.id === 'string' ? e.id : newEntryId(),
              pacerId: typeof e.pacerId === 'string' ? e.pacerId : newEntryId(),
              url: String(e.url),
              dateISO: typeof e.dateISO === 'string' ? e.dateISO : undefined,
              distanceKm: Number(e.distanceKm),
              durationSec: Number(e.durationSec) || 0,
              activity: typeof e.activity === 'string' ? e.activity : undefined,
              steps: Number.isFinite(Number(e.steps)) ? Number(e.steps) : undefined,
              calories: Number.isFinite(Number(e.calories)) ? Number(e.calories) : undefined,
              elevationM: Number.isFinite(Number(e.elevationM)) ? Number(e.elevationM) : undefined,
              source: 'pacer' as const,
              addedAt: typeof e.addedAt === 'string' ? e.addedAt : now,
              updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : undefined,
            };
          });
        if (!prepared.length) throw new Error('нет подходящих записей');
        const res = importEntries(prepared);
        toast('success', 'Копия загружена', `добавлено: ${res.added} · обновлено: ${res.updated} · всего: ${res.total}`);
      } catch {
        toast('error', 'Не удалось прочитать файл', 'Подходят только резервные копии этого приложения с записями Pacer.');
      }
    },
    [toast],
  );

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 18c3.5 0 4.5-12 8-12s4.5 12 8 12" strokeLinecap="round" />
              <circle cx="4" cy="18" r="1.8" fill="currentColor" stroke="none" />
              <circle cx="20" cy="18" r="1.8" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <div className="brand-text">
            <h1>Pacer Log</h1>
            <p>
              Найдено всего: <strong>{formatKm(totals.counted)}</strong> км
            </p>
          </div>
        </div>

        <div className="topbar-right">
          <SyncBadge mode={syncState.mode} savedAt={syncState.savedAt} message={syncState.message} />
          <div className="stats" aria-label="Итого">
            <div className="stat">
              <span className="stat-value">{formatKm(totals.counted)}</span>
              <span className="stat-label">км в зачёт</span>
            </div>
            <div className="stat">
              <span className="stat-value">{entries.length}</span>
              <span className="stat-label">{plural(entries.length, 'запись', 'записи', 'записей')}</span>
            </div>
            <div className="stat">
              <span className="stat-value">{formatHM(totals.seconds)}</span>
              <span className="stat-label">ч:мм</span>
            </div>
          </div>
        </div>
      </header>

      <main className="layout">
        <aside className="sidebar">
          <AddPanel
            input={input}
            onInput={setInput}
            onAdd={addFromInput}
            onPaste={addFromText}
            onClipboard={handleClipboard}
            jobs={jobs}
            busy={busy}
            onCancel={cancel}
            onRetry={retry}
            onDismiss={dismissJob}
            queueCount={busy ? 0 : queue.length}
            onResume={resumeQueue}
            onClearQueue={() => {
              clearQueue();
              toast('info', 'Очередь очищена', 'Уже добавленные записи остались на месте.');
            }}
          />

          <ExportPanel
            count={entries.filter((e) => !isExcluded(e)).length}
            withExtras={withExtras}
            onToggleExtras={setWithExtras}
            onXlsx={() => {
              exportXlsx(entries, { withExtras });
              toast('success', 'Excel готов', `Всего найдено: ${formatKm(totals.counted)} км`);
            }}
            onCsv={() => {
              exportCsv(entries, { withExtras });
              toast('success', 'CSV готов');
            }}
            onJson={() => {
              exportJson(entries);
              toast('success', 'Резервная копия сохранена');
            }}
            onImport={handleImportFile}
          />
        </aside>

        <section className="card list-panel" aria-labelledby="list-title">
          <div className="list-head">
            <div className="list-title-row">
              <h2 id="list-title">Тренировки</h2>
              {entries.length > 0 && (
                <button className="link-btn" onClick={() => setConfirmClear(true)}>
                  очистить
                </button>
              )}
            </div>

            <div className="list-controls">
              <div className="search">
                <span aria-hidden>⌕</span>
                <input
                  type="search"
                  placeholder="Поиск"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Поиск по записям"
                />
              </div>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} aria-label="Сортировка">
                <option value="date-desc">Сначала новые</option>
                <option value="date-asc">Сначала старые</option>
                <option value="added-desc">По дате добавления</option>
              </select>
            </div>
          </div>

          {entries.length === 0 ? (
            <div className="empty">
              <div className="empty-art" aria-hidden>
                <svg viewBox="0 0 120 80" width="120" height="80" fill="none">
                  <rect x="8" y="12" width="104" height="56" rx="8" fill="var(--accent-soft)" />
                  <path
                    d="M22 56c10 0 12-30 22-30s12 30 22 30 12-30 22-30"
                    stroke="var(--accent)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <circle cx="22" cy="56" r="3" fill="var(--accent)" />
                  <circle cx="88" cy="26" r="3" fill="var(--accent)" />
                  <circle cx="98" cy="56" r="3" fill="var(--accent)" />
                </svg>
              </div>
              <h3>Пока пусто</h3>
              <p>
                Поделитесь прогулкой из Pacer — приложение возьмёт дату, километраж и время. Прогулки короче{' '}
                {MIN_KM} км не добавляются, в зачёт идёт до {CAP_KM} км.
              </p>
              <button className="btn btn-ghost" onClick={() => setInput(EXAMPLE_URL)}>
                Подставить пример
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty empty-small">
              <h3>Ничего не найдено</h3>
              <p>Попробуйте другой запрос.</p>
            </div>
          ) : (
            <EntryTable entries={visible} cumulative={cumulative} onDelete={(entry) => setDeleting(entry)} />
          )}

          {entries.length > 0 && (
            <footer className="list-foot">
              <span>
                {visible.length} из {entries.length}
                {totals.excluded > 0 ? ` · не в зачёт: ${totals.excluded}` : ''}
              </span>
              <span className="list-foot-total">
                Всего найдено: <strong>{formatKm(totals.counted)}</strong> км
                {Math.abs(totals.actual - totals.counted) > 0.005
                  ? ` (по факту ${formatKm(totals.actual)} км)`
                  : ''}
              </span>
            </footer>
          )}
        </section>
      </main>

      {deleting && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setDeleting(null)}>
          <div className="dialog dialog-small" role="dialog" aria-modal="true" aria-labelledby="del-title">
            <h2 id="del-title">Удалить запись?</h2>
            <p className="dialog-text">
              {formatKm(deleting.distanceKm)} км
              {deleting.dateISO ? ` · ${deleting.dateISO.slice(0, 10)}` : ''}. Данные не редактируются, поэтому
              удаление — единственный способ убрать ошибочную запись.
            </p>
            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={() => setDeleting(null)}>
                Отмена
              </button>
              <button className="btn btn-danger" onClick={handleDelete}>
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmClear && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setConfirmClear(false)}>
          <div className="dialog dialog-small" role="dialog" aria-modal="true" aria-labelledby="clear-title">
            <h2 id="clear-title">Очистить журнал?</h2>
            <p className="dialog-text">
              Будут удалены все {entries.length} записей. Перед этим лучше нажать «Копия JSON» — на сервере тоже
              останутся резервные копии в data/backups.
            </p>
            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmClear(false)}>
                Отмена
              </button>
              <button className="btn btn-danger" onClick={handleClearAll}>
                Удалить всё
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <footer className="page-foot">
        {syncState.mode === 'local' || syncState.mode === 'error'
          ? 'Данные лежат в этом браузере. Запустите npm start — журнал будет сохраняться в файл на диске.'
          : 'Журнал сохраняется в файл на диске (data/pacer-log.json) и дублируется в браузере.'}
      </footer>
    </div>
  );
}

const SYNC_LABEL: Record<SyncMode, string> = {
  checking: 'Проверяем хранилище',
  saving: 'Сохраняем',
  synced: 'Сохранено',
  local: 'Только в браузере',
  error: 'Не сохранено на сервер',
};

function SyncBadge({ mode, savedAt, message }: { mode: SyncMode; savedAt: string | null; message?: string }) {
  const time = savedAt
    ? new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(savedAt))
    : '';

  const title =
    mode === 'synced'
      ? `Журнал записан в data/pacer-log.json${time ? ` в ${time}` : ''}`
      : mode === 'local'
        ? 'Серверное хранилище недоступно: данные только в этом браузере. Запустите npm start, чтобы журнал писался в файл.'
        : mode === 'error'
          ? `Не удалось сохранить на сервер (${message ?? 'ошибка'}). Данные уже в браузере — скачайте «Копия JSON».`
          : 'Синхронизация с файлом на сервере';

  return (
    <span className={`sync-badge sync-${mode}`} title={title}>
      <span className="sync-dot" aria-hidden />
      {SYNC_LABEL[mode]}
    </span>
  );
}
