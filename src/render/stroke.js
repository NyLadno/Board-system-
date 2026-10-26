// Геометрия штриха: набор точек, сглаживание, предсказание и построение контура.
// Штрих хранится как плоский массив [x, y, r, x, y, r, ...], где r это половина толщины в мировых единицах.

const TAU = Math.PI * 2;

// Радиус по давлению: sens=0 даёт постоянную толщину, sens=1 заметно меняет её (p=0.5 соответствует базовому размеру).
export function radiusFor(size, p, sens) {
  const f = 1 - sens + sens * (0.2 + 1.6 * p);
  return (size / 2) * f;
}

class OneEuro {
  constructor() { this.x = null; this.dx = 0; this.t = 0; }
  static alpha(cutoff, dt) {
    const tau = 1 / (TAU * cutoff);
    return 1 / (1 + tau / dt);
  }
  reset() { this.x = null; }
  filter(v, t, minCut, beta) {
    if (this.x === null) { this.x = v; this.t = t; this.dx = 0; return v; }
    const dt = Math.max((t - this.t) / 1000, 1e-3);
    this.t = t;
    const rawD = (v - this.x) / dt;
    this.dx += OneEuro.alpha(1, dt) * (rawD - this.dx);
    const cutoff = minCut + beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

// Накопитель точек живого штриха. Вызывается на каждое событие пера, поэтому без лишних аллокаций.
export class StrokeBuilder {
  constructor({ size, sens = 0, smoothing = 0, zoom = 1, minDist = 0.4 }) {
    this.size = size;
    this.sens = sens;
    this.smoothing = smoothing;
    this.zoom = zoom;
    this.minDist2 = (minDist / zoom) ** 2;
    this.X = [];
    this.Y = [];
    this.R = [];
    this.T = [];
    this.pmin = 1;
    this.pmax = 0;
    this.fx = new OneEuro();
    this.fy = new OneEuro();
  }

  get length() { return this.X.length; }

  add(x, y, p, t) {
    const n = this.X.length;
    if (this.smoothing > 0) {
      const z = this.zoom;
      const minCut = 8 - 7.4 * this.smoothing;
      x = this.fx.filter(x * z, t, minCut, 0.04) / z;
      y = this.fy.filter(y * z, t, minCut, 0.04) / z;
    }
    if (n > 0) {
      const dx = x - this.X[n - 1];
      const dy = y - this.Y[n - 1];
      if (dx * dx + dy * dy < this.minDist2) return false;
    }
    if (p < this.pmin) this.pmin = p;
    if (p > this.pmax) this.pmax = p;
    let r = radiusFor(this.size, p, this.sens);
    if (n > 0) {
      const pr = this.R[n - 1];
      r = pr + (r - pr) * 0.55;
    }
    this.X.push(x);
    this.Y.push(y);
    this.R.push(r);
    this.T.push(t);
    return true;
  }

  // Принудительно дописать последнюю точку (например, на pointerup), даже если она ближе порога
  forceLast(x, y, p, t) {
    const n = this.X.length;
    if (n && Math.hypot(x - this.X[n - 1], y - this.Y[n - 1]) > 1e-6) {
      this.X.push(x); this.Y.push(y); this.R.push(this.R[n - 1]); this.T.push(t);
    }
  }

  // Плоский массив для хранения; при постоянной толщине радиус одинаков
  toFlat(precision = 100) {
    const n = this.X.length;
    const out = new Array(n * 3);
    for (let i = 0; i < n; i++) {
      out[i * 3] = Math.round(this.X[i] * precision) / precision;
      out[i * 3 + 1] = Math.round(this.Y[i] * precision) / precision;
      out[i * 3 + 2] = Math.round(this.R[i] * precision) / precision;
    }
    return out;
  }

  isVariable() { return this.sens > 0 && this.pmax - this.pmin > 0.04; }
}

// Предсказание положения пера вперёд на horizonMs мс. Возвращает число добавленных точек.
// Использует скорость и ограниченное ускорение по трём последним точкам; на резких поворотах и при малой скорости молчит.
export function predictPoints(X, Y, T, horizonMs, zoom, outX, outY, steps = 3) {
  const k = X.length - 1;
  if (k < 2 || horizonMs <= 0) return 0;
  const dt1 = T[k] - T[k - 1];
  const dt0 = T[k - 1] - T[k - 2];
  if (dt1 <= 0.5 || dt0 <= 0.5) return 0;
  const vx1 = (X[k] - X[k - 1]) / dt1, vy1 = (Y[k] - Y[k - 1]) / dt1;
  const vx0 = (X[k - 1] - X[k - 2]) / dt0, vy0 = (Y[k - 1] - Y[k - 2]) / dt0;
  const s1 = Math.hypot(vx1, vy1);
  const s0 = Math.hypot(vx0, vy0);
  if (s1 * 1000 * zoom < 60) return 0;
  if (s0 > 0 && (vx1 * vx0 + vy1 * vy0) / (s1 * s0) < 0.55) return 0;
  const adt = (dt0 + dt1) / 2;
  let ax = (vx1 - vx0) / adt, ay = (vy1 - vy0) / adt;
  const amax = (s1 / horizonMs) * 0.8;
  const al = Math.hypot(ax, ay);
  if (al > amax) { ax *= amax / al; ay *= amax / al; }
  for (let i = 1; i <= steps; i++) {
    const t = (horizonMs * i) / steps;
    outX[i - 1] = X[k] + vx1 * t + 0.25 * ax * t * t;
    outY[i - 1] = Y[k] + vy1 * t + 0.25 * ay * t * t;
  }
  return steps;
}

// Сглаженная ломаная постоянной толщины: квадратичные кривые через середины звеньев
export function buildPolyline(path, X, Y, a, b) {
  if (b < a) return;
  path.moveTo(X[a], Y[a]);
  if (b === a) { path.lineTo(X[a] + 0.01, Y[a]); return; }
  if (b === a + 1) { path.lineTo(X[b], Y[b]); return; }
  path.lineTo((X[a] + X[a + 1]) / 2, (Y[a] + Y[a + 1]) / 2);
  for (let i = a + 1; i < b; i++) {
    path.quadraticCurveTo(X[i], Y[i], (X[i] + X[i + 1]) / 2, (Y[i] + Y[i + 1]) / 2);
  }
  path.lineTo(X[b], Y[b]);
}

// Замкнутый контур переменной толщины между точками a..b включительно (круглые концы)
export function buildOutline(path, X, Y, R, a, b) {
  const n = b - a + 1;
  if (n <= 0) return;
  if (n === 1) {
    path.moveTo(X[a] + R[a], Y[a]);
    path.arc(X[a], Y[a], R[a], 0, TAU);
    path.closePath();
    return;
  }
  const LX = new Array(n), LY = new Array(n), RX = new Array(n), RY = new Array(n);
  let nx = 0, ny = -1;
  for (let i = 0; i < n; i++) {
    const j = a + i;
    const i0 = i > 0 ? j - 1 : j;
    const i1 = i < n - 1 ? j + 1 : j;
    const dx = X[i1] - X[i0], dy = Y[i1] - Y[i0];
    const l = Math.hypot(dx, dy);
    if (l > 1e-6) { nx = -dy / l; ny = dx / l; }
    const r = R[j];
    LX[i] = X[j] + nx * r; LY[i] = Y[j] + ny * r;
    RX[i] = X[j] - nx * r; RY[i] = Y[j] - ny * r;
  }
  // нормали на концах для дуг
  const s = a, e = b;
  const sdx = X[a + 1] - X[a], sdy = Y[a + 1] - Y[a];
  const edx = X[e] - X[e - 1], edy = Y[e] - Y[e - 1];
  const thS = Math.atan2(sdy, sdx) + Math.PI / 2;
  const thE = Math.atan2(edy, edx) + Math.PI / 2;

  path.moveTo(LX[0], LY[0]);
  if (n > 2) {
    path.lineTo((LX[0] + LX[1]) / 2, (LY[0] + LY[1]) / 2);
    for (let i = 1; i < n - 1; i++) path.quadraticCurveTo(LX[i], LY[i], (LX[i] + LX[i + 1]) / 2, (LY[i] + LY[i + 1]) / 2);
  }
  path.lineTo(LX[n - 1], LY[n - 1]);
  path.arc(X[e], Y[e], R[e], thE, thE - Math.PI, true);
  if (n > 2) {
    path.lineTo((RX[n - 1] + RX[n - 2]) / 2, (RY[n - 1] + RY[n - 2]) / 2);
    for (let i = n - 2; i > 0; i--) path.quadraticCurveTo(RX[i], RY[i], (RX[i] + RX[i - 1]) / 2, (RY[i] + RY[i - 1]) / 2);
  }
  path.lineTo(RX[0], RY[0]);
  path.arc(X[s], Y[s], R[s], thS + Math.PI, thS, true);
  path.closePath();
}

export function flatToArrays(pts) {
  const n = pts.length / 3;
  const X = new Array(n), Y = new Array(n), R = new Array(n);
  for (let i = 0; i < n; i++) { X[i] = pts[i * 3]; Y[i] = pts[i * 3 + 1]; R[i] = pts[i * 3 + 2]; }
  return { X, Y, R };
}

// Упрощение ломаной (Рамер-Дуглас-Пекер) по плоскому массиву [x,y,r]; для миниатюр и дальнего зума
export function simplifyFlat(pts, tol) {
  const n = pts.length / 3;
  if (n < 3) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    const ax = pts[s * 3], ay = pts[s * 3 + 1], bx = pts[e * 3], by = pts[e * 3 + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    for (let i = s + 1; i < e; i++) {
      const px = pts[i * 3], py = pts[i * 3 + 1];
      let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + t * dx - px, qy = ay + t * dy - py;
      const d = qx * qx + qy * qy;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > t2 && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
  return out;
}
