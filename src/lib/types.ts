export interface Entry {
  id: string;
  pacerId: string;
  url: string;
  /** Локальное время начала: «YYYY-MM-DDTHH:mm» */
  dateISO?: string;
  distanceKm: number;
  durationSec: number;
  activity?: string;
  author?: string;
  calories?: number;
  steps?: number;
  elevationM?: number;
  avgPaceSecPerKm?: number;
  cadence?: number;
  source: 'pacer' | 'manual';
  addedAt: string;
  updatedAt?: string;
}

export type SortMode = 'date-desc' | 'date-asc' | 'added-desc';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  text?: string;
}
