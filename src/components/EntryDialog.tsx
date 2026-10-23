import { useEffect, useRef, useState } from 'react';
import type { Entry } from '../lib/types';
import { newEntryId, saveEntry } from '../lib/store';
import { pacerIdFromUrl, extractPacerUrls } from '../lib/pacer';
import { formatClock, parseDurationInput, toInputValue, todayInputValue } from '../lib/format';

interface Props {
  /** Пустая запись — режим создания; с id — редактирование */
  entry?: Entry | null;
  onClose: () => void;
  onSaved: (entry: Entry, isNew: boolean) => void;
}

interface FormState {
  url: string;
  date: string;
  distance: string;
  duration: string;
  activity: string;
  steps: string;
  calories: string;
  elevation: string;
}

function initialState(entry?: Entry | null): FormState {
  if (!entry) {
    return {
      url: '',
      date: todayInputValue(),
      distance: '',
      duration: '',
      activity: 'Walking',
      steps: '',
      calories: '',
      elevation: '',
    };
  }
  return {
    url: entry.url,
    date: toInputValue(entry.dateISO),
    distance: entry.distanceKm ? String(entry.distanceKm).replace('.', ',') : '',
    duration: entry.durationSec ? formatClock(entry.durationSec) : '',
    activity: entry.activity ?? '',
    steps: entry.steps != null ? String(entry.steps) : '',
    calories: entry.calories != null ? String(entry.calories) : '',
    elevation: entry.elevationM != null ? String(entry.elevationM) : '',
  };
}

export function EntryDialog({ entry, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => initialState(entry));
  const [error, setError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(Boolean(entry?.steps || entry?.calories || entry?.elevationM));
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const distance = parseFloat(form.distance.replace(',', '.'));
    if (!Number.isFinite(distance) || distance <= 0) {
      setError('Укажите километраж больше нуля');
      return;
    }
    const durationSec = parseDurationInput(form.duration);
    if (durationSec === null) {
      setError('Время в формате 2:56:34, 2:56 или 176 (минуты)');
      return;
    }
    const urlFromField = form.url.trim() ? extractPacerUrls(form.url)[0] ?? form.url.trim() : '';
    const now = new Date().toISOString();

    const next: Entry = {
      id: entry?.id ?? newEntryId(),
      pacerId: entry?.pacerId ?? (urlFromField ? pacerIdFromUrl(urlFromField) : `manual-${newEntryId()}`),
      url: urlFromField,
      dateISO: form.date ? form.date.slice(0, 16) : undefined,
      distanceKm: Math.round(distance * 1000) / 1000,
      durationSec,
      activity: form.activity.trim() || undefined,
      steps: form.steps ? Number(form.steps) : entry?.steps,
      calories: form.calories ? Number(form.calories) : entry?.calories,
      elevationM: form.elevation ? Number(form.elevation) : entry?.elevationM,
      author: entry?.author,
      avgPaceSecPerKm: entry?.avgPaceSecPerKm,
      cadence: entry?.cadence,
      source: entry?.source ?? 'manual',
      addedAt: entry?.addedAt ?? now,
    };
    saveEntry(next);
    onSaved(next, !entry);
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-head">
          <h2 id="dialog-title">{entry ? 'Изменить запись' : 'Добавить вручную'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>

        <form onSubmit={submit} className="dialog-form">
          <div className="field-row">
            <label className="field">
              <span>Дата и время</span>
              <input type="datetime-local" value={form.date} onChange={set('date')} />
            </label>
            <label className="field">
              <span>Километраж, км</span>
              <input
                ref={firstField}
                inputMode="decimal"
                placeholder="6,8"
                value={form.distance}
                onChange={set('distance')}
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Время</span>
              <input placeholder="2:56:34" value={form.duration} onChange={set('duration')} />
            </label>
            <label className="field">
              <span>Активность</span>
              <input placeholder="Walking" value={form.activity} onChange={set('activity')} />
            </label>
          </div>

          <label className="field">
            <span>Ссылка из Pacer (необязательно)</span>
            <input
              placeholder="https://share.mypacer.com/track/…"
              value={form.url}
              onChange={set('url')}
              spellCheck={false}
            />
          </label>

          <button type="button" className="btn btn-text more-toggle" onClick={() => setShowMore((v) => !v)}>
            {showMore ? '− Дополнительно' : '+ Дополнительно: шаги, калории, высота'}
          </button>

          {showMore && (
            <div className="field-row field-row-3">
              <label className="field">
                <span>Шаги</span>
                <input inputMode="numeric" value={form.steps} onChange={set('steps')} />
              </label>
              <label className="field">
                <span>Калории</span>
                <input inputMode="numeric" value={form.calories} onChange={set('calories')} />
              </label>
              <label className="field">
                <span>Набор, м</span>
                <input inputMode="numeric" value={form.elevation} onChange={set('elevation')} />
              </label>
            </div>
          )}

          {error && <p className="form-error">{error}</p>}

          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary">
              {entry ? 'Сохранить' : 'Добавить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
