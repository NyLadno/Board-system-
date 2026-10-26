import { Camera } from './core/camera.js';
import { Scene, STICKY_COLORS, makeText, serializeObj } from './core/scene.js';
import { History } from './core/history.js';
import { Storage } from './core/storage.js';
import { Renderer } from './render/renderer.js';
import { Input } from './input.js';
import { PenTool } from './tools/pen.js';
import { EraserTool } from './tools/eraser.js';
import { SelectTool, drawSelectionOverlay } from './tools/select.js';
import { ShapeTool, FrameTool, StickyTool, TextTool, ConnectorTool, HandTool } from './tools/create.js';
import { TextEditor } from './ui/textedit.js';
import { UI } from './ui/ui.js';
import { setLang, detectLang, t } from './i18n.js';
import { uid, debounce, download } from './core/util.js';
import { textObjectHeight } from './render/draw.js';
import { isDarkColor, INK_ON_DARK, INK_ON_LIGHT } from './looks.js';
import { PALETTE } from './core/scene.js';
import { exportPNGBlob, exportSVGString, exportPDFBytes, exportBoardJSON, parseBoardJSON } from './export.js';

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const DEFAULT_SETTINGS = {
  pressure: 0.8,
  smoothing: 0,
  predictMs: 16,
  browserPrediction: true,
  palmRejection: true,
  touchDraw: false,
  theme: 'auto',
  bg: 'dots',
  wheel: 'zoom',
  lang: detectLang(),
  diag: false,
  minimap: true,
};

const DEFAULT_TOOLS = {
  pen: { color: '#1a1a1a', size: 3 },
  hl: { color: '#f5d90a', size: 18 },
  eraserSize: 28,
  shape: 'rect',
  shapeFill: '#ffffff',
  shapeStroke: '#1a1a1a',
  stickyColor: STICKY_COLORS[0],
  stickySize: 180,
  connKind: 'elbow',
  connHead: true,
  connColor: '#1a1a1a',
  textColor: '#1a1a1a',
};

function loadJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ? { ...fallback, ...v } : { ...fallback };
  } catch { return { ...fallback }; }
}

export class App {
  constructor() {
    this.storage = new Storage();
    this.boardAPI = window.boardAPI || null;
    this.scene = new Scene();
    this.cam = new Camera();
    this.history = new History(this.scene);
    this.settings = loadJSON('board.settings', DEFAULT_SETTINGS);
    this.defaults = loadJSON('board.defaults', DEFAULT_TOOLS);
    this.defaults.pen = { ...DEFAULT_TOOLS.pen, ...this.defaults.pen };
    this.defaults.hl = { ...DEFAULT_TOOLS.hl, ...this.defaults.hl };
    setLang(this.settings.lang);
    this.selection = new Set();
    this.hoverId = null;
    this.editingId = null;
    this.hiddenIds = null;
    this.interacting = false;
    this.dark = false;
    this.meta = null;
    this.view = 'home';
    this.origin = { x: 0, y: 0 };
    this.boardBg = null;
    this.boardBgColor = null;
    this.boardLineColor = null;
    this.toolName = 'select';
    this.lastDrawTool = 'pen';
    this.diag = { inputToDraw: 0 };
    this.clip = null;
    this.saveSoon = debounce(() => this.saveNow(), 700);
    this.saveCamSoon = debounce(() => this.saveNow(), 2500);
    this.saveDefaults = debounce(() => localStorage.setItem('board.defaults', JSON.stringify(this.defaults)), 300);
  }

  async init() {
    const root = document.getElementById('app');
    this.root = root;
    this.stage = document.getElementById('stage');
    this.renderer = new Renderer(this, this.stage);
    this.input = new Input(this, this.stage);
    this.tools = {
      select: new SelectTool(this),
      hand: new HandTool(this),
      pen: new PenTool(this, 'pen'),
      hl: new PenTool(this, 'hl'),
      eraser: new EraserTool(this),
      shape: new ShapeTool(this),
      frame: new FrameTool(this),
      sticky: new StickyTool(this),
      text: new TextTool(this),
      connector: new ConnectorTool(this),
    };
    this.tool = this.tools.select;
    this.textEditor = new TextEditor(this, document.getElementById('textLayer'));
    this.ui = new UI(this);
    this.renderer.onFrame = () => this.ui.frame();
    this.applyTheme();
    this.applyBackground();
    this.bindGlobal();
    this.scene.on((kind) => this.onSceneEvent(kind));
    this.history.onChange(() => this.ui.updateHistory());
    window.__board = this; // для тестов и отладки
    await this.ui.showHome();
  }

  // ---------- сцена и сохранение ----------
  onSceneEvent(kind) {
    this.renderer.markScene();
    this.clearDeadSelection();
    this.touched();
  }

  // Содержимое изменилось: автосохранение и обновление интерфейса (без перерисовки сцены)
  touched() {
    if (!this.meta) return;
    this.dirty = true;
    this.contentDirty = true;
    this.saveSoon();
    this.ui.contentChanged();
    this.renderer.markUI();
  }

  // Идёт интерактивное изменение (перетаскивание/трансформация): перерисовать сцену и интерфейс
  moved() {
    this.renderer.markScene();
    this.renderer.markUI();
  }

  async saveNow() {
    if (!this.meta || !this.dirty) return;
    // не мешаем рисованию: сериализация большой доски занимает заметное время
    if (this.interacting && !this.forceSave) { this.saveSoon(); return; }
    this.dirty = false;
    const bump = this.contentDirty;
    this.contentDirty = false;
    try {
      const json = this.scene.toJSONString({ camera: this.cam.toJSON(), origin: this.origin, bg: this.boardBg, bgColor: this.boardBgColor, lineColor: this.boardLineColor });
      await this.storage.saveBoard(this.meta.id, json, bump);
    } catch (e) {
      this.dirty = true;
      this.contentDirty = this.contentDirty || bump;
      console.error('save failed', e);
    }
  }

  async saveThumb() {
    if (!this.meta) return;
    const thumb = this.makeThumb();
    if (thumb !== undefined) await this.storage.patchMeta(this.meta.id, { thumb });
  }

  makeThumb() {
    const objs = this.scene.all();
    const W = 480, H = 300;
    if (!objs.length) return null;
    const b = this.scene.boundsOf(objs);
    const pad = Math.max(b.w, b.h) * 0.06 + 10;
    const rect = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    const scale = Math.min(W / rect.w, H / rect.h);
    const cv = this.renderer.renderToCanvas(objs, rect, scale, { background: this.boardBgColor || '#ffffff' });
    return cv.toDataURL('image/jpeg', 0.72);
  }

  async openBoard(id) {
    await this.closeBoard();
    const { meta, data } = await this.storage.loadBoard(id);
    if (!meta) throw new Error('board not found');
    this.meta = meta;
    this.selection.clear();
    this.scene.load(data.objects || []);
    this.origin = data.origin ? { x: data.origin.x || 0, y: data.origin.y || 0 } : { x: 0, y: 0 };
    this.boardBg = ['dots', 'grid', 'cells', 'none'].includes(data.bg) ? data.bg : null;
    this.boardBgColor = /^#[0-9a-f]{6}$/i.test(data.bgColor) ? data.bgColor : null;
    this.boardLineColor = /^#[0-9a-f]{6}$/i.test(data.lineColor) ? data.lineColor : null;
    this.syncInk();
    this.history.clear();
    this.cam.w = this.stage.clientWidth;
    this.cam.h = this.stage.clientHeight;
    if (data.camera) this.cam.load(data.camera);
    else this.fitContent();
    this.dirty = false;
    this.contentDirty = false;
    this.setTool('select');
    this.cameraChanged(true);
    this.renderer.markScene();
    this.view = 'board';
  }

  async closeBoard() {
    if (!this.meta) return;
    this.endTextEdit();
    this.saveSoon.cancel();
    this.saveCamSoon.cancel();
    const changed = this.contentDirty;
    this.forceSave = true;
    await this.saveNow();
    this.forceSave = false;
    if (changed || !this.meta.thumb) await this.saveThumb();
    this.meta = null;
    this.scene.load([]);
    this.selection.clear();
  }

  // ---------- камера ----------
  panBy(dx, dy) {
    this.cam.panBy(dx, dy);
    this.cameraChanged();
  }

  zoomAt(sx, sy, f) {
    this.cam.zoomAt(sx, sy, f);
    this.cameraChanged();
  }

  zoomBy(f) { this.zoomAt(this.cam.w / 2, this.cam.h / 2, f); }

  cameraChanged(immediate) {
    this.renderer.markCamera();
    if (this.toolName === 'pen' || this.toolName === 'hl') this.input.updateCursor();
    this.applyBackground();
    this.textEditor.position();
    this.ui.cameraChanged();
    if (this.meta && !immediate) { this.dirty = true; this.saveCamSoon(); }
    this.rebaseIfNeeded();
  }

  // Бесконечность без потери точности. GPU считает координаты в float32, поэтому далеко от (0,0)
  // линии начинают «дрожать» и ломаться. Когда центр вида уходит от начала координат дальше,
  // чем на ~2e5 пикселей экрана, сдвигаем всё содержимое и камеру так, чтобы вид снова был около нуля.
  // Картинка при этом не меняется. this.origin хранит накопленный сдвиг, то есть истинную позицию.
  rebaseIfNeeded(force = false) {
    if (this.view !== 'board' || !this.meta) return false;
    if (this.interacting || this.isEditingText()) return false;
    const cam = this.cam;
    const cx = cam.x + cam.w / 2 / cam.z;
    const cy = cam.y + cam.h / 2 / cam.z;
    if (!force && Math.hypot(cx, cy) * cam.z < 2e5) return false;
    const dx = Math.round(cx / 1024) * 1024;
    const dy = Math.round(cy / 1024) * 1024;
    if (!dx && !dy) return false;
    this.scene.shiftAll(dx, dy);
    this.history.shiftAll(dx, dy);
    cam.x -= dx;
    cam.y -= dy;
    this.origin.x += dx;
    this.origin.y += dy;
    if (this.hoverPos) { this.hoverPos.wx -= dx; this.hoverPos.wy -= dy; }
    this.renderer.cacheCam = null;
    this.renderer.markScene();
    this.applyBackground();
    this.textEditor.position();
    this.dirty = true;
    this.saveCamSoon();
    return true;
  }

  afterInteraction() { this.rebaseIfNeeded(); }

  fitContent() {
    const objs = this.scene.all();
    const b = objs.length ? this.scene.boundsOf(objs) : null;
    this.cam.fit(b, 90, 1.5);
    if (this.view === 'board') this.cameraChanged();
  }

  fitSelection() {
    const sel = this.selectedObjs();
    if (!sel.length) return this.fitContent();
    this.cam.fit(this.scene.boundsOf(sel), 120, 2);
    this.cameraChanged();
  }

  zoomTo(z) {
    this.cam.setZoomCentered(z);
    this.cameraChanged();
  }

  applyBackground() {
    const st = this.stage.style;
    const cam = this.cam;
    let step = 24 * cam.z;
    while (step < 14) step *= 2;
    st.setProperty('--gs', step + 'px');
    st.setProperty('--gx', ((-cam.x * cam.z) % step) + 'px');
    st.setProperty('--gy', ((-cam.y * cam.z) % step) + 'px');
    this.stage.dataset.bg = this.boardBg || this.settings.bg;
    // свои цвета переопределяют значения из таблицы стилей; null возвращает стандартные
    const bg = this.boardBgColor, line = this.boardLineColor;
    if (bg) st.setProperty('--board', bg); else st.removeProperty('--board');
    if (line) {
      const style = this.stage.dataset.bg;
      st.setProperty('--dot', hexToRgba(line, style === 'dots' ? 0.6 : 0.4));
    } else if (this.dark) st.setProperty('--dot', 'rgba(255, 255, 255, 0.22)');
    else st.removeProperty('--dot');
  }

  applyTheme() {
    const th = this.settings.theme;
    const dark = th === 'dark' || (th === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  // Палитра перьев и текста: на тёмной доске вместо чёрного первым идёт светлый
  palette() { return this.dark ? [INK_ON_DARK, ...PALETTE.slice(1)] : PALETTE; }

  // Авто-цвет: нейтральные цвета по умолчанию (чёрный или белый) подстраиваются под яркость фона.
  // Цвета, выбранные пользователем вручную, не трогаются.
  syncInk() {
    const dark = !!this.boardBgColor && isDarkColor(this.boardBgColor);
    const darkChanged = dark !== this.dark;
    this.dark = dark;
    const from = dark ? INK_ON_LIGHT : INK_ON_DARK;
    const to = dark ? INK_ON_DARK : INK_ON_LIGHT;
    const d = this.defaults;
    let changed = false;
    for (const [o, k] of [[d.pen, 'color'], [d, 'textColor'], [d, 'connColor']]) {
      if (o[k] === from) { o[k] = to; changed = true; }
    }
    if (changed) {
      this.saveDefaults();
      this._cursorKey = null;
      this.input?.updateCursor();
      this.ui?.buildOptions();
    }
    if (darkChanged) this.renderer?.markScene();
  }

  // Вид доски: стиль фона, цвет фона и цвет линий. undefined не трогает поле, null сбрасывает к стандартному.
  setBoardLook({ bg, bgColor, lineColor }) {
    if (bg !== undefined) this.boardBg = bg;
    if (bgColor !== undefined) this.boardBgColor = bgColor;
    if (lineColor !== undefined) this.boardLineColor = lineColor;
    this.dirty = true;
    this.saveSoon();
    this.syncInk();
    this.applyBackground();
  }

  saveSettings() {
    localStorage.setItem('board.settings', JSON.stringify(this.settings));
    setLang(this.settings.lang);
    this.applyTheme();
    this.applyBackground();
    this.ui.settingsChanged();
  }

  // ---------- выделение ----------
  selectedObjs() {
    const out = [];
    for (const id of this.selection) {
      const o = this.scene.get(id);
      if (o) out.push(o);
    }
    return out;
  }

  single() {
    if (this.selection.size !== 1) return null;
    return this.scene.get(this.selection.values().next().value) || null;
  }

  isSelected(o) { return this.selection.has(o.id); }

  select(objs, add = false) {
    if (!add) this.selection.clear();
    for (const o of objs) for (const g of this.scene.groupMembers(o)) this.selection.add(g.id);
    this.selectionChanged();
  }

  deselect(objs) {
    for (const o of objs) for (const g of this.scene.groupMembers(o)) this.selection.delete(g.id);
    this.selectionChanged();
  }

  setSelectionIds(ids) {
    this.selection = new Set(ids);
    this.selectionChanged();
  }

  clearSelection() {
    if (!this.selection.size) return;
    this.selection.clear();
    this.selectionChanged();
  }

  clearDeadSelection() {
    let changed = false;
    for (const id of this.selection) if (!this.scene.get(id)) { this.selection.delete(id); changed = true; }
    if (this.hoverId && !this.scene.get(this.hoverId)) this.hoverId = null;
    if (changed) this.selectionChanged();
  }

  selectionChanged() {
    this.renderer.markUI();
    this.ui.selectionChanged();
  }

  setHover(id) {
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.renderer.markUI();
  }

  // ---------- инструменты ----------
  setTool(name) {
    if (!this.tools[name]) return;
    this.endTextEdit();
    this.tool.deactivate?.();
    this.tool.cancel?.();
    this.tool = this.tools[name];
    this.toolName = name;
    if (name === 'pen' || name === 'hl' || name === 'eraser') this.lastDrawTool = name;
    if (name !== 'select' && name !== 'hand') this.clearSelection();
    this.input.updateCursor();
    this.renderer.markUI();
    this.ui.toolChanged();
  }

  // Курсор-кружок размера кисти: системный курсор не имеет задержки, в отличие от рисуемого вручную
  brushCursor(kind) {
    const z = this.cam.z;
    const d = kind === 'eraser' ? this.defaults.eraserSize : (kind === 'hl' ? this.defaults.hl.size : this.defaults.pen.size) * z;
    const size = Math.max(6, Math.min(120, Math.round(kind === 'eraser' ? d : d)));
    const key = `${kind}:${size}:${kind === 'hl' ? this.defaults.hl.color : kind === 'pen' ? this.defaults.pen.color : ''}`;
    if (this._cursorKey === key) return this._cursor;
    const c = size / 2 + 2;
    const s = Math.ceil(size + 4);
    const color = kind === 'pen' ? this.defaults.pen.color : kind === 'hl' ? this.defaults.hl.color : '#555';
    const body = kind === 'eraser'
      ? `<circle cx="${c}" cy="${c}" r="${size / 2}" fill="rgba(255,255,255,.35)" stroke="#333" stroke-width="1.2"/>`
      : size <= 14
        ? `<circle cx="${c}" cy="${c}" r="${Math.max(1.5, size / 2)}" fill="${color}" stroke="#fff" stroke-width="1"/>`
        : `<circle cx="${c}" cy="${c}" r="${size / 2}" fill="${color}" fill-opacity=".35" stroke="${color}" stroke-width="1"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">${body}</svg>`;
    this._cursor = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`;
    this._cursorKey = key;
    return this._cursor;
  }

  // ---------- текст ----------
  canEditText(o) {
    return o.type === 'shape' || o.type === 'sticky' || o.type === 'text' || o.type === 'frame';
  }

  beginTextEdit(o, opts) {
    if (o.locked || !this.canEditText(o)) return;
    this.textEditor.begin(o, opts);
  }

  endTextEdit() { if (this.textEditor.active) this.textEditor.end(); }
  isEditingText() { return this.textEditor && this.textEditor.active; }

  createTextAt(wx, wy) {
    const o = makeText(wx, wy - 14);
    o.ts.color = this.defaults.textColor;
    const tx = this.history.begin();
    this.scene.add(o, true);
    tx.add(o);
    tx.commit();
    this.select([o]);
    this.touched();
    this.renderer.markScene();
    this.beginTextEdit(o, { fresh: true });
  }

  // ---------- команды над объектами ----------
  expandWithConnectors(objs) {
    const ids = new Set(objs.map((o) => o.id));
    const out = [...objs];
    for (const cid of this.scene.connectors) {
      const c = this.scene.get(cid);
      if (!c || ids.has(c.id)) continue;
      if (c.from.id && c.to.id && ids.has(c.from.id) && ids.has(c.to.id)) out.push(c);
    }
    return out;
  }

  // Снимок набора для копирования: привязки к объектам вне набора превращаются в свободные точки
  snapshotFor(objs) {
    const list = this.expandWithConnectors(objs);
    const ids = new Set(list.map((o) => o.id));
    return list.map((o) => {
      const snap = serializeObj(o);
      if (o.type === 'connector') {
        const r = this.scene.route(o);
        const n = r.pts.length;
        if (o.from.id && !ids.has(o.from.id)) snap.from = { x: r.pts[0], y: r.pts[1] };
        if (o.to.id && !ids.has(o.to.id)) snap.to = { x: r.pts[n - 2], y: r.pts[n - 1] };
      }
      return snap;
    });
  }

  // Вставляет снимки в сцену с новыми id и смещением; возвращает созданные объекты
  cloneObjects(objs, dx, dy, tx, snapshots) {
    const src = snapshots || this.snapshotFor(objs);
    const idMap = new Map();
    const groupMap = new Map();
    for (const s of src) idMap.set(s.id, uid());
    const copies = [];
    const sorted = [...src].sort((a, b) => a.z - b.z);
    for (const s of sorted) {
      const o = structuredClone(s);
      o.id = idMap.get(s.id);
      o.z = this.scene.nextZ();
      if (o.group) {
        if (!groupMap.has(o.group)) groupMap.set(o.group, uid());
        o.group = groupMap.get(o.group);
      }
      if (o.type === 'connector') {
        for (const k of ['from', 'to']) {
          const e = o[k];
          if (e.id && idMap.has(e.id)) e.id = idMap.get(e.id);
          else if (!e.id) { e.x += dx; e.y += dy; }
        }
      } else {
        o.x += dx; o.y += dy;
        if (o.type === 'stroke') for (let i = 0; i < o.pts.length; i += 3) { o.pts[i] += dx; o.pts[i + 1] += dy; }
      }
      this.scene.add(o, true);
      tx.add(o);
      copies.push(o);
    }
    this.scene.reorder();
    return copies;
  }

  deleteSelection() {
    const sel = this.selectedObjs().filter((o) => !o.locked);
    if (!sel.length) return;
    const tx = this.history.begin();
    // коннекторы, привязанные к удаляемым объектам, тоже меняются
    for (const cid of this.scene.connectors) {
      const c = this.scene.get(cid);
      if (c && sel.some((o) => o.id === c.from.id || o.id === c.to.id)) tx.track(c);
    }
    for (const o of sel) { tx.del(o); this.scene.remove(o.id, true); }
    tx.commit();
    this.selection.clear();
    this.scene.emit('remove');
    this.selectionChanged();
  }

  duplicateSelection() {
    const sel = this.selectedObjs();
    if (!sel.length) return;
    const tx = this.history.begin();
    const off = 24 / Math.max(this.cam.z, 0.25);
    const copies = this.cloneObjects(sel, off, off, tx);
    tx.commit();
    this.select(copies);
    this.scene.emit('add');
  }

  copySelection(cut) {
    const sel = this.selectedObjs();
    if (!sel.length) return false;
    const list = this.snapshotFor(sel);
    this.clip = list;
    this.clipText = sel.map((o) => o.text || o.title || '').filter(Boolean).join('\n');
    if (cut) this.deleteSelection();
    return true;
  }

  pasteObjects(list, at) {
    if (!list || !list.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of list) {
      if (o.type === 'connector') continue;
      x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y);
      x1 = Math.max(x1, o.x + o.w); y1 = Math.max(y1, o.y + o.h);
    }
    if (x0 === Infinity) { x0 = y0 = 0; x1 = y1 = 0; }
    const cx = at ? at.x : this.cam.x + this.cam.w / 2 / this.cam.z;
    const cy = at ? at.y : this.cam.y + this.cam.h / 2 / this.cam.z;
    const dx = cx - (x0 + x1) / 2, dy = cy - (y0 + y1) / 2;
    const tx = this.history.begin();
    const copies = this.cloneObjects([], dx, dy, tx, list);
    tx.commit();
    this.select(copies);
    this.setTool('select');
    this.select(copies);
    this.scene.emit('add');
  }

  pasteText(text, at) {
    const o = makeText(0, 0, 280);
    o.text = text.slice(0, 5000);
    o.ts.color = this.defaults.textColor;
    o.h = textObjectHeight(o);
    const cx = at ? at.x : this.cam.x + this.cam.w / 2 / this.cam.z;
    const cy = at ? at.y : this.cam.y + this.cam.h / 2 / this.cam.z;
    o.x = cx - o.w / 2;
    o.y = cy - o.h / 2;
    const tx = this.history.begin();
    this.scene.add(o, true);
    tx.add(o);
    tx.commit();
    this.select([o]);
    this.scene.emit('add');
  }

  group() {
    const sel = this.selectedObjs().filter((o) => !o.locked);
    if (sel.length < 2) return;
    const tx = this.history.begin();
    tx.trackAll(sel);
    const g = uid();
    for (const o of sel) o.group = g;
    tx.commit();
    this.touched();
  }

  ungroup() {
    const sel = this.selectedObjs().filter((o) => o.group);
    if (!sel.length) return;
    const tx = this.history.begin();
    tx.trackAll(sel);
    for (const o of sel) delete o.group;
    tx.commit();
    this.touched();
  }

  reorder(front) {
    const sel = this.selectedObjs().filter((o) => !o.locked);
    if (!sel.length) return;
    const tx = this.history.begin();
    tx.trackAll(sel);
    sel.sort((a, b) => a.z - b.z);
    if (front) for (const o of sel) o.z = this.scene.nextZ();
    else {
      let z = this.scene.minZ();
      for (let i = sel.length - 1; i >= 0; i--) sel[i].z = z--;
    }
    this.scene.reorder();
    tx.commit();
    this.renderer.markScene();
    this.touched();
  }

  toggleLock() {
    const sel = this.selectedObjs();
    if (!sel.length) return;
    const lock = !sel.every((o) => o.locked);
    const tx = this.history.begin();
    tx.trackAll(sel);
    for (const o of sel) o.locked = lock;
    tx.commit();
    this.selectionChanged();
    this.touched();
  }

  // Изменение стиля выбранных объектов одной записью в истории
  applyStyle(fn, { live = false } = {}) {
    const sel = this.selectedObjs();
    if (!sel.length) return;
    if (live) {
      if (!this.liveTx) this.liveTx = this.history.begin();
      this.liveTx.trackAll(sel);
    }
    const tx = live ? this.liveTx : this.history.begin();
    if (!live) tx.trackAll(sel);
    for (const o of sel) {
      fn(o);
      if (o.type === 'text') o.h = textObjectHeight(o);
      this.scene.touch(o, true);
    }
    if (!live) tx.commit();
    this.renderer.markScene();
    this.renderer.markUI();
    this.touched();
  }

  commitLiveStyle() {
    if (this.liveTx) { this.liveTx.commit(); this.liveTx = null; }
  }

  alignSelection(mode) {
    const sel = this.selectedObjs().filter((o) => !o.locked && o.type !== 'connector');
    if (sel.length < 2) return;
    const tx = this.history.begin();
    tx.trackAll(sel);
    const bs = sel.map((o) => ({ o, b: this.scene.bounds(o) }));
    const x0 = Math.min(...bs.map((e) => e.b.x)), x1 = Math.max(...bs.map((e) => e.b.x + e.b.w));
    const y0 = Math.min(...bs.map((e) => e.b.y)), y1 = Math.max(...bs.map((e) => e.b.y + e.b.h));
    const move = (o, dx, dy) => {
      o.x += dx; o.y += dy;
      if (o.type === 'stroke') for (let i = 0; i < o.pts.length; i += 3) { o.pts[i] += dx; o.pts[i + 1] += dy; }
      this.scene.invalidate(o);
    };
    if (mode === 'distH' || mode === 'distV') {
      const horiz = mode === 'distH';
      bs.sort((a, b) => (horiz ? a.b.x - b.b.x : a.b.y - b.b.y));
      if (bs.length > 2) {
        const total = bs.reduce((s, e) => s + (horiz ? e.b.w : e.b.h), 0);
        const gap = ((horiz ? x1 - x0 : y1 - y0) - total) / (bs.length - 1);
        let pos = horiz ? x0 : y0;
        for (const e of bs) {
          const cur = horiz ? e.b.x : e.b.y;
          move(e.o, horiz ? pos - cur : 0, horiz ? 0 : pos - cur);
          pos += (horiz ? e.b.w : e.b.h) + gap;
        }
      }
    } else {
      for (const { o, b } of bs) {
        if (mode === 'alignL') move(o, x0 - b.x, 0);
        else if (mode === 'alignR') move(o, x1 - (b.x + b.w), 0);
        else if (mode === 'alignH') move(o, (x0 + x1) / 2 - (b.x + b.w / 2), 0);
        else if (mode === 'alignT') move(o, 0, y0 - b.y);
        else if (mode === 'alignB') move(o, 0, y1 - (b.y + b.h));
        else if (mode === 'alignV') move(o, 0, (y0 + y1) / 2 - (b.y + b.h / 2));
      }
    }
    tx.commit();
    this.renderer.markScene();
    this.renderer.markUI();
    this.touched();
  }

  undo() {
    if (this.isEditingText()) { document.execCommand('undo'); return; }
    const ids = this.history.undo();
    if (ids) this.afterHistory();
  }

  redo() {
    if (this.isEditingText()) { document.execCommand('redo'); return; }
    const ids = this.history.redo();
    if (ids) this.afterHistory();
  }

  afterHistory() {
    this.clearDeadSelection();
    this.renderer.markScene();
    this.touched();
    this.selectionChanged();
  }

  // ---------- изображения, экспорт, импорт ----------
  async addImageFile(file, at) {
    try {
      let blob = file;
      const bmp = await createImageBitmap(file);
      let { width: w, height: h } = bmp;
      const MAX = 2600;
      if (Math.max(w, h) > MAX || file.size > 4e6) {
        const k = Math.min(1, MAX / Math.max(w, h));
        const cv = document.createElement('canvas');
        cv.width = Math.round(w * k);
        cv.height = Math.round(h * k);
        cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
        const keepAlpha = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif';
        blob = await new Promise((r) => cv.toBlob(r, keepAlpha ? 'image/png' : 'image/jpeg', 0.88));
        w = cv.width; h = cv.height;
      }
      const assetId = await this.storage.putAsset(blob);
      const k = Math.min(1, 520 / Math.max(w, h));
      const dw = w * k, dh = h * k;
      const cx = at ? at.x : this.cam.x + this.cam.w / 2 / this.cam.z;
      const cy = at ? at.y : this.cam.y + this.cam.h / 2 / this.cam.z;
      const o = { id: uid(), type: 'image', x: cx - dw / 2, y: cy - dh / 2, w: dw, h: dh, rot: 0, assetId, s: { opacity: 1 } };
      const tx = this.history.begin();
      this.scene.add(o, true);
      tx.add(o);
      tx.commit();
      this.select([o]);
      this.scene.emit('add');
    } catch (e) {
      console.error(e);
      this.ui.toast(t('imageFail'));
    }
  }

  pickImage() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.multiple = true;
    inp.onchange = () => { for (const f of inp.files) this.addImageFile(f); };
    inp.click();
  }

  async exportPNG() {
    const objs = this.selection.size ? this.selectedObjs() : this.scene.all();
    if (!objs.length) return;
    const blob = await exportPNGBlob(this, objs);
    download(blob, `${this.meta.name || 'board'}.png`);
  }

  async exportSVG() {
    const objs = this.selection.size ? this.selectedObjs() : this.scene.all();
    if (!objs.length) return;
    const svg = await exportSVGString(this, objs);
    download(new Blob([svg], { type: 'image/svg+xml' }), `${this.meta.name || 'board'}.svg`);
  }

  async exportPDF() {
    const objs = this.selection.size ? this.selectedObjs() : this.scene.all();
    if (!objs.length) return;
    this.ui.toast(t('pdfWorking'));
    try {
      const bytes = await exportPDFBytes(this, objs);
      download(new Blob([bytes], { type: 'application/pdf' }), `${this.meta.name || 'board'}.pdf`);
    } catch (e) {
      console.error(e);
      this.ui.toast(t('pdfFail'));
    }
  }

  async exportJSON() {
    const json = await exportBoardJSON(this);
    download(new Blob([json], { type: 'application/json' }), `${this.meta.name || 'board'}.board.json`);
  }

  importJSON() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      try {
        const parsed = parseBoardJSON(await f.text());
        const meta = await this.storage.createBoard(parsed.name || t('untitled'));
        for (const [oldId, dataUrl] of Object.entries(parsed.assets)) {
          const blob = await (await fetch(dataUrl)).blob();
          const newId = await this.storage.putAsset(blob);
          for (const o of parsed.objects) if (o.assetId === oldId) o.assetId = newId;
        }
        await this.storage.saveBoard(meta.id, JSON.stringify({ v: 1, objects: parsed.objects, camera: null, bg: parsed.bg, bgColor: parsed.bgColor, lineColor: parsed.lineColor }));
        this.ui.toast(t('boardImported'));
        await this.ui.openBoard(meta.id);
      } catch (e) {
        console.error(e);
        this.ui.toast(t('importFail'));
      }
    };
    inp.click();
  }

  // ---------- глобальные события ----------
  bindGlobal() {
    const stage = this.stage;
    document.addEventListener('copy', (e) => {
      if (this.view !== 'board' || this.isEditingText() || this.isTyping(e)) return;
      if (this.copySelection(false)) {
        e.preventDefault();
        e.clipboardData.setData('application/x-board', JSON.stringify(this.clip));
        e.clipboardData.setData('text/plain', this.clipText || ' ');
      }
    });
    document.addEventListener('cut', (e) => {
      if (this.view !== 'board' || this.isEditingText() || this.isTyping(e)) return;
      if (this.copySelection(true)) {
        e.preventDefault();
        e.clipboardData.setData('application/x-board', JSON.stringify(this.clip));
        e.clipboardData.setData('text/plain', this.clipText || ' ');
      }
    });
    document.addEventListener('paste', (e) => {
      if (this.view !== 'board' || this.isEditingText() || this.isTyping(e)) return;
      e.preventDefault();
      const cd = e.clipboardData;
      const at = this.hoverPos ? { x: this.hoverPos.wx, y: this.hoverPos.wy } : null;
      const files = [...(cd.files || [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) { files.forEach((f, i) => this.addImageFile(f, at && { x: at.x + i * 30, y: at.y + i * 30 })); return; }
      const raw = cd.getData('application/x-board');
      if (raw) {
        try { this.pasteObjects(JSON.parse(raw), at); return; } catch { /* упадём на текст */ }
      }
      const text = cd.getData('text/plain');
      if (text && text.trim()) this.pasteText(text, at);
    });
    stage.addEventListener('dragover', (e) => e.preventDefault());
    stage.addEventListener('drop', (e) => {
      e.preventDefault();
      const r = this.input.rect;
      const at = { x: (e.clientX - r.left) / this.cam.z + this.cam.x, y: (e.clientY - r.top) / this.cam.z + this.cam.y };
      [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')).forEach((f, i) => this.addImageFile(f, { x: at.x + i * 30, y: at.y + i * 30 }));
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    window.addEventListener('beforeunload', () => { this.forceSave = true; this.saveNow(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.forceSave = true; this.saveNow(); this.forceSave = false; } });
    if (window.boardAPI) {
      window.boardAPI.onCommand((cmd, ...a) => this.command(cmd, ...a));
      window.boardAPI.onFlush(async () => {
        this.saveSoon.cancel();
        const changed = this.contentDirty;
        this.forceSave = true;
        await this.saveNow();
        this.forceSave = false;
        if (changed) await this.saveThumb();
      });
    }
  }

  isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  command(cmd, ...args) {
    // в поле ввода команды меню работают как обычные текстовые
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.isContentEditable) && ['undo', 'redo', 'select-all', 'duplicate', 'group', 'ungroup'].includes(cmd)) {
      if (cmd === 'select-all') document.execCommand('selectAll');
      else if (cmd === 'undo' || cmd === 'redo') document.execCommand(cmd);
      return;
    }
    switch (cmd) {
      case 'undo': return this.view === 'board' && this.undo();
      case 'redo': return this.view === 'board' && this.redo();
      case 'new-board': return this.ui.newBoard();
      case 'home': return this.ui.showHome();
      case 'settings': return this.ui.openSettings();
      case 'export-png': return this.view === 'board' && this.exportPNG();
      case 'export-pdf': return this.view === 'board' && this.exportPDF();
      case 'export-svg': return this.view === 'board' && this.exportSVG();
      case 'export-json': return this.view === 'board' && this.exportJSON();
      case 'import-json': return this.importJSON();
      case 'add-image': return this.view === 'board' && this.pickImage();
      case 'duplicate': return this.view === 'board' && this.duplicateSelection();
      case 'select-all': if (this.view === 'board' && !this.isEditingText()) { this.setSelectionIds(this.scene.all().map((o) => o.id)); } return;
      case 'group': return this.group();
      case 'ungroup': return this.ungroup();
      case 'zoom-in': return this.zoomBy(1.25);
      case 'zoom-out': return this.zoomBy(0.8);
      case 'zoom-100': return this.zoomTo(1);
      case 'zoom-fit': return this.fitContent();
      case 'zoom-sel': return this.fitSelection();
      case 'minimap': this.settings.minimap = !this.settings.minimap; this.saveSettings(); return;
    }
  }

  onKey(e) {
    if (this.view !== 'board') return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod) {
      switch (k) {
        case 'z': e.preventDefault(); return e.shiftKey ? this.redo() : this.undo();
        case 'y': e.preventDefault(); return this.redo();
        case 'a': e.preventDefault(); return this.command('select-all');
        case 'd': e.preventDefault(); return this.duplicateSelection();
        case 'g': e.preventDefault(); return e.shiftKey ? this.ungroup() : this.group();
        case ']': e.preventDefault(); return this.reorder(true);
        case '[': e.preventDefault(); return this.reorder(false);
        case '0': e.preventDefault(); return this.zoomTo(1);
        case '1': e.preventDefault(); return this.fitContent();
        case '2': e.preventDefault(); return this.fitSelection();
        case '=': case '+': e.preventDefault(); return this.zoomBy(1.25);
        case '-': e.preventDefault(); return this.zoomBy(0.8);
        case 'e': if (e.shiftKey) { e.preventDefault(); return this.exportPNG(); } return;
      }
      return;
    }
    if (this.tool.key && this.tool.key(e)) { e.preventDefault(); return; }
    switch (e.key) {
      case 'Escape':
        if (this.toolName !== 'select') this.setTool('select');
        else this.clearSelection();
        return;
      case 'Delete': case 'Backspace': e.preventDefault(); return this.deleteSelection();
      case 'Enter': {
        const o = this.single();
        if (o && this.canEditText(o)) { e.preventDefault(); this.beginTextEdit(o); }
        return;
      }
    }
    const map = { v: 'select', h: 'hand', p: 'pen', m: 'hl', e: 'eraser', s: 'sticky', t: 'text', r: 'shape', f: 'frame', c: 'connector' };
    if (map[k] && !e.altKey) {
      if (k === 'r') this.defaults.shape = 'rect';
      this.setTool(map[k]);
      return;
    }
    if (k === 'o') { this.defaults.shape = 'ellipse'; this.setTool('shape'); return; }
    if (k === 'l') { this.defaults.connKind = 'straight'; this.defaults.connHead = false; this.saveDefaults(); this.setTool('connector'); return; }
    if (k === 'i') { this.pickImage(); return; }
    if (e.key === '+' || e.key === '=') this.zoomBy(1.25);
    else if (e.key === '-') this.zoomBy(0.8);
  }

  // ---------- оверлей ----------
  drawOverlay(ctx) {
    if (this.view !== 'board') return;
    drawSelectionOverlay(ctx, this);
    this.tool.drawOverlay?.(ctx);
  }
}
