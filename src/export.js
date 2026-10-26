import { buildOutline, buildPolyline, flatToArrays } from './render/stroke.js';
import { shapePath, layoutOf, fontFamily, textBox, LINE_H } from './render/draw.js';

const f = (n) => Math.round(n * 100) / 100;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Запись команд пути в строку SVG. Совместима с интерфейсом Path2D, который используют построители контуров.
export class SvgPath {
  constructor() { this.d = []; this.has = false; }
  moveTo(x, y) { this.d.push(`M${f(x)} ${f(y)}`); this.has = true; }
  lineTo(x, y) { this.d.push(`${this.has ? 'L' : 'M'}${f(x)} ${f(y)}`); this.has = true; }
  quadraticCurveTo(cx, cy, x, y) { this.d.push(`Q${f(cx)} ${f(cy)} ${f(x)} ${f(y)}`); }
  bezierCurveTo(a, b, c, d, x, y) { this.d.push(`C${f(a)} ${f(b)} ${f(c)} ${f(d)} ${f(x)} ${f(y)}`); }
  closePath() { this.d.push('Z'); }
  rect(x, y, w, h) { this.d.push(`M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`); this.has = true; }
  roundRect(x, y, w, h, r) {
    this.d.push(`M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}` +
      `A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}` +
      `V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`);
    this.has = true;
  }
  ellipse(cx, cy, rx, ry) {
    this.d.push(`M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`);
    this.has = true;
  }
  arc(cx, cy, r, a0, a1, ccw) {
    let da = a1 - a0;
    if (ccw && da > 0) da -= Math.PI * 2;
    if (!ccw && da < 0) da += Math.PI * 2;
    const n = Math.max(4, Math.ceil(Math.abs(da) / (Math.PI / 8)));
    for (let i = 0; i <= n; i++) {
      const a = a0 + (da * i) / n;
      this.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  }
  toString() { return this.d.join(''); }
}

function textSvg(o) {
  if (!o.text) return '';
  const L = layoutOf(o);
  const lh = L.size * LINE_H;
  const { box } = L;
  let y0 = box.y;
  if (o.type !== 'text') y0 = box.y + (box.h - L.height) / 2;
  const align = o.ts.align || 'left';
  const x = align === 'center' ? box.x + box.w / 2 : align === 'right' ? box.x + box.w : box.x;
  const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
  const lines = L.lines.map((ln, i) => `<text x="${f(x)}" y="${f(y0 + lh * (i + 0.5))}" dominant-baseline="central" text-anchor="${anchor}" xml:space="preserve">${esc(ln)}</text>`).join('');
  return `<g font-family="${esc(fontFamily(o.ts))}" font-size="${f(L.size)}" font-weight="${o.ts.bold ? 700 : 400}" font-style="${o.ts.italic ? 'italic' : 'normal'}" fill="${esc(o.ts.color || '#1a1a1a')}">${lines}</g>`;
}

function dashAttr(dash, sw) {
  if (dash === 'dashed') return ` stroke-dasharray="${sw * 4} ${sw * 3}"`;
  if (dash === 'dotted') return ` stroke-dasharray="${sw} ${sw * 2}"`;
  return '';
}

async function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

async function objSvg(app, o) {
  const op = o.s && o.s.opacity != null && o.s.opacity !== 1 ? ` opacity="${o.s.opacity}"` : '';
  if (o.type === 'stroke') {
    const p = new SvgPath();
    const { X, Y, R } = flatToArrays(o.pts);
    if (o.s.var) buildOutline(p, X, Y, R, 0, X.length - 1);
    else buildPolyline(p, X, Y, 0, X.length - 1);
    if (o.s.hl) return `<path d="${p}" fill="none" stroke="${esc(o.s.color)}" stroke-opacity="0.38" stroke-width="${f(o.s.size)}" stroke-linecap="round" stroke-linejoin="round" style="mix-blend-mode:multiply"/>`;
    if (o.s.var) return `<path d="${p}" fill="${esc(o.s.color)}"/>`;
    return `<path d="${p}" fill="none" stroke="${esc(o.s.color)}" stroke-width="${f(o.s.size)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (o.type === 'connector') {
    const r = app.scene.route(o);
    let d;
    if (r.curve) { const c = r.curve; d = `M${f(c[0])} ${f(c[1])}C${f(c[2])} ${f(c[3])} ${f(c[4])} ${f(c[5])} ${f(c[6])} ${f(c[7])}`; }
    else d = 'M' + r.pts.reduce((a, v, i) => a + (i ? (i % 2 ? ' ' : 'L') : '') + f(v), '');
    let s = `<path d="${d}" fill="none" stroke="${esc(o.s.stroke)}" stroke-width="${o.s.sw}" stroke-linejoin="round"${dashAttr(o.s.dash, o.s.sw)}${op}/>`;
    const n = r.pts.length, hs = 8 + o.s.sw * 2.5;
    const head = (x, y, ang) => {
      const c = Math.cos(ang), sn = Math.sin(ang);
      const pt = (dx, dy) => `${f(x + dx * c - dy * sn)},${f(y + dx * sn + dy * c)}`;
      return `<polygon points="${pt(0, 0)} ${pt(-hs, -hs / 2)} ${pt(-hs, hs / 2)}" fill="${esc(o.s.stroke)}"/>`;
    };
    if (o.head === 'arrow') s += head(r.pts[n - 2], r.pts[n - 1], Math.atan2(r.pts[n - 1] - r.pts[n - 3], r.pts[n - 2] - r.pts[n - 4]));
    if (o.tail === 'arrow') s += head(r.pts[0], r.pts[1], Math.atan2(r.pts[1] - r.pts[3], r.pts[0] - r.pts[2]));
    return s;
  }
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  const tr = `transform="translate(${f(cx)} ${f(cy)}) rotate(${f(((o.rot || 0) * 180) / Math.PI)}) translate(${f(-o.w / 2)} ${f(-o.h / 2)})"`;
  let body = '';
  if (o.type === 'shape') {
    const p = shapePath(o.shape, o.w, o.h, SvgPath);
    const fill = o.s.fill && o.s.fill !== 'transparent' ? esc(o.s.fill) : 'none';
    body = `<path d="${p}" fill="${fill}" stroke="${o.s.sw > 0 ? esc(o.s.stroke) : 'none'}" stroke-width="${o.s.sw}" stroke-linejoin="round"${dashAttr(o.s.dash, o.s.sw)}/>${textSvg(o)}`;
  } else if (o.type === 'sticky') {
    body = `<rect width="${f(o.w)}" height="${f(o.h)}" fill="${esc(o.s.fill)}"/>${textSvg(o)}`;
  } else if (o.type === 'text') {
    body = textSvg(o);
  } else if (o.type === 'frame') {
    body = `<rect width="${f(o.w)}" height="${f(o.h)}" fill="${esc(o.s.fill)}" stroke="${esc(o.s.stroke)}"/>` +
      `<text x="0" y="-6" font-size="14" font-weight="600" font-family="sans-serif" fill="#5f6368">${esc(o.title || 'Frame')}</text>`;
  } else if (o.type === 'image') {
    try {
      const url = await blobToDataURL(await app.storage.getAssetBlob(o.assetId));
      body = `<image width="${f(o.w)}" height="${f(o.h)}" href="${url}" preserveAspectRatio="none"/>`;
    } catch { body = ''; }
  }
  return `<g ${tr}${op}>${body}</g>`;
}

// size: необязательный размер в пикселях (viewBox сохраняется, содержимое масштабируется)
export async function exportSVGParts(app, objs, size) {
  const b = app.scene.boundsOf(objs);
  const pad = 20;
  const x = f(b.x - pad), y = f(b.y - pad), w = f(b.w + pad * 2), h = f(b.h + pad * 2);
  const parts = [];
  for (const o of [...objs].sort((a, c) => a.z - c.z)) parts.push(await objSvg(app, o));
  const k = size ? Math.min(1, size / Math.max(w, h)) : 1;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${f(w * k)}" height="${f(h * k)}">` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>${parts.join('')}</svg>`;
  return { svg, w: f(w * k), h: f(h * k) };
}

export async function exportSVGString(app, objs) {
  return (await exportSVGParts(app, objs)).svg;
}

// PDF: в Electron векторный (печать SVG движком Chromium), в браузере запасной растровый
export async function exportPDFBytes(app, objs) {
  if (app.boardAPI && app.boardAPI.exportPDF) {
    // страница PDF не может быть больше 200 дюймов, поэтому очень большие доски вписываем в 14000 px
    const { svg, w, h } = await exportSVGParts(app, objs, 14000);
    return app.boardAPI.exportPDF(svg, w, h);
  }
  const b = app.scene.boundsOf(objs);
  const pad = 24;
  const rect = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  const scale = Math.min(2, 8000 / Math.max(rect.w, rect.h));
  const cv = app.renderer.renderToCanvas([...objs].sort((a, c) => a.z - c.z), rect, scale, { background: '#ffffff' });
  const jpeg = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.92));
  const { jpegToPdf } = await import('./pdf.js');
  return jpegToPdf(new Uint8Array(await jpeg.arrayBuffer()), cv.width / scale, cv.height / scale);
}

export function exportPNGBlob(app, objs) {
  const b = app.scene.boundsOf(objs);
  const pad = 24;
  const rect = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  const scale = Math.min(2, 8192 / Math.max(rect.w, rect.h));
  const cv = app.renderer.renderToCanvas([...objs].sort((a, c) => a.z - c.z), rect, scale, { background: '#ffffff' });
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

export async function exportBoardJSON(app) {
  const objects = app.scene.toJSON();
  const assets = {};
  for (const o of objects) {
    if (o.assetId && !assets[o.assetId]) {
      try { assets[o.assetId] = await blobToDataURL(await app.storage.getAssetBlob(o.assetId)); } catch { /* пропущено */ }
    }
  }
  return JSON.stringify({ app: 'board-system', v: 1, name: app.meta.name, objects, assets, camera: app.cam.toJSON(), bg: app.boardBg });
}

const TYPES = new Set(['stroke', 'shape', 'sticky', 'text', 'frame', 'image', 'connector']);

export function parseBoardJSON(text) {
  const d = JSON.parse(text);
  if (!d || d.app !== 'board-system' || !Array.isArray(d.objects)) throw new Error('not a board');
  const objects = d.objects.filter((o) => o && typeof o.id === 'string' && TYPES.has(o.type));
  const assets = {};
  if (d.assets && typeof d.assets === 'object') {
    for (const [k, v] of Object.entries(d.assets)) if (typeof v === 'string' && v.startsWith('data:image/')) assets[k] = v;
  }
  const bg = ['dots', 'grid', 'cells', 'none'].includes(d.bg) ? d.bg : null;
  return { name: typeof d.name === 'string' ? d.name.slice(0, 120) : null, objects, assets, bg };
}
