import type { FetchAttempt } from '../lib/pacer';

export type JobStatus = 'queued' | 'loading' | 'ok' | 'updated' | 'error' | 'skipped';

export interface Job {
  id: string;
  url: string;
  status: JobStatus;
  message?: string;
  lastAttempt?: FetchAttempt;
  attempts: FetchAttempt[];
}

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'в очереди',
  loading: 'получаем данные',
  ok: 'добавлено',
  updated: 'обновлено',
  error: 'ошибка',
  skipped: 'меньше 3 км — не добавлено',
};

interface Props {
  input: string;
  onInput: (v: string) => void;
  onAdd: () => void;
  /** Вставка из буфера: текст сразу уходит в обработку */
  onPaste: (text: string) => void;
  onClipboard: () => void;
  jobs: Job[];
  busy: boolean;
  /** Нет интернета — новые ссылки не загрузить */
  offline?: boolean;
  /** Сколько ссылок осталось в незавершённой очереди */
  queueCount: number;
  onResume: () => void;
  onClearQueue: () => void;
  onCancel: () => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}

const canReadClipboard =
  typeof navigator !== 'undefined' &&
  typeof window !== 'undefined' &&
  window.isSecureContext &&
  typeof navigator.clipboard?.readText === 'function';

export function AddPanel({
  input,
  onInput,
  onAdd,
  onPaste,
  onClipboard,
  jobs,
  busy,
  offline,
  queueCount,
  onResume,
  onClearQueue,
  onCancel,
  onRetry,
  onDismiss,
}: Props) {
  return (
    <section className="card add-panel" aria-labelledby="add-title">
      <div className="card-head">
        <h2 id="add-title">Добавить тренировку</h2>
        <span className="badge">из Pacer</span>
      </div>

      <label className="sr-only" htmlFor="share-input">
        Ссылка из Pacer
      </label>
      <textarea
        id="share-input"
        className="share-input"
        placeholder="Вставьте ссылку из Pacer — например https://share.mypacer.com/track/OXxdWKozfoIOzHAnr4OLFE"
        value={input}
        onChange={(e) => onInput(e.target.value)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (!text) return;
          e.preventDefault();
          onPaste(text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onAdd();
          }
        }}
        rows={3}
        spellCheck={false}
      />

      <div className="add-actions">
        <button className="btn btn-primary" onClick={onAdd} disabled={busy || !input.trim() || offline}>
          {busy ? 'Загружаем…' : offline ? 'Нужен интернет' : 'Добавить'}
        </button>
        {canReadClipboard && (
          <button className="btn btn-ghost" onClick={onClipboard} type="button">
            Вставить
          </button>
        )}
        {busy && (
          <button className="btn btn-text" onClick={onCancel} type="button">
            Отменить
          </button>
        )}
      </div>

      {queueCount > 0 && !busy && (
        <div className="resume">
          <div className="resume-text">
            <strong>Есть незавершённая загрузка</strong>
            <span>
              {queueCount} {queueCount === 1 ? 'ссылка' : queueCount < 5 ? 'ссылки' : 'ссылок'} в очереди — они
              сохранены и не потеряются, даже если закрыть вкладку.
            </span>
          </div>
          <div className="resume-actions">
            <button className="btn btn-primary btn-sm" onClick={onResume} type="button">
              Продолжить
            </button>
            <button className="btn btn-text" onClick={onClearQueue} type="button">
              Убрать
            </button>
          </div>
        </div>
      )}

      <p className="hint">
        Можно вставить несколько ссылок сразу — каждая на новой строке. Текст «поделиться» из приложения тоже подойдёт.
      </p>
      <p className="hint hint-rules">
        Данные берутся только со страницы Pacer и не редактируются. В журнал попадают прогулки от 3 км; в сумму
        идёт не больше 6 км с одной тренировки.
      </p>

      {jobs.length > 0 && (
        <ul className="jobs">
          {jobs.map((job) => (
            <li key={job.id} className={`job job-${job.status}`}>
              <span className="job-dot" aria-hidden />
              <div className="job-main">
                <span className="job-url" title={job.url}>
                  {shortUrl(job.url)}
                </span>
                <span className="job-status">
                  {STATUS_LABEL[job.status]}
                  {job.status === 'loading' && job.lastAttempt ? ` · ${job.lastAttempt.label}` : ''}
                  {job.message ? ` · ${job.message}` : ''}
                </span>
                {job.status === 'error' && job.attempts.length > 0 && (
                  <details className="job-details">
                    <summary>что пробовали</summary>
                    <ul>
                      {job.attempts.map((a, i) => (
                        <li key={`${a.name}-${i}`}>
                          {a.label} — {a.ok ? 'ок' : a.error} ({a.ms} мс)
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <div className="job-actions">
                {job.status === 'error' && (
                  <button className="icon-btn" onClick={() => onRetry(job.id)} title="Повторить" aria-label="Повторить">
                    ↻
                  </button>
                )}
                {job.status !== 'loading' && job.status !== 'queued' && (
                  <button className="icon-btn" onClick={() => onDismiss(job.id)} title="Убрать" aria-label="Убрать">
                    ×
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return url;
  }
}
