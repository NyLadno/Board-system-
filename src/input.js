// Контроллер ввода: единая точка для мыши, пера, пальцев и колеса/трекпада.
// Нормализует события и передаёт их активному инструменту. Ничего не аллоцирует лишнего на горячем пути пера.
export class Input {
  constructor(app, stage) {
    this.app = app;
    this.stage = stage;
    this.rect = stage.getBoundingClientRect();
    this.active = null; // { id, type, tool, temp }
    this.touches = new Map();
    this.gesture = null;
    this.spaceDown = false;
    this.panning = null;
    this.lastPenAt = 0;
    this.lastDown = { t: 0, x: 0, y: 0 };
    this.penInRange = false;
    stage.style.touchAction = 'none';

    new ResizeObserver(() => { this.rect = stage.getBoundingClientRect(); }).observe(stage);
    window.addEventListener('scroll', () => { this.rect = stage.getBoundingClientRect(); }, true);
    window.addEventListener('resize', () => { this.rect = stage.getBoundingClientRect(); });

    stage.addEventListener('pointerdown', (e) => this.onDown(e));
    stage.addEventListener('pointermove', (e) => this.onMove(e));
    stage.addEventListener('pointerup', (e) => this.onUp(e));
    stage.addEventListener('pointercancel', (e) => this.onUp(e));
    stage.addEventListener('lostpointercapture', (e) => { if (this.active && this.active.id === e.pointerId) this.onUp(e); });
    stage.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.addEventListener('pointerleave', (e) => { if (!this.active) app.setHover(null); });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.spaceDown = false; this.updateCursor(); });
  }

  norm(e) {
    const cam = this.app.cam;
    const x = e.clientX - this.rect.left;
    const y = e.clientY - this.rect.top;
    return {
      id: e.pointerId,
      type: e.pointerType,
      x, y,
      wx: x / cam.z + cam.x,
      wy: y / cam.z + cam.y,
      p: e.pressure,
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey || e.ctrlKey,
      buttons: e.buttons,
      button: e.button,
      raw: e,
      coalesced: null,
      predicted: null,
      dbl: false,
    };
  }

  isPalm(e) {
    const s = this.app.settings;
    if (e.pointerType !== 'touch' || !s.palmRejection) return false;
    return this.active?.type === 'pen' || performance.now() - this.lastPenAt < 1200;
  }

  onDown(e) {
    const app = this.app;
    if (app.isEditingText()) app.endTextEdit();
    if (e.pointerType === 'pen') { this.lastPenAt = performance.now(); this.penInRange = true; }
    if (this.isPalm(e)) return;
    this.stage.focus?.({ preventScroll: true });

    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.stage.setPointerCapture(e.pointerId);
      if (this.touches.size >= 2) { this.cancelActive(); this.startGesture(); return; }
      if (!app.settings.touchDraw) { this.startPan(e, 'touch'); return; }
    }
    if (this.active || this.panning) return;

    const wantsPan = e.button === 1 || (e.button === 0 && this.spaceDown) || e.button === 4;
    if (wantsPan) { this.startPan(e, 'mouse'); return; }
    if (e.button === 2) { this.startPan(e, 'mouse'); return; }

    const ev = this.norm(e);
    let tool = app.tool;
    let temp = false;
    // обратный конец пера включает ластик
    if (e.pointerType === 'pen' && (e.buttons & 32 || e.button === 5)) { tool = app.tools.eraser; temp = true; }
    const now = performance.now();
    ev.dbl = now - this.lastDown.t < 380 && Math.hypot(ev.x - this.lastDown.x, ev.y - this.lastDown.y) < 6;
    this.lastDown = { t: ev.dbl ? 0 : now, x: ev.x, y: ev.y };

    this.stage.setPointerCapture(e.pointerId);
    this.active = { id: e.pointerId, type: e.pointerType, tool, temp };
    app.interacting = true;
    tool.down?.(ev);
    this.updateCursor();
  }

  onMove(e) {
    const app = this.app;
    if (e.pointerType === 'pen') { this.lastPenAt = performance.now(); }
    if (e.pointerType === 'touch') {
      if (this.touches.has(e.pointerId)) {
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.gesture) { this.updateGesture(); return; }
      }
    }
    if (this.panning && this.panning.id === e.pointerId) {
      app.panBy(e.clientX - this.panning.x, e.clientY - this.panning.y);
      this.panning.x = e.clientX;
      this.panning.y = e.clientY;
      return;
    }
    const a = this.active;
    if (a && a.id === e.pointerId) {
      const ev = this.norm(e);
      if (a.tool.wantsCoalesced) {
        ev.coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
        ev.predicted = e.getPredictedEvents ? e.getPredictedEvents() : null;
      } else if (a.tool.name === 'pen' || a.tool.name === 'hl' || a.tool.name === 'eraser') {
        ev.coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
        ev.predicted = a.tool.name === 'eraser' ? null : (e.getPredictedEvents ? e.getPredictedEvents() : null);
      }
      a.tool.move?.(ev);
      return;
    }
    // наведение (перо в воздухе, мышь без кнопок)
    if (!a && e.pointerType !== 'touch') {
      const ev = this.norm(e);
      app.hoverPos = ev;
      app.tool.hover?.(ev);
    }
  }

  onUp(e) {
    const app = this.app;
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.gesture) {
        if (this.touches.size < 2) this.gesture = null;
        return;
      }
    }
    if (this.panning && this.panning.id === e.pointerId) {
      this.panning = null;
      this.updateCursor();
      return;
    }
    const a = this.active;
    if (a && a.id === e.pointerId) {
      this.active = null;
      app.interacting = false;
      const ev = this.norm(e);
      if (e.type === 'pointercancel' || e.type === 'lostpointercapture') a.tool.cancel?.();
      else a.tool.up?.(ev);
      try { this.stage.releasePointerCapture(e.pointerId); } catch { /* уже отпущен */ }
      app.renderer.markUI();
      this.updateCursor();
      app.afterInteraction?.();
    }
  }

  cancelActive() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this.app.interacting = false;
    a.tool.cancel?.();
  }

  startPan(e, kind) {
    this.panning = { id: e.pointerId, x: e.clientX, y: e.clientY, kind };
    try { this.stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.stage.style.cursor = 'grabbing';
  }

  // ----- жесты двумя пальцами -----
  startGesture() {
    const pts = [...this.touches.values()];
    this.gesture = this.measure(pts);
  }
  measure(pts) {
    const [a, b] = pts;
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  }
  updateGesture() {
    const m = this.measure([...this.touches.values()].slice(0, 2));
    const g = this.gesture;
    const r = this.rect;
    this.app.panBy(m.cx - g.cx, m.cy - g.cy);
    this.app.zoomAt(m.cx - r.left, m.cy - r.top, m.d / g.d);
    this.gesture = m;
  }

  // ----- колесо и трекпад -----
  onWheel(e) {
    e.preventDefault();
    const app = this.app;
    if (this.active && (this.active.tool.name === 'pen' || this.active.tool.name === 'hl')) return;
    if (app.isEditingText() && !e.ctrlKey) { /* прокрутка холста при редактировании допустима */ }
    const r = this.rect;
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    let dx = e.deltaX, dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; } else if (e.deltaMode === 2) { dx *= 400; dy *= 400; }
    if (e.ctrlKey || e.metaKey) {
      // щипок на трекпаде (Chromium присылает ctrl+wheel) или Cmd+колесо
      app.zoomAt(sx, sy, Math.exp(-dy * (e.ctrlKey && !e.metaKey ? 0.012 : 0.004)));
      return;
    }
    // колесо мыши ступенчатое: кратно 120 и без горизонтальной составляющей
    const discrete = e.deltaMode !== 0 || (Math.abs(dy) >= 50 && dx === 0 && Number.isInteger(dy) && (e.wheelDeltaY % 120 === 0));
    if (discrete && app.settings.wheel === 'zoom') {
      app.zoomAt(sx, sy, Math.exp(-Math.sign(dy) * 0.18));
      return;
    }
    if (e.shiftKey && dx === 0) { dx = dy; dy = 0; }
    app.panBy(-dx, -dy);
  }

  // ----- клавиатура -----
  onKey(e, down) {
    const app = this.app;
    if (e.code === 'Space') {
      if (this.isTypingTarget(e)) return;
      if (down) e.preventDefault();
      const was = this.spaceDown;
      this.spaceDown = down;
      if (was !== down) this.updateCursor();
      return;
    }
    if (!down) return;
    if (this.isTypingTarget(e)) return;
    app.onKey(e);
  }

  isTypingTarget(e) {
    const t = e.target;
    return t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  }

  setCursorTemp(c) { this.stage.style.cursor = c; }

  updateCursor() {
    const app = this.app;
    if (this.panning) { this.stage.style.cursor = 'grabbing'; return; }
    if (this.spaceDown) { this.stage.style.cursor = 'grab'; return; }
    const t = this.active ? this.active.tool : app.tool;
    this.stage.style.cursor = t.cursor || 'default';
  }
}
