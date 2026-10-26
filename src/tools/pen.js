import { StrokeBuilder } from '../render/stroke.js';
import { uid } from '../core/util.js';

// Перо и маркер. Главное для отклика:
//  1. точки берутся из coalesced-событий (все отсчёты планшета, а не только по одному на кадр);
//  2. на кадр рисуется только хвост штрих-а, остальное лежит в готовом слое;
//  3. хвост продлевается предсказанием, чтобы линия не отставала от кончика пера;
//  4. по умолчанию нет сглаживающего фильтра, значит нет и запаздывания.
export class PenTool {
  constructor(app, kind) {
    this.app = app;
    this.kind = kind; // 'pen' | 'hl'
    this.name = kind;
    this.sb = null;
    this.pred = [];
    this.predPool = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    this.pid = null;
  }

  get cursor() { return this.app.brushCursor(this.kind); }

  down(ev) {
    const app = this.app;
    const st = this.kind === 'hl' ? app.defaults.hl : app.defaults.pen;
    const isPen = ev.type === 'pen';
    const sens = this.kind === 'hl' ? 0 : isPen ? app.settings.pressure : 0;
    const zoom = app.cam.z;
    this.sb = new StrokeBuilder({ size: st.size, sens, smoothing: app.settings.smoothing, zoom, minDist: 0.35 });
    this.style = { color: st.color, size: st.size, hl: this.kind === 'hl', variable: sens > 0 };
    this.pid = ev.id;
    this.rect = app.input.rect;
    app.renderer.ink.begin(this.sb, this.style, app.cam);
    this.addRaw(ev.raw);
    this.pred = [];
    app.renderer.schedule();
  }

  addRaw(e) {
    const cam = this.app.cam;
    const x = (e.clientX - this.rect.left) / cam.z + cam.x;
    const y = (e.clientY - this.rect.top) / cam.z + cam.y;
    const isPen = e.pointerType === 'pen';
    const p = isPen ? Math.max(e.pressure, 0.04) : 0.5;
    this.sb.add(x, y, p, e.timeStamp);
    this.last = { x, y, p, t: e.timeStamp };
  }

  move(ev) {
    if (!this.sb) return;
    const list = ev.coalesced && ev.coalesced.length ? ev.coalesced : [ev.raw];
    for (let i = 0; i < list.length; i++) this.addRaw(list[i]);
    this.updatePrediction(ev);
    this.app.renderer.schedule();
  }

  updatePrediction(ev) {
    const app = this.app;
    this.pred = [];
    if (app.settings.predictMs <= 0 || !app.settings.browserPrediction) return;
    const pe = ev.predicted;
    if (!pe || !pe.length) return;
    const cam = app.cam;
    const n = Math.min(pe.length, this.predPool.length);
    for (let i = 0; i < n; i++) {
      const slot = this.predPool[i];
      slot.x = (pe[i].clientX - this.rect.left) / cam.z + cam.x;
      slot.y = (pe[i].clientY - this.rect.top) / cam.z + cam.y;
      this.pred.push(slot);
    }
  }

  inkFrame(t) {
    const app = this.app;
    app.renderer.ink.frame(this.pred, app.settings.predictMs);
    if (this.last) {
      const d = performance.now() - this.last.t;
      app.diag.inputToDraw += (Math.max(0, d) - app.diag.inputToDraw) * 0.2;
    }
  }

  up(ev) {
    const app = this.app;
    const sb = this.sb;
    if (!sb) return;
    if (ev.raw && ev.raw.type !== 'pointercancel') this.addRaw(ev.raw);
    if (this.last) sb.forceLast(this.last.x, this.last.y, this.last.p, this.last.t);
    this.sb = null;
    const style = this.style;
    if (sb.length) {
      const pts = sb.toFlat();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, rm = 0;
      for (let i = 0; i < sb.length; i++) {
        const r = sb.R[i];
        if (sb.X[i] - r < x0) x0 = sb.X[i] - r;
        if (sb.Y[i] - r < y0) y0 = sb.Y[i] - r;
        if (sb.X[i] + r > x1) x1 = sb.X[i] + r;
        if (sb.Y[i] + r > y1) y1 = sb.Y[i] + r;
        if (r > rm) rm = r;
      }
      if (style.hl) { x0 -= style.size / 2; y0 -= style.size / 2; x1 += style.size / 2; y1 += style.size / 2; }
      const o = {
        id: uid(), type: 'stroke', x: x0, y: y0, w: x1 - x0, h: y1 - y0, rot: 0, pts,
        s: { color: style.color, size: style.size, hl: style.hl, var: style.variable },
      };
      const tx = app.history.begin();
      app.scene.add(o, true);
      app.scene.reorder();
      tx.add(o);
      tx.commit();
      // новый штрих всегда сверху, поэтому достаточно дорисовать его поверх готового кадра
      app.renderer.paintObject(o);
      app.touched();
    }
    app.renderer.ink.end();
    this.pred = [];
  }

  cancel() {
    if (this.sb) {
      this.sb = null;
      this.app.renderer.ink.end();
    }
  }
}
