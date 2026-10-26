import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { unzipSync, strFromU8 } from 'fflate';
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
    pacerId: 'second',
    url: 'https://share.mypacer.com/track/second',
    dateISO: '2026-10-18T18:05',
    distanceKm: 3.1,
    durationSec: 2530,
    source: 'pacer',
    addedAt: '2026-10-21T10:05:00.000Z',
  },
  {
    id: 'c',
    pacerId: 'long',
    url: 'https://share.mypacer.com/track/long',
    dateISO: '2026-10-22T09:00',
    distanceKm: 11.4,
    durationSec: 7200,
    source: 'pacer',
    addedAt: '2026-10-22T10:00:00.000Z',
  },
];

function readSheet(items: Entry[], opts = {}) {
  const data = buildXlsx([buildSheet(items, opts)]);
  const wb = XLSX.read(data, { type: 'array', cellNF: true });
  const ws = wb.Sheets['Тренировки'];
  return { ws, rows: XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, raw: true }) };
}

describe('xlsx', () => {
  it('колонки соответствуют правилам: дата, зачёт, факт, время, ссылка, всего', () => {
    const { rows } = readSheet(entries);
    expect(rows[0]).toEqual([
      'Дата и время',
      'Километраж (км)',
      'Фактически (км)',
      'Время (ч:мм)',
      'Ссылка',
      'Всего найдено (км)',
    ]);
    // сортировка по дате: 18 -> 20 -> 22 октября
    expect(rows[1][1]).toBe(3.1); // 18 октября, без обрезки
    expect(rows[2][1]).toBe(6); // 20 октября, 6.8 -> 6
    expect(rows[3][1]).toBe(6); // 22 октября, 11.4 -> 6
  });

  it('показывает фактические километры там, где они больше зачётных', () => {
    const { rows } = readSheet(entries);
    expect(rows[2][2]).toBe(6.8);
    expect(rows[3][2]).toBe(11.4);
    expect(rows[1][2]).toBeUndefined(); // 3.1 не обрезано — дублировать не нужно
  });

  it('считает накопительный итог и общий итог внизу', () => {
    const { rows } = readSheet(entries);
    expect(rows[1][5]).toBe(3.1);
    expect(rows[2][5]).toBe(9.1);
    expect(rows[3][5]).toBe(15.1);

    const total = rows[4];
    expect(total[0]).toBe('Всего найдено');
    expect(total[1]).toBe(15.1);
    expect(total[2]).toBeCloseTo(21.3, 2);
  });

  it('не включает в таблицу записи короче 3 км', () => {
    const withShort = [
      ...entries,
      {
        ...entries[0],
        id: 'short',
        pacerId: 'short',
        distanceKm: 1.5,
        url: 'https://share.mypacer.com/track/short',
      } as Entry,
    ];
    const { rows } = readSheet(withShort);
    expect(rows).toHaveLength(5); // шапка + 3 записи + итог
    expect(rows.some((r) => r[1] === 1.5)).toBe(false);
  });

  it('пишет дату числом с форматом, а не текстом', () => {
    const { ws } = readSheet(entries);
    const cell = ws['A3'];
    expect(cell.t).toBe('n');
    expect(cell.v).toBeCloseTo(excelSerial('2026-10-20T07:37')!, 6);
    expect(String(cell.z)).toContain('yyyy');
  });

  it('пишет время как длительность [h]:mm', () => {
    const { ws } = readSheet(entries);
    const cell = ws['D3'];
    expect(cell.t).toBe('n');
    expect(cell.v).toBeCloseTo(10594 / 86400, 8);
    expect(String(cell.z)).toContain('[h]:mm');
  });

  it('строка итогов выделена жирным', () => {
    // проверяем сам OOXML: у ячеек итоговой строки стиль «жирный»
    const data = buildXlsx([buildSheet(entries)]);
    const files = unzipSync(data);
    const sheetXml = strFromU8(files['xl/worksheets/sheet1.xml']);
    const stylesXml = strFromU8(files['xl/styles.xml']);

    expect(sheetXml).toContain('<c r="A5" s="5"');
    expect(sheetXml).toContain('<c r="B5" s="6"');
    expect(sheetXml).toContain('<c r="D5" s="7"');
    // в стилях есть третий шрифт с <b/>
    expect(stylesXml).toContain('<fonts count="3">');
    expect((stylesXml.match(/<b\/>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('добавляет дополнительные колонки по запросу', () => {
    const { rows } = readSheet(entries, { withExtras: true });
    expect(rows[0].slice(6)).toEqual(['Активность', 'Шаги', 'Калории', 'Набор высоты (м)']);
    expect(rows[2][6]).toBe('Walking');
    expect(rows[2][7]).toBe(5115);
  });

  it('корректно считает серийный номер даты', () => {
    expect(excelSerial('2026-10-20T00:00')).toBe(46315);
    expect(excelSerial('2026-10-20T12:00')).toBe(46315.5);
    // контрольная точка: 2024-01-01 = 45292
    expect(excelSerial('2024-01-01T00:00')).toBe(45292);
    expect(excelSerial('мусор')).toBeNull();
  });
});
