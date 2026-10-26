import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('service worker precache list matches the files the app serves', () => {
  const text = fs.readFileSync(path.join(src, 'sw.js'), 'utf8');
  const listed = new Set([...text.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]));
  const actual = walk(src)
    .map((f) => path.relative(src, f).split(path.sep).join('/'))
    .filter((f) => /\.(js|css|html|webmanifest|png)$/.test(f) && f !== 'sw.js');
  const missing = actual.filter((f) => !listed.has(f));
  const stale = [...listed].filter((f) => f !== './' && !actual.includes(f));
  assert.deepEqual(missing, [], 'files missing from the SW precache list');
  assert.deepEqual(stale, [], 'SW precache lists files that do not exist');
});

test('manifest is installable: name, scope, standalone, 192 and 512 icons that exist', () => {
  const m = JSON.parse(fs.readFileSync(path.join(src, 'manifest.webmanifest'), 'utf8'));
  assert.ok(m.name && m.short_name);
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(src, i.src)), i.src);
});

test('app code uses only relative URLs so it works under a repository sub-path (GitHub Pages)', () => {
  const bad = [];
  for (const f of walk(src).filter((x) => x.endsWith('.js') || x.endsWith('.html') || x.endsWith('.css'))) {
    const t = fs.readFileSync(f, 'utf8');
    if (/from\s+'\/[^/]/.test(t) || /(?:src|href)="\/[^/]/.test(t) || /url\(\/[^/]/.test(t)) bad.push(path.relative(src, f));
  }
  assert.deepEqual(bad, []);
});
