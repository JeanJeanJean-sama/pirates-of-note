/* env.js — Web版の設定（db.js より前に読み込む） */
self.PON_ENV = 'web';
self.PON_VERSION = '__VERSION__'; // ビルド時に manifest.json のバージョンに置き換え
self.PON_DB_NAME = 'pon-web'; // github.io の同じドメインの他ページとぶつからない名前
document.documentElement.classList.add('web');
