import { uid } from './util.js';
import {
  aabbOf, pointInRotRect, distToPolyline, rectsIntersect, rotatePoint, polylineBounds,
} from './geometry.js';

export const STICKY_COLORS = ['#fff1a8', '#ffd0a6', '#ffb8c6', '#d8c4ff', '#b8dcff', '#b9f0d0', '#e3f59a', '#e6e6e6'];
export const PALETTE = ['#1a1a1a', '#e03131', '#f08c00', '#2f9e44', '#1971c2', '#6741d9', '#c2255c', '#868e96'];

const PORT_DIR = { t: [0, -1], r: [1, 0], b: [0, 1], l: [-1, 0] };
export const PORTS = ['t', 'r', 'b', 'l'];

// Точка порта в мировых координатах и наружное направление
export function portInfo(o, port) {
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  let px = cx, py = cy;
  if (port === 't') py = o.y;
  else if (port === 'b') py = o.y + o.h;
  else if (port === 'l') px = o.x;
  else if (port === 'r') px = o.x + o.w;
  const rot = o.rot || 0;
  const [x, y] = rotatePoint(px, py, cx, cy, rot);
  const d = PORT_DIR[port] || [0, 0];
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x, y, dir: [d[0] * c - d[1] * s, d[0] * s + d[1] * c] };
}

export function isConnectable(o) {
  return o.type === 'shape' || o.type === 'sticky' || o.type === 'text' || o.type === 'image' || o.type === 'frame';
}

export class Scene {
  constructor() {
    this.objs = new Map();
    this._sorted = null;
    this.zc = 0;
    this.connectors = new Set();
    this.listeners = new Set();
    this.version = 0;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(kind, o) {
    this.version++;
    for (const fn of this.listeners) fn(kind, o);
  }

  get(id) { return this.objs.get(id); }

  all() {
    if (!this._sorted) {
      this._sorted = [...this.objs.values()].sort((a, b) => a.z - b.z);
    }
    return this._sorted;
  }

  nextZ() { return ++this.zc; }
  minZ() { let m = 0; for (const o of this.objs.values()) if (o.z < m) m = o.z; return m - 1; }

  add(o, silent) {
    if (!o.id) o.id = uid();
    if (o.z == null) o.z = this.nextZ();
    else if (o.z > this.zc) this.zc = o.z;
    this.objs.set(o.id, o);
    if (o.type === 'connector') this.connectors.add(o.id);
    this._sorted = null;
    this.invalidate(o);
    if (!silent) this.emit('add', o);
    return o;
  }

  remove(id, silent) {
    const o = this.objs.get(id);
    if (!o) return;
    this.objs.delete(id);
    this.connectors.delete(id);
    this._sorted = null;
    // коннекторы, привязанные к удалённому объекту, фиксируются в последней точке
    for (const cid of this.connectors) {
      const c = this.objs.get(cid);
      if (!c) continue;
      for (const key of ['from', 'to']) {
        if (c[key].id === id) {
          const r = this.route(c);
          const n = r.pts.length;
          const p = key === 'from' ? [r.pts[0], r.pts[1]] : [r.pts[n - 2], r.pts[n - 1]];
          c[key] = { x: p[0], y: p[1] };
          c._route = null;
          c._b = null;
        }
      }
    }
    if (!silent) this.emit('remove', o);
  }

  // Сбросить кэши объекта и привязанных коннекторов; вызывать после любого изменения геометрии.
  invalidate(o, translateOnly) {
    o._b = null;
    o._route = null;
    if (!translateOnly) {
      o._path = null;
      o._layout = null;
    }
    if (o.type !== 'connector') {
      for (const cid of this.connectors) {
        const c = this.objs.get(cid);
        if (c && (c.from.id === o.id || c.to.id === o.id)) { c._route = null; c._b = null; }
      }
    }
  }

  touch(o, silent, translateOnly) {
    this.invalidate(o, translateOnly);
    if (!silent) this.emit('update', o);
  }

  reorder() { this._sorted = null; }

  bounds(o) {
    if (o._b) return o._b;
    let b;
    if (o.type === 'connector') {
      const r = this.route(o);
      b = polylineBounds(r.pts, 2);
      const pad = (o.s.sw || 2) * 2 + 8;
      b = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    } else {
      b = aabbOf(o);
    }
    o._b = b;
    return b;
  }

  boundsOf(list) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of list) {
      const b = this.bounds(o);
      if (b.x < x0) x0 = b.x;
      if (b.y < y0) y0 = b.y;
      if (b.x + b.w > x1) x1 = b.x + b.w;
      if (b.y + b.h > y1) y1 = b.y + b.h;
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  query(rect) {
    const out = [];
    for (const o of this.all()) if (rectsIntersect(this.bounds(o), rect)) out.push(o);
    return out;
  }

  groupMembers(o) {
    if (!o.group) return [o];
    const out = [];
    for (const p of this.objs.values()) if (p.group === o.group) out.push(p);
    return out;
  }

  // ---- коннекторы ----
  resolveEnd(end, other) {
    if (end.id) {
      const t = this.objs.get(end.id);
      if (t) {
        let port = end.port;
        if (!port || port === 'c') {
          // ближайший порт к другому концу
          let best = 1e18;
          for (const p of PORTS) {
            const pi = portInfo(t, p);
            const d = Math.hypot(pi.x - other.x, pi.y - other.y);
            if (d < best) { best = d; port = p; }
          }
        }
        return portInfo(t, port);
      }
    }
    return { x: end.x ?? 0, y: end.y ?? 0, dir: null };
  }

  route(c) {
    if (c._route) return c._route;
    const fa = c.from.id ? this.objs.get(c.from.id) : null;
    const ta = c.to.id ? this.objs.get(c.to.id) : null;
    const rough = (e, t) => (t ? { x: t.x + t.w / 2, y: t.y + t.h / 2 } : { x: e.x ?? 0, y: e.y ?? 0 });
    const a = this.resolveEnd(c.from, rough(c.to, ta));
    const b = this.resolveEnd(c.to, rough(c.from, fa));
    c._route = buildRoute(c.kind, a, b);
    return c._route;
  }

  // ---- поиск объекта под курсором ----
  hit(wx, wy, zoom, opts = {}) {
    const tol = 5 / zoom;
    const list = this.all();
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i];
      if (opts.skip && opts.skip(o)) continue;
      if (this.hitTest(o, wx, wy, tol, zoom)) return o;
    }
    return null;
  }

  hitTest(o, wx, wy, tol, zoom = 1) {
    const b = this.bounds(o);
    if (wx < b.x - tol || wy < b.y - tol || wx > b.x + b.w + tol || wy > b.y + b.h + tol) {
      // заголовок рамки лежит выше её границ
      if (!(o.type === 'frame' && wy >= o.y - 30 / zoom && wy <= o.y && wx >= o.x && wx <= o.x + Math.min(o.w, 260 / zoom))) return false;
    }
    switch (o.type) {
      case 'stroke': {
        const r = o.s.size / 2 + tol;
        return distToPolyline(wx, wy, o.pts, 3) <= Math.max(r, tol + 1);
      }
      case 'connector': {
        const r = this.route(o);
        return distToPolyline(wx, wy, r.pts, 2) <= (o.s.sw || 2) / 2 + tol + 2;
      }
      case 'frame': {
        const inside = pointInRotRect(wx, wy, o, tol);
        const inner = pointInRotRect(wx, wy, { x: o.x + tol, y: o.y + tol, w: o.w - 2 * tol, h: o.h - 2 * tol, rot: o.rot }, 0);
        const titleH = 26 / zoom;
        const inTitle = wx >= o.x && wx <= o.x + Math.min(o.w, 260 / zoom) && wy >= o.y - titleH && wy <= o.y;
        return (inside && !inner) || inTitle;
      }
      case 'shape': {
        const filled = o.s.fill && o.s.fill !== 'transparent';
        if (filled || o.text) return pointInRotRect(wx, wy, o, tol);
        const outer = pointInRotRect(wx, wy, o, tol);
        const inner = pointInRotRect(wx, wy, { x: o.x + tol, y: o.y + tol, w: o.w - 2 * tol, h: o.h - 2 * tol, rot: o.rot }, 0);
        return outer && !inner;
      }
      default:
        return pointInRotRect(wx, wy, o, tol);
    }
  }

  // ---- (де)сериализация ----
  toJSON() {
    return this.all().map(serializeObj);
  }

  shiftAll(dx, dy) {
    for (const o of this.objs.values()) {
      shiftObj(o, dx, dy);
      this.invalidate(o);
    }
  }

  // Быстрая сериализация без клонирования объектов; служебные поля с «_» пропускаются
  toJSONString(extra = {}) {
    return JSON.stringify({ v: 1, objects: this.all(), ...extra }, (k, v) => (k.charCodeAt(0) === 95 ? undefined : v));
  }

  load(objects) {
    this.objs.clear();
    this.connectors.clear();
    this._sorted = null;
    this.zc = 0;
    for (const o of objects) this.add(o, true);
    this.emit('load');
  }
}

// Сдвиг объекта на (-dx, -dy). Применяется при переносе начала координат (см. App.rebase).
export function shiftObj(o, dx, dy) {
  if (o.type === 'connector') {
    for (const k of ['from', 'to']) {
      const e = o[k];
      if (e && !e.id) { e.x -= dx; e.y -= dy; }
    }
    return;
  }
  o.x -= dx;
  o.y -= dy;
  if (o.type === 'stroke') {
    const p = o.pts;
    for (let i = 0; i < p.length; i += 3) { p[i] -= dx; p[i + 1] -= dy; }
  }
}

export function serializeObj(o) {
  const out = {};
  for (const k in o) if (k[0] !== '_') out[k] = o[k];
  return structuredClone(out);
}

function sampleBezier(a, c1, c2, b, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push(
      u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y
    );
  }
  return pts;
}

// ближайшая ось к вектору (dx,dy)
function axisDir(dx, dy) {
  return Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
}

export function buildRoute(kind, a, b) {
  if (kind === 'curve') {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const k = Math.max(30, dist * 0.4);
    const da = a.dir || (dist ? [(b.x - a.x) / dist, (b.y - a.y) / dist] : [1, 0]);
    const db = b.dir || (dist ? [(a.x - b.x) / dist, (a.y - b.y) / dist] : [-1, 0]);
    const c1 = { x: a.x + da[0] * k, y: a.y + da[1] * k };
    const c2 = { x: b.x + db[0] * k, y: b.y + db[1] * k };
    return { pts: sampleBezier(a, c1, c2, b), curve: [a.x, a.y, c1.x, c1.y, c2.x, c2.y, b.x, b.y] };
  }
  if (kind === 'elbow') {
    const da = a.dir || axisDir(b.x - a.x, b.y - a.y);
    const db = b.dir || axisDir(a.x - b.x, a.y - b.y);
    const d = 24;
    const p1 = [a.x + da[0] * d, a.y + da[1] * d];
    const p2 = [b.x + db[0] * d, b.y + db[1] * d];
    const pts = [a.x, a.y, p1[0], p1[1]];
    const aH = da[0] !== 0, bH = db[0] !== 0;
    if (aH && bH) {
      const mx = (p1[0] + p2[0]) / 2;
      pts.push(mx, p1[1], mx, p2[1]);
    } else if (!aH && !bH) {
      const my = (p1[1] + p2[1]) / 2;
      pts.push(p1[0], my, p2[0], my);
    } else if (aH) pts.push(p2[0], p1[1]);
    else pts.push(p1[0], p2[1]);
    pts.push(p2[0], p2[1], b.x, b.y);
    return { pts, curve: null };
  }
  return { pts: [a.x, a.y, b.x, b.y], curve: null };
}

// ---- фабрики объектов ----
export function makeShape(shape, x, y, w, h, extra = {}) {
  return {
    id: uid(), type: 'shape', shape, x, y, w, h, rot: 0, text: '',
    s: { fill: '#ffffff', stroke: '#1a1a1a', sw: 2, dash: 'solid', opacity: 1 },
    ts: { size: 18, color: '#1a1a1a', bold: false, italic: false, align: 'center', font: 'sans' },
    ...extra,
  };
}

export function makeSticky(x, y, color = STICKY_COLORS[0], size = 180) {
  return {
    id: uid(), type: 'sticky', x, y, w: size, h: size, rot: 0, text: '',
    s: { fill: color, opacity: 1 },
    ts: { size: 22, color: '#1a1a1a', bold: false, italic: false, align: 'center', font: 'hand', auto: true },
  };
}

export function makeText(x, y, w = 240) {
  return {
    id: uid(), type: 'text', x, y, w, h: 32, rot: 0, text: '',
    s: { opacity: 1 },
    ts: { size: 24, color: '#1a1a1a', bold: false, italic: false, align: 'left', font: 'sans' },
  };
}

export function makeFrame(x, y, w, h, title = '') {
  return { id: uid(), type: 'frame', x, y, w, h, rot: 0, title, s: { fill: '#ffffff', stroke: '#9aa0a6', sw: 1 }, ts: { size: 14 } };
}

export function makeConnector(from, to, kind = 'elbow', head = true) {
  return {
    id: uid(), type: 'connector', x: 0, y: 0, w: 0, h: 0, rot: 0, kind, from, to, head: head ? 'arrow' : 'none', tail: 'none',
    s: { stroke: '#1a1a1a', sw: 2, dash: 'solid', opacity: 1 },
  };
}
