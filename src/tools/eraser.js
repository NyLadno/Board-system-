import { distToPolyline, distToSegment } from '../core/geometry.js';

// Ластик удаляет штрихи целиком (как в Miro). Стёртые сразу скрываются, а удаляются из сцены на отпускание.
export class EraserTool {
  constructor(app) {
    this.app = app;
    this.name = 'eraser';
    this.erased = null;
    this.prev = null;
    this.hoverPos = null;
  }

  get cursor() { return this.app.brushCursor('eraser'); }
  get radius() { return this.app.defaults.eraserSize / 2 / this.app.cam.z; }

  down(ev) {
    this.erased = new Set();
    this.app.hiddenIds = this.erased;
    this.prev = null;
    this.hitAt(ev.wx, ev.wy);
  }

  move(ev) {
    const list = ev.coalesced && ev.coalesced.length ? ev.coalesced : [ev.raw];
    const cam = this.app.cam;
    const r = this.app.input.rect;
    for (const e of list) this.hitAt((e.clientX - r.left) / cam.z + cam.x, (e.clientY - r.top) / cam.z + cam.y);
  }

  hitAt(wx, wy) {
    const app = this.app;
    const rad = this.radius;
    const p = this.prev || { x: wx, y: wy };
    const minx = Math.min(p.x, wx) - rad, maxx = Math.max(p.x, wx) + rad;
    const miny = Math.min(p.y, wy) - rad, maxy = Math.max(p.y, wy) + rad;
    let changed = false;
    for (const o of app.scene.all()) {
      if (o.type !== 'stroke' || this.erased.has(o.id)) continue;
      const b = app.scene.bounds(o);
      if (b.x > maxx || b.x + b.w < minx || b.y > maxy || b.y + b.h < miny) continue;
      const reach = rad + o.s.size / 2;
      const pts = o.pts;
      // вершины штриха рядом с отрезком движения ластика, либо концы отрезка рядом со штрихом
      let hit = false;
      for (let i = 0; i < pts.length && !hit; i += 3) {
        if (distToSegment(pts[i], pts[i + 1], p.x, p.y, wx, wy) <= reach) hit = true;
      }
      if (!hit && pts.length >= 6) hit = distToPolyline(wx, wy, pts, 3) <= reach || distToPolyline(p.x, p.y, pts, 3) <= reach;
      if (hit) { this.erased.add(o.id); changed = true; }
    }
    this.prev = { x: wx, y: wy };
    if (changed) app.renderer.markScene();
  }

  up() {
    const app = this.app;
    if (!this.erased) return;
    const ids = [...this.erased];
    app.hiddenIds = null;
    this.erased = null;
    if (!ids.length) return;
    const tx = app.history.begin();
    for (const id of ids) {
      const o = app.scene.get(id);
      if (o) { tx.del(o); app.scene.remove(id, true); }
    }
    tx.commit();
    app.scene.emit('remove');
    app.clearDeadSelection();
  }

  cancel() {
    this.erased = null;
    this.app.hiddenIds = null;
    this.app.renderer.markScene();
  }
}
