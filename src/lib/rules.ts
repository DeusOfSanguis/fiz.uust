/**
 * Правила учёта тренировок.
 *
 * 1. Короткие прогулки (< 3 км) в журнал не попадают.
 * 2. В зачёт идёт не больше 6 км с одной тренировки — остальное видно,
 *    но в сумму не добавляется.
 * 3. «Всего найдено» считается по зачётным километрам.
 *
 * Правила применяются при добавлении записи; уже сохранённые данные
 * считаются по тем же правилам при каждом показе и экспорте, поэтому
 * цифры всегда сходятся.
 */
import type { Entry } from './types';

export const MIN_KM = 3;
export const CAP_KM = 6;

/** Считается ли тренировка зачётной (попала в журнал). */
export function isCounted(km: number): boolean {
  return Number.isFinite(km) && km >= MIN_KM;
}

/** Километры, которые идут в сумму: 0 для коротких, не больше 6 для длинных. */
export function countedKm(km: number): number {
  if (!isCounted(km)) return 0;
  return Math.min(km, CAP_KM);
}

/** Обрезана ли дистанция потолком (нужно, чтобы показать «6 (7,35)»). */
export function isCapped(km: number): boolean {
  return Number.isFinite(km) && km > CAP_KM;
}

/** Короткая запись, сохранённая до появления правил: остаётся в журнале, но не в сумме. */
export function isExcluded(entry: Pick<Entry, 'distanceKm'>): boolean {
  return !isCounted(entry.distanceKm);
}

/** Сумма зачётных километров по списку. */
export function totalCounted(entries: Array<Pick<Entry, 'distanceKm'>>): number {
  return entries.reduce((sum, e) => sum + countedKm(e.distanceKm), 0);
}

/** Сумма фактических километров (для справки). */
export function totalActual(entries: Array<Pick<Entry, 'distanceKm'>>): number {
  return entries.reduce((sum, e) => sum + (Number.isFinite(e.distanceKm) ? e.distanceKm : 0), 0);
}

/** Накопительный итог: сколько всего найдено после каждой записи. */
export function runningCounted(
  entries: Array<Pick<Entry, 'distanceKm'>>,
): number[] {
  let sum = 0;
  return entries.map((e) => {
    sum += countedKm(e.distanceKm);
    return Math.round(sum * 1000) / 1000;
  });
}

/** Объяснение, почему запись не добавлена. */
export function rejectReason(km: number): string {
  return `Километраж ${km.toFixed(2).replace('.', ',')} км — меньше ${MIN_KM} км, такая прогулка в журнал не попадает.`;
}
