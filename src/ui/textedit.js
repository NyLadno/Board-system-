import { fontString, fitSize, textBox, textObjectHeight, LINE_H } from '../render/draw.js';

// Редактор текста поверх холста: contenteditable в простом тексте, позиционируется по экранным координатам объекта.
export class TextEditor {
  constructor(app, layer) {
    this.app = app;
    this.layer = layer;
    this.obj = null;
    this.wrap = null;
  }

  get active() { return !!this.obj; }

  begin(o, { fresh = false, selectAll = true } = {}) {
    const app = this.app;
    this.end();
    this.obj = o;
    this.fresh = fresh;
    this.tx = app.history.begin();
    this.tx.track(o);
    this.original = o.text || '';
    const edit = document.createElement('div');
    edit.className = 'te-edit';
    edit.contentEditable = 'plaintext-only';
    edit.spellcheck = false;
    edit.textContent = o.text || '';
    const inner = document.createElement('div');
    inner.className = 'te-inner';
    inner.append(edit);
    const wrap = document.createElement('div');
    wrap.className = 'te-wrap';
    wrap.append(inner);
    this.layer.append(wrap);
    this.wrap = wrap;
    this.inner = inner;
    this.edit = edit;
    app.editingId = o.id;
    this.position();
    app.renderer.markScene();
    edit.addEventListener('input', () => this.onInput());
    edit.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); app.endTextEdit(); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); app.endTextEdit(); }
    });
    edit.addEventListener('pointerdown', (e) => e.stopPropagation());
    edit.addEventListener('blur', () => { if (this.obj === o) app.endTextEdit(); });
    edit.focus();
    const sel = getSelection();
    const range = document.createRange();
    range.selectNodeContents(edit);
    if (!selectAll || !o.text) range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  onInput() {
    const o = this.obj;
    if (!o) return;
    o.text = this.edit.textContent.replace(/\n$/, '');
    if (o.type === 'text') o.h = textObjectHeight(o);
    this.app.scene.touch(o, true);
    this.position();
    this.app.renderer.markUI();
  }

  position() {
    const o = this.obj;
    if (!o) return;
    const { cam } = this.app;
    const z = cam.z;
    const [sx, sy] = cam.toScreen(o.x, o.y);
    const wrap = this.wrap.style;
    wrap.left = sx + 'px';
    wrap.top = sy + 'px';
    wrap.width = o.w * z + 'px';
    wrap.height = o.h * z + 'px';
    wrap.transform = o.rot ? `rotate(${o.rot}rad)` : '';
    const e = this.edit.style;
    if (o.type === 'frame') {
      this.inner.style.cssText = `left:0;top:${-26}px;width:${Math.max(o.w * z, 200)}px;height:22px;align-items:center;`;
      e.fontSize = '14px';
      e.fontFamily = 'inherit';
      e.fontWeight = '600';
      e.textAlign = 'left';
      e.color = 'inherit';
      e.lineHeight = '22px';
      return;
    }
    const box = textBox(o);
    const size = o.type === 'sticky' && o.ts.auto ? fitSize(o) : o.ts.size;
    const i = this.inner.style;
    i.left = box.x * z + 'px';
    i.top = box.y * z + 'px';
    i.width = box.w * z + 'px';
    i.height = box.h * z + 'px';
    i.alignItems = o.type === 'text' ? 'flex-start' : 'center';
    const font = fontString(o.ts, size * z);
    e.font = font;
    e.lineHeight = String(LINE_H);
    e.textAlign = o.ts.align || 'left';
    e.color = o.ts.color || '#1a1a1a';
  }

  end() {
    const o = this.obj;
    if (!o) return;
    const app = this.app;
    this.obj = null;
    this.wrap.remove();
    this.wrap = null;
    app.editingId = null;
    if (o.type === 'frame') o.title = this.edit.textContent.replace(/\n/g, ' ').trim();
    else o.text = this.edit.textContent.replace(/\n$/, '');
    if (o.type === 'text') o.h = textObjectHeight(o);
    const removeEmpty = o.type === 'text' && !o.text.trim();
    if (removeEmpty) {
      app.scene.remove(o.id, true);
      app.clearDeadSelection();
      // новый пустой текст не оставляет следа в истории
      if (this.fresh) app.history.dropLast(o.id);
      else this.tx.commit();
    } else {
      app.scene.touch(o, true);
      this.tx.commit();
    }
    this.tx = null;
    app.touched();
    app.renderer.markScene();
    app.refreshPanel?.();
  }
}
