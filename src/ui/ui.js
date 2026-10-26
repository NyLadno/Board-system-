import { h, debounce } from '../core/util.js';
import { icon, SHAPE_ICONS } from './icons.js';
import { t, getLang, list } from '../i18n.js';
import { popover, closePopover } from './pop.js';
import { ContextPanel, swatches, slider } from './panel.js';
import { PALETTE, STICKY_COLORS } from '../core/scene.js';
import { SHAPES } from '../render/draw.js';
import { TEMPLATES } from '../templates.js';
import { keys } from '../platform.js';
import { LOOKS } from '../looks.js';
import { Scene } from '../core/scene.js';

const TOOLBAR = [
  ['select', 'select', 'select'],
  ['hand', 'hand', 'hand'],
  ['sticky', 'sticky', 'sticky'],
  ['text', 'text', 'text'],
  ['shape', 'shapes', 'shapes'],
  ['connector', 'connector', 'connector'],
  ['draw', 'pen', 'pen'],
  ['frame', 'frame', 'frame'],
  ['image', 'image', 'image'],
];

export class UI {
  constructor(app) {
    this.app = app;
    this.boardView = document.getElementById('board-view');
    this.homeView = document.getElementById('home-view');
    this.chrome = document.getElementById('chrome');
    this.toastEl = document.getElementById('toast');
    this.buildChrome();
    this.panel = new ContextPanel(app, this.chrome);
    this.panelDirty = false;
  }

  // ---------- каркас доски ----------
  buildChrome() {
    const app = this.app;
    const c = this.chrome;
    c.textContent = '';

    // верхняя левая плашка
    this.nameInput = h('input', { class: 'board-name', spellcheck: 'false', maxlength: '120' });
    this.nameInput.addEventListener('change', async () => {
      const name = this.nameInput.value.trim() || t('untitled');
      this.nameInput.value = name;
      if (app.meta) { app.meta.name = name; await app.storage.patchMeta(app.meta.id, { name }); }
    });
    this.nameInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') this.nameInput.blur(); });
    this.topLeft = h('div', { class: 'bar top-left' },
      h('button', { class: 'tb', title: t('home'), html: icon('home', 18), onclick: () => this.showHome() }),
      this.nameInput);

    // верхняя правая плашка
    this.undoBtn = h('button', { class: 'tb', title: t('undo') + ' ' + keys('⌘Z'), html: icon('undo', 18), onclick: () => app.undo() });
    this.redoBtn = h('button', { class: 'tb', title: t('redo') + ' ' + keys('⇧⌘Z'), html: icon('redo', 18), onclick: () => app.redo() });
    const exportBtn = h('button', { class: 'tb wide', title: t('export'), html: icon('export', 18) + `<span>${t('export')}</span>` });
    exportBtn.addEventListener('click', () => {
      const menu = h('div', { class: 'menu' },
        h('button', { onclick: () => { closePopover(); app.exportPNG(); } }, t('exportPng')),
        h('button', { onclick: () => { closePopover(); app.exportPDF(); } }, t('exportPdf')),
        h('button', { onclick: () => { closePopover(); app.exportSVG(); } }, t('exportSvg')),
        h('button', { onclick: () => { closePopover(); app.exportJSON(); } }, t('exportJson')),
        h('hr'),
        h('button', { onclick: () => { closePopover(); app.importJSON(); } }, t('importJson')));
      popover(exportBtn, menu);
    });
    const lookBtn = h('button', { class: 'tb bg-btn', title: t('look'), html: icon('palette', 18) });
    lookBtn.addEventListener('click', () => this.openLook(lookBtn));
    this.topRight = h('div', { class: 'bar top-right' },
      this.undoBtn, this.redoBtn, h('span', { class: 'sep' }), lookBtn, exportBtn,
      h('button', { class: 'tb', title: t('settings'), html: icon('settings', 18), onclick: () => this.openSettings() }));

    // левая панель инструментов
    this.toolBtns = {};
    const tb = h('div', { class: 'bar toolbar' });
    for (const [id, ic, label] of TOOLBAR) {
      const b = h('button', { class: 'tb big', title: t(label), html: icon(ic, 22) });
      b.addEventListener('click', () => {
        if (id === 'image') return app.pickImage();
        if (id === 'draw') return app.setTool(app.lastDrawTool);
        app.setTool(id);
      });
      this.toolBtns[id] = b;
      tb.append(b);
    }
    this.toolbar = tb;

    // нижняя панель параметров инструмента
    this.options = h('div', { class: 'bar options', hidden: true });

    // масштаб
    this.zoomLabel = h('button', { class: 'tb wide zoom-label', title: '100%', onclick: () => app.zoomTo(1) }, '100%');
    // Ползунок масштаба нужен тем, у кого только перо: логарифмическая шкала от 2% до 3200%
    this.zoomSlider = h('input', { type: 'range', class: 'range zoom-range', min: String(Math.log(0.02)), max: String(Math.log(32)), step: '0.005', title: t('zoomSlider') });
    this.zoomSlider.addEventListener('input', () => {
      app.cam.setZoomCentered(Math.exp(Number(this.zoomSlider.value)));
      app.cameraMoved();
    });
    this.zoomSlider.addEventListener('pointerdown', () => { app.interacting = true; });
    const sliderDone = () => { app.interacting = false; app.afterInteraction(); };
    this.zoomSlider.addEventListener('pointerup', sliderDone);
    this.zoomSlider.addEventListener('pointercancel', sliderDone);
    this.bottomLeft = h('div', { class: 'bar bottom-left' },
      h('button', { class: 'tb', title: t('zoomOut'), html: icon('minus', 18), onclick: () => app.zoomBy(0.8) }),
      this.zoomSlider,
      h('button', { class: 'tb', title: t('zoomIn'), html: icon('plus', 18), onclick: () => app.zoomBy(1.25) }),
      this.zoomLabel,
      h('button', { class: 'tb', title: t('fit'), html: icon('fit', 18), onclick: () => app.fitContent() }));

    // мини-карта
    this.miniCv = h('canvas', { width: 200, height: 140 });
    this.mini = h('div', { class: 'bar minimap' }, this.miniCv);
    this.bindMinimap();

    // диагностика
    this.diagEl = h('div', { class: 'diag', hidden: true });

    c.append(this.topLeft, this.topRight, this.toolbar, this.options, this.bottomLeft, this.mini, this.diagEl);
    if (this.panel) c.append(this.panel.el);
    this.lang = getLang();
    this.toolChanged();
    this.updateHistory();
  }

  // ---------- реакции на состояние ----------
  toolChanged() {
    const app = this.app;
    const name = app.toolName;
    const group = { pen: 'draw', hl: 'draw', eraser: 'draw' }[name] || name;
    for (const id in this.toolBtns) this.toolBtns[id].classList.toggle('on', id === group);
    this.buildOptions();
    this.panel?.update(true);
    closePopover();
  }

  selectionChanged() { this.panel.update(true); }

  contentChanged() {
    this.panel.update();
    this.scheduleMini();
  }

  // Вызывается раз за кадр, пока камера двигается
  cameraChanged() {
    const label = Math.round(this.app.cam.z * 100) + '%';
    if (this.zoomLabel.textContent !== label) this.zoomLabel.textContent = label;
    if (this.zoomSlider && document.activeElement !== this.zoomSlider) this.zoomSlider.value = String(Math.log(this.app.cam.z));
    
    this.panelDirty = true;
    this.scheduleMini();
    closePopover();
  }

  // Мини-карта перерисовывается, когда всё успокоилось: так она не отнимает время у жестов и рисования
  scheduleMini() {
    clearTimeout(this._mt);
    this._mt = setTimeout(() => this.drawMinimap(), 180);
  }

  updateHistory() {
    const hs = this.app.history;
    this.undoBtn.disabled = !hs.canUndo();
    this.redoBtn.disabled = !hs.canRedo();
  }

  settingsChanged() {
    if (getLang() !== this.lang) {
      this.buildChrome();
      if (this.app.meta) this.nameInput.value = this.app.meta.name;
    } else this.buildOptions();
    this.panel.update(true);
    this.scheduleMini();
  }

  // Вызывается каждый кадр рендера: только дешёвые проверки
  frame() {
    const app = this.app;
    if (app.view !== 'board') return;
    if (this.panelDirty) {
      this.panelDirty = false;
      if (!this.panel.el.hidden) this.panel.position(app.selectedObjs());
    }
    if (app.settings.diag) {
      const r = app.renderer.stats;
      const text = `${r.fps} fps · scene ${r.cost.toFixed(1)} ms (${r.renders}) · ${t('latency')} ${app.diag.inputToDraw.toFixed(1)} ms · ${app.scene.objs.size} obj`;
      if (this.diagEl.hidden) this.diagEl.hidden = false;
      if (text !== this._diagText) { this._diagText = text; this.diagEl.textContent = text; }
    } else if (!this.diagEl.hidden) this.diagEl.hidden = true;
    const showMini = !!app.settings.minimap;
    if (this.mini.hidden === showMini) this.mini.hidden = !showMini;
  }

  // ---------- параметры инструмента ----------
  buildOptions() {
    const app = this.app;
    const d = app.defaults;
    const name = app.toolName;
    const el = this.options;
    el.textContent = '';
    const save = () => app.saveDefaults();
    const seg = (id, ic, title) => {
      const b = h('button', { class: 'tb' + (name === id ? ' on' : ''), title, html: icon(ic, 18) });
      b.addEventListener('click', () => app.setTool(id));
      return b;
    };
    if (name === 'pen' || name === 'hl' || name === 'eraser') {
      el.append(seg('pen', 'pen', t('pen')), seg('hl', 'highlighter', t('highlighter')), seg('eraser', 'eraser', t('eraser')), h('span', { class: 'sep' }));
      if (name !== 'eraser') {
        const st = name === 'pen' ? d.pen : d.hl;
        el.append(swatches(app.palette().concat(name === 'hl' ? ['#f5d90a', '#4dd4ff'] : []), st.color, (c) => {
          st.color = c; save(); app._cursorKey = null; app.input.updateCursor(); this.buildOptions();
        }));
        const dot = h('i', { class: 'size-dot' });
        const updDot = () => { const s = Math.min(26, Math.max(3, st.size)); dot.style.width = dot.style.height = s + 'px'; dot.style.background = st.color; };
        updDot();
        el.append(h('span', { class: 'sep' }), slider(1, name === 'hl' ? 50 : 24, st.size, (v) => { st.size = v; updDot(); app._cursorKey = null; app.input.updateCursor(); }, save), dot);
        if (name === 'pen') {
          const on = app.settings.pressure > 0;
          const p = h('button', { class: 'tb wide' + (on ? ' on' : ''), title: t('pressure') }, 'Pressure');
          p.textContent = '✎ ' + (getLang() === 'ru' ? 'Нажим' : 'Pressure');
          p.addEventListener('click', () => { app.settings.pressure = on ? 0 : 0.65; app.saveSettings(); });
          el.append(h('span', { class: 'sep' }), p);
        }
      } else {
        el.append(h('span', { class: 'lbl' }, t('eraserSize')), slider(8, 100, d.eraserSize, (v) => { d.eraserSize = v; app._cursorKey = null; app.input.updateCursor(); }, save));
      }
      el.hidden = false;
    } else if (name === 'shape') {
      const grid = h('div', { class: 'shape-row' });
      for (const s of SHAPES) {
        const b = h('button', { class: 'tb' + (d.shape === s ? ' on' : ''), title: t('shape_' + s), html: icon(s, 20) });
        b.addEventListener('click', () => { d.shape = s; save(); this.buildOptions(); });
        grid.append(b);
      }
      el.append(grid, h('span', { class: 'sep' }), swatches(['#ffffff', ...STICKY_COLORS.slice(1, 7)], d.shapeFill, (c) => { d.shapeFill = c; save(); this.buildOptions(); }, { none: true, custom: false }));
      el.hidden = false;
    } else if (name === 'sticky') {
      el.append(swatches(STICKY_COLORS, d.stickyColor, (c) => { d.stickyColor = c; save(); this.buildOptions(); }, { custom: false }), h('span', { class: 'sep' }));
      for (const [label, size] of [['S', 120], ['M', 180], ['L', 260]]) {
        const b = h('button', { class: 'tb wide' + (d.stickySize === size ? ' on' : '') }, label);
        b.addEventListener('click', () => { d.stickySize = size; save(); this.buildOptions(); });
        el.append(b);
      }
      el.hidden = false;
    } else if (name === 'connector') {
      const opts = [['straight', false, 'line', t('line')], ['straight', true, 'arrowEnd', t('arrow')], ['elbow', true, 'elbow', t('connElbow')], ['curve', true, 'curve', t('connCurve')]];
      for (const [kind, head, ic, title] of opts) {
        const on = d.connKind === kind && d.connHead === head;
        const b = h('button', { class: 'tb' + (on ? ' on' : ''), title, html: icon(ic, 20) });
        b.addEventListener('click', () => { d.connKind = kind; d.connHead = head; save(); this.buildOptions(); });
        el.append(b);
      }
      el.append(h('span', { class: 'sep' }), swatches(app.palette(), d.connColor, (c) => { d.connColor = c; save(); this.buildOptions(); }, { custom: false }));
      el.hidden = false;
    } else if (name === 'text') {
      el.append(swatches(app.palette(), d.textColor, (c) => { d.textColor = c; save(); this.buildOptions(); }, { custom: false }));
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  // ---------- мини-карта ----------
  // Карта рисуется с учётом плотности пикселей экрана и показывает настоящую форму объектов:
  // штрихи ломаными своего цвета, коннекторы линиями, фигуры, стикеры и рамки с заливкой, текст полосками.
  // Единичные далёкие выбросы не ужимают остальное: область строится по основной массе объектов (границы Тьюки
  // по квартилям), а выбросы отмечаются точками у края карты.
  mapRegion(objs, view) {
    const scene = this.app.scene;
    this.mapOutliers = [];
    let list = objs;
    if (objs.length >= 12) {
      const cs = objs.map((o) => { const b = scene.bounds(o); return [b.x + b.w / 2, b.y + b.h / 2]; });
      const fence = (i) => {
        const v = cs.map((c) => c[i]).sort((p, q) => p - q);
        const q1 = v[Math.floor(v.length * 0.25)], q3 = v[Math.floor(v.length * 0.75)];
        const iqr = Math.max(q3 - q1, 1);
        return [q1 - 3 * iqr - 300, q3 + 3 * iqr + 300];
      };
      const [fx0, fx1] = fence(0), [fy0, fy1] = fence(1);
      const inl = [], out = [];
      objs.forEach((o, i) => ((cs[i][0] >= fx0 && cs[i][0] <= fx1 && cs[i][1] >= fy0 && cs[i][1] <= fy1) ? inl : out).push(o));
      if (out.length && out.length <= objs.length * 0.1) { list = inl; this.mapOutliers = out; }
    }
    const v = { x0: view.x, y0: view.y, x1: view.x + view.w, y1: view.y + view.h };
    if (!list.length) return v;
    const f = scene.boundsOf(list);
    return { x0: Math.min(f.x, v.x0), y0: Math.min(f.y, v.y0), x1: Math.max(f.x + f.w, v.x1), y1: Math.max(f.y + f.h, v.y1) };
  }

  drawMinimap() {
    const app = this.app;
    const cv = this.miniCv;
    if (!app.settings.minimap || app.view !== 'board') return;
    const W = 200, H = 140, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // фон карты совпадает с фоном доски
    const style = app.boardStyle();
    ctx.fillStyle = app.boardBgColor || (style === 'cells' ? '#ffffff' : '#f6f7f9');
    ctx.fillRect(0, 0, W, H);

    const objs = app.scene.all();
    const view = app.cam.viewRect();
    // пока карту тянут пальцем или пером, область не пересчитываем, иначе она «уезжает» из-под курсора
    const R = this.miniDrag && this.mapR ? this.mapR : this.mapRegion(objs, view);
    this.mapR = R;
    const pad = 8;
    const rw = Math.max(R.x1 - R.x0, 1), rh = Math.max(R.y1 - R.y0, 1);
    const k = Math.min((W - pad * 2) / rw, (H - pad * 2) / rh);
    const ox = (W - rw * k) / 2 - R.x0 * k, oy = (H - rh * k) / 2 - R.y0 * k;
    this.mapT = { k, ox, oy };
    const sx = (x) => x * k + ox, sy = (y) => y * k + oy;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    const step = Math.max(1, Math.floor(objs.length / 4000));
    const dark = app.dark;
    for (let i = 0; i < objs.length; i += step) {
      const o = objs[i];
      const b = app.scene.bounds(o);
      const w = b.w * k, h = b.h * k;
      if (w + h < 0.5) continue;
      const x = sx(b.x), y = sy(b.y);
      if (x > W || y > H || x + w < 0 || y + h < 0) continue;
      switch (o.type) {
        case 'frame':
          ctx.fillStyle = dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.75)';
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(95,99,104,0.55)';
          ctx.lineWidth = 0.8;
          ctx.strokeRect(x + 0.4, y + 0.4, Math.max(w - 0.8, 0.5), Math.max(h - 0.8, 0.5));
          break;
        case 'sticky':
          ctx.fillStyle = o.s.fill;
          ctx.fillRect(x, y, Math.max(w, 1.5), Math.max(h, 1.5));
          break;
        case 'shape': {
          const fillOn = o.s.fill && o.s.fill !== 'transparent';
          ctx.fillStyle = fillOn ? o.s.fill : 'rgba(0,0,0,0)';
          ctx.strokeStyle = o.s.stroke || '#555';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          if (o.shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 0.8), Math.max(h / 2, 0.8), 0, 0, Math.PI * 2);
          else ctx.rect(x, y, Math.max(w, 1.5), Math.max(h, 1.5));
          if (fillOn) ctx.fill();
          ctx.stroke();
          break;
        }
        case 'text':
          ctx.fillStyle = o.ts.color || '#333';
          ctx.globalAlpha = 0.55;
          ctx.fillRect(x, y + Math.max(h * 0.35, 0), Math.max(w, 1.5), Math.max(Math.min(h * 0.3, 2.5), 1));
          ctx.globalAlpha = 1;
          break;
        case 'image':
          ctx.fillStyle = 'rgba(120,130,150,0.35)';
          ctx.fillRect(x, y, Math.max(w, 1.5), Math.max(h, 1.5));
          break;
        case 'stroke': {
          const p = o.pts, n = p.length / 3;
          ctx.strokeStyle = o.s.color || '#333';
          ctx.globalAlpha = o.s.hl ? 0.4 : 0.95;
          ctx.lineWidth = o.s.hl ? Math.max(o.s.size * k, 1.5) : Math.max(0.9, Math.min(o.s.size * k, 2));
          ctx.lineCap = ctx.lineJoin = 'round';
          ctx.beginPath();
          const every = Math.max(1, Math.floor(n / 14));
          ctx.moveTo(sx(p[0]), sy(p[1]));
          for (let j = every; j < n; j += every) ctx.lineTo(sx(p[j * 3]), sy(p[j * 3 + 1]));
          ctx.lineTo(sx(p[(n - 1) * 3]), sy(p[(n - 1) * 3 + 1]));
          if (n === 1) ctx.lineTo(sx(p[0]) + 0.1, sy(p[1]));
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        case 'connector': {
          const pts = app.scene.route(o).pts;
          ctx.strokeStyle = o.s.stroke || '#555';
          ctx.globalAlpha = 0.8;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(sx(pts[0]), sy(pts[1]));
          const every = Math.max(1, Math.floor(pts.length / 2 / 12)) * 2;
          for (let j = every; j < pts.length - 2; j += every) ctx.lineTo(sx(pts[j]), sy(pts[j + 1]));
          ctx.lineTo(sx(pts[pts.length - 2]), sy(pts[pts.length - 1]));
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
      }
    }
    // выбросы за пределами карты: точки у края в их направлении
    if (this.mapOutliers && this.mapOutliers.length) {
      const cx = W / 2, cy = H / 2;
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.7)' : 'rgba(60,70,90,0.75)';
      for (const o of this.mapOutliers.slice(0, 12)) {
        const b = app.scene.bounds(o);
        let dx = sx(b.x + b.w / 2) - cx, dy = sy(b.y + b.h / 2) - cy;
        const m = Math.max(Math.abs(dx) / (cx - 5), Math.abs(dy) / (cy - 5), 1e-6);
        dx /= m; dy /= m;
        ctx.beginPath();
        ctx.arc(cx + dx, cy + dy, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // всё вне видимой области слегка затемняем, видимая область обведена
    const vx = sx(view.x), vy = sy(view.y), vw = view.w * k, vh = view.h * k;
    ctx.fillStyle = dark ? 'rgba(0,0,0,0.28)' : 'rgba(30,40,80,0.10)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.rect(vx, vy, vw, vh);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#4262ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx, vy, vw, vh);
    ctx.restore();
  }

  bindMinimap() {
    const app = this.app;
    const go = (e) => {
      if (!this.mapT) return;
      const r = this.miniCv.getBoundingClientRect();
      const sx = ((e.clientX - r.left) / r.width) * 200;
      const sy = ((e.clientY - r.top) / r.height) * 140;
      const wx = (sx - this.mapT.ox) / this.mapT.k, wy = (sy - this.mapT.oy) / this.mapT.k;
      app.cam.x = wx - app.cam.w / 2 / app.cam.z;
      app.cam.y = wy - app.cam.h / 2 / app.cam.z;
      app.cameraChanged();
      this.drawMinimap();
    };
    this.miniCv.addEventListener('pointerdown', (e) => { this.miniCv.setPointerCapture(e.pointerId); this.miniDrag = true; this.mapR = null; go(e); });
    this.miniCv.addEventListener('pointermove', (e) => { if (this.miniDrag) go(e); });
    const end = () => { this.miniDrag = false; this.scheduleMini(); };
    this.miniCv.addEventListener('pointerup', end);
    this.miniCv.addEventListener('pointercancel', end);
  }

  // ---------- вид доски: стиль фона, цвет фона, цвет линий ----------
  openLook(anchor) {
    const app = this.app;
    const BG = ['#ffffff', '#f6f7f9', '#fff8e1', '#e8f5e9', '#e3f2fd', '#fce4ec', '#2b2f36', '#0f1424'];
    const LINES = ['#9aa0a6', '#4262ff', '#2f9e44', '#e03131', '#f08c00', '#1a1a1a', '#ffffff'];
    const styles = [['dots', t('bgDots')], ['grid', t('bgGrid')], ['cells', t('bgCells')], ['none', t('bgNone')]];
    const box = h('div', { class: 'look' });
    const build = () => {
      box.textContent = '';
      const cur = app.boardBg || app.settings.bg;
      const seg = h('div', { class: 'seg' }, styles.map(([v, label]) => {
        const b = h('button', { class: 'tb wide' + (cur === v ? ' on' : '') }, label);
        b.addEventListener('click', () => { app.setBoardLook({ bg: v }); build(); });
        return b;
      }));
      const defBg = getComputedStyle(app.stage).getPropertyValue('--board').trim();
      const presets = h('div', { class: 'looks' }, LOOKS.map((lk) => {
        const bgc = lk.bg || '#f6f7f9';
        const chip = h('button', { class: 'look-chip', title: lk.name(), 'data-look': lk.id },
          h('i', { class: 'look-prev', style: { background: `radial-gradient(circle, ${lk.line || '#9aa0a6'} 1.4px, transparent 1.8px) 0 0 / 9px 9px, ${bgc}` } }),
          h('span', null, lk.name()));
        chip.addEventListener('click', () => {
          app.setBoardLook({ bgColor: lk.bg, lineColor: lk.line, ...(lk.style ? { bg: lk.style } : {}) });
          build();
        });
        return chip;
      }));
      box.append(
        h('div', { class: 'lbl' }, t('lookPresets')), presets,
        h('div', { class: 'lbl' }, t('bgStyle')), seg,
        h('div', { class: 'lbl' }, t('bgColor')),
        swatches(BG, app.boardBgColor || defBg, (c) => { app.setBoardLook({ bgColor: c }); build(); }),
        h('div', { class: 'lbl' }, t('lineColor')),
        swatches(LINES, app.boardLineColor || '', (c) => { app.setBoardLook({ lineColor: c }); build(); }),
        h('button', { class: 'tb wide reset', onclick: () => { app.setBoardLook({ bgColor: null, lineColor: null }); build(); } }, t('resetLook')));
    };
    build();
    popover(anchor, box);
  }

  // ---------- сообщения ----------
  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => this.toastEl.classList.remove('show'), 2200);
  }

  // ---------- главная: список досок ----------
  async showHome() {
    const app = this.app;
    closePopover();
    app.endTextEdit();
    if (app.meta) await app.closeBoard();
    app.view = 'home';
    this.boardView.hidden = true;
    this.homeView.hidden = false;
    await this.renderHome();
  }

  async renderHome(filter = '') {
    const app = this.app;
    const boards = await app.storage.listBoards();
    const root = this.homeView;
    root.textContent = '';
    const search = h('input', { class: 'search', type: 'search', placeholder: t('search'), value: filter });
    search.addEventListener('input', () => this.renderHome(search.value).then(() => { const s = this.homeView.querySelector('.search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }));
    const head = h('header', { class: 'home-head' },
      h('div', { class: 'brand' }, h('span', { class: 'logo', html: icon('frame', 20) }), h('h1', null, t('boards'))),
      search,
      h('button', { class: 'tb wide', title: t('importJson'), html: icon('export', 18, 'style="transform:rotate(180deg)"'), onclick: () => app.importJSON() }),
      h('button', { class: 'tb', title: t('settings'), html: icon('settings', 18), onclick: () => this.openSettings() }),
      h('button', { class: 'primary', onclick: () => this.newBoard() }, '+ ' + t('newBoard')));
    const grid = h('div', { class: 'cards' });
    grid.append(h('button', { class: 'card new', onclick: () => this.newBoard() }, h('span', { class: 'plus', html: icon('plus', 28) }), h('span', null, t('newBoard'))));
    const q = filter.trim().toLowerCase();
    for (const m of boards) {
      if (q && !m.name.toLowerCase().includes(q)) continue;
      grid.append(this.card(m));
    }
    root.append(head, grid);
    if (!boards.length) grid.append(h('p', { class: 'empty' }, t('empty')));
  }

  card(m) {
    const app = this.app;
    const when = this.fmtTime(m.updated);
    const thumb = m.thumb ? h('img', { src: m.thumb, alt: '', draggable: 'false' }) : h('div', { class: 'blank', html: icon('frame', 36) });
    const nameEl = h('div', { class: 'cname' }, m.name);
    const more = h('button', { class: 'tb more', title: '…', html: icon('more', 18) });
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = h('div', { class: 'menu' },
        h('button', { onclick: () => { closePopover(); this.renameInline(m, nameEl); } }, t('rename')),
        h('button', { onclick: async () => { closePopover(); await app.storage.duplicateBoard(m.id, m.name + ' (copy)'); this.renderHome(); } }, t('duplicate')),
        h('hr'),
        h('button', { class: 'danger', onclick: async () => {
          closePopover();
          if (confirm(t('deleteBoardQ', { name: m.name }))) { await app.storage.deleteBoard(m.id); this.renderHome(); }
        } }, t('delete')));
      popover(more, menu);
    });
    const card = h('div', { class: 'card', tabindex: '0', 'data-id': m.id },
      h('div', { class: 'thumb' }, thumb),
      h('div', { class: 'cmeta' }, h('div', null, nameEl, h('div', { class: 'ctime' }, t('edited', { when }))), more));
    card.addEventListener('click', () => this.openBoard(m.id));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === card) this.openBoard(m.id); });
    return card;
  }

  renameInline(m, nameEl) {
    const inp = h('input', { class: 'rename', value: m.name });
    nameEl.replaceWith(inp);
    inp.focus();
    inp.select();
    inp.addEventListener('click', (e) => e.stopPropagation());
    const done = async () => {
      const name = inp.value.trim() || t('untitled');
      await this.app.storage.patchMeta(m.id, { name });
      this.renderHome();
    };
    inp.addEventListener('blur', done, { once: true });
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = m.name; inp.blur(); } });
  }

  fmtTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return t('justNow');
    try {
      const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto' });
      const mins = Math.round(-diff / 60000);
      if (mins > -60) return rtf.format(mins, 'minute');
      const hrs = Math.round(-diff / 3600000);
      if (hrs > -24) return rtf.format(hrs, 'hour');
      return rtf.format(Math.round(-diff / 86400000), 'day');
    } catch { return new Date(ts).toLocaleString(); }
  }

  // Галерея шаблонов: превью строятся из тех же объектов, что попадут на доску
  newBoard() {
    const app = this.app;
    const root = document.getElementById('modal-root');
    const close = () => { root.textContent = ''; };
    const grid = h('div', { class: 'tpl-grid' });
    for (const tpl of TEMPLATES) {
      const thumb = h('div', { class: 'tpl-thumb' });
      const card = h('button', { class: 'tpl-card', 'data-tpl': tpl.id }, thumb, h('div', { class: 'tpl-name' }, tpl.name()));
      if (tpl.id === 'blank') thumb.innerHTML = icon('plus', 30);
      else if (tpl.bg) thumb.classList.add('bg-' + tpl.bg);
      else {
        const objs = tpl.build();
        const sc = new Scene();
        sc.load(objs);
        const b = sc.boundsOf(sc.all());
        const pad = 30;
        const rect = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
        const scale = Math.min(520 / rect.w, 330 / rect.h);
        const cv = app.renderer.renderToCanvas(sc.all(), rect, scale * 2, { background: '#f6f7f9', scene: sc });
        thumb.append(cv);
      }
      card.addEventListener('click', async () => { close(); await this.createFromTemplate(tpl); });
      grid.append(card);
    }
    const modal = h('div', { class: 'modal wide' },
      h('div', { class: 'modal-head' }, h('h2', null, t('chooseTemplate')), h('button', { class: 'tb', html: icon('plus', 18, 'style="transform:rotate(45deg)"'), title: t('close'), onclick: close })),
      grid);
    const back = h('div', { class: 'backdrop' }, modal);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); e.stopPropagation(); });
    root.textContent = '';
    root.append(back);
  }

  async createFromTemplate(tpl) {
    const objects = tpl.build();
    const meta = await this.app.storage.createBoard(tpl.id === 'blank' ? t('untitled') : tpl.name());
    if (objects.length || tpl.bg) await this.app.storage.saveBoard(meta.id, JSON.stringify({ v: 1, objects, camera: null, bg: tpl.bg || null }), false);
    await this.openBoard(meta.id);
  }

  async openBoard(id) {
    const app = this.app;
    this.homeView.hidden = true;
    this.boardView.hidden = false;
    app.view = 'board';
    app.renderer.resize();
    await app.openBoard(id);
    this.nameInput.value = app.meta.name;
    this.contentChanged();
    this.updateHistory();
    this.stageFocus();
  }

  stageFocus() { this.app.stage.focus({ preventScroll: true }); }

  // ---------- настройки ----------
  openSettings() {
    const app = this.app;
    const s = app.settings;
    const root = document.getElementById('modal-root');
    root.textContent = '';
    const close = () => { root.textContent = ''; };
    const row = (label, ctrl, hint) => h('div', { class: 'srow' }, h('div', { class: 'slabel' }, h('div', null, label), hint ? h('small', null, hint) : null), ctrl);
    const num = (key, min, max, step = 1, scale = 1) => {
      const val = h('span', { class: 'val' }, String(Math.round(s[key] * scale)));
      const sl = slider(min, max, s[key] * scale, (v) => { s[key] = v / scale; val.textContent = String(v); }, () => app.saveSettings(), step);
      return h('div', { class: 'sctrl' }, sl, val);
    };
    const toggle = (key) => {
      const i = h('input', { type: 'checkbox' });
      i.checked = !!s[key];
      i.addEventListener('change', () => { s[key] = i.checked; app.saveSettings(); });
      return h('label', { class: 'switch' }, i, h('span'));
    };
    const select = (key, options) => {
      const sel = h('select', null, options.map(([v, label]) => h('option', { value: v, selected: s[key] === v }, label)));
      sel.addEventListener('change', () => { s[key] = sel.value; app.saveSettings(); if (key === 'lang') this.openSettings(); });
      return sel;
    };
    const modal = h('div', { class: 'modal' },
      h('div', { class: 'modal-head' }, h('h2', null, t('settings')), h('button', { class: 'tb', html: icon('plus', 18, 'style="transform:rotate(45deg)"'), title: t('close'), onclick: close })),
      h('h3', null, t('pen')),
      row(t('pressure'), num('pressure', 0, 100, 5, 100)),
      row(t('smoothing'), num('smoothing', 0, 100, 5, 100), t('smoothingHint')),
      row(t('prediction'), num('predictMs', 0, 40, 1), t('predictionHint')),
      row(t('inkTrail'), toggle('inkTrail'), t('inkTrailHint')),
      row(t('palm'), toggle('palmRejection')),
      row(t('touchDraw'), toggle('touchDraw')),
      h('h3', null, t('background')),
      row(t('background'), (() => {
        // на открытой доске меняется фон этой доски, иначе значение по умолчанию для новых
        const cur = app.view === 'board' ? (app.boardBg || s.bg) : s.bg;
        const sel = h('select', null, [['dots', t('bgDots')], ['grid', t('bgGrid')], ['cells', t('bgCells')], ['none', t('bgNone')]].map(([v, label]) => h('option', { value: v, selected: cur === v }, label)));
        sel.addEventListener('change', () => { if (app.view === 'board') app.setBoardLook({ bg: sel.value }); else { s.bg = sel.value; app.saveSettings(); } });
        return sel;
      })()),
      row(t('wheel'), select('wheel', [['zoom', t('wheelZoom')], ['pan', t('wheelPan')]])),
      row(t('minimap'), toggle('minimap')),
      h('h3', null, t('theme')),
      row(t('theme'), select('theme', [['auto', t('themeAuto')], ['light', t('themeLight')], ['dark', t('themeDark')]])),
      row(t('language'), select('lang', [['ru', 'Русский'], ['en', 'English']])),
      row(t('diag'), toggle('diag')),
      h('h3', null, t('backup')),
      row(t('backupSave'), h('button', { class: 'tb wide', onclick: () => app.exportBackup() }, t('backupSaveBtn')), t('backupHint')),
      row(t('backupRestore'), h('button', { class: 'tb wide', onclick: () => app.restoreBackupFile() }, t('backupRestoreBtn'))),
      h('h3', null, t('shortcuts')),
      h('div', { class: 'keys' }, list('keys').map(([k, d]) => h('div', { class: 'krow' }, h('kbd', null, keys(k)), h('span', null, d)))));
    const back = h('div', { class: 'backdrop' }, modal);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); e.stopPropagation(); });
    root.append(back);
  }
}
