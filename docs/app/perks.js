/* ============================================================
 * perks.js — 称号と着せ替え（ダッシュボード側）
 *
 * ・作者ジァン=サマー（@jeanjeanjean）をフォローすると使える
 * ・彼の記事へのスキ／コメント／引用で、特別な称号と着せ替えが増える
 * ・「海賊王」は @jeanjeanjean 本人だけ
 * ・判定の元データは perk-collect.js（note.com上で確認）と、Ponに記録した本文
 * ============================================================ */
(() => {
  'use strict';
  const CAPTAIN = 'jeanjeanjean';
  const CAPTAIN_NAME = 'ジァン=サマー';
  const QUOTE_RE = /note\.com\/jeanjeanjean\/n\/n[0-9a-z]+/i;
  const MAX_TITLE = 16;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isWeb = () => self.PON_ENV === 'web';

  /* ---------- 称号 ---------- */
  const GROUPS = [
    { name: '海賊', titles: ['見習い水夫', '甲板員', '見張り番', '砲撃手', '狙撃手', '操舵手', '航海士', '船医', 'コック', '音楽家', '考古学者', '船大工', '副船長', '船長', '大海賊', '伝説の海賊'] },
    { name: '海軍', titles: ['海軍二等兵', '海軍軍曹', '海軍少尉', '海軍大尉', '海軍大佐', '海軍少将', '海軍中将', '海軍大将', '元帥'] },
    { name: '海の住人', titles: ['賞金稼ぎ', '情報屋', '灯台守', '冒険家', '革命家', '謎の旅人', '酒場の主人', '造船技師', '密航者', '人魚の友'] },
  ];

  /** 特別な称号（解放条件つき）。need(u) が true なら使える */
  const SPECIALS = [
    { id: 'follow',   title: 'ジァン=サマー海賊団 船員',   how: '@jeanjeanjean をフォロー',            need: (u) => u.following,                     prog: (u) => [u.following ? 1 : 0, 1] },
    { id: 'like1',    title: '宝の目利き',                 how: '彼の記事にスキ（1記事）',             need: (u) => u.liked >= 1,                    prog: (u) => [u.liked, 1] },
    { id: 'like5',    title: 'ジァン=サマー海賊団 甲板長', how: '彼の記事にスキ（5記事）',             need: (u) => u.liked >= 5,                    prog: (u) => [u.liked, 5] },
    { id: 'likeAll',  title: '全航路の踏破者',             how: '彼の全記事にスキ（5記事以上あるとき）', need: (u) => u.total >= 5 && u.liked >= u.total, prog: (u) => [u.liked, Math.max(u.total, 5)] },
    { id: 'comment1', title: '酒場の語り部',               how: '彼の記事にコメント（1記事）',         need: (u) => u.commented >= 1,                prog: (u) => [u.commented, 1] },
    { id: 'comment3', title: 'ジァン=サマー海賊団 伝令係', how: '彼の記事にコメント（3記事）',         need: (u) => u.commented >= 3,                prog: (u) => [u.commented, 3] },
    { id: 'quote1',   title: '海図の写し手',               how: '自分の記事で彼の記事を引用（1記事）', need: (u) => u.quoted >= 1,                   prog: (u) => [u.quoted, 1] },
    { id: 'quote3',   title: 'ジァン=サマー海賊団 副船長', how: '自分の記事で彼の記事を引用（3記事）', need: (u) => u.quoted >= 3,                   prog: (u) => [u.quoted, 3] },
    { id: 'trinity',  title: 'ジァン=サマー海賊団 右腕',   how: 'スキ・コメント・引用をそれぞれ1記事以上', need: (u) => u.liked >= 1 && u.commented >= 1 && u.quoted >= 1, prog: (u) => [(u.liked > 0) + (u.commented > 0) + (u.quoted > 0), 3] },
    { id: 'captain',  title: '海賊王',                     how: 'ジァン=サマー（@jeanjeanjean）本人だけ', need: (u) => u.captain,                    prog: (u) => [u.captain ? 1 : 0, 1], secret: true },
  ];

  /* ---------- 着せ替え ---------- */
  const THEMES = [
    { id: 'standard', name: '標準',         logo: '⚓', desc: 'いつものPon',                         need: () => true,                   how: '',
      sw: { head: '#fcfcfb', bg: '#f6f6f4', card: '#fcfcfb', accent: '#2a78d6', ink: '#0b0b0b' } },
    { id: 'pirate',   name: '海賊船',       logo: '🏴‍☠️', desc: '羊皮紙と木の甲板。暗い画面では船長室に', need: (u) => u.following,           how: 'フォローで解放',
      sw: { head: '#4a2f17', bg: '#efe2c4', card: '#f8efd9', accent: '#8e2a1c', ink: '#2b1d0e' } },
    { id: 'navy',     name: '海軍本部',     logo: '⚓', desc: '白い制服と紺の旗。規律正しく',         need: (u) => u.following,           how: 'フォローで解放',
      sw: { head: '#13294b', bg: '#eef2f7', card: '#ffffff', accent: '#1b3a6b', ink: '#0d1b2e' } },
    { id: 'treasure', name: '黄金の宝島',   logo: '🗺️', desc: '宝の地図と金貨の輝き',                 need: (u) => SPECIALS.find((x) => x.id === 'trinity').need(u),   how: 'スキ・コメント・引用をそれぞれ1記事以上で解放',
      sw: { head: '#8a6206', bg: '#fbf6e6', card: '#fffdf5', accent: '#a67c00', ink: '#2a2208' } },
    { id: 'king',     name: '海賊王の旗艦', logo: '👑', desc: '漆黒と真紅と黄金',                     need: (u) => u.captain,             how: '@jeanjeanjean 本人だけ',
      sw: { head: '#0d0b0a', bg: '#1a1512', card: '#241d18', accent: '#c9a227', ink: '#f3e7c9' } },
  ];

  /* ---------- 状態 ---------- */
  const P = { perk: null, profile: { theme: 'standard', title: '', custom: '' }, quotedKeysFromBodies: [], u: null, loaded: false };

  function unlocks(me) {
    const captain = !!(me && me.urlname === CAPTAIN);
    const perk = P.perk && me && P.perk.urlname === me.urlname ? P.perk : null;
    const quoted = new Set([...(perk ? perk.quotedKeys || [] : []), ...P.quotedKeysFromBodies || []]).size;
    const u = {
      captain,
      following: captain || !!(perk && perk.following),
      total: perk ? perk.total || 0 : 0,
      liked: perk ? (perk.likedKeys || []).length : 0,
      commented: perk ? (perk.commentedKeys || []).length : 0,
      quoted,
      checkedAt: perk ? perk.checkedAt : 0,
    };
    if (captain) Object.assign(u, { liked: 99, commented: 99, quoted: 99, total: 99 });
    return u;
  }

  /** 自由入力の称号：「海賊王」と作者の名前は名乗れない（本人を除く） */
  const BANNED = ['海賊王', '海賊の王', 'パイレーツキング', 'pirateking', 'kingofpirates', 'ジァン=サマー', 'ジャン=サマー', 'ジァンサマー', 'ジャンサマー', 'jeanjeanjean'];
  function normalize(s) { return String(s || '').normalize('NFKC').replace(/[\s・･.\-_ー〜~]/g, '').toLowerCase(); }
  function customProblem(text, u) {
    const t = String(text || '').trim();
    if (!t) return '';
    if ([...t].length > MAX_TITLE) return `${MAX_TITLE}文字までにしてください。`;
    if (!u.captain && BANNED.some((b) => normalize(t).includes(normalize(b)))) return '「海賊王」と作者の名前は、ジァン=サマー本人だけが名乗れます。';
    return '';
  }

  function availableTitles(u) {
    if (!u.following) return [];
    return [...GROUPS.flatMap((g) => g.titles), ...SPECIALS.filter((s) => s.need(u)).map((s) => s.title)];
  }

  /** いま表示する称号（使えなくなっていたら出さない） */
  function currentTitle(u) {
    if (!u.following) return '';
    const pr = P.profile;
    if (pr.title === '__custom') return customProblem(pr.custom, u) ? '' : String(pr.custom || '').trim();
    return availableTitles(u).includes(pr.title) ? pr.title : '';
  }
  function currentTheme(u) {
    const t = THEMES.find((x) => x.id === P.profile.theme);
    return t && t.need(u) ? t : THEMES[0];
  }

  function applyTheme(t) {
    const html = document.documentElement;
    if (t.id === 'standard') delete html.dataset.theme; else html.dataset.theme = t.id;
    const logo = document.querySelector('.top .logo');
    if (logo) logo.textContent = t.logo;
    try { localStorage.setItem('pon.theme', t.id); } catch (_) { /* 次回のちらつき防止用。なくても動く */ }
  }

  async function load() {
    const [perk, profile, bodies] = await Promise.all([NDB.kvGet('perk', null), NDB.kvGet('profile', null), NDB.getAll('bodies')]);
    P.perk = perk;
    P.profile = { theme: 'standard', title: '', custom: '', ...(profile || {}) };
    P.quotedKeysFromBodies = bodies.filter((b) => b && b.html && QUOTE_RE.test(b.html)).map((b) => b.noteKey);
    P.loaded = true;
  }
  const saveProfile = () => NDB.kvSet('profile', P.profile);

  /* ---------- 画面 ---------- */
  function me() { return (typeof S !== 'undefined' && S.me) || null; }

  function renderHeader(u) {
    const who = $('#whoami');
    if (!who) return;
    who.querySelectorAll('.title-chip').forEach((x) => x.remove());
    const t = currentTitle(u);
    if (t && me()) {
      const chip = document.createElement('span');
      chip.className = 'title-chip';
      chip.textContent = t;
      who.prepend(chip);
    }
  }

  function bountyOf() {
    const snaps = (typeof S !== 'undefined' && S.snapshots) || [];
    const s = snaps[snaps.length - 1];
    if (!s) return 0;
    const sum = (k) => s.items.reduce((a, i) => a + (i[k] || 0), 0);
    return Math.round((sum('pv') * 10 + sum('like') * 1000 + sum('comment') * 3000) / 1000) * 1000;
  }

  function renderStatus(u) {
    const el = $('#perkStatus');
    const when = u.checkedAt ? `最終確認：${new Date(u.checkedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'まだ確認していません';
    const checkBtn = isWeb()
      ? `<a class="btn" href="https://note.com/" target="_blank" rel="noopener">noteで「Ponで記録」をタップして確認</a>`
      : `<button class="btn" data-action="perk-check">フォローとスキ・コメントを確認する</button>`;
    if (u.captain) {
      el.innerHTML = `<h2>👑 海賊王 ${CAPTAIN_NAME} 様</h2><p>すべての称号と着せ替えが使えます。</p>`;
    } else if (u.following) {
      el.innerHTML = `<h2>🏴‍☠️ ジァン=サマー海賊団へようこそ</h2>
        <p>フォローありがとうございます。称号と着せ替えが使えます。彼の記事にスキ・コメント・引用をすると、特別な称号が増えます。</p>
        <p class="btn-row">${checkBtn} <span class="meta" id="perkRun">${esc(when)}</span></p>
        <p class="hint">フォロー・スキ・コメントは週に1回、引用は記録のたびに少しずつ、自動で確認します（noteへのアクセスは1秒以上の間隔）。</p>`;
    } else {
      el.innerHTML = `<h2>🔒 称号と着せ替えは、フォローで解放</h2>
        <p>作者 <b>${CAPTAIN_NAME}</b>（<a href="https://note.com/${CAPTAIN}" target="_blank" rel="noopener">@${CAPTAIN}</a>）のnoteをフォローすると、海賊や海軍の称号を名乗れたり、画面を海賊船風に着せ替えたりできます。</p>
        <p class="btn-row"><a class="btn primary" href="https://note.com/${CAPTAIN}" target="_blank" rel="noopener">noteでフォローする</a> ${checkBtn} <span class="meta" id="perkRun">${esc(when)}</span></p>
        <p class="hint">フォローしたあと、右のボタンで確認すると解放されます。ほかの機能はフォローしなくても、これまでどおりすべて使えます。</p>`;
    }
  }

  function renderTitle(u) {
    const sel = $('#titleSel'), custom = $('#titleCustom'), msg = $('#titleMsg');
    const locked = !u.following;
    const specials = SPECIALS.filter((s) => s.need(u));
    sel.innerHTML = '<option value="">（称号なし）</option>'
      + (specials.length ? `<optgroup label="特別な称号">${specials.map((s) => `<option>${esc(s.title)}</option>`).join('')}</optgroup>` : '')
      + GROUPS.map((g) => `<optgroup label="${esc(g.name)}">${g.titles.map((t) => `<option>${esc(t)}</option>`).join('')}</optgroup>`).join('')
      + '<option value="__custom">自由に名乗る…</option>';
    const pr = P.profile;
    sel.value = pr.title === '__custom' || availableTitles(u).includes(pr.title) ? pr.title : '';
    sel.disabled = locked;
    custom.hidden = sel.value !== '__custom';
    custom.value = pr.custom || '';
    custom.disabled = locked;
    const problem = sel.value === '__custom' ? customProblem(custom.value, u) : '';
    msg.textContent = locked ? '🔒 フォローすると選べます。' : problem;
    msg.classList.toggle('bad', !!problem);
  }

  function renderWanted(u) {
    const m = me();
    const t = currentTitle(u);
    const b = bountyOf();
    $('#wanted').innerHTML = `
      <div class="w-head">WANTED</div>
      <div class="w-photo" aria-hidden="true">${esc(currentTheme(u).logo)}</div>
      <div class="w-title">${esc(t || '称号なし')}</div>
      <div class="w-name">${esc(m ? m.nickname : '名無しの船乗り')}</div>
      <div class="w-bounty"><span>懸賞金</span> ${b.toLocaleString('ja-JP')}</div>
      <div class="w-foot">Pirates of note</div>`;
  }

  function renderThemes(u) {
    const cur = currentTheme(u).id;
    $('#themeList').innerHTML = THEMES.filter((t) => t.id !== 'king' || u.captain).map((t) => {
      const ok = t.need(u);
      const s = t.sw;
      return `<button class="theme-opt" data-theme-pick="${t.id}" aria-pressed="${t.id === cur}" ${ok ? '' : 'disabled'}>
        <span class="tp" style="background:${s.bg}">
          <span class="tp-head" style="background:${s.head}"></span>
          <span class="tp-card" style="background:${s.card};border-color:${s.accent}"><i style="background:${s.accent}"></i><i style="background:${s.ink};opacity:.35"></i></span>
        </span>
        <span class="tp-name">${esc(t.logo)} ${esc(t.name)}${ok ? '' : ' 🔒'}</span>
        <span class="tp-desc">${esc(ok ? t.desc : t.how)}</span>
      </button>`;
    }).join('');
  }

  function renderUnlocks(u) {
    $('#unlockList').innerHTML = SPECIALS.filter((s) => !s.secret || u.captain).map((s) => {
      const ok = s.need(u);
      const [a, b] = s.prog(u);
      const pct = Math.max(0, Math.min(100, Math.round((Math.min(a, b) / b) * 100)));
      return `<li class="${ok ? 'ok' : ''}">
        <span class="u-mark">${ok ? '🏅' : '🔒'}</span>
        <span class="u-body"><b>${esc(s.title)}</b><span class="meta">${esc(s.how)}</span></span>
        <span class="u-prog">${u.captain ? '' : `${Math.min(a, b)} / ${b}`}<span class="u-bar"><span style="width:${pct}%"></span></span></span>
      </li>`;
    }).join('') + (u.captain ? '' : `<li class="king"><span class="u-mark">👑</span><span class="u-body"><b>海賊王</b><span class="meta">この称号を名乗れるのは、ジァン=サマー（@jeanjeanjean）ただ一人。</span></span><span class="u-prog"></span></li>`);
  }

  function render() {
    if (!P.loaded) return;
    const u = unlocks(me());
    P.u = u;
    applyTheme(currentTheme(u));
    renderHeader(u);
    if (!$('#tab-crew')) return;
    renderStatus(u);
    renderTitle(u);
    renderWanted(u);
    renderThemes(u);
    renderUnlocks(u);
  }

  function bind() {
    const tab = $('#tab-crew');
    if (!tab) return;
    $('#titleSel').addEventListener('change', async (e) => {
      P.profile.title = e.target.value;
      if (e.target.value === '__custom') setTimeout(() => $('#titleCustom').focus(), 0);
      await saveProfile(); render();
    });
    let t;
    $('#titleCustom').addEventListener('input', (e) => {
      P.profile.custom = e.target.value;
      clearTimeout(t);
      t = setTimeout(async () => {
        await saveProfile();
        const u = P.u;
        const problem = customProblem(P.profile.custom, u);
        $('#titleMsg').textContent = problem; $('#titleMsg').classList.toggle('bad', !!problem);
        renderHeader(u); renderWanted(u);
      }, 250);
    });
    tab.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-theme-pick]');
      if (b && !b.disabled) { P.profile.theme = b.dataset.themePick; await saveProfile(); render(); return; }
      const c = e.target.closest('[data-action="perk-check"]');
      if (c) {
        c.disabled = true;
        const out = $('#perkRun');
        if (out) out.textContent = 'noteで確認しています…（数秒〜1分）';
        const r = await chrome.runtime.sendMessage({ type: 'RUN_PERK' });
        if (!(r && r.ok)) { if (out) out.textContent = `確認できませんでした：${(r && r.error) || '不明なエラー'}`; c.disabled = false; return; }
        // 結果を待って読み直す
        const started = Date.now();
        const before = P.perk && P.perk.checkedAt;
        const poll = setInterval(async () => {
          const p = await NDB.kvGet('perk', null);
          if ((p && p.checkedAt !== before) || Date.now() - started > 90e3) {
            clearInterval(poll);
            await load(); render();
            const out2 = $('#perkRun');
            if (out2 && Date.now() - started > 90e3 && !(p && p.checkedAt !== before)) out2.textContent = '時間がかかっています。しばらくしてからこの画面を開き直してください。';
          }
        }, 3000);
      }
    });
  }

  async function init() { await load(); bind(); render(); }

  window.PonPerks = { render, reload: async () => { await load(); render(); }, _test: { unlocks, customProblem, normalize, SPECIALS, THEMES } };
  init();
})();
