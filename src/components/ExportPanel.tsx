import { plural } from '../lib/format';
import { RULES_HINT } from '../lib/export';

interface Props {
  count: number;
  withExtras: boolean;
  onToggleExtras: (v: boolean) => void;
  onXlsx: () => void;
  onCsv: () => void;
  onJson: () => void;
  onImport: (file: File) => void;
}

export function ExportPanel({
  count,
  withExtras,
  onToggleExtras,
  onXlsx,
  onCsv,
  onJson,
  onImport,
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
        <li>Фактически (км)</li>
        <li>Время (ч:мм)</li>
        <li>Ссылка</li>
        <li>Всего найдено (км)</li>
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
          <label className="btn btn-ghost import-btn">
            Импорт
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImport(file);
                e.currentTarget.value = '';
              }}
            />
          </label>
        </div>
      </div>

      <p className="hint">{RULES_HINT}</p>
      <p className="hint">
        Дата и время — настоящие даты Excel. Последний столбец — сколько уже набрано накопительно, снизу —
        общий итог. «Импорт» принимает только записи со ссылкой на Pacer и сливает их с журналом.
      </p>
    </section>
  );
}
