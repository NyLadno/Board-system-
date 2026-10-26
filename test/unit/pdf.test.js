import test from 'node:test';
import assert from 'node:assert/strict';
import { jpegToPdf } from '../../src/pdf.js';

test('jpegToPdf produces a structurally valid single-page PDF', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);
  const pdf = jpegToPdf(jpeg, 800, 400);
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.ok(text.includes('/MediaBox [0 0 600 300]'), 'px to pt at 0.75');
  // каждое смещение из xref указывает на «N 0 obj»
  const xrefPos = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.ok(text.slice(xrefPos).startsWith('xref'));
  const entries = [...text.slice(xrefPos).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  assert.equal(entries.length, 5);
  entries.forEach((off, i) => assert.ok(text.slice(off).startsWith(`${i + 1} 0 obj`), `obj ${i + 1} at ${off}`));
  // JPEG встроен байт в байт, а длина потока указана верно
  const idx = pdf.findIndex((_, i) => pdf[i] === 0xff && pdf[i + 1] === 0xd8);
  assert.deepEqual([...pdf.slice(idx, idx + jpeg.length)], [...jpeg]);
  assert.ok(text.includes(`/Length ${jpeg.length} `));
});
