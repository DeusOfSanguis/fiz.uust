import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildXlsx, excelSerial } from '../src/lib/xlsx';
import { buildSheet } from '../src/lib/export';
import type { Entry } from '../src/lib/types';

const entries: Entry[] = [
  {
    id: 'a',
    pacerId: 'OXxdWKozfoIOzHAnr4OLFE',
    url: 'https://share.mypacer.com/track/OXxdWKozfoIOzHAnr4OLFE',
    dateISO: '2026-10-20T07:37',
    distanceKm: 6.8,
    durationSec: 10594,
    activity: 'Walking',
    steps: 5115,
    calories: 768,
    elevationM: 305,
    source: 'pacer',
    addedAt: '2026-10-21T10:00:00.000Z',
  },
  {
    id: 'b',
    pacerId: 'manual-1',
    url: '',
    dateISO: '2026-10-18T18:05',
    distanceKm: 3.1,
    durationSec: 2530,
    source: 'manual',
    addedAt: '2026-10-21T10:05:00.000Z',
  },
];

describe('xlsx', () => {
  it('собирает файл, который читается как настоящая таблица', () => {
    const data = buildXlsx([buildSheet(entries)]);
    const wb = XLSX.read(data, { type: 'array' });
    expect(wb.SheetNames).toEqual(['Тренировки']);

    const ws = wb.Sheets['Тренировки'];
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, raw: true });

    expect(rows[0]).toEqual(['Дата и время', 'Километраж (км)', 'Время', 'Ссылка']);
    // сортировка по дате: 18 октября раньше 20-го
    expect(rows[1][1]).toBe(3.1);
    expect(rows[2][1]).toBe(6.8);
    expect(rows[2][3]).toBe('https://share.mypacer.com/track/OXxdWKozfoIOzHAnr4OLFE');
  });

  it('пишет дату числом с форматом, а не текстом', () => {
    const data = buildXlsx([buildSheet(entries)]);
    const wb = XLSX.read(data, { type: 'array', cellNF: true });
    const ws = wb.Sheets['Тренировки'];
    const cell = ws['A3'];
    expect(cell.t).toBe('n');
    expect(cell.v).toBeCloseTo(excelSerial('2026-10-20T07:37')!, 6);
    expect(String(cell.z)).toContain('yyyy');
  });

  it('пишет время как длительность Excel', () => {
    const data = buildXlsx([buildSheet(entries)]);
    const wb = XLSX.read(data, { type: 'array', cellNF: true });
    const ws = wb.Sheets['Тренировки'];
    const cell = ws['C3'];
    expect(cell.t).toBe('n');
    expect(cell.v).toBeCloseTo(10594 / 86400, 8);
    expect(String(cell.z)).toContain('mm:ss');
  });

  it('умеет выгружать минуты числом', () => {
    const data = buildXlsx([buildSheet(entries, { timeFormat: 'minutes' })]);
    const wb = XLSX.read(data, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets['Тренировки'], { header: 1 });
    expect(rows[0][2]).toBe('Время (мин)');
    expect(rows[2][2]).toBeCloseTo(176.6, 1);
    expect(rows[1][2]).toBeCloseTo(42.2, 1);
  });

  it('добавляет дополнительные колонки по запросу', () => {
    const data = buildXlsx([buildSheet(entries, { withExtras: true })]);
    const wb = XLSX.read(data, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets['Тренировки'], { header: 1 });
    expect(rows[0].slice(4)).toEqual(['Активность', 'Шаги', 'Калории', 'Набор высоты (м)']);
    expect(rows[2][5]).toBe(5115);
  });

  it('корректно считает серийный номер даты', () => {
    // 2026-10-20 = 46315 дней от 1899-12-30
    expect(excelSerial('2026-10-20T00:00')).toBe(46315);
    expect(excelSerial('2026-10-20T12:00')).toBe(46315.5);
    // контрольная точка: 2024-01-01 = 45292
    expect(excelSerial('2024-01-01T00:00')).toBe(45292);
    expect(excelSerial('мусор')).toBeNull();
  });
});
