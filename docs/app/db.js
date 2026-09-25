/* ============================================================
 * db.js — IndexedDB ラッパー（拡張機能の保存領域に保存）
 * background.js（importScripts）と dashboard.html（<script>）の両方から使う
 *
 * ストア
 *   snapshots   : 全期間スナップショット（1日1件、キー= 'YYYY-MM-DD'）
 *   unreplied   : 自分の記事の「未返信コメント」確認状況（キー=記事キー）
 *   myComments  : 他人の記事に自分が書いたコメント（キー= 記事キー or 記事キー#コメントキー）
 *   bodies      : 記事の本文（キー=記事キー）
 *   kv          : 設定・状態（キー=名前）
 * ============================================================ */
const NDB = (() => {
  // Webアプリ版は github.io の同じドメインの他のページとぶつからないよう別名にする（web.js で PON_DB_NAME を指定）
  const DB_NAME = self.PON_DB_NAME || 'pirates-of-note';
  const DB_VERSION = 2; // v2: 本文ストア（bodies）を追加
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
        if (!db.objectStoreNames.contains('bodies')) db.createObjectStore('bodies', { keyPath: 'noteKey' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).then((db) => migrateLegacy(db).catch(() => {}).then(() => db));
    return dbPromise;
  }

  /* v0.5.0 までの保存場所「note-data-notebook」から引っ越す（拡張機能版だけ・1回だけ）。
   * フォルダを上書きして更新した人の記録が、そのまま見えるようにする。古い保存場所は消さずに残す。 */
  const LEGACY_DB_NAME = 'note-data-notebook';
  const rp = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function migrateLegacy(db) {
    if (self.PON_DB_NAME || !indexedDB.databases) return;
    const t0 = db.transaction(['kv', 'snapshots'], 'readonly');
    const [done, count] = await Promise.all([rp(t0.objectStore('kv').get('legacyMigrated')), rp(t0.objectStore('snapshots').count())]);
    if (done) return;
    const list = await indexedDB.databases();
    if (list.some((d) => d.name === LEGACY_DB_NAME) && count === 0) {
      const old = await rp(indexedDB.open(LEGACY_DB_NAME));
      try {
        const names = [...old.objectStoreNames].filter((n) => db.objectStoreNames.contains(n));
        const t1 = old.transaction(names, 'readonly');
        const reqs = names.map((n) => Promise.all([rp(t1.objectStore(n).getAll()), rp(t1.objectStore(n).getAllKeys())]));
        const got = await Promise.all(reqs);
        const data = Object.fromEntries(names.map((n, i) => [n, got[i]]));
        const t2 = db.transaction(names, 'readwrite');
        for (const n of names) {
          const [vals, keys] = data[n];
          const st = t2.objectStore(n);
          vals.forEach((v, i) => { if (st.keyPath) st.put(v); else st.put(v, keys[i]); });
        }
        await new Promise((res, rej) => { t2.oncomplete = res; t2.onerror = () => rej(t2.error); t2.onabort = () => rej(t2.error); });
      } finally { old.close(); }
    }
    const t3 = db.transaction('kv', 'readwrite');
    t3.objectStore('kv').put(Date.now(), 'legacyMigrated');
    await new Promise((res) => { t3.oncomplete = res; t3.onerror = res; });
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
    getAllKeys: (store) => tx(store, 'readonly', (s) => req2p(s.getAllKeys())),
    STORES: ['snapshots', 'unreplied', 'myComments', 'bodies', 'kv'],
  };
})();

/* 日付ユーティリティ（日本時間基準） */
function jstDate(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
}
