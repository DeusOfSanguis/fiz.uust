import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  extractPacerUrls,
  loadPacerTrack,
  PacerFetchError,
  type FetchAttempt,
  type ParsedTrack,
} from './lib/pacer';
import {
  clearEntries,
  getEntries,
  newEntryId,
  removeEntry,
  subscribe,
  upsertEntry,
} from './lib/store';
import type { Entry, SortMode, Toast } from './lib/types';
import { formatDuration, formatKm, plural } from './lib/format';
import { exportCsv, exportJson, exportXlsx } from './lib/export';
import { AddPanel, type Job } from './components/AddPanel';
import { EntryTable } from './components/EntryTable';
import { EntryDialog } from './components/EntryDialog';
import { ExportPanel } from './components/ExportPanel';
import { ToastStack } from './components/ToastStack';

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
  const entries = useEntries();
  const [input, setInput] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('date-desc');
  const [withExtras, setWithExtras] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; entry: Entry | null }>({ open: false, entry: null });
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

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

  const patchJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((list) => list.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const runUrls = useCallback(
    async (urls: string[]) => {
      if (!urls.length) return;
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const created: Job[] = urls.map((url) => ({
        id: newEntryId(),
        url,
        status: 'queued',
        attempts: [],
      }));

      setJobs((prev) => {
        const existing = prev.filter((j) => j.status === 'loading' || j.status === 'queued');
        return [...created, ...existing].slice(0, 10);
      });
      setBusy(true);

      let added = 0;
      let updated = 0;
      let failed = 0;

      for (const job of created) {
        if (ctrl.signal.aborted) {
          patchJob(job.id, { status: 'error', message: 'отменено' });
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
          const status = upsertEntry(entry);
          if (status === 'added') added++;
          else updated++;
          patchJob(job.id, {
            status: status === 'added' ? 'ok' : 'updated',
            message: `${formatKm(entry.distanceKm)} км${entry.dateISO ? '' : ' · дата не распознана'}`,
          });

          if (!entry.dateISO) {
            toast('info', 'Дата не распознана', 'Запись сохранена — дату можно поправить вручную.');
          }
        } catch (e) {
          failed++;
          const message =
            e instanceof PacerFetchError
              ? 'не удалось получить страницу Pacer'
              : e instanceof Error && e.name === 'AbortError'
                ? 'отменено'
                : 'ошибка загрузки';
          patchJob(job.id, { status: 'error', message });
        }
      }

      if (mounted.current) {
        setBusy(false);
        if (added || updated) {
          const parts: string[] = [];
          if (added) parts.push(`добавлено: ${added}`);
          if (updated) parts.push(`обновлено: ${updated}`);
          toast('success', added ? 'Готово' : 'Записи обновлены', parts.join(' · '));
        }
        if (failed) {
          toast(
            'error',
            failed === 1 ? 'Не удалось добавить ссылку' : `Не удалось обработать ссылок: ${failed}`,
            'Pacer не ответил или изменил страницу. Можно добавить запись вручную.',
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
        // не Pacer — не теряем текст, просто кладём его в поле
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

  const totals = useMemo(() => {
    let km = 0;
    let sec = 0;
    for (const e of entries) {
      km += e.distanceKm;
      sec += e.durationSec;
    }
    return { km, sec };
  }, [entries]);

  const handleDelete = useCallback(() => {
    if (!deleting) return;
    removeEntry(deleting.id);
    setDeleting(null);
    toast('info', 'Запись удалена');
  }, [deleting, toast]);

  const handleClearAll = useCallback(() => {
    clearEntries();
    setConfirmClear(false);
    toast('info', 'Журнал очищен');
  }, [toast]);

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
            <p>Ссылки из Pacer → таблица Excel</p>
          </div>
        </div>

        <div className="stats" aria-label="Итого">
          <div className="stat">
            <span className="stat-value">{entries.length}</span>
            <span className="stat-label">{plural(entries.length, 'запись', 'записи', 'записей')}</span>
          </div>
          <div className="stat">
            <span className="stat-value">{formatKm(totals.km)}</span>
            <span className="stat-label">км</span>
          </div>
          <div className="stat">
            <span className="stat-value">{formatDuration(totals.sec)}</span>
            <span className="stat-label">в пути</span>
          </div>
        </div>
      </header>

      <main className="layout">
        <aside className="sidebar">
          <AddPanel
            input={input}
            onInput={setInput}
            onAdd={addFromInput}
            onManual={() => setDialog({ open: true, entry: null })}
            onPaste={addFromText}
            onClipboard={handleClipboard}
            jobs={jobs}
            busy={busy}
            onCancel={cancel}
            onRetry={retry}
            onDismiss={dismissJob}
          />

          <ExportPanel
            count={entries.length}
            withExtras={withExtras}
            onToggleExtras={setWithExtras}
            onXlsx={() => {
              exportXlsx(entries, { withExtras });
              toast('success', 'Excel готов', `Строк в таблице: ${entries.length}`);
            }}
            onCsv={() => {
              exportCsv(entries, { withExtras });
              toast('success', 'CSV готов');
            }}
            onJson={() => {
              exportJson(entries);
              toast('success', 'Резервная копия сохранена');
            }}
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
                  <path d="M22 56c10 0 12-30 22-30s12 30 22 30 12-30 22-30" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
                  <circle cx="22" cy="56" r="3" fill="var(--accent)" />
                  <circle cx="88" cy="26" r="3" fill="var(--accent)" />
                  <circle cx="98" cy="56" r="3" fill="var(--accent)" />
                </svg>
              </div>
              <h3>Пока пусто</h3>
              <p>Вставьте ссылку из Pacer — приложение вытащит дату, километраж и время.</p>
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
            <EntryTable
              entries={visible}
              onEdit={(entry) => setDialog({ open: true, entry })}
              onDelete={(entry) => setDeleting(entry)}
            />
          )}

          {entries.length > 0 && (
            <footer className="list-foot">
              <span>
                {visible.length} из {entries.length}
              </span>
              <span className="list-foot-total">
                Итого: {formatKm(totals.km)} км · {formatDuration(totals.sec)}
              </span>
            </footer>
          )}
        </section>
      </main>

      {dialog.open && (
        <EntryDialog
          entry={dialog.entry}
          onClose={() => setDialog({ open: false, entry: null })}
          onSaved={(entry, isNew) => {
            setDialog({ open: false, entry: null });
            toast('success', isNew ? 'Запись добавлена' : 'Запись обновлена', `${formatKm(entry.distanceKm)} км`);
          }}
        />
      )}

      {deleting && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setDeleting(null)}>
          <div className="dialog dialog-small" role="dialog" aria-modal="true" aria-labelledby="del-title">
            <h2 id="del-title">Удалить запись?</h2>
            <p className="dialog-text">
              {formatKm(deleting.distanceKm)} км
              {deleting.dateISO ? ` · ${deleting.dateISO.slice(0, 10)}` : ''}. Это действие нельзя отменить.
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
            <p className="dialog-text">Будут удалены все {entries.length} записей. Сначала можно сделать копию JSON.</p>
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
        Данные хранятся только в этом браузере. Ссылки открываются напрямую в Pacer.
      </footer>
    </div>
  );
}
