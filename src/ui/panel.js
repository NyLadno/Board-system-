import { h } from '../core/util.js';
import { icon } from './icons.js';
import { t } from '../i18n.js';
import { popover, closePopover } from './pop.js';
import { PALETTE, STICKY_COLORS } from '../core/scene.js';

const FILLS = ['#ffffff', '#fff1a8', '#ffd0a6', '#ffb8c6', '#d8c4ff', '#b8dcff', '#b9f0d0', '#e3f59a', '#dadde1', '#1a1a1a'];

export function swatches(colors, current, onPick, { none = false, custom = true } = {}) {
  const wrap = h('div', { class: 'swatches' });
  if (none) {
    wrap.append(h('button', {
      class: 'sw none' + (current === 'transparent' ? ' on' : ''), title: t('noFill'),
      onclick: () => onPick('transparent'),
    }));
  }
  for (const c of colors) {
    wrap.append(h('button', {
      class: 'sw' + (c.toLowerCase() === String(current).toLowerCase() ? ' on' : ''),
      style: { background: c }, title: c,
      onclick: () => onPick(c),
    }));
  }
  if (custom) {
    const inp = h('input', { type: 'color', class: 'sw custom', value: /^#[0-9a-f]{6}$/i.test(current) ? current : '#4262ff', title: t('color') });
    inp.addEventListener('input', () => onPick(inp.value));
    wrap.append(inp);
  }
  return wrap;
}

export function slider(min, max, value, onInput, onChange, step = 1) {
  const inp = h('input', { type: 'range', min, max, step, value, class: 'range' });
  inp.addEventListener('input', () => onInput(Number(inp.value)));
  if (onChange) inp.addEventListener('change', () => onChange(Number(inp.value)));
  return inp;
}

function btn(name, title, onclick, on = false, text = '') {
  const b = h('button', { class: 'tb' + (on ? ' on' : ''), title, html: icon(name, 18) + (text ? `<span>${text}</span>` : '') });
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onclick);
  return b;
}

function colorBtn(color, title, onclick, ring = false) {
  const b = h('button', { class: 'tb color', title });
  const dot = h('i', { class: 'dot' + (ring ? ' ring' : ''), style: ring ? { borderColor: color } : { background: color === 'transparent' ? '' : color } });
  if (color === 'transparent') dot.classList.add('none');
  b.append(dot);
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onclick);
  return b;
}

// Плавающая панель над выделением. Пересобирается только когда меняется «подпись» выделения.
export class ContextPanel {
  constructor(app, host) {
    this.app = app;
    this.el = h('div', { class: 'ctx-panel', hidden: true });
    host.append(this.el);
    this.sig = '';
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  signature(sel) {
    const parts = [sel.length, this.app.single()?.id];
    for (const o of sel) {
      parts.push(o.type, o.locked ? 1 : 0, o.group ? 1 : 0);
      if (o.s) parts.push(o.s.fill, o.s.stroke, o.s.color, o.s.sw, o.s.size, o.s.dash);
      if (o.ts) parts.push(o.ts.size, o.ts.color, o.ts.bold, o.ts.italic, o.ts.align, o.ts.font);
      if (o.type === 'connector') parts.push(o.kind, o.head);
    }
    return parts.join('|');
  }

  update(force) {
    const app = this.app;
    const sel = app.selectedObjs();
    if (!sel.length || app.toolName !== 'select' && app.toolName !== 'hand') { this.hide(); return; }
    const sig = this.signature(sel);
    if (sig !== this.sig || force) {
      this.sig = sig;
      this.build(sel);
    }
    this.el.hidden = false;
    this.position(sel);
  }

  hide() { this.el.hidden = true; this.sig = ''; }

  position(sel) {
    const app = this.app;
    if (app.interacting) { this.el.style.visibility = 'hidden'; return; }
    this.el.style.visibility = '';
    const b = app.scene.boundsOf(sel);
    if (!b) return;
    const cam = app.cam;
    const [sx, sy] = cam.toScreen(b.x + b.w / 2, b.y);
    const [, by] = cam.toScreen(0, b.y + b.h);
    const pw = this.el.offsetWidth, ph = this.el.offsetHeight;
    let x = sx - pw / 2;
    let y = sy - ph - 52; // выше ручки поворота
    if (y < 60) y = by + 16;
    x = Math.max(76, Math.min(cam.w - pw - 12, x));
    y = Math.max(60, Math.min(cam.h - ph - 12, y));
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  build(sel) {
    const app = this.app;
    closePopover();
    const el = this.el;
    el.textContent = '';
    const types = new Set(sel.map((o) => o.type));
    const has = (...ts) => sel.some((o) => ts.includes(o.type));
    const first = sel[0];
    const single = sel.length === 1 ? first : null;
    const sep = () => h('span', { class: 'sep' });
    const locked = sel.every((o) => o.locked);

    // ----- заливка -----
    if (has('shape', 'sticky', 'frame')) {
      const cur = first.s.fill;
      const b = colorBtn(cur, t('fill'), () => {
        const sticky = types.size === 1 && types.has('sticky');
        popover(b, swatches(sticky ? STICKY_COLORS : FILLS, cur, (c) => {
          app.applyStyle((o) => { if (o.s.fill !== undefined) o.s.fill = c; });
          if (sticky) { app.defaults.stickyColor = c; app.saveDefaults(); }
        }, { none: !sticky && !types.has('frame') }), { place: 'above' });
      });
      el.append(b);
    }
    // ----- контур -----
    if (has('shape', 'connector')) {
      const o = sel.find((x) => x.type === 'shape' || x.type === 'connector');
      const cur = o.s.stroke;
      const b = colorBtn(cur, t('stroke'), () => {
        popover(b, swatches(PALETTE, cur, (c) => app.applyStyle((x) => { if (x.s.stroke !== undefined) x.s.stroke = c; })), { place: 'above' });
      }, true);
      el.append(b);
    }
    if (has('stroke')) {
      const o = sel.find((x) => x.type === 'stroke');
      const b = colorBtn(o.s.color, t('color'), () => {
        popover(b, swatches(PALETTE, o.s.color, (c) => app.applyStyle((x) => { if (x.type === 'stroke') x.s.color = c; })), { place: 'above' });
      });
      el.append(b);
    }
    if (has('shape', 'connector', 'stroke')) {
      const o = sel.find((x) => ['shape', 'connector', 'stroke'].includes(x.type));
      const key = o.type === 'stroke' ? 'size' : 'sw';
      const max = o.type === 'stroke' ? 60 : 14;
      const b = btn('line', t('size'), () => {
        const wrap = h('div', { class: 'pop-row' }, h('span', { class: 'lbl' }, t('size')));
        const val = h('span', { class: 'val' }, String(Math.round(o.s[key])));
        wrap.append(slider(o.type === 'shape' ? 0 : 1, max, o.s[key], (v) => {
          val.textContent = String(v);
          app.applyStyle((x) => {
            if (x.type === 'stroke') {
              // толщина штриха меняется пропорционально вместе с радиусами точек
              const k = v / x.s.size;
              x.s.size = v;
              for (let i = 2; i < x.pts.length; i += 3) x.pts[i] *= k;
            } else if (x.s.sw !== undefined) x.s.sw = v;
          }, { live: true });
        }, () => app.commitLiveStyle()), val);
        popover(b, wrap, { place: 'above' });
      });
      el.append(b);
    }
    if (has('shape', 'connector')) {
      const o = sel.find((x) => x.type === 'shape' || x.type === 'connector');
      const next = { solid: 'dashed', dashed: 'dotted', dotted: 'solid' };
      el.append(btn(o.s.dash || 'solid', t('lineSolid') + ' / ' + t('lineDashed'), () => app.applyStyle((x) => { if (x.s.dash !== undefined) x.s.dash = next[x.s.dash || 'solid']; })));
    }
    // ----- коннектор -----
    if (has('connector')) {
      const c = sel.find((x) => x.type === 'connector');
      el.append(sep());
      for (const [k, ic, title] of [['straight', 'straight', t('connStraight')], ['elbow', 'elbow', t('connElbow')], ['curve', 'curve', t('connCurve')]]) {
        el.append(btn(ic, title, () => app.applyStyle((x) => { if (x.type === 'connector') x.kind = k; }), c.kind === k));
      }
      el.append(btn('arrowEnd', t('arrowEnd'), () => app.applyStyle((x) => { if (x.type === 'connector') x.head = x.head === 'none' ? 'arrow' : 'none'; }), c.head !== 'none'));
    }
    // ----- текст -----
    if (has('shape', 'sticky', 'text')) {
      const o = sel.find((x) => x.ts);
      el.append(sep());
      const size = h('span', { class: 'fs' }, String(o.ts.size));
      el.append(
        btn('minus', t('fontSize'), () => app.applyStyle((x) => { if (x.ts) x.ts.size = Math.max(8, x.ts.size - (x.ts.size > 30 ? 4 : 2)); })),
        size,
        btn('plus', t('fontSize'), () => app.applyStyle((x) => { if (x.ts) x.ts.size = Math.min(200, x.ts.size + (x.ts.size >= 30 ? 4 : 2)); })),
        btn('bold', t('bold'), () => app.applyStyle((x) => { if (x.ts) x.ts.bold = !o.ts.bold; }), o.ts.bold),
        btn('italic', t('italic'), () => app.applyStyle((x) => { if (x.ts) x.ts.italic = !o.ts.italic; }), o.ts.italic),
      );
      const aligns = ['left', 'center', 'right'];
      const nextA = aligns[(aligns.indexOf(o.ts.align || 'left') + 1) % 3];
      el.append(btn({ left: 'alignLeft', center: 'alignCenter', right: 'alignRight' }[o.ts.align || 'left'], t('alignCenter'), () => app.applyStyle((x) => { if (x.ts) x.ts.align = nextA; })));
      const cb = colorBtn(o.ts.color, t('textColor'), () => {
        popover(cb, swatches(PALETTE, o.ts.color, (c) => app.applyStyle((x) => { if (x.ts) x.ts.color = c; })), { place: 'above' });
      }, true);
      el.append(cb);
      const fonts = [['sans', t('fontSans')], ['serif', t('fontSerif')], ['mono', t('fontMono')], ['hand', t('fontHand')]];
      const sel2 = h('select', { class: 'font-select', title: t('fontSize') });
      for (const [v, label] of fonts) sel2.append(h('option', { value: v, selected: o.ts.font === v }, label));
      sel2.addEventListener('change', () => app.applyStyle((x) => { if (x.ts) x.ts.font = sel2.value; }));
      el.append(sel2);
    }
    // ----- действия -----
    el.append(sep());
    if (sel.length > 1) {
      const b = btn('alignH', t('alignTitle'), () => {
        const grid = h('div', { class: 'tb-grid' });
        for (const m of ['alignL', 'alignH', 'alignR', 'alignT', 'alignV', 'alignB', 'distH', 'distV']) {
          grid.append(btn(m, t(m), () => app.alignSelection(m)));
        }
        popover(b, grid, { place: 'above' });
      });
      el.append(b);
      const grouped = sel.every((o) => o.group) && new Set(sel.map((o) => o.group)).size === 1;
      el.append(btn(grouped ? 'ungroup' : 'group', grouped ? t('ungroup') : t('group'), () => (grouped ? app.ungroup() : app.group())));
    }
    el.append(
      btn('front', t('toFront'), () => app.reorder(true)),
      btn('back', t('toBack'), () => app.reorder(false)),
      btn(locked ? 'unlock' : 'lock', locked ? t('unlock') : t('lock'), () => app.toggleLock(), locked),
      btn('copy', t('dup'), () => app.duplicateSelection()),
      btn('trash', t('del'), () => app.deleteSelection()),
    );
  }
}
