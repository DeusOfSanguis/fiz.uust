/**
 * Минимальный, но полноценный генератор .xlsx: без зависимостей, с числами,
 * реальными датами (не текстом), автофильтром и закреплённой шапкой.
 */
import { strToU8, zipSync } from 'fflate';

export type CellValue = string | number | null | undefined;
export type CellType = 'auto' | 'datetime' | 'text' | 'number' | 'duration';

export interface Cell {
  v: CellValue;
  type?: CellType;
  /** жирная строка итогов */
  bold?: boolean;
}

export interface SheetSpec {
  name: string;
  header: string[];
  rows: Cell[][];
  widths?: number[];
}

const STYLE_HEADER = 1;
const STYLE_DATETIME = 2;
const STYLE_NUMBER = 3;
const STYLE_DURATION = 4;
const STYLE_TOTAL_TEXT = 5;
const STYLE_TOTAL_NUMBER = 6;
const STYLE_TOTAL_DURATION = 7;

/** Номер колонки -> буква (1 -> A, 27 -> AA). */
function colName(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function esc(s: string): string {
  return s
    // управляющие символы недопустимы в XML
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Excel serial date для локального «настенного» времени. */
export function excelSerial(dateISO: string): number | null {
  const m = dateISO.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const h = m[4] ? +m[4] : 0;
  const mi = m[5] ? +m[5] : 0;
  const ms = Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(1899, 11, 30);
  return ms / 86400000;
}

function cellXml(ref: string, cell: Cell): string {
  const { v } = cell;
  if (v === null || v === undefined || v === '') return '';

  const type = cell.type ?? 'auto';
  const bold = cell.bold === true;

  if (type === 'datetime' || (type === 'auto' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v))) {
    const serial = typeof v === 'string' ? excelSerial(v) : null;
    if (serial !== null) {
      return `<c r="${ref}" s="${STYLE_DATETIME}"><v>${serial.toFixed(10)}</v></c>`;
    }
  }

  if (type === 'duration' && typeof v === 'number' && Number.isFinite(v)) {
    // длительность = доля суток; формат [h]:mm в стилях (>24 ч не превращается в дату)
    const style = bold ? STYLE_TOTAL_DURATION : STYLE_DURATION;
    return `<c r="${ref}" s="${style}"><v>${(v / 86400).toFixed(10)}</v></c>`;
  }

  if (typeof v === 'number' && Number.isFinite(v)) {
    const style = bold ? STYLE_TOTAL_NUMBER : STYLE_NUMBER;
    return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
  }

  const textStyle = bold ? ` s="${STYLE_TOTAL_TEXT}"` : '';
  return `<c r="${ref}"${textStyle} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(sheet: SheetSpec): string {
  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  const headerRow = `<row r="1" ht="20" customHeight="1">${sheet.header
    .map((h, i) => `<c r="${colName(i + 1)}1" s="${STYLE_HEADER}" t="inlineStr"><is><t>${esc(h)}</t></is></c>`)
    .join('')}</row>`;

  const dataRows = sheet.rows
    .map((row, r) => {
      const n = r + 2;
      const cells = row.map((c, i) => cellXml(`${colName(i + 1)}${n}`, c)).join('');
      return `<row r="${n}">${cells}</row>`;
    })
    .join('');

  const lastCol = colName(Math.max(1, sheet.header.length));
  const lastRow = Math.max(1, sheet.rows.length + 1);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols}
<sheetData>${headerRow}${dataRows}</sheetData>
<autoFilter ref="A1:${lastCol}${lastRow}"/>
</worksheet>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="0.00"/><numFmt numFmtId="166" formatCode="[h]:mm"/></numFmts>
<fonts count="3">
<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF1F3A32"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE6EFE9"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="165" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="166" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

export function buildXlsx(sheets: SheetSpec[]): Uint8Array {
  const sheetEntries: Record<string, Uint8Array> = {};
  const sheetDefs = sheets
    .map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');

  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');

  sheets.forEach((s, i) => {
    sheetEntries[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${overrides}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetDefs}</sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>Pacer Log</dc:creator><cp:lastModifiedBy>Pacer Log</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;

  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Pacer Log</Application></Properties>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
    'xl/styles.xml': strToU8(stylesXml()),
    'docProps/core.xml': strToU8(core),
    'docProps/app.xml': strToU8(app),
    ...sheetEntries,
  };

  return zipSync(files, { level: 6 });
}

export function downloadFile(data: Uint8Array | string, filename: string, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
