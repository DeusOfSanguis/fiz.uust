import type { FetchAttempt } from '../lib/pacer';

export type JobStatus = 'queued' | 'loading' | 'ok' | 'updated' | 'error';

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
};

interface Props {
  input: string;
  onInput: (v: string) => void;
  onAdd: () => void;
  onManual: () => void;
  /** Вставка из буфера: текст сразу уходит в обработку */
  onPaste: (text: string) => void;
  onClipboard: () => void;
  jobs: Job[];
  busy: boolean;
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
  onManual,
  onPaste,
  onClipboard,
  jobs,
  busy,
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
        <button className="btn btn-primary" onClick={onAdd} disabled={busy || !input.trim()}>
          {busy ? 'Загружаем…' : 'Добавить'}
        </button>
        {canReadClipboard && (
          <button className="btn btn-ghost" onClick={onClipboard} type="button">
            Вставить
          </button>
        )}
        {busy ? (
          <button className="btn btn-text" onClick={onCancel} type="button">
            Отменить
          </button>
        ) : (
          <button className="btn btn-text" onClick={onManual} type="button">
            Вручную
          </button>
        )}
      </div>

      <p className="hint">
        Можно вставить несколько ссылок сразу — каждая на новой строке. Текст «поделиться» из приложения тоже подойдёт.
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
