import type { Entry } from './types';
import { buildXlsx, downloadFile, type Cell, type SheetSpec } from './xlsx';
import { CAP_KM, MIN_KM, countedKm, isExcluded, runningCounted, totalActual, totalCounted } from './rules';

export interface ExportOptions {
  /** Шаги, калории, набор высоты */
  withExtras?: boolean;
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

/**
 * Колонки таблицы:
 *   дата · километраж (в зачёт, не больше 6) · фактически · время · ссылка · всего найдено
 *
 * «Всего найдено» — накопительная сумма по зачётным километрам, чтобы после
 * каждой строки было видно, сколько уже набрано.
 */
export function buildSheet(entries: Entry[], opts: ExportOptions = {}): SheetSpec {
  const rows: Cell[][] = [];
  const header = [
    'Дата и время',
    'Километраж (км)',
    'Фактически (км)',
    'Время (ч:мм)',
    'Ссылка',
    'Всего найдено (км)',
  ];
  if (opts.withExtras) header.push('Активность', 'Шаги', 'Калории', 'Набор высоты (м)');

  const sorted = sortForExport(entries).filter((e) => !isExcluded(e));
  const running = runningCounted(sorted);

  sorted.forEach((e, i) => {
    const counted = Math.round(countedKm(e.distanceKm) * 100) / 100;
    // «Фактически» показываем только когда оно отличается от зачётного
    const actual = countedKm(e.distanceKm) !== e.distanceKm ? Math.round(e.distanceKm * 100) / 100 : '';
    const row: Cell[] = [
      { v: e.dateISO ?? '', type: e.dateISO ? 'datetime' : 'text' },
      { v: counted, type: 'number' },
      { v: actual, type: 'number' },
      { v: e.durationSec, type: 'duration' },
      { v: e.url, type: 'text' },
      { v: Math.round(running[i] * 100) / 100, type: 'number' },
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
  });

  // итоговая строка: столько уже найдено за всё время
  const totalRow: Cell[] = [
    { v: 'Всего найдено', bold: true },
    { v: Math.round(totalCounted(sorted) * 100) / 100, type: 'number', bold: true },
    { v: Math.round(totalActual(sorted) * 100) / 100, type: 'number', bold: true },
    { v: sorted.reduce((sum, e) => sum + e.durationSec, 0), type: 'duration', bold: true },
    { v: '', bold: true },
    { v: Math.round(totalCounted(sorted) * 100) / 100, type: 'number', bold: true },
  ];
  if (opts.withExtras) totalRow.push({ v: '', bold: true }, { v: '', bold: true }, { v: '', bold: true }, { v: '', bold: true });
  if (rows.length) rows.push(totalRow);

  const widths = opts.withExtras
    ? [18, 15, 15, 13, 62, 18, 14, 10, 10, 16]
    : [18, 15, 15, 13, 62, 18];
  return { name: 'Тренировки', header, rows, widths };
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function hoursMinutes(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
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
          if (i === 3 && typeof c.v === 'number') return esc(hoursMinutes(c.v));
          if (typeof c.v === 'number') return esc(c.v.toFixed(2).replace('.', ','));
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

/** Подпись для блока экспорта: правила учёта всегда на виду. */
export const RULES_HINT = `В журнал попадают прогулки от ${MIN_KM} км; в сумму идёт не больше ${CAP_KM} км с одной тренировки.`;
