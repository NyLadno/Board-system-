import { App } from './app.js';

if (window.boardAPI) document.documentElement.dataset.platform = window.boardAPI.platform;

const app = new App();
app.init().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="padding:16px;color:#c00">${String(e && e.stack || e)}</pre>`);
});

// Установка как приложение (PWA) и работа офлайн. В Electron не нужно: там всё уже локально.
if (!window.boardAPI && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e));
}
