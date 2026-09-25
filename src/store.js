/* ============================================================
 * store.js — 保存処理の共通部分（拡張機能とWebアプリ版で共有）
 * chrome.* のAPIは使わない。db.js（NDB）の後に読み込む。
 * ============================================================ */
const PonStore = (() => {
  const DEFAULT_SETTINGS = { autoCollect: true, checkComments: true, recordMyComments: true, saveBodies: true };
  const LOG_LIMIT = 200;

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
    const [bodyKeys, bodyQueue, perk, perkForce] = await Promise.all([NDB.getAllKeys('bodies'), NDB.kvGet('bodyQueue', []), NDB.kvGet('perk', null), NDB.kvGet('perkForce', false)]);
    snapshots.sort((a, b) => a.date.localeCompare(b.date));
    const latest = snapshots[snapshots.length - 1] || null;
    return {
      me,
      settings: { ...DEFAULT_SETTINGS, ...settings },
      latestSnapshot: latest && { date: latest.date, items: latest.items.map((i) => ({ key: i.key, title: i.title, url: i.url, comment: i.comment, publishedAt: i.publishedAt })) },
      checked: Object.fromEntries(unreplied.map((u) => [u.noteKey, u.checkedCommentCount])),
      lastCommentCheckAt, lastNoticeScanAt, lastNoticeSeenAt, pageChecks, forceRun, commentCheckIncomplete, noticeScanVersion,
      bodyKeys, bodyQueue, perk, perkForce,
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

  const saveMe = (me) => NDB.kvSet('me', { ...me, updatedAt: Date.now() });

  async function saveSnapshot(snapshot) {
    await NDB.put('snapshots', snapshot);
    await NDB.kvSet('lastSnapshotAt', Date.now());
  }

  const saveUnreplied = (records) => NDB.putMany('unreplied', records);

  async function saveMyComments(records) {
    for (const rec of records) {
      const old = await NDB.get('myComments', rec.id);
      await NDB.put('myComments', mergeMyComment(old, rec));
    }
  }

  async function saveThreadReplies(items) {
    const cur = await NDB.kvGet('threadReplies', {});
    for (const it of items) cur[it.id] = cur[it.id] || it;
    const kept = Object.fromEntries(Object.entries(cur).sort((a, b) => (b[1].at || '').localeCompare(a[1].at || '')).slice(0, 300));
    await NDB.kvSet('threadReplies', kept);
  }

  async function saveBody(record) {
    await NDB.put('bodies', record);
    const q = await NDB.kvGet('bodyQueue', []);
    await NDB.kvSet('bodyQueue', q.filter((k) => k !== record.noteKey));
  }

  async function appendLog(level, message) {
    const logs = await NDB.kvGet('logs', []);
    logs.push({ at: Date.now(), level, message });
    await NDB.kvSet('logs', logs.slice(-LOG_LIMIT));
  }

  /** 未返信（＋返信への返信）の件数 */
  async function unrepliedCount() {
    const [recs, dismissed, threads] = await Promise.all([NDB.getAll('unreplied'), NDB.kvGet('dismissed', {}), NDB.kvGet('threadReplies', {})]);
    return recs.reduce((a, r) => a + (r.pending || []).filter((c) => !dismissed[c.commentKey]).length, 0)
      + Object.values(threads).filter((t) => !dismissed[`thr:${t.id}`]).length;
  }

  return { DEFAULT_SETTINGS, getState, mergeMyComment, saveMe, saveSnapshot, saveUnreplied, saveMyComments, saveThreadReplies, saveBody, appendLog, unrepliedCount };
})();
