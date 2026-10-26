import { drawObject, ImageCache } from './draw.js';
import { InkLayer } from './ink.js';

// Холсты: сцена, живые чернила и слой интерфейса (выделение, рамки, подсказки).
//
// Сцена рисуется в холст БОЛЬШЕ окна на margin пикселей с каждой стороны и запоминает камеру, для которой
// нарисована (this.R). Пока камера двигается, холст не перерисовывается: его сдвигает или масштабирует CSS-transform,
// то есть работа композитора, а не основного потока. Полная перерисовка нужна, когда запас по краям израсходован,
// когда изменилось содержимое и когда зум успокоился. Благодаря этому панорамирование тяжёлой доски идёт без рывков.
export class Renderer {
  constructor(app, stage) {
    this.app = app;
    this.stage = stage;
    const mk = (cls) => {
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
    this.margin = 200;
    this.R = { x: 0, y: 0, z: 1 };
    this.sceneValid = false;
    this.dirtyScene = true;
    this.dirtyUI = true;
    this.camMoved = false;
    this.raf = 0;
    this.idleTimer = 0;
    this.xf = { tx: 0, ty: 0, s: 1 };
    this.stats = { fps: 0, cost: 0, frames: 0, t: performance.now(), renders: 0 };
    this.onFrame = null;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(stage);
    this.resize();
  }

  resize() {
    // размеры берём дробными: при масштабе Windows 125 или 150% целые clientWidth дают сдвиг и мыло на краях
    const box = this.stage.getBoundingClientRect();
    const w = box.width || 800;
    const h = box.height || 600;
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.app.cam.w = w;
    this.app.cam.h = h;
    // запас кратен физическому пикселю, иначе слой сцены окажется между пикселями
    const M = Math.round(Math.max(120, Math.min(320, 0.22 * Math.max(w, h))) * dpr) / dpr;
    this.margin = M;
    const sc = this.sceneCv;
    sc.width = Math.round((w + 2 * M) * dpr);
    sc.height = Math.round((h + 2 * M) * dpr);
    Object.assign(sc.style, { left: -M + 'px', top: -M + 'px', width: sc.width / dpr + 'px', height: sc.height / dpr + 'px', transformOrigin: `${M}px ${M}px` });
    this.uiCv.width = Math.round(w * dpr);
    this.uiCv.height = Math.round(h * dpr);
    this.ink.resize(w, h, dpr);
    this.markScene();
    this.markUI();
  }

  markScene() { this.sceneValid = false; this.dirtyScene = true; this.schedule(); }
  markCamera() { this.camMoved = true; this.dirtyUI = true; this.schedule(); }
  markUI() { this.dirtyUI = true; this.schedule(); }

  schedule() {
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  frame(t) {
    this.raf = 0;
    const app = this.app;
    app.flushCamera();
    // чернила рисуем первыми: они важнее всего для ощущения отклика
    if (this.ink.sb) app.tool.inkFrame?.(t);
    if (this.dirtyScene) {
      this.dirtyScene = false;
      this.camMoved = false;
      this.renderScene();
    } else if (this.camMoved) {
      this.camMoved = false;
      this.presentCamera();
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

  // Двигаем уже нарисованный холст вслед за камерой; перерисовываем, только если без этого не обойтись
  presentCamera() {
    const cam = this.app.cam;
    if (!this.sceneValid) { this.renderScene(); return; }
    const R = this.R, M = this.margin;
    const s = cam.z / R.z;
    const tx = (R.x - cam.x) * cam.z;
    const ty = (R.y - cam.y) * cam.z;
    const W = cam.w, H = cam.h;
    const covered = s * -M + tx <= 0.5 && s * (W + M) + tx >= W - 0.5 && s * -M + ty <= 0.5 && s * (H + M) + ty >= H - 0.5;
    const pan = Math.abs(s - 1) < 1e-9;
    if (!covered || (pan && (Math.abs(tx) > 0.62 * M || Math.abs(ty) > 0.62 * M))) { this.renderScene(); return; }
    // сдвиг кратен физическому пикселю, иначе картинка размоется
    const d = this.dpr;
    const sx = Math.round(tx * d) / d, sy = Math.round(ty * d) / d;
    this.xf = { tx: sx, ty: sy, s };
    this.sceneCv.style.transform = pan ? `translate3d(${sx}px, ${sy}px, 0)` : `translate3d(${sx}px, ${sy}px, 0) scale(${s})`;
    clearTimeout(this.idleTimer);
    if (!pan) {
      // зум закончился: возвращаем чёткость
      this.idleTimer = setTimeout(() => this.markScene(), 110);
    }
  }

  // камера, для которой сейчас нарисован холст сцены (мировые координаты -> пиксели холста)
  sceneTransform(ctx) {
    const R = this.R, d = this.dpr, M = this.margin, k = d * R.z;
    ctx.setTransform(k, 0, 0, k, (M - R.x * R.z) * d, (M - R.y * R.z) * d);
  }

  // экранная камера (холсты чернил и интерфейса совпадают с окном)
  viewCtx(ctx) {
    const { cam } = this.app;
    const k = this.dpr * cam.z;
    ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);
  }

  view() {
    const app = this.app;
    return { zoom: app.cam.z, scene: app.scene, images: this.images, editingId: app.editingId, dark: app.dark };
  }

  renderScene() {
    const app = this.app;
    const cam = app.cam;
    const t0 = performance.now();
    const ctx = this.sctx;
    this.R = { x: cam.x, y: cam.y, z: cam.z };
    clearTimeout(this.idleTimer);
    this.xf = { tx: 0, ty: 0, s: 1 };
    this.sceneCv.style.transform = '';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.sceneCv.width, this.sceneCv.height);
    this.drawBackground(ctx);
    this.sceneTransform(ctx);
    const M = this.margin;
    const rect = { x: cam.x - M / cam.z, y: cam.y - M / cam.z, w: (cam.w + 2 * M) / cam.z, h: (cam.h + 2 * M) / cam.z };
    const view = { ...this.view(), zoom: cam.z };
    const hidden = app.hiddenIds;
    for (const o of app.scene.query(rect)) {
      if (hidden && hidden.has(o.id)) continue;
      drawObject(ctx, o, view);
    }
    this.sceneValid = true;
    this.stats.cost = performance.now() - t0;
    this.stats.renders++;
  }

  // Точки, сетка или клетка рисуются прямо в холст сцены и двигаются вместе с ним
  drawBackground(ctx) {
    const app = this.app;
    const style = app.boardStyle();
    if (style === 'none') return;
    const cam = app.cam, d = this.dpr, M = this.margin;
    const cw = this.sceneCv.width, ch = this.sceneCv.height;
    let stepW = 24;
    while (stepW * cam.z < 14) stepW *= 2;
    const step = stepW * cam.z * d;
    const ox = (M - cam.x * cam.z) * d, oy = (M - cam.y * cam.z) * d;
    let x0 = ox % step; if (x0 < 0) x0 += step;
    let y0 = oy % step; if (y0 < 0) y0 += step;
    ctx.fillStyle = app.gridColor(style);
    ctx.beginPath();
    if (style === 'dots') {
      const s = Math.max(2, Math.round(1.8 * d));
      for (let y = y0; y < ch; y += step) for (let x = x0; x < cw; x += step) ctx.rect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
    } else {
      const lw = Math.max(1, Math.round(d * 0.7));
      for (let x = x0; x < cw; x += step) ctx.rect(Math.round(x - lw / 2), 0, lw, ch);
      for (let y = y0; y < ch; y += step) ctx.rect(0, Math.round(y - lw / 2), cw, lw);
    }
    ctx.fill();
  }

  // Дорисовать один объект поверх готового кадра (новый штрих всегда сверху)
  paintObject(o) {
    if (this.dirtyScene || !this.sceneValid) return;
    this.sceneTransform(this.sctx);
    drawObject(this.sctx, o, { ...this.view(), zoom: this.R.z });
  }

  // Прочитать пиксели прямоугольника окна (в CSS-пикселях); нужно тестам и отладке
  readPixels(sx, sy, w, h) {
    const d = this.dpr, M = this.margin;
    const { tx, ty } = this.xf;
    return this.sctx.getImageData(Math.round((sx - tx + M) * d), Math.round((sy - ty + M) * d), Math.max(1, Math.round(w * d)), Math.max(1, Math.round(h * d)));
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
  renderToCanvas(objs, rect, scale, { background = null, dark = false, scene = null } = {}) {
    const w = Math.max(1, Math.round(rect.w * scale));
    const h = Math.max(1, Math.round(rect.h * scale));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); }
    ctx.setTransform(scale, 0, 0, scale, -rect.x * scale, -rect.y * scale);
    const view = { zoom: scale, scene: scene || this.app.scene, images: this.images, editingId: null, dark };
    for (const o of objs) drawObject(ctx, o, view);
    return cv;
  }
}
