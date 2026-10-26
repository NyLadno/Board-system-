import { buildOutline, buildPolyline, flatToArrays } from './stroke.js';

const FONTS = {
  sans: '-apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif',
  serif: '"New York", "Times New Roman", Georgia, serif',
  mono: '"SF Mono", Menlo, Consolas, monospace',
  hand: '"Marker Felt", "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive',
};
export const LINE_H = 1.25;

export function fontString(ts, size = ts.size) {
  return `${ts.italic ? 'italic ' : ''}${ts.bold ? '700' : '400'} ${size}px ${FONTS[ts.font] || FONTS.sans}`;
}
export const fontFamily = (ts) => FONTS[ts.font] || FONTS.sans;

let measureCtx = null;
function mctx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

// Перенос по словам. Возвращает строки; длинные слова разбиваются по символам.
export function wrapText(text, ts, size, maxW) {
  const ctx = mctx();
  ctx.font = fontString(ts, size);
  const lines = [];
  for (const para of String(text).split('\n')) {
    if (maxW <= 0 || !para) { lines.push(para); continue; }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const test = line + word;
      if (ctx.measureText(test).width <= maxW || !line) {
        if (ctx.measureText(test).width > maxW && !/\s/.test(word)) {
          // слово длиннее строки
          let cur = line;
          for (const ch of word) {
            if (cur && ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ''; }
            cur += ch;
          }
          line = cur;
        } else line = test;
      } else {
        lines.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function textBox(o) {
  // Внутренняя область для текста
  if (o.type === 'sticky') return { x: 14, y: 14, w: o.w - 28, h: o.h - 28 };
  if (o.type === 'shape') {
    const px = Math.max(8, o.w * 0.08), py = Math.max(6, o.h * 0.08);
    if (o.shape === 'ellipse' || o.shape === 'diamond' || o.shape === 'triangle' || o.shape === 'star') {
      const kx = o.shape === 'triangle' ? 0.25 : 0.15, ky = o.shape === 'triangle' ? 0.35 : 0.15;
      const yoff = o.shape === 'triangle' ? o.h * 0.25 : 0;
      return { x: o.w * kx, y: o.h * ky + yoff, w: o.w * (1 - 2 * kx), h: o.h * (1 - 2 * ky) - yoff };
    }
    return { x: px, y: py, w: o.w - px * 2, h: o.h - py * 2 };
  }
  return { x: 0, y: 0, w: o.w, h: o.h };
}

// Для стикера подбираем крупнейший кегль, при котором текст помещается
export function fitSize(o) {
  const box = textBox(o);
  const max = o.ts.size;
  const key = `${o.text}|${max}|${o.w}|${o.h}|${o.ts.font}|${o.ts.bold}`;
  if (o._fit && o._fit.key === key) return o._fit.size;
  let lo = 8, hi = max, best = 8;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const lines = wrapText(o.text, o.ts, mid, box.w);
    if (lines.length * mid * LINE_H <= box.h) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  o._fit = { key, size: best };
  return best;
}

export function layoutOf(o) {
  const box = textBox(o);
  const size = o.type === 'sticky' && o.ts.auto ? fitSize(o) : o.ts.size;
  const key = `${o.text}|${size}|${box.w}|${o.ts.font}|${o.ts.bold}|${o.ts.italic}`;
  if (o._layout && o._layout.key === key) return o._layout;
  const lines = wrapText(o.text, o.ts, size, box.w);
  o._layout = { key, lines, size, box, height: lines.length * size * LINE_H };
  return o._layout;
}

// Высота текстового объекта по содержимому
export function textObjectHeight(o) {
  const lines = wrapText(o.text || ' ', o.ts, o.ts.size, o.w);
  return Math.max(o.ts.size * LINE_H, lines.length * o.ts.size * LINE_H);
}

export function drawText(ctx, o, view) {
  if (!o.text || view.editingId === o.id) return;
  const L = layoutOf(o);
  ctx.font = fontString(o.ts, L.size);
  ctx.fillStyle = o.ts.color || '#1a1a1a';
  ctx.textBaseline = 'middle';
  const lh = L.size * LINE_H;
  const { box } = L;
  let y0 = box.y;
  if (o.type !== 'text') y0 = box.y + (box.h - L.height) / 2;
  const align = o.ts.align || 'left';
  ctx.textAlign = align;
  const x = align === 'center' ? box.x + box.w / 2 : align === 'right' ? box.x + box.w : box.x;
  for (let i = 0; i < L.lines.length; i++) ctx.fillText(L.lines[i], x, y0 + lh * (i + 0.5));
}

// ---------- фигуры ----------
function starPath(p, w, h) {
  const cx = w / 2, cy = h / 2;
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.4 : 1;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * r * (w / 2), y = cy + Math.sin(a) * r * (h / 2);
    if (i) p.lineTo(x, y); else p.moveTo(x, y);
  }
  p.closePath();
}

export function shapePath(shape, w, h, PathCtor = Path2D) {
  const p = new PathCtor();
  switch (shape) {
    case 'ellipse': p.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'round': p.roundRect(0, 0, w, h, Math.min(w, h) * 0.2); break;
    case 'triangle': p.moveTo(w / 2, 0); p.lineTo(w, h); p.lineTo(0, h); p.closePath(); break;
    case 'diamond': p.moveTo(w / 2, 0); p.lineTo(w, h / 2); p.lineTo(w / 2, h); p.lineTo(0, h / 2); p.closePath(); break;
    case 'hexagon':
      p.moveTo(w * 0.25, 0); p.lineTo(w * 0.75, 0); p.lineTo(w, h / 2);
      p.lineTo(w * 0.75, h); p.lineTo(w * 0.25, h); p.lineTo(0, h / 2); p.closePath(); break;
    case 'star': starPath(p, w, h); break;
    case 'parallelogram': p.moveTo(w * 0.2, 0); p.lineTo(w, 0); p.lineTo(w * 0.8, h); p.lineTo(0, h); p.closePath(); break;
    case 'arrow':
      p.moveTo(0, h * 0.3); p.lineTo(w * 0.6, h * 0.3); p.lineTo(w * 0.6, 0); p.lineTo(w, h / 2);
      p.lineTo(w * 0.6, h); p.lineTo(w * 0.6, h * 0.7); p.lineTo(0, h * 0.7); p.closePath(); break;
    case 'cloud':
      p.moveTo(w * 0.25, h * 0.85);
      p.bezierCurveTo(-w * 0.05, h * 0.85, -w * 0.05, h * 0.45, w * 0.2, h * 0.42);
      p.bezierCurveTo(w * 0.15, h * 0.05, w * 0.55, h * 0.0, w * 0.6, h * 0.25);
      p.bezierCurveTo(w * 0.85, h * 0.1, w * 1.05, h * 0.45, w * 0.85, h * 0.55);
      p.bezierCurveTo(w * 1.05, h * 0.85, w * 0.8, h * 0.95, w * 0.7, h * 0.85);
      p.closePath(); break;
    default: p.rect(0, 0, w, h);
  }
  return p;
}

export const SHAPES = ['rect', 'round', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star', 'parallelogram', 'arrow', 'cloud'];

function applyDash(ctx, dash, sw) {
  if (dash === 'dashed') ctx.setLineDash([sw * 4, sw * 3]);
  else if (dash === 'dotted') ctx.setLineDash([sw, sw * 2]);
  else ctx.setLineDash([]);
}

// ---------- штрихи ----------
export function strokePathOf(o) {
  if (o._path) return o._path;
  const p = new Path2D();
  const { X, Y, R } = flatToArrays(o.pts);
  if (o.s.var) buildOutline(p, X, Y, R, 0, X.length - 1);
  else buildPolyline(p, X, Y, 0, X.length - 1);
  o._path = p;
  return p;
}

export function drawStroke(ctx, o, view) {
  const zoom = view.zoom;
  // слишком мелкий штрих не рисуем
  if ((o.w + o.h) * zoom < 1.2) return;
  const p = strokePathOf(o);
  if (o._off) { ctx.save(); ctx.translate(o._off[0], o._off[1]); }
  drawStrokeBody(ctx, o, p);
  if (o._off) ctx.restore();
}

function drawStrokeBody(ctx, o, p) {
  if (o.s.hl) {
    ctx.globalAlpha = 0.38;
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = o.s.color;
    ctx.lineWidth = o.s.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(p);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    return;
  }
  if (o.s.var) {
    ctx.fillStyle = o.s.color;
    ctx.fill(p);
  } else {
    ctx.strokeStyle = o.s.color;
    ctx.lineWidth = o.s.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(p);
  }
}

// ---------- коннекторы ----------
function arrowHead(ctx, x, y, ang, size, kind) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  if (kind === 'arrow') {
    ctx.moveTo(0, 0); ctx.lineTo(-size, -size * 0.5); ctx.lineTo(-size, size * 0.5); ctx.closePath();
    ctx.fill();
  } else if (kind === 'dot') {
    ctx.arc(-size * 0.4, 0, size * 0.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function drawConnector(ctx, o, view) {
  const r = view.scene.route(o);
  const pts = r.pts;
  const n = pts.length;
  ctx.strokeStyle = o.s.stroke;
  ctx.fillStyle = o.s.stroke;
  ctx.lineWidth = o.s.sw;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  applyDash(ctx, o.s.dash, o.s.sw);
  ctx.beginPath();
  if (r.curve) {
    const c = r.curve;
    ctx.moveTo(c[0], c[1]);
    ctx.bezierCurveTo(c[2], c[3], c[4], c[5], c[6], c[7]);
  } else {
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < n; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  const hs = 8 + o.s.sw * 2.5;
  if (o.head !== 'none') arrowHead(ctx, pts[n - 2], pts[n - 1], Math.atan2(pts[n - 1] - pts[n - 3], pts[n - 2] - pts[n - 4]), hs, o.head);
  if (o.tail && o.tail !== 'none') arrowHead(ctx, pts[0], pts[1], Math.atan2(pts[1] - pts[3], pts[0] - pts[2]), hs, o.tail);
}

// ---------- изображения ----------
export class ImageCache {
  constructor(getUrl, onLoad) {
    this.getUrl = getUrl;
    this.onLoad = onLoad;
    this.map = new Map();
  }
  get(assetId) {
    let e = this.map.get(assetId);
    if (!e) {
      e = { img: null, state: 'loading' };
      this.map.set(assetId, e);
      Promise.resolve(this.getUrl(assetId)).then((url) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => { e.img = img; e.state = 'ready'; this.onLoad(); };
        img.onerror = () => { e.state = 'error'; this.onLoad(); };
        img.src = url;
      }).catch(() => { e.state = 'error'; });
    }
    return e;
  }
}

// ---------- общий отрисовщик объекта ----------
// view: { zoom, scene, images, editingId }
export function drawObject(ctx, o, view) {
  const op = o.s && o.s.opacity != null ? o.s.opacity : 1;
  switch (o.type) {
    case 'stroke':
      drawStroke(ctx, o, view);
      return;
    case 'connector':
      if (op !== 1) ctx.globalAlpha = op;
      drawConnector(ctx, o, view);
      ctx.globalAlpha = 1;
      return;
  }
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  ctx.save();
  if (o.rot) { ctx.translate(cx, cy); ctx.rotate(o.rot); ctx.translate(-o.w / 2, -o.h / 2); }
  else ctx.translate(o.x, o.y);
  if (op !== 1) ctx.globalAlpha = op;

  if (o.type === 'shape') {
    const path = o._shapePath && o._shapeKey === `${o.shape}${o.w}x${o.h}` ? o._shapePath : null;
    let p = path;
    if (!p) { p = shapePath(o.shape, o.w, o.h); o._shapePath = p; o._shapeKey = `${o.shape}${o.w}x${o.h}`; }
    if (o.s.fill && o.s.fill !== 'transparent') { ctx.fillStyle = o.s.fill; ctx.fill(p); }
    if (o.s.sw > 0) {
      ctx.strokeStyle = o.s.stroke; ctx.lineWidth = o.s.sw; ctx.lineJoin = 'round';
      applyDash(ctx, o.s.dash, o.s.sw);
      ctx.stroke(p);
      ctx.setLineDash([]);
    }
    drawText(ctx, o, view);
  } else if (o.type === 'sticky') {
    // мягкая тень без shadowBlur (дорого): две полупрозрачные подложки
    if (view.zoom > 0.15) {
      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      ctx.fillRect(2, 4, o.w, o.h);
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.fillRect(1, 2, o.w + 1, o.h + 1);
    }
    ctx.fillStyle = o.s.fill;
    ctx.fillRect(0, 0, o.w, o.h);
    drawText(ctx, o, view);
  } else if (o.type === 'text') {
    drawText(ctx, o, view);
  } else if (o.type === 'frame') {
    ctx.fillStyle = o.s.fill;
    ctx.globalAlpha = op * 0.85;
    ctx.fillRect(0, 0, o.w, o.h);
    ctx.globalAlpha = op;
    ctx.strokeStyle = o.s.stroke;
    ctx.lineWidth = Math.max(1 / view.zoom, o.s.sw);
    ctx.strokeRect(0, 0, o.w, o.h);
    if (view.zoom > 0.12 && view.editingId !== o.id) {
      const size = 14 / view.zoom;
      ctx.font = `600 ${size}px ${FONTS.sans}`;
      ctx.fillStyle = view.dark ? '#c4c7ca' : '#5f6368';
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      let t = o.title || 'Frame';
      ctx.fillText(t, 0, -6 / view.zoom);
    }
  } else if (o.type === 'image') {
    const e = view.images.get(o.assetId);
    if (e.img) ctx.drawImage(e.img, 0, 0, o.w, o.h);
    else {
      ctx.fillStyle = '#e8eaed';
      ctx.fillRect(0, 0, o.w, o.h);
    }
  }
  ctx.restore();
}
