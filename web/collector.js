/* ============================================================
 * collector.js — ブックマークレット「Ponで記録」（Web版Pon用）
 * note.com のページで実行 → 数値・コメント・通知を取得 → Web版Ponに渡す
 *
 * ・拡張機能の content.js と同じAPI・同じ間隔（1秒以上）で取得する
 * ・データは URL の「#」の後ろに圧縮して入れて Web版Pon に渡す
 *   （# の後ろはサーバーに送られない。GitHub にもどこにも届かない）
 * ・前回どこまで確認したかは、note.com 側のブラウザ保存領域（localStorage）に覚えておく
 * ・認証トークンは note との通信にだけ使い、Web版にも渡さない
 * ============================================================ */
const APP_URL = '__PON_APP_URL__';
const STATE_KEY = 'pon.web.v1';
const INTERVAL_MS = 1000;
const MAX_NOTICE_PAGES = 25;
const NOTICE_SCAN_VERSION = 2;
const GQL_URL = 'https://graphql.note.com/graphql';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noteKeyOf = (url) => (String(url).match(/\/n\/(n[0-9a-z]+)/i) || [])[1] || '';
const userOf = (url) => (String(url).match(/note\.com\/([^/?#]+)\/n\//) || String(url).match(/^\/([^/?#]+)\/n\//) || [])[1] || '';
const jstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/* ---------- 画面（進捗パネル） ---------- */
const UI_ID = 'pon-web-collector';
function panel() {
  const old = document.getElementById(UI_ID);
  if (old) old.remove();
  const box = document.createElement('div');
  box.id = UI_ID;
  box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;max-width:420px;margin:0 auto;background:#1e56a0;color:#fff;font:14px/1.6 system-ui,sans-serif;padding:14px 16px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.35);';
  box.innerHTML = '<div style="font-weight:700;margin-bottom:4px">⚓ Ponで記録</div><div data-t style="white-space:pre-wrap"></div><div data-b style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"></div>';
  document.body.appendChild(box);
  const t = box.querySelector('[data-t]'), b = box.querySelector('[data-b]');
  const state = { skipComments: false, cancelled: false };
  const btn = (label, fn) => { const x = document.createElement('button'); x.textContent = label; x.style.cssText = 'border:0;border-radius:8px;padding:8px 12px;font:inherit;background:#fff;color:#1e56a0;cursor:pointer'; x.onclick = fn; b.appendChild(x); return x; };
  return {
    set: (s) => { t.textContent = s; },
    buttons: (list) => { b.innerHTML = ''; list.forEach(([l, f]) => btn(l, f)); },
    close: () => box.remove(),
    state,
  };
}

/* ---------- 通信 ---------- */
let lastAt = 0;
async function throttled(fn) {
  const w = lastAt + INTERVAL_MS - Date.now();
  if (w > 0) await sleep(w);
  try { return await fn(); } finally { lastAt = Date.now(); }
}
async function getJson(path) {
  for (let i = 1; i <= 3; i++) {
    const res = await throttled(() => fetch(path, { credentials: 'include', headers: { Accept: 'application/json' } }));
    if (res.ok) return res.json();
    if ([401, 403, 404].includes(res.status) || i === 3) throw new Error(`HTTP ${res.status}`);
    await sleep(2000 * i);
  }
}
const token = () => { const m = document.cookie.match(/(?:^|;\s*)note_gql_auth_token=([^;]+)/); return m ? decodeURIComponent(m[1]) : null; };
async function gql(query, variables) {
  const t = token();
  if (!t) throw new Error('NOT_LOGGED_IN');
  let last = '';
  for (let i = 1; i <= 4; i++) {
    const res = await throttled(() => fetch(GQL_URL, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify({ query, variables }) }));
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.data) return j.data;
    if (res.status === 401 || res.status === 403) throw new Error('NOT_LOGGED_IN');
    last = `HTTP ${res.status}`;
    if (i < 4) await sleep(2000 * 2 ** (i - 1));
  }
  throw new Error(`数値の取得に失敗しました（${last}）`);
}

/* ---------- 取得処理（拡張機能の content.js と同じ内容） ---------- */
const LIST_QUERY = `query PonWebList($unit: DashboardPeriodUnit!, $date: Datetime!, $order: DashboardNoteListOrder, $first: Int!, $after: String) {
  dashboardNoteListConnection(unit: $unit, date: $date, order: $order, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node { note { title status publishedAt link { absoluteUrl } } metrics { pageViewCount impressionCount likeCount commentCount salesAmount } } }
  }
  dashboardStatLastUpdatedTimes { id noteStatLastUpdatedAt }
}`;

async function collectSnapshot(me) {
  const today = jstToday();
  const items = [];
  let after = null, statUpdatedAt = null;
  for (let page = 0; page < 50; page++) {
    const v = { unit: 'ALL', date: `${today}T00:00:00.000Z`, order: 'PUBLISHED_DATE_DESC', first: 100 };
    if (after) v.after = after;
    const d = await gql(LIST_QUERY, v);
    const c = d.dashboardNoteListConnection;
    statUpdatedAt = statUpdatedAt || (d.dashboardStatLastUpdatedTimes && d.dashboardStatLastUpdatedTimes.noteStatLastUpdatedAt) || null;
    for (const e of c.edges || []) {
      const n = e.node || {}, note = n.note || {}, m = n.metrics || {}, url = (note.link && note.link.absoluteUrl) || '';
      items.push({ key: noteKeyOf(url), title: note.title || '', url, status: note.status || '', publishedAt: note.publishedAt || '',
        imp: m.impressionCount || 0, pv: m.pageViewCount || 0, like: m.likeCount || 0, comment: m.commentCount || 0, sales: m.salesAmount || 0 });
    }
    if (!c.pageInfo || !c.pageInfo.hasNextPage) break;
    after = c.pageInfo.endCursor;
  }
  const sum = (k) => items.reduce((a, i) => a + i[k], 0);
  return { date: today, capturedAt: new Date().toISOString(), statUpdatedAt, followerCount: me.followerCount ?? null,
    totals: { imp: sum('imp'), pv: sum('pv'), like: sum('like'), comment: sum('comment'), sales: sum('sales'), articles: items.length }, items };
}

function astToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.value || '';
  const inner = (node.children || []).map(astToText).join('');
  return node.tag_name === 'p' || node.tag_name === 'br' ? inner + '\n' : inner;
}
const excerpt = (c) => astToText(c.comment).replace(/\s+/g, ' ').trim().slice(0, 120);

async function rootComments(key) {
  const out = [];
  for (let page = 1; page && page <= 10;) {
    const j = await getJson(`/api/v3/notes/${key}/note_comments?page=${page}`);
    out.push(...(j.data || []));
    page = j.next_page || null;
  }
  return out;
}

function unrepliedRecord(it, roots, me) {
  return {
    noteKey: it.key, title: it.title, url: it.url, checkedCommentCount: it.comment, checkedAt: Date.now(),
    pending: roots.filter((c) => c.user && c.user.urlname !== me.urlname && c.is_creator_replied === false && !c.is_blocked).map((c) => ({
      commentKey: c.key, by: c.user.nickname || c.user.urlname, byUrlname: c.user.urlname, createdAt: c.created_at,
      likeCount: c.like_count || 0, creatorLiked: !!c.is_creator_liked, excerpt: excerpt(c),
    })),
  };
}

async function scanNotices(me, st) {
  const rescan = st.noticeScanVersion !== NOTICE_SCAN_VERSION;
  const seen = rescan ? '' : (st.lastNoticeSeenAt || '');
  let newest = st.lastNoticeSeenAt || '';
  const records = new Map(), threads = [];
  for (let page = 1; page <= MAX_NOTICE_PAGES; page++) {
    const j = await getJson(`/api/v3/notices?page=${page}`);
    let old = false;
    for (const n of j.data || []) {
      if (n.noticed_at && n.noticed_at > newest) newest = n.noticed_at;
      if (seen && n.noticed_at && n.noticed_at <= seen) { old = true; continue; }
      if (n.kind !== 'note_comment_reply' && n.kind !== 'note_comment_like') continue;
      const url = n.all_area_url || n.featured_area_url || '';
      const key = noteKeyOf(url), author = userOf(url);
      if (!key || !author) continue;
      const u = new URL(url, location.origin), c = u.searchParams.get('c'), base = u.origin + u.pathname;
      const by = (n.action_users || []).map((a) => a.name).filter(Boolean).join('、');
      if (author === me.urlname) {
        if (n.kind === 'note_comment_reply') threads.push({ id: `${key}|${n.noticed_at}|${by}`, noteKey: key, title: n.note_name || '', by, at: n.noticed_at, url: c ? `${base}?c=${encodeURIComponent(c)}` : base });
        continue;
      }
      const rec = records.get(key) || { id: key, noteKey: key, noteTitle: n.note_name || '', noteUrl: base, author, source: 'notice', firstSeenAt: new Date().toISOString(), activity: [], lastActivityAt: null };
      rec.activity.push({ kind: n.kind === 'note_comment_reply' ? 'reply' : 'like', by, at: n.noticed_at, link: c ? `${base}?c=${encodeURIComponent(c)}` : base });
      if (!rec.lastActivityAt || n.noticed_at > rec.lastActivityAt) rec.lastActivityAt = n.noticed_at;
      records.set(key, rec);
    }
    if (old || !j.next_page) break;
  }
  st.lastNoticeSeenAt = newest;
  st.noticeScanVersion = NOTICE_SCAN_VERSION;
  return { myComments: [...records.values()], threadReplies: threads };
}

/* ---------- Web版へ渡す ---------- */
async function encodePayload(obj) {
  const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ---------- 本体 ---------- */
async function main() {
  const ui = panel();
  if (location.hostname !== 'note.com') {
    ui.set('note.com のページで実行してください。');
    ui.buttons([['閉じる', ui.close]]);
    return;
  }
  ui.buttons([['中止', () => { ui.state.cancelled = true; ui.close(); }]]);
  try {
    ui.set('noteの準備を待っています…');
    for (let i = 0; i < 20 && !token(); i++) await sleep(1000);
    if (!token()) throw new Error('noteにログインしてから実行してください（ログイン済みなら、noteのトップページを開き直してからもう一度）。');

    let st = {};
    try { st = JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (_) { st = {}; }
    st.checked = st.checked || {};

    ui.set('自分の情報を確認中…');
    const cu = (await getJson('/api/v2/current_user')).data;
    if (!cu || !cu.urlname) throw new Error('noteにログインしてから実行してください。');
    const me = { urlname: cu.urlname, nickname: cu.nickname || cu.urlname, followerCount: cu.follower_count ?? null };
    if (st.urlname && st.urlname !== me.urlname) st = { checked: {} }; // 別アカウントに切り替えた
    st.urlname = me.urlname;

    ui.set('記事の数値を取得中…');
    const snapshot = await collectSnapshot(me);
    if (ui.state.cancelled) return;

    // コメント：数が変わった記事と、前回未返信が残っていた記事だけ確認
    const pendingBefore = new Set(st.pendingKeys || []);
    const targets = snapshot.items.filter((i) => i.key && i.comment > 0 && (st.checked[i.key] !== i.comment || pendingBefore.has(i.key)));
    const unreplied = [];
    ui.buttons([['コメント確認を後回し', () => { ui.state.skipComments = true; }], ['中止', () => { ui.state.cancelled = true; ui.close(); }]]);
    for (let i = 0; i < targets.length; i++) {
      if (ui.state.cancelled) return;
      if (ui.state.skipComments) break;
      ui.set(`コメントを確認中… ${i + 1} / ${targets.length}記事\n（初回は時間がかかります。2回目からは数秒です）`);
      try {
        const rec = unrepliedRecord(targets[i], await rootComments(targets[i].key), me);
        unreplied.push(rec);
        st.checked[rec.noteKey] = rec.checkedCommentCount;
      } catch (_) { /* 次回また確認 */ }
    }
    const pendingNow = new Set([...pendingBefore].filter((k) => !unreplied.some((u) => u.noteKey === k)));
    unreplied.filter((u) => u.pending.length).forEach((u) => pendingNow.add(u.noteKey));
    st.pendingKeys = [...pendingNow];

    ui.buttons([['中止', () => { ui.state.cancelled = true; ui.close(); }]]);
    ui.set('通知を確認中…');
    const n = await scanNotices(me, st);
    if (ui.state.cancelled) return;

    // ジァン=サマーとの縁（称号・着せ替えの解放）。フォローしていない間は毎回確認（通信1回）
    let perk = st.perk || null;
    try {
      perk = await PonPerkCollect.check({ getJson, me, prev: st.perk, force: !(st.perk && st.perk.following), ownKeys: snapshot.items.map((i) => i.key), onProgress: (t) => ui.set(t) });
      st.perk = perk;
    } catch (_) { /* 次回また確認 */ }
    if (ui.state.cancelled) return;

    ui.set('Ponに渡しています…');
    const payload = { app: 'pon-web', v: 1, me, snapshot, unreplied, myComments: n.myComments, threadReplies: n.threadReplies,
      perk: perk ? { ...perk, scannedKeys: undefined } : null,
      logs: ui.state.skipComments ? [{ level: 'info', message: 'コメント確認の残りは次回に後回しにしました' }] : [] };
    const encoded = await encodePayload(payload);
    localStorage.setItem(STATE_KEY, JSON.stringify(st));
    location.href = `${APP_URL}#pon=${encoded}`;
  } catch (e) {
    ui.set(`❌ ${e.message}`);
    ui.buttons([['閉じる', ui.close]]);
  }
}
