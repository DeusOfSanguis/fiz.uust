import { plural } from '../lib/format';

interface Props {
  count: number;
  withExtras: boolean;
  onToggleExtras: (v: boolean) => void;
  onXlsx: () => void;
  onCsv: () => void;
  onJson: () => void;
}

export function ExportPanel({ count, withExtras, onToggleExtras, onXlsx, onCsv, onJson }: Props) {
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
        <li>Время (мин)</li>
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
