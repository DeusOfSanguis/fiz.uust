/**
 * Хранилище журнала на диске: data/pacer-log.json + ротация бэкапов.
 *
 * Используется и dev-сервером (vite), и продакшн-сервером (server.mjs),
 * поэтому логика вынесена в отдельный модуль.
 */
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_BACKUPS = 30;
const MAX_BODY = 8 * 1024 * 1024; // 8 МБ — с запасом на годы записей

export function dataPaths(dir) {
  const root = dir || process.env.PACER_DATA_DIR || join(process.cwd(), 'data');
  return {
    root,
    file: join(root, 'pacer-log.json'),
    backups: join(root, 'backups'),
  };
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${ms}`;
}

/** Атомарная запись: сначала во временный файл, потом rename (не бывает полуфайлов). */
async function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, file);
}

async function pruneBackups(dir) {
  try {
    const files = (await readdir(dir)).filter((f) => f.startsWith('pacer-log-') && f.endsWith('.json')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
      await unlink(join(dir, f)).catch(() => {});
    }
  } catch {
    /* бэкапов может не быть */
  }
}

/** Очередь записи: два одновременных сохранения не должны перемешиваться. */
let writeChain = Promise.resolve();

/** Читает журнал. Возвращает { entries, updatedAt, savedAt } или пустой срез. */
export async function readEntries(dir) {
  const { file } = dataPaths(dir);
  const data = await readJson(file, null);
  if (!data || !Array.isArray(data.entries)) return { entries: [], updatedAt: null, savedAt: null };
  return {
    entries: data.entries,
    updatedAt: data.updatedAt ?? null,
    savedAt: data.savedAt ?? null,
  };
}

/**
 * Сохраняет журнал целиком.
 * `reason` попадает в имя бэкапа, чтобы было понятно, что произошло.
 */
export async function writeEntries(dir, entries, reason = 'save') {
  const task = writeChain.then(() => writeEntriesUnsafe(dir, entries, reason));
  writeChain = task.catch(() => {});
  return task;
}

async function writeEntriesUnsafe(dir, entries, reason = 'save') {
  const paths = dataPaths(dir);
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    count: entries.length,
    entries,
  };
  await mkdir(paths.root, { recursive: true });
  await mkdir(paths.backups, { recursive: true });

  // бэкап предыдущего состояния — до перезаписи
  const previous = await readFile(paths.file, 'utf8').catch(() => null);
  if (previous) {
    await writeFile(join(paths.backups, `pacer-log-${stamp()}.json`), previous, 'utf8').catch(() => {});
    await pruneBackups(paths.backups);
  }

  await atomicWrite(paths.file, JSON.stringify(payload, null, 2));
  return payload;
}

/**
 * Сливает два списка без потери данных: ключ — id записи, иначе ссылка,
 * иначе пара «дата + километраж». Побеждает более свежая версия.
 */
export function mergeEntries(base = [], incoming = []) {
  const key = (e) => e?.id || (e?.url ? `url:${e.url}` : `m:${e?.dateISO ?? ''}|${e?.distanceKm ?? 0}|${e?.durationSec ?? 0}`);
  const stampOf = (e) => String(e?.updatedAt ?? e?.addedAt ?? '');
  const map = new Map();
  for (const e of base) if (e && typeof e === 'object') map.set(key(e), e);
  for (const e of incoming) {
    if (!e || typeof e !== 'object') continue;
    const k = key(e);
    const current = map.get(k);
    if (!current || stampOf(e) >= stampOf(current)) map.set(k, e);
  }
  return [...map.values()];
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, PUT, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Обработчик /api/entries.
 *  GET  -> { entries, savedAt, storage: 'file' }
 *  PUT  -> принимает { entries: [...] }, сохраняет, отдаёт сохранённое
 *  POST -> { entries: [...], mode: 'merge' } — объединяет с серверным списком
 */
export function createEntriesHandler(options = {}) {
  const dir = options.dir;

  return async function handleEntriesApi(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/entries' && url.pathname !== '/api/entries/') return next?.();

    try {
      if (req.method === 'OPTIONS') {
        send(res, 204, {});
        return;
      }

      if (req.method === 'GET') {
        const state = await readEntries(dir);
        send(res, 200, { ...state, storage: 'file' });
        return;
      }

      if (req.method === 'PUT' || req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
          body = JSON.parse(raw || '{}');
        } catch {
          send(res, 400, { error: 'bad json' });
          return;
        }
        if (!Array.isArray(body.entries)) {
          send(res, 400, { error: 'entries must be an array' });
          return;
        }

        const current = await readEntries(dir);
        const entries = body.mode === 'merge' ? mergeEntries(current.entries, body.entries) : body.entries;
        const reason = typeof body.reason === 'string' ? body.reason.slice(0, 40).replace(/[^\w-]/g, '') : 'save';
        const saved = await writeEntries(dir, entries, reason || 'save');
        send(res, 200, { entries: saved.entries, savedAt: saved.savedAt, count: saved.count, storage: 'file' });
        return;
      }

      send(res, 405, { error: 'method not allowed' });
    } catch (e) {
      send(res, 500, { error: e instanceof Error ? e.message : 'storage error' });
    }
  };
}
