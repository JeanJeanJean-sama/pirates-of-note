/* ============================================================
 * content.js — note.com のページ内で動く収集処理
 *
 * 1. 全期間スナップショット（1日1回、自動）
 *    ダッシュボードと同じ GraphQL API で、全記事の累計 IMP/PV/スキ/コメント/売上 を取得
 * 2. 未返信コメントの確認（6時間ごと）
 *    コメント数が増えた自分の記事だけ、コメント一覧を確認（is_creator_replied を利用）
 * 3. 自分のコメントの記録
 *    a. 他人の記事を開いたとき、その記事のコメント欄から自分のコメントを記録
 *    b. 通知（自分のコメントへの返信・スキ）から、コメントした記事を記録（12時間ごと）
 *
 * ・認証トークン（Cookie: note_gql_auth_token）は note との通信にだけ使い、保存も外部送信もしない
 * ・note へのリクエストは必ず 1 秒以上あける
 * ============================================================ */
(() => {
  'use strict';
  if (window.__ponLoaded) return;
  window.__ponLoaded = true;

  const INTERVAL_MS = 1000;
  const COMMENT_CHECK_EVERY_MS = 6 * 3600e3;
  const NOTICE_SCAN_EVERY_MS = 12 * 3600e3;
  const PAGE_CHECK_EVERY_MS = 3600e3;
  const MAX_COMMENT_ARTICLES_PER_RUN = 60; // 1回の上限。残りは次にnoteを開いたときに続きから
  const NOTICE_SCAN_VERSION = 2;           // 通知の読み方を変えたら上げる（全件を読み直す）
  const MAX_NOTICE_PAGES = 25;
  const GQL_URL = 'https://graphql.note.com/graphql';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const send = (type, payload) => chrome.runtime.sendMessage({ type, payload });
  const log = (level, message) => send('LOG', { level, message }).catch(() => {});
  const noteKeyOf = (url) => (String(url).match(/\/n\/(n[0-9a-z]+)/i) || [])[1] || '';
  const userOf = (url) => (String(url).match(/note\.com\/([^/?#]+)\/n\//) || String(url).match(/^\/([^/?#]+)\/n\//) || [])[1] || '';

  /* ---------- note への通信（1秒間隔を強制） ---------- */
  let lastRequestAt = 0;
  async function throttled(fn) {
    const wait = lastRequestAt + INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try { return await fn(); } finally { lastRequestAt = Date.now(); }
  }

  async function getJson(path, tries = 3) {
    for (let i = 1; i <= tries; i++) {
      const res = await throttled(() => fetch(path, { credentials: 'include', headers: { Accept: 'application/json' } }));
      if (res.ok) return res.json();
      if (res.status === 404 || res.status === 401 || res.status === 403) throw new Error(`HTTP ${res.status} ${path}`);
      if (i < tries) await sleep(2000 * i);
      else throw new Error(`HTTP ${res.status} ${path}`);
    }
  }

  function gqlToken() {
    const m = document.cookie.match(/(?:^|;\s*)note_gql_auth_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function gql(query, variables, tries = 4) {
    const token = gqlToken();
    if (!token) throw new Error('NOT_LOGGED_IN');
    let last = '';
    for (let i = 1; i <= tries; i++) {
      const res = await throttled(() => fetch(GQL_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ query, variables }),
      }));
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.data) return json.data;
      if (res.status === 401 || res.status === 403) throw new Error('NOT_LOGGED_IN');
      last = `HTTP ${res.status} ${(json && json.errors || []).map((e) => e.message).join(', ')}`;
      if (i < tries) await sleep(2000 * 2 ** (i - 1));
    }
    throw new Error(`GraphQL エラー: ${last}`);
  }

  /* ---------- 1. 全期間スナップショット ---------- */
  const LIST_QUERY = `query NddNoteList($unit: DashboardPeriodUnit!, $date: Datetime!, $order: DashboardNoteListOrder, $first: Int!, $after: String) {
    dashboardNoteListConnection(unit: $unit, date: $date, order: $order, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        note { title status publishedAt link { absoluteUrl } }
        metrics { pageViewCount impressionCount likeCount commentCount salesAmount }
      } }
    }
    dashboardStatLastUpdatedTimes { id noteStatLastUpdatedAt }
  }`;

  async function collectSnapshot(me) {
    const today = jstToday();
    const items = [];
    let after = null;
    let statUpdatedAt = null;
    for (let page = 0; page < 50; page++) {
      const v = { unit: 'ALL', date: `${today}T00:00:00.000Z`, order: 'PUBLISHED_DATE_DESC', first: 100 };
      if (after) v.after = after;
      const data = await gql(LIST_QUERY, v);
      const conn = data.dashboardNoteListConnection;
      statUpdatedAt = statUpdatedAt || (data.dashboardStatLastUpdatedTimes && data.dashboardStatLastUpdatedTimes.noteStatLastUpdatedAt) || null;
      for (const e of conn.edges || []) {
        const n = e.node || {}, note = n.note || {}, m = n.metrics || {};
        const url = (note.link && note.link.absoluteUrl) || '';
        items.push({
          key: noteKeyOf(url), title: note.title || '', url, status: note.status || '', publishedAt: note.publishedAt || '',
          imp: m.impressionCount || 0, pv: m.pageViewCount || 0, like: m.likeCount || 0, comment: m.commentCount || 0, sales: m.salesAmount || 0,
        });
      }
      if (!conn.pageInfo || !conn.pageInfo.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }
    const sum = (k) => items.reduce((a, i) => a + i[k], 0);
    const snapshot = {
      date: today,
      capturedAt: new Date().toISOString(),
      statUpdatedAt,
      followerCount: me && typeof me.followerCount === 'number' ? me.followerCount : null,
      totals: { imp: sum('imp'), pv: sum('pv'), like: sum('like'), comment: sum('comment'), sales: sum('sales'), articles: items.length },
      items,
    };
    await send('SAVE_SNAPSHOT', { snapshot });
    return snapshot;
  }

  /* ---------- 自分の情報（ID・表示名・フォロワー数のみ。メール等は保存しない） ---------- */
  async function fetchMe() {
    const j = await getJson('/api/v2/current_user');
    const d = j && j.data;
    if (!d || !d.urlname) throw new Error('NOT_LOGGED_IN');
    const me = { urlname: d.urlname, nickname: d.nickname || d.urlname, followerCount: d.follower_count ?? null };
    await send('SAVE_ME', me);
    return me;
  }

  /* ---------- コメント ---------- */
  function astToText(node) {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (node.type === 'text') return node.value || '';
    const inner = (node.children || []).map(astToText).join('');
    return node.tag_name === 'p' || node.tag_name === 'br' ? inner + '\n' : inner;
  }
  const excerpt = (c) => astToText(c.comment).replace(/\s+/g, ' ').trim().slice(0, 120);

  async function fetchRootComments(noteKey, maxPages = 10) {
    const out = [];
    let page = 1;
    while (page && page <= maxPages) {
      const j = await getJson(`/api/v3/notes/${noteKey}/note_comments?page=${page}`);
      out.push(...(j.data || []));
      page = j.next_page || null;
    }
    return out;
  }

  /** 自分の記事の未返信コメントを確認（コメント数が変わった記事だけ） */
  async function checkUnreplied(state, me, force) {
    const snap = state.latestSnapshot;
    if (!snap) return { done: 0, remaining: 0 };
    const all = snap.items
      .filter((i) => i.key && i.comment > 0)
      .filter((i) => force || state.checked[i.key] !== i.comment);
    const targets = all.slice(0, MAX_COMMENT_ARTICLES_PER_RUN);
    const records = [];
    for (const it of targets) {
      try {
        const roots = await fetchRootComments(it.key);
        records.push(buildUnrepliedRecord(it, roots, me));
      } catch (e) {
        log('warn', `コメント確認に失敗: ${it.title}（${e.message}）`);
      }
      if (records.length >= 10) { await send('SAVE_UNREPLIED', { records: records.splice(0) }); }
    }
    if (records.length) await send('SAVE_UNREPLIED', { records });
    return { done: targets.length, remaining: all.length - targets.length };
  }

  function buildUnrepliedRecord(it, roots, me) {
    const pending = roots
      .filter((c) => c.user && c.user.urlname !== me.urlname && c.is_creator_replied === false && !c.is_blocked)
      .map((c) => ({
        commentKey: c.key,
        by: c.user.nickname || c.user.urlname,
        byUrlname: c.user.urlname,
        createdAt: c.created_at,
        likeCount: c.like_count || 0,
        creatorLiked: !!c.is_creator_liked,
        excerpt: excerpt(c),
      }));
    return { noteKey: it.key, title: it.title, url: it.url, checkedCommentCount: it.comment, checkedAt: Date.now(), pending };
  }

  /** 他人の記事ページ：その記事のコメント欄から自分のコメントを記録 */
  async function recordMyCommentsOnPage(me, state) {
    const key = noteKeyOf(location.pathname);
    const author = userOf(location.pathname);
    if (!key || !author) return;
    if (author === me.urlname) {
      // 自分の記事：開くたびに未返信の状態を更新し、未返信が残っていれば返信を待って確認し直す
      await refreshOwnArticle(key, me, state);
      return;
    }
    const last = state.pageChecks[key] || 0;
    if (Date.now() - last < PAGE_CHECK_EVERY_MS) return;
    const pageChecks = { ...state.pageChecks, [key]: Date.now() };
    // 古い記録は500件まで
    const trimmed = Object.fromEntries(Object.entries(pageChecks).sort((a, b) => b[1] - a[1]).slice(0, 500));
    await send('SET_KV', { key: 'pageChecks', value: trimmed });

    const roots = await fetchRootComments(key, 5);
    const mine = roots.filter((c) => c.user && c.user.urlname === me.urlname);
    if (!mine.length) return;
    const title = cleanTitle();
    const url = location.origin + location.pathname;
    await send('SAVE_MY_COMMENTS', {
      records: mine.map((c) => ({
        id: `${key}#${c.key}`, noteKey: key, noteTitle: title, noteUrl: url, author,
        commentKey: c.key, excerpt: excerpt(c), createdAt: c.created_at,
        likeCount: c.like_count || 0, replyCount: c.reply_count || 0, creatorReplied: !!c.is_creator_replied,
        source: 'page', firstSeenAt: new Date().toISOString(), lastActivityAt: c.created_at,
      })),
    });
  }
  const cleanTitle = () => document.title.replace(/｜.*$/, '').trim();

  /* 自分の記事ページ：返信したらすぐ未返信から外す
   * 未返信が残っている間だけ、画面が表示されているときに30秒ごと（最大15分）確認し直す */
  const OWN_WATCH_INTERVAL_MS = 30 * 1000;
  const OWN_WATCH_MAX_MS = 15 * 60 * 1000;
  let ownWatch = null;

  async function refreshOwnArticle(key, me, state) {
    const roots = await fetchRootComments(key, 10);
    const snapItem = state.latestSnapshot && state.latestSnapshot.items.find((i) => i.key === key);
    const it = { key, title: (snapItem && snapItem.title) || cleanTitle(), url: location.origin + location.pathname, comment: snapItem ? snapItem.comment : -1 };
    const rec = buildUnrepliedRecord(it, roots, me);
    await send('SAVE_UNREPLIED', { records: [rec] });

    if (ownWatch && ownWatch.key !== key) { clearInterval(ownWatch.timer); ownWatch = null; }
    if (!rec.pending.length) { if (ownWatch) { clearInterval(ownWatch.timer); ownWatch = null; } return; }
    if (ownWatch) return;
    const startedAt = Date.now();
    ownWatch = { key, timer: setInterval(async () => {
      if (noteKeyOf(location.pathname) !== key || Date.now() - startedAt > OWN_WATCH_MAX_MS) { clearInterval(ownWatch.timer); ownWatch = null; return; }
      if (document.hidden || running) return;
      try {
        const r = await fetchRootComments(key, 10);
        const next = buildUnrepliedRecord(it, r, me);
        await send('SAVE_UNREPLIED', { records: [next] });
        if (!next.pending.length) { clearInterval(ownWatch.timer); ownWatch = null; }
      } catch (_) { /* 次の周期で再試行 */ }
    }, OWN_WATCH_INTERVAL_MS) };
  }

  /** 通知から「自分のコメントへの返信・スキ」を拾い、コメントした記事を記録 */
  async function scanNotices(me, state) {
    const rescan = state.noticeScanVersion !== NOTICE_SCAN_VERSION;
    const newestSeen = rescan ? '' : (state.lastNoticeSeenAt || '');
    let newest = state.lastNoticeSeenAt || '';
    const records = new Map();
    const threadReplies = [];
    for (let page = 1; page <= MAX_NOTICE_PAGES; page++) {
      const j = await getJson(`/api/v3/notices?page=${page}`);
      const list = j.data || [];
      let reachedOld = false;
      for (const n of list) {
        if (n.noticed_at && n.noticed_at > newest) newest = n.noticed_at;
        if (newestSeen && n.noticed_at && n.noticed_at <= newestSeen) { reachedOld = true; continue; }
        if (n.kind !== 'note_comment_reply' && n.kind !== 'note_comment_like') continue;
        const url = n.all_area_url || n.featured_area_url || '';
        const key = noteKeyOf(url);
        const author = userOf(url);
        if (!key || !author) continue;
        const clean = new URL(url, location.origin);
        const commentParam = clean.searchParams.get('c');
        if (author === me.urlname) {
          // 自分の記事で「あなたの返信にさらに返信が来た」＝返信の要確認
          if (n.kind === 'note_comment_reply') {
            const by = (n.action_users || []).map((u) => u.name).filter(Boolean).join('、');
            threadReplies.push({
              id: `${key}|${n.noticed_at}|${by}`, noteKey: key, title: n.note_name || '', by, at: n.noticed_at,
              url: commentParam ? `${clean.origin}${clean.pathname}?c=${encodeURIComponent(commentParam)}` : clean.origin + clean.pathname,
            });
          }
          continue;
        }
        const rec = records.get(key) || {
          id: key, noteKey: key, noteTitle: n.note_name || '', noteUrl: clean.origin + clean.pathname, author,
          source: 'notice', firstSeenAt: new Date().toISOString(), activity: [], lastActivityAt: null,
        };
        const by = (n.action_users || []).map((u) => u.name).filter(Boolean).join('、');
        rec.activity.push({ kind: n.kind === 'note_comment_reply' ? 'reply' : 'like', by, at: n.noticed_at, link: commentParam ? `${rec.noteUrl}?c=${encodeURIComponent(commentParam)}` : rec.noteUrl });
        if (!rec.lastActivityAt || n.noticed_at > rec.lastActivityAt) rec.lastActivityAt = n.noticed_at;
        records.set(key, rec);
      }
      if (reachedOld || !j.next_page) break;
    }
    if (records.size) await send('SAVE_MY_COMMENTS', { records: [...records.values()] });
    if (threadReplies.length) await send('SAVE_THREAD_REPLIES', { items: threadReplies });
    await send('SET_KV', { key: 'lastNoticeSeenAt', value: newest });
    if (rescan) await send('SET_KV', { key: 'noticeScanVersion', value: NOTICE_SCAN_VERSION });
    return { articles: records.size, threadReplies: threadReplies.length };
  }

  /* ---------- 本文の保存 ----------
   * 自動：直近7日に公開した記事のうち未保存のもの
   * 手動：ダッシュボードで「保存」を押した記事（bodyQueue）
   * 1記事ずつ保存するので、途中でタブを閉じても次回続きから */
  const AUTO_BODY_DAYS = 7;
  const MAX_BODIES_PER_RUN = 300;

  function bodyRecord(key, d, url) {
    return {
      noteKey: key,
      title: d.name || '',
      url: d.note_url || url || '',
      publishedAt: d.publish_at || '',
      hashtags: (d.hashtag_notes || []).map((h) => (h && h.hashtag && h.hashtag.name) || (h && h.name) || '').filter(Boolean).map((t) => t.replace(/^#/, '')),
      price: d.price || 0,
      isLimited: !!d.is_limited,
      canRead: d.can_read !== false,
      html: d.body || '',
      eyecatch: d.eyecatch || '',
      fetchedAt: new Date().toISOString(),
    };
  }

  async function saveBodies(state, s) {
    const snapItems = state.latestSnapshot ? state.latestSnapshot.items : [];
    const have = new Set(state.bodyKeys || []);
    const cutoff = Date.now() - AUTO_BODY_DAYS * 864e5;
    const auto = s.saveBodies ? snapItems.filter((i) => i.key && !have.has(i.key) && new Date(i.publishedAt).getTime() >= cutoff).map((i) => i.key) : [];
    const keys = [...new Set([...(state.bodyQueue || []), ...auto])].slice(0, MAX_BODIES_PER_RUN);
    if (!keys.length) return 0;
    const urlOf = new Map(snapItems.map((i) => [i.key, i.url]));
    let done = 0;
    for (const key of keys) {
      try {
        const j = await getJson(`/api/v3/notes/${key}`);
        await send('SAVE_BODY', { record: bodyRecord(key, (j && j.data) || {}, urlOf.get(key)) });
        done++;
      } catch (e) {
        log('warn', `本文の取得に失敗: ${key}（${e.message}）`);
        if (/HTTP 404/.test(e.message)) await send('SAVE_BODY', { record: { noteKey: key, missing: true, fetchedAt: new Date().toISOString() } }).catch(() => {});
      }
      if (done % 5 === 0) await send('SET_KV', { key: 'bodyProgress', value: { done, total: keys.length, at: Date.now() } });
    }
    await send('SET_KV', { key: 'bodyProgress', value: { done, total: keys.length, at: Date.now(), finished: true } });
    return done;
  }


  /* ---------- ジァン=サマーとの縁（称号・着せ替えの解放）。perk-collect.js ---------- */
  async function checkPerk(me, s) {
    if (typeof PonPerkCollect === 'undefined') return;
    const st = (await send('GET_STATE')).state;
    const items = st.latestSnapshot ? st.latestSnapshot.items : [];
    const urlOf = new Map(items.map((i) => [i.key, i.url]));
    const before = st.perk;
    const perk = await PonPerkCollect.check({
      getJson, me, prev: before, force: !!st.perkForce,
      ownKeys: items.map((i) => i.key), skipKeys: st.bodyKeys,
      onBody: s.saveBodies ? (key, d) => send('SAVE_BODY', { record: bodyRecord(key, d, urlOf.get(key)) }) : null,
    });
    await send('SET_KV', { key: 'perk', value: perk });
    if (st.perkForce) await send('SET_KV', { key: 'perkForce', value: false });
    if (!before || before.checkedAt !== perk.checkedAt) log('info', `称号の解放を確認しました（フォロー${perk.following ? '中' : 'なし'}）`);
  }

  /* ---------- 実行制御 ---------- */
  function jstToday() {
    return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  }

  /** note のページが読み込み時に認証トークンを用意するので、最大20秒待つ（拡張機能からは発行しない） */
  async function waitForToken(timeoutMs = 20000) {
    const until = Date.now() + timeoutMs;
    while (!gqlToken() && Date.now() < until) await sleep(1000);
    return !!gqlToken();
  }

  let running = false;
  async function run({ force = false } = {}) {
    if (running) return;
    running = true;
    if (!(await waitForToken())) { running = false; return; } // 未ログイン、またはトークン未発行のページ
    let locked = false;
    try {
      const { state } = await send('GET_STATE');
      force = force || state.forceRun;
      const s = state.settings;
      const lock = await send('ACQUIRE_LOCK', { ttlMs: 20 * 60e3 });
      if (!lock.granted) return;
      locked = true;
      if (state.forceRun) await send('SET_KV', { key: 'forceRun', value: false });

      const needSnapshot = force || (s.autoCollect && (!state.latestSnapshot || state.latestSnapshot.date !== jstToday()));
      let me = state.me;
      if (!me || needSnapshot || Date.now() - (me.updatedAt || 0) > 24 * 3600e3) me = await fetchMe();

      if (needSnapshot) {
        const snap = await collectSnapshot(me);
        log('info', `全期間スナップショットを保存しました（${snap.items.length}記事）`);
      }

      const fresh = (await send('GET_STATE')).state;
      if (s.checkComments && (force || fresh.commentCheckIncomplete || Date.now() - fresh.lastCommentCheckAt > COMMENT_CHECK_EVERY_MS)) {
        const r = await checkUnreplied(fresh, me, false);
        // 上限で残った記事があれば、6時間待たずに次にnoteを開いたとき続きを確認する
        await send('SET_KV', { key: 'commentCheckIncomplete', value: r.remaining > 0 });
        if (r.remaining === 0) await send('SET_KV', { key: 'lastCommentCheckAt', value: Date.now() });
        if (r.done) log('info', `コメントを確認しました（${r.done}記事${r.remaining ? `、残り${r.remaining}記事は次回` : ''}）`);
      }
      if (force || fresh.noticeScanVersion !== NOTICE_SCAN_VERSION || Date.now() - fresh.lastNoticeScanAt > NOTICE_SCAN_EVERY_MS) {
        if (s.recordMyComments || s.checkComments) {
          const r = await scanNotices(me, fresh);
          await send('SET_KV', { key: 'lastNoticeScanAt', value: Date.now() });
          if (r.articles || r.threadReplies) log('info', `通知を確認しました（自分がコメントした記事 ${r.articles}件、自分の記事での返信への返信 ${r.threadReplies}件）`);
        }
      }
      const n = await saveBodies((await send('GET_STATE')).state, s);
      if (n) log('info', `記事の本文を ${n} 件保存しました`);
      if (s.recordMyComments || s.checkComments) await recordMyCommentsOnPage(me, fresh);
      try { await checkPerk(me, s); } catch (e) { if (!String(e.message).includes('NOT_LOGGED_IN')) log('warn', `称号の確認に失敗: ${e.message}`); }
    } catch (e) {
      if (String(e.message).includes('NOT_LOGGED_IN')) return;
      log('error', e.message);
    } finally {
      if (locked) await send('RELEASE_LOCK').catch(() => {});
      send('RUN_DONE').catch(() => {});
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg && msg.type === 'RUN') { run({ force: !!msg.force }).then(() => sendResponse({ ok: true })); return true; }
  });

  // 初回＋SPA遷移（記事ページを開いたとき）
  setTimeout(() => run(), 2000);
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      setTimeout(() => run(), 2000);
    }
  }, 1500);
})();
