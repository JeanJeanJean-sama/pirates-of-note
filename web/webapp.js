/* ============================================================
 * webapp.js — Web版だけの処理（dashboard.js / views.js / bodies.js の後に読み込む）
 *  ・ブックマークレット「Ponで記録」から渡されたデータの取り込み（URLの # の後ろ）
 *  ・ブラウザに「消さないで」と申請（永続ストレージ）
 *  ・バックアップの共有（Googleドライブ等に保存）とバックアップの催促
 *  ・オフラインで開けるようにする（Service Worker）
 * ============================================================ */
'use strict';

const BACKUP_REMIND_DAYS = 14;

/* ---------- 取り込み ---------- */
async function decodePayload(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

function toast(text, isError) {
  let el = document.getElementById('ponToast');
  if (!el) { el = document.createElement('div'); el.id = 'ponToast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = text;
  el.classList.toggle('error', !!isError);
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 6000);
}

async function importFromHash() {
  const m = location.hash.match(/^#pon=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search); // データをURLに残さない
  let data;
  try {
    data = await decodePayload(m[1]);
  } catch (e) {
    toast(`データを読み込めませんでした（${e.message}）。もう一度「Ponで記録」をタップしてください。`, true);
    return;
  }
  if (!data || data.app !== 'pon-web' || !data.me || !data.snapshot) { toast('Ponのデータではありませんでした。', true); return; }

  // 別のアカウントのデータが混ざらないよう確認
  const cur = await NDB.kvGet('me', null);
  if (cur && cur.urlname && cur.urlname !== data.me.urlname) {
    if (!confirm(`この画面には @${cur.urlname} のデータが保存されています。\n@${data.me.urlname} のデータを取り込むと混ざってしまいます。取り込みますか？`)) return;
  }
  await PonStore.saveMe(data.me);
  await PonStore.saveSnapshot(data.snapshot);
  if (data.unreplied && data.unreplied.length) await PonStore.saveUnreplied(data.unreplied);
  if (data.myComments && data.myComments.length) await PonStore.saveMyComments(data.myComments);
  if (data.threadReplies && data.threadReplies.length) await PonStore.saveThreadReplies(data.threadReplies);
  if (data.perk) await NDB.kvSet('perk', data.perk);
  for (const l of data.logs || []) await PonStore.appendLog(l.level, l.message);
  await PonStore.appendLog('info', `記録を取り込みました（${data.snapshot.items.length}記事）`);
  await requestPersist();
  await load();
  if (window.PonPerks) await window.PonPerks.reload();
  toast(`記録しました（${data.snapshot.items.length}記事${data.unreplied ? `、コメント確認 ${data.unreplied.length}記事` : ''}）`);
}

/* ---------- 永続ストレージ ---------- */
async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch (_) { /* noop */ }
}

/* ---------- バックアップ ---------- */
async function buildDump() {
  const dump = { app: BACKUP_APP, version: 1, appVersion: ponVersion(), source: 'pon-web', exportedAt: new Date().toISOString(), stores: {} };
  for (const st of ['snapshots', 'unreplied', 'myComments', 'bodies']) dump.stores[st] = await NDB.getAll(st);
  dump.kv = { me: await NDB.kvGet('me', null), settings: await NDB.kvGet('settings', {}), dismissed: await NDB.kvGet('dismissed', {}), threadReplies: await NDB.kvGet('threadReplies', {}), profile: await NDB.kvGet('profile', null), perk: await NDB.kvGet('perk', null) };
  return dump;
}

async function markBackedUp() {
  await NDB.kvSet('lastBackupAt', Date.now());
  renderBackupBanner();
}

async function shareBackup() {
  const name = `pon-backup-${jstDate()}.json`;
  const file = new File([JSON.stringify(await buildDump())], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Ponのバックアップ' });
      await markBackedUp();
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 共有をキャンセル
    }
  }
  download(name, await file.text(), 'application/json');
  await markBackedUp();
}

async function renderBackupBanner() {
  const el = $('#backupBanner');
  if (!el) return;
  const [last, snaps] = await Promise.all([NDB.kvGet('lastBackupAt', 0), NDB.getAllKeys('snapshots')]);
  const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
  if (!snaps.length || (days != null && days < BACKUP_REMIND_DAYS)) { el.hidden = true; return; }
  el.innerHTML = `<p><b>バックアップをおすすめします</b>　${days == null ? 'まだバックアップしていません。' : `最後のバックアップから${days}日たちました。`}</p>
    <p class="hint">スマホのデータは、ブラウザの「Cookieとサイトデータ」の削除や機種変更で消えてしまいます。</p>
    <p><button class="btn primary" data-action="share-backup">バックアップを共有（ドライブ等に保存）</button></p>`;
  el.hidden = false;
}

/* ---------- 起動 ---------- */
ACTIONS['share-backup'] = shareBackup;
const origBackup = ACTIONS['json-backup'];
ACTIONS['json-backup'] = async (btn) => { await origBackup(btn); await markBackedUp(); };
ACTIONS['run-now'] = () => { window.open('https://note.com/', '_blank', 'noopener'); toast('noteのページで「Ponで記録」をタップしてください。'); };
$$('.importFileAlt').forEach((i) => i.addEventListener('change', (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; }));
addEventListener('hashchange', importFromHash);

(async () => {
  await importFromHash();
  renderBackupBanner();
  PonWeb.updateTitle();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
