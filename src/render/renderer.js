import { drawObject, ImageCache } from './draw.js';
import { InkLayer } from './ink.js';

const HEAVY_MS = 9;

// Отвечает за холсты: сцена, живые чернила и слой интерфейса (выделение, рамки, подсказки).
export class Renderer {
  constructor(app, stage) {
    this.app = app;
    this.stage = stage;
    const mk = (cls, opts) => {
      const c = document.createElement('canvas');
      c.className = 'layer ' + cls;
      stage.append(c);
      return c;
    };
    this.sceneCv = mk('scene');
    this.sctx = this.sceneCv.getContext('2d', { alpha: true });
    this.ink = new InkLayer(stage);
    this.uiCv = mk('ui');
    this.uctx = this.uiCv.getContext('2d');
    this.images = new ImageCache((id) => app.storage.assetURL(id), () => this.markScene());
    this.dpr = window.devicePixelRatio || 1;
    this.dirtyScene = true;
    this.dirtyUI = true;
    this.raf = 0;
    this.lastCost = 0;
    this.snap = null;
    this.camMoving = false;
    this.fullTimer = 0;
    this.stats = { fps: 0, cost: 0, frames: 0, t: performance.now() };
    this.onFrame = null;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(stage);
    this.resize();
  }

  resize() {
    const w = this.stage.clientWidth || 800;
    const h = this.stage.clientHeight || 600;
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.app.cam.w = w;
    this.app.cam.h = h;
    for (const c of [this.sceneCv, this.uiCv]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.ink.resize(w, h, dpr);
    this.snap = null;
    this.markScene();
    this.markUI();
  }

  markScene() { this.camMoving = false; this.dirtyScene = true; this.snap = null; this.schedule(); }
  markCamera() { this.camMoving = true; this.dirtyScene = true; this.dirtyUI = true; this.schedule(); }
  markUI() { this.dirtyUI = true; this.schedule(); }

  schedule() {
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  frame(t) {
    this.raf = 0;
    const app = this.app;
    // чернила рисуем первыми: они важнее всего для ощущения отклика
    if (this.ink.sb) app.tool.inkFrame?.(t);
    if (this.dirtyScene) {
      this.dirtyScene = false;
      if (this.camMoving && this.lastCost > HEAVY_MS) this.drawCached();
      else this.drawScene();
    }
    if (this.dirtyUI) {
      this.dirtyUI = false;
      this.drawUI();
    }
    const s = this.stats;
    s.frames++;
    if (t - s.t > 1000) {
      s.fps = Math.round((s.frames * 1000) / (t - s.t));
      s.frames = 0;
      s.t = t;
    }
    this.onFrame?.(t);
    if (this.ink.sb) this.schedule();
  }

  viewCtx(ctx) {
    const { cam } = this.app;
    const k = this.dpr * cam.z;
    ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);
  }

  view() {
    const app = this.app;
    return { zoom: app.cam.z, scene: app.scene, images: this.images, editingId: app.editingId, dark: app.dark };
  }

  drawScene() {
    const app = this.app;
    const t0 = performance.now();
    const ctx = this.sctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.sceneCv.width, this.sceneCv.height);
    this.viewCtx(ctx);
    const view = this.view();
    const margin = 40;
    const list = app.scene.query(app.cam.viewRect(margin));
    const hidden = app.hiddenIds;
    for (const o of list) {
      if (hidden && hidden.has(o.id)) continue;
      drawObject(ctx, o, view);
    }
    this.lastCost = performance.now() - t0;
    this.stats.cost = this.lastCost;
    this.cacheCam = { x: app.cam.x, y: app.cam.y, z: app.cam.z };
    if (this.fullTimer) { clearTimeout(this.fullTimer); this.fullTimer = 0; }
  }

  // Дорисовать один объект поверх готового кадра (новый штрих всегда сверху)
  paintObject(o) {
    if (this.dirtyScene) return; // полная перерисовка и так захватит объект
    this.viewCtx(this.sctx);
    drawObject(this.sctx, o, this.view());
  }

  // Во время жеста перемещения тяжёлой сцены масштабируем готовый кадр вместо полной перерисовки
  drawCached() {
    const app = this.app;
    if (!this.snap) {
      if (!this.cacheCam) { this.drawScene(); return; }
      const s = document.createElement('canvas');
      s.width = this.sceneCv.width;
      s.height = this.sceneCv.height;
      s.getContext('2d').drawImage(this.sceneCv, 0, 0);
      this.snap = { cv: s, cam: this.cacheCam };
    }
    const { cv, cam: c0 } = this.snap;
    const cam = app.cam;
    const ctx = this.sctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.sceneCv.width, this.sceneCv.height);
    const f = cam.z / c0.z;
    ctx.drawImage(cv, (c0.x - cam.x) * cam.z * this.dpr, (c0.y - cam.y) * cam.z * this.dpr, cv.width * f, cv.height * f);
    clearTimeout(this.fullTimer);
    this.fullTimer = setTimeout(() => { this.snap = null; this.camMoving = false; this.dirtyScene = true; this.schedule(); }, 90);
  }

  drawUI() {
    const app = this.app;
    const ctx = this.uctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.uiCv.width, this.uiCv.height);
    this.viewCtx(ctx);
    app.drawOverlay?.(ctx);
  }

  // Растеризация произвольной области в отдельный холст (экспорт, миниатюры)
  renderToCanvas(objs, rect, scale, { background = null, dark = false } = {}) {
    const w = Math.max(1, Math.round(rect.w * scale));
    const h = Math.max(1, Math.round(rect.h * scale));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); }
    ctx.setTransform(scale, 0, 0, scale, -rect.x * scale, -rect.y * scale);
    const view = { zoom: scale, scene: this.app.scene, images: this.images, editingId: null, dark };
    for (const o of objs) drawObject(ctx, o, view);
    return cv;
  }
}
