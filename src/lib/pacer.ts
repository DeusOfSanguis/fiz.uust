/**
 * Разбор страниц Pacer (share.mypacer.com).
 *
 * Страница отдаётся сервером уже с готовыми числами, поэтому основной парсер
 * работает по видимому тексту: он одинаково хорошо переваривает HTML,
 * markdown (r.jina.ai) и простой текст.
 */

export interface ParsedTrack {
  url: string;
  pacerId: string;
  activity?: string;
  author?: string;
  /** Локальное «настенное» время начала: YYYY-MM-DDTHH:mm */
  dateISO?: string;
  distanceKm: number;
  durationSec: number;
  calories?: number;
  steps?: number;
  elevationM?: number;
  avgPaceSecPerKm?: number;
  cadence?: number;
}

export interface ParseResult {
  ok: boolean;
  track?: ParsedTrack;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Ссылки                                                              */
/* ------------------------------------------------------------------ */

const URL_RE = /https?:\/\/[^\s<>"'`\[\]()]+/gi;
const BARE_RE = /(?:share\.)?mypacer\.com\/[^\s<>"'`\[\]()]+/gi;

function trimUrl(u: string): string {
  return u.replace(/[)\].,;:!?'"»]+$/g, '');
}

export function isPacerUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return /(^|\.)mypacer\.com$/i.test(url.hostname) || /(^|\.)pacer\.cc$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/** Достаёт все ссылки Pacer из произвольного текста (в т.ч. из «поделиться»). */
export function extractPacerUrls(input: string): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    let u = trimUrl(raw);
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    if (isPacerUrl(u) && !out.includes(u)) out.push(u);
  };
  for (const m of input.match(URL_RE) ?? []) push(m);
  for (const m of input.match(BARE_RE) ?? []) push(m);
  return out;
}

export function pacerIdFromUrl(u: string): string {
  const m = u.match(/\/track\/([A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  const m2 = u.match(/\/track\/?\?.*\bid=([A-Za-z0-9_-]+)/i);
  if (m2) return m2[1];
  // стабильный короткий хэш для нестандартных ссылок
  let h = 5381;
  for (let i = 0; i < u.length; i++) h = ((h << 5) + h + u.charCodeAt(i)) >>> 0;
  return `h${h.toString(36)}`;
}

/* ------------------------------------------------------------------ */
/* HTML -> текст                                                       */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  middot: '·',
  deg: '°',
  laquo: '«',
  raquo: '»',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  times: '×',
  euro: '€',
  copy: '©',
  reg: '®',
  trade: '™',
  prime: '′',
  Prime: '″',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

function safeChar(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Грубое, но предсказуемое превращение разметки в текст. */
export function htmlToText(input: string): string {
  let s = input;
  if (!s.includes('<') && !/&[a-z#0-9]+;/i.test(s)) {
    // уже текст/markdown
  } else {
    s = s
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<template\b[\s\S]*?<\/template>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|td|th|h[1-6]|section|article|header|footer|span|a)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    s = decodeEntities(s);
  }
  return s
    .replace(/\r/g, '\n')
    .replace(/[ \t\u00a0\u2007\u202f]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Парсер                                                              */
/* ------------------------------------------------------------------ */

const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_NL = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function monthIndex(name: string): number {
  const n = name.toLowerCase().slice(0, 3);
  let i = MONTHS_EN.indexOf(n);
  if (i >= 0) return i + 1;
  i = MONTHS_RU.indexOf(n);
  if (i >= 0) return i + 1;
  i = MONTHS_NL.indexOf(n);
  if (i >= 0) return i + 1;
  return 0;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Границы слова, которые понимают и латиницу, и кириллицу (\b — не понимает). */
const B = '(?<![A-Za-zА-Яа-яЁё])';
const E = '(?![A-Za-zА-Яа-яЁё])';

function toISO(y: number, mo: number, d: number, h: number, mi: number): string | undefined {
  if (!y || !mo || !d) return undefined;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const year = y < 100 ? (y > 70 ? 1900 + y : 2000 + y) : y;
  return `${year}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
}

/** Ищет дату/время начала прогулки в тексте. */
export function parseDateText(text: string): { iso?: string; raw?: string } {
  // 0) ISO с часовым поясом — единственный вариант, который не зависит от того,
  //    в каком часовом поясе рендерилась страница. Переводим в местное время.
  const zoned = text.match(
    /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})/,
  );
  if (zoned) {
    const date = new Date(
      `${zoned[1]}-${zoned[2]}-${zoned[3]}T${zoned[4]}:${zoned[5]}:${zoned[6] ?? '00'}${zoned[7] === 'Z' ? 'Z' : zoned[7]}`,
    );
    if (!Number.isNaN(date.getTime())) {
      return {
        iso: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`,
        raw: zoned[0],
      };
    }
  }
  // 1) Oct 20, 2026 7:37 AM  /  20 октября 2026, 07:37
  const wordy = text.match(
    /\b([A-Za-zА-Яа-яЁё]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:(?:\s*,\s*|\s+)(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i,
  );
  if (wordy) {
    const mo = monthIndex(wordy[1]);
    if (mo) {
      let h = wordy[4] ? parseInt(wordy[4], 10) : 0;
      const mi = wordy[5] ? parseInt(wordy[5], 10) : 0;
      const ampm = (wordy[7] || '').toLowerCase();
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      return { iso: toISO(parseInt(wordy[3], 10), mo, parseInt(wordy[2], 10), h, mi), raw: wordy[0] };
    }
  }
  // 2) 2026-10-20 07:37 / 2026-10-20T07:37:21
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (iso) {
    return {
      iso: toISO(+iso[1], +iso[2], +iso[3], iso[4] ? +iso[4] : 0, iso[5] ? +iso[5] : 0),
      raw: iso[0],
    };
  }
  // 3) 20.10.2026 07:37 (европейский порядок) / 10/20/2026
  const num = text.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (num) {
    let d = +num[1];
    let mo = +num[2];
    if (d <= 12 && mo > 12) [d, mo] = [mo, d]; // 10/20/2026
    let h = num[4] ? +num[4] : 0;
    const ampm = (num[7] || '').toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return { iso: toISO(+num[3], mo, d, h, num[5] ? +num[5] : 0), raw: num[0] };
  }
  return {};
}

function num(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const v = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : undefined;
}

/** Имя автора: короткая строка в паре строк перед «Walking Activity». */
function extractAuthor(text: string): string | undefined {
  const lines = text.split('\n').map((l) => l.trim());
  const actIdx = lines.findIndex((l) => /\b(Walking|Running|Cycling|Hiking|Treadmill|Ride|Walk|Run)\b.*\bActivity\b/i.test(l));
  if (actIdx < 0) return undefined;
  for (let i = actIdx - 1; i >= Math.max(0, actIdx - 5); i--) {
    const l = lines[i];
    if (!l) continue;
    if (l.startsWith('![') || l.startsWith('http') || /^[\d\s.,%:/-]+$/.test(l)) continue;
    if (/\b(Install|Standard|Satellite|Pacer|Pedometer)\b/i.test(l)) continue;
    if (l.length >= 2 && l.length <= 60) return l;
  }
  return undefined;
}

/** Главный разбор. Возвращает ok=false, если не нашлись километраж и время. */
export function parsePacerText(raw: string, url: string): ParseResult {
  const text = htmlToText(raw);
  const flat = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ');
  const warnings: string[] = [];

  // --- дистанция -----------------------------------------------------
  let distanceKm = 0;
  let distanceLabel = false;
  const unit = '(km|км|mi|miles?|миль?)';
  const unitEnd = '(?!\\s*\\/)' + E; // «km/h», «км/ч» — это скорость, а не дистанция
  const distLabeled = flat.match(
    new RegExp(`${B}(?:Distance|Дистанция|Расстояние|Afstand)${E}\\s*[: ]?\\s*(\\d+(?:[.,]\\d+)?)\\s*${unit}${unitEnd}`, 'i'),
  );
  const distAny = flat.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${unit}${unitEnd}`, 'i'));
  const dm = distLabeled ?? distAny;
  distanceLabel = Boolean(distLabeled);
  if (dm) {
    const v = num(dm[1]) ?? 0;
    const unit = dm[2].toLowerCase();
    distanceKm = unit.startsWith('mi') || unit.startsWith('мил') ? v * 1.609344 : v;
    if (!distanceLabel) warnings.push('Километраж взят по первой единице «км/миля» на странице');
  }

  // --- время ---------------------------------------------------------
  let durationSec = 0;
  const tLabeled = flat.match(
    new RegExp(
      `${B}(?:Time|Duration|Время|Длительность|Tijd|Duur|Zeit|Dauer)${E}\\s*[: ]?\\s*(\\d{1,3}):(\\d{2})(?::(\\d{2}))?`,
      'i',
    ),
  );
  if (tLabeled) {
    // Pacer показывает «2:56:34» для долгих прогулок и «56:34» для коротких,
    // то есть две части — это минуты:секунды, а не часы:минуты.
    durationSec = tLabeled[3] != null
      ? +tLabeled[1] * 3600 + +tLabeled[2] * 60 + +tLabeled[3]
      : +tLabeled[1] * 60 + +tLabeled[2];
  } else {
    const tAny = flat.match(/\b(\d{1,2}):(\d{2}):(\d{2})\b/);
    if (tAny) durationSec = +tAny[1] * 3600 + +tAny[2] * 60 + +tAny[3];
  }
  if (!durationSec) {
    const hms = flat.match(/\b(\d{1,2})\s*(?:h|ч|hour|hours|час[а-я]*)\s*(\d{1,2})?\s*(?:m|min|мин|minutes?|м)\b/i);
    if (hms) durationSec = +hms[1] * 3600 + (hms[2] ? +hms[2] * 60 : 0);
  }

  // --- дата ----------------------------------------------------------
  const date = parseDateText(flat);
  if (!date.iso) warnings.push('Не удалось распознать дату');

  // --- остальное -----------------------------------------------------
  const act = flat.match(
    new RegExp(`${B}(Walking|Running|Cycling|Hiking|Treadmill|Riding|Walk|Run|Ride|Bike|Прогулка|Бег|Езда)${E}`, 'i'),
  );
  const activity = act ? act[1] : undefined;

  const authorClean = extractAuthor(text);

  const calories = num(flat.match(new RegExp(`${B}Calories?${E}\\s*[: ]?\\s*(\\d[\\d\\s,.]*)`, 'i'))?.[1]?.replace(/\s/g, ''));
  const steps = num(flat.match(new RegExp(`${B}Steps${E}\\s*[: ]?\\s*(\\d[\\d\\s,.]*)`, 'i'))?.[1]?.replace(/\s/g, ''));
  const elevationM = num(flat.match(new RegExp(`${B}Elev(?:ation)?\\.?\\s*Gain${E}[^\\d-]{0,12}(-?\\d[\\d,.]*)`, 'i'))?.[1]);
  const cadence = num(flat.match(new RegExp(`${B}Cadence${E}\\s*[: ]?\\s*(\\d+)`, 'i'))?.[1]);

  let avgPaceSecPerKm: number | undefined;
  const pace = flat.match(new RegExp(`${B}Avg\\.?\\s*Pace${E}[^\\d]{0,12}(\\d{1,3})\\s*['’′]\\s*(\\d{1,2})`, 'i'));
  if (pace) avgPaceSecPerKm = +pace[1] * 60 + +pace[2];
  else if (durationSec > 0 && distanceKm > 0) avgPaceSecPerKm = Math.round(durationSec / distanceKm);

  const ok = distanceKm > 0 || durationSec > 0;
  if (!ok) {
    return {
      ok: false,
      warnings: ['В тексте страницы не нашлись километраж и время — возможно, изменилась вёрстка или ссылка закрыта'],
    };
  }

  return {
    ok: true,
    warnings,
    track: {
      url,
      pacerId: pacerIdFromUrl(url),
      activity,
      author: authorClean,
      dateISO: date.iso,
      distanceKm: Math.round(distanceKm * 1000) / 1000,
      durationSec,
      calories,
      steps,
      elevationM,
      avgPaceSecPerKm,
      cadence,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Загрузка страницы                                                   */
/* ------------------------------------------------------------------ */

export interface FetchAttempt {
  name: string;
  label: string;
  ok: boolean;
  error?: string;
  ms: number;
}

export interface FetchResult {
  raw: string;
  via: string;
  attempts: FetchAttempt[];
}

type Strategy = {
  name: string;
  label: string;
  build: (url: string) => string;
  timeoutMs: number;
};

const SERVER_STRATEGY: Strategy = {
  name: 'server',
  label: 'свой сервер',
  build: (u) => `/api/fetch?url=${encodeURIComponent(u)}`,
  timeoutMs: 5000,
};

/**
 * Публичные CORS-прокси. Из браузера напрямую Pacer не запросить (нет CORS),
 * поэтому страница тянется через них. Запросы идут параллельно — выигрывает
 * тот, что первым вернёт распознаваемые данные.
 */
const PROXY_STRATEGIES: Strategy[] = [
  {
    name: 'corsfix',
    label: 'corsfix',
    build: (u) => `https://proxy.corsfix.com/?${u}`,
    timeoutMs: 14000,
  },
  {
    name: 'allorigins',
    label: 'allorigins',
    build: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    timeoutMs: 14000,
  },
  {
    name: 'codetabs',
    label: 'codetabs',
    build: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    timeoutMs: 14000,
  },
  {
    name: 'corslol',
    label: 'cors.lol',
    build: (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
    timeoutMs: 14000,
  },
  {
    // читалка, которая сама отрисовывает страницу; последняя в очереди,
    // потому что время суток она показывает в своём часовом поясе
    name: 'jina',
    label: 'r.jina.ai',
    build: (u) => `https://r.jina.ai/${u}`,
    timeoutMs: 22000,
  },
];

/** Сколько ждём «более полный» ответ, если первый пришёл без даты. */
const GRACE_MS = 1200;

async function attempt(strategy: Strategy, url: string, externalSignal?: AbortSignal): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), strategy.timeoutMs);
  const onAbort = () => ctrl.abort();
  externalSignal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(strategy.build(url), {
      signal: ctrl.signal,
      headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      credentials: 'omit',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    if (!body || body.length < 200) throw new Error('пустой ответ');
    if (/^(error|too many requests|rate limit)/i.test(body.trim())) throw new Error(body.trim().slice(0, 80));
    return body;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

function describeError(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'AbortError') return 'таймаут';
    if (/Failed to fetch|NetworkError|Load failed/i.test(e.message)) return 'нет связи';
    return e.message;
  }
  return 'ошибка сети';
}

interface Success {
  track: ParsedTrack;
  warnings: string[];
  via: string;
}

/**
 * Скачивает и разбирает страницу: сначала свой /api/fetch (мгновенно и без
 * лимитов), затем — гонка публичных прокси. Из нескольких удачных ответов
 * выбирается тот, где распознано больше данных.
 */
export async function loadPacerTrack(
  url: string,
  onAttempt?: (a: FetchAttempt) => void,
  externalSignal?: AbortSignal,
): Promise<Success & { attempts: FetchAttempt[] }> {
  const attempts: FetchAttempt[] = [];
  const report = (a: FetchAttempt, quiet = false) => {
    attempts.push(a);
    if (!quiet) onAttempt?.(a);
  };

  // 1. Собственный сервер (в статичной сборке его нет — это быстро отвалится).
  {
    const started = performance.now();
    try {
      const raw = await attempt(SERVER_STRATEGY, url, externalSignal);
      const parsed = parsePacerText(raw, url);
      report(
        {
          name: SERVER_STRATEGY.name,
          label: SERVER_STRATEGY.label,
          ok: parsed.ok,
          ms: Math.round(performance.now() - started),
          error: parsed.ok ? undefined : 'данные не распознаны',
        },
        true,
      );
      if (parsed.ok && parsed.track) {
        return { track: parsed.track, warnings: parsed.warnings, via: SERVER_STRATEGY.name, attempts };
      }
    } catch (e) {
      report(
        {
          name: SERVER_STRATEGY.name,
          label: SERVER_STRATEGY.label,
          ok: false,
          ms: Math.round(performance.now() - started),
          error: describeError(e),
        },
        true,
      );
    }
  }

  // 2. Гонка прокси.
  const raceCtrl = new AbortController();
  const finish = () => raceCtrl.abort();
  externalSignal?.addEventListener('abort', finish);

  return await new Promise((resolve, reject) => {
    let done = false;
    let settled = 0;
    let best: Success | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const errors: string[] = [];

    const cleanup = () => {
      externalSignal?.removeEventListener('abort', finish);
      if (graceTimer) clearTimeout(graceTimer);
      finish();
    };

    const win = (result: Success) => {
      if (done) return;
      done = true;
      cleanup();
      resolve({ ...result, attempts });
    };

    const fail = (msg: string) => {
      if (done) return;
      errors.push(msg);
      settled++;
      if (settled < PROXY_STRATEGIES.length) return;
      if (best) {
        win(best);
        return;
      }
      done = true;
      cleanup();
      reject(
        new PacerFetchError(
          'Не удалось получить данные из Pacer. Проверьте ссылку и попробуйте ещё раз — или добавьте запись вручную.',
          attempts,
          errors.join('; '),
        ),
      );
    };

    const accept = (result: Success) => {
      if (done) return;
      if (!best) {
        best = result;
        // даём остальным короткую фору: вдруг у них есть дата, которой нет здесь
        graceTimer = setTimeout(() => best && win(best), GRACE_MS);
        return;
      }
      if (result.track.dateISO && !best.track.dateISO) {
        best = result;
        win(best);
      }
    };

    if (externalSignal?.aborted) {
      done = true;
      reject(new PacerFetchError('Загрузка отменена', attempts));
      return;
    }

    for (const strategy of PROXY_STRATEGIES) {
      const started = performance.now();
      attempt(strategy, url, raceCtrl.signal)
        .then((raw) => {
          if (done) return;
          const parsed = parsePacerText(raw, url);
          report({
            name: strategy.name,
            label: strategy.label,
            ok: parsed.ok,
            ms: Math.round(performance.now() - started),
            error: parsed.ok ? undefined : 'данные не распознаны',
          });
          if (parsed.ok && parsed.track) {
            accept({ track: parsed.track, warnings: parsed.warnings, via: strategy.name });
          } else {
            fail(`${strategy.label}: данные не распознаны`);
          }
        })
        .catch((e) => {
          if (done) return;
          report({
            name: strategy.name,
            label: strategy.label,
            ok: false,
            ms: Math.round(performance.now() - started),
            error: describeError(e),
          });
          fail(`${strategy.label}: ${describeError(e)}`);
        });
    }
  });
}

export class PacerFetchError extends Error {
  attempts: FetchAttempt[];
  detail: string;
  constructor(message: string, attempts: FetchAttempt[], detail = '') {
    super(message);
    this.name = 'PacerFetchError';
    this.attempts = attempts;
    this.detail = detail;
  }
}
