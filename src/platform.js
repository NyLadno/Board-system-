// Платформа и подписи сочетаний клавиш. В коде и словарях клавиши записаны по-маковски (⌘ ⇧ ⌥),
// на Windows и Linux они показываются как Ctrl, Shift, Alt.
export function formatKeys(s, mac) {
  if (mac) return s;
  return s
    .replace(/⇧⌘/g, 'Ctrl+Shift+')
    .replace(/⌘⇧/g, 'Ctrl+Shift+')
    .replace(/⌘(?=[A-Za-z0-9[\]=\-,.])/g, 'Ctrl+')
    .replace(/⌘/g, 'Ctrl')
    .replace(/⇧(?=[A-Za-z0-9[\]=\-,.])/g, 'Shift+')
    .replace(/⇧/g, 'Shift')
    .replace(/⌥(?=[A-Za-z0-9[\]=\-,.])/g, 'Alt+')
    .replace(/⌥/g, 'Alt');
}

const plat = typeof window !== 'undefined' && window.boardAPI ? window.boardAPI.platform : (typeof navigator !== 'undefined' ? navigator.platform || '' : '');
export const IS_MAC = /darwin|mac/i.test(plat);
export const IS_WIN = /win/i.test(plat) && !/darwin/i.test(plat);
export const keys = (s) => formatKeys(s, IS_MAC);
