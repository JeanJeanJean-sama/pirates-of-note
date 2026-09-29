/* ============================================================
 * calendar.js — カレンダー（v0.6.0 ⑨）
 *  ・月の表示。投稿した日は、最後の記録の記事の公開日（日本時間）から自動で出す
 *  ・予定を手で入れる：「投稿予定」（日付・題名・メモ）と「コンテスト」（名前・締切日・URL・メモ）
 *  ・通知（alarms・notifications 権限）は使わない。画面を開いたときに「近い締切」を表示するだけ
 *  ・予定は kv の 'plans' に記録（バックアップに含める。項目を足すだけ）
 * 計算の部分（PonCalendar.calc）は画面に依存しない（テストで直接呼べる）。
 * ============================================================ */
'use strict';

const PonCalendar = (() => {
  const SOON_DAYS = 14; // 「近い締切」に出す日数（今日から）
  const jstDay = (iso) => { const t = new Date(iso); return Number.isNaN(t.getTime()) ? '' : new Date(t.getTime() + 9 * 3600e3).toISOString().slice(0, 10); };
  const todayJst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const diffDays = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);
  const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const isUrl = (s) => { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch (_) { return false; } };

  /** 月の表の日付（日曜はじまり・6週まで）。ym='YYYY-MM' */
  function monthCells(ym) {
    const first = `${ym}-01`;
    const dow = new Date(`${first}T00:00:00Z`).getUTCDay();
    const start = addDays(first, -dow);
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const weeks = Math.ceil((dow + Number(last.slice(8))) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => { const d = addDays(start, i); return { date: d, inMonth: d.slice(0, 7) === ym }; });
  }
  const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };

  /** 投稿した日：日付 → 記事の一覧（最後の記録から） */
  function postedByDay(snaps) {
    const last = snaps[snaps.length - 1];
    const m = new Map();
    for (const i of (last && last.items) || []) {
      const d = jstDay(i.publishedAt);
      if (!d) continue;
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(i);
    }
    return m;
  }

  /** 予定の入力を確かめる。問題があれば文、なければ '' */
  function planProblem(p) {
    if (!p || (p.kind !== 'post' && p.kind !== 'contest')) return '種類を選んでください。';
    if (!isDay(p.date)) return p.kind === 'contest' ? '締切日を入れてください。' : '日付を入れてください。';
    if (!String(p.title || '').trim()) return p.kind === 'contest' ? 'コンテストの名前を入れてください。' : '題名を入れてください。';
    if ([...String(p.title)].length > 100) return '題名（名前）は100文字までにしてください。';
    if ([...String(p.memo || '')].length > 1000) return 'メモは1000文字までにしてください。';
    if (p.url && !isUrl(p.url)) return 'URLは https:// で始まる形で入れてください。';
    return '';
  }

  /** 近い締切：今日〜SOON_DAYS 日後のコンテストの締切（終わったものは除く）と、今日〜7日後の投稿予定 */
  function soon(plans, today, days = SOON_DAYS) {
    return plans.filter((p) => !p.done && isDay(p.date) && p.date >= today && diffDays(today, p.date) <= (p.kind === 'contest' ? days : 7))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'contest' ? -1 : 1));
  }

  const calc = { monthCells, shiftMonth, postedByDay, planProblem, soon, jstDay, diffDays };
  if (typeof document === 'undefined') return { calc };

  /* ==================== 画面 ==================== */
  const C = { ym: todayJst().slice(0, 7), plans: [], loaded: false, edit: null };
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`;
  const KIND = { post: '投稿予定', contest: 'コンテスト' };

  async function loadPlans() { C.plans = (await NDB.kvGet('plans', [])).filter((p) => p && p.id); C.loaded = true; }
  const savePlans = () => NDB.kvSet('plans', C.plans);

  function left(d, today) { const n = diffDays(today, d); return n === 0 ? '今日' : n === 1 ? '明日' : `あと${n}日`; }

  function renderSoon() {
    const today = todayJst();
    const list = soon(C.plans, today);
    const html = list.length ? `<h2>近い締切・予定</h2><ul class="soon-list">${list.map((p) => `<li><span class="tag ${p.kind}">${KIND[p.kind]}</span>
        <b>${esc(left(p.date, today))}</b>（${esc(md(p.date))}・${WD[new Date(`${p.date}T00:00:00Z`).getUTCDay()]}）
        ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)}</li>`).join('')}</ul>` : '';
    const box = $('#calSoon');
    if (box) { box.hidden = !list.length; box.innerHTML = html; }
    // 概要ページの上にも出す（コンテストの締切だけ。7日以内）
    const ban = $('#soonBanner');
    const urgent = list.filter((p) => p.kind === 'contest' && diffDays(today, p.date) <= 7);
    if (ban) {
      ban.hidden = !urgent.length || !S.snapshots.length;
      ban.innerHTML = urgent.length ? `📅 近い締切：${urgent.map((p) => `<b>${esc(p.title)}</b>（${esc(left(p.date, today))}）`).join('、')}　<button type="button" class="btn small" data-cal="open">カレンダーを見る</button>` : '';
    }
    const badge = $('#deadlineBadge');
    if (badge) { const n = list.filter((p) => p.kind === 'contest').length; badge.hidden = !n; badge.textContent = n; }
  }

  function renderMonth() {
    const grid = $('#calGrid');
    if (!grid) return;
    const today = todayJst();
    const posted = postedByDay(S.snapshots);
    const byDay = new Map();
    for (const p of C.plans) { if (!byDay.has(p.date)) byDay.set(p.date, []); byDay.get(p.date).push(p); }
    const [y, m] = C.ym.split('-').map(Number);
    $('#calTitle').textContent = `カレンダー　${y}年${m}月`;
    const cells = monthCells(C.ym);
    grid.innerHTML = WD.map((w, i) => `<div class="cal-wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}" role="columnheader">${w}</div>`).join('')
      + cells.map((c) => {
        const ps = posted.get(c.date) || [], pl = (byDay.get(c.date) || []).slice().sort((a, b) => (a.kind === 'contest' ? -1 : 1));
        const items = [
          ...ps.map((i) => `<button type="button" class="cal-item posted" data-cal-card="${esc(i.key)}" title="${esc(i.title)}">${esc(i.title)}</button>`),
          ...pl.map((p) => `<button type="button" class="cal-item ${p.kind}${p.done ? ' done' : ''}" data-cal-edit="${esc(p.id)}" title="${esc(KIND[p.kind])}：${esc(p.title)}">${p.kind === 'contest' ? '締切 ' : ''}${esc(p.title)}</button>`),
        ];
        const dow = new Date(`${c.date}T00:00:00Z`).getUTCDay();
        return `<div class="cal-cell${c.inMonth ? '' : ' out'}${c.date === today ? ' today' : ''}" role="gridcell" aria-label="${esc(c.date)}${ps.length ? `、投稿${ps.length}本` : ''}${pl.length ? `、予定${pl.length}件` : ''}">
          <button type="button" class="cal-day${dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}" data-cal-day="${c.date}" title="この日に予定を足す">${+c.date.slice(8)}</button>
          <div class="cal-items">${items.join('')}</div></div>`;
      }).join('');

    // 月の一覧（予定と投稿を日付順に）
    const rows = [];
    for (const [d, list] of posted) if (d.slice(0, 7) === C.ym) for (const i of list) rows.push({ d, html: `<span class="tag posted">投稿</span><button type="button" class="linkish" data-cal-card="${esc(i.key)}">${esc(i.title)}</button>` });
    for (const p of C.plans) if (p.date.slice(0, 7) === C.ym) rows.push({ d: p.date, html: `<span class="tag ${p.kind}">${KIND[p.kind]}${p.kind === 'contest' ? '（締切）' : ''}</span><button type="button" class="linkish${p.done ? ' done' : ''}" data-cal-edit="${esc(p.id)}">${esc(p.title)}</button>${p.url ? ` <a class="meta" href="${esc(p.url)}" target="_blank" rel="noopener">ページを開く ↗</a>` : ''}${p.memo ? `<span class="meta cal-memo">${esc(p.memo)}</span>` : ''}` });
    rows.sort((a, b) => a.d.localeCompare(b.d));
    $('#calList').innerHTML = rows.length ? rows.map((r) => `<li><span class="cal-date">${esc(md(r.d))}（${WD[new Date(`${r.d}T00:00:00Z`).getUTCDay()]}）</span>${r.html}</li>`).join('') : '<li class="meta">この月の予定と投稿はありません。</li>';
  }

  /* 予定の入力（ポップアップ） */
  function openEdit(p) {
    C.edit = p;
    let ov = $('#planPop');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'planPop'; ov.className = 'pop-ov';
      ov.innerHTML = '<div class="pop plan-pop" role="dialog" aria-modal="true" aria-labelledby="planTitle"></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', (e) => { if (e.target === ov) closeEdit(); });
    }
    const isNew = !C.plans.some((x) => x.id === p.id);
    const contest = p.kind === 'contest';
    ov.querySelector('.pop').innerHTML = `<div class="pop-head"><h3 id="planTitle">${isNew ? '予定を足す' : '予定を直す'}</h3><button type="button" class="btn small" data-plan="close" aria-label="閉じる">×</button></div>
      <div class="plan-form">
        <div class="seg" role="group" aria-label="種類"><button type="button" data-plan-kind="post" aria-pressed="${!contest}">投稿予定</button><button type="button" data-plan-kind="contest" aria-pressed="${contest}">コンテスト</button></div>
        <label>${contest ? '締切日' : '日付'}<input type="date" id="planDate" value="${esc(p.date || '')}"></label>
        <label>${contest ? 'コンテストの名前' : '題名'}<input type="text" id="planName" maxlength="100" value="${esc(p.title || '')}" placeholder="${contest ? '例：◯◯コンテスト' : '例：旅の記事の続き'}"></label>
        ${contest ? `<label>URL（コンテストのページ）<input type="url" id="planUrl" value="${esc(p.url || '')}" placeholder="https://note.com/..."></label>` : ''}
        <label>メモ<textarea id="planMemo" rows="3" maxlength="1000">${esc(p.memo || '')}</textarea></label>
        ${isNew ? '' : `<label class="check"><input type="checkbox" id="planDone" ${p.done ? 'checked' : ''}> ${contest ? '応募した・終わった（近い締切に出さない）' : '投稿した・終わった（近い締切に出さない）'}</label>`}
        <p class="meta warn" id="planMsg" role="status"></p>
        <p class="btn-row"><button type="button" class="btn primary" data-plan="save">この内容で記録</button>${isNew ? '' : '<button type="button" class="btn danger" data-plan="delete">この予定を消す</button>'}</p>
      </div>`;
    ov.hidden = false;
    document.body.classList.add('pop-open');
    const f = $('#planName'); if (f) f.focus();
  }
  function closeEdit() { const ov = $('#planPop'); if (ov) ov.hidden = true; document.body.classList.remove('pop-open'); C.edit = null; }
  const readForm = () => ({ ...C.edit, date: $('#planDate').value, title: $('#planName').value.trim(), url: $('#planUrl') ? $('#planUrl').value.trim() : '', memo: $('#planMemo').value, done: $('#planDone') ? $('#planDone').checked : !!C.edit.done });

  async function saveEdit() {
    const p = readForm();
    if (p.kind !== 'contest') delete p.url;
    const bad = planProblem(p);
    if (bad) { $('#planMsg').textContent = bad; return; }
    p.updatedAt = Date.now();
    const i = C.plans.findIndex((x) => x.id === p.id);
    if (i >= 0) C.plans[i] = p; else C.plans.push(p);
    await savePlans();
    C.ym = p.date.slice(0, 7);
    closeEdit(); renderAll2();
  }
  async function deleteEdit() {
    if (!confirm(`「${C.edit.title}」を消します。よろしいですか？`)) return;
    C.plans = C.plans.filter((x) => x.id !== C.edit.id);
    await savePlans(); closeEdit(); renderAll2();
  }
  const newPlan = (date) => ({ id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: 'post', date: date || todayJst(), title: '', memo: '', createdAt: Date.now() });

  function renderAll2() { renderSoon(); renderMonth(); }
  async function render() { await loadPlans(); renderAll2(); }

  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-cal],[data-cal-day],[data-cal-edit],[data-cal-card],[data-plan],[data-plan-kind]');
    if (!t) return;
    if (t.dataset.cal) {
      const a = t.dataset.cal;
      if (a === 'prev') C.ym = shiftMonth(C.ym, -1); else if (a === 'next') C.ym = shiftMonth(C.ym, 1); else if (a === 'today') C.ym = todayJst().slice(0, 7);
      else if (a === 'add') { openEdit(newPlan(C.ym === todayJst().slice(0, 7) ? todayJst() : `${C.ym}-01`)); return; }
      else if (a === 'open') { const b = $('.tabs button[data-tab="calendar"]'); if (b) b.click(); return; }
      renderMonth(); return;
    }
    if (t.dataset.calDay) { openEdit(newPlan(t.dataset.calDay)); return; }
    if (t.dataset.calEdit) { const p = C.plans.find((x) => x.id === t.dataset.calEdit); if (p) openEdit({ ...p }); return; }
    if (t.dataset.calCard) { window.PonViews.focus(t.dataset.calCard); return; }
    if (t.dataset.planKind && C.edit) { const cur = readForm(); openEdit({ ...cur, kind: t.dataset.planKind }); return; }
    if (t.dataset.plan === 'close') closeEdit();
    else if (t.dataset.plan === 'save') saveEdit();
    else if (t.dataset.plan === 'delete') deleteEdit();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && C.edit) closeEdit(); });

  return { calc, render };
})();
if (typeof module !== 'undefined') module.exports = PonCalendar;
