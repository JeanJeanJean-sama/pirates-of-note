/* ============================================================
 * db.js — IndexedDB ラッパー（拡張機能の保存領域に保存）
 * background.js（importScripts）と dashboard.html（<script>）の両方から使う
 *
 * ストア
 *   snapshots   : 全期間スナップショット（1日1件、キー= 'YYYY-MM-DD'）
 *   unreplied   : 自分の記事の「未返信コメント」確認状況（キー=記事キー）
 *   myComments  : 他人の記事に自分が書いたコメント（キー= 記事キー or 記事キー#コメントキー）
 *   kv          : 設定・状態（キー=名前）
 * ============================================================ */
const NDB = (() => {
  const DB_NAME = 'note-data-notebook';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'date' });
        if (!db.objectStoreNames.contains('unreplied')) db.createObjectStore('unreplied', { keyPath: 'noteKey' });
        if (!db.objectStoreNames.contains('myComments')) db.createObjectStore('myComments', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  return {
    get: (store, key) => tx(store, 'readonly', (s) => req2p(s.get(key))),
    getAll: (store) => tx(store, 'readonly', (s) => req2p(s.getAll())),
    put: (store, value, key) => tx(store, 'readwrite', (s) => req2p(key === undefined ? s.put(value) : s.put(value, key))),
    putMany: (store, values) => tx(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); }),
    del: (store, key) => tx(store, 'readwrite', (s) => req2p(s.delete(key))),
    clear: (store) => tx(store, 'readwrite', (s) => req2p(s.clear())),
    kvGet: async (key, fallback) => { const v = await tx('kv', 'readonly', (s) => req2p(s.get(key))); return v === undefined ? fallback : v; },
    kvSet: (key, value) => tx('kv', 'readwrite', (s) => req2p(s.put(value, key))),
    STORES: ['snapshots', 'unreplied', 'myComments', 'kv'],
  };
})();

/* 日付ユーティリティ（日本時間基準） */
function jstDate(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
}
