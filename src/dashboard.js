/* ============================================================
 * dashboard.js — 拡張機能のダッシュボード画面
 * データは IndexedDB（db.js）から直接読み込む。note への通信はしない。
 * ============================================================ */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmt = (n) => (n == null || Number.isNaN(n) ? '–' : Number(n).toLocaleString('ja-JP'));
const pct = (n) => (n == null || !Number.isFinite(n) ? '–' : `${(n * 100).toFixed(1)}%`);
const signed = (n) => (n == null ? '–' : n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '±0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => { if (!iso) return '–'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '–' : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
const fmtDateTime = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '–' : `${fmtDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);

const METRIC_LABEL = { pv: 'ページビュー', imp: 'インプレッション', like: 'スキ', comment: 'コメント', follower: 'フォロワー' };

const S = { snapshots: [], me: null, unreplied: [], threadReplies: [], commentCheckIncomplete: false, dismissed: {}, myComments: [], settings: {}, logs: [], metric: 'pv', mode: 'diff', sort: { key: 'pv', dir: -1 }, search: '' };

/* ---------------- 読み込み ---------------- */
async function load() {
  const [snapshots, me, unreplied, dismissed, myComments, settings, logs, threads, incomplete] = await Promise.all([
    NDB.getAll('snapshots'), NDB.kvGet('me', null), NDB.getAll('unreplied'), NDB.kvGet('dismissed', {}),
    NDB.getAll('myComments'), NDB.kvGet('settings', {}), NDB.kvGet('logs', []), NDB.kvGet('threadReplies', {}), NDB.kvGet('commentCheckIncomplete', false),
  ]);
  S.threadReplies = Object.values(threads).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  S.commentCheckIncomplete = incomplete;
  S.snapshots = snapshots.sort((a, b) => a.date.localeCompare(b.date));
  Object.assign(S, { me, unreplied, dismissed, myComments, logs, settings: { autoCollect: true, checkComments: true, recordMyComments: true, ...settings } });
  renderAll();
}

function renderAll() {
  $('#whoami').textContent = S.me ? `${S.me.nickname}（@${S.me.urlname}）` : 'noteにログインした状態で note.com を開くと記録が始まります';
  renderOverview();
  renderArticles();
  renderComments();
  renderData();
}

const latest = () => S.snapshots[S.snapshots.length - 1] || null;
const previous = () => S.snapshots[S.snapshots.length - 2] || null;

/* ---------------- 概要 ---------------- */
function renderOverview() {
  const cur = latest(), prev = previous();
  $('#emptyState').hidden = !!cur;
  $('#kpis').innerHTML = '';
  if (!cur) { $('#chart').innerHTML = ''; $('#growthList').innerHTML = ''; $('#snapMeta').textContent = ''; return; }

  const span = prev ? daysBetween(prev.date, cur.date) : 0;
  const tiles = [
    ['pv', 'ページビュー', cur.totals.pv, prev && prev.totals.pv],
    ['imp', 'インプレッション', cur.totals.imp, prev && prev.totals.imp],
    ['like', 'スキ', cur.totals.like, prev && prev.totals.like],
    ['comment', 'コメント', cur.totals.comment, prev && prev.totals.comment],
    ['follower', 'フォロワー', cur.followerCount, prev && prev.followerCount],
    ['articles', '記事数', cur.totals.articles, prev && prev.totals.articles],
  ];
  $('#kpis').innerHTML = tiles.map(([, label, v, p]) => {
    const d = v != null && p != null ? v - p : null;
    const cls = d > 0 ? 'up' : d < 0 ? 'down' : '';
    return `<div class="kpi"><div class="label">${label}</div><div class="value">${fmt(v)}</div>
      <div class="delta ${cls}">${prev ? `前回比 ${signed(d)}${span > 1 ? `（${span}日分）` : ''}` : '前回データなし'}</div></div>`;
  }).join('');
  $('#snapMeta').textContent = `数値はすべて全期間の累計です。　最終記録: ${fmtDateTime(cur.capturedAt)}　／　noteの集計時刻: ${cur.statUpdatedAt ? fmtDateTime(cur.statUpdatedAt) : '–'}　／　記録日数: ${S.snapshots.length}日`;

  renderChart();
  renderGrowth(cur, prev, span);
}

function seriesData() {
  const val = (s) => (S.metric === 'follower' ? s.followerCount : s.totals[S.metric]);
  const snaps = S.snapshots.filter((s) => val(s) != null);
  if (S.mode === 'total') return snaps.map((s) => ({ date: s.date, value: val(s), span: 1 }));
  const out = [];
  for (let i = 1; i < snaps.length; i++) {
    out.push({ date: snaps[i].date, value: val(snaps[i]) - val(snaps[i - 1]), span: daysBetween(snaps[i - 1].date, snaps[i].date) });
  }
  return out;
}

function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

function renderChart() {
  const el = $('#chart');
  const data = seriesData();
  const label = METRIC_LABEL[S.metric];
  $('#chartTitle').textContent = `${label}の${S.mode === 'diff' ? '増えた数' : '累計'}`;
  const gaps = data.filter((d) => d.span > 1).length;
  $('#chartHint').textContent = S.mode === 'diff'
    ? `前回の記録からの増加数です。${gaps ? `記録していない日があった区間（${gaps}か所）は、数日分がまとめて1点（白抜きの点）になっています。` : ''}無料版では、使い始めた日から1日ずつ記録がたまっていきます。`
    : '';
  if (data.length < (S.mode === 'diff' ? 1 : 2)) {
    el.innerHTML = `<div class="nodata">${S.mode === 'diff' ? '2日分の記録がたまると、増えた数のグラフが表示されます。<br>明日以降、noteを開くと自動で記録されます。' : '2日分以上の記録がたまるとグラフが表示されます。'}</div>`;
    return;
  }

  const W = Math.max(el.clientWidth, 320), H = 280, m = { t: 12, r: 16, b: 28, l: 56 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const vals = data.map((d) => d.value);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(...vals));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const x = (i) => m.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
  const every = Math.ceil(data.length / Math.max(2, Math.floor(iw / 70)));
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join('');
  const showDots = data.length <= 60;

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}の推移">
    <g class="axis">${ticks.map((t) => `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('')}
      ${data.map((d, i) => (i % every === 0 || i === data.length - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${d.date.slice(5).replace('-', '/')}</text>` : '')).join('')}</g>
    ${y0 < 0 ? `<line class="baseline" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>` : ''}
    <path class="series" d="${path}"/>
    ${showDots ? data.map((d, i) => `<circle class="dot${d.span > 1 ? ' multi' : ''}" cx="${x(i)}" cy="${y(d.value)}" r="4"/>`).join('') : ''}
    <line class="cross" id="cross" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>
    ${data.map((d, i) => { const half = data.length === 1 ? iw / 2 : iw / (data.length - 1) / 2; return `<rect class="hit" data-i="${i}" x="${x(i) - half}" y="${m.t}" width="${half * 2}" height="${ih}"/>`; }).join('')}
  </svg>`;

  const tip = $('#tooltip'), cross = $('#cross', el);
  $$('.hit', el).forEach((r) => {
    r.addEventListener('mousemove', (ev) => {
      const d = data[+r.dataset.i];
      cross.setAttribute('x1', x(+r.dataset.i)); cross.setAttribute('x2', x(+r.dataset.i)); cross.setAttribute('visibility', 'visible');
      tip.innerHTML = `<div>${fmtDate(d.date)}${d.span > 1 ? `（${d.span}日分）` : ''}</div><div class="t-value">${S.mode === 'diff' ? signed(d.value) : fmt(d.value)}</div><div>${esc(label)}</div>`;
      tip.hidden = false;
      const tx = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8);
      tip.style.left = `${tx}px`; tip.style.top = `${ev.clientY - tip.offsetHeight - 10}px`;
    });
    r.addEventListener('mouseleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
  });
}

function renderGrowth(cur, prev, span) {
  const list = $('#growthList');
  if (!prev) { list.innerHTML = '<li class="meta">2日分の記録がたまると表示されます。</li>'; $('#growthMeta').textContent = ''; return; }
  $('#growthMeta').textContent = `${fmtDate(prev.date)} → ${fmtDate(cur.date)}${span > 1 ? `（${span}日分）` : ''}・PVの増加順`;
  const prevMap = new Map(prev.items.map((i) => [i.key, i]));
  const rows = cur.items.map((i) => ({ ...i, d: i.pv - ((prevMap.get(i.key) || {}).pv || 0), dl: i.like - ((prevMap.get(i.key) || {}).like || 0) }))
    .filter((i) => i.d > 0).sort((a, b) => b.d - a.d).slice(0, 10);
  list.innerHTML = rows.length
    ? rows.map((r) => `<li><span class="num">PV ${signed(r.d)}　スキ ${signed(r.dl)}</span><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></li>`).join('')
    : '<li class="meta">前回からPVが増えた記事はありません。</li>';
}

/* ---------------- 記事 ---------------- */
function renderArticles() {
  const cur = latest(), prev = previous();
  const tbody = $('#articleTable tbody');
  if (!cur) { tbody.innerHTML = ''; $('#articleCount').textContent = ''; return; }
  const prevMap = new Map((prev ? prev.items : []).map((i) => [i.key, i]));
  let rows = cur.items.map((i) => {
    const p = prevMap.get(i.key);
    return { ...i, dpv: p ? i.pv - p.pv : null, dlike: p ? i.like - p.like : null, ctr: i.imp ? i.pv / i.imp : null, likeRate: i.pv ? i.like / i.pv : null };
  });
  const q = S.search.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.title.toLowerCase().includes(q));
  const { key, dir } = S.sort;
  rows.sort((a, b) => {
    const va = a[key], vb = b[key];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * dir;
  });
  $('#articleCount').textContent = `${rows.length}件（${fmtDate(cur.date)} 時点）`;
  $$('#articleTable th').forEach((th) => th.setAttribute('aria-sort', th.dataset.sort === key ? (dir > 0 ? 'ascending' : 'descending') : 'none'));
  const dcell = (v) => `<td class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v == null ? '–' : signed(v)}</td>`;
  tbody.innerHTML = rows.map((r) => `<tr>
    <td class="l"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></td>
    <td>${fmtDate(r.publishedAt)}</td><td>${fmt(r.imp)}</td><td>${fmt(r.pv)}</td>${dcell(r.dpv)}
    <td>${fmt(r.like)}</td>${dcell(r.dlike)}<td>${fmt(r.comment)}</td><td>${pct(r.ctr)}</td><td>${pct(r.likeRate)}</td></tr>`).join('');
}

/* ---------------- コメント ---------------- */
function renderComments() {
  const showDismissed = $('#showDismissed').checked;
  const groups = S.unreplied
    .map((u) => ({ ...u, items: (u.pending || []).filter((c) => showDismissed || !S.dismissed[c.commentKey]) }))
    .filter((u) => u.items.length)
    .sort((a, b) => maxDate(b.items) .localeCompare(maxDate(a.items)));
  const activeRoots = S.unreplied.reduce((a, u) => a + (u.pending || []).filter((c) => !S.dismissed[c.commentKey]).length, 0);
  const threads = S.threadReplies.filter((t) => showDismissed || !S.dismissed[`thr:${t.id}`]);
  const activeThreads = S.threadReplies.filter((t) => !S.dismissed[`thr:${t.id}`]).length;
  const active = activeRoots + activeThreads;
  const badge = $('#unrepliedBadge');
  badge.hidden = !active; badge.textContent = active;
  const lastCheck = S.unreplied.reduce((a, u) => Math.max(a, u.checkedAt || 0), 0);
  const cur = latest();
  const withComments = cur ? cur.items.filter((i) => i.comment > 0).length : 0;
  const checkedN = cur ? cur.items.filter((i) => i.comment > 0 && S.unreplied.some((u) => u.noteKey === i.key)).length : 0;
  $('#unrepliedMeta').textContent = `${active}件・コメントのある${withComments}記事のうち${checkedN}記事を確認済み${S.commentCheckIncomplete ? '（残りは次にnoteを開いたときに確認）' : ''}${lastCheck ? `・最終確認 ${fmtDateTime(new Date(lastCheck).toISOString())}` : ''}`;
  $('#threadList').innerHTML = threads.length ? threads.map((t) => `<div class="item ${S.dismissed[`thr:${t.id}`] ? 'dismissed' : ''}">
      <div class="body"><div class="who">${esc(t.by)}・${fmtDateTime(t.at)}</div>
      <p class="text"><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.title)}</a> で、あなたの返信にさらに返信が来ています</p></div>
      <button class="btn small" data-dismiss="thr:${esc(t.id)}">${S.dismissed[`thr:${t.id}`] ? '未対応に戻す' : '確認済み'}</button></div>`).join('')
    : '<p class="meta">ありません。</p>';
  $('#unrepliedList').innerHTML = groups.length ? groups.map((g) => `<div class="group">
      <div class="group-title"><a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.title)}</a></div>
      ${g.items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map((c) => `<div class="item ${S.dismissed[c.commentKey] ? 'dismissed' : ''}">
        <div class="body"><div class="who">${esc(c.by)}・${fmtDateTime(c.createdAt)}${c.creatorLiked ? '<span class="tag">スキ済み</span>' : ''}${c.likeCount ? `<span class="tag">スキ ${fmt(c.likeCount)}</span>` : ''}</div>
        <p class="text">${esc(c.excerpt)}</p></div>
        <button class="btn small" data-dismiss="${esc(c.commentKey)}">${S.dismissed[c.commentKey] ? '未対応に戻す' : '対応済み'}</button>
      </div>`).join('')}</div>`).join('')
    : `<p class="meta">${S.unreplied.length ? '未返信のコメントはありません。' : 'まだ確認していません。noteを開くと自動で確認します。'}</p>`;

  // 自分のコメント：記事ごとにまとめる
  const byNote = new Map();
  for (const c of S.myComments) {
    const g = byNote.get(c.noteKey) || { noteKey: c.noteKey, title: '', url: '', author: '', comments: [], activity: [], last: '' };
    g.title = g.title || c.noteTitle; g.url = g.url || c.noteUrl; g.author = g.author || c.author;
    if (c.commentKey) g.comments.push(c);
    g.activity.push(...(c.activity || []));
    const la = c.lastActivityAt || c.createdAt || '';
    if (la > g.last) g.last = la;
    byNote.set(c.noteKey, g);
  }
  const notes = [...byNote.values()].sort((a, b) => b.last.localeCompare(a.last));
  $('#myCommentsMeta').textContent = `${notes.length}記事`;
  $('#myCommentsList').innerHTML = notes.length ? notes.map((g) => {
    const replies = g.activity.filter((a) => a.kind === 'reply').length;
    const likes = g.activity.filter((a) => a.kind === 'like').length;
    return `<div class="group">
      <div class="group-title"><a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.title || g.url)}</a> <span class="meta">@${esc(g.author)}</span></div>
      <div class="who" style="padding-left:12px">${g.last ? `最近の動き: ${fmtDateTime(g.last)}` : ''}${replies ? `<span class="tag">返信 ${replies}</span>` : ''}${likes ? `<span class="tag">スキ ${likes}</span>` : ''}</div>
      ${g.comments.map((c) => `<div class="item"><div class="body"><div class="who">${fmtDateTime(c.createdAt)}${c.replyCount ? `<span class="tag">返信 ${c.replyCount}件</span>` : ''}${c.creatorReplied ? '<span class="tag">著者が返信</span>' : ''}</div><p class="text">${esc(c.excerpt)}</p></div></div>`).join('')}
      ${!g.comments.length ? '<div class="item"><div class="body"><p class="text meta">コメント本文は、この記事を開くと記録されます。</p></div></div>' : ''}
    </div>`;
  }).join('') : '<p class="meta">まだ記録がありません。</p>';
}
const maxDate = (items) => items.reduce((a, c) => ((c.createdAt || '') > a ? c.createdAt : a), '');

/* ---------------- データ・設定 ---------------- */
function renderData() {
  $$('[data-setting]').forEach((cb) => { cb.checked = !!S.settings[cb.dataset.setting]; });
  $('#logList').innerHTML = S.logs.slice().reverse().slice(0, 100)
    .map((l) => `<li class="${l.level === 'error' ? 'error' : ''}">${fmtDateTime(new Date(l.at).toISOString())}　${esc(l.message)}</li>`).join('') || '<li>ログはまだありません。</li>';
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then((e) => { $('#storageInfo').textContent = `（現在の使用量: 約${(e.usage / 1024 / 1024).toFixed(1)}MB）`; });
  }
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
const HEAD = ['記録日', 'noteの集計時刻', '記事キー', 'タイトル', 'URL', '公開日時', 'インプレッション', 'PV', 'スキ', 'コメント', '売上'];
const snapRows = (s) => s.items.map((i) => [s.date, s.statUpdatedAt || '', i.key, i.title, i.url, i.publishedAt, i.imp, i.pv, i.like, i.comment, i.sales]);

const ACTIONS = {
  'run-now': async (btn) => {
    btn.disabled = true;
    $('#runStatus').textContent = '取得を依頼しました…';
    const r = await chrome.runtime.sendMessage({ type: 'RUN_NOW' });
    $('#runStatus').textContent = r && r.ok ? (r.via === 'new-tab' ? 'noteを裏で開いて取得しています。完了まで数十秒かかります。' : 'noteのタブで取得しています。') : `失敗しました: ${r && r.error}`;
    setTimeout(() => { btn.disabled = false; load(); }, 15000);
  },
  'csv-latest': () => { const s = latest(); if (!s) return alert('データがありません。'); download(`note-stats-${s.date}.csv`, toCsv([HEAD, ...snapRows(s)]), 'text/csv'); },
  'csv-all': () => { if (!S.snapshots.length) return alert('データがありません。'); download(`note-stats-all-${latest().date}.csv`, toCsv([HEAD, ...S.snapshots.flatMap(snapRows)]), 'text/csv'); },
  'json-backup': async () => {
    const dump = { app: 'note-data-notebook', version: 1, exportedAt: new Date().toISOString(), stores: {} };
    for (const st of ['snapshots', 'unreplied', 'myComments']) dump.stores[st] = await NDB.getAll(st);
    dump.kv = { me: S.me, settings: S.settings, dismissed: S.dismissed };
    download(`note-data-notebook-backup-${jstDate()}.json`, JSON.stringify(dump), 'application/json');
  },
  wipe: async () => {
    if (!confirm('保存したデータをすべて削除します。元に戻せません。先にバックアップを保存しましたか？')) return;
    for (const st of NDB.STORES) await NDB.clear(st);
    await chrome.runtime.sendMessage({ type: 'REFRESH_BADGE' });
    load();
  },
};

async function importBackup(file) {
  try {
    const dump = JSON.parse(await file.text());
    if (dump.app !== 'note-data-notebook' || !dump.stores) throw new Error('このツールのバックアップファイルではありません。');
    if (!confirm(`バックアップ（${fmtDateTime(dump.exportedAt)} 作成）を読み込みます。同じ日付のデータは上書きされ、それ以外は残ります。よろしいですか？`)) return;
    for (const st of ['snapshots', 'unreplied', 'myComments']) if (Array.isArray(dump.stores[st])) await NDB.putMany(st, dump.stores[st]);
    if (dump.kv) {
      if (dump.kv.dismissed) await NDB.kvSet('dismissed', { ...(await NDB.kvGet('dismissed', {})), ...dump.kv.dismissed });
      if (dump.kv.settings) await NDB.kvSet('settings', dump.kv.settings);
      if (dump.kv.me && !S.me) await NDB.kvSet('me', dump.kv.me);
    }
    await chrome.runtime.sendMessage({ type: 'REFRESH_BADGE' });
    alert('復元しました。');
    load();
  } catch (e) {
    alert(`復元に失敗しました: ${e.message}`);
  }
}

/* ---------------- イベント ---------------- */
function bind() {
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $$('.tab').forEach((t) => { t.hidden = t.id !== `tab-${b.dataset.tab}`; });
    if (b.dataset.tab === 'overview') renderChart();
    history.replaceState(null, '', `#${b.dataset.tab}`);
  }));
  $('#metricSel').addEventListener('change', (e) => { S.metric = e.target.value; renderChart(); });
  $$('.seg button').forEach((b) => b.addEventListener('click', () => {
    S.mode = b.dataset.mode;
    $$('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderChart();
  }));
  $$('#articleTable th').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : (k === 'title' ? 1 : -1) };
    renderArticles();
  }));
  $('#articleSearch').addEventListener('input', (e) => { S.search = e.target.value; renderArticles(); });
  $('#showDismissed').addEventListener('change', renderComments);
  $('#tab-comments').addEventListener('click', async (e) => {
    const k = e.target.dataset.dismiss;
    if (!k) return;
    if (S.dismissed[k]) delete S.dismissed[k]; else S.dismissed[k] = Date.now();
    await NDB.kvSet('dismissed', S.dismissed);
    await chrome.runtime.sendMessage({ type: 'REFRESH_BADGE' });
    renderComments();
  });
  $$('[data-setting]').forEach((cb) => cb.addEventListener('change', async () => {
    S.settings[cb.dataset.setting] = cb.checked;
    await NDB.kvSet('settings', S.settings);
  }));
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (b && ACTIONS[b.dataset.action]) ACTIONS[b.dataset.action](b);
  });
  $('#importFile').addEventListener('change', (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderChart, 150); });

  const initial = location.hash.slice(1);
  const tabBtn = $(`.tabs button[data-tab="${initial}"]`);
  if (tabBtn) tabBtn.click();
}

bind();
load();
