import { h } from '../core/util.js';

let current = null;

export function closePopover() {
  if (current) {
    current.el.remove();
    document.removeEventListener('pointerdown', current.onDoc, true);
    current = null;
  }
}

// Всплывающее окно у элемента anchor. content это DOM-узел. place: 'above' | 'below' | 'right'
export function popover(anchor, content, { place = 'below', cls = '' } = {}) {
  closePopover();
  const el = h('div', { class: 'popover ' + cls }, content);
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') e.preventDefault(); });
  document.body.append(el);
  const a = anchor.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  let x = a.left + a.width / 2 - r.width / 2;
  let y = place === 'above' ? a.top - r.height - 8 : a.bottom + 8;
  if (place === 'right') { x = a.right + 8; y = a.top + a.height / 2 - r.height / 2; }
  x = Math.max(8, Math.min(innerWidth - r.width - 8, x));
  y = Math.max(8, Math.min(innerHeight - r.height - 8, y));
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  const onDoc = (e) => {
    if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover();
  };
  setTimeout(() => document.addEventListener('pointerdown', onDoc, true), 0);
  current = { el, onDoc, anchor };
  return el;
}

export function isPopoverOpen() { return !!current; }
