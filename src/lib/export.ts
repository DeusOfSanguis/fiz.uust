import type { Entry } from './types';
import { buildXlsx, downloadFile, type Cell, type SheetSpec } from './xlsx';

export interface ExportOptions {
  /** Шаги, калории, набор высоты */
  withExtras?: boolean;
  /** «duration» — 2:56:34 (формат Excel), «minutes» — 176,6 */
  timeFormat?: 'duration' | 'minutes';
}

function sortForExport(entries: Entry[]): Entry[] {
  return entries.slice().sort((a, b) => {
    const da = a.dateISO ?? '';
    const db = b.dateISO ?? '';
    if (!da && !db) return a.addedAt.localeCompare(b.addedAt);
    if (!da) return 1;
    if (!db) return -1;
    return da.localeCompare(db);
  });
}

export function buildSheet(entries: Entry[], opts: ExportOptions = {}): SheetSpec {
  const rows: Cell[][] = [];
  const minutes = opts.timeFormat === 'minutes';
  const header = ['Дата и время', 'Километраж (км)', minutes ? 'Время (мин)' : 'Время', 'Ссылка'];
  if (opts.withExtras) header.push('Активность', 'Шаги', 'Калории', 'Набор высоты (м)');

  for (const e of sortForExport(entries)) {
    const row: Cell[] = [
      { v: e.dateISO ?? '', type: e.dateISO ? 'datetime' : 'text' },
      { v: Math.round(e.distanceKm * 100) / 100, type: 'number' },
      minutes
        ? { v: Math.round((e.durationSec / 60) * 10) / 10, type: 'number' }
        : { v: e.durationSec, type: 'duration' },
      { v: e.url, type: 'text' },
    ];
    if (opts.withExtras) {
      row.push(
        { v: e.activity ?? '', type: 'text' },
        { v: e.steps ?? '', type: 'number' },
        { v: e.calories ?? '', type: 'number' },
        { v: e.elevationM ?? '', type: 'number' },
      );
    }
    rows.push(row);
  }

  const widths = opts.withExtras ? [18, 15, 12, 62, 14, 10, 10, 16] : [18, 15, 12, 62];
  return { name: 'Тренировки', header, rows, widths };
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function clock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function exportXlsx(entries: Entry[], opts: ExportOptions = {}): void {
  const sheet = buildSheet(entries, opts);
  const data = buildXlsx([sheet]);
  downloadFile(data, `pacer-${stamp()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

export function exportCsv(entries: Entry[], opts: ExportOptions = {}): void {
  const sheet = buildSheet(entries, opts);
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [sheet.header.map(esc).join(';')];
  for (const row of sheet.rows) {
    lines.push(
      row
        .map((c, i) => {
          if (i === 0 && typeof c.v === 'string' && c.v) return esc(c.v.replace('T', ' '));
          if (i === 2 && typeof c.v === 'number') {
            return esc(c.type === 'duration' ? clock(c.v) : String(c.v).replace('.', ','));
          }
          if (i === 1 && typeof c.v === 'number') return esc(c.v.toFixed(2).replace('.', ','));
          return esc(c.v ?? '');
        })
        .join(';'),
    );
  }
  // BOM — чтобы Excel не ломал кириллицу
  downloadFile(`\ufeff${lines.join('\r\n')}`, `pacer-${stamp()}.csv`, 'text/csv;charset=utf-8');
}

export function exportJson(entries: Entry[]): void {
  downloadFile(JSON.stringify(entries, null, 2), `pacer-backup-${stamp()}.json`, 'application/json');
}
