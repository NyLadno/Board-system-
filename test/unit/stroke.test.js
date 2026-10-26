import test from 'node:test';
import assert from 'node:assert/strict';
import { StrokeBuilder, predictPoints, buildOutline, buildPolyline, radiusFor, simplifyFlat } from '../../src/render/stroke.js';
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
  const sb = new StrokeBuilder({ size: 3, zoom: 1, smoothing: 0.5 });
  let last;
  for (let i = 0; i < 60; i++) { sb.add(i * 8, 0, 0.5, i * 8); last = sb.X[sb.length - 1]; }
  // скорость 1000 px/с: отставание должно быть в пределах пары пикселей
  assert.ok(59 * 8 - last < 6, 'lag ' + (59 * 8 - last));
});

test('predictPoints extrapolates straight motion accurately', () => {
  const X = [0, 8, 16], Y = [0, 0, 0], T = [0, 8, 16];
  const ox = [], oy = [];
  const n = predictPoints(X, Y, T, 16, 1, ox, oy);
  assert.equal(n, 3);
  assert.ok(Math.abs(ox[2] - 32) < 1, 'x=' + ox[2]);
  assert.ok(Math.abs(oy[2]) < 1e-6);
});

test('predictPoints is silent on slow motion and sharp turns', () => {
  const ox = [], oy = [];
  assert.equal(predictPoints([0, 0.1, 0.2], [0, 0, 0], [0, 8, 16], 16, 1, ox, oy), 0);
  assert.equal(predictPoints([0, 20, 0], [0, 0, 1], [0, 8, 16], 16, 1, ox, oy), 0);
});

test('prediction error on a circle stays below the lag it removes', () => {
  // окружность радиуса 100, скорость 1200 px/с, шаг события 8 мс
  const R = 100, w = 12 / R, dt = 8;
  const pos = (t) => [R * Math.cos((w * t) / 1000 * 1000 / 1000), 0];
  const P = (t) => [R * Math.cos(t * 0.012), R * Math.sin(t * 0.012)];
  const X = [], Y = [], T = [];
  for (let i = 0; i < 3; i++) { const [x, y] = P(i * dt); X.push(x); Y.push(y); T.push(i * dt); }
  const ox = [], oy = [];
  predictPoints(X, Y, T, 16, 1, ox, oy);
  const [tx, ty] = P(2 * dt + 16);
  const err = Math.hypot(ox[2] - tx, oy[2] - ty);
  const lag = Math.hypot(X[2] - tx, Y[2] - ty);
  assert.ok(err < lag * 0.2, `err ${err.toFixed(2)} vs lag ${lag.toFixed(2)}`);
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
