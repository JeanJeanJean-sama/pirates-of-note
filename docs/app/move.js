/* ============================================================
 * move.js — 正規版（Pirates' Editor for note）への引っ越し（v0.6.3）
 *  ・画面の上の帯「正規版になりました」と、移り方の3つの手順
 *  ・帯は閉じられる。閉じた後も、画面の上に小さく「正規版への引っ越し」のリンクを残す（押すと帯がまた出る）
 *  ・⬇ 引っ越し用ファイル（中身は backup.js の moveBlob）と、書き出した後の案内
 * ============================================================ */
'use strict';

const PonMove = (() => {
  /** 正規版の新しい場所（0.7.0 の公開まで決まらないので、ここ1か所で管理する） */
  const NEW_URL = 'https://github.com/jeanjeanjean-sama/pirates-editor-for-note';
  const NEW_NAME = "Pirates' Editor for note";
  const CLOSED_KEY = 'moveBannerClosed'; // 帯を閉じた印（kv。バックアップには入れない）
  const BTN_LABEL = `⬇ 正規版（${NEW_NAME}）への引っ越し用ファイル`;
  const isWeb = () => self.PON_ENV === 'web';

  function bannerHtml() {
    return `<div class="card-head"><h2>Pirates of note は、正規版『${esc(NEW_NAME)}』になりました。</h2><button type="button" class="btn small" data-move="close" aria-label="この案内を閉じる">閉じる</button></div>
      <p>このβ版はこれが最後の版です。今までの記録・設定・称号は、次の3つの手順で正規版に引き継げます。</p>
      <ol class="move-steps">
        <li>① この画面で、引っ越し用ファイルを ⬇ ダウンロードする<br><button type="button" class="btn dl small" data-action="move-file">${esc(BTN_LABEL)}</button></li>
        <li>② 正規版を入れる（${isWeb() ? 'Web版は、正規版のWeb版を開いて、記録のしかたを登録し直す' : '拡張機能版は、Chromeウェブストアから入れる'}）</li>
        <li>③ 正規版の「設定」で「復元」を選び、①のファイルを読み込む</li>
      </ol>
      <p class="hint">正規版の公開は note でお知らせします。新しい場所：<a href="${esc(NEW_URL)}" target="_blank" rel="noopener">${esc(NEW_URL.replace(/^https:\/\//, ''))}</a></p>`;
  }

  async function render() {
    const el = document.getElementById('moveBanner');
    const link = document.getElementById('moveLink');
    if (!el) return;
    const closed = await NDB.kvGet(CLOSED_KEY, 0);
    if (!el.dataset.ready) { el.innerHTML = bannerHtml(); el.dataset.ready = '1'; }
    el.hidden = !!closed;
    if (link) link.hidden = !closed;
  }

  async function close() {
    await NDB.kvSet(CLOSED_KEY, Date.now());
    await render();
    const link = document.getElementById('moveLink');
    if (link) link.focus();
  }
  async function reopen() {
    await NDB.kvSet(CLOSED_KEY, 0);
    await render();
    const el = document.getElementById('moveBanner');
    if (el) { el.scrollIntoView({ block: 'start' }); const h = el.querySelector('h2'); if (h) { h.tabIndex = -1; h.focus(); } }
  }

  /** ⬇ 引っ越し用ファイル。書き出した後に、ファイル名・保存先・次にすることを出す */
  async function download(btn) {
    if (btn) btn.disabled = true;
    try {
      const { blob, name } = await PonBackup.moveBlob({ appVersion: ponVersion(), ...(isWeb() ? { source: 'pon-web' } : {}) });
      downloadBlob(name, blob);
      if (isWeb() && typeof markBackedUp === 'function') await markBackedUp(); // 中身はバックアップと同じなので、催促の日付も進める
      const where = isWeb()
        ? 'ブラウザの「ダウンロード」の場所（パソコンは「ダウンロード」フォルダ、スマホはファイルのアプリの「ダウンロード」など）'
        : 'パソコンの「ダウンロード」フォルダ（ブラウザで保存先を選ぶ設定にしているときは、選んだ場所）';
      await ponAsk({
        title: '引っ越し用ファイルをダウンロードしました',
        text: `ファイル名：${name}\n保存先：${where}\n\n正規版（${NEW_NAME}）を入れて、このファイルを『復元』で読み込んでください。\n（このファイルは、β版のPonでは読み込めません。β版のバックアップは、今までどおり「⬇ バックアップをダウンロード」で作れます）`,
        buttons: [{ label: '閉じる', value: true, kind: 'primary' }],
        cancel: true,
      });
    } catch (e) {
      ponToast(`引っ越し用ファイルを作れませんでした：${e && e.message || e}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  ACTIONS['move-file'] = download;
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-move]');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.move === 'close') close(); else if (b.dataset.move === 'open') reopen();
  });
  render();

  return { NEW_URL, NEW_NAME, BTN_LABEL, render, download };
})();
