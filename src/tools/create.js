import { makeShape, makeSticky, makeText, makeFrame, makeConnector, isConnectable, portInfo, PORTS } from '../core/scene.js';
import { drawObject } from '../render/draw.js';
import { normalizeRect } from '../core/geometry.js';

const ACCENT = '#4262ff';

// Цель для подключения коннектора: порт рядом с курсором или тело объекта (автопорт)
export function connectTarget(app, wx, wy, excludeId) {
  const z = app.cam.z;
  const o = app.scene.hit(wx, wy, z, { skip: (p) => !isConnectable(p) || p.id === excludeId });
  if (!o) {
    // порты рядом, но курсор чуть снаружи
    const near = app.scene.query({ x: wx - 30 / z, y: wy - 30 / z, w: 60 / z, h: 60 / z });
    for (const p of near) {
      if (!isConnectable(p) || p.id === excludeId) continue;
      for (const port of PORTS) {
        const pi = portInfo(p, port);
        if (Math.hypot(pi.x - wx, pi.y - wy) * z < 18) return { id: p.id, port, x: pi.x, y: pi.y };
      }
    }
    return null;
  }
  let best = null, bd = 1e18;
  for (const port of PORTS) {
    const pi = portInfo(o, port);
    const d = Math.hypot(pi.x - wx, pi.y - wy);
    if (d < bd) { bd = d; best = { port, x: pi.x, y: pi.y }; }
  }
  if (bd * z < 22) return { id: o.id, port: best.port, x: best.x, y: best.y };
  return { id: o.id, port: 'c', x: wx, y: wy };
}

// Общая база для инструментов «потянул, получил объект»
class DragCreate {
  constructor(app) {
    this.app = app;
    this.start = null;
    this.preview = null;
  }
  get cursor() { return 'crosshair'; }
  rectFrom(ev, keepAspect) {
    let x1 = ev.wx, y1 = ev.wy;
    const { x: x0, y: y0 } = this.start;
    if (keepAspect || ev.shift) {
      const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      x1 = x0 + Math.sign(x1 - x0 || 1) * d;
      y1 = y0 + Math.sign(y1 - y0 || 1) * d;
    }
    return normalizeRect(x0, y0, x1, y1);
  }
  down(ev) { this.start = { x: ev.wx, y: ev.wy, sx: ev.x, sy: ev.y }; this.dragged = false; }
  moved(ev) { return Math.hypot(ev.x - this.start.sx, ev.y - this.start.sy) > 4; }
  cancel() { this.start = null; this.preview = null; this.app.renderer.markUI(); }
  drawOverlay(ctx) {
    if (this.preview) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      drawObject(ctx, this.preview, this.app.renderer.view());
      ctx.restore();
    }
  }
  finish(o) {
    const app = this.app;
    const tx = app.history.begin();
    app.scene.add(o);
    tx.add(o);
    tx.commit();
    app.select([o]);
    this.start = null;
    this.preview = null;
    app.touched();
    return tx;
  }
}

export class ShapeTool extends DragCreate {
  constructor(app) { super(app); this.name = 'shape'; }
  build(rect) {
    const d = this.app.defaults;
    const o = makeShape(d.shape, rect.x, rect.y, rect.w, rect.h);
    o.s = { ...o.s, fill: d.shapeFill, stroke: d.shapeStroke };
    return o;
  }
  move(ev) {
    if (!this.start) return;
    if (!this.dragged && this.moved(ev)) this.dragged = true;
    if (this.dragged) {
      const r = this.rectFrom(ev);
      this.preview = this.build({ x: r.x, y: r.y, w: Math.max(r.w, 2), h: Math.max(r.h, 2) });
      this.app.renderer.markUI();
    }
  }
  up(ev) {
    if (!this.start) return;
    let r;
    if (this.dragged) r = this.rectFrom(ev);
    else r = { x: this.start.x - 80, y: this.start.y - 60, w: 160, h: 120 };
    const o = this.build({ x: r.x, y: r.y, w: Math.max(r.w, 16), h: Math.max(r.h, 16) });
    this.finish(o);
    this.app.setTool('select');
  }
}

export class FrameTool extends DragCreate {
  constructor(app) { super(app); this.name = 'frame'; }
  move(ev) {
    if (!this.start) return;
    if (!this.dragged && this.moved(ev)) this.dragged = true;
    if (this.dragged) {
      const r = this.rectFrom(ev);
      this.preview = makeFrame(r.x, r.y, r.w, r.h, '');
      this.app.renderer.markUI();
    }
  }
  up(ev) {
    if (!this.start) return;
    const r = this.dragged ? this.rectFrom(ev) : { x: this.start.x - 300, y: this.start.y - 200, w: 600, h: 400 };
    const f = makeFrame(r.x, r.y, Math.max(r.w, 40), Math.max(r.h, 40), '');
    f.z = this.app.scene.minZ();
    this.finish(f);
    this.app.setTool('select');
    this.app.beginTextEdit(f);
  }
}

export class StickyTool extends DragCreate {
  constructor(app) { super(app); this.name = 'sticky'; this.hoverPt = null; }
  hover(ev) { this.hoverPt = { x: ev.wx, y: ev.wy }; this.app.renderer.markUI(); }
  up(ev) {
    if (!this.start) return;
    const size = this.app.defaults.stickySize;
    const o = makeSticky(this.start.x - size / 2, this.start.y - size / 2, this.app.defaults.stickyColor, size);
    this.finish(o);
    this.app.setTool('select');
    this.app.beginTextEdit(o);
  }
  move() {}
  drawOverlay(ctx) {
    if (!this.hoverPt) return;
    const size = this.app.defaults.stickySize;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = this.app.defaults.stickyColor;
    ctx.fillRect(this.hoverPt.x - size / 2, this.hoverPt.y - size / 2, size, size);
    ctx.restore();
  }
}

export class TextTool extends DragCreate {
  constructor(app) { super(app); this.name = 'text'; }
  get cursor() { return 'text'; }
  move(ev) {
    if (!this.start) return;
    if (!this.dragged && this.moved(ev)) this.dragged = true;
    if (this.dragged) {
      const r = this.rectFrom(ev);
      this.preview = { ...makeText(r.x, r.y, Math.max(r.w, 40)), h: Math.max(r.h, 28), text: '' };
      this.app.renderer.markUI();
    }
  }
  up(ev) {
    if (!this.start) return;
    const x = this.dragged ? Math.min(this.start.x, ev.wx) : this.start.x;
    const y = this.dragged ? Math.min(this.start.y, ev.wy) : this.start.y - 14;
    const w = this.dragged ? Math.abs(ev.wx - this.start.x) : 240;
    const o = makeText(x, y, Math.max(w, 40));
    o.ts.color = this.app.defaults.textColor;
    this.finish(o);
    this.app.setTool('select');
    this.app.beginTextEdit(o, { fresh: true });
  }
  drawOverlay(ctx) {
    if (this.preview) {
      ctx.save();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1 / this.app.cam.z;
      ctx.setLineDash([4 / this.app.cam.z, 3 / this.app.cam.z]);
      ctx.strokeRect(this.preview.x, this.preview.y, this.preview.w, this.preview.h);
      ctx.restore();
    }
  }
}

// Линии и стрелки: kind = 'straight' | 'elbow' | 'curve'; head = bool
export class ConnectorTool extends DragCreate {
  constructor(app) { super(app); this.name = 'connector'; this.snap = null; }
  down(ev) {
    super.down(ev);
    const t = connectTarget(this.app, ev.wx, ev.wy, null);
    this.from = t && t.id ? { id: t.id, port: t.port } : { x: ev.wx, y: ev.wy };
  }
  build(to) {
    const d = this.app.defaults;
    const c = makeConnector(this.from, to, d.connKind, d.connHead);
    c.s.stroke = d.connColor;
    return c;
  }
  move(ev) {
    if (!this.start) return;
    if (!this.dragged && this.moved(ev)) this.dragged = true;
    if (!this.dragged) return;
    const t = connectTarget(this.app, ev.wx, ev.wy, this.from.id);
    this.snap = t;
    let wx = ev.wx, wy = ev.wy;
    if (ev.shift && !t) {
      const dx = wx - this.start.x, dy = wy - this.start.y;
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const l = Math.hypot(dx, dy);
      wx = this.start.x + Math.cos(a) * l;
      wy = this.start.y + Math.sin(a) * l;
    }
    const to = t && t.id ? { id: t.id, port: t.port } : { x: wx, y: wy };
    this.preview = this.build(to);
    this.app.renderer.markUI();
  }
  up(ev) {
    if (!this.start) return;
    if (!this.dragged) { this.cancel(); return; }
    const c = this.preview;
    this.snap = null;
    if (c) this.finish(c);
    this.app.setTool('select');
  }
  drawOverlay(ctx) {
    if (this.preview) {
      drawObject(ctx, this.preview, { ...this.app.renderer.view() });
    }
    if (this.snap && this.snap.id) {
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2 / this.app.cam.z;
      ctx.beginPath();
      ctx.arc(this.snap.x, this.snap.y, 6 / this.app.cam.z, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}

export class HandTool {
  constructor(app) { this.app = app; this.name = 'hand'; this.last = null; }
  get cursor() { return this.last ? 'grabbing' : 'grab'; }
  down(ev) { this.last = { x: ev.x, y: ev.y }; this.app.input.updateCursor(); }
  move(ev) {
    if (!this.last) return;
    this.app.panBy(ev.x - this.last.x, ev.y - this.last.y);
    this.last = { x: ev.x, y: ev.y };
  }
  up() { this.last = null; this.app.input.updateCursor(); }
  cancel() { this.last = null; }
}
