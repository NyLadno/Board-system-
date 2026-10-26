// E2E-проверка в Chromium: node test/e2e.js  (нужен пакет playwright)
const { chromium } = require('playwright');
const { start } = require('./serve.js');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e).split('\n').slice(0, 4).join('\n     ')); process.exitCode = 1; }
}

(async () => {
  const server = await start(5199);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.DPR) || 2 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.stack));
  page.on('dialog', (d) => d.accept());
  // имитация Windows-API системного следа пера: проверяем, что приложение вызывает его с верными параметрами
  await page.addInitScript(() => {
    window.__trail = [];
    Object.defineProperty(navigator, 'ink', { value: { requestPresenter: async () => ({ updateInkTrailStartPoint: (e, st) => window.__trail.push({ type: e.type, trusted: e.isTrusted, ...st }) }) } });
  });
  const cdp = await page.context().newCDPSession(page);
  const pen = (type, x, y, force) => cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: force || type === 'mouseReleased' ? 'left' : 'none', buttons: force ? 1 : 0, pointerType: 'pen', force: force || 0, clickCount: type === 'mouseMoved' ? 0 : 1,
  });
  const B = (fn, arg) => page.evaluate(fn, arg);
  const objs = () => B(() => window.__board.scene.all().map((o) => ({ id: o.id, type: o.type, shape: o.shape, x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot, z: o.z, group: o.group, text: o.text, s: o.s })));
  const drag = async (x0, y0, x1, y1, steps = 8, mods = []) => {
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.move(x0, y0); await page.mouse.down();
    await page.mouse.move(x1, y1, { steps }); await page.mouse.up();
    for (const m of mods) await page.keyboard.up(m);
  };
  const newBoard = async () => { await page.click('.primary'); await page.click('.tpl-card[data-tpl="blank"]'); await page.waitForTimeout(350); };
  const home = async () => { await page.click('.top-left .tb'); await page.waitForTimeout(400); };

  await page.goto('http://localhost:5199/');
  await page.waitForTimeout(400);

  await step('шаблоны: каждый создаёт доску с содержимым без ошибок', async () => {
    const ids = await B(async () => (await import('/templates.js')).TEMPLATES.map((t) => t.id));
    assert.ok(ids.length >= 9);
    for (const id of ids) {
      await page.click('.primary');
      await page.waitForSelector('.tpl-card');
      await page.click(`.tpl-card[data-tpl="${id}"]`);
      await page.waitForTimeout(450);
      const n = await B(() => ({ objs: window.__board.scene.all().length, frames: window.__board.scene.all().filter((o) => o.type === 'frame').length, name: window.__board.meta.name, z: window.__board.cam.z }));
      if (id === 'blank' || id === 'cells') assert.equal(n.objs, 0);
      else assert.ok(n.objs >= 6, id + ' ' + JSON.stringify(n));
      if (id === 'kanban' || id === 'retro') assert.equal(n.frames, 3);
      if (id === 'swot' || id === 'eisenhower') assert.equal(n.frames, 4);
      if (id === 'week') assert.equal(n.frames, 5);
      if (id === 'cells') {
        assert.equal(await B(() => window.__board.boardBg), 'cells');
        assert.equal(await B(() => document.getElementById('stage').dataset.bg), 'cells');
        await page.screenshot({ path: path.join(OUT, 'tpl-cells.png') });
        await page.waitForTimeout(900);
      }
      if (id === 'mindmap') await page.screenshot({ path: path.join(OUT, 'tpl-mindmap.png') });
      if (id === 'flowchart') await page.screenshot({ path: path.join(OUT, 'tpl-flowchart.png') });
      await home();
    }
    // фон «в клетку» переживает перезагрузку, а у остальных досок остаётся точечный
    await page.reload();
    await page.waitForTimeout(500);
    const bgs = [];
    for (const name of ['Squared paper', 'Квадр', 'В клетку', 'Kanban', 'Канбан']) {
      const card = await page.$(`.card:has-text("${name}")`);
      if (!card) continue;
      await card.click();
      await page.waitForTimeout(450);
      bgs.push([name, await B(() => document.getElementById('stage').dataset.bg)]);
      await home();
    }
    assert.ok(bgs.some(([, bg]) => bg === 'cells'), JSON.stringify(bgs));
    assert.ok(bgs.some(([n, bg]) => /Kanban|Канбан/.test(n) && bg === 'dots'), JSON.stringify(bgs));
    // очистка: удаляем доски, чтобы не мешать следующим шагам
    const boards = await B(async () => (await window.__board.storage.listBoards()).map((m) => m.id));
    for (const id of boards) await B((i) => window.__board.storage.deleteBoard(i), id);
    await B(() => window.__board.ui.renderHome());
    await page.waitForTimeout(300);
  });

  await step('создание доски открывает холст', async () => {
    await newBoard();
    assert.equal(await B(() => window.__board.view), 'board');
    assert.equal((await objs()).length, 0);
  });

  await step('перо: штрих с переменной толщиной от давления', async () => {
    await page.keyboard.press('p');
    await pen('mouseMoved', 500, 400, 0);
    await pen('mousePressed', 500, 400, 0.2);
    for (let i = 1; i <= 60; i++) await pen('mouseMoved', 500 + i * 6, 400 + Math.sin(i / 8) * 50, 0.1 + 0.85 * (i / 60));
    await pen('mouseReleased', 860, 400 + Math.sin(60 / 8) * 50, 0);
    const o = (await B(() => window.__board.scene.all().filter((x) => x.type === 'stroke').map((x) => ({ n: x.pts.length / 3, v: x.s.var, r0: x.pts[2], r1: x.pts[x.pts.length - 1] }))))[0];
    assert.ok(o.n > 30, 'points ' + o.n);
    assert.equal(o.v, true);
    assert.ok(o.r1 > o.r0 * 1.35, `radius should grow with pressure: ${o.r0} -> ${o.r1}`);
  });

  await step('Windows: системный след пера вызывается с цветом и толщиной штриха', async () => {
    await B(() => { window.__board.settings.inkTrail = true; window.__board.defaults.pen.size = 6; });
    await page.keyboard.press('p');
    await pen('mouseMoved', 400, 700, 0);
    await pen('mousePressed', 400, 700, 0.5);
    for (let i = 1; i <= 15; i++) await pen('mouseMoved', 400 + i * 9, 700 + i * 2, 0.5);
    await pen('mouseReleased', 535, 730, 0);
    const trail = await B(() => window.__trail.slice());
    assert.ok(trail.length >= 10, 'вызовов: ' + trail.length);
    assert.ok(trail.every((t) => t.type === 'pointermove' && t.trusted), 'только доверенные pointermove');
    const last = trail[trail.length - 1];
    assert.equal(last.color, '#1a1a1a');
    assert.ok(last.diameter > 4 && last.diameter < 14, 'диаметр ' + last.diameter);
    // выключатель в настройках работает
    await B(() => { window.__trail.length = 0; window.__board.settings.inkTrail = false; });
    await pen('mouseMoved', 400, 600, 0);
    await pen('mousePressed', 400, 600, 0.5);
    for (let i = 1; i <= 5; i++) await pen('mouseMoved', 400 + i * 9, 600, 0.5);
    await pen('mouseReleased', 445, 600, 0);
    assert.equal(await B(() => window.__trail.length), 0);
    await B(() => { window.__board.defaults.pen.size = 3; });
    // убрать эти два штриха, чтобы не мешать следующим шагам
    await B(() => { window.__board.undo(); window.__board.undo(); });
  });

  await step('ластик удаляет штрих, отмена возвращает', async () => {
    await page.keyboard.press('e');
    await drag(480, 400, 700, 400, 12);
    assert.equal((await objs()).filter((o) => o.type === 'stroke').length, 0);
    await page.keyboard.press('Control+z');
    assert.equal((await objs()).filter((o) => o.type === 'stroke').length, 1);
  });

  await step('маркер и мышь рисуют штрих постоянной толщины', async () => {
    await page.keyboard.press('m');
    await drag(300, 600, 500, 620, 10);
    const hl = await B(() => window.__board.scene.all().find((o) => o.s.hl));
    assert.ok(hl && hl.s.var === false);
  });

  let rectId;
  await step('фигура: создание перетаскиванием, затем изменение размера и поворот', async () => {
    await page.keyboard.press('r');
    await drag(900, 150, 1050, 250, 6);
    const r = (await objs()).find((o) => o.type === 'shape');
    rectId = r.id;
    assert.ok(Math.abs(r.w - 150) < 3 && Math.abs(r.h - 100) < 3, JSON.stringify(r));
    // тянем правую нижнюю ручку
    await drag(1050, 250, 1150, 330, 8);
    const r2 = (await objs()).find((o) => o.id === rectId);
    assert.ok(Math.abs(r2.w - 250) < 4 && Math.abs(r2.h - 180) < 4, JSON.stringify(r2));
    // поворот: ручка над верхним центром, тянем вправо
    const cx = r2.x + r2.w / 2, cy = r2.y + r2.h / 2;
    const cam = await B(() => ({ x: window.__board.cam.x, y: window.__board.cam.y }));
    const hx = cx - cam.x, hy = r2.y - cam.y - 28;
    await drag(hx, hy, hx + 150, hy + 100, 8);
    const r3 = (await objs()).find((o) => o.id === rectId);
    assert.ok(Math.abs(r3.rot) > 0.3, 'rot ' + r3.rot);
    await page.keyboard.press('Control+z');
    assert.equal((await objs()).find((o) => o.id === rectId).rot, 0);
  });

  await step('стикер: ввод текста, авто-размер шрифта', async () => {
    await page.keyboard.press('s');
    await page.mouse.click(300, 250);
    await page.keyboard.type('Идея: бесконечные доски');
    await page.keyboard.press('Escape');
    const st = (await objs()).find((o) => o.type === 'sticky');
    assert.equal(st.text, 'Идея: бесконечные доски');
    await B(() => { const s = window.__board.scene.all().find((o) => o.type === 'sticky'); s.text = 'очень '.repeat(60); s._fit = null; s._layout = null; });
    const size = await B(async () => { const m = await import('/render/draw.js'); return m.fitSize(window.__board.scene.all().find((o) => o.type === 'sticky')); });
    assert.ok(size < 22 && size >= 8, 'fit ' + size);
    await B(() => { const s = window.__board.scene.all().find((o) => o.type === 'sticky'); s.text = 'Идея: бесконечные доски'; s._fit = null; s._layout = null; window.__board.renderer.markScene(); });
  });

  await step('копирование и вставка через буфер, внутренний формат', async () => {
    const before = (await objs()).length;
    await B(() => { const a = window.__board; a.select([a.scene.all().find((o) => o.type === 'sticky')]); });
    const data = await B(() => {
      const dt = new DataTransfer();
      document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
      return dt.getData('application/x-board');
    });
    assert.ok(data && data.includes('sticky'));
    await B((d) => {
      const dt = new DataTransfer();
      dt.setData('application/x-board', d);
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, data);
    assert.equal((await objs()).length, before + 1);
    await B(() => window.__board.undo());
    assert.equal((await objs()).length, before);
  });

  await step('вставка обычного текста создаёт текстовый объект', async () => {
    await B(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'Вставленный текст');
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    const t = (await objs()).find((o) => o.type === 'text');
    assert.equal(t.text, 'Вставленный текст');
    await B(() => window.__board.undo());
  });

  await step('группа: общая рамка, перемещение, разгруппировка', async () => {
    await B(() => { const a = window.__board; a.select(a.scene.all().filter((o) => o.type === 'sticky' || o.type === 'shape')); a.group(); a.clearSelection(); });
    const o0 = await objs();
    const sticky = o0.find((o) => o.type === 'sticky');
    assert.ok(sticky.group);
    const cam = await B(() => ({ x: window.__board.cam.x, y: window.__board.cam.y }));
    await page.keyboard.press('v');
    await drag(sticky.x - cam.x + 20, sticky.y - cam.y + 20, sticky.x - cam.x + 20, sticky.y - cam.y + 60, 5);
    const o1 = await objs();
    const dy = o1.find((o) => o.type === 'sticky').y - sticky.y;
    const dyShape = o1.find((o) => o.type === 'shape').y - o0.find((o) => o.type === 'shape').y;
    assert.ok(Math.abs(dy - 40) < 3 && Math.abs(dyShape - 40) < 3, `dy ${dy} dyShape ${dyShape}`);
    await B(() => window.__board.ungroup());
    assert.ok(!(await objs()).some((o) => o.group));
  });

  await step('фрейм: перемещение увлекает содержимое', async () => {
    await page.keyboard.press('f');
    await drag(100, 120, 420, 340, 6);
    await page.keyboard.press('Escape'); // закончить ввод названия
    await page.keyboard.type('');
    await B(() => window.__board.endTextEdit());
    const fr = (await objs()).find((o) => o.type === 'frame');
    assert.ok(fr, 'frame');
    await B(() => { const a = window.__board; const s = a.scene.all().find((o) => o.type === 'sticky'); s.x = a.scene.all().find((o) => o.type === 'frame').x + 40; s.y = a.scene.all().find((o) => o.type === 'frame').y + 40; a.scene.touch(s); a.clearSelection(); });
    const st0 = (await objs()).find((o) => o.type === 'sticky');
    const cam = await B(() => ({ x: window.__board.cam.x, y: window.__board.cam.y }));
    // тянем за рамку (границу)
    await page.keyboard.press('v');
    await drag(fr.x - cam.x + 2, fr.y - cam.y + fr.h / 2, fr.x - cam.x + 102, fr.y - cam.y + fr.h / 2, 6);
    const st1 = (await objs()).find((o) => o.type === 'sticky');
    assert.ok(Math.abs(st1.x - st0.x - 100) < 3, `sticky moved ${st1.x - st0.x}`);
  });

  await step('коннектор по портам, следует за фигурой', async () => {
    await B(() => { const a = window.__board; a.scene.all().filter((o) => o.type === 'connector').forEach((c) => a.scene.remove(c.id)); });
    const s = (await objs()).filter((o) => o.type === 'shape' || o.type === 'sticky');
    assert.ok(s.length >= 2);
    const [a, b] = s;
    const cam = await B(() => ({ x: window.__board.cam.x, y: window.__board.cam.y, z: window.__board.cam.z }));
    await page.keyboard.press('c');
    await drag(a.x + a.w / 2 - cam.x, a.y + a.h / 2 - cam.y, b.x + b.w / 2 - cam.x, b.y + b.h / 2 - cam.y, 8);
    const c = await B(() => window.__board.scene.all().find((o) => o.type === 'connector'));
    assert.ok(c.from.id && c.to.id, JSON.stringify(c));
    const before = await B((id) => window.__board.scene.route(window.__board.scene.get(id)).pts.slice(), c.id);
    await B((toId) => { const a = window.__board; const o = a.scene.get(toId); o.x += 120; a.scene.touch(o); }, c.to.id);
    const after = await B((id) => window.__board.scene.route(window.__board.scene.get(id)).pts.slice(), c.id);
    assert.notDeepEqual(before, after);
  });

  await step('выравнивание выделенных объектов', async () => {
    await B(() => { const a = window.__board; a.setSelectionIds(a.scene.all().filter((o) => o.type === 'sticky' || o.type === 'shape').map((o) => o.id)); a.alignSelection('alignL'); });
    const xs = (await B(() => window.__board.scene.all().filter((o) => o.type === 'sticky' || o.type === 'shape').map((o) => window.__board.scene.bounds(o).x)));
    assert.ok(xs.every((x) => Math.abs(x - xs[0]) < 0.01), JSON.stringify(xs));
  });

  await step('изображение: добавление и отрисовка', async () => {
    await B(async () => {
      const cv = document.createElement('canvas'); cv.width = 120; cv.height = 80;
      const g = cv.getContext('2d'); g.fillStyle = '#e03131'; g.fillRect(0, 0, 120, 80); g.fillStyle = '#fff'; g.fillRect(20, 20, 40, 40);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      await window.__board.addImageFile(blob, { x: 100, y: 200 });
    });
    await page.waitForTimeout(400);
    const img = (await objs()).find((o) => o.type === 'image');
    assert.ok(img && img.w > 0);
    const px = await B(() => { const a = window.__board; a.renderer.renderScene(); const [sx, sy] = a.cam.toScreen(100, 200); return Array.from(a.renderer.readPixels(sx - 40, sy, 1, 1).data); });
    assert.ok(px[3] > 200, 'image pixel alpha ' + px);
  });

  await step('экспорт PNG, SVG, JSON и обратный импорт', async () => {
    const r = await B(async () => {
      const a = window.__board;
      const m = await import('/export.js');
      const objs = a.scene.all();
      const png = await m.exportPNGBlob(a, objs);
      const svg = await m.exportSVGString(a, objs);
      const json = await m.exportBoardJSON(a);
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const parsed = m.parseBoardJSON(json);
      return { png: png.size, type: png.type, svgOk: !doc.querySelector('parsererror'), paths: doc.querySelectorAll('path').length, images: doc.querySelectorAll('image').length, texts: doc.querySelectorAll('text').length, restored: parsed.objects.length, total: objs.length, assets: Object.keys(parsed.assets).length };
    });
    assert.ok(r.png > 1500 && r.type === 'image/png');
    assert.ok(r.svgOk && r.paths > 2 && r.images === 1 && r.texts >= 1, JSON.stringify(r));
    assert.equal(r.restored, r.total);
    assert.equal(r.assets, 1);
  });

  await step('экспорт PDF (запасной растровый вариант в браузере)', async () => {
    const r = await B(async () => {
      const a = window.__board;
      const m = await import('/export.js');
      const bytes = await m.exportPDFBytes(a, a.scene.all());
      const t = new TextDecoder('latin1').decode(bytes);
      return { head: t.slice(0, 8), tail: t.trimEnd().slice(-5), box: (t.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/) || []).slice(1).map(Number), size: bytes.length };
    });
    assert.equal(r.head.slice(0, 5), '%PDF-');
    assert.equal(r.tail, '%%EOF');
    assert.ok(r.box[0] > 100 && r.box[1] > 100 && r.size > 3000, JSON.stringify(r));
  });

  await step('бесконечный холст: далёкие координаты, перенос начала, пределы масштаба', async () => {
    const mark = await B(() => { const a = window.__board; const s = a.scene.all().find((o) => o.type === 'sticky'); return { id: s.id, x: s.x }; });
    // уезжаем на сто миллионов единиц от начала координат
    await B(() => { const a = window.__board; a.cam.x = 1e8; a.cam.y = -3e7; a.cameraChanged(); });
    const st = await B(() => ({ ox: window.__board.origin.x, oy: window.__board.origin.y, cx: window.__board.cam.x, cy: window.__board.cam.y }));
    assert.ok(Math.abs(st.ox - 1e8) < 2000 && Math.abs(st.oy + 3e7) < 2000, JSON.stringify(st));
    assert.ok(Math.abs(st.cx) < 2000 && Math.abs(st.cy) < 2000, 'камера вернулась к нулю: ' + JSON.stringify(st));
    await page.keyboard.press('p');
    await pen('mouseMoved', 600, 400, 0);
    await pen('mousePressed', 600, 400, 0.5);
    for (let i = 1; i < 30; i++) await pen('mouseMoved', 600 + i * 8, 400 + i * 2, 0.5);
    await pen('mouseReleased', 840, 460, 0);
    const far = await B(() => window.__board.scene.all().filter((o) => o.type === 'stroke').pop());
    assert.ok(Math.abs(far.x) < 5000 && Math.abs(far.y) < 5000, `штрих в локальных координатах: ${far.x},${far.y}`);
    // нарисованное вдали видно: на холсте есть тёмные пиксели возле линии
    const dark = await B(() => { const a = window.__board; a.renderer.renderScene(); const d = a.renderer.readPixels(650, 380, 60, 60).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++; return n; });
    assert.ok(dark > 50, 'штрих отрисован, пикселей: ' + dark);
    // возвращаемся к стикеру: он на месте с учётом накопленного сдвига
    await B(() => { const a = window.__board; a.cam.x += -1e8; a.cam.y += 3e7; a.cameraChanged(); });
    const back = await B((id) => ({ s: window.__board.scene.get(id), o: window.__board.origin }), mark.id);
    assert.ok(Math.abs(back.s.x + back.o.x - mark.x) < 1e-6, `истинная позиция стикера сохранена: ${back.s.x} + ${back.o.x} против ${mark.x}`);
    // отмена после переносов начала координат работает
    await B(() => window.__board.undo());
    assert.ok((await B(() => window.__board.scene.all().filter((o) => o.type === 'stroke').length)) >= 1);
    await B(() => { const a = window.__board; for (let i = 0; i < 60; i++) a.zoomBy(0.5); });
    assert.ok(Math.abs((await B(() => window.__board.cam.z)) - 0.02) < 1e-9);
    await B(() => { const a = window.__board; for (let i = 0; i < 60; i++) a.zoomBy(2); });
    assert.equal(await B(() => window.__board.cam.z), 32);
    await B(() => window.__board.fitContent());
  });

  await step('панорамирование: сдвиг готового слоя без перерисовки, пиксель в пиксель', async () => {
    const info = await B(async () => {
      const a = window.__board, r = a.renderer;
      const { makeShape, makeSticky } = await import('/core/scene.js');
      for (let i = 0; i < 12; i++) { const sh = makeShape(i % 2 ? 'ellipse' : 'rect', (i % 4) * 220 - 400, Math.floor(i / 4) * 160 - 250, 160, 100); sh.text = 'Ф' + i; a.scene.add(sh, true); }
      const st = makeSticky(-300, 300); st.text = 'Стикер'; a.scene.add(st, true);
      a.scene.emit('load');
      a.cam.z = 1; a.cam.x = -720; a.cam.y = -450; a.cameraChanged(true);
      r.renderScene();
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))); // дать отработать отложенным перерисовкам
      return { renders: r.stats.renders, margin: r.margin };
    });
    // небольшой сдвиг жестом: холст не перерисовывается, а смещается
    const shifted = await B(async () => {
      const a = window.__board, r = a.renderer;
      const before = r.stats.renders;
      a.panBy(-120, -70);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const moved = { renders: r.stats.renders - before, transform: r.sceneCv.style.transform, tx: r.xf.tx, ty: r.xf.ty };
      const quick = r.readPixels(0, 0, 1440, 900).data;
      r.renderScene();
      const fresh = r.readPixels(0, 0, 1440, 900).data;
      let diff = 0;
      for (let i = 0; i < quick.length; i++) if (quick[i] !== fresh[i]) diff++;
      return { moved, diff: diff / quick.length };
    });
    assert.equal(shifted.moved.renders, 0, 'перерисовки не было: ' + JSON.stringify(shifted.moved));
    // сдвиг кратен физическому пикселю: при масштабе 125% это не ровно 120 и 70 пикселей
    const mt = shifted.moved.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/);
    const dprNow = Number(process.env.DPR) || 2;
    assert.ok(mt && Math.abs(Number(mt[1]) + 120) <= 0.5 / dprNow + 1e-9 && Math.abs(Number(mt[2]) + 70) <= 0.5 / dprNow + 1e-9, shifted.moved.transform);
    // при дробном масштабе (Windows 125, 150, 175%) сдвиг округляется до физического пикселя: допускаем расхождение на краях линий
    assert.ok(shifted.diff < (Number.isInteger(dprNow) ? 0.002 : 0.02), 'сдвинутый слой совпадает с перерисованным: ' + shifted.diff);
    // большой сдвиг: запас по краям кончился, слой перерисован под новую камеру
    const far = await B(async () => {
      const a = window.__board, r = a.renderer;
      a.panBy(-900, 0);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      return { rx: r.R.x, cx: a.cam.x, tr: r.sceneCv.style.transform };
    });
    assert.equal(far.rx, far.cx);
    assert.equal(far.tr, '');
    // зум: сначала масштаб слоя, потом чёткая перерисовка
    const z = await B(async () => {
      const a = window.__board, r = a.renderer;
      a.zoomAt(700, 400, 1.3);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const during = { scaled: r.sceneCv.style.transform.includes('scale('), same: r.R.z === a.cam.z };
      await new Promise((res) => setTimeout(res, 350));
      return { during, after: { tr: r.sceneCv.style.transform, same: r.R.z === a.cam.z } };
    });
    assert.ok(z.during.scaled && !z.during.same, JSON.stringify(z));
    assert.ok(z.after.same && z.after.tr === '', JSON.stringify(z));
    await page.screenshot({ path: path.join(OUT, 'pan.png') });
  });

  await step('только перо: боковая кнопка двигает доску, масштаб перетаскиванием, ползунок', async () => {
    await page.keyboard.press('p'); // активное перо: рисовать должно только остриё без кнопки
    const strokes0 = await B(() => window.__board.scene.all().filter((o) => o.type === 'stroke').length);
    const cam0 = await B(() => ({ x: window.__board.cam.x, y: window.__board.cam.y, z: window.__board.cam.z }));
    // Боковая кнопка зажата в воздухе (pointerdown с button=2), затем перо касается и ведёт: buttons = 2 или 3
    const penB = (type, x, y, buttons, button = 'left') => cdp.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, pointerType: 'pen', force: 0.5, clickCount: 1 });
    await penB('mouseMoved', 600, 400, 0, 'none');
    await penB('mousePressed', 600, 400, 2, 'right');
    for (let i = 1; i <= 10; i++) await penB('mouseMoved', 600 + i * 10, 400 + i * 5, i > 5 ? 3 : 2, 'right');
    await penB('mouseReleased', 700, 450, 0, 'right');
    const cam1 = await B(() => ({ x: window.__board.cam.x, y: window.__board.cam.y }));
    assert.ok(Math.abs(cam1.x - (cam0.x - 100 / cam0.z)) < 1e-6 && Math.abs(cam1.y - (cam0.y - 50 / cam0.z)) < 1e-6, JSON.stringify([cam0, cam1]));
    assert.equal(await B(() => window.__board.scene.all().filter((o) => o.type === 'stroke').length), strokes0, 'кнопка пера не должна рисовать');
    // масштаб: удерживаем Z и ведём пером вверх
    const z0 = await B(() => window.__board.cam.z);
    await page.keyboard.down('KeyZ');
    await penB('mouseMoved', 700, 450, 0, 'none');
    await penB('mousePressed', 700, 450, 1);
    for (let i = 1; i <= 10; i++) await penB('mouseMoved', 700, 450 - i * 10, 1);
    await penB('mouseReleased', 700, 350, 0);
    await page.keyboard.up('KeyZ');
    const z1 = await B(() => window.__board.cam.z);
    assert.ok(z1 > z0 * 1.8, `приближение пером: ${z0} -> ${z1}`);
    assert.equal(await B(() => window.__board.scene.all().filter((o) => o.type === 'stroke').length), strokes0, 'масштабирование не рисует');
    // Пробел + Ctrl и движение вниз отдаляет
    // события мыши через CDP не знают о нажатых клавишах, поэтому модификатор Ctrl (2) передаём явно
    const penC = (type, x, y, buttons, button = 'left') => cdp.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, modifiers: 2, pointerType: 'pen', force: 0.5, clickCount: 1 });
    await page.keyboard.down('Control'); await page.keyboard.down('Space');
    await penC('mouseMoved', 700, 450, 0, 'none');
    await penC('mousePressed', 700, 450, 1);
    for (let i = 1; i <= 10; i++) await penC('mouseMoved', 700, 450 + i * 10, 1);
    await penC('mouseReleased', 700, 550, 0);
    await page.keyboard.up('Space'); await page.keyboard.up('Control');
    const z2 = await B(() => window.__board.cam.z);
    assert.ok(z2 < z1 * 0.7, `отдаление: ${z1} -> ${z2}`);
    // ползунок масштаба
    await B(() => { const sl = document.querySelector('.zoom-range'); sl.value = String(Math.log(2)); sl.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(80);
    assert.ok(Math.abs((await B(() => window.__board.cam.z)) - 2) < 0.02); // ползунок шагает по логарифмической сетке
    assert.equal(await B(() => document.querySelector('.zoom-label').textContent), '200%');
    // русская раскладка: «з» на физической клавише P включает перо, «в» на D остаётся только с ⌘
    await page.keyboard.press('v');
    await B(() => window.__board.onKey({ code: 'KeyP', key: 'з', metaKey: false, ctrlKey: false, altKey: false, preventDefault() {} }));
    assert.equal(await B(() => window.__board.toolName), 'pen');
    await B(() => { window.__board.cam.z = 1; window.__board.cameraChanged(true); });
  });

  await step('мини-карта: чёткая, ведёт к объекту по клику, не ужимается из-за одиночного выброса', async () => {
    const r = await B(async () => {
      const a = window.__board, ui = a.ui;
      const { makeShape } = await import('/core/scene.js');
      a.scene.load([]);
      // кластер из 80 объектов и один далёкий выброс
      for (let i = 0; i < 80; i++) a.scene.add(makeShape('rect', (i % 10) * 160, Math.floor(i / 10) * 120, 120, 80), true);
      const far = makeShape('rect', 60000, 40000, 120, 80); a.scene.add(far, true);
      a.scene.emit('load');
      a.cam.z = 0.5; a.cam.x = 0; a.cam.y = 0; a.cameraChanged(true);
      ui.drawMinimap();
      const objs = a.scene.all();
      const view = a.cam.viewRect();
      const region = ui.mapRegion(objs, view);
      const full = a.scene.boundsOf(objs);
      const dpr = window.devicePixelRatio || 1;
      return { trimmedW: region.x1 - region.x0, fullW: full.w, backing: ui.miniCv.width, expect: Math.round(200 * dpr), css: ui.miniCv.clientWidth };
    });
    assert.ok(r.trimmedW < r.fullW * 0.1, `одиночный выброс не должен ужимать карту: ${r.trimmedW} против ${r.fullW}`);
    assert.equal(r.backing, r.expect, 'холст карты с учётом плотности пикселей');
    assert.equal(r.css, 200);
    // клик по карте переносит центр вида в эту точку
    const target = await B(() => {
      const a = window.__board, ui = a.ui;
      ui.drawMinimap();
      const wx = 700, wy = 400; // центр кластера
      const rect = ui.miniCv.getBoundingClientRect();
      return { x: rect.left + wx * ui.mapT.k + ui.mapT.ox, y: rect.top + wy * ui.mapT.k + ui.mapT.oy, wx, wy };
    });
    await page.mouse.click(target.x, target.y);
    const center = await B(() => { const a = window.__board; return a.cam.toWorld(a.cam.w / 2, a.cam.h / 2); });
    assert.ok(Math.abs(center[0] - target.wx) < 60 && Math.abs(center[1] - target.wy) < 60, `центр вида ${center} вместо ${[target.wx, target.wy]}`);
    // на карте нарисовано содержимое: есть непрозрачные цветные пиксели помимо фона
    const colored = await B(() => { const cv = window.__board.ui.miniCv; const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; const bg = [d[0], d[1], d[2]]; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 40) n++; return n; });
    assert.ok(colored > 300, 'на карте видно содержимое: ' + colored);
  });

  await step('колесо: масштаб вокруг курсора и панорамирование трекпадом', async () => {
    await B(() => { const a = window.__board; a.cam.z = 1; a.cam.x = 0; a.cam.y = 0; a.cameraChanged(); });
    const w0 = await B(() => window.__board.cam.toWorld(700, 400));
    await page.mouse.move(700, 400);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    const st = await B(() => ({ z: window.__board.cam.z, w: window.__board.cam.toWorld(700, 400) }));
    assert.ok(st.z > 1);
    assert.ok(Math.abs(st.w[0] - w0[0]) < 1e-6 && Math.abs(st.w[1] - w0[1]) < 1e-6);
    const x0 = await B(() => window.__board.cam.x);
    await page.mouse.wheel(40, 0);
    assert.ok((await B(() => window.__board.cam.x)) !== x0);
  });

  await step('несколько досок: список, переименование, копия, удаление, сохранение', async () => {
    await page.waitForTimeout(900);
    await home();
    await newBoard();
    await home();
    await newBoard();
    await home();
    let cards = await page.$$('.card:not(.new)');
    assert.equal(cards.length, 3);
    // переименование
    await cards[0].hover();
    await (await cards[0].$('.more')).click();
    await page.click('.menu >> text=Переименовать').catch(() => page.click('.menu >> text=Rename'));
    await page.keyboard.type('Планирование');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    assert.ok((await page.textContent('.cards')).includes('Планирование'));
    // дублирование
    cards = await page.$$('.card:not(.new)');
    await (await cards[0].$('.more')).click();
    await page.click('.menu button:nth-child(2)');
    await page.waitForTimeout(400);
    assert.equal((await page.$$('.card:not(.new)')).length, 4);
    // удаление
    const copyCard = await page.$('.card:has-text("(copy)")');
    await (await copyCard.$('.more')).click();
    await page.click('.menu .danger');
    await page.waitForTimeout(400);
    assert.equal((await page.$$('.card:not(.new)')).length, 3);
    // открыть доску с данными: у первой созданной доски есть объекты
    const counts = [];
    for (let i = 0; i < 3; i++) {
      await (await page.$$('.card:not(.new)'))[i].click();
      await page.waitForTimeout(500);
      counts.push(await B(() => window.__board.scene.all().length));
      await home();
    }
    assert.ok(counts.some((n) => n > 5), 'одна из досок хранит объекты: ' + counts);
  });

  await step('вид доски: цвет фона и цвет линий меняются отдельно, сохраняются и попадают в экспорт', async () => {
    await (await page.$$('.card:not(.new)'))[0].click();
    await page.waitForTimeout(400);
    const css = () => B(() => { const st = document.getElementById('stage'); return { bg: getComputedStyle(st).backgroundColor, dot: window.__board.gridColor(st.dataset.bg), style: st.dataset.bg }; });
    const base = await css();
    await page.click('.bg-btn');
    await page.click('.look .swatches >> nth=0 >> .sw[title="#fff8e1"]');
    let c = await css();
    assert.equal(c.bg, 'rgb(255, 248, 225)');
    assert.equal(c.dot, base.dot, 'цвет линий не затронут');
    await page.click('.look .swatches >> nth=1 >> .sw[title="#e03131"]');
    c = await css();
    assert.equal(c.bg, 'rgb(255, 248, 225)', 'цвет фона не затронут');
    assert.ok(c.dot.startsWith('rgba(224, 49, 49'), c.dot);
    await page.click('.look .seg button:nth-child(2)');
    assert.equal((await css()).style, 'grid');
    // экспорт использует цвет фона доски
    const px = await B(async () => {
      const a = window.__board;
      if (!a.scene.all().length) { const m = await import('/core/scene.js'); a.scene.add(m.makeShape('rect', 0, 0, 100, 60)); }
      const m = await import('/export.js');
      const bmp = await createImageBitmap(await m.exportPNGBlob(a, a.scene.all()));
      const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
      const g = cv.getContext('2d'); g.drawImage(bmp, 0, 0);
      return Array.from(g.getImageData(2, 2, 1, 1).data);
    });
    assert.deepEqual(px.slice(0, 3), [255, 248, 225]);
    await page.waitForTimeout(1200);
    await page.reload();
    await page.waitForTimeout(500);
    await (await page.$$('.card:not(.new)'))[0].click();
    await page.waitForTimeout(450);
    c = await css();
    assert.equal(c.bg, 'rgb(255, 248, 225)');
    assert.ok(c.dot.startsWith('rgba(224, 49, 49') && c.style === 'grid', JSON.stringify(c));
    await page.screenshot({ path: path.join(OUT, 'look.png') });
    // сброс возвращает стандартные цвета
    await page.click('.bg-btn');
    await page.click('.look .reset');
    c = await css();
    assert.ok(/60, 70, 90/.test(c.dot), c.dot);
    assert.notEqual(c.bg, 'rgb(255, 248, 225)');
    await page.keyboard.press('Escape');
    await home();
  });

  await step('цветовые схемы доски и авто-цвет пера', async () => {
    await (await page.$$('.card:not(.new)'))[0].click();
    await page.waitForTimeout(400);
    const st = () => B(() => { const a = window.__board; return { pen: a.defaults.pen.color, text: a.defaults.textColor, dark: a.dark, bg: getComputedStyle(document.getElementById('stage')).backgroundColor, dot: window.__board.gridColor(window.__board.boardStyle()) }; });
    assert.equal((await st()).pen, '#1a1a1a');
    await page.click('.bg-btn');
    await page.click('.look-chip[data-look="chalk"]');
    let c = await st();
    assert.equal(c.bg, 'rgb(47, 74, 63)');
    assert.equal(c.dark, true);
    assert.equal(c.pen, '#f1f3f5', 'перо стало светлым');
    assert.equal(c.text, '#f1f3f5');
    // новый штрих рисуется светлым цветом
    await page.keyboard.press('Escape');
    await page.keyboard.press('p');
    await pen('mouseMoved', 500, 300, 0); await pen('mousePressed', 500, 300, 0.5);
    for (let i = 1; i < 20; i++) await pen('mouseMoved', 500 + i * 6, 300 + i, 0.5);
    await pen('mouseReleased', 620, 320, 0);
    const col = await B(() => window.__board.scene.all().filter((o) => o.type === 'stroke').pop().s.color);
    assert.equal(col, '#f1f3f5');
    await page.screenshot({ path: path.join(OUT, 'look-chalk.png') });
    // выбранный вручную цвет сохраняется при смене схемы
    await B(() => { window.__board.defaults.pen.color = '#e03131'; });
    await page.click('.bg-btn');
    await page.click('.look-chip[data-look="paper"]');
    c = await st();
    assert.equal(c.dark, false);
    assert.equal(c.pen, '#e03131', 'ручной цвет не тронут');
    assert.equal(c.text, '#1a1a1a', 'текст вернулся к тёмному');
    // чертёж включает сетку; стандарт сбрасывает цвета
    await page.click('.look-chip[data-look="blueprint"]');
    assert.equal(await B(() => document.getElementById('stage').dataset.bg), 'grid');
    await page.click('.look-chip[data-look="default"]');
    c = await st();
    assert.ok(/60, 70, 90/.test(c.dot), c.dot);
    await B(() => { window.__board.defaults.pen.color = '#1a1a1a'; });
    await page.keyboard.press('Escape');
    await home();
  });

  await step('перезагрузка сохраняет доски и объекты', async () => {
    await page.reload();
    await page.waitForTimeout(500);
    const cards = await page.$$('.card:not(.new)');
    assert.equal(cards.length, 3);
    let max = 0;
    for (let i = 0; i < cards.length; i++) {
      await (await page.$$('.card:not(.new)'))[i].click();
      await page.waitForTimeout(500);
      max = Math.max(max, await B(() => window.__board.scene.all().length));
      await home();
    }
    assert.ok(max > 5, 'objects restored ' + max);
  });

  await step('замер задержки: событие пера до отрисовки', async () => {
    await (await page.$$('.card:not(.new)'))[0].click();
    await page.waitForTimeout(400);
    await B(() => { window.__board.settings.diag = true; });
    await page.keyboard.press('p');
    await pen('mouseMoved', 300, 700, 0);
    await pen('mousePressed', 300, 700, 0.5);
    const lat = [];
    for (let i = 1; i <= 120; i++) {
      await pen('mouseMoved', 300 + i * 8, 700 + Math.sin(i / 10) * 80, 0.6);
      if (i % 10 === 0) lat.push(await B(() => window.__board.diag.inputToDraw));
    }
    await pen('mouseReleased', 1260, 700, 0);
    console.log('     input→draw (мс, headless, без GPU):', lat.map((v) => v.toFixed(1)).join(' '));
    const warm = lat.slice(2).sort((a, b) => a - b);
    const median = warm[warm.length >> 1];
    assert.ok(median < 30, 'median latency ' + median); // один кадр при 60 Гц это 16.7 мс
    await page.screenshot({ path: path.join(OUT, 'final.png') });
  });

  console.log(errors.length ? 'Ошибки консоли:\n' + errors.join('\n') : 'Ошибок консоли нет');
  if (errors.length) process.exitCode = 1;
  console.log(`${passed} шагов пройдено`);
  await browser.close();
  server.close();
})();
