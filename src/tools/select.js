import { rotatePoint, rectsIntersect, normalizeRect, rectContains, aabbOf } from '../core/geometry.js';
import { makeConnector, isConnectable, portInfo, PORTS, serializeObj } from '../core/scene.js';
import { textObjectHeight } from '../render/draw.js';
import { connectTarget } from './create.js';
import { uid } from '../core/util.js';

const ACCENT = '#4262ff';
const ROT_OFF = 28;
const HANDLES = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];

export function selectionFrame(app) {
  const objs = app.selectedObjs();
  if (!objs.length) return null;
  if (objs.length === 1) {
    const o = objs[0];
    if (o.type === 'connector') return null;
    if (o.type === 'stroke') return { x: o.x, y: o.y, w: o.w, h: o.h, rot: 0, single: o };
    return { x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot || 0, single: o };
  }
  const b = app.scene.boundsOf(objs);
  return { ...b, rot: 0, single: null };
}

function handleWorld(f, fx, fy) {
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  return rotatePoint(f.x + fx * f.w, f.y + fy * f.h, cx, cy, f.rot);
}

export function hitHandle(f, wx, wy, zoom) {
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  const [rx, ry] = rotatePoint(cx, f.y - ROT_OFF / zoom, cx, cy, f.rot);
  if (Math.hypot(rx - wx, ry - wy) * zoom < 11) return 'rot';
  const small = f.w * zoom < 36 || f.h * zoom < 36;
  for (const id in HANDLES) {
    if (small && id.length === 1) continue;
    const [hx, hy] = handleWorld(f, HANDLES[id][0], HANDLES[id][1]);
    if (Math.hypot(hx - wx, hy - wy) * zoom < 9) return id;
  }
  return null;
}

function cursorForHandle(id, rot) {
  if (id === 'rot') return 'grab';
  const base = { e: 0, w: 0, se: 1, nw: 1, s: 2, n: 2, ne: 3, sw: 3 }[id];
  const steps = Math.round((rot || 0) / (Math.PI / 4));
  return CURSORS[(((base + steps) % 4) + 4) % 4];
}

export class SelectTool {
  constructor(app) {
    this.app = app;
    this.name = 'select';
    this.mode = null;
    this.guides = [];
    this.marquee = null;
    this.snapTarget = null;
    this.cursorOverride = null;
    this._hoverAt = 0;
  }

  get cursor() { return this.cursorOverride || 'default'; }

  deactivate() { this.app.setHover(null); this.guides = []; this.marquee = null; }

  // ---------- нажатие ----------
  down(ev) {
    const app = this.app;
    const { scene, cam } = app;
    this.s0 = { wx: ev.wx, wy: ev.wy, x: ev.x, y: ev.y };
    this.dragged = false;
    this.clickPick = null;

    const sel = app.selectedObjs();
    const single = sel.length === 1 ? sel[0] : null;

    // ручки трансформации
    const f = selectionFrame(app);
    if (f && !sel.some((o) => o.locked)) {
      const h = hitHandle(f, ev.wx, ev.wy, cam.z);
      if (h) { this.beginHandle(h, f); return; }
    }
    // концы выделенного коннектора
    if (single && single.type === 'connector') {
      const r = scene.route(single);
      const n = r.pts.length;
      const ends = { from: [r.pts[0], r.pts[1]], to: [r.pts[n - 2], r.pts[n - 1]] };
      for (const k of ['from', 'to']) {
        if (Math.hypot(ends[k][0] - ev.wx, ends[k][1] - ev.wy) * cam.z < 10) { this.beginEndpoint(single, k, false); return; }
      }
    }
    // порты на наведённом или выделенном объекте создают коннектор
    const portOwner = (app.hoverId && scene.get(app.hoverId)) || (single && isConnectable(single) ? single : null);
    if (portOwner && isConnectable(portOwner) && portOwner.type !== 'frame') {
      for (const p of PORTS) {
        const pi = portInfo(portOwner, p);
        if (Math.hypot(pi.x - ev.wx, pi.y - ev.wy) * cam.z < 10) { this.beginNewConnector(portOwner, p); return; }
      }
    }

    const o = scene.hit(ev.wx, ev.wy, cam.z);
    if (o) {
      if (ev.dbl && app.canEditText(o)) { app.select([o]); app.beginTextEdit(o); this.mode = null; return; }
      if (ev.shift) {
        if (app.isSelected(o)) app.deselect([o]); else app.select([o], true);
        this.mode = null;
        return;
      }
      if (!app.isSelected(o)) app.select([o]);
      else if (sel.length > 1) this.clickPick = o;
      this.mode = 'pending-move';
    } else {
      if (ev.dbl) {
        const t = app.createTextAt(ev.wx, ev.wy);
        this.mode = null;
        return t;
      }
      if (!ev.shift) app.clearSelection();
      this.mode = 'marquee';
      this.marquee = { x0: ev.wx, y0: ev.wy, x1: ev.wx, y1: ev.wy, base: ev.shift ? new Set(app.selection) : new Set() };
    }
  }

  // ---------- движение ----------
  move(ev) {
    const app = this.app;
    if (!this.mode) return;
    if (!this.dragged) {
      if (Math.hypot(ev.x - this.s0.x, ev.y - this.s0.y) < 3) return;
      this.dragged = true;
      if (this.mode === 'pending-move') this.beginMove(ev);
    }
    switch (this.mode) {
      case 'move': this.doMove(ev); break;
      case 'marquee': this.doMarquee(ev); break;
      case 'resize': this.doResize(ev); break;
      case 'rotate': this.doRotate(ev); break;
      case 'endpoint': this.doEndpoint(ev); break;
    }
  }

  up(ev) {
    const app = this.app;
    const mode = this.mode;
    this.mode = null;
    if (!mode) return;
    if (mode === 'pending-move' || (!this.dragged && mode !== 'marquee')) {
      if (this.clickPick) app.select([this.clickPick]);
      this.cancelPending();
      return;
    }
    switch (mode) {
      case 'move': this.finishMove(); break;
      case 'resize': case 'rotate': this.finishTransform(); break;
      case 'endpoint': this.finishEndpoint(); break;
      case 'marquee': this.marquee = null; app.renderer.markUI(); break;
    }
    this.guides = [];
    this.snapTarget = null;
    app.renderer.markUI();
  }

  cancelPending() { this.tx = null; }

  cancel() {
    this.mode = null;
    this.marquee = null;
    this.guides = [];
  }

  // ---------- перемещение ----------
  movingSet(sel) {
    const { scene } = this.app;
    const set = new Map();
    for (const o of sel) set.set(o.id, o);
    // содержимое рамок едет вместе с ними
    for (const o of sel) {
      if (o.type !== 'frame') continue;
      for (const p of scene.all()) {
        if (set.has(p.id) || p.type === 'frame') continue;
        const b = scene.bounds(p);
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        if (cx >= o.x && cx <= o.x + o.w && cy >= o.y && cy <= o.y + o.h) set.set(p.id, p);
      }
    }
    return [...set.values()];
  }

  beginMove(ev) {
    const app = this.app;
    const { scene } = app;
    let sel = app.selectedObjs();
    if (sel.some((o) => o.locked)) { this.mode = null; return; }
    this.tx = app.history.begin();
    if (ev.alt) {
      // Alt: перетаскиваем копии
      const copies = app.cloneObjects(sel, 0, 0, this.tx);
      app.select(copies);
      sel = copies;
    }
    const set = this.movingSet(sel);
    this.tx.trackAll(set);
    this.snaps = set.map((o) => {
      const sn = { o, x: o.x, y: o.y };
      if (o.type === 'connector') { sn.from = { ...o.from }; sn.to = { ...o.to }; }
      return sn;
    });
    this.moveBounds = scene.boundsOf(set.filter((o) => o.type !== 'connector')) || scene.boundsOf(set);
    this.moveIds = new Set(set.map((o) => o.id));
    this.mode = 'move';
    app.input.setCursorTemp('move');
  }

  doMove(ev) {
    const app = this.app;
    let dx = ev.wx - this.s0.wx, dy = ev.wy - this.s0.wy;
    if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    this.guides = [];
    if (!ev.meta && this.moveBounds) {
      const snap = this.computeSnap(dx, dy);
      dx += snap.dx; dy += snap.dy;
    }
    for (const sn of this.snaps) {
      const o = sn.o;
      if (o.type === 'connector') {
        if (!o.from.id) o.from = { x: sn.from.x + dx, y: sn.from.y + dy };
        if (!o.to.id) o.to = { x: sn.to.x + dx, y: sn.to.y + dy };
        app.scene.invalidate(o, true);
        continue;
      }
      o.x = sn.x + dx;
      o.y = sn.y + dy;
      if (o.type === 'stroke') o._off = [dx, dy];
      app.scene.invalidate(o, true);
    }
    app.moved();
  }

  computeSnap(dx, dy) {
    const app = this.app;
    const { scene, cam } = app;
    const b = this.moveBounds;
    const mine = { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
    const thr = 6 / cam.z;
    const xs = [mine.x, mine.x + mine.w / 2, mine.x + mine.w];
    const ys = [mine.y, mine.y + mine.h / 2, mine.y + mine.h];
    let bestX = null, bestY = null;
    const near = scene.query(cam.viewRect(0)).filter((o) => !this.moveIds.has(o.id) && o.type !== 'connector' && o.type !== 'stroke').slice(0, 300);
    for (const o of near) {
      const ob = scene.bounds(o);
      const oxs = [ob.x, ob.x + ob.w / 2, ob.x + ob.w];
      const oys = [ob.y, ob.y + ob.h / 2, ob.y + ob.h];
      for (const mx of xs) for (const ox of oxs) {
        const d = ox - mx;
        if (Math.abs(d) < thr && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, pos: ox, ob };
      }
      for (const my of ys) for (const oy of oys) {
        const d = oy - my;
        if (Math.abs(d) < thr && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, pos: oy, ob };
      }
    }
    const out = { dx: 0, dy: 0 };
    if (bestX) {
      out.dx = bestX.d;
      const y0 = Math.min(mine.y, bestX.ob.y), y1 = Math.max(mine.y + mine.h, bestX.ob.y + bestX.ob.h);
      this.guides.push({ x0: bestX.pos, y0, x1: bestX.pos, y1 });
    }
    if (bestY) {
      out.dy = bestY.d;
      const x0 = Math.min(mine.x, bestY.ob.x), x1 = Math.max(mine.x + mine.w, bestY.ob.x + bestY.ob.w);
      this.guides.push({ x0, y0: bestY.pos, x1, y1: bestY.pos });
    }
    return out;
  }

  finishMove() {
    const app = this.app;
    for (const sn of this.snaps) {
      const o = sn.o;
      if (o.type === 'stroke' && o._off) {
        const [dx, dy] = o._off;
        for (let i = 0; i < o.pts.length; i += 3) { o.pts[i] += dx; o.pts[i + 1] += dy; }
        o._off = null;
        app.scene.invalidate(o);
      }
    }
    this.tx.commit();
    this.tx = null;
    this.snaps = null;
    app.input.updateCursor();
    app.touched();
    app.renderer.markScene();
  }

  // ---------- ручки ----------
  beginHandle(id, f) {
    const app = this.app;
    const sel = app.selectedObjs();
    this.tx = app.history.begin();
    this.tx.trackAll(sel);
    this.frame0 = { ...f };
    this.handle = id;
    this.transformSel = sel;
    this.snaps = sel.map((o) => {
      const sn = { o, x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot || 0 };
      if (o.type === 'stroke') { sn.pts = o.pts.slice(); sn.size = o.s.size; }
      return sn;
    });
    this.mode = id === 'rot' ? 'rotate' : 'resize';
    this.dragged = false;
  }

  doResize(ev) {
    const app = this.app;
    const f = this.frame0;
    const id = this.handle;
    const [hx, hy] = HANDLES[id];
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    const [lx, ly] = rotatePoint(ev.wx, ev.wy, cx, cy, -f.rot);
    // в локальных координатах исходного прямоугольника
    let l = f.x, r = f.x + f.w, t = f.y, b = f.y + f.h;
    const min = 6;
    if (hx === 1) r = Math.max(lx, l + min); else if (hx === 0) l = Math.min(lx, r - min);
    if (hy === 1) b = Math.max(ly, t + min); else if (hy === 0) t = Math.min(ly, b - min);
    const corner = id.length === 2;
    const single = f.single;
    const lockAspect = corner && (ev.shift || (single && single.type === 'image') || (single && single.type === 'sticky'));
    if (lockAspect) {
      const s = Math.max((r - l) / f.w, (b - t) / f.h);
      const nw = f.w * s, nh = f.h * s;
      if (hx === 1) r = l + nw; else l = r - nw;
      if (hy === 1) b = t + nh; else t = b - nh;
    }
    if (single && single.type !== 'stroke') {
      const ncx = (l + r) / 2, ncy = (t + b) / 2;
      const [wx, wy] = rotatePoint(ncx, ncy, cx, cy, f.rot);
      const w = r - l, h = b - t;
      single.w = w; single.h = h;
      single.x = wx - w / 2; single.y = wy - h / 2;
      if (single.type === 'text') single.h = textObjectHeight(single);
      app.scene.touch(single, true);
    } else {
      // масштабирование набора относительно противоположной стороны
      const sx = (r - l) / f.w, sy = (b - t) / f.h;
      const ax = hx === 1 ? f.x : hx === 0 ? f.x + f.w : f.x;
      const ay = hy === 1 ? f.y : hy === 0 ? f.y + f.h : f.y;
      const nx = hx === 0.5 ? 1 : sx, ny = hy === 0.5 ? 1 : sy;
      const axx = hx === 0.5 ? f.x : ax, ayy = hy === 0.5 ? f.y : ay;
      for (const sn of this.snaps) this.scaleAbout(sn, axx, ayy, nx, ny);
    }
    app.moved();
  }

  scaleAbout(sn, ax, ay, sx, sy) {
    const o = sn.o;
    if (o.type === 'connector') return;
    if (o.type === 'stroke') {
      const k = Math.sqrt(Math.abs(sx * sy));
      const p = sn.pts;
      const out = new Array(p.length);
      for (let i = 0; i < p.length; i += 3) {
        out[i] = ax + (p[i] - ax) * sx;
        out[i + 1] = ay + (p[i + 1] - ay) * sy;
        out[i + 2] = p[i + 2] * k;
      }
      o.pts = out;
      o.s.size = sn.size * k;
      o.x = ax + (sn.x - ax) * sx; o.y = ay + (sn.y - ay) * sy;
      o.w = sn.w * sx; o.h = sn.h * sy;
      if (sx < 0) o.x = ax + (sn.x + sn.w - ax) * sx;
      if (sy < 0) o.y = ay + (sn.y + sn.h - ay) * sy;
      o.w = Math.abs(o.w); o.h = Math.abs(o.h);
      this.app.scene.invalidate(o);
      return;
    }
    const cx = sn.x + sn.w / 2, cy = sn.y + sn.h / 2;
    const ncx = ax + (cx - ax) * sx, ncy = ay + (cy - ay) * sy;
    o.w = Math.max(2, sn.w * Math.abs(sx));
    o.h = Math.max(2, sn.h * Math.abs(sy));
    o.x = ncx - o.w / 2;
    o.y = ncy - o.h / 2;
    if (o.type === 'text') o.h = textObjectHeight(o);
    this.app.scene.touch(o, true);
  }

  doRotate(ev) {
    const app = this.app;
    const f = this.frame0;
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    let d = Math.atan2(ev.wy - cy, ev.wx - cx) - Math.atan2(this.s0.wy - cy, this.s0.wx - cx);
    if (ev.shift) {
      const target = f.rot + d;
      d = Math.round(target / (Math.PI / 12)) * (Math.PI / 12) - f.rot;
    }
    for (const sn of this.snaps) {
      const o = sn.o;
      if (o.type === 'connector') continue;
      if (o.type === 'stroke') {
        const p = sn.pts, out = new Array(p.length);
        const c = Math.cos(d), s = Math.sin(d);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < p.length; i += 3) {
          const dx = p[i] - cx, dy = p[i + 1] - cy;
          const x = cx + dx * c - dy * s, y = cy + dx * s + dy * c;
          out[i] = x; out[i + 1] = y; out[i + 2] = p[i + 2];
          const r = p[i + 2];
          if (x - r < x0) x0 = x - r; if (y - r < y0) y0 = y - r;
          if (x + r > x1) x1 = x + r; if (y + r > y1) y1 = y + r;
        }
        o.pts = out; o.x = x0; o.y = y0; o.w = x1 - x0; o.h = y1 - y0;
        app.scene.invalidate(o);
      } else {
        const ocx = sn.x + sn.w / 2, ocy = sn.y + sn.h / 2;
        const [nx, ny] = rotatePoint(ocx, ocy, cx, cy, d);
        o.x = nx - sn.w / 2; o.y = ny - sn.h / 2;
        o.rot = sn.rot + d;
        app.scene.touch(o, true);
      }
    }
    app.moved();
  }

  finishTransform() {
    const app = this.app;
    this.tx.commit();
    this.tx = null;
    this.snaps = null;
    app.touched();
    app.renderer.markScene();
  }

  // ---------- коннекторы ----------
  beginEndpoint(c, which, isNew) {
    const app = this.app;
    this.tx = app.history.begin();
    this.tx.track(c);
    this.epConn = c;
    this.epWhich = which;
    this.epNew = isNew;
    this.mode = 'endpoint';
    this.dragged = isNew;
  }

  beginNewConnector(owner, port) {
    const app = this.app;
    const d = app.defaults;
    const c = makeConnector({ id: owner.id, port }, { x: this.s0.wx, y: this.s0.wy }, d.connKind, d.connHead);
    c.s.stroke = d.connColor;
    this.tx = app.history.begin();
    app.scene.add(c, true);
    this.tx.add(c);
    this.epConn = c;
    this.epWhich = 'to';
    this.epNew = true;
    this.mode = 'endpoint';
    this.dragged = true;
    app.select([c]);
  }

  doEndpoint(ev) {
    const app = this.app;
    const c = this.epConn;
    const other = this.epWhich === 'from' ? c.to : c.from;
    const t = connectTarget(app, ev.wx, ev.wy, other.id);
    this.snapTarget = t;
    c[this.epWhich] = t && t.id ? { id: t.id, port: t.port } : { x: ev.wx, y: ev.wy };
    app.scene.invalidate(c);
    app.moved();
  }

  finishEndpoint() {
    const app = this.app;
    const c = this.epConn;
    // слишком короткий новый коннектор без цели удаляем
    if (this.epNew) {
      const r = app.scene.route(c);
      const n = r.pts.length;
      const len = Math.hypot(r.pts[n - 2] - r.pts[0], r.pts[n - 1] - r.pts[1]);
      if (len * app.cam.z < 12 && !c.to.id) {
        app.scene.remove(c.id, true);
        this.tx.commit();
        this.tx = null;
        app.clearDeadSelection();
        app.renderer.markScene();
        return;
      }
    }
    this.tx.commit();
    this.tx = null;
    app.touched();
    app.renderer.markScene();
  }

  // ---------- рамка выделения ----------
  doMarquee(ev) {
    const app = this.app;
    const m = this.marquee;
    m.x1 = ev.wx; m.y1 = ev.wy;
    const rect = normalizeRect(m.x0, m.y0, m.x1, m.y1);
    const ids = new Set(m.base);
    for (const o of app.scene.query(rect)) {
      const b = app.scene.bounds(o);
      if (o.type === 'frame' && !rectContains(rect, b)) continue;
      if (o.type === 'stroke' && !this.strokeTouches(o, rect)) continue;
      ids.add(o.id);
      for (const g of app.scene.groupMembers(o)) ids.add(g.id);
    }
    app.setSelectionIds(ids);
    app.renderer.markUI();
  }

  strokeTouches(o, rect) {
    const p = o.pts;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] >= rect.x && p[i] <= rect.x + rect.w && p[i + 1] >= rect.y && p[i + 1] <= rect.y + rect.h) return true;
    }
    return false;
  }

  // ---------- наведение ----------
  hover(ev) {
    const app = this.app;
    // перо в воздухе шлёт сотни событий в секунду: поиск объекта под курсором нужен не чаще ~30 раз в секунду
    const now = performance.now();
    if (now - this._hoverAt < 33) return;
    this._hoverAt = now;
    const f = selectionFrame(app);
    let cursor = null;
    if (f && !app.selectedObjs().some((o) => o.locked)) {
      const h = hitHandle(f, ev.wx, ev.wy, app.cam.z);
      if (h) cursor = cursorForHandle(h, f.rot);
    }
    const single = app.single();
    if (!cursor && single && single.type === 'connector') {
      const r = app.scene.route(single);
      const n = r.pts.length;
      for (const [x, y] of [[r.pts[0], r.pts[1]], [r.pts[n - 2], r.pts[n - 1]]]) {
        if (Math.hypot(x - ev.wx, y - ev.wy) * app.cam.z < 10) cursor = 'pointer';
      }
    }
    const hit = ev.type === 'touch' ? null : app.scene.hit(ev.wx, ev.wy, app.cam.z);
    const owner = (hit && isConnectable(hit) ? hit : null) || (app.hoverId && app.scene.get(app.hoverId));
    if (!cursor && owner && owner.type !== 'frame') {
      for (const p of PORTS) {
        const pi = portInfo(owner, p);
        if (Math.hypot(pi.x - ev.wx, pi.y - ev.wy) * app.cam.z < 10) cursor = 'crosshair';
      }
    }
    if (!cursor && hit) cursor = app.isSelected(hit) && !hit.locked ? 'move' : 'default';
    if (cursor !== this.cursorOverride) { this.cursorOverride = cursor; app.input.updateCursor(); }
    app.setHover(hit ? hit.id : null);
  }

  // ---------- клавиши ----------
  key(e) {
    const app = this.app;
    const sel = app.selectedObjs();
    if (!sel.length) return false;
    const step = (e.shiftKey ? 10 : 1);
    const dir = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (dir && !sel.some((o) => o.locked)) {
      const tx = app.history.begin();
      const set = this.movingSet(sel);
      tx.trackAll(set);
      for (const o of set) {
        if (o.type === 'connector') {
          if (!o.from.id) o.from = { x: o.from.x + dir[0], y: o.from.y + dir[1] };
          if (!o.to.id) o.to = { x: o.to.x + dir[0], y: o.to.y + dir[1] };
          app.scene.invalidate(o);
          continue;
        }
        o.x += dir[0]; o.y += dir[1];
        if (o.type === 'stroke') for (let i = 0; i < o.pts.length; i += 3) { o.pts[i] += dir[0]; o.pts[i + 1] += dir[1]; }
        app.scene.invalidate(o);
      }
      tx.commit();
      app.touched();
      app.renderer.markScene();
      return true;
    }
    return false;
  }

  // ---------- оверлей ----------
  drawOverlay(ctx) {
    const app = this.app;
    const z = app.cam.z;
    const px = 1 / z;
    if (this.marquee) {
      const r = normalizeRect(this.marquee.x0, this.marquee.y0, this.marquee.x1, this.marquee.y1);
      ctx.fillStyle = 'rgba(66,98,255,0.08)';
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = px;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    if (this.guides.length) {
      ctx.strokeStyle = '#ff2d8a';
      ctx.lineWidth = px;
      ctx.beginPath();
      for (const g of this.guides) { ctx.moveTo(g.x0, g.y0); ctx.lineTo(g.x1, g.y1); }
      ctx.stroke();
    }
    if (this.snapTarget && this.snapTarget.id && this.mode === 'endpoint') {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.arc(this.snapTarget.x, this.snapTarget.y, 6 * px, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

// Рамки выделения, ручки, порты и подсветка наведения. Рисуется всегда, независимо от инструмента.
export function drawSelectionOverlay(ctx, app) {
  const z = app.cam.z;
  const px = 1 / z;
  const sel = app.selectedObjs();
  const tool = app.toolName;
  const outline = (o, width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * px;
    if (o.type === 'connector') {
      const r = app.scene.route(o);
      ctx.beginPath();
      ctx.moveTo(r.pts[0], r.pts[1]);
      for (let i = 2; i < r.pts.length; i += 2) ctx.lineTo(r.pts[i], r.pts[i + 1]);
      ctx.stroke();
      return;
    }
    if (o.type === 'stroke') {
      const off = o._off || [0, 0];
      ctx.strokeRect(o.x, o.y, o.w, o.h);
      return;
    }
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(o.rot || 0);
    ctx.strokeRect(-o.w / 2, -o.h / 2, o.w, o.h);
    ctx.restore();
  };

  if (app.hoverId && tool === 'select') {
    const h = app.scene.get(app.hoverId);
    if (h && !app.isSelected(h)) outline(h, 1.5, ACCENT);
  }
  drawPorts(ctx, app, sel.length === 1 ? sel[0] : null);
  if (!sel.length) return;

  const hideHandles = app.interacting;
  for (const o of sel) {
    if (o.type === 'connector') {
      outline(o, 2, ACCENT);
    } else if (sel.length > 1) {
      outline(o, 1, 'rgba(66,98,255,0.6)');
    }
  }
  const f = selectionFrame(app);
  const locked = sel.some((o) => o.locked);
  if (f) {
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(f.rot);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5 * px;
    ctx.strokeRect(-f.w / 2, -f.h / 2, f.w, f.h);
    ctx.restore();
    if (!locked && !hideHandles) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5 * px;
      const small = f.w * z < 36 || f.h * z < 36;
      for (const id in HANDLES) {
        if (small && id.length === 1) continue;
        const [hx, hy] = handleWorld(f, HANDLES[id][0], HANDLES[id][1]);
        const s = 8 * px;
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(f.rot);
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.strokeRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      }
      const [tx, ty] = handleWorld(f, 0.5, 0);
      const [rx, ry] = rotatePoint(cx, f.y - ROT_OFF * px, cx, cy, f.rot);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      const [bx, by] = rotatePoint(cx, f.y - (ROT_OFF - 6) * px, cx, cy, f.rot);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rx, ry, 5 * px, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (locked) {
      ctx.fillStyle = ACCENT;
      ctx.font = `${12 * px}px sans-serif`;
      ctx.fillText('🔒', f.x + f.w + 4 * px, f.y + 12 * px);
    }
  }
  const single = sel.length === 1 ? sel[0] : null;
  if (single && single.type === 'connector' && !locked) {
    const r = app.scene.route(single);
    const n = r.pts.length;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2 * px;
    for (const [x, y] of [[r.pts[0], r.pts[1]], [r.pts[n - 2], r.pts[n - 1]]]) {
      ctx.beginPath();
      ctx.arc(x, y, 5 * px, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

}

function drawPorts(ctx, app, single) {
  const px = 1 / app.cam.z;
  const tool = app.toolName;
  const portOwner = (tool === 'select' && ((app.hoverId && app.scene.get(app.hoverId)) || (single && isConnectable(single) ? single : null)));
  if (portOwner && isConnectable(portOwner) && portOwner.type !== 'frame' && !app.interacting) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5 * px;
    for (const p of PORTS) {
      const pi = portInfo(portOwner, p);
      ctx.beginPath();
      ctx.arc(pi.x, pi.y, 4.5 * px, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}
