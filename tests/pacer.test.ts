import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractPacerUrls,
  htmlToText,
  parseDateText,
  parsePacerText,
  pacerIdFromUrl,
} from '../src/lib/pacer';

const url = 'https://share.mypacer.com/track/OXxdWKozfoIOzHAnr4OLFE';
const html = readFileSync(fileURLToPath(new URL('./fixtures/pacer-page.html', import.meta.url)), 'utf8');
const markdown = readFileSync(fileURLToPath(new URL('./fixtures/pacer-page.md', import.meta.url)), 'utf8');
const jina = readFileSync(fileURLToPath(new URL('./fixtures/pacer-jina.md', import.meta.url)), 'utf8');

describe('ссылки', () => {
  it('находит ссылку в тексте «поделиться»', () => {
    const shared = `Смотрите мою прогулку в Pacer! ${url} Установите приложение: https://pacer.app`;
    expect(extractPacerUrls(shared)).toEqual([url]);
  });

  it('понимает markdown-ссылку и не дублирует её', () => {
    expect(extractPacerUrls(`[${url}](${url})`)).toEqual([url]);
  });

  it('убирает хвостовую пунктуацию и работает без схемы', () => {
    expect(extractPacerUrls('(share.mypacer.com/track/abc123).')).toEqual(['https://share.mypacer.com/track/abc123']);
  });

  it('игнорирует обычные ссылки', () => {
    expect(extractPacerUrls('https://example.com/track/OXxdWKozfoIOzHAnr4OLFE')).toEqual([]);
  });

  it('достаёт идентификатор тренировки', () => {
    expect(pacerIdFromUrl(url)).toBe('OXxdWKozfoIOzHAnr4OLFE');
  });
});

describe('разбор страницы', () => {
  it('читает HTML-страницу Pacer', () => {
    const res = parsePacerText(html, url);
    expect(res.ok).toBe(true);
    expect(res.track).toMatchObject({
      url,
      pacerId: 'OXxdWKozfoIOzHAnr4OLFE',
      distanceKm: 6.8,
      durationSec: 2 * 3600 + 56 * 60 + 34,
      dateISO: '2026-10-20T07:37',
      activity: 'Walking',
      steps: 5115,
      calories: 768,
      elevationM: 305,
      cadence: 29,
    });
    expect(res.track?.author).toBe('Vyacheslav Dmitriev (Des Hade)');
  });

  it('читает markdown от r.jina.ai', () => {
    const res = parsePacerText(markdown, url);
    expect(res.ok).toBe(true);
    expect(res.track?.distanceKm).toBe(6.8);
    expect(res.track?.durationSec).toBe(10594);
    expect(res.track?.dateISO).toBe('2026-10-20T07:37');
  });

  it('читает настоящий ответ r.jina.ai', () => {
    const res = parsePacerText(jina, url);
    expect(res.ok).toBe(true);
    expect(res.track).toMatchObject({
      distanceKm: 6.8,
      durationSec: 10594,
      dateISO: '2026-10-20T11:37',
      steps: 5115,
      calories: 768,
    });
  });

  it('не принимает км/ч за километраж', () => {
    const page = '<div>Speed</div><div>5.83 km/h</div><div>Time</div><div>1:00:00</div>';
    const res = parsePacerText(page, url);
    expect(res.track?.distanceKm).toBe(0);
  });

  it('переводит мили в километры', () => {
    const page = '<div>Distance</div><div>4.2</div><div>mi</div><div>Time</div><div>1:10:00</div>';
    const res = parsePacerText(page, url);
    expect(res.track?.distanceKm).toBeCloseTo(6.759, 2);
    expect(res.track?.durationSec).toBe(4200);
  });

  it('понимает короткую прогулку (ММ:СС) и русские подписи', () => {
    const page = '<div>Distance</div><div>3.1</div><div>км</div><div>Время</div><div>42:10</div>';
    const res = parsePacerText(page, url);
    expect(res.track?.distanceKm).toBe(3.1);
    expect(res.track?.durationSec).toBe(42 * 60 + 10);
  });

  it('не падает на странице без данных', () => {
    const res = parsePacerText('<html><body><h1>Not found</h1></body></html>', url);
    expect(res.ok).toBe(false);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('сообщает, если не нашлась дата', () => {
    const res = parsePacerText('<div>6.8 km</div><div>Time 1:00:00</div>', url);
    expect(res.ok).toBe(true);
    expect(res.track?.dateISO).toBeUndefined();
    expect(res.warnings.join(' ')).toMatch(/дату/i);
  });
});

describe('даты', () => {
  it('разбирает формат Pacer', () => {
    expect(parseDateText('Oct 20, 2026 7:37 AM').iso).toBe('2026-10-20T07:37');
    expect(parseDateText('Oct 20, 2026 12:05 PM').iso).toBe('2026-10-20T12:05');
    expect(parseDateText('Oct 20, 2026 12:05 AM').iso).toBe('2026-10-20T00:05');
  });

  it('разбирает ISO и европейский формат', () => {
    // ISO с поясом переводится в местное время
    const d = new Date('2026-10-20T19:41:03Z');
    const pad = (n: number) => String(n).padStart(2, '0');
    const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    expect(parseDateText('start 2026-10-20T19:41:03Z').iso).toBe(expected);
    expect(parseDateText('20.10.2026 19:41').iso).toBe('2026-10-20T19:41');
    expect(parseDateText('10/20/2026 7:41 PM').iso).toBe('2026-10-20T19:41');
  });

  it('предпочитает точный ISO-таймстамп «нарисованной» дате', () => {
    const text = 'Oct 20, 2026 11:37 AM · 2026-10-20T04:37:21Z';
    const d = new Date('2026-10-20T04:37:21Z');
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(parseDateText(text).iso).toBe(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
  });

  it('не выдумывает дату из мусора', () => {
    expect(parseDateText('no date here').iso).toBeUndefined();
  });
});

describe('html -> текст', () => {
  it('выкидывает скрипты и теги', () => {
    const text = htmlToText('<div>6.8</div><script>var x = 1;</script><b>km</b>');
    expect(text).toContain('6.8');
    expect(text).toContain('km');
    expect(text).not.toContain('var x');
    expect(text).not.toContain('<div>');
  });

  it('раскрывает html-сущности', () => {
    expect(htmlToText('<p>A &amp; B &laquo;C&raquo; &#1055;&#1088;&#1080;&#1074;&#1077;&#1090;</p>')).toBe('A & B «C» Привет');
  });
});
