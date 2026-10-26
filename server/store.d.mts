export interface StoredEntry {
  id?: string;
  url?: string;
  dateISO?: string;
  distanceKm?: number;
  durationSec?: number;
  addedAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface EntriesState {
  entries: StoredEntry[];
  updatedAt: string | null;
  savedAt: string | null;
}

export interface EntriesPayload extends EntriesState {
  count?: number;
  storage?: string;
}

export function dataPaths(dir?: string): { root: string; file: string; backups: string };

export function readEntries(dir?: string): Promise<EntriesState>;

export function writeEntries(
  dir: string | undefined,
  entries: StoredEntry[],
  reason?: string,
): Promise<EntriesPayload>;

export function mergeEntries<T extends StoredEntry>(base?: T[], incoming?: T[]): T[];

export function createEntriesHandler(options?: { dir?: string }): (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  next?: () => void,
) => Promise<void>;
