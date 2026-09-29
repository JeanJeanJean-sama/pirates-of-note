/* ============================================================
 * store.js — 保存処理の共通部分（拡張機能とWebアプリ版で共有）
 * chrome.* のAPIは使わない。db.js（NDB）の後に読み込む。
 * ============================================================ */
const PonStore = (() => {
  const DEFAULT_SETTINGS = { autoCollect: true, checkComments: true, recordMyComments: true, saveBodies: true, perkCheck: true };
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
    const [bodyKeys, bodyQueue, perk, perkForce, accountSeen] = await Promise.all([NDB.getAllKeys('bodies'), NDB.kvGet('bodyQueue', []), NDB.kvGet('perk', null), NDB.kvGet('perkForce', false), NDB.kvGet('accountSeen', null)]);
    snapshots.sort((a, b) => a.date.localeCompare(b.date));
    const latest = snapshots[snapshots.length - 1] || null;
    return {
      me,
      settings: { ...DEFAULT_SETTINGS, ...settings },
      latestSnapshot: latest && { date: latest.date, account: latest.account || '', items: latest.items.map((i) => ({ key: i.key, title: i.title, url: i.url, comment: i.comment, publishedAt: i.publishedAt })) },
      checked: Object.fromEntries(unreplied.map((u) => [u.noteKey, u.checkedCommentCount])),
      lastCommentCheckAt, lastNoticeScanAt, lastNoticeSeenAt, pageChecks, forceRun, commentCheckIncomplete, noticeScanVersion,
      bodyKeys, bodyQueue, perk, perkForce, accountSeen,
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

  /* ---------- 記録するアカウント（v0.6.0 ⑫） ----------
   * 1つのブラウザで複数のnoteアカウントを切り替えても記録が混ざらないように、
   * 「記録するアカウント」（noteのID＝urlname）を覚えておき、違うアカウントでログイン中なら何も記録しない。
   *  kv 'recordAccount'  : { urlname, nickname, setAt, from:'migrate'|'first'|'change'|'backup' }
   *  kv 'accountGate'    : 直近の確認の結果 { ok, urlname, at }（保存のときの最後の見張り）
   *  kv 'accountMismatch': 別のアカウントだったので記録しなかったとき { urlname, nickname, expected, at }
   */
  const norm = (s) => String(s || '').trim().toLowerCase();
  /** 記事のURL（https://note.com/ID/n/…）からIDを取り出す。独自ドメインなどで分からなければ '' */
  const accountOfUrl = (url) => norm((String(url || '').match(/^https?:\/\/note\.com\/([^/?#]+)\/n\//) || [])[1]);

  /** 記録するアカウント。まだ無ければ、今まで使っていた me をそのまま引き継ぐ（引っ越し） */
  async function recordAccount() {
    let a = await NDB.kvGet('recordAccount', null);
    if (!a) {
      const me = await NDB.kvGet('me', null);
      if (me && me.urlname) { a = { urlname: norm(me.urlname), nickname: me.nickname || '', setAt: Date.now(), from: 'migrate' }; await NDB.kvSet('recordAccount', a); }
    }
    return a;
  }
  /** ログイン中のアカウント（current_user の結果）と比べる。初めての人は、このアカウントを記録するアカウントにする */
  async function checkAccount(me) {
    const u = norm(me && me.urlname);
    if (!u) return { ok: false, account: await recordAccount() };
    let a = await recordAccount();
    if (!a) { a = { urlname: u, nickname: me.nickname || '', setAt: Date.now(), from: 'first' }; await NDB.kvSet('recordAccount', a); }
    const ok = a.urlname === u;
    const prev = await NDB.kvGet('accountMismatch', null);
    await NDB.kvSet('accountGate', { ok, urlname: u, at: Date.now() });
    if (ok) { if (prev) await NDB.kvSet('accountMismatch', null); }
    else await NDB.kvSet('accountMismatch', { urlname: u, nickname: me.nickname || '', expected: a.urlname, at: Date.now(), since: prev && prev.urlname === u ? prev.since || prev.at : Date.now() });
    return { ok, account: a, repeated: !!(prev && prev.urlname === u) };
  }
  /** 保存してよいか（直近の確認が「記録するアカウント」と同じだったか） */
  async function gateOk() {
    const [g, a] = await Promise.all([NDB.kvGet('accountGate', null), NDB.kvGet('recordAccount', null)]);
    return !!(g && g.ok && a && g.urlname === a.urlname);
  }
  /** 記録にアカウントの印を付ける（項目を足すだけ） */
  const stamp = (rec, urlname) => (rec && urlname ? { ...rec, account: urlname } : rec);
  /** 記録するアカウントを変える（今までの記録は残る） */
  async function changeAccount(urlname, nickname = '') {
    const u = norm(urlname);
    if (!/^[a-z0-9_]{1,64}$/.test(u)) throw new Error('noteのIDは、英数字と「_」で入れてください。');
    await NDB.kvSet('recordAccount', { urlname: u, nickname, setAt: Date.now(), from: 'change' });
    await NDB.kvSet('accountGate', null);
    await NDB.kvSet('accountMismatch', null);
    await NDB.kvSet('accountSeen', null);
  }

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

  return { DEFAULT_SETTINGS, getState, mergeMyComment, saveMe, accountOfUrl, recordAccount, checkAccount, gateOk, stamp, changeAccount, saveSnapshot, saveUnreplied, saveMyComments, saveThreadReplies, saveBody, appendLog, unrepliedCount };
})();
