import type { Entry } from '../lib/types';
import { formatDate, formatHM, formatKm } from '../lib/format';
import { CAP_KM, isCapped, isExcluded } from '../lib/rules';

interface Props {
  entries: Entry[];
  /** Накопительный итог по каждой записи: id -> «сколько уже найдено» */
  cumulative: Map<string, number>;
  onDelete: (entry: Entry) => void;
}

function host(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '');
    const full = `${u.hostname.replace(/^www\./, '')}${path}`;
    return full.length > 42 ? `${full.slice(0, 39)}…` : full;
  } catch {
    return url;
  }
}

function splitDate(dateISO?: string): { day: string; time: string } {
  if (!dateISO) return { day: 'дата не указана', time: '' };
  const formatted = formatDate(dateISO);
  const [day, time] = formatted.split(', ');
  return { day, time: time ?? '' };
}

/** Километраж: «6,00» для обрезанных записей с фактическим значением в скобках. */
function Distance({ entry }: { entry: Entry }) {
  if (isExcluded(entry)) {
    return (
      <span className="distance">
        <span className="distance-counted excluded">{formatKm(entry.distanceKm)}</span>
        <span className="distance-note">не в зачёт</span>
      </span>
    );
  }
  if (isCapped(entry.distanceKm)) {
    return (
      <span className="distance">
        <span className="distance-counted">{formatKm(CAP_KM)}</span>
        <span className="distance-actual" title={`Фактически пройдено ${formatKm(entry.distanceKm)} км`}>
          ({formatKm(entry.distanceKm)})
        </span>
      </span>
    );
  }
  return (
    <span className="distance">
      <span className="distance-counted">{formatKm(entry.distanceKm)}</span>
    </span>
  );
}

export function EntryTable({ entries, cumulative, onDelete }: Props) {
  return (
    <>
      <div className="table-wrap">
        <table className="entries-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th className="num">Километраж</th>
              <th className="num">Время</th>
              <th className="num">Всего</th>
              <th>Ссылка</th>
              <th className="actions-col">
                <span className="sr-only">Действия</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className={isExcluded(e) ? 'row-excluded' : undefined}>
                <td>
                  <div className="date-cell">
                    <span className="date-main">{splitDate(e.dateISO).day}</span>
                    <span className="date-sub">
                      {splitDate(e.dateISO).time}
                      {e.activity ? ` · ${e.activity}` : ''}
                    </span>
                  </div>
                </td>
                <td className="num">
                  <Distance entry={e} />
                </td>
                <td className="num">
                  <span className="metric">{formatHM(e.durationSec)}</span>
                </td>
                <td className="num">
                  <span className="total-cell">{formatKm(cumulative.get(e.id) ?? 0)}</span>
                </td>
                <td className="link-cell">
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noreferrer noopener" title={e.url}>
                      {host(e.url)}
                      <span className="ext" aria-hidden>
                        ↗
                      </span>
                    </a>
                  ) : (
                    <span className="muted">без ссылки</span>
                  )}
                </td>
                <td className="actions-col">
                  <div className="row-actions">
                    <button className="icon-btn danger" onClick={() => onDelete(e)} title="Удалить" aria-label="Удалить">
                      🗑
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="entry-cards">
        {entries.map((e) => {
          const d = splitDate(e.dateISO);
          return (
            <li key={e.id} className={`entry-card${isExcluded(e) ? ' row-excluded' : ''}`}>
              <div className="ec-head">
                <span className="ec-date">{d.day}</span>
                <span className="ec-time">{d.time}</span>
              </div>
              <div className="ec-metrics">
                <span className="ec-km">
                  <Distance entry={e} /> <small>км</small>
                </span>
                <span className="ec-dur">{formatHM(e.durationSec)} ч</span>
              </div>
              <div className="ec-foot">
                <span className="ec-total">
                  Всего: <strong>{formatKm(cumulative.get(e.id) ?? 0)}</strong> км
                </span>
                <button className="icon-btn danger" onClick={() => onDelete(e)} aria-label="Удалить">
                  🗑
                </button>
              </div>
              {e.url && (
                <a className="ec-link" href={e.url} target="_blank" rel="noreferrer noopener">
                  {host(e.url)} ↗
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
