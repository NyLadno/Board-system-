import { buildOutline, buildPolyline, predictPoints } from './stroke.js';

// Живой слой чернил. Два прозрачных холста над сценой:
//  base: уже «замороженная» часть штриха (дорисовывается порциями и больше не трогается);
//  tail: хвост с предсказанием, очищается и перерисовывается каждый кадр в небольшом прямоугольнике.
// Благодаря этому работа на кадр пропорциональна длине хвоста, а не всего штриха.
const FREEZE_AT = 140;
const KEEP = 36;
const OVERLAP = 3;

export class InkLayer {
  constructor(stage) {
    const mk = () => {
      const c = document.createElement('canvas');
      c.className = 'layer ink';
      stage.append(c);
      return c;
    };
    this.baseCv = mk();
    this.tailCv = mk();
    const opts = { alpha: true, desynchronized: true };
    this.base = this.baseCv.getContext('2d', opts);
    this.tail = this.tailCv.getContext('2d', opts);
    this.sb = null;
    this.px = [0, 0, 0];
    this.py = [0, 0, 0];
    this.prev = null;
  }

  resize(w, h, dpr) {
    for (const c of [this.baseCv, this.tailCv]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.dpr = dpr;
  }

  begin(sb, style, cam) {
    this.sb = sb;
    this.style = style;
    this.frozenTo = 0;
    this.prev = null;
    const k = this.dpr * cam.z;
    for (const ctx of [this.base, this.tail]) {
      ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.fillStyle = style.color;
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.size;
    }
    this.cam = cam;
    const t = this.tailCv.style;
    if (style.hl) { t.opacity = '0.38'; t.mixBlendMode = 'multiply'; }
    else { t.opacity = ''; t.mixBlendMode = ''; }
  }

  clearAll() {
    for (const [ctx, cv] of [[this.base, this.baseCv], [this.tail, this.tailCv]]) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.restore();
    }
    this.prev = null;
  }

  end() {
    this.sb = null;
    this.clearAll();
    this.tailCv.style.opacity = '';
    this.tailCv.style.mixBlendMode = '';
  }

  drawPart(ctx, sb, a, b) {
    const { style } = this;
    if (b < a) return;
    const path = new Path2D();
    if (style.variable) {
      buildOutline(path, sb.X, sb.Y, sb.R, a, b);
      ctx.fill(path);
    } else {
      buildPolyline(path, sb.X, sb.Y, a, b);
      ctx.stroke(path);
    }
  }

  // Один кадр. predicted: массив {x,y} из событий браузера или null (тогда считаем сами).
  frame(predicted, predictMs) {
    const sb = this.sb;
    if (!sb || !sb.length) return;
    const n = sb.length;
    const { style } = this;
    if (!style.hl && n - this.frozenTo > FREEZE_AT) {
      const newF = n - 1 - KEEP;
      this.drawPart(this.base, sb, Math.max(0, this.frozenTo - OVERLAP), newF);
      this.frozenTo = newF;
    }
    const a = style.hl ? 0 : Math.max(0, this.frozenTo - OVERLAP);

    // предсказанные точки временно дописываются в конец массивов
    let pc = 0;
    const lastR = sb.R[n - 1];
    if (predicted && predicted.length) {
      for (const p of predicted) { sb.X.push(p.x); sb.Y.push(p.y); sb.R.push(lastR); pc++; }
    } else if (predictMs > 0) {
      const c = predictPoints(sb.X, sb.Y, sb.T, predictMs, this.cam.z, this.px, this.py);
      for (let i = 0; i < c; i++) { sb.X.push(this.px[i]); sb.Y.push(this.py[i]); sb.R.push(lastR); pc++; }
    }
    const b = n + pc - 1;

    // прямоугольник, который затрагивает хвост
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, rm = 0;
    for (let i = a; i <= b; i++) {
      if (sb.X[i] < x0) x0 = sb.X[i];
      if (sb.X[i] > x1) x1 = sb.X[i];
      if (sb.Y[i] < y0) y0 = sb.Y[i];
      if (sb.Y[i] > y1) y1 = sb.Y[i];
      if (sb.R[i] > rm) rm = sb.R[i];
    }
    const pad = (style.hl ? style.size : rm * 1.6) + 3 / this.cam.z;
    const rect = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    const ctx = this.tail;
    const c = this.prev
      ? { x0: Math.min(rect.x0, this.prev.x0), y0: Math.min(rect.y0, this.prev.y0), x1: Math.max(rect.x1, this.prev.x1), y1: Math.max(rect.y1, this.prev.y1) }
      : rect;
    ctx.clearRect(c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0);
    this.prev = rect;

    this.drawPart(ctx, sb, a, b);

    if (pc) { sb.X.length = n; sb.Y.length = n; sb.R.length = n; }
  }
}
