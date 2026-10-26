import { uid } from './util.js';

// Единый интерфейс хранения. В Electron данные лежат файлами в папке пользователя (через preload),
// в обычном браузере (разработка, тесты) используется IndexedDB.
//
// meta: { id, name, created, updated, thumb }
// data: { v, objects, camera }

class IdbStorage {
  constructor() {
    this.dbp = new Promise((res, rej) => {
      const r = indexedDB.open('board-system', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('meta', { keyPath: 'id' });
        db.createObjectStore('data');
        db.createObjectStore('assets');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    this.urls = new Map();
  }

  async tx(store, mode, fn) {
    const db = await this.dbp;
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const req = fn(s);
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  }

  list() { return this.tx('meta', 'readonly', (s) => s.getAll()); }
  getMeta(id) { return this.tx('meta', 'readonly', (s) => s.get(id)); }
  putMeta(meta) { return this.tx('meta', 'readwrite', (s) => s.put(meta)); }
  loadData(id) { return this.tx('data', 'readonly', (s) => s.get(id)); }
  saveData(id, data) { return this.tx('data', 'readwrite', (s) => s.put(data, id)); }
  async remove(id) {
    await this.tx('meta', 'readwrite', (s) => s.delete(id));
    await this.tx('data', 'readwrite', (s) => s.delete(id));
  }
  async putAsset(blob) {
    const id = uid() + '.' + (blob.type.split('/')[1] || 'bin').replace('+xml', '');
    await this.tx('assets', 'readwrite', (s) => s.put(blob, id));
    return id;
  }
  async assetURL(id) {
    if (this.urls.has(id)) return this.urls.get(id);
    const blob = await this.tx('assets', 'readonly', (s) => s.get(id));
    if (!blob) throw new Error('asset missing');
    const url = URL.createObjectURL(blob);
    this.urls.set(id, url);
    return url;
  }
  async getAssetBlob(id) { return this.tx('assets', 'readonly', (s) => s.get(id)); }
}

class FsStorage {
  constructor(api) {
    this.api = api;
    this.urlCache = new Map();
  }
  list() { return this.api.list(); }
  getMeta(id) { return this.api.getMeta(id); }
  putMeta(meta) { return this.api.putMeta(meta); }
  loadData(id) { return this.api.loadData(id); }
  saveData(id, data) { return this.api.saveData(id, data); }
  remove(id) { return this.api.remove(id); }
  async putAsset(blob) {
    const ext = (blob.type.split('/')[1] || 'bin').replace('+xml', '');
    const id = uid() + '.' + ext;
    await this.api.putAsset(id, new Uint8Array(await blob.arrayBuffer()));
    return id;
  }
  async assetURL(id) {
    if (!this.urlCache.has(id)) this.urlCache.set(id, this.api.assetURL(id));
    return this.urlCache.get(id);
  }
  async getAssetBlob(id) {
    const res = await fetch(await this.assetURL(id));
    return res.blob();
  }
}

const EMPTY = '{"v":1,"objects":[],"camera":null}';

export class Storage {
  constructor() {
    this.impl = window.boardAPI ? new FsStorage(window.boardAPI) : new IdbStorage();
    this.kind = window.boardAPI ? 'fs' : 'idb';
  }

  async listBoards() {
    const all = await this.impl.list();
    return all.sort((a, b) => b.updated - a.updated);
  }

  async createBoard(name) {
    const now = Date.now();
    const meta = { id: uid() + uid(), name, created: now, updated: now, thumb: null };
    await this.impl.putMeta(meta);
    await this.impl.saveData(meta.id, EMPTY);
    return meta;
  }

  getMeta(id) { return this.impl.getMeta(id); }

  async patchMeta(id, patch) {
    const meta = await this.impl.getMeta(id);
    if (!meta) return null;
    Object.assign(meta, patch);
    await this.impl.putMeta(meta);
    return meta;
  }

  async loadBoard(id) {
    const [meta, raw] = await Promise.all([this.impl.getMeta(id), this.impl.loadData(id)]);
    let data = null;
    if (raw) { try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { data = null; } }
    return { meta, data: data || { v: 1, objects: [], camera: null } };
  }

  // json это готовая строка. bump=false сохраняет только данные (например, камеру) и не меняет время изменения
  async saveBoard(id, json, bump = true) {
    await this.impl.saveData(id, json);
    return bump ? this.patchMeta(id, { updated: Date.now() }) : null;
  }

  async duplicateBoard(id, name) {
    const meta = await this.impl.getMeta(id);
    const raw = await this.impl.loadData(id);
    const copy = await this.createBoard(name || meta.name);
    await this.impl.saveData(copy.id, raw || EMPTY);
    await this.patchMeta(copy.id, { thumb: meta.thumb });
    return copy;
  }

  deleteBoard(id) { return this.impl.remove(id); }

  putAsset(blob) { return this.impl.putAsset(blob); }
  assetURL(id) { return this.impl.assetURL(id); }
  getAssetBlob(id) { return this.impl.getAssetBlob(id); }
}
