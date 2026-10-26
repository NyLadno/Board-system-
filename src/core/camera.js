import { clamp } from './util.js';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 32;

// Камера: мировая точка (x, y) находится в левом верхнем углу экрана, z — масштаб.
export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.z = 1;
    this.w = 800;
    this.h = 600;
  }

  toWorld(sx, sy) {
    return [sx / this.z + this.x, sy / this.z + this.y];
  }

  toScreen(wx, wy) {
    return [(wx - this.x) * this.z, (wy - this.y) * this.z];
  }

  panBy(dsx, dsy) {
    this.x -= dsx / this.z;
    this.y -= dsy / this.z;
  }

  zoomAt(sx, sy, factor) {
    const nz = clamp(this.z * factor, MIN_ZOOM, MAX_ZOOM);
    const [wx, wy] = this.toWorld(sx, sy);
    this.z = nz;
    this.x = wx - sx / nz;
    this.y = wy - sy / nz;
  }

  setZoomCentered(z) {
    this.zoomAt(this.w / 2, this.h / 2, z / this.z);
  }

  fit(rect, pad = 80, maxZoom = 2) {
    if (!rect || (!rect.w && !rect.h)) {
      this.x = -this.w / 2;
      this.y = -this.h / 2;
      this.z = 1;
      return;
    }
    const z = clamp(
      Math.min((this.w - pad * 2) / Math.max(rect.w, 1), (this.h - pad * 2) / Math.max(rect.h, 1)),
      MIN_ZOOM,
      maxZoom
    );
    this.z = z;
    this.x = rect.x + rect.w / 2 - this.w / 2 / z;
    this.y = rect.y + rect.h / 2 - this.h / 2 / z;
  }

  viewRect(margin = 0) {
    return {
      x: this.x - margin / this.z,
      y: this.y - margin / this.z,
      w: (this.w + margin * 2) / this.z,
      h: (this.h + margin * 2) / this.z,
    };
  }

  toJSON() {
    return { x: this.x, y: this.y, z: this.z };
  }

  load(c) {
    if (c) {
      this.x = c.x;
      this.y = c.y;
      this.z = c.z;
    }
  }
}
