import { useState } from 'react';

/**
 * Приложение рассчитано только на телефон: на компьютере показываем
 * этот экран вместо журнала.
 *
 * Для отладки на большом экране можно открыть адрес с ?desktop=1 —
 * это единственный обход, в интерфейсе он не рекламируется.
 */
export function isPhoneDevice(): boolean {
  if (typeof window === 'undefined') return true;
  const ua = navigator.userAgent;
  const mobileUA = /Android|iPhone|iPod|Windows Phone|IEMobile|Opera Mini|Mobile/i.test(ua);
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  const coarse = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)').matches : false;
  const narrow = Math.min(window.innerWidth, window.innerHeight) <= 560;
  return mobileUA || (touch && coarse && narrow) || (coarse && narrow);
}

/** true, если приложение разрешено на этом устройстве. */
export function isAllowedDevice(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get('desktop') === '1') return true;
  return isPhoneDevice();
}

export function PhoneGate() {
  const [copied, setCopied] = useState(false);
  const url = typeof window === 'undefined' ? '' : window.location.origin;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="6" y="2.5" width="12" height="19" rx="3" />
            <path d="M10.5 5.5h3" strokeLinecap="round" />
            <circle cx="12" cy="18.2" r="1" fill="currentColor" stroke="none" />
          </svg>
        </div>

        <h1>Только с телефона</h1>
        <p className="gate-lead">
          Pacer Log рассчитан на телефон: так ссылки из Pacer приходят в него через «Поделиться», а данные
          всегда под рукой на прогулке.
        </p>

        <div className="gate-steps">
          <span className="gate-step">1</span>
          <span>Откройте этот адрес на телефоне</span>
          <div className="gate-url">
            <code>{url}</code>
            <button className="btn btn-ghost btn-sm" onClick={copy} type="button">
              {copied ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
          <span className="gate-step">2</span>
          <span>В меню браузера выберите «Установить приложение»</span>
          <span className="gate-step">3</span>
          <span>В Pacer нажмите «Поделиться» → Pacer Log</span>
        </div>

        <p className="gate-note">
          Уже открыли с телефона и видите этот экран? Значит, браузер представился как компьютерный — попробуйте
          Chrome или Safari в обычном (не «полноэкранном») режиме.
        </p>
      </div>
    </div>
  );
}
