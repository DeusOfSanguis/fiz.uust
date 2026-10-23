import type { Entry } from '../lib/types';
import { formatClock, formatDate, formatDuration, formatKm } from '../lib/format';

interface Props {
  entries: Entry[];
  onEdit: (entry: Entry) => void;
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

export function EntryTable({ entries, onEdit, onDelete }: Props) {
  return (
    <>
      <div className="table-wrap">
        <table className="entries-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th className="num">Километраж</th>
              <th className="num">Время</th>
              <th>Ссылка</th>
              <th className="actions-col">
                <span className="sr-only">Действия</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>
                  <div className="date-cell">
                    <span className="date-main">{splitDate(e.dateISO).day}</span>
                    <span className="date-sub">
                      {splitDate(e.dateISO).time}
                      {e.activity ? ` · ${e.activity}` : ''}
                      {e.source === 'manual' ? ' · вручную' : ''}
                    </span>
                  </div>
                </td>
                <td className="num">
                  <span className="metric">{formatKm(e.distanceKm)}</span>
                  <span className="unit">км</span>
                </td>
                <td className="num">
                  <span className="metric">{formatDuration(e.durationSec)}</span>
                  <span className="unit mono">{formatClock(e.durationSec)}</span>
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
                    <button className="icon-btn" onClick={() => onEdit(e)} title="Изменить" aria-label="Изменить">
                      ✎
                    </button>
                    <button
                      className="icon-btn danger"
                      onClick={() => onDelete(e)}
                      title="Удалить"
                      aria-label="Удалить"
                    >
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
            <li key={e.id} className="entry-card">
              <div className="ec-head">
                <span className="ec-date">{d.day}</span>
                <span className="ec-time">{d.time}</span>
              </div>
              <div className="ec-metrics">
                <span className="ec-km">
                  {formatKm(e.distanceKm)} <small>км</small>
                </span>
                <span className="ec-dur">{formatDuration(e.durationSec)}</span>
              </div>
              <div className="ec-foot">
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noreferrer noopener">
                    {host(e.url)} ↗
                  </a>
                ) : (
                  <span className="muted">без ссылки</span>
                )}
                <div className="row-actions">
                  <button className="icon-btn" onClick={() => onEdit(e)} aria-label="Изменить">
                    ✎
                  </button>
                  <button className="icon-btn danger" onClick={() => onDelete(e)} aria-label="Удалить">
                    🗑
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
