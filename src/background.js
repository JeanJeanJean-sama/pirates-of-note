/* ============================================================
 * background.js — Service Worker
 *  ・content.js から届いたデータを IndexedDB（拡張機能の保存領域）に保存
 *  ・複数タブで同時に取得処理が走らないよう「ロック」を管理
 *  ・アイコンクリックでダッシュボードを開く（Pirates of note）
 *  ・未返信コメント数をアイコンのバッジに表示
 * note への通信はすべて content.js（note.com のページ内）で行い、ここでは行わない。
 * ============================================================ */
importScripts('db.js');

const DEFAULT_SETTINGS = { autoCollect: true, checkComments: true, recordMyComments: true };
const LOG_LIMIT = 200;

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
    case 'GET_STATE': return { state: await getState() };

    case 'ACQUIRE_LOCK': {
      const lock = await NDB.kvGet('lock', null);
      const now = Date.now();
      const tabId = sender.tab ? sender.tab.id : -1;
      if (lock && lock.until > now && lock.tabId !== tabId) return { granted: false };
      await NDB.kvSet('lock', { tabId, until: now + (p.ttlMs || 5 * 60e3) });
      return { granted: true };
    }
    case 'RELEASE_LOCK': await NDB.kvSet('lock', null); return {};

    case 'SAVE_ME': await NDB.kvSet('me', { ...p, updatedAt: Date.now() }); return {};

    case 'SAVE_SNAPSHOT':
      await NDB.put('snapshots', p.snapshot);
      await NDB.kvSet('lastSnapshotAt', Date.now());
      return {};

    case 'SAVE_UNREPLIED':
      await NDB.putMany('unreplied', p.records);
      await refreshBadge();
      return {};

    case 'SAVE_MY_COMMENTS': {
      for (const rec of p.records) {
        const old = await NDB.get('myComments', rec.id);
        await NDB.put('myComments', mergeMyComment(old, rec));
      }
      return {};
    }

    case 'SET_KV': await NDB.kvSet(p.key, p.value); return {};

    case 'SAVE_THREAD_REPLIES': {
      const cur = await NDB.kvGet('threadReplies', {});
      for (const it of p.items) cur[it.id] = cur[it.id] || it;
      const kept = Object.fromEntries(Object.entries(cur).sort((a, b) => (b[1].at || '').localeCompare(a[1].at || '')).slice(0, 300));
      await NDB.kvSet('threadReplies', kept);
      await refreshBadge();
      return {};
    }

    case 'LOG': return appendLog(p.level, p.message);

    case 'RUN_NOW': return runNow();

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

async function getState() {
  const [me, settings, snapshots, unreplied, lastCommentCheckAt, lastNoticeScanAt, lastNoticeSeenAt, pageChecks, forceRun, commentCheckIncomplete, noticeScanVersion] = await Promise.all([
    NDB.kvGet('me', null),
    NDB.kvGet('settings', {}),
    NDB.getAll('snapshots'),
    NDB.getAll('unreplied'),
    NDB.kvGet('lastCommentCheckAt', 0),
    NDB.kvGet('lastNoticeScanAt', 0),
    NDB.kvGet('lastNoticeSeenAt', ''),
    NDB.kvGet('pageChecks', {}),
    NDB.kvGet('forceRun', false),
    NDB.kvGet('commentCheckIncomplete', false),
    NDB.kvGet('noticeScanVersion', 1),
  ]);
  snapshots.sort((a, b) => a.date.localeCompare(b.date));
  const latest = snapshots[snapshots.length - 1] || null;
  return {
    me,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    latestSnapshot: latest && { date: latest.date, items: latest.items.map((i) => ({ key: i.key, title: i.title, url: i.url, comment: i.comment })) },
    checked: Object.fromEntries(unreplied.map((u) => [u.noteKey, u.checkedCommentCount])),
    lastCommentCheckAt, lastNoticeScanAt, lastNoticeSeenAt, pageChecks, forceRun, commentCheckIncomplete, noticeScanVersion,
  };
}

/** 同じ記事の自分のコメント記録をマージ（通知由来の反応履歴は最新20件まで） */
function mergeMyComment(old, rec) {
  if (!old) return rec;
  const activity = [...(rec.activity || []), ...(old.activity || [])];
  const seen = new Set();
  const uniq = activity.filter((a) => { const k = `${a.kind}|${a.at}|${a.by}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 20);
  return {
    ...old, ...Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== undefined && v !== null && v !== '')),
    activity: uniq,
    lastActivityAt: [old.lastActivityAt, rec.lastActivityAt].filter(Boolean).sort().pop() || null,
    firstSeenAt: old.firstSeenAt || rec.firstSeenAt,
  };
}

async function appendLog(level, message) {
  const logs = await NDB.kvGet('logs', []);
  logs.push({ at: Date.now(), level, message });
  await NDB.kvSet('logs', logs.slice(-LOG_LIMIT));
  return {};
}

/** 「今すぐ取得」：開いている note タブで実行。なければ note のダッシュボードを裏で開く */
async function runNow() {
  await NDB.kvSet('forceRun', true);
  const tabs = await chrome.tabs.query({ url: 'https://note.com/*' });
  for (const t of tabs) {
    try {
      await chrome.tabs.sendMessage(t.id, { type: 'RUN', force: true });
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
    const [recs, dismissed, threads] = await Promise.all([NDB.getAll('unreplied'), NDB.kvGet('dismissed', {}), NDB.kvGet('threadReplies', {})]);
    const n = recs.reduce((a, r) => a + (r.pending || []).filter((c) => !dismissed[c.commentKey]).length, 0)
      + Object.values(threads).filter((t) => !dismissed[`thr:${t.id}`]).length;
    await chrome.action.setBadgeText({ text: n > 0 ? String(n > 99 ? '99+' : n) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#e34948' });
  } catch (_) { /* noop */ }
}
