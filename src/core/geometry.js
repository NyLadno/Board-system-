// Геометрические помощники. Все координаты в мировой системе, если не сказано иное.

export function rectsIntersect(a, b) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function unionRect(a, b) {
  if (!a) return b && { ...b };
  if (!b) return { ...a };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function rotatePoint(px, py, cx, cy, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

// Четыре угла повёрнутого прямоугольника: TL, TR, BR, BL
export function corners(o) {
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const r = o.rot || 0;
  return [
    rotatePoint(o.x, o.y, cx, cy, r),
    rotatePoint(o.x + o.w, o.y, cx, cy, r),
    rotatePoint(o.x + o.w, o.y + o.h, cx, cy, r),
    rotatePoint(o.x, o.y + o.h, cx, cy, r),
  ];
}

// Ограничивающий прямоугольник повёрнутого объекта
export function aabbOf(o) {
  if (!o.rot) return { x: o.x, y: o.y, w: o.w, h: o.h };
  const c = corners(o);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of c) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function pointInRotRect(px, py, o, pad = 0) {
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const [lx, ly] = rotatePoint(px, py, cx, cy, -(o.rot || 0));
  return lx >= o.x - pad && lx <= o.x + o.w + pad && ly >= o.y - pad && ly <= o.y + o.h + pad;
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return Math.hypot(x, y);
}

export function distToPolyline(px, py, pts, step = 2, stride = 0) {
  // pts: плоский массив [x,y,...] со смещением stride между парами (stride=1 для [x,y,r])
  let best = Infinity;
  const k = step + stride;
  let n = pts.length;
  if (n < k) return best;
  if (n === k) return Math.hypot(pts[0] - px, pts[1] - py);
  for (let i = 0; i + k + 1 < n; i += k) {
    const d = distToSegment(px, py, pts[i], pts[i + 1], pts[i + k], pts[i + k + 1]);
    if (d < best) best = d;
  }
  return best;
}

export function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1x = bx - ax, d1y = by - ay, d2x = dx - cx, d2y = dy - cy;
  const den = d1x * d2y - d1y * d2x;
  if (den === 0) return false;
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / den;
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export function normalizeRect(x0, y0, x1, y1) {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

export function rectContains(outer, inner) {
  return (
    inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
  );
}

export function polylineBounds(pts, stride = 3) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += stride) {
    const x = pts[i], y = pts[i + 1];
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
