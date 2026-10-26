/**
 * Прокси к Pacer для Cloudflare Pages (бесплатный тариф, без своего сервера).
 *
 * Pages Functions раскладывают файлы по маршрутам: этот файл отвечает
 * на GET /api/fetch?url=… — ровно то, что уже запрашивает приложение.
 * Если функции нет (статичный хостинг без неё), приложение молча
 * переключается на публичные CORS-прокси.
 */
const ALLOWED = /(^|\.)(mypacer\.com|pacer\.cc)$/i;
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export const onRequestGet = async (context: { request: Request }): Promise<Response> => {
  const target = new URL(context.request.url).searchParams.get('url') ?? '';

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response('bad url', { status: 400 });
  }
  if (!/^https?:$/.test(targetUrl.protocol) || !ALLOWED.test(targetUrl.hostname)) {
    return new Response('host not allowed', { status: 403 });
  }

  try {
    const upstream = await fetch(targetUrl.toString(), {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      redirect: 'follow',
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.ok ? 200 : 502,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
    });
  } catch (e) {
    return new Response(`fetch failed: ${e instanceof Error ? e.message : String(e)}`, {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
};
