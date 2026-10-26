const { app, BrowserWindow, Menu, ipcMain, shell, nativeTheme } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pathToFileURL } = require('url');

// Данные пользователя: ~/Library/Application Support/Board/boards/...
const dataDir = () => path.join(app.getPath('userData'), 'boards');
const assetDir = () => path.join(app.getPath('userData'), 'assets');
const safeId = (id) => {
  if (typeof id !== 'string' || !/^[\w.-]{1,80}$/.test(id) || id.includes('..')) throw new Error('bad id');
  return id;
};

async function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

function registerIpc() {
  ipcMain.handle('boards:list', async () => {
    await fsp.mkdir(dataDir(), { recursive: true });
    const out = [];
    for (const f of await fsp.readdir(dataDir())) {
      if (!f.endsWith('.meta.json')) continue;
      try {
        out.push(JSON.parse(await fsp.readFile(path.join(dataDir(), f), 'utf8')));
      } catch (e) { /* повреждённый файл пропускаем */ }
    }
    return out;
  });
  ipcMain.handle('boards:getMeta', async (_e, id) => {
    try { return JSON.parse(await fsp.readFile(path.join(dataDir(), safeId(id) + '.meta.json'), 'utf8')); } catch { return null; }
  });
  ipcMain.handle('boards:putMeta', async (_e, meta) => {
    await fsp.mkdir(dataDir(), { recursive: true });
    await atomicWrite(path.join(dataDir(), safeId(meta.id) + '.meta.json'), JSON.stringify(meta));
  });
  ipcMain.handle('boards:loadData', async (_e, id) => {
    const file = path.join(dataDir(), safeId(id) + '.json');
    // возвращаем первый файл, который читается как JSON: основной или запасной
    for (const f of [file, file + '.bak']) {
      try {
        const text = await fsp.readFile(f, 'utf8');
        JSON.parse(text);
        return text;
      } catch { /* пробуем следующий */ }
    }
    return null;
  });
  ipcMain.handle('boards:saveData', async (_e, id, json) => {
    await fsp.mkdir(dataDir(), { recursive: true });
    const file = path.join(dataDir(), safeId(id) + '.json');
    try { await fsp.copyFile(file, file + '.bak'); } catch { /* первого файла ещё нет */ }
    await atomicWrite(file, typeof json === 'string' ? json : JSON.stringify(json));
  });
  ipcMain.handle('boards:remove', async (_e, id) => {
    const base = path.join(dataDir(), safeId(id));
    for (const ext of ['.json', '.json.bak', '.meta.json']) await fsp.rm(base + ext, { force: true });
  });
  ipcMain.handle('assets:put', async (_e, id, bytes) => {
    await fsp.mkdir(assetDir(), { recursive: true });
    await atomicWrite(path.join(assetDir(), safeId(id)), Buffer.from(bytes));
  });
  ipcMain.handle('assets:url', async (_e, id) => pathToFileURL(path.join(assetDir(), safeId(id))).href);
  ipcMain.handle('theme:get', () => nativeTheme.shouldUseDarkColors);
}

let win;
let quitting = false;

// Дымовой тест в настоящем Electron: BOARD_SMOKE=/путь/к/папке electron . --no-sandbox
async function smoke(dir) {
  const wc = win.webContents;
  const run = (code) => wc.executeJavaScript(code);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];
  try {
    await wait(800);
    await run(`document.querySelector('.primary').click()`);
    await wait(600);
    await run(`window.__board.setTool('pen')`);
    for (const [type, x, y] of [['mouseDown', 400, 300], ...Array.from({ length: 40 }, (_, i) => ['mouseMove', 400 + i * 8, 300 + Math.sin(i / 5) * 60]), ['mouseUp', 720, 300]]) {
      wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
      await wait(8);
    }
    await wait(300);
    log.push(await run(`JSON.stringify({objs: window.__board.scene.all().length, api: typeof window.boardAPI, storage: window.__board.storage.kind})`));
    await run(`window.__board.dirty = true; window.__board.saveNow()`);
    await wait(500);
    const fs2 = require('fs');
    log.push('boards: ' + fs2.readdirSync(path.join(app.getPath('userData'), 'boards')).join(','));
    const img = await wc.capturePage();
    fs2.writeFileSync(path.join(dir, 'electron.png'), img.toPNG());
    log.push('ok');
  } catch (e) { log.push('error: ' + e.stack); }
  console.log('SMOKE ' + log.join(' | '));
  quitting = true;
  app.quit();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#f4f5f7',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // перо и зум не должны замирать, когда окно перекрыто или кадр пропущен
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  if (process.env.BOARD_SMOKE) win.webContents.once('did-finish-load', () => smoke(process.env.BOARD_SMOKE));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });

  // Перед закрытием даём странице сохранить доску
  win.on('close', (e) => {
    if (quitting || !win || win.isDestroyed()) return;
    e.preventDefault();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      quitting = true;
      win.close();
    };
    ipcMain.once('app:flushed', finish);
    win.webContents.send('app:flush');
    setTimeout(finish, 2500);
  });
  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const send = (cmd, ...args) => () => win && win.webContents.send('cmd', cmd, ...args);
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' }, { type: 'separator' },
        { label: 'Настройки…', accelerator: 'Cmd+,', click: send('settings') },
        { type: 'separator' }, { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
      ],
    }] : []),
    {
      label: 'Доска',
      submenu: [
        { label: 'Новая доска', accelerator: 'CmdOrCtrl+N', click: send('new-board') },
        { label: 'Все доски', accelerator: 'CmdOrCtrl+Shift+H', click: send('home') },
        { type: 'separator' },
        { label: 'Экспорт PNG…', accelerator: 'CmdOrCtrl+Shift+E', click: send('export-png') },
        { label: 'Экспорт SVG…', click: send('export-svg') },
        { label: 'Сохранить доску в файл…', click: send('export-json') },
        { label: 'Открыть файл доски…', click: send('import-json') },
        { type: 'separator' },
        { label: 'Вставить изображение…', accelerator: 'CmdOrCtrl+Shift+I', click: send('add-image') },
        ...(isMac ? [] : [{ role: 'quit' }]),
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Повторить', accelerator: 'CmdOrCtrl+Shift+Z', click: send('redo') },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { label: 'Дублировать', accelerator: 'CmdOrCtrl+D', click: send('duplicate') },
        { label: 'Выделить всё', accelerator: 'CmdOrCtrl+A', click: send('select-all') },
        { type: 'separator' },
        { label: 'Сгруппировать', accelerator: 'CmdOrCtrl+G', click: send('group') },
        { label: 'Разгруппировать', accelerator: 'CmdOrCtrl+Shift+G', click: send('ungroup') },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Увеличить', accelerator: 'CmdOrCtrl+=', click: send('zoom-in') },
        { label: 'Уменьшить', accelerator: 'CmdOrCtrl+-', click: send('zoom-out') },
        { label: 'Масштаб 100%', accelerator: 'CmdOrCtrl+0', click: send('zoom-100') },
        { label: 'Показать всё', accelerator: 'CmdOrCtrl+1', click: send('zoom-fit') },
        { label: 'К выделенному', accelerator: 'CmdOrCtrl+2', click: send('zoom-sel') },
        { type: 'separator' },
        { label: 'Мини-карта', accelerator: 'CmdOrCtrl+M', click: send('minimap') },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (process.env.BOARD_USER_DATA) app.setPath('userData', process.env.BOARD_USER_DATA);

app.whenReady().then(() => {
  registerIpc();
  buildMenu();
  if (process.platform === 'darwin' && app.dock) { try { app.dock.setIcon(path.join(__dirname, 'build', 'icon.png')); } catch { /* значок по умолчанию */ } }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { quitting = false; createWindow(); } });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
