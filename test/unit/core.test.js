import test from 'node:test';
import assert from 'node:assert/strict';
import { distToSegment, pointInRotRect, aabbOf, normalizeRect, rectsIntersect } from '../../src/core/geometry.js';
import { Camera } from '../../src/core/camera.js';
import { Scene, makeShape, makeConnector, makeSticky, serializeObj, shiftObj } from '../../src/core/scene.js';
import { History } from '../../src/core/history.js';
import { parseBoardJSON } from '../../src/export.js';

test('distToSegment', () => {
  assert.equal(distToSegment(5, 5, 0, 0, 10, 0), 5);
  assert.equal(distToSegment(-3, 0, 0, 0, 10, 0), 3);
});

test('pointInRotRect and aabb of rotated rect', () => {
  const o = { x: 0, y: 0, w: 100, h: 20, rot: Math.PI / 2 };
  // после поворота на 90 градусов прямоугольник стоит вертикально вокруг центра (50,10)
  assert.ok(pointInRotRect(50, 50, o));
  assert.ok(!pointInRotRect(95, 10, o));
  const b = aabbOf(o);
  assert.ok(Math.abs(b.w - 20) < 1e-9 && Math.abs(b.h - 100) < 1e-9);
});

test('normalizeRect and intersect', () => {
  assert.deepEqual(normalizeRect(10, 10, 0, 5), { x: 0, y: 5, w: 10, h: 5 });
  assert.ok(rectsIntersect({ x: 0, y: 0, w: 5, h: 5 }, { x: 4, y: 4, w: 5, h: 5 }));
  assert.ok(!rectsIntersect({ x: 0, y: 0, w: 5, h: 5 }, { x: 6, y: 6, w: 5, h: 5 }));
});

test('camera zoomAt keeps the anchor point fixed', () => {
  const c = new Camera();
  c.x = 100; c.y = 50; c.z = 1.5;
  const before = c.toWorld(300, 200);
  c.zoomAt(300, 200, 2);
  const after = c.toWorld(300, 200);
  assert.ok(Math.abs(before[0] - after[0]) < 1e-9 && Math.abs(before[1] - after[1]) < 1e-9);
  assert.ok(Math.abs(c.z - 3) < 1e-9);
});

test('camera fit centers rect', () => {
  const c = new Camera();
  c.w = 1000; c.h = 600;
  c.fit({ x: 0, y: 0, w: 400, h: 200 }, 100, 5);
  const [cx, cy] = c.toWorld(500, 300);
  assert.ok(Math.abs(cx - 200) < 1e-6 && Math.abs(cy - 100) < 1e-6);
});

test('scene hit testing: topmost, outline only for transparent shapes', () => {
  const s = new Scene();
  const a = s.add(makeShape('rect', 0, 0, 100, 100));
  const b = s.add(makeShape('rect', 50, 50, 100, 100));
  assert.equal(s.hit(75, 75, 1).id, b.id);
  assert.equal(s.hit(10, 10, 1).id, a.id);
  assert.equal(s.hit(500, 500, 1), null);
  a.s.fill = 'transparent';
  b.z = 0;
  s.reorder();
  assert.equal(s.hit(20, 20, 1), null, 'inside of unfilled shape is empty');
  assert.equal(s.hit(0, 50, 1).id, a.id, 'border still hits');
});

test('connector follows moved shape and survives deletion', () => {
  const s = new Scene();
  const a = s.add(makeShape('rect', 0, 0, 100, 100));
  const b = s.add(makeShape('rect', 300, 0, 100, 100));
  const c = s.add(makeConnector({ id: a.id, port: 'r' }, { id: b.id, port: 'l' }, 'straight'));
  let r = s.route(c);
  assert.deepEqual([r.pts[0], r.pts[1], r.pts[2], r.pts[3]], [100, 50, 300, 50]);
  b.y = 100;
  s.invalidate(b);
  r = s.route(c);
  assert.equal(r.pts[3], 150);
  s.remove(b.id);
  assert.equal(c.to.id, undefined);
  assert.equal(c.to.y, 150);
});

test('elbow route ends exactly on ports', () => {
  const s = new Scene();
  const a = s.add(makeShape('rect', 0, 0, 100, 100));
  const b = s.add(makeShape('rect', 300, 200, 100, 100));
  const c = s.add(makeConnector({ id: a.id, port: 'r' }, { id: b.id, port: 't' }, 'elbow'));
  const p = s.route(c).pts;
  assert.deepEqual([p[0], p[1]], [100, 50]);
  assert.deepEqual([p[p.length - 2], p[p.length - 1]], [350, 200]);
  // все звенья ортогональны
  for (let i = 0; i + 3 < p.length; i += 2) assert.ok(p[i] === p[i + 2] || p[i + 1] === p[i + 3]);
});

test('serialization drops cache fields', () => {
  const s = new Scene();
  const o = s.add(makeSticky(0, 0));
  s.bounds(o);
  assert.ok(o._b);
  const j = serializeObj(o);
  assert.ok(!Object.keys(j).some((k) => k.startsWith('_')));
  const s2 = new Scene();
  s2.load(JSON.parse(JSON.stringify(s.toJSON())));
  assert.equal(s2.all().length, 1);
});

test('history undo/redo for create, modify, delete', () => {
  const s = new Scene();
  const h = new History(s);
  let tx = h.begin();
  const o = s.add(makeShape('rect', 0, 0, 10, 10), true);
  tx.add(o); tx.commit();
  assert.equal(s.all().length, 1);

  tx = h.begin();
  tx.track(o);
  o.x = 50;
  tx.commit();
  assert.equal(s.get(o.id).x, 50);

  tx = h.begin();
  tx.del(o);
  s.remove(o.id, true);
  tx.commit();
  assert.equal(s.all().length, 0);

  h.undo();
  assert.equal(s.get(o.id).x, 50);
  h.undo();
  assert.equal(s.get(o.id).x, 0);
  h.undo();
  assert.equal(s.all().length, 0);
  h.redo(); h.redo(); h.redo();
  assert.equal(s.all().length, 0);
  assert.ok(!h.canRedo());
});

test('history ignores no-op transactions', () => {
  const s = new Scene();
  const h = new History(s);
  const o = s.add(makeShape('rect', 0, 0, 10, 10), true);
  const tx = h.begin();
  tx.track(o);
  assert.equal(tx.commit(), false);
  assert.ok(!h.canUndo());
});

test('parseBoardJSON validates input', () => {
  assert.throws(() => parseBoardJSON('{"x":1}'));
  assert.throws(() => parseBoardJSON('nope'));
  const ok = parseBoardJSON(JSON.stringify({
    app: 'board-system', name: 'N', objects: [{ id: 'a', type: 'shape' }, { id: 'b', type: 'evil' }, null],
    assets: { 'a.png': 'data:image/png;base64,AAA', 'b': 'http://x' },
  }));
  assert.equal(ok.objects.length, 1);
  assert.deepEqual(Object.keys(ok.assets), ['a.png']);
});

test('shiftObj moves shapes, stroke points and free connector ends, but not attached ones', () => {
  const sh = makeShape('rect', 1000, 2000, 10, 10);
  shiftObj(sh, 1000, 500);
  assert.deepEqual([sh.x, sh.y], [0, 1500]);
  const st = { type: 'stroke', x: 10, y: 20, w: 5, h: 5, pts: [10, 20, 1, 12, 22, 1] };
  shiftObj(st, 10, 20);
  assert.deepEqual(st.pts, [0, 0, 1, 2, 2, 1]);
  const c = makeConnector({ id: 'a', port: 'r' }, { x: 100, y: 50 });
  shiftObj(c, 100, 50);
  assert.equal(c.from.id, 'a');
  assert.deepEqual([c.to.x, c.to.y], [0, 0]);
});

test('rebasing keeps relative geometry, hits and history consistent', () => {
  const s = new Scene();
  const h = new History(s);
  const D = 123456789;
  const a = makeShape('rect', D, D, 100, 100);
  const b = makeShape('rect', D + 300, D, 100, 100);
  let tx = h.begin();
  s.add(a, true); s.add(b, true); tx.add(a); tx.add(b); tx.commit();
  tx = h.begin(); tx.track(a); a.x += 50; tx.commit();
  const c = s.add(makeConnector({ id: a.id, port: 'r' }, { id: b.id, port: 'l' }, 'straight'));
  const before = s.route(c).pts.map((v) => v - D);
  s.shiftAll(D, D);
  h.shiftAll(D, D);
  const after = s.route(c).pts;
  assert.deepEqual(after, before);
  assert.equal(s.hit(80, 40, 1).id, a.id, 'hit works at the new origin');
  h.undo();
  assert.equal(s.get(a.id).x, 0, 'undo restores the pre-edit position in shifted coordinates');
  h.redo();
  assert.equal(s.get(a.id).x, 50);
});
