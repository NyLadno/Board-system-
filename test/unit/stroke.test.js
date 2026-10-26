import test from 'node:test';
import assert from 'node:assert/strict';
import { StrokeBuilder, predictTip, buildOutline, buildPolyline, radiusFor, simplifyFlat } from '../../src/render/stroke.js';
import { SvgPath } from '../../src/export.js';

test('radiusFor scales with pressure only when sensitivity > 0', () => {
  assert.equal(radiusFor(4, 0.1, 0), 2);
  assert.equal(radiusFor(4, 1, 0), 2);
  assert.ok(radiusFor(4, 1, 1) > radiusFor(4, 0.2, 1));
  assert.ok(Math.abs(radiusFor(4, 0.5, 1) - 2) < 1e-9, 'p=0.5 equals the base size');
});

test('StrokeBuilder drops sub-pixel duplicates but keeps real motion', () => {
  const sb = new StrokeBuilder({ size: 3, zoom: 1, minDist: 0.5 });
  assert.ok(sb.add(0, 0, 0.5, 0));
  assert.ok(!sb.add(0.1, 0.1, 0.5, 4));
  assert.ok(sb.add(2, 0, 0.5, 8));
  assert.equal(sb.length, 2);
});

test('StrokeBuilder without smoothing reproduces input exactly (no lag)', () => {
  const sb = new StrokeBuilder({ size: 3, zoom: 1, smoothing: 0 });
  for (let i = 0; i < 20; i++) sb.add(i * 3, i * i, 0.5, i * 4);
  for (let i = 0; i < 20; i++) { assert.equal(sb.X[i], i * 3); assert.equal(sb.Y[i], i * i); }
});

test('one-euro smoothing follows fast motion closely', () => {
  const sb = new StrokeBuilder({ size: 3, zoom: 1, smoothing: 0.35 });
  let last;
  for (let i = 0; i < 60; i++) { sb.add(i * 8, 0, 0.5, i * 8); last = sb.X[sb.length - 1]; }
  // скорость 1000 px/с: отставание должно быть в пределах пары пикселей
  assert.ok(59 * 8 - last < 5, 'lag ' + (59 * 8 - last));
});

test('predictTip extrapolates straight motion accurately and stays within bounds', () => {
  // 1500 px/с, событие каждые 8 мс
  const X = [], Y = [], T = [];
  for (let i = 0; i < 8; i++) { X.push(i * 12); Y.push(0); T.push(i * 8); }
  const out = {};
  assert.ok(predictTip(X, Y, T, 14, 1, out));
  const ahead = out.x - X[7];
  assert.ok(ahead > 15 && ahead <= 26, 'ahead ' + ahead);
  assert.ok(Math.abs(out.y) < 1e-9);
});

test('predictTip is silent on slow motion, sharp turns and too little history', () => {
  const out = {};
  const slowX = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2], slowY = slowX.map(() => 0), T = [0, 8, 16, 24, 32, 40, 48];
  assert.ok(!predictTip(slowX, slowY, T, 14, 1, out));
  // быстро вправо, затем резко вверх (поворот только что случился)
  const X = [], Y = [], T2 = [];
  for (let i = 0; i < 6; i++) { X.push(i * 12); Y.push(0); T2.push(i * 8); }
  for (let i = 1; i < 3; i++) { X.push(60); Y.push(-i * 12); T2.push(40 + i * 8); }
  assert.ok(!predictTip(X, Y, T2, 14, 1, out));
  assert.ok(!predictTip([0, 1], [0, 0], [0, 8], 14, 1, out));
});

test('predictTip is stable against timestamp noise', () => {
  // постоянная скорость 1000 px/с, но отметки времени дрожат на ±2 мс
  const out = {}, tips = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const X = [], Y = [], T = [];
  for (let i = 0; i < 40; i++) {
    X.push(i * 8); Y.push(0); T.push(i * 8 + (rnd() - 0.5) * 4);
    if (i > 8) { assert.ok(predictTip(X, Y, T, 14, 1, out)); tips.push(out.x - X[i]); }
  }
  const spread = Math.max(...tips) - Math.min(...tips);
  assert.ok(spread < 6, 'tip distance varies by ' + spread.toFixed(2) + ' px');
});

test('prediction error on a circle is far below the lag it removes', () => {
  // окружность радиуса 100, скорость 1200 px/с, шаг события 8 мс
  const P = (t) => [100 * Math.cos(t * 0.012), 100 * Math.sin(t * 0.012)];
  const X = [], Y = [], T = [];
  for (let i = 0; i < 8; i++) { const [x, y] = P(i * 8); X.push(x); Y.push(y); T.push(i * 8); }
  const out = {};
  assert.ok(predictTip(X, Y, T, 14, 1, out));
  const [tx, ty] = P(7 * 8 + 14);
  const err = Math.hypot(out.x - tx, out.y - ty);
  const lag = Math.hypot(X[7] - tx, Y[7] - ty);
  assert.ok(err < lag * 0.35, `err ${err.toFixed(2)} vs lag ${lag.toFixed(2)}`);
});

test('outline is a closed path for 1, 2 and many points', () => {
  for (const n of [1, 2, 3, 50]) {
    const X = [], Y = [], R = [];
    for (let i = 0; i < n; i++) { X.push(i * 5); Y.push(Math.sin(i) * 5); R.push(2); }
    const p = new SvgPath();
    buildOutline(p, X, Y, R, 0, n - 1);
    const d = p.toString();
    assert.ok(d.startsWith('M'), d);
    assert.ok(d.endsWith('Z'), d);
    assert.ok(!/NaN/.test(d), d);
  }
});

test('polyline path has no NaN for a dot', () => {
  const p = new SvgPath();
  buildPolyline(p, [3], [4], 0, 0);
  assert.ok(!/NaN/.test(p.toString()));
});

test('simplifyFlat reduces collinear points', () => {
  const pts = [];
  for (let i = 0; i < 100; i++) pts.push(i, 0, 1);
  const out = simplifyFlat(pts, 0.5);
  assert.equal(out.length, 6);
});

test('smoothing removes pixel quantization jitter on a slow stroke', () => {
  // медленная прямая линия, координаты округлены до целых пикселей (как у драйвера планшета)
  const mk = (smoothing) => {
    const sb = new StrokeBuilder({ size: 3, zoom: 1, smoothing, minDist: 0.1 });
    for (let i = 0; i < 120; i++) sb.add(Math.round(i * 1.3), Math.round(100 + Math.sin(i / 20) * 6 + (i % 3) * 0.2), 0.5, i * 6);
    return sb;
  };
  // «дрожание» как сумма модулей вторых разностей по Y
  const rough = (sb) => { let s = 0; for (let i = 2; i < sb.length; i++) s += Math.abs(sb.Y[i] - 2 * sb.Y[i - 1] + sb.Y[i - 2]); return s; };
  assert.ok(rough(mk(0.35)) < rough(mk(0)) * 0.6, `${rough(mk(0.35)).toFixed(1)} vs ${rough(mk(0)).toFixed(1)}`);
});
