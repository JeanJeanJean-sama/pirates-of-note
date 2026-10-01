// v0.6.3 のテスト：正規版への引っ越し用ファイル・0.6.3 の復元・案内の帯・Web版・大きい記録・権限
//   node tests/run-063.mjs            … 全部
//   node tests/run-063.mjs --no-big   … 大きい記録（1000記事×3年）を飛ばす
//   Web版は先に PON_APP_URL=http://localhost:8765/ node tools/build-web.mjs で docs を作っておく（このテストが作る）
import { openExt, seedSmall, ok, summary, ROOT, chromium } from './lib.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import http from 'node:http';

const BIG = !process.argv.includes('--no-big');
const KEEP_SAMPLE = join(ROOT, 'tests', 'fixtures', 'pen-move-sample.json');
const jstYmd = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
const txt = async (dl) => { const p = await dl.path(); return readFileSync(p, 'utf8'); };
const allKeys = (o, out = []) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (!Array.isArray(o)) out.push(k); allKeys(v, out); } return out; };

/** 引っ越し用ファイルとバックアップを比べる（app・moveFrom・exportedAt・local と項目名の変更だけが違うこと） */
function compareMove(bak, mv, name) {
  ok(mv.app === 'pirates-editor-for-note', `${name}: app が新しい名前`);
  ok(mv.moveFrom && mv.moveFrom.app === 'pirates-of-note' && mv.moveFrom.version === '0.6.3' && mv.moveFrom.exportedAt === mv.exportedAt, `${name}: moveFrom（pirates-of-note・0.6.3・exportedAt）`);
  ok(mv.backupFormat === 2 && mv.version === 1, `${name}: backupFormat 2 のまま`);
  const strip = (o) => { const { app, moveFrom, exportedAt, local, ...rest } = o; return rest; };
  const rn = (o) => JSON.parse(JSON.stringify(o).replace(/"pon-web"/g, '"pen-web"'));
  ok(JSON.stringify(strip(mv)) === JSON.stringify(rn(strip(bak))), `${name}: 中身（記録・記事・stores・kv）がバックアップと同じ`);
  ok(!allKeys(mv).some((k) => /pon/i.test(k)), `${name}: 項目名に pon が残っていない`);
}

const KV_ALL = ['me', 'settings', 'dismissed', 'threadReplies', 'profile', 'perk', 'plans', 'missions', 'recordAccount', 'betaPerk'];

async function extTests() {
  console.log('■ 拡張機能版');
  const { ctx, url } = await openExt();
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.stack || e.message));
  await page.goto(url); await page.waitForSelector('#moveBanner');
  await seedSmall(page);
  await page.reload(); await page.waitForTimeout(800);

  // 1. 中身の比べ（画面の中で直接作る）
  const [bakT, mvT, mvName, lsTheme] = await page.evaluate(async () => {
    localStorage.setItem('pon.theme', 'pirate'); // 着せ替えの画面が書き直す前に、確かめる値を入れておく
    const a = await PonBackup.blob({ appVersion: ponVersion() });
    const b = await PonBackup.moveBlob({ appVersion: ponVersion() });
    return [await a.blob.text(), await b.blob.text(), b.name, localStorage.getItem('pon.theme')];
  });
  const bak = JSON.parse(bakT), mv = JSON.parse(mvT);
  compareMove(bak, mv, '小さい記録');
  ok(mvName === `pen-move-${jstYmd()}.json`, 'ファイル名 pen-move-YYYYMMDD.json');
  ok(KV_ALL.every((k) => k in mv.kv) && Object.keys(mv.kv).length === KV_ALL.length, 'kv の一覧（PonBackup.KV）のすべてが入る');
  ok(mv.kv.betaPerk && mv.kv.betaPerk.granted && mv.stores.snapshots.some((s) => s.date <= '2026-09-30'), 'β版からの特典の判定に要る記録（毎日の記録・betaPerk）が入る');
  ok(['snapshots', 'articles', 'unreplied', 'myComments', 'bodies'].every((k) => Array.isArray(mv.stores[k]) && mv.stores[k].length > 0), 'stores のすべて（記録・記事・未返信・自分のコメント・本文）が入る');
  ok(mv.stores.snapshots.length === 6 && mv.stores.snapshots.filter((s) => s.final).length === 4, '毎日の記録 6日分・確定の印も残る');
  ok(mv.local && mv.local['pen.theme'] === lsTheme && lsTheme === 'pirate' && Object.keys(mv.local).length === 1, 'ブラウザ内の小さな記録 pen.theme が入る');
  ok(!/pon/i.test(mvT), 'ファイルの中に旧名 pon が1つも無い');
  writeFileSync(KEEP_SAMPLE, JSON.stringify(mv, null, 1));

  // 2. ボタンから（設定のボタン）
  await page.click('.tabs button[data-tab="data"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#backupCard [data-action="move-file"]')]);
  ok(dl.suggestedFilename() === `pen-move-${jstYmd()}.json`, '設定のボタン：ファイル名');
  const dlt = await txt(dl); ok(JSON.parse(dlt).app === 'pirates-editor-for-note', '設定のボタン：中身が引っ越し用ファイル');
  await page.waitForSelector('.ask-ov .pop');
  const dtext = await page.textContent('.ask-ov .pop');
  ok(dtext.includes(`pen-move-${jstYmd()}.json`) && dtext.includes('ダウンロード」フォルダ') && dtext.includes('正規版（Pirates\' Editor for note）を入れて、このファイルを『復元』で読み込んでください'), '書き出した後：ファイル名・保存先・次にすること');
  await page.screenshot({ path: join(ROOT, 'tests', 'out', 'ext-書き出した後.png') });
  await page.click('.ask-ov .btn.primary');
  ok(!/保存/.test(await page.textContent('#moveBanner')) && !/保存/.test(await page.textContent('#backupCard')), 'ボタン・案内に「保存」を使っていない');

  // 3. 0.6.3 の復元：引っ越し用ファイルは読まない
  const before = await page.evaluate(() => NDB.count('snapshots'));
  writeFileSync('/tmp/pen-move.json', dlt);
  await page.setInputFiles('#importFile', '/tmp/pen-move.json');
  await page.waitForSelector('.ask-ov .pop');
  const t3 = await page.textContent('.ask-ov .pop');
  ok(t3.includes('正規版のファイルです') && t3.includes('β版のPonでは読み込めません'), '引っ越し用ファイルを復元すると「正規版のファイルです」');
  await page.screenshot({ path: join(ROOT, 'tests', 'out', 'ext-正規版のファイルです.png') });
  await page.click('.ask-ov .btn.primary');
  ok((await page.evaluate(() => NDB.count('snapshots'))) === before, '引っ越し用ファイルでは何も書き込まれない');

  // 4. 0.6.2 の形のバックアップ・古い形（旧名）は今までどおり入る
  writeFileSync('/tmp/pon-backup.json', bakT);
  await page.evaluate(async () => { for (const st of NDB.STORES) await NDB.clear(st); await NDB.kvSet('legacyMigrated', 1); await NDB.kvSet('settings', { introDone: true }); });
  await page.reload(); await page.waitForTimeout(500);
  await page.click('.tabs button[data-tab="data"]');
  await page.setInputFiles('#importFile', '/tmp/pon-backup.json');
  await page.waitForSelector('.ask-ov .pop'); await page.click('.ask-ov .btn.primary');
  await page.waitForTimeout(1500);
  const after = await page.evaluate(async () => ({ n: await NDB.count('snapshots'), kv: await Promise.all(PonBackup.KV.map((k) => NDB.kvGet(k.key, undefined))), arts: await NDB.count('articles') }));
  ok(after.n === 6 && after.arts === 2 && after.kv.every((v) => v !== undefined), '0.6.2 の形のバックアップが復元できる（記録・記事・kv）');
  const old = { app: 'note-data-notebook', version: 1, exportedAt: '2026-08-01T00:00:00Z', stores: { snapshots: [{ date: '2026-08-01', capturedAt: '2026-08-01T00:30:00Z', totals: { imp: 10, pv: 1, like: 0, comment: 0, sales: 0, articles: 1 }, items: [{ key: 'n000000000009', title: '古い記事', url: 'https://note.com/fake/n/n000000000009', status: 'published', publishedAt: '2026-07-01T00:00:00Z', imp: 10, pv: 1, like: 0, comment: 0, sales: 0 }] }], unreplied: [], myComments: [] }, kv: { me: { urlname: 'fake' } } };
  writeFileSync('/tmp/old-backup.json', JSON.stringify(old));
  await page.setInputFiles('#importFile', '/tmp/old-backup.json');
  await page.waitForSelector('.ask-ov .pop');
  // 「⬇ バックアップして復元」以外（そのまま復元）を押す
  await page.click('.ask-ov button:has-text("そのまま復元")');
  await page.waitForTimeout(1500);
  ok((await page.evaluate(() => NDB.get('snapshots', '2026-08-01'))) != null, '旧名（note-data-notebook）の古い形のバックアップも復元できる');

  // 5. 案内の帯
  await page.click('.tabs button[data-tab="overview"]');
  ok(await page.isVisible('#moveBanner'), '帯が出る');
  const bt = await page.textContent('#moveBanner');
  ok(bt.includes("Pirates of note は、正規版『Pirates' Editor for note』になりました。") && bt.includes('正規版の公開は note でお知らせします') && /①|1/.test(bt), '帯の文（名前・お知らせ）');
  ok((await page.$$('#moveBanner .move-steps li')).length === 3, '帯：移り方の3つの手順');
  ok((await page.getAttribute('#moveBanner a[href^="https://"]', 'href')) === 'https://github.com/jeanjeanjean-sama/pirates-editor-for-note', '帯：新しい場所へのリンク（定数）');
  ok(!(await page.isVisible('#moveLink')), '帯が出ている間は小さいリンクを出さない');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#moveBanner [data-action="move-file"]')]);
  ok(dl2.suggestedFilename().startsWith('pen-move-'), '帯の中のボタンでもダウンロードできる');
  await page.click('.ask-ov .btn.primary');
  await page.screenshot({ path: join(ROOT, 'tests', 'out', 'ext-帯.png') });
  await page.click('#moveBanner [data-move="close"]'); await page.waitForTimeout(300);
  ok(!(await page.isVisible('#moveBanner')) && await page.isVisible('#moveLink'), '閉じると帯が消え、小さいリンクが出る');
  await page.reload(); await page.waitForTimeout(800);
  ok(!(await page.isVisible('#moveBanner')) && await page.isVisible('#moveLink'), '開き直しても閉じたまま・小さいリンクは残る');
  await page.screenshot({ path: join(ROOT, 'tests', 'out', 'ext-閉じた後.png'), clip: { x: 0, y: 0, width: 1200, height: 160 } });
  await page.click('#moveLink'); await page.waitForTimeout(300);
  ok(await page.isVisible('#moveBanner'), '小さいリンクを押すと帯がまた出る');

  // スマホ幅
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(400);
  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.getElementById('moveBanner').getBoundingClientRect().right]);
  ok(sw[0] <= sw[1] && sw[2] <= sw[1], 'スマホ幅：横にはみ出さない');
  await page.screenshot({ path: join(ROOT, 'tests', 'out', 'ext-帯_スマホ.png') });
  // 着せ替え（暗い画面）
  await page.emulateMedia({ colorScheme: 'dark' }); await page.setViewportSize({ width: 1200, height: 900 });
  await page.screenshot({ path: join(ROOT, 'tests', 'out', 'ext-帯_暗い画面.png') });
  await page.emulateMedia({ colorScheme: 'light' });

  // 6. ほかのタブが今までどおり開ける（全体の確かめ）
  for (const t of ['overview', 'articles', 'comments', 'calendar', 'crew', 'data']) { await page.click(`.tabs button[data-tab="${t}"]`); await page.waitForTimeout(250); }
  ok(errs.length === 0, `画面にエラーが出ていない ${errs.join(' / ')}`);
  await ctx.close();
}

/** v0.6.3 追加：「推移」のグラフを「期間の動き」の日ごとの動きにまとめた（累計・フォロワー・全期間） */
async function flowTests() {
  console.log('■ 日ごとの動き（推移のグラフをまとめた）');
  const { ctx, url } = await openExt();
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.stack || e.message));
  await page.goto(url); await page.waitForSelector('#moveBanner');
  const src = readFileSync(join(ROOT, 'tools', 'make-fake-data.mjs'), 'utf8').replace(/^import .*$/mg, '').replace(/^export /mg, '').replace(/async function main[\s\S]*$/, '');
  await page.evaluate(`(async () => { ${src}
    const days = 40, last = new Date(Date.now() + 9*3600e3); last.setUTCDate(last.getUTCDate() - 1);
    const st = new Date(last); st.setUTCDate(st.getUTCDate() - (days - 1)); const start = st.toISOString().slice(0,10);
    const arts = new Map(); const out = [];
    for (let d = 0; d < days; d++) { if (d === 30) continue; const s = fakeSnapshot(d, { articles: 20, days, existing: 10, start }); for (const i of s.items) arts.set(i.key, { key: i.key, title: i.title, url: i.url, status: i.status, publishedAt: i.publishedAt, account: 'fake' }); out.push(toCompact(s)); }
    await NDB.putMany('snapshots', out); await NDB.putMany('articles', [...arts.values()]);
    await NDB.kvSet('me', { urlname: 'fake' }); await NDB.kvSet('fmt2', Date.now()); await NDB.kvSet('settings', { introDone: true, startGuideOff: true }); await NDB.kvSet('moveBannerClosed', 1);
  })()`);
  await page.reload(); await page.waitForTimeout(1200);
  ok(!(await page.$('#chartCard')), '「推移」のカードは無くなった');
  ok(await page.isVisible('#flowChart') && await page.isVisible('[data-vmode="total"]') && await page.isVisible('[data-flow="follower"]'), '日ごとの動きに「累計」と「フォロワー」がある');
  const snaps = await page.evaluate(() => S.snapshots.map((s) => ({ date: s.date, pv: s.totals.pv, f: s.followerCount })));
  const last = snaps[snaps.length - 1], prev = snaps[snaps.length - 2];
  const hover = async (sel) => { const hs = await page.$$(sel); await hs[hs.length - 1].hover(); await page.waitForTimeout(100); return page.textContent('#tooltip'); };
  // 増えた数（今までどおり）
  await page.click('[data-flow="response"]'); await page.waitForTimeout(200);
  let tip = await hover('#flowChart .hit[data-p="0"]');
  ok(tip.includes(`PV ${(last.pv - prev.pv).toLocaleString()}`), `増えた数：最後の日の PV の増えた数（${tip.trim().slice(0, 40)}）`);
  ok(await page.$$eval('#flowChart path.prev-line', (x) => x.length) > 0, '増えた数：前の期間の点線が重なる');
  // 累計
  await page.click('[data-vmode="total"]'); await page.waitForTimeout(300);
  tip = await hover('#flowChart .hit[data-p="0"]');
  ok(tip.includes(`PV 累計 ${last.pv.toLocaleString()}`) && tip.includes(`前の記録から +${(last.pv - prev.pv).toLocaleString()}`), `累計：最後の日の PV 累計と前の記録からの増えた数（${tip.trim().slice(0, 50)}）`);
  ok((await page.$$eval('#flowChart path.prev-line', (x) => x.length)) === 0, '累計：前の期間は重ねない');
  ok(await page.$eval('[data-ctype="bar"]', (b) => b.disabled), '累計：棒は押せない（線で表示）');
  ok((await page.textContent('#flowHint')).includes('累計'), '累計：説明の文');
  await page.click('[data-flow="follower"]'); await page.waitForTimeout(200);
  tip = await hover('#flowChart .hit[data-p="0"]');
  ok(tip.includes(`フォロワー 累計 ${last.f.toLocaleString()}`), 'フォロワーの累計');
  await page.reload(); await page.waitForTimeout(1000);
  ok(await page.getAttribute('[data-vmode="total"]', 'aria-pressed') === 'true', '累計の選択は開き直しても残る（設定 periodValue）');
  // 全期間
  await page.click('.period-bar [data-pk="all"]'); await page.waitForTimeout(600);
  const range = await page.textContent('#periodNav .pnav-range');
  const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`;
  ok(range.includes(md(snaps[0].date)) && range.includes(md(last.date)), `全期間：記録を始めた日〜最後の記録の日（${range.trim()}）`);
  ok(await page.$eval('[data-pnav="back"]', (b) => b.disabled), '全期間：前の期間は無い');
  const pvTile = await page.textContent('#periodBody .period-kpis .kpi:nth-child(2) .value');
  ok(pvTile.replace(/[^\d]/g, '') === String(last.pv - snaps[0].pv), `全期間：PV の伸び＝最後−最初（${pvTile}）`);
  ok((await page.$$('#flowChart .hit[data-p="0"]')).length >= 40, '全期間：全部の日が並ぶ');
  // 増えた数＋棒＋フォロワー
  await page.click('[data-vmode="diff"]'); await page.click('[data-ctype="bar"]'); await page.click('[data-flow="follower"]'); await page.waitForTimeout(300);
  ok((await page.$$('#flowChart rect.bar.c-follower')).length > 0, '棒：フォロワーの棒');
  // 設定の一覧・表示する機能
  await page.click('.tabs button[data-tab="data"]'); await page.waitForTimeout(300);
  const dataText = await page.textContent('#tab-data');
  ok(dataText.includes('期間の動きの日ごとのグラフの数え方') && !dataText.includes('推移のグラフ（全体の増えた数・累計）'), '設定の一覧に「数え方」、表示する機能から「推移のグラフ」を外した');
  await page.setViewportSize({ width: 375, height: 800 }); await page.click('.tabs button[data-tab="overview"]'); await page.waitForTimeout(400);
  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  ok(sw[0] <= sw[1], 'スマホ幅：横にはみ出さない');
  ok(errs.length === 0, `画面にエラーなし ${errs.join(' / ')}`);
  await ctx.close();
}

async function bigTest() {
  console.log('■ 大きい記録（1000記事×3年）');
  const { ctx, url } = await openExt();
  const page = await ctx.newPage();
  await page.goto(url); await page.waitForSelector('#moveBanner');
  const src = readFileSync(join(ROOT, 'tools', 'make-fake-data.mjs'), 'utf8').replace(/^import .*$/mg, '').replace(/^export /mg, '').replace(/async function main[\s\S]*$/, '');
  await page.evaluate(`(async () => { ${src}
    const arts = new Map(); let batch = [];
    for (let d = 0; d < 1095; d++) {
      const s = fakeSnapshot(d, { articles: 1000, days: 1095, existing: 1000 });
      if (d === 1094) for (const i of s.items) arts.set(i.key, { key: i.key, title: i.title, url: i.url, status: i.status, publishedAt: i.publishedAt, account: 'fake' });
      batch.push(toCompact(s)); if (batch.length === 50) { await NDB.putMany('snapshots', batch); batch = []; }
    }
    await NDB.putMany('snapshots', batch); await NDB.putMany('articles', [...arts.values()]);
    await NDB.kvSet('me', { urlname: 'fake' }); await NDB.kvSet('fmt2', Date.now());
  })()`);
  await page.reload(); await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    const t0 = performance.now(); const m = await PonBackup.moveBlob({ appVersion: ponVersion() }); const t1 = performance.now();
    const b = await PonBackup.blob({ appVersion: ponVersion() }); const t2 = performance.now();
    const j = JSON.parse(await m.blob.text());
    return { mvSize: m.blob.size, bakSize: b.blob.size, mvMs: Math.round(t1 - t0), bakMs: Math.round(t2 - t1), n: j.stores.snapshots.length, arts: j.stores.articles.length, app: j.app };
  });
  console.log('   ', JSON.stringify(r));
  ok(r.n === 1095 && r.arts === 1000 && r.app === 'pirates-editor-for-note', `大きい記録でも作れる（${(r.mvSize / 1e6).toFixed(1)}MB・${(r.mvMs / 1000).toFixed(1)}秒）`);
  ok(Math.abs(r.mvSize - r.bakSize) < 300, '大きさはバックアップとほぼ同じ');
  // 全期間・累計の日ごとの動き（1095日）
  await page.evaluate(async () => { const st = await NDB.kvGet('settings', {}); await NDB.kvSet('settings', { ...st, introDone: true, growthPeriod: { kind: 'all' }, periodValue: 'total' }); });
  const t0 = Date.now(); await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#flowChart .hit').length >= 1095 * 3, null, { timeout: 60000 });
  const ms = Date.now() - t0;
  ok(ms < 15000, `大きい記録：全期間の累計のグラフが描ける（開いてから ${(ms / 1000).toFixed(1)}秒）`);
  await ctx.close();
  return r;
}

async function webTests() {
  console.log('■ Web版');
  execSync('node tools/build-web.mjs', { cwd: ROOT, env: { ...process.env, PON_APP_URL: 'http://localhost:8765/' }, stdio: 'ignore' });
  const DOCS = join(ROOT, 'docs');
  const srv = http.createServer((q, s) => {
    let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = join(DOCS, p); if (!existsSync(f)) { s.writeHead(404); return s.end(); }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[p.match(/\.[a-z]+$/)?.[0]] || 'application/octet-stream';
    s.writeHead(200, { 'content-type': type + '; charset=utf-8' }); s.end(readFileSync(f));
  }).listen(8765);
  const br = await chromium.launch({ headless: true });
  for (const vp of [{ width: 1200, height: 900 }, { width: 375, height: 800 }]) {
    const ctx = await br.newContext({ acceptDownloads: true, viewport: vp, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.stack || e.message));
    await page.goto('http://localhost:8765/index.html'); await page.waitForSelector('#moveBanner');
    await seedSmall(page); await page.reload(); await page.waitForTimeout(800);
    const tag = vp.width < 500 ? 'スマホ' : 'パソコン';
    ok(await page.isVisible('#moveBanner'), `Web版（${tag}）：帯が出る`);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#moveBanner [data-action="move-file"]')]);
    const j = JSON.parse(await txt(dl));
    const ls = await page.evaluate(() => localStorage.getItem('pon.theme'));
    ok(dl.suggestedFilename() === `pen-move-${jstYmd()}.json` && j.app === 'pirates-editor-for-note' && j.source === 'pen-web' && j.local['pen.theme'] === ls && !!ls, `Web版（${tag}）：引っ越し用ファイルを作れる（source は pen-web）`);
    ok(KV_ALL.every((k) => k in j.kv) && !/pon/i.test(JSON.stringify(j)), `Web版（${tag}）：kv のすべて・旧名なし`);
    const t = await page.textContent('.ask-ov .pop');
    ok(t.includes('ファイル名') && t.includes('スマホは'), `Web版（${tag}）：書き出した後の表示`);
    await page.screenshot({ path: join(ROOT, 'tests', 'out', `web-書き出した後_${tag}.png`) });
    await page.click('.ask-ov .btn.primary');
    ok(await page.evaluate(() => NDB.kvGet('lastBackupAt', 0)) > 0, `Web版（${tag}）：バックアップの催促の日付が進む`);
    writeFileSync('/tmp/pen-move-web.json', JSON.stringify(j));
    await page.click('.tabs button[data-tab="data"]');
    await page.setInputFiles('#importFile', '/tmp/pen-move-web.json');
    await page.waitForSelector('.ask-ov .pop');
    ok((await page.textContent('.ask-ov .pop')).includes('正規版のファイルです'), `Web版（${tag}）：引っ越し用ファイルは復元しない`);
    await page.click('.ask-ov .btn.primary');
    await page.click('.tabs button[data-tab="overview"]');
    await page.click('#moveBanner [data-move="close"]'); await page.waitForTimeout(200);
    ok(await page.isVisible('#moveLink') && !(await page.isVisible('#moveBanner')), `Web版（${tag}）：閉じた後の小さいリンク`);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok(sw[0] <= sw[1], `Web版（${tag}）：横にはみ出さない`);
    await page.click('#moveLink'); await page.waitForTimeout(200);
    await page.screenshot({ path: join(ROOT, 'tests', 'out', `web-帯_${tag}.png`) });
    ok(errs.length === 0, `Web版（${tag}）：画面にエラーなし ${errs.join(' / ')}`);
    await ctx.close();
  }
  // ブックマークレットの画面（collector.js）には足していない
  ok(!/引っ越し|Editor/.test(readFileSync(join(ROOT, 'web', 'collector.js'), 'utf8')), 'ブックマークレットの画面には足していない');
  await br.close(); srv.close();
}

function permTest() {
  console.log('■ 権限');
  const m = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  ok(m.version === '0.6.3', '版の番号 0.6.3');
  ok(JSON.stringify(m.permissions) === '["unlimitedStorage"]' && JSON.stringify(m.host_permissions) === '["https://note.com/*"]', '権限が増えていない（unlimitedStorage と https://note.com/* のまま）');
}

execSync(`mkdir -p ${join(ROOT, 'tests', 'out')}`);
permTest();
await extTests();
await flowTests();
if (BIG) await bigTest();
await webTests();
summary();
