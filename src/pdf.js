// Минимальный генератор PDF для запасного (растрового) экспорта вне Electron: одна страница с JPEG на всю площадь.
// Векторный PDF в приложении делает Chromium через webContents.printToPDF (см. main.js).
const enc = new TextEncoder();

export function jpegToPdf(jpeg, wPx, hPx) {
  const W = +(wPx * 0.75).toFixed(2); // CSS-пиксели в пункты PDF
  const H = +(hPx * 0.75).toFixed(2);
  const parts = [];
  const offsets = [];
  let len = 0;
  const push = (data) => {
    const b = typeof data === 'string' ? enc.encode(data) : data;
    parts.push(b);
    len += b.length;
  };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  offsets[5] = len;
  push(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${Math.round(wPx)} /Height ${Math.round(hPx)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push('\nendstream\nendobj\n');
  const xref = len;
  let x = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}
