import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOKS, isDarkColor, INK_ON_DARK, INK_ON_LIGHT } from '../../src/looks.js';

test('isDarkColor classifies backgrounds', () => {
  for (const c of ['#000000', '#0f1424', '#2b2f36', '#2f4a3f', '#16408f']) assert.ok(isDarkColor(c), c);
  for (const c of ['#ffffff', '#f6f7f9', '#fbf5e6', '#e8f1fb', '#eaf6ef']) assert.ok(!isDarkColor(c), c);
  assert.ok(!isDarkColor(null));
});

test('look presets are valid and ink stays readable', () => {
  const ids = new Set();
  for (const lk of LOOKS) {
    assert.ok(!ids.has(lk.id)); ids.add(lk.id);
    assert.ok(typeof lk.name() === 'string' && lk.name());
    if (lk.bg) assert.match(lk.bg, /^#[0-9a-f]{6}$/i);
    if (lk.line) assert.match(lk.line, /^#[0-9a-f]{6}$/i);
    // нейтральное чернило должно быть светлым на тёмных схемах и тёмным на светлых
    assert.ok(isDarkColor(INK_ON_LIGHT) && !isDarkColor(INK_ON_DARK));
  }
  assert.ok(LOOKS.some((l) => isDarkColor(l.bg)) && LOOKS.some((l) => l.bg && !isDarkColor(l.bg)));
});
