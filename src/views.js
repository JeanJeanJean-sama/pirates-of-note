/* ============================================================
 * views.js — 記事カード / マップ / 未返信コメントの即時再確認
 * dashboard.js の後に読み込む（S, $, fmt などを共有）
 * ============================================================ */
'use strict';

const V = { view: 'cards', stage: 'entry', order: 'new', map: 'a', shown: 40, trendOpen: new Set(), recheckAt: 0, rechecking: false };
const RECENT_DAYS = 30;

/* ---------- 共通 ---------- */
function median(arr) {
  const a = arr.filter((v) => v != null && Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
const logPct = (v, max) => (max > 0 ? Math.max(0, Math.min(100, (Math.log10((v || 0) + 1) / Math.log10(max + 1)) * 100)) : 0);

function articleRows() {
  const cur = latest(), prev = previous();
  if (!cur) return [];
  const prevMap = new Map((prev ? prev.items : []).map((i) => [i.key, i]));
  return cur.items.map((i) => {
    const p = prevMap.get(i.key);
    return {
      ...i,
      dimp: p ? i.imp - p.imp : null, dpv: p ? i.pv - p.pv : null, dlike: p ? i.like - p.like : null, dcomment: p ? i.comment - p.comment : null,
      ctr: i.imp ? i.pv / i.imp : null, likeRate: i.pv ? i.like / i.pv : null,
    };
  });
}

/* ---------- 記事カード ---------- */
function renderCards() {
  const list = $('#cardList');
  if (!list) return;
  $('#cardList').hidden = V.view !== 'cards';
  $('#cardsHint').hidden = V.view !== 'cards';
  $('#tableWrap').hidden = V.view !== 'table';
  $('#stageSeg').hidden = V.view !== 'cards';
  $('#orderSeg').hidden = V.view !== 'cards';
  if (V.view !== 'cards') { $('#cardMore').hidden = true; return; }

  let rows = articleRows();
  if (!rows.length) { list.innerHTML = '<p class="meta">まだデータがありません。</p>'; $('#cardMore').hidden = true; return; }
  const entry = V.stage === 'entry';
  const [m1, m2] = entry ? ['imp', 'pv'] : ['pv', 'like'];
  const max1 = Math.max(...rows.map((r) => r[m1])), max2 = Math.max(...rows.map((r) => r[m2]));
  const med1 = median(rows.map((r) => r[m1])), med2 = median(rows.map((r) => r[m2]));
  const rateKey = entry ? 'ctr' : 'likeRate';
  const medRate = median(rows.map((r) => r[rateKey]));

  const q = S.search.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.title.toLowerCase().includes(q));
  const deltaKey = entry ? 'dpv' : 'dlike';
  const sorters = {
    new: (a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''),
    delta: (a, b) => (b[deltaKey] ?? -1) - (a[deltaKey] ?? -1),
    pv: (a, b) => b.pv - a.pv,
    rate: (a, b) => (b[rateKey] ?? -1) - (a[rateKey] ?? -1),
  };
  rows.sort(sorters[V.order]);
  $('#articleCount').textContent = `${rows.length}本の記事`;
  const noPrev = !previous();

  const bar = (label, cls, v, max, med, d) => `
    <div class="mrow"><span class="mlabel">${label}</span>
      <span class="mbar"><span class="fill ${cls}" style="width:${logPct(v, max).toFixed(1)}%"></span><span class="med" style="left:${logPct(med, max).toFixed(1)}%" title="中央値 ${fmt(Math.round(med))}"></span></span>
      <span class="mval">${fmt(v)}</span><span class="mdelta ${d > 0 ? 'up' : ''}">${d == null ? '–' : signed(d)}</span></div>`;

  const shown = rows.slice(0, V.shown);
  list.innerHTML = (noPrev ? '<p class="meta">前回との差は、2日目の記録から表示されます。</p>' : '') + shown.map((r) => {
    const rate = r[rateKey];
    const rateCls = rate == null ? '' : rate >= medRate ? 'up' : '';
    return `<article class="acard" data-key="${esc(r.key)}">
      <div class="ahead"><a class="atitle" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>
        <div class="ameta">${fmtDate(r.publishedAt)}　<a href="${esc(r.url)}" target="_blank" rel="noopener">noteで開く ↗</a></div></div>
      ${bar(entry ? 'IMP' : 'PV', entry ? 'c-imp' : 'c-pv', r[m1], max1, med1, r[entry ? 'dimp' : 'dpv'])}
      ${bar(entry ? 'PV' : 'スキ', entry ? 'c-pv' : 'c-like', r[m2], max2, med2, r[entry ? 'dpv' : 'dlike'])}
      ${entry ? '' : `<div class="mrow"><span class="mlabel">コメント</span><span class="mbar none"></span><span class="mval">${fmt(r.comment)}</span><span class="mdelta">${r.dcomment == null ? '–' : signed(r.dcomment)}</span></div>`}
      <div class="afoot"><span class="rate"><span class="rlabel">${entry ? '開封率' : 'スキ率'}</span><span class="rvalue ${rateCls}">${pct(rate)}</span><span class="meta">中央値 ${pct(medRate)}</span></span>
        <span class="btn-row">${self.PON_ENV === 'web' && !(window.PonBodies && window.PonBodies.has(r.key)) ? '' : `<button class="btn small dl" data-body-dl="${esc(r.key)}" title="この記事の本文を、パソコンの「ダウンロード」フォルダにCSVファイルで保存します">⬇ 本文をダウンロード（CSV）</button>`}
        <button class="btn small" data-trend="${esc(r.key)}">${V.trendOpen.has(r.key) ? '推移を閉じる' : '推移を見る →'}</button></span></div>
      ${V.trendOpen.has(r.key) ? `<div class="atrend">${trendSvg(r.key, entry ? 'pv' : 'like')}</div>` : ''}
    </article>`;
  }).join('');
  $('#cardMore').hidden = rows.length <= V.shown;
}

/** 記事ごとの推移（記録ごとの増えた数） */
function trendSvg(key, metric) {
  const pts = [];
  for (let i = 1; i < S.snapshots.length; i++) {
    const a = S.snapshots[i - 1].items.find((x) => x.key === key);
    const b = S.snapshots[i].items.find((x) => x.key === key);
    if (a && b) pts.push({ date: S.snapshots[i].date, v: b[metric] - a[metric] });
  }
  const label = metric === 'pv' ? 'PV' : 'スキ';
  if (pts.length < 1) return `<p class="meta">2日分の記録がたまると、この記事の${label}の増え方が表示されます。</p>`;
  const W = 560, H = 120, m = { l: 36, r: 8, t: 8, b: 20 };
  const max = Math.max(1, ...pts.map((p) => p.v));
  const bw = Math.max(2, Math.min(24, (W - m.l - m.r) / pts.length - 3));
  const x = (i) => m.l + (i + 0.5) * ((W - m.l - m.r) / pts.length);
  const y = (v) => m.t + (H - m.t - m.b) * (1 - Math.max(0, v) / max);
  return `<svg viewBox="0 0 ${W} ${H}" class="mini" role="img" aria-label="${label}の増えた数の推移">
    <line class="baseline" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>
    <text class="axis-t" x="${m.l - 6}" y="${y(max) + 4}" text-anchor="end">${fmt(max)}</text><text class="axis-t" x="${m.l - 6}" y="${y(0) + 4}" text-anchor="end">0</text>
    ${pts.map((p, i) => `<rect class="mbar-fill ${metric === 'like' ? 'like' : ''}" x="${(x(i) - bw / 2).toFixed(1)}" y="${y(p.v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, y(0) - y(p.v)).toFixed(1)}" rx="2"><title>${p.date}：${signed(p.v)}</title></rect>`).join('')}
    <text class="axis-t" x="${x(0)}" y="${H - 4}" text-anchor="middle">${pts[0].date.slice(5).replace('-', '/')}</text>
    ${pts.length > 1 ? `<text class="axis-t" x="${x(pts.length - 1)}" y="${H - 4}" text-anchor="middle">${pts[pts.length - 1].date.slice(5).replace('-', '/')}</text>` : ''}
  </svg><p class="meta">記録ごとの${label}の増えた数</p>`;
}

/* ---------- マップ（散布図・両対数） ---------- */
function logTicks(min, max) {
  const out = [];
  for (let e = Math.floor(Math.log10(Math.max(1, min))); e <= Math.ceil(Math.log10(max)); e++) {
    for (const k of [1, 2, 5]) { const v = k * 10 ** e; if (v >= min && v <= max) out.push(v); }
  }
  return out;
}

function renderMap() {
  const el = $('#mapChart');
  if (!el) return;
  const rows = articleRows();
  const isA = V.map === 'a';
  const [xk, yk] = isA ? ['imp', 'pv'] : ['pv', 'like'];
  const [xl, yl] = isA ? ['インプレッション', 'PV'] : ['PV', 'スキ'];
  const pts = rows.filter((r) => r[xk] > 0 && r[yk] > 0);
  $('#mapHint').textContent = `全記事の中で、それぞれの記事がどの位置にいるかを見ます（両対数目盛）。右上ほど${isA ? '見られて読まれた' : '読まれてスキされた'}記事です。点線は${isA ? '開封率' : 'スキ率'}の目安です。点にマウスを重ねると記事名、クリックすると記事を開きます。`;
  if (pts.length < 2) { el.innerHTML = '<div class="nodata">表示できる記事がまだありません。</div>'; $('#mapLegend').innerHTML = ''; return; }

  const cutoff = Date.now() - RECENT_DAYS * 864e5;
  const W = Math.max(el.clientWidth, 360), H = Math.min(560, Math.max(360, W * 0.62)), m = { t: 16, r: 20, b: 44, l: 64 };
  const xs = pts.map((p) => p[xk]), ys = pts.map((p) => p[yk]);
  const x0 = 10 ** Math.floor(Math.log10(Math.min(...xs))), x1 = 10 ** Math.ceil(Math.log10(Math.max(...xs) * 1.05));
  const y0 = 10 ** Math.floor(Math.log10(Math.min(...ys))), y1 = 10 ** Math.ceil(Math.log10(Math.max(...ys) * 1.05));
  const lx = (v) => m.l + ((Math.log10(v) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0))) * (W - m.l - m.r);
  const ly = (v) => m.t + (1 - (Math.log10(v) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0))) * (H - m.t - m.b);
  const guides = (isA ? [0.02, 0.05, 0.1, 0.2] : [0.1, 0.2, 0.5]).map((r) => {
    // y = r * x を、表示範囲内で描く
    const xa = Math.max(x0, y0 / r), xb = Math.min(x1, y1 / r);
    if (xa >= xb) return '';
    return `<line class="guide" x1="${lx(xa)}" y1="${ly(xa * r)}" x2="${lx(xb)}" y2="${ly(xb * r)}"/><text class="guide-t" x="${lx(xb) - 4}" y="${ly(xb * r) + 12}" text-anchor="end">${Math.round(r * 100)}%</text>`;
  }).join('');
  const xt = logTicks(x0, x1), yt = logTicks(y0, y1);
  const order = [...pts].sort((a, b) => (new Date(a.publishedAt) >= cutoff) - (new Date(b.publishedAt) >= cutoff)); // 直近を上に描く

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${xl}と${yl}の散布図">
    <g class="axis">${yt.map((t) => `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${ly(t)}" y2="${ly(t)}"/><text x="${m.l - 8}" y="${ly(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('')}
      ${xt.map((t) => `<text x="${lx(t)}" y="${H - m.b + 18}" text-anchor="middle">${fmt(t)}</text>`).join('')}
      <line class="baseline" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>
      <text x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle">${xl}</text>
      <text x="14" y="${(m.t + H - m.b) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(m.t + H - m.b) / 2})">${yl}</text></g>
    ${guides}
    ${order.map((p) => { const recent = new Date(p.publishedAt) >= cutoff; return `<circle class="pt ${recent ? 'recent' : 'past'}" data-key="${esc(p.key)}" cx="${lx(p[xk]).toFixed(1)}" cy="${ly(p[yk]).toFixed(1)}" r="${recent ? 6 : 5}"/>`; }).join('')}
  </svg>`;
  const nRecent = pts.filter((p) => new Date(p.publishedAt) >= cutoff).length;
  $('#mapLegend').innerHTML = `<span class="lg"><span class="sw recent"></span>直近${RECENT_DAYS}日に公開（${nRecent}本）</span><span class="lg"><span class="sw past"></span>それ以前（${pts.length - nRecent}本）</span>`;

  const byKey = new Map(pts.map((p) => [p.key, p]));
  const tip = $('#tooltip');
  $$('.pt', el).forEach((c) => {
    c.addEventListener('mousemove', (ev) => {
      const p = byKey.get(c.dataset.key);
      tip.innerHTML = `<div><b>${esc(p.title)}</b></div><div>${fmtDate(p.publishedAt)}</div><div>${xl} ${fmt(p[xk])} → ${yl} ${fmt(p[yk])}</div><div>${isA ? '開封率' : 'スキ率'} <b>${pct(p[yk] / p[xk])}</b></div>`;
      tip.hidden = false;
      tip.style.left = `${Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8)}px`;
      tip.style.top = `${Math.max(8, ev.clientY - tip.offsetHeight - 10)}px`;
    });
    c.addEventListener('mouseleave', () => { tip.hidden = true; });
    c.addEventListener('click', () => { const p = byKey.get(c.dataset.key); if (p && p.url) window.open(p.url, '_blank', 'noopener'); });
  });
}

/* ---------- 未返信コメントの即時再確認 ----------
 * コメント一覧はログインなしでも見られる公開情報なので、ダッシュボードから直接確認する。
 * 対象は「未返信が残っている記事」だけ。1秒以上の間隔をあける。 */
async function recheckUnreplied({ force = false } = {}) {
  if (self.PON_ENV === 'web') return; // Web版はブラウザの制限で note に直接アクセスできない（記録時に更新）
  if (V.rechecking || !S.me) return;
  if (!force && Date.now() - V.recheckAt < 20000) return;
  const targets = S.unreplied.filter((u) => (u.pending || []).some((c) => !S.dismissed[c.commentKey]));
  if (!targets.length) return;
  V.rechecking = true; V.recheckAt = Date.now();
  const meta = $('#unrepliedMeta');
  let changed = 0;
  try {
    for (let i = 0; i < targets.length; i++) {
      const u = targets[i];
      if (meta) meta.textContent = `確認し直しています…（${i + 1}/${targets.length}）`;
      if (i > 0) await new Promise((r) => setTimeout(r, 1100));
      const roots = [];
      for (let page = 1; page && page <= 10;) {
        const res = await fetch(`https://note.com/api/v3/notes/${u.noteKey}/note_comments?page=${page}`, { credentials: 'omit', headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        roots.push(...(j.data || []));
        page = j.next_page || null;
        if (page) await new Promise((r) => setTimeout(r, 1100));
      }
      const pendingKeys = new Set(roots.filter((c) => c.user && c.user.urlname !== S.me.urlname && c.is_creator_replied === false && !c.is_blocked).map((c) => c.key));
      const before = u.pending.length;
      const keep = u.pending.filter((c) => pendingKeys.has(c.commentKey));
      if (keep.length !== before) {
        changed += before - keep.length;
        await NDB.put('unreplied', { ...u, pending: keep, checkedAt: Date.now() });
      }
    }
  } catch (e) {
    chrome.runtime.sendMessage({ type: 'LOG', payload: { level: 'warn', message: `未返信コメントの再確認に失敗: ${e.message}` } }).catch(() => {});
  } finally {
    V.rechecking = false;
  }
  await chrome.runtime.sendMessage({ type: 'REFRESH_BADGE' }).catch(() => {});
  S.unreplied = await NDB.getAll('unreplied');
  renderComments();
  if (changed && meta) meta.textContent += `　（返信済みになった ${changed}件を外しました）`;
}

/* ---------- イベント ---------- */
function bindViews() {
  const segBind = (sel, attr, key, after) => $$(`${sel} button`).forEach((b) => b.addEventListener('click', () => {
    V[key] = b.dataset[attr];
    $$(`${sel} button`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    after();
  }));
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => {
    V.view = b.dataset.view;
    $$('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderCards();
  }));
  segBind('#stageSeg', 'stage', 'stage', () => { V.shown = 40; renderCards(); });
  segBind('#orderSeg', 'order', 'order', () => { V.shown = 40; renderCards(); });
  segBind('#mapSeg', 'map', 'map', renderMap);
  $('#articleSearch').addEventListener('input', () => { V.shown = 40; renderCards(); });
  $('#cardList').addEventListener('click', (e) => {
    const k = e.target.dataset && e.target.dataset.trend;
    if (!k) return;
    if (V.trendOpen.has(k)) V.trendOpen.delete(k); else V.trendOpen.add(k);
    renderCards();
  });
  ACTIONS['more-cards'] = () => { V.shown += 40; renderCards(); };
  ACTIONS.recheck = () => recheckUnreplied({ force: true });
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tab === 'map') renderMap();
    if (b.dataset.tab === 'comments') recheckUnreplied();
  }));
  // noteで返信してダッシュボードに戻ってきたときに自動で確認し直す
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !$('#tab-comments').hidden) recheckUnreplied();
  });
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (!$('#tab-map').hidden) renderMap(); }, 150); });
}

window.PonViews = {
  refreshCards() { renderCards(); },
  render() { renderCards(); if (!$('#tab-map').hidden) renderMap(); if (!$('#tab-comments').hidden) recheckUnreplied(); },
};
bindViews();
