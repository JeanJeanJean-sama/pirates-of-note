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
  const MAX_EPITHET = 12;
  /** 二つ名の候補（v0.6.0 ⑧）。作品の固有の呼び名は並べず、一般的な言葉だけにする（2026/9/29 利用者が決定） */
  const EPITHET_IDEAS = ['鉄壁の', '暴君', '大参謀', '鉄拳の', '道化の', '泥棒猫', '船斬り'];
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isWeb = () => self.PON_ENV === 'web';
  /** Pon のロゴ（コンパス。brand/pon-logo.svg と同じ形。v0.6.0） */
  const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Pon"><defs><linearGradient id="ponlg" gradientUnits="userSpaceOnUse" x1="14" y1="86" x2="86" y2="14"><stop offset="0" stop-color="#14c3ea"/><stop offset="0.5" stop-color="#3a7df6"/><stop offset="1" stop-color="#7b57f2"/></linearGradient><mask id="ponlm" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><circle cx="50" cy="50" r="37.8" fill="none" stroke="#fff" stroke-width="4.6"/><path d="M50.00,3.00L44.75,33.50L55.25,33.50Z M50.00,97.00L55.25,66.50L44.75,66.50Z M98.00,50.00L70.50,44.75L70.50,55.25Z M2.00,50.00L29.50,55.25L29.50,44.75Z M81.11,18.89L68.10,28.79L71.21,31.90Z M81.11,81.11L71.21,68.10L68.10,71.21Z M18.89,81.11L31.90,71.21L28.79,68.10Z M18.89,18.89L28.79,31.90L31.90,28.79Z" fill="#000" stroke="#000" stroke-width="2.6" stroke-linejoin="round"/><circle cx="50" cy="50" r="27.8" fill="none" stroke="#fff" stroke-width="2.7"/><path d="M50.00,3.00L44.75,33.50L55.25,33.50Z M50.00,97.00L55.25,66.50L44.75,66.50Z M98.00,50.00L70.50,44.75L70.50,55.25Z M2.00,50.00L29.50,55.25L29.50,44.75Z" fill="#000" stroke="#000" stroke-width="2.6" stroke-linejoin="round"/><path d="M50.00,3.00L44.75,33.50L55.25,33.50Z M50.00,97.00L55.25,66.50L44.75,66.50Z M98.00,50.00L70.50,44.75L70.50,55.25Z M2.00,50.00L29.50,55.25L29.50,44.75Z M81.11,18.89L68.10,28.79L71.21,31.90Z M81.11,81.11L71.21,68.10L68.10,71.21Z M18.89,81.11L31.90,71.21L28.79,68.10Z M18.89,18.89L28.79,31.90L31.90,28.79Z" fill="#fff"/><g transform="translate(30.200 38.580) scale(0.018828) translate(-35.0 -36.0)"><g transform="translate(0.000000,1302.000000) scale(0.100000,-0.100000)" fill="#fff" stroke="none"><path d="M376 12639 l-26 -20 0 -6043 0 -6043 21 -27 20 -26 1274 0 c1238 0 1273 1 1296 19 l24 19 5 1697 5 1697 23 18 c22 18 77 19 1285 23 1416 5 1443 6 1897 82 670 112 1349 375 1875 728 380 254 756 594 1040 942 688 840 1101 1139 1769 1278 148 30 156 31 426 31 271 0 277 -1 425 -32 329 -71 590 -186 867 -384 103 -74 129 -65 163 57 162 590 482 1195 927 1753 54 68 98 131 98 141 0 58 -341 267 -640 392 -469 196 -923 311 -1382 350 -177 16 -836 5 -953 -15 -49 -8 -142 -22 -205 -31 -63 -9 -158 -27 -210 -41 -52 -13 -101 -24 -110 -24 -22 0 -238 -61 -347 -99 -50 -17 -106 -31 -125 -31 -58 0 -67 20 -94 207 -113 807 -488 1563 -1058 2137 -175 176 -410 364 -626 500 -107 68 -358 216 -366 216 -2 0 -50 23 -106 51 -549 272 -1249 446 -1968 489 -100 6 -1156 10 -2681 10 l-2516 0 -27 -21z m5044 -2319 c466 -48 858 -215 1177 -499 295 -263 501 -685 553 -1136 89 -760 -147 -1478 -620 -1891 -275 -239 -558 -373 -960 -454 -215 -43 -391 -49 -1561 -50 -963 0 -966 0 -993 21 l-26 20 0 1978 c0 1691 2 1980 14 1997 13 17 32 19 238 25 370 10 2061 2 2178 -11z M17310 9290 c-115 -9 -512 -67 -545 -80 -13 -5 -64 -17 -112 -26 -517 -96 -1189 -401 -1598 -723 -601 -475 -1049 -1070 -1317 -1751 -45 -115 -165 -484 -178 -548 -7 -31 -20 -88 -31 -127 -10 -38 -27 -128 -39 -199 -11 -71 -22 -132 -25 -136 -3 -4 -14 -99 -25 -211 -11 -112 -22 -213 -25 -224 -2 -11 -9 -139 -15 -285 -14 -359 -27 -499 -61 -670 -120 -601 -390 -1040 -810 -1318 -124 -82 -442 -232 -492 -232 -7 0 -51 -11 -98 -25 -179 -53 -569 -75 -814 -47 -270 32 -625 152 -828 280 -325 206 -526 424 -713 772 -117 218 -155 320 -223 600 -16 63 -32 123 -36 133 -15 36 -54 19 -143 -61 -370 -330 -924 -691 -1396 -908 -161 -74 -451 -188 -560 -218 -62 -18 -106 -53 -106 -84 0 -36 53 -168 165 -412 162 -352 481 -797 805 -1121 353 -353 860 -695 1360 -917 238 -106 617 -226 855 -272 55 -10 120 -23 145 -29 45 -11 268 -39 520 -66 158 -17 670 -20 855 -5 454 37 1010 149 1286 258 30 12 107 42 171 66 441 169 960 496 1314 827 397 372 766 889 951 1334 131 315 176 451 248 755 96 407 112 539 140 1185 18 411 26 504 61 685 73 380 198 676 378 895 256 313 479 454 851 538 137 31 146 31 385 31 240 0 248 -1 380 -32 348 -82 569 -215 784 -472 247 -295 375 -631 440 -1150 l26 -206 0 -2265 c0 -1650 3 -2275 11 -2298 7 -19 22 -36 36 -42 14 -5 529 -9 1274 -9 l1250 0 24 25 25 24 0 2363 c0 2599 1 2556 -61 2968 -17 113 -42 248 -55 300 -13 52 -24 102 -24 110 0 20 -65 256 -95 345 -13 39 -33 102 -45 140 -78 255 -272 652 -452 930 -197 303 -516 633 -853 882 -150 110 -498 303 -675 373 -307 122 -563 204 -749 241 -52 10 -109 23 -125 29 -47 15 -419 68 -562 80 -141 11 -707 11 -854 0z"/></g></g></mask></defs><rect width="100" height="100" fill="url(#ponlg)" mask="url(#ponlm)"/></svg>';

  /* ---------- 称号 ---------- */
  const GROUPS = [
    { name: '海賊', titles: ['見習い水夫', '甲板員', '見張り番', '砲撃手', '狙撃手', '操舵手', '航海士', '船医', 'コック', '音楽家', '考古学者', '船大工', '副船長', '船長', '大海賊', '伝説の海賊'] },
    { name: '海軍', titles: ['海軍二等兵', '海軍軍曹', '海軍少尉', '海軍大尉', '海軍大佐', '海軍少将', '海軍中将', '海軍大将'] },
    { name: '海の住人', titles: ['賞金稼ぎ', '情報屋', '灯台守', '冒険家', '革命家', '謎の旅人', '酒場の主人', '造船技師', '密航者', '人魚の友'] },
  ];

  /** 元帥・大元帥：noteの加藤貞顕さん（@sadaaki）と深津貴之さん（@fladdict）だけが名乗れる（v0.6.0）。
   *  判定は noteの自分のID（urlname）で行う。作者本人（海賊王）も名乗れない。 */
  const ADMIRALS = ['sadaaki', 'fladdict'];
  const ADMIRAL_TITLES = ['大元帥', '元帥'];

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
    { id: 'standard', name: '標準',         logo: '🧭', svg: true, desc: 'いつものPon',                         need: () => true,                   how: '',
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
  const BETA_TITLE = (typeof PonBeta !== 'undefined' && PonBeta.TITLE) || '初航海の乗組員';
  /** β版からの特典の基準日（beta.js の BASE_DATE。1か所で管理）を「2026年9月30日」の形に */
  const betaBaseText = () => { const d = (typeof PonBeta !== 'undefined' && PonBeta.calc.BASE_DATE) || '2026-09-30'; const [y, mo, da] = d.split('-').map(Number); return `${y}年${mo}月${da}日`; };
  const BETA_MARK = (typeof PonBeta !== 'undefined' && PonBeta.MARK) || '🧭';
  const P = { beta: null, perk: null, profile: { theme: 'standard', title: '', custom: '', epithet: '' }, quotedKeysFromBodies: [], u: null, loaded: false };

  function unlocks(me) {
    const captain = !!(me && me.urlname === CAPTAIN);
    const admiral = !!(me && ADMIRALS.includes(String(me.urlname || '').toLowerCase()));
    const perk = P.perk && me && P.perk.urlname === me.urlname ? P.perk : null;
    const quoted = new Set([...(perk ? perk.quotedKeys || [] : []), ...P.quotedKeysFromBodies || []]).size;
    const u = {
      captain, admiral,
      following: captain || !!(perk && perk.following),
      total: perk ? perk.total || 0 : 0,
      liked: perk ? (perk.likedKeys || []).length : 0,
      commented: perk ? (perk.commentedKeys || []).length : 0,
      quoted,
      checkedAt: perk ? perk.checkedAt : 0,
      beta: !!(P.beta && P.beta.granted), // v0.6.1 β版からの特典（フォローしていなくても使える）
    };
    if (captain) Object.assign(u, { liked: 99, commented: 99, quoted: 99, total: 99 });
    return u;
  }

  /** 自由入力の称号：「海賊王」と作者の名前は名乗れない（本人を除く） */
  const BANNED = ['海賊王', '海賊の王', 'パイレーツキング', 'pirateking', 'kingofpirates', 'ジァン=サマー', 'ジャン=サマー', 'ジァンサマー', 'ジャンサマー', 'jeanjeanjean'];
  function normalize(s) { return String(s || '').normalize('NFKC').replace(/[\s・･.\-_ー〜~]/g, '').toLowerCase(); }
  /** 名乗れない言葉（称号の自由入力と二つ名で共通） */
  function reservedProblem(t, u) {
    if (!(u && u.captain) && BANNED.some((b) => normalize(t).includes(normalize(b)))) return '「海賊王」と作者の名前は、ジァン=サマー本人だけが名乗れます。';
    if (!(u && u.admiral) && normalize(t).includes(normalize('元帥'))) return '「元帥」「大元帥」は、noteの加藤貞顕さんと深津貴之さんだけが名乗れます。';
    return '';
  }
  function customProblem(text, u) {
    const t = String(text || '').trim();
    if (!t) return '';
    if ([...t].length > MAX_TITLE) return `${MAX_TITLE}文字までにしてください。`;
    return reservedProblem(t, u);
  }

  /** 二つ名：12文字まで・改行なし。「海賊王」と作者の名前は名乗れない（本人を除く） */
  function epithetProblem(text, u) {
    const t = String(text || '').trim();
    if (!t) return '';
    if ([...t].length > MAX_EPITHET) return `${MAX_EPITHET}文字までにしてください（今は${[...t].length}文字）。`;
    if (/[\r\n\t]/.test(t)) return '改行は使えません。';
    return reservedProblem(t, u);
  }
  /** いま表示する二つ名（問題があれば出さない） */
  function currentEpithet(u) { const t = String(P.profile.epithet || '').trim(); return t && !epithetProblem(t, u) ? t : ''; }

  function availableTitles(u) {
    const admiral = [...(u.admiral ? ADMIRAL_TITLES : []), ...(u.beta ? [BETA_TITLE] : [])];
    if (!u.following) return [...admiral];
    return [...admiral, ...GROUPS.flatMap((g) => g.titles), ...SPECIALS.filter((s) => s.need(u)).map((s) => s.title)];
  }

  /** いま表示する称号（使えなくなっていたら出さない） */
  function currentTitle(u) {
    if (!u.following && !u.admiral && !u.beta) return '';
    const pr = P.profile;
    if (!u.following && pr.title === '__custom') return '';
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
    if (logo) { if (t.svg) { if (!logo.querySelector('svg')) logo.innerHTML = LOGO_SVG; } else logo.textContent = t.logo; }
    try { localStorage.setItem('pon.theme', t.id); } catch (_) { /* 次回のちらつき防止用。なくても動く */ }
  }

  async function load() {
    const [perk, profile, bodies, beta] = await Promise.all([NDB.kvGet('perk', null), NDB.kvGet('profile', null), NDB.getAll('bodies'), NDB.kvGet('betaPerk', null)]);
    P.perk = perk;
    P.beta = beta;
    P.profile = { theme: 'standard', title: '', custom: '', epithet: '', ...(profile || {}) };
    P.quotedKeysFromBodies = bodies.filter((b) => b && b.html && QUOTE_RE.test(b.html)).map((b) => b.noteKey);
    P.loaded = true;
  }
  const saveProfile = () => NDB.kvSet('profile', P.profile);

  /* ---------- 画面 ---------- */
  function me() { return (typeof S !== 'undefined' && S.me) || null; }

  function renderHeader(u) {
    const who = $('#whoami');
    if (!who) return;
    who.querySelectorAll('.title-chip, .epithet, .beta-mark').forEach((x) => x.remove());
    const ep = currentEpithet(u);
    if (ep && me()) {
      const e = document.createElement('span');
      e.className = 'epithet';
      e.textContent = ep;
      who.prepend(e);
    }
    const t = currentTitle(u);
    if (t === BETA_TITLE && u.beta && me()) {
      const mk = document.createElement('span');
      mk.className = 'beta-mark';
      mk.textContent = BETA_MARK;
      mk.title = `${BETA_TITLE}（β版からの特典）`;
      mk.setAttribute('aria-label', mk.title);
      who.append(mk);
    }
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
    const locked = !u.following && !u.admiral && !u.beta;
    const specials = SPECIALS.filter((s) => s.need(u));
    const admiral = u.admiral ? `<optgroup label="noteの元帥">${ADMIRAL_TITLES.map((t) => `<option>${esc(t)}</option>`).join('')}</optgroup>` : '';
    const beta = u.beta ? `<optgroup label="β版からの特典"><option>${esc(BETA_TITLE)}</option></optgroup>` : '';
    sel.innerHTML = '<option value="">（称号なし）</option>' + beta + admiral
      + (!u.following ? '' : (specials.length ? `<optgroup label="特別な称号">${specials.map((s) => `<option>${esc(s.title)}</option>`).join('')}</optgroup>` : '')
      + GROUPS.map((g) => `<optgroup label="${esc(g.name)}">${g.titles.map((t) => `<option>${esc(t)}</option>`).join('')}</optgroup>`).join('')
      + '<option value="__custom">自由に名乗る…</option>');
    const pr = P.profile;
    sel.value = pr.title === '__custom' || availableTitles(u).includes(pr.title) ? pr.title : '';
    sel.disabled = locked;
    custom.hidden = sel.value !== '__custom';
    custom.value = pr.custom || '';
    custom.disabled = locked || !u.following;
    const problem = sel.value === '__custom' ? customProblem(custom.value, u) : '';
    msg.textContent = locked ? '🔒 フォローすると選べます。' : !u.following ? 'ほかの称号は、@jeanjeanjean をフォローすると選べます。' : problem;
    msg.classList.toggle('bad', !!problem);
  }

  function renderEpithet(u) {
    const inp = $('#epithetInput');
    if (!inp) return;
    if (document.activeElement !== inp) inp.value = P.profile.epithet || '';
    $('#epithetIdeas').innerHTML = `<span class="meta">候補：</span>${EPITHET_IDEAS.map((w) => `<button type="button" class="btn small" data-epi="${esc(w)}">${esc(w)}</button>`).join('')}<button type="button" class="btn small" data-epi="">なし</button>`;
    const problem = epithetProblem(inp.value, u);
    const msg = $('#epithetMsg');
    msg.textContent = problem || (inp.value.trim() ? `表示：${inp.value.trim()} ${me() ? me().nickname : ''}` : '');
    msg.classList.toggle('bad', !!problem);
  }

  function renderWanted(u) {
    const m = me();
    const t = currentTitle(u);
    const b = bountyOf();
    $('#wanted').innerHTML = `
      <div class="w-head">WANTED</div>
      <div class="w-photo" aria-hidden="true">${currentTheme(u).svg ? LOGO_SVG.replace(/ponl/g, 'ponw') : esc(currentTheme(u).logo)}</div>
      <div class="w-title">${esc(t || '称号なし')}</div>
      <div class="w-epithet">${esc(currentEpithet(u))}</div>
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
    }).join('') + `<li class="${u.beta ? 'ok' : 'king'}"><span class="u-mark">${u.beta ? '🏅' : BETA_MARK}</span><span class="u-body"><b>${esc(BETA_TITLE)}</b><span class="meta">${u.beta ? 'β版からの特典です（条件：' + betaBaseText() + 'までに記録を始めていた人）。上の「称号」から選ぶと、名前の横に印（' + BETA_MARK + '）も付きます。フォローしていなくても使えます。' : '条件：' + betaBaseText() + 'までに記録を始めていた人（記録を始めた日で自動で判定します。前に使っていたPonのバックアップを復元すると引き継げます）'}</span></span><span class="u-prog"></span></li>` + `<li class="king"><span class="u-mark">⚓</span><span class="u-body"><b>元帥・大元帥</b><span class="meta">${u.admiral ? '名乗れます。上の「称号」から選んでください。' : 'この称号を名乗れるのは、noteの加藤貞顕さん（@sadaaki）と深津貴之さん（@fladdict）だけ。'}</span></span><span class="u-prog"></span></li>` + (u.captain ? '' : `<li class="king"><span class="u-mark">👑</span><span class="u-body"><b>海賊王</b><span class="meta">この称号を名乗れるのは、ジァン=サマー（@jeanjeanjean）ただ一人。</span></span><span class="u-prog"></span></li>`);
  }

  /** opts.headerOnly：名前の前の称号と着せ替えだけ（v0.6.2 B：称号・着せ替えのタブは開いたときに描く） */
  function render(opts = {}) {
    if (!P.loaded) return;
    const u = unlocks(me());
    P.u = u;
    applyTheme(currentTheme(u));
    renderHeader(u);
    if (!$('#tab-crew') || opts.headerOnly) return;
    renderStatus(u);
    renderTitle(u);
    renderEpithet(u);
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
    let te;
    $('#epithetInput').addEventListener('input', (e) => {
      P.profile.epithet = e.target.value;
      clearTimeout(te);
      te = setTimeout(async () => { await saveProfile(); const u = P.u; renderEpithet(u); renderHeader(u); renderWanted(u); }, 250);
    });
    tab.addEventListener('click', async (e) => {
      const ep = e.target.closest('[data-epi]');
      if (ep) { P.profile.epithet = ep.dataset.epi; $('#epithetInput').value = ep.dataset.epi; await saveProfile(); render(); return; }
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

  const crewHidden = () => { const t = $('#tab-crew'); return !t || t.hidden; };
  async function init() { await load(); bind(); render({ headerOnly: crewHidden() }); }

  window.PonPerks = { render, reload: async () => { await load(); render({ headerOnly: crewHidden() }); }, _test: { unlocks, customProblem, epithetProblem, normalize, SPECIALS, THEMES, EPITHET_IDEAS } };
  init();
})();
