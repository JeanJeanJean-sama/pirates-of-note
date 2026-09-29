/* ============================================================
 * periods.js — 期間の選び方と「期間ごとの伸び」の計算（v0.6.0）
 * 計算の部分（PonPeriods.calc）は画面に依存しない（テストで直接呼べる）。
 * 画面の部分は dashboard.js の後に読み込む（S, $, fmt などを共有）。
 *
 * 区切りの伸び ＝「区切りの最終日以前で最後の記録」−「区切りの開始日の前日以前で最後の記録」
 *  ・区切りの前に記録がなければ「記録なし」
 *  ・その期間に公開された記事は 0 から数える
 *  ・記録が抜けた日があると伸びが後ろの日にまとまるので、抜けた日数を数えて知らせる
 * ============================================================ */
'use strict';

const PonPeriods = (() => {
  /* ---------- 日付（'YYYY-MM-DD'、日本時間の日付として扱う） ---------- */
  const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const diffDays = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);
  /** 公開日時（ISO）を日本時間の日付にする */
  const jstDay = (iso) => { const t = new Date(iso); return Number.isNaN(t.getTime()) ? '' : new Date(t.getTime() + 9 * 3600e3).toISOString().slice(0, 10); };
  const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

  /** date 以前で最後の記録（snaps は日付の古い順） */
  function lastOnOrBefore(snaps, date) {
    let lo = 0, hi = snaps.length - 1, ans = null;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (snaps[m].date <= date) { ans = snaps[m]; lo = m + 1; } else hi = m - 1; }
    return ans;
  }

  const METRICS = ['pv', 'like', 'comment', 'imp'];

  /**
   * start〜end（両端を含む）の伸び。
   * opts.fallbackFirst … 区切りの前に記録がないとき、期間内の最初の記録からの伸びで代わりに出す（一覧用）
   * 戻り値 status: 'ok' | 'nobase'（区切りの前に記録なし）| 'norecord'（期間中に記録なし）
   */
  function growth(snaps, start, end, opts = {}) {
    const res = { start, end, status: 'ok', missingDays: 0, spillDays: 0, base: null, cur: null, totals: null, items: new Map(), fallback: false };
    const cur = lastOnOrBefore(snaps, end);
    let base = lastOnOrBefore(snaps, addDays(start, -1));
    if (!cur || cur.date < start) { res.status = 'norecord'; return res; }
    if (!base) {
      if (!opts.fallbackFirst) { res.status = 'nobase'; return res; }
      base = snaps.find((s) => s.date >= start && s.date < cur.date) || null;
      if (!base) { res.status = 'nobase'; return res; }
      res.fallback = true;
    }
    res.base = base; res.cur = cur;
    // 抜けた日：期間内で記録のない日（まだ来ていない日は数えない）
    const have = new Set(snaps.filter((s) => s.date >= start && s.date <= end).map((s) => s.date));
    const lastRecord = snaps[snaps.length - 1].date;
    const upto = end < lastRecord ? end : lastRecord;
    const from = res.fallback ? addDays(base.date, 1) : start;
    for (let d = from; d <= upto; d = addDays(d, 1)) if (!have.has(d)) res.missingDays++;
    // 前の区切りの分が入り込んでいる日数（開始日の前日に記録がないとき）
    if (!res.fallback) res.spillDays = diffDays(base.date, addDays(start, -1));

    const t = (s, k) => (k === 'follower' ? s.followerCount : s.totals && s.totals[k]);
    res.totals = {};
    for (const k of [...METRICS, 'follower']) {
      const a = t(cur, k), b = t(base, k);
      res.totals[k] = a != null && b != null ? a - b : null;
    }
    const baseMap = new Map((base.items || []).map((i) => [i.key, i]));
    for (const i of cur.items || []) {
      const b = baseMap.get(i.key);
      const pub = jstDay(i.publishedAt);
      if (b) res.items.set(i.key, { key: i.key, d: Object.fromEntries(METRICS.map((k) => [k, (i[k] || 0) - (b[k] || 0)])), isNew: false });
      else if (pub && pub > base.date) res.items.set(i.key, { key: i.key, d: Object.fromEntries(METRICS.map((k) => [k, i[k] || 0])), isNew: true });
      else res.items.set(i.key, { key: i.key, d: null, isNew: false }); // 前の記録に無い古い記事（非公開だった等）は分からない
    }
    return res;
  }

  /**
   * 期間の選び方 → 実際の開始日・終了日
   * sel: { kind: 'prev' | '7' | '28' | 'custom', start, end }
   * back: いくつ前の期間か（0 = 最新。← で1つずつ増える）
   * 終了日は「最後の記録の日」まで（それより先は記録がないため）
   * 戻り値 null = その期間は無い（記録を始める前）
   */
  function resolve(snaps, sel, back = 0) {
    if (!snaps.length) return null;
    const first = snaps[0].date, lastDate = snaps[snaps.length - 1].date;
    const kind = (sel && sel.kind) || 'prev';
    if (kind === 'prev') {
      const i = snaps.length - 1 - back;
      if (snaps.length < 2) return back ? null : { kind, start: lastDate, end: lastDate, len: 1, back };
      if (i < 1 || i > snaps.length - 1) return null;
      const p = snaps[i - 1].date;
      return { kind, start: addDays(p, 1), end: snaps[i].date, len: diffDays(p, snaps[i].date), back };
    }
    if (kind === 'month') {
      // カレンダーの月。back=0 は最後の記録がある月（途中なら最後の記録の日まで）
      if (back < 0) return null;
      const [y, m] = lastDate.split('-').map(Number);
      const t = new Date(Date.UTC(y, m - 1 - back, 1));
      const ms = t.toISOString().slice(0, 10);
      const me = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      if (me < first) return null;
      const e2 = me > lastDate ? lastDate : me;
      return { kind, start: ms, end: e2, monthEnd: me, len: diffDays(ms, me) + 1, partial: e2 < me, back, ym: ms.slice(0, 7) };
    }
    let s, e, cut = false;
    if (kind === 'custom') {
      s = isDay(sel.start) ? sel.start : addDays(lastDate, -6);
      e = isDay(sel.end) ? sel.end : lastDate;
      if (s > e) [s, e] = [e, s];
      if (e > lastDate) { e = lastDate; cut = true; }
      if (s > e) s = e;
    } else {
      const n = Number(kind) || 7;
      e = lastDate; s = addDays(lastDate, -(n - 1));
    }
    const len = diffDays(s, e) + 1;
    if (back) { s = addDays(s, -len * back); e = addDays(e, -len * back); }
    if (e < first || e > lastDate) return null;
    return { kind, start: s, end: e, len, cut: cut && !back, back };
  }

  /** 1つ前の同じ長さの期間 */
  const before = (snaps, sel, back = 0) => resolve(snaps, sel, back + 1);

  /** 月ごとで今の月が途中のとき：先月の「同じ日まで」（例：9/1〜9/29 なら 8/1〜8/29） */
  function sameDays(snaps, sel, back = 0) {
    const r = resolve(snaps, sel, back), pr = before(snaps, sel, back);
    if (!r || !pr || r.kind !== 'month' || !r.partial) return null;
    const n = diffDays(r.start, r.end);
    const e = addDays(pr.start, n);
    return { ...pr, end: e > pr.monthEnd ? pr.monthEnd : e, partial: true };
  }

  /**
   * 選んだ期間と、それより前の同じ長さの区切り（新しい順・最大 max 個）
   * 「前回」のときは、記録と記録のあいだを1区切りとして並べる
   */
  function buckets(snaps, sel, max = 8, back = 0) {
    const out = [];
    for (let k = 0; k < max; k++) {
      const r = resolve(snaps, sel, back + k);
      if (!r) {
        if (k === 0 || (sel && sel.kind === 'prev')) break;
        break;
      }
      out.push(Object.assign(growth(snaps, r.start, r.end), { kind: r.kind, monthEnd: r.monthEnd, partial: r.partial }));
    }
    return out;
  }

  /** 期間中に公開した記事の数（最後の記録の記事一覧から数える＝記録が抜けても数えられる） */
  function publishedIn(snaps, start, end) {
    const last = snaps[snaps.length - 1];
    if (!last) return [];
    return (last.items || []).filter((i) => { const d = jstDay(i.publishedAt); return d && d >= start && d <= end; });
  }

  /**
   * 日ごとの伸び（start〜end の各日）。その日の記録と、その前の記録の差。
   * 記録のない日は null。前の記録が2日以上前なら span にその日数（数日分がまとまっている）
   */
  function daily(snaps, start, end) {
    const byDate = new Map(snaps.map((s, i) => [s.date, i]));
    const out = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const i = byDate.get(d);
      if (i == null || i === 0) { out.push({ date: d, v: null, span: 0 }); continue; }
      const a = snaps[i], b = snaps[i - 1];
      const v = {};
      for (const k of METRICS) v[k] = a.totals && b.totals && a.totals[k] != null && b.totals[k] != null ? a.totals[k] - b.totals[k] : null;
      v.follower = a.followerCount != null && b.followerCount != null ? a.followerCount - b.followerCount : null;
      out.push({ date: d, v, span: diffDays(b.date, a.date) });
    }
    return out;
  }

  /**
   * 率の分子・分母（v0.6.0 ③）。g が growth の結果なら期間の増えた数、snap なら累計。
   * 開封率（PV÷インプレッション）は、インプレッションが0の記事（古い記事など、noteが数えていない記事）を分子・分母の両方から外す。
   * スキ率・コメント率の分母は PV。分母が0なら率は null（画面では「－」）。
   * スキ＋コメントを足した率は作らない（同じ人の重複を含み、人の割合として読めないため）。
   */
  function rateTotals(src) {
    const t = { pv: 0, like: 0, comment: 0, ctrPv: 0, ctrImp: 0, noImp: 0 };
    if (src && src.items instanceof Map) {
      const curMap = new Map(((src.cur && src.cur.items) || []).map((i) => [i.key, i]));
      for (const x of src.items.values()) {
        if (!x.d) continue;
        t.pv += x.d.pv; t.like += x.d.like; t.comment += x.d.comment;
        const c = curMap.get(x.key);
        if (c && c.imp > 0) { t.ctrPv += x.d.pv; t.ctrImp += x.d.imp; } else if (x.d.pv) t.noImp++;
      }
    } else if (src && Array.isArray(src.items)) {
      for (const i of src.items) {
        t.pv += i.pv || 0; t.like += i.like || 0; t.comment += i.comment || 0;
        if (i.imp > 0) { t.ctrPv += i.pv || 0; t.ctrImp += i.imp; } else if (i.pv) t.noImp++;
      }
    } else return null;
    const r = (a, b) => (b > 0 ? a / b : null);
    return { ...t, ctr: r(t.ctrPv, t.ctrImp), likeRate: r(t.like, t.pv), commentRate: r(t.comment, t.pv) };
  }

  const calc = { addDays, diffDays, jstDay, lastOnOrBefore, growth, resolve, before, sameDays, buckets, publishedIn, daily, rateTotals };
  if (typeof document === 'undefined') return { calc };

  /* ==================== 画面 ==================== */
  const P = { artMetric: 'pv', artShown: 20, listMetric: 'pv', back: 0, flow: 'entry' };
  const LABEL = { pv: 'PV', like: 'スキ', comment: 'コメント', imp: 'インプレッション', follower: 'フォロワー', articles: '記事数' };
  const SHORT = { pv: 'PV', like: 'スキ', comment: 'コメント', imp: 'インプレッション', follower: 'フォロワー', articles: '公開本数' };
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const md = (d) => { const [, m, dd] = d.split('-'); return `${+m}/${+dd}`; };
  const wd = (d) => WD[new Date(`${d}T00:00:00Z`).getUTCDay()];
  const rangeText = (b) => {
    if (b.kind === 'month') { const [y, m] = b.start.split('-').map(Number); return `${y}年${m}月${b.partial ? `（${m}/1〜${md(b.end)}）` : ''}`; }
    return b.start === b.end ? fmtDate(b.start) : `${fmtDate(b.start)}〜${md(b.end)}`;
  };
  const sel = () => (S.settings && S.settings.growthPeriod) || { kind: '7' };
  const rateTxt = (n, d) => (d ? `${((n / d) * 100).toFixed(2)}%` : '－');

  /** 期間を選ぶ部品（①・③で共通）。value: {kind,start,end}、onChange(新しい値) */
  function picker(el, value, onChange, idp) {
    const v = value || { kind: '7' };
    const r = resolve(S.snapshots, v) || {};
    const min = S.snapshots[0] ? S.snapshots[0].date : '', max = latest() ? latest().date : '';
    el.classList.add('period-picker');
    el.innerHTML = `<div class="seg" role="group" aria-label="期間">
        ${[['7', '7日'], ['28', '28日'], ['month', '月ごと'], ['custom', 'カスタム'], ['prev', '前回の記録から']].map(([k, l]) => `<button type="button" data-pk="${k}" aria-pressed="${v.kind === k}">${l}</button>`).join('')}
      </div>
      <span class="custom-range" ${v.kind === 'custom' ? '' : 'hidden'}>
        <input type="date" id="${idp}Start" aria-label="開始日" value="${esc(r.start || '')}" min="${esc(min)}" max="${esc(max)}">〜
        <input type="date" id="${idp}End" aria-label="終了日" value="${esc(r.end || '')}" min="${esc(min)}" max="${esc(max)}">
      </span>`;
    el.querySelectorAll('[data-pk]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.pk;
      onChange(k === 'custom' ? { kind: 'custom', start: r.start, end: r.end } : { kind: k });
    }));
    el.querySelectorAll('input[type=date]').forEach((inp) => inp.addEventListener('change', () => {
      const s = el.querySelector(`#${idp}Start`).value, e = el.querySelector(`#${idp}End`).value;
      if (isDay(s) && isDay(e)) onChange({ kind: 'custom', start: s, end: e });
    }));
  }

  async function setSel(v) {
    S.settings.growthPeriod = v;
    P.artShown = 20; P.back = 0;
    await NDB.kvSet('settings', S.settings);
    render();
  }
  function go(back) { P.back = back; P.artShown = 20; render(); }

  function note(b) {
    const parts = [];
    if (b.missingDays) parts.push(`記録のない日があります（${b.missingDays}日）`);
    if (b.spillDays > 0) parts.push(`前の${b.spillDays}日分の伸びも含みます`);
    return parts.join('・');
  }

  /* ---------- 期間の動き（全体の数字：今の期間と前の期間） ---------- */
  const chartType = () => (S.settings && S.settings.periodChart) || 'line';

  function renderSummary() {
    const box = $('#periodBody');
    const snaps = S.snapshots, sv = sel();
    const r = resolve(snaps, sv, P.back);
    const nav = $('#periodNav');
    if (!r) { box.innerHTML = '<p class="meta">この期間の記録はありません。</p>'; nav.innerHTML = ''; return; }
    const pr = before(snaps, sv, P.back);
    const same = sameDays(snaps, sv, P.back); // 月ごとで今の月が途中のとき
    const cmp = same || pr;
    const canFwd = !!resolve(snaps, sv, P.back - 1);
    const isLatest = r.end === snaps[snaps.length - 1].date;
    const unit = r.kind === 'prev' ? '記録' : r.kind === 'month' ? '月' : `${r.len}日`;
    nav.innerHTML = `<button class="btn small" data-pnav="back" ${pr ? '' : 'disabled'}>← 前の${unit}</button>
      <span class="pnav-range"><b>${esc(rangeText(r))}</b>${r.kind !== 'month' && r.len > 1 ? `（${r.len}日）` : ''}${isLatest ? ' <span class="tag">最新</span>' : ''}</span>
      <button class="btn small" data-pnav="fwd" ${canFwd ? '' : 'disabled'}>次の${unit} →</button>
      <button class="btn small" data-pnav="latest" ${P.back !== 0 ? '' : 'disabled'}>${r.kind === 'custom' ? '選んだ期間に戻る' : '最新'}</button>`;

    const g = growth(snaps, r.start, r.end, { fallbackFirst: true });
    const cg = cmp ? growth(snaps, cmp.start, cmp.end) : null;
    const fg = same && pr ? growth(snaps, pr.start, pr.end) : null; // 先月全体
    const pubN = (x) => (x ? publishedIn(snaps, x.start, x.end).length : null);
    const nowPub = pubN(r), cmpPub = pubN(cmp), fullPub = same ? pubN(pr) : null;
    const cmpLabel = r.kind === 'month' ? (same ? '先月の同じ日まで' : '前の月') : '前期間';
    const okv = (x, k) => (x && x.status === 'ok' ? x.totals[k] : null);
    const tile = (k) => {
      const isArt = k === 'articles';
      const show = (v) => (v == null ? '記録なし' : isArt ? `${fmt(v)}本` : signed(v));
      const v = isArt ? nowPub : g.status === 'ok' ? g.totals[k] : null;
      const pvv = isArt ? cmpPub : g.fallback ? null : okv(cg, k);
      let chg = '';
      if (v != null && pvv != null) {
        if (pvv > 0) { const c = (v - pvv) / pvv; chg = `<div class="delta ${c > 0 ? 'up' : c < 0 ? 'down' : ''}">${c > 0 ? '+' : c < 0 ? '−' : '±'}${Math.abs(c * 100).toFixed(1)}%</div>`; }
        else chg = `<div class="delta">${v > pvv ? `+${fmt(v - pvv)}` : v < pvv ? `−${fmt(pvv - v)}` : '±0'}</div>`;
      }
      const full = same ? `<div class="delta">先月全体 ${show(isArt ? fullPub : okv(fg, k))}</div>` : '';
      return `<div class="kpi"><div class="label">${esc(isArt ? '記事数（公開本数）' : LABEL[k])}</div>
        <div class="value">${v == null ? '<span class="meta">記録なし</span>' : isArt ? `${fmt(v)}<small>本</small>` : signed(v)}</div>${chg}
        <div class="delta">${cmpLabel} ${cmp ? show(pvv) : 'なし'}</div>${full}</div>`;
    };
    const warn = [];
    if (g.status !== 'ok') warn.push(g.status === 'norecord' ? 'この期間の記録がありません。' : 'この期間より前の記録がないため、伸びを計算できません。');
    if (g.fallback) warn.push(`この期間の途中から記録を始めたため、記録を始めた日（${fmtDate(g.base.date)}）からの伸びです。前の期間とは比べられません。`);
    if (g.status === 'ok' && note(g)) warn.push(`今の期間：${note(g)}`);
    if (cg && cg.status === 'ok' && note(cg)) warn.push(`${cmpLabel}：${note(cg)}`);
    if (cmp && cg && cg.status !== 'ok') warn.push(`${cmpLabel}は記録がないため、増減は出せません。`);
    if (r.cut) warn.push('終了日は最後の記録の日までにしています。');

    const ct = chartType();
    box.innerHTML = `<p class="meta">今の期間 ${esc(rangeText(r))}　／　${esc(cmpLabel)} ${cmp ? esc(rangeText(cmp)) : 'なし（記録を始める前）'}${same ? `　（先月全体 ${esc(rangeText(pr))}）` : ''}　・増えた数（記事数はその期間に公開した本数）</p>
      <div class="kpis period-kpis">${['imp', 'pv', 'like', 'comment', 'follower', 'articles'].map(tile).join('')}</div>
      ${warn.length ? `<p class="warn">${warn.map(esc).join('<br>')}</p>` : ''}
      <div class="card-head" style="margin-top:12px">
        <h3 class="subhead" style="margin:0">日ごとの動き</h3>
        <div class="controls">
          <div class="seg" role="group" aria-label="見る段階">
            <button type="button" data-flow="entry" aria-pressed="${P.flow === 'entry'}">入口（インプレッション→PV）</button>
            <button type="button" data-flow="response" aria-pressed="${P.flow === 'response'}">反応（PV→スキ・コメント）</button>
          </div>
          <div class="seg" role="group" aria-label="グラフの形">
            <button type="button" data-ctype="line" aria-pressed="${ct === 'line'}">線</button>
            <button type="button" data-ctype="bar" aria-pressed="${ct === 'bar'}">棒</button>
          </div>
        </div>
      </div>
      <div id="flowChart" class="flow-chart"></div>
      <p class="hint" id="flowHint"></p>`;
    if (ct === 'bar') renderFlowBars(r); else renderFlowLines(r, pr);
  }

  /* 日の並び（月ごとは月末まで並べ、まだ来ていない日は空ける） */
  const lastRec = () => S.snapshots[S.snapshots.length - 1].date;
  function dayRows(x) {
    if (!x) return [];
    const end = x.kind === 'month' ? x.monthEnd : x.end;
    return daily(S.snapshots, x.start, end).map((d) => ({ ...d, future: d.date > lastRec() }));
  }
  const RATE = { ctr: ['pv', 'imp'], likeRate: ['like', 'pv'], commentRate: ['comment', 'pv'] };
  const valOf = (d, k) => { if (!d || !d.v) return null; if (RATE[k]) { const [a, b] = RATE[k]; return d.v[b] > 0 && d.v[a] != null ? d.v[a] / d.v[b] : null; } return d.v[k]; };
  const tipLines = (d) => (d.v
    ? `<div>インプレッション ${signed(d.v.imp)}　PV ${signed(d.v.pv)}</div><div>スキ ${signed(d.v.like)}　コメント ${signed(d.v.comment)}　フォロワー ${signed(d.v.follower)}</div><div>開封率 ${rateTxt(d.v.pv, d.v.imp)}　スキ率 ${rateTxt(d.v.like, d.v.pv)}　コメント率 ${rateTxt(d.v.comment, d.v.pv)}</div>`
    : `<div>${d.future ? 'まだ来ていない日' : '記録なし'}</div>`);
  function placeTip(ev) {
    const tip = $('#tooltip');
    tip.hidden = false;
    const cx = ev.clientX || 0, cy = ev.clientY || 0;
    tip.style.left = `${Math.max(8, Math.min(cx + 14, innerWidth - tip.offsetWidth - 8))}px`; tip.style.top = `${Math.max(8, cy - tip.offsetHeight - 10)}px`;
  }

  /* 線グラフ（標準）：指標ごとに小さなグラフを縦に並べ、前の期間を点線で重ねる */
  function renderFlowLines(r, pr) {
    const el = $('#flowChart');
    const cur = dayRows(r), prev = dayRows(pr);
    const entry = P.flow === 'entry';
    const panels = entry
      ? [{ k: 'imp', t: 'インプレッション', c: 'c-imp' }, { k: 'pv', t: 'PV', c: 'c-pv' }, { k: 'ctr', t: '開封率（PV÷インプレッション）', c: 'c-rate' }]
      : [{ k: 'pv', t: 'PV', c: 'c-pv' }, { k: 'like', t: 'スキ', c: 'c-like' }, { k: 'comment', t: 'コメント', c: 'c-comment' }];
    const n = Math.max(cur.length, r.kind === 'prev' ? 0 : prev.length, 1);
    const W = Math.max(el.clientWidth || 600, 300), L = 52, R = 12, PH = 96, HEAD = 22, GAP = 14;
    const twoRow = W < 600, top0 = twoRow ? 44 : 26;
    const iw = W - L - R;
    const H = top0 + panels.length * (HEAD + PH + GAP) + 34;
    const x = (i) => L + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const every = Math.ceil(n / Math.max(2, Math.floor(iw / 48)));
    const usePrev = pr && r.kind !== 'prev';
    const fmtV = (k, v) => (v == null ? '－' : RATE[k] ? `${(v * 100).toFixed(2)}%` : signed(v));
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="日ごとの動き（線グラフ）">
      <g class="legend"><line class="cur-line" x1="${L}" x2="${L + 22}" y1="10" y2="10"/><text class="lbl" x="${L + 28}" y="14">今の期間 ${esc(rangeText(r))}</text>
      ${usePrev ? (() => { const lx = twoRow ? L : L + 260, ly = twoRow ? 28 : 10; return `<line class="prev-line" x1="${lx}" x2="${lx + 22}" y1="${ly}" y2="${ly}"/><text class="lbl" x="${lx + 28}" y="${ly + 4}">前の期間 ${esc(rangeText(pr))}</text>`; })() : ''}</g>`;
    panels.forEach((p, pi) => {
      const y0 = top0 + pi * (HEAD + PH + GAP) + HEAD;
      const cv = cur.map((d) => valOf(d, p.k)), pv = usePrev ? prev.map((d) => valOf(d, p.k)) : [];
      const all = [...cv, ...pv].filter((v) => v != null);
      const maxV = Math.max(RATE[p.k] ? 0.0001 : 1, ...all);
      const ticks = niceTicks(0, maxV, 2);
      const yMax = ticks[ticks.length - 1] || 1;
      const y = (v) => y0 + PH - (Math.max(0, v) / yMax) * PH;
      const path = (vals) => { let d = '', pen = false; vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; }); return d; };
      svg += `<text class="ptitle" x="${L}" y="${y0 - 8}">${esc(p.t)}</text>`;
      svg += ticks.map((t) => `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${esc(RATE[p.k] ? `${+(t * 100).toFixed(2)}%` : fmt(t))}</text>`).join('');
      if (usePrev) svg += `<path class="prev-line" d="${path(pv)}"/>`;
      svg += `<path class="cur-line ${p.c}" d="${path(cv)}"/>`;
      if (n <= 62) svg += cv.map((v, i) => (v == null ? '' : `<circle class="pt ${p.c}${cur[i].span > 1 ? ' multi' : ''}" cx="${x(i)}" cy="${y(v)}" r="${cur[i].span > 1 ? 3.5 : 2.5}"/>`)).join('');
      // 記録のない日（まだ来ていない日は除く）を薄く塗る
      cur.forEach((d, i) => { if (!d.v && !d.future) { const w = n === 1 ? 20 : iw / (n - 1); svg += `<rect class="nobar" x="${x(i) - w / 2}" y="${y0}" width="${w}" height="${PH}"/>`; } });
    });
    const yAxis = top0 + panels.length * (HEAD + PH + GAP);
    for (let i = 0; i < n; i++) {
      const d = cur[i] ? cur[i].date : '';
      if (!(i % every === 0 || (i === n - 1 && i % every >= every / 2))) continue;
      if (r.kind === 'month') svg += `<text class="tick" x="${x(i)}" y="${yAxis + 4}" text-anchor="middle">${i + 1}日</text>`;
      else if (d) svg += `<text class="tick" x="${x(i)}" y="${yAxis + 4}" text-anchor="middle">${md(d)}</text>${n <= 14 ? `<text class="tick" x="${x(i)}" y="${yAxis + 18}" text-anchor="middle">${wd(d)}</text>` : ''}`;
    }
    svg += `<line class="cross" id="flowCross" y1="${top0}" y2="${yAxis - GAP}" visibility="hidden"/>`;
    for (let i = 0; i < n; i++) { const w = n === 1 ? iw : iw / (n - 1); svg += `<rect class="hit" data-i="${i}" x="${x(i) - w / 2}" y="${top0}" width="${w}" height="${yAxis - top0}"/>`; }
    el.innerHTML = svg + '</svg>';

    const multi = cur.filter((d) => d.span > 1).length, none = cur.filter((d) => !d.v && !d.future).length;
    $('#flowHint').textContent = `実線が今の期間、点線が前の期間です（1日目どうし、2日目どうしを重ねています）。${none ? `薄い灰色は記録のない日（${none}日）です。` : ''}${multi ? `大きめの点は、前の記録が2日以上前なので数日分がまとまっています（${multi}日）。` : ''}カーソルを合わせる（スマホはタップ）と数字が出ます。`;

    const cross = $('#flowCross');
    const show = (ev, i) => {
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      const d = cur[i], q = usePrev ? prev[i] : null;
      $('#tooltip').innerHTML = (d ? `<div><b>${fmtDate(d.date)}（${wd(d.date)}）</b>${d.span > 1 ? `・${d.span}日分` : ''}</div>${tipLines(d)}` : '')
        + (q ? `<div class="t-prev">前の期間 ${fmtDate(q.date)}：${q.v ? panels.map((p) => `${p.t.replace(/（.*）/, '')} ${fmtV(p.k, valOf(q, p.k))}`).join('　') : '記録なし'}</div>` : '');
      placeTip(ev);
    };
    el.querySelectorAll('.hit').forEach((h) => {
      h.addEventListener('mousemove', (ev) => show(ev, +h.dataset.i));
      h.addEventListener('click', (ev) => show(ev, +h.dataset.i));
      h.addEventListener('mouseleave', () => { $('#tooltip').hidden = true; cross.setAttribute('visibility', 'hidden'); });
    });
  }

  /* 棒グラフ（選んだとき）：上が入口の数、下がその先の数。棒はそれぞれの最大値に合わせた長さ＋下の段に率 */
  function renderFlowBars(r) {
    const el = $('#flowChart');
    const days = dayRows(r);
    const entry = P.flow === 'entry';
    const top = entry ? 'imp' : 'pv', bots = entry ? ['pv'] : ['like', 'comment'];
    const cls = { imp: 'c-imp', pv: 'c-pv', like: 'c-like', comment: 'c-comment' };
    const maxOf = (k) => Math.max(1, ...days.map((d) => (d.v && d.v[k] > 0 ? d.v[k] : 0)));
    const mTop = maxOf(top), mBot = Object.fromEntries(bots.map((k) => [k, maxOf(k)]));
    const n = days.length;
    const W = Math.max(el.clientWidth || 600, 300), H = 250, L = 8, R = 8;
    const iw = W - L - R, bw = iw / n, gap = Math.min(6, bw * 0.25);
    const upH = 90, dnH = 90, mid = 22 + upH;
    const showRate = n <= 14 && bw >= 30;
    const every = Math.ceil(n / Math.max(2, Math.floor(iw / 44)));
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="日ごとの動き（棒グラフ）">
      <text class="lbl" x="${L}" y="12">${esc(SHORT[top])}</text><text class="lbl" x="${W - R}" y="12" text-anchor="end">最大 ${fmt(mTop)}</text>
      <text class="lbl" x="${L}" y="${mid + dnH + 14}">${esc(bots.map((k) => SHORT[k]).join('・'))}</text>
      <text class="lbl" x="${W - R}" y="${mid + dnH + 14}" text-anchor="end">最大 ${esc(bots.map((k) => fmt(mBot[k])).join('・'))}</text>
      <line class="baseline" x1="${L}" x2="${W - R}" y1="${mid}" y2="${mid}"/>`;
    days.forEach((d, i) => {
      const bx = L + i * bw + gap / 2, w = bw - gap;
      if (!d.v) {
        if (!d.future) svg += `<rect class="nobar" x="${bx}" y="${mid - upH}" width="${w}" height="${upH + dnH}"/>`;
      } else {
        const hT = (Math.max(0, d.v[top] || 0) / mTop) * upH;
        svg += `<rect class="${cls[top]}${d.span > 1 ? ' multi' : ''}" x="${bx}" y="${mid - hT}" width="${w}" height="${hT}"/>`;
        const sw = w / bots.length;
        bots.forEach((k, j) => { const h = (Math.max(0, d.v[k] || 0) / mBot[k]) * dnH; svg += `<rect class="${cls[k]}${d.span > 1 ? ' multi' : ''}" x="${bx + j * sw}" y="${mid}" width="${sw}" height="${h}"/>`; });
      }
      if (i % every === 0 || (i === n - 1 && i % every >= every / 2)) svg += `<text class="tick" x="${bx + w / 2}" y="${mid + dnH + 34}" text-anchor="middle">${md(d.date)}</text>${n <= 14 ? `<text class="tick" x="${bx + w / 2}" y="${mid + dnH + 48}" text-anchor="middle">${wd(d.date)}</text>` : ''}`;
      svg += `<rect class="hit" data-i="${i}" x="${L + i * bw}" y="0" width="${bw}" height="${H}"/>`;
    });
    svg += '</svg>';
    const rateRow = showRate ? `<div class="rate-row" style="grid-template-columns:repeat(${n},1fr);padding:0 ${R}px 0 ${L}px">${days.map((d) => {
      if (!d.v) return '<span class="meta">－</span>';
      return entry ? `<span>${rateTxt(d.v.pv, d.v.imp)}</span>` : `<span>${rateTxt(d.v.like, d.v.pv)}<br>${rateTxt(d.v.comment, d.v.pv)}</span>`;
    }).join('')}</div>` : '';
    el.innerHTML = svg + (showRate ? `<div class="rate-head">${entry ? '開封率（PV÷インプレッション）' : 'スキ率（スキ÷PV）／ コメント率（コメント÷PV）'}</div>${rateRow}` : '');
    const multi = days.filter((d) => d.span > 1).length, none = days.filter((d) => !d.v && !d.future).length;
    $('#flowHint').textContent = `上下の棒は、それぞれ期間内の最大値を満タンにした長さです（上と下の長さを比べても率は分かりません）。${showRate ? '' : '率は棒にカーソルを合わせる（スマホはタップ）と出ます。'}${none ? `灰色は記録のない日（${none}日）です。` : ''}${multi ? `薄い色の棒は、前の記録が2日以上前なので数日分がまとまっています（${multi}日）。` : ''}`;
    const show = (ev, i) => { const d = days[i]; $('#tooltip').innerHTML = `<div><b>${fmtDate(d.date)}（${wd(d.date)}）</b>${d.span > 1 ? `・${d.span}日分` : ''}</div>${tipLines(d)}`; placeTip(ev); };
    el.querySelectorAll('.hit').forEach((h) => {
      h.addEventListener('mousemove', (ev) => show(ev, +h.dataset.i));
      h.addEventListener('click', (ev) => show(ev, +h.dataset.i));
      h.addEventListener('mouseleave', () => { $('#tooltip').hidden = true; });
    });
  }

  /* ---------- 伸びた記事（上位10） ---------- */
  function renderList() {
    const list = $('#growthList');
    const meta = $('#growthMeta');
    const r = resolve(S.snapshots, sel(), P.back);
    if (!r || S.snapshots.length < 2) { list.innerHTML = '<li class="meta">2日分の記録がたまると表示されます。</li>'; meta.textContent = ''; return; }
    const g = growth(S.snapshots, r.start, r.end, { fallbackFirst: true });
    if (g.status !== 'ok') {
      list.innerHTML = `<li class="meta">${g.status === 'norecord' ? 'この期間の記録がありません。' : 'この期間より前の記録がないため、伸びを計算できません。'}</li>`;
      meta.textContent = rangeText(r); return;
    }
    const k = P.listMetric;
    const span = diffDays(g.base.date, g.cur.date);
    meta.innerHTML = `${esc(rangeText(r))}　（${esc(fmtDate(g.base.date))} の記録 → ${esc(fmtDate(g.cur.date))} の記録・${span}日分）・${SHORT[k]}の増加順`
      + (g.fallback ? `<br><span class="warn">記録を始めた日（${esc(fmtDate(g.base.date))}）からの伸びです。</span>` : '')
      + (note(g) ? `<br><span class="warn">${esc(note(g))}</span>` : '');
    const rows = g.cur.items.map((i) => ({ i, x: g.items.get(i.key) })).filter((o) => o.x && o.x.d && o.x.d[k] > 0)
      .sort((a, b) => b.x.d[k] - a.x.d[k] || b.x.d.pv - a.x.d.pv).slice(0, 10);
    list.innerHTML = rows.length
      ? rows.map(({ i, x }) => `<li><div class="rrow"><span class="rtitle"><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>${x.isNew ? '<span class="tag">期間中に公開</span>' : ''}</span><span class="rnum">PV ${signed(x.d.pv)}　スキ ${signed(x.d.like)}　コメント ${signed(x.d.comment)}</span></div></li>`).join('')
      : `<li class="meta">この期間に${SHORT[k]}が増えた記事はありません。</li>`;
  }

  /* ---------- 期間ごとの比較（最大8区切り） ---------- */
  function renderCompare() {
    const wrap = $('#compareBody');
    if (!wrap) return;
    const bs = buckets(S.snapshots, sel(), 8, P.back);
    if (S.snapshots.length < 2 || !bs.length) { wrap.innerHTML = '<p class="meta">2日分の記録がたまると表示されます。</p>'; $('#compareMeta').textContent = ''; return; }
    const r = resolve(S.snapshots, sel(), P.back);
    $('#compareMeta').textContent = r.kind === 'prev' ? '記録と記録のあいだごと（新しい順）' : `${r.len}日ずつ・新しい順（最大8区切り）`;
    const ok = bs.filter((b) => b.status === 'ok');
    const maxPv = Math.max(1, ...ok.map((b) => b.totals.pv || 0));
    const cell = (b, k) => `<td>${b.totals[k] == null ? '–' : signed(b.totals[k])}</td>`;
    const totalRows = bs.map((b, idx) => {
      const pub = publishedIn(S.snapshots, b.start, b.end).length;
      const head = `<td class="l"><b>${esc(rangeText(b))}</b>${idx === 0 ? ' <span class="tag">表示中</span>' : ''}${note(b) ? `<div class="warn">${esc(note(b))}</div>` : ''}</td>`;
      if (b.status !== 'ok') return `<tr>${head}<td colspan="6" class="nodata-cell">記録なし${b.status === 'nobase' ? '（この区切りより前の記録がありません）' : '（この区切りの記録がありません）'}</td><td>${fmt(pub)}</td></tr>`;
      const w = Math.max(0, Math.round(((b.totals.pv || 0) / maxPv) * 100));
      return `<tr>${head}<td class="barcell"><span class="hbar" style="width:${w}%"></span></td>${cell(b, 'imp')}${cell(b, 'pv')}${cell(b, 'like')}${cell(b, 'comment')}${cell(b, 'follower')}<td>${fmt(pub)}</td></tr>`;
    }).join('');

    const k = P.artMetric;
    const cur = latest();
    const newest = bs[0];
    const val = (key) => { const x = newest.status === 'ok' && newest.items.get(key); return x && x.d ? x.d[k] : -1; };
    const arts = cur.items.slice().sort((a, b) => val(b.key) - val(a.key) || (b.publishedAt || '').localeCompare(a.publishedAt || ''));
    const shown = arts.slice(0, P.artShown);
    const artCell = (b, i) => {
      if (b.status !== 'ok') return '<td class="nodata-cell">記録なし</td>';
      const pub = jstDay(i.publishedAt);
      if (pub && pub > b.end) return '<td class="muted-cell" title="まだ公開前">·</td>';
      const x = b.items.get(i.key);
      if (!x) return '<td class="muted-cell" title="この区切りの記録に無い記事">·</td>';
      if (!x.d) return '<td class="nodata-cell" title="前の記録に無い記事">記録なし</td>';
      const v = x.d[k];
      return `<td class="${v > 0 ? 'up' : ''}">${signed(v)}${x.isNew ? '<sup title="この区切りに公開（0から数えています）">新</sup>' : ''}</td>`;
    };
    const artRows = shown.map((i) => `<tr><td class="l"><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></td>${bs.map((b) => artCell(b, i)).join('')}</tr>`).join('');

    wrap.innerHTML = `<h3 class="subhead">全体の合計（増えた数）</h3>
      <div class="table-wrap"><table class="grid compare">
        <thead><tr><th class="l">区切り</th><th class="barcell">PV</th><th>インプレッション</th><th>PV</th><th>スキ</th><th>コメント</th><th>フォロワー</th><th>公開本数</th></tr></thead>
        <tbody>${totalRows}</tbody></table></div>
      <div class="card-head" style="margin-top:14px"><h3 class="subhead" style="margin:0">記事ごと</h3>
        <label class="controls">指標 <select id="compareMetric">${['pv', 'like', 'comment', 'imp'].map((m) => `<option value="${m}" ${m === k ? 'selected' : ''}>${SHORT[m]}</option>`).join('')}</select></label></div>
      <p class="hint">いちばん左の区切りで伸びた順です。「新」はその区切りに公開された記事（0から数えています）、「·」はまだ公開前です。</p>
      <div class="table-wrap"><table class="grid compare arts">
        <thead><tr><th class="l">記事</th>${bs.map((b) => `<th>${esc(rangeText(b))}</th>`).join('')}</tr></thead>
        <tbody>${artRows}</tbody></table></div>
      ${arts.length > shown.length ? `<p><button class="btn small" id="compareMore">さらに表示（残り${arts.length - shown.length}件）</button></p>` : ''}`;
    $('#compareMetric').addEventListener('change', (e) => { P.artMetric = e.target.value; renderCompare(); });
    const more = $('#compareMore');
    if (more) more.addEventListener('click', () => { P.artShown += 20; renderCompare(); });
  }

  /* ---------- 率（開封率・スキ率・コメント率） v0.6.0 ③ ---------- */
  const rateConf = () => ({ show: true, mode: 'period', ...((S.settings && S.settings.rates) || {}) });
  async function setRate(patch) { S.settings.rates = { ...rateConf(), ...patch }; await NDB.kvSet('settings', S.settings); renderRates(); }
  /**
   * 共有用の数字（v0.6.0 ⑤）：今「期間の動き」で選んでいる期間と、比べる期間。
   * n … 伸びた記事の上位いくつまで、metric … 並べる指標
   */
  function shareData(n = 5, metric = 'pv') {
    const snaps = S.snapshots, sv = sel();
    const r = resolve(snaps, sv, P.back);
    if (!r) return null;
    const pr = before(snaps, sv, P.back), same = sameDays(snaps, sv, P.back), cmp = same || pr;
    const g = growth(snaps, r.start, r.end, { fallbackFirst: true });
    const cg = cmp && !g.fallback ? growth(snaps, cmp.start, cmp.end) : null;
    const cmpOk = !!(cg && cg.status === 'ok');
    const cmpLabel = r.kind === 'month' ? (same ? '先月の同じ日まで' : '前の月') : '前の期間';
    const nowPub = publishedIn(snaps, r.start, r.end).length, prevPub = cmp ? publishedIn(snaps, cmp.start, cmp.end).length : null;
    const metrics = ['pv', 'imp', 'like', 'comment', 'follower', 'articles'].map((k) => {
      const now = k === 'articles' ? nowPub : g.status === 'ok' ? g.totals[k] : null;
      const prev = k === 'articles' ? (g.fallback ? null : prevPub) : cmpOk ? cg.totals[k] : null;
      const chg = now != null && prev != null && prev > 0 ? (now - prev) / prev : null;
      return { k, label: k === 'articles' ? '公開した記事' : LABEL[k], now, prev, chg, unit: k === 'articles' ? '本' : '' };
    });
    let articles = [];
    if (g.status === 'ok') {
      articles = g.cur.items.map((i) => ({ i, x: g.items.get(i.key) })).filter((o) => o.x && o.x.d && o.x.d[metric] > 0)
        .sort((a, b) => b.x.d[metric] - a.x.d[metric] || b.x.d.pv - a.x.d.pv).slice(0, n)
        .map(({ i, x }, idx) => ({ rank: idx + 1, key: i.key, title: i.title, url: i.url, total: i[metric] || 0, inc: x.d[metric], d: x.d, isNew: x.isNew }));
    }
    return {
      rangeText: rangeText(r), start: r.start, end: r.end, kind: r.kind,
      cmpText: cmp ? rangeText(cmp) : '', cmpLabel, cmpOk, fallback: !!g.fallback, baseDate: g.base ? g.base.date : '',
      status: g.status, note: g.status === 'ok' ? note(g) : '', metrics, articles, metric, metricLabel: SHORT[metric],
    };
  }

  function renderRates() {
    const card = $('#ratesCard');
    if (!card) return;
    const snaps = S.snapshots, rc = rateConf();
    card.hidden = !snaps.length;
    if (!snaps.length) return;
    const body = $('#ratesBody'), seg = $('#ratesMode');
    $('#ratesShow').checked = rc.show;
    seg.hidden = !rc.show; body.hidden = !rc.show;
    seg.querySelectorAll('[data-rmode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rmode === rc.mode)));
    if (!rc.show) return;
    let now, prev = null, head, prevLabel = '';
    if (rc.mode === 'total') {
      const cur = snaps[snaps.length - 1];
      now = rateTotals(cur);
      head = `累計（${fmtDate(cur.date)} の記録）`;
    } else {
      const sv = sel(), r = resolve(snaps, sv, P.back);
      if (!r) { body.innerHTML = '<p class="meta">この期間の記録はありません。</p>'; return; }
      const g = growth(snaps, r.start, r.end, { fallbackFirst: true });
      if (g.status !== 'ok') { body.innerHTML = `<p class="meta">${esc(rangeText(r))}：${g.status === 'norecord' ? 'この期間の記録がありません。' : 'この期間より前の記録がないため、計算できません。'}</p>`; return; }
      now = rateTotals(g);
      const cmp = sameDays(snaps, sv, P.back) || before(snaps, sv, P.back);
      const cg = cmp && !g.fallback ? growth(snaps, cmp.start, cmp.end) : null;
      if (cg && cg.status === 'ok') { prev = rateTotals(cg); prevLabel = r.kind === 'month' ? (sameDays(snaps, sv, P.back) ? '先月の同じ日まで' : '前の月') : '前期間'; }
      head = `選んだ期間 ${rangeText(r)}（「期間の動き」と同じ期間）${g.fallback ? `・記録を始めた日（${fmtDate(g.base.date)}）から` : ''}`;
    }
    const dec = { ctr: 2, likeRate: 1, commentRate: 1 };
    const pctx = (v, k) => (v == null ? '－' : `${(v * 100).toFixed(dec[k])}%`);
    const tile = (k, from, name, num, den, nl, dl) => {
      const v = now[k], pv = prev ? prev[k] : null;
      let diff = '';
      if (prev) {
        if (v == null || pv == null) diff = `<div class="delta">${esc(prevLabel)} ${pctx(pv, k)}</div>`;
        else { const d = (v - pv) * 100; const f = Math.abs(d).toFixed(dec[k]); diff = `<div class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${esc(prevLabel)}より ${d > 0 ? '+' : d < 0 ? '−' : '±'}${f}ポイント</div><div class="delta">${esc(prevLabel)} ${pctx(pv, k)}</div>`; }
      }
      return `<div class="kpi rate-tile"><div class="label">${esc(from)}</div><div class="rname">${esc(name)}</div>
        <div class="value">${pctx(v, k)}</div><div class="delta">${esc(nl)} ${fmt(num)} ÷ ${esc(dl)} ${fmt(den)}</div>${diff}</div>`;
    };
    body.innerHTML = `<p class="meta">${esc(head)}</p>
      <div class="kpis rate-kpis">
        ${tile('ctr', 'インプレッション → PV', '開封率（CTR）', now.ctrPv, now.ctrImp, 'PV', 'インプレッション')}
        ${tile('likeRate', 'PV → スキ', 'スキ率', now.like, now.pv, 'スキ', 'PV')}
        ${tile('commentRate', 'PV → コメント', 'コメント率', now.comment, now.pv, 'コメント', 'PV')}
      </div>
      <p class="hint">前の期間との差は「ポイント」（率どうしの引き算。例：7.5%→8.5%は＋1.0ポイント）で出しています。分母が0のときは「－」です。${now.noImp ? `開封率は、インプレッションが0の記事（noteがインプレッションを数えていない古い記事など・${fmt(now.noImp)}本）を分子・分母の両方から外しています。` : ''}スキとコメントを足した「反応率」のような数字は出しません（同じ人がスキもコメントもすることがあり、人の割合として読めないため）。</p>`;
  }

  function render() {
    renderRates();
    const cur = latest();
    const card = $('#periodCard');
    if (!cur) { card.hidden = true; $('#growthList').innerHTML = ''; $('#growthMeta').textContent = ''; $('#compareBody').innerHTML = ''; return; }
    card.hidden = false;
    picker($('#growthPicker'), sel(), setSel, 'growth');
    $('#growthMetric').value = P.listMetric;
    renderSummary();
    renderList();
    renderCompare();
  }

  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'growthMetric') { P.listMetric = e.target.value; renderList(); }
    if (e.target && e.target.id === 'ratesShow') setRate({ show: e.target.checked });
  });
  document.addEventListener('click', (e) => {
    const n = e.target.closest && e.target.closest('[data-pnav]');
    if (n && !n.disabled) { const a = n.dataset.pnav; go(a === 'back' ? P.back + 1 : a === 'fwd' ? P.back - 1 : 0); return; }
    const rm = e.target.closest && e.target.closest('[data-rmode]');
    if (rm) { setRate({ mode: rm.dataset.rmode }); return; }
    const f = e.target.closest && e.target.closest('[data-flow]');
    if (f) { P.flow = f.dataset.flow; renderSummary(); }
    const c = e.target.closest && e.target.closest('[data-ctype]');
    if (c) { S.settings.periodChart = c.dataset.ctype; NDB.kvSet('settings', S.settings); renderSummary(); }
  });
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (latest() && !$('#tab-overview').hidden) renderSummary(); }, 150); });

  return { calc, picker, render, resolve, growth, buckets, sel, back: () => P.back, shareData, listMetric: () => P.listMetric };
})();
if (typeof module !== 'undefined') module.exports = PonPeriods;
