/* env.js — Web版の設定（db.js より前に読み込む） */
self.PON_ENV = 'web';
self.PON_VERSION = '0.5.1'; // ビルド時に manifest.json のバージョンに置き換え
self.PON_COLLECTOR = '5083472a44c5'; // いまのブックマークレット本体の指紋（古い登録のままか判定する）
self.PON_DB_NAME = 'pon-web'; // github.io の同じドメインの他ページとぶつからない名前
document.documentElement.classList.add('web');
