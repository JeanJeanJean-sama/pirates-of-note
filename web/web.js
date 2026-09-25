/* ============================================================
 * web.js — Web版：拡張機能の background の代わり（dashboard.js より前に読み込む）
 * ダッシュボードが送る chrome.runtime.sendMessage を、この画面の中で処理する。
 * ============================================================ */
'use strict';

window.chrome = window.chrome || {};
chrome.runtime = {
  async sendMessage({ type, payload: p = {} }) {
    try {
      switch (type) {
        case 'LOG': await PonStore.appendLog(p.level, p.message); return { ok: true };
        case 'REFRESH_BADGE': await PonWeb.updateTitle(); return { ok: true };
        case 'RUN_NOW':
          window.open('https://note.com/', '_blank', 'noopener');
          return { ok: true, via: 'web' };
        case 'RUN_BODIES':
          return { ok: false, error: '本文の保存はパソコン版Pon（Chrome拡張機能）で行えます。' };
        default: return { ok: true };
      }
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  },
};

const PonWeb = {
  async updateTitle() {
    try {
      const n = await PonStore.unrepliedCount();
      document.title = n > 0 ? `(${n}) Pirates of note` : 'Pirates of note';
    } catch (_) { /* noop */ }
  },
};
