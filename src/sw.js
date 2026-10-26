// Сервис-воркер: приложение работает без сети после первого открытия.
// Стратегия «сначала сеть, при сбое кэш»: онлайн всегда свежая версия, офлайн последняя сохранённая.
// Список файлов ниже сверяется с содержимым src модульным тестом, чтобы не расходиться с кодом.
const CACHE = 'board-v1';
const PRECACHE = [
  './',
  'app.js',
  'core/camera.js',
  'core/geometry.js',
  'core/history.js',
  'core/scene.js',
  'core/storage.js',
  'core/util.js',
  'export.js',
  'i18n.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'index.html',
  'input.js',
  'looks.js',
  'main.js',
  'manifest.webmanifest',
  'pdf.js',
  'platform.js',
  'render/draw.js',
  'render/ink.js',
  'render/renderer.js',
  'render/stroke.js',
  'styles.css',
  'templates.js',
  'tools/create.js',
  'tools/eraser.js',
  'tools/pen.js',
  'tools/select.js',
  'ui/icons.js',
  'ui/panel.js',
  'ui/pop.js',
  'ui/textedit.js',
  'ui/ui.js',
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NETWORK_TIMEOUT_MS)),
    ]);
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('./') || await cache.match('index.html') : null);
    if (hit) return hit;
    throw err;
  }
}
