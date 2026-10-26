import { serializeObj, shiftObj } from './scene.js';

// Откат и повтор на основе снимков изменённых объектов.
// tx = history.begin(); tx.track(obj) ПЕРЕД изменением; tx.add(obj) для новых;
// tx.del(obj) перед удалением; tx.commit() в конце.
export class History {
  constructor(scene) {
    this.scene = scene;
    this.undoStack = [];
    this.redoStack = [];
    this.limit = 300;
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); }
  fire() { for (const fn of this.listeners) fn(); }

  begin() { return new Tx(this); }

  push(entry) {
    if (!entry.length) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.fire();
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.fire();
  }

  // убрать последнюю запись, если она создавала объект id (используется для пустых новых текстов)
  dropLast(id) {
    const e = this.undoStack[this.undoStack.length - 1];
    if (e && e.length === 1 && e[0].id === id && !e[0].before) { this.undoStack.pop(); this.fire(); }
  }

  // Снимки в истории хранят координаты, поэтому при переносе начала координат их тоже нужно сдвинуть
  shiftAll(dx, dy) {
    for (const stack of [this.undoStack, this.redoStack]) {
      for (const entry of stack) {
        for (const ch of entry) {
          if (ch.before) shiftObj(ch.before, dx, dy);
          if (ch.after) shiftObj(ch.after, dx, dy);
        }
      }
    }
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() { return this.step(this.undoStack, this.redoStack, 'before'); }
  redo() { return this.step(this.redoStack, this.undoStack, 'after'); }

  step(from, to, side) {
    const entry = from.pop();
    if (!entry) return null;
    const touched = [];
    for (const ch of entry) {
      const state = ch[side];
      if (state) {
        const existing = this.scene.get(ch.id);
        if (existing) {
          for (const k of Object.keys(existing)) delete existing[k];
          Object.assign(existing, structuredClone(state));
          this.scene.touch(existing, true);
        } else {
          this.scene.add(structuredClone(state), true);
        }
        touched.push(ch.id);
      } else {
        this.scene.remove(ch.id, true);
      }
    }
    this.scene.reorder();
    to.push(entry);
    this.scene.emit('history');
    this.fire();
    return touched;
  }
}

class Tx {
  constructor(history) {
    this.history = history;
    this.map = new Map();
  }

  track(o) {
    if (!o || this.map.has(o.id)) return o;
    this.map.set(o.id, { id: o.id, before: serializeObj(o), after: null });
    return o;
  }

  trackAll(list) { for (const o of list) this.track(o); }

  add(o) {
    if (!this.map.has(o.id)) this.map.set(o.id, { id: o.id, before: null, after: null });
    return o;
  }

  del(o) { this.track(o); }

  commit() {
    const entry = [];
    for (const ch of this.map.values()) {
      const cur = this.history.scene.get(ch.id);
      ch.after = cur ? serializeObj(cur) : null;
      if (!ch.before && !ch.after) continue;
      if (ch.before && ch.after && JSON.stringify(ch.before) === JSON.stringify(ch.after)) continue;
      entry.push(ch);
    }
    this.history.push(entry);
    return entry.length > 0;
  }
}
