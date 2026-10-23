import { plural } from '../lib/format';

interface Props {
  count: number;
  withExtras: boolean;
  timeFormat: 'duration' | 'minutes';
  onToggleExtras: (v: boolean) => void;
  onChangeTimeFormat: (v: 'duration' | 'minutes') => void;
  onXlsx: () => void;
  onCsv: () => void;
  onJson: () => void;
}

export function ExportPanel({
  count,
  withExtras,
  timeFormat,
  onToggleExtras,
  onChangeTimeFormat,
  onXlsx,
  onCsv,
  onJson,
}: Props) {
  const disabled = count === 0;

  return (
    <section className="card export-panel" aria-labelledby="export-title">
      <div className="card-head">
        <h2 id="export-title">Экспорт</h2>
        <span className="badge">
          {count > 0 ? `${count} ${plural(count, 'строка', 'строки', 'строк')}` : 'пусто'}
        </span>
      </div>

      <p className="export-lead">Таблица с колонками:</p>
      <ul className="columns-preview">
        <li>Дата и время</li>
        <li>Километраж (км)</li>
        <li>{timeFormat === 'minutes' ? 'Время (мин)' : 'Время'}</li>
        <li>Ссылка</li>
        {withExtras && (
          <>
            <li>Активность</li>
            <li>Шаги</li>
            <li>Калории</li>
            <li>Высота</li>
          </>
        )}
      </ul>

      <label className="field export-field">
        <span>Время</span>
        <select
          value={timeFormat}
          onChange={(e) => onChangeTimeFormat(e.target.value as 'duration' | 'minutes')}
        >
          <option value="duration">2:56:34 — формат Excel, суммируется</option>
          <option value="minutes">176,6 — минуты числом</option>
        </select>
      </label>

      <label className="checkbox">
        <input type="checkbox" checked={withExtras} onChange={(e) => onToggleExtras(e.target.checked)} />
        <span>Добавить шаги, калории и набор высоты</span>
      </label>

      <div className="export-actions">
        <button className="btn btn-primary btn-wide" onClick={onXlsx} disabled={disabled}>
          <span className="icon" aria-hidden>
            ⤓
          </span>
          Скачать Excel (.xlsx)
        </button>
        <div className="export-secondary">
          <button className="btn btn-ghost" onClick={onCsv} disabled={disabled}>
            CSV
          </button>
          <button className="btn btn-ghost" onClick={onJson} disabled={disabled}>
            Копия JSON
          </button>
        </div>
      </div>

      <p className="hint">Дата и время — настоящие даты Excel, поэтому можно сортировать и строить графики.</p>
    </section>
  );
}
