import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DICTS } from '../../src/i18n.js';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []));
}

test('every t("key") used in the code exists in both languages', () => {
  const used = new Set();
  for (const f of walk(src)) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\bt\('([A-Za-z_0-9]+)'/g)) if (!m[1].endsWith('_')) used.add(m[1]);
  }
  const missing = [];
  for (const k of used) for (const lang of ['ru', 'en']) if (!(k in DICTS[lang])) missing.push(`${lang}:${k}`);
  assert.deepEqual(missing, []);
});

test('shape names and dictionaries stay in sync', () => {
  for (const s of ['rect', 'round', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star', 'parallelogram', 'arrow', 'cloud']) {
    assert.ok(DICTS.ru['shape_' + s] && DICTS.en['shape_' + s], s);
  }
  assert.deepEqual(Object.keys(DICTS.ru).sort(), Object.keys(DICTS.en).sort());
});
