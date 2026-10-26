import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA: нужен для офлайн-режима в браузере и приёма «поделиться».
// Внутри APK файлы уже лежат на телефоне, поэтому там он не регистрируется.
const isNativeApp =
  window.location.protocol === 'file:' || /^(capacitor|ionic):\/\//.test(window.location.protocol);

if ('serviceWorker' in navigator && window.isSecureContext && !isNativeApp) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI).toString(), { scope: './' }).catch(() => {
      /* без service worker приложение работает как обычно */
    });
  });
}
