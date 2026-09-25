/* ============================================================
 * background.js — Service Worker
 *  ・content.js から届いたデータを IndexedDB（拡張機能の保存領域）に保存
 *  ・複数タブで同時に取得処理が走らないよう「ロック」を管理
 *  ・アイコンクリックでダッシュボードを開く（Pirates of note）
 *  ・未返信コメント数をアイコンのバッジに表示
 * note への通信はすべて content.js（note.com のページ内）で行い、ここでは行わない。
 * ============================================================ */
importScripts('db.js', 'store.js'); // 保存処理は store.js（Webアプリ版と共通）

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard.html') });
});

chrome.runtime.onInstalled.addListener(() => refreshBadge());
chrome.runtime.onStartup.addListener(() => refreshBadge());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then((r) => sendResponse({ ok: true, ...r }))
    .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true;
});

async function handle(msg, sender) {
  const p = msg.payload || {};
  switch (msg.type) {
    case 'GET_STATE': return { state: await PonStore.getState() };

    case 'ACQUIRE_LOCK': {
      const lock = await NDB.kvGet('lock', null);
      const now = Date.now();
      const tabId = sender.tab ? sender.tab.id : -1;
      if (lock && lock.until > now && lock.tabId !== tabId) return { granted: false };
      await NDB.kvSet('lock', { tabId, until: now + (p.ttlMs || 5 * 60e3) });
      return { granted: true };
    }
    case 'RELEASE_LOCK': await NDB.kvSet('lock', null); return {};

    case 'SAVE_ME': await PonStore.saveMe(p); return {};

    case 'SAVE_SNAPSHOT': await PonStore.saveSnapshot(p.snapshot); return {};

    case 'SAVE_UNREPLIED': await PonStore.saveUnreplied(p.records); await refreshBadge(); return {};

    case 'SAVE_MY_COMMENTS': await PonStore.saveMyComments(p.records); return {};

    case 'SET_KV': await NDB.kvSet(p.key, p.value); return {};

    case 'SAVE_THREAD_REPLIES': await PonStore.saveThreadReplies(p.items); await refreshBadge(); return {};

    case 'LOG': await PonStore.appendLog(p.level, p.message); return {};

    case 'RUN_NOW': return runNow(true);

    case 'SAVE_BODY': await PonStore.saveBody(p.record); return {};

    case 'RUN_BODIES': {
      // p.keys: 保存したい記事キーの配列（ダッシュボードで「保存」を押したもの）
      const q = await NDB.kvGet('bodyQueue', []);
      await NDB.kvSet('bodyQueue', [...new Set([...q, ...(p.keys || [])])]);
      return runNow(false);
    }

    case 'RUN_PERK': await NDB.kvSet('perkForce', true); return runNow(false);

    case 'CLEAR_BODY_QUEUE': await NDB.kvSet('bodyQueue', []); return {};

    case 'REFRESH_BADGE': await refreshBadge(); return {};

    case 'RUN_DONE': {
      // 「今すぐ取得」のために開いたタブなら閉じる
      const autoTabId = await NDB.kvGet('autoTabId', null);
      if (sender.tab && sender.tab.id === autoTabId) {
        await NDB.kvSet('autoTabId', null);
        chrome.tabs.remove(sender.tab.id).catch(() => {});
      }
      return {};
    }

    default: throw new Error(`unknown message: ${msg.type}`);
  }
}

/** 「今すぐ取得」：開いている note タブで実行。なければ note のダッシュボードを裏で開く */
async function runNow(forceAll) {
  if (forceAll) await NDB.kvSet('forceRun', true);
  const tabs = await chrome.tabs.query({ url: 'https://note.com/*' });
  for (const t of tabs) {
    try {
      await chrome.tabs.sendMessage(t.id, { type: 'RUN', force: !!forceAll });
      return { via: 'existing-tab' };
    } catch (_) { /* content script 未注入のタブは飛ばす */ }
  }
  // note のトップページは読み込み時に認証トークンを用意するので、そこで取得する（完了後に自動で閉じる）
  const tab = await chrome.tabs.create({ url: 'https://note.com/', active: false });
  await NDB.kvSet('autoTabId', tab.id);
  return { via: 'new-tab' };
}

async function refreshBadge() {
  try {
    const n = await PonStore.unrepliedCount();
    await chrome.action.setBadgeText({ text: n > 0 ? String(n > 99 ? '99+' : n) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#e34948' });
  } catch (_) { /* noop */ }
}
