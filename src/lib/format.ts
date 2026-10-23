const pad = (n: number) => String(n).padStart(2, '0');

/** 9214 -> «2 ч 33 мин» */
export function formatDuration(sec: number): string {
  if (!sec || sec < 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h && m) return `${h} ч ${m} мин`;
  if (h) return `${h} ч`;
  return `${m} мин`;
}

/** 9214 -> «2:33:34» */
export function formatClock(sec: number): string {
  if (!sec || sec < 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}:${pad(m)}:${pad(s)}`;
}

export function formatMinutes(sec: number): string {
  return (sec / 60).toFixed(1).replace('.', ',');
}

export function formatKm(km: number): string {
  return km.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** «2026-10-20T07:37» -> «20 окт 2026, 07:37» */
export function formatDate(dateISO?: string): string {
  if (!dateISO) return 'дата не указана';
  const d = new Date(dateISO);
  if (Number.isNaN(d.getTime())) return dateISO;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** Для <input type="datetime-local"> */
export function toInputValue(dateISO?: string): string {
  if (!dateISO) return '';
  return dateISO.slice(0, 16);
}

export function todayInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** «2:56:34» / «2:56» / «176:34» / «96 мин» -> секунды */
export function parseDurationInput(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (!s) return null;
  const colon = s.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colon) {
    const a = +colon[1];
    const b = +colon[2];
    const c = colon[3] ? +colon[3] : null;
    if (b > 59 || (c !== null && c > 59)) return null;
    return c === null ? a * 3600 + b * 60 : a * 3600 + b * 60 + c;
  }
  const mins = s.match(/^(\d{1,4}(?:\.\d+)?)\s*(?:мин|min|м|m)?\.?$/i);
  if (mins) return Math.round(parseFloat(mins[1]) * 60);
  return null;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** Экранирование для CSV (разделитель «;»). */
export function csvCell(value: string | number): string {
  const s = String(value ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
