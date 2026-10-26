import { h, debounce } from '../core/util.js';
import { icon, SHAPE_ICONS } from './icons.js';
import { t, getLang, list } from '../i18n.js';
import { popover, closePopover } from './pop.js';
import { ContextPanel, swatches, slider } from './panel.js';
import { PALETTE, STICKY_COLORS } from '../core/scene.js';
import { SHAPES } from '../render/draw.js';
import { TEMPLATES } from '../templates.js';
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
    this.lastMini = 0;
    this.miniDirty = true;
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
    this.undoBtn = h('button', { class: 'tb', title: t('undo') + ' ⌘Z', html: icon('undo', 18), onclick: () => app.undo() });
    this.redoBtn = h('button', { class: 'tb', title: t('redo') + ' ⇧⌘Z', html: icon('redo', 18), onclick: () => app.redo() });
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
    this.bottomLeft = h('div', { class: 'bar bottom-left' },
      h('button', { class: 'tb', title: t('zoomOut'), html: icon('minus', 18), onclick: () => app.zoomBy(0.8) }),
      this.zoomLabel,
      h('button', { class: 'tb', title: t('zoomIn'), html: icon('plus', 18), onclick: () => app.zoomBy(1.25) }),
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
    this.miniDirty = true;
  }

  cameraChanged() {
    this.zoomLabel.textContent = Math.round(this.app.cam.z * 100) + '%';
    this.miniDirty = true;
    closePopover();
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
    this.miniDirty = true;
  }

  // Вызывается каждый кадр рендера
  frame() {
    const app = this.app;
    if (app.view !== 'board') return;
    if (!app.interacting || app.toolName === 'select') {
      if (!this.panel.el.hidden) this.panel.position(app.selectedObjs());
    }
    const now = performance.now();
    if (this.miniDirty && now - this.lastMini > 120) {
      this.lastMini = now;
      this.miniDirty = false;
      this.drawMinimap();
    }
    if (app.settings.diag) {
      const r = app.renderer.stats;
      this.diagEl.hidden = false;
      this.diagEl.textContent = `${r.fps} fps · scene ${r.cost.toFixed(1)} ms · ${t('latency')} ${app.diag.inputToDraw.toFixed(1)} ms · ${app.scene.objs.size} obj`;
    } else this.diagEl.hidden = true;
    this.mini.hidden = !app.settings.minimap;
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
          p.addEventListener('click', () => { app.settings.pressure = on ? 0 : 0.8; app.saveSettings(); });
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
  drawMinimap() {
    const app = this.app;
    const cv = this.miniCv;
    if (!app.settings.minimap) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const objs = app.scene.all();
    const view = app.cam.viewRect();
    let b = objs.length ? app.scene.boundsOf(objs) : null;
    const u = b ? { x: Math.min(b.x, view.x), y: Math.min(b.y, view.y), w: Math.max(b.x + b.w, view.x + view.w) - Math.min(b.x, view.x), h: Math.max(b.y + b.h, view.y + view.h) - Math.min(b.y, view.y) } : view;
    const pad = 10;
    const k = Math.min((W - pad * 2) / u.w, (H - pad * 2) / u.h);
    const ox = (W - u.w * k) / 2 - u.x * k, oy = (H - u.h * k) / 2 - u.y * k;
    this.mapT = { k, ox, oy };
    const step = Math.max(1, Math.floor(objs.length / 1500));
    for (let i = 0; i < objs.length; i += step) {
      const o = objs[i];
      const bb = app.scene.bounds(o);
      ctx.fillStyle = o.type === 'sticky' ? o.s.fill : o.type === 'stroke' ? (o.s.color || '#333') : o.type === 'frame' ? 'rgba(120,125,135,.18)' : o.type === 'shape' ? '#c3c8d0' : '#9aa0a6';
      ctx.globalAlpha = o.type === 'stroke' ? 0.7 : 1;
      ctx.fillRect(bb.x * k + ox, bb.y * k + oy, Math.max(1.5, bb.w * k), Math.max(1.5, bb.h * k));
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#4262ff';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(66,98,255,.10)';
    ctx.fillRect(view.x * k + ox, view.y * k + oy, view.w * k, view.h * k);
    ctx.strokeRect(view.x * k + ox, view.y * k + oy, view.w * k, view.h * k);
  }

  bindMinimap() {
    const app = this.app;
    const go = (e) => {
      if (!this.mapT) return;
      const r = this.miniCv.getBoundingClientRect();
      const sx = ((e.clientX - r.left) / r.width) * this.miniCv.width;
      const sy = ((e.clientY - r.top) / r.height) * this.miniCv.height;
      const wx = (sx - this.mapT.ox) / this.mapT.k, wy = (sy - this.mapT.oy) / this.mapT.k;
      app.cam.x = wx - app.cam.w / 2 / app.cam.z;
      app.cam.y = wy - app.cam.h / 2 / app.cam.z;
      app.cameraChanged();
    };
    this.miniCv.addEventListener('pointerdown', (e) => { this.miniCv.setPointerCapture(e.pointerId); this.miniDrag = true; go(e); });
    this.miniCv.addEventListener('pointermove', (e) => { if (this.miniDrag) go(e); });
    this.miniCv.addEventListener('pointerup', () => { this.miniDrag = false; });
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
      row(t('browserPrediction'), toggle('browserPrediction')),
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
      h('h3', null, t('shortcuts')),
      h('div', { class: 'keys' }, list('keys').map(([k, d]) => h('div', { class: 'krow' }, h('kbd', null, k), h('span', null, d)))));
    const back = h('div', { class: 'backdrop' }, modal);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); e.stopPropagation(); });
    root.append(back);
  }
}
