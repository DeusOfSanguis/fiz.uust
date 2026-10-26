import { describe, expect, it } from 'vitest';
import {
  CAP_KM,
  MIN_KM,
  countedKm,
  isCapped,
  isCounted,
  isExcluded,
  rejectReason,
  runningCounted,
  totalActual,
  totalCounted,
} from '../src/lib/rules';

describe('правила учёта', () => {
  it('порог 3 км и потолок 6 км', () => {
    expect(MIN_KM).toBe(3);
    expect(CAP_KM).toBe(6);
  });

  it('короткие прогулки не считаются', () => {
    expect(isCounted(0)).toBe(false);
    expect(isCounted(2.99)).toBe(false);
    expect(isCounted(3)).toBe(true);
    expect(countedKm(2.99)).toBe(0);
    expect(countedKm(0)).toBe(0);
  });

  it('считается ровно 3 км', () => {
    expect(countedKm(3)).toBe(3);
    expect(isCapped(3)).toBe(false);
  });

  it('в сумму идёт не больше 6 км', () => {
    expect(countedKm(6)).toBe(6);
    expect(isCapped(6)).toBe(false);
    expect(countedKm(6.01)).toBe(6);
    expect(countedKm(15.4)).toBe(6);
    expect(isCapped(15.4)).toBe(true);
  });

  it('суммы считаются по зачётным километрам', () => {
    const entries = [
      { distanceKm: 2.5 }, // мимо
      { distanceKm: 4 }, // 4
      { distanceKm: 9.2 }, // 6
      { distanceKm: 6 }, // 6
    ];
    expect(totalCounted(entries)).toBe(16);
    expect(totalActual(entries)).toBeCloseTo(21.7, 3);
  });

  it('накопительный итог растёт по записям', () => {
    const entries = [{ distanceKm: 4 }, { distanceKm: 9.2 }, { distanceKm: 3 }];
    expect(runningCounted(entries)).toEqual([4, 10, 13]);
  });

  it('записи короче 3 км остаются в журнале, но вне суммы', () => {
    expect(isExcluded({ distanceKm: 1.2 })).toBe(true);
    expect(isExcluded({ distanceKm: 3.4 })).toBe(false);
    expect(totalCounted([{ distanceKm: 1.2 }, { distanceKm: 3.4 }])).toBe(3.4);
  });

  it('объясняет отказ человеческим языком', () => {
    expect(rejectReason(1.5)).toContain('1,50');
    expect(rejectReason(1.5)).toContain('меньше 3 км');
  });
});
