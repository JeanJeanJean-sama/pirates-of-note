// Web版Pon（GitHub Pages 用 docs/）のビルド
//   npm i terser   （初回のみ）
//   node tools/build-web.mjs            … 本番URL向け
//   PON_APP_URL=http://localhost:8000/ node tools/build-web.mjs   … 手元確認用
// src/ の画面ファイル（拡張機能と共通）と web/ のWeb版専用ファイルから docs/ を作る
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src'), WEB = join(ROOT, 'web'), OUT = join(ROOT, 'docs');
const APP_URL = process.env.PON_APP_URL || 'https://jeanjeanjean-sama.github.io/pirates-of-note/';
const VERSION = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')).version;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'app'), { recursive: true });
mkdirSync(join(OUT, 'icons'), { recursive: true });

// 1. 画面の共通ファイル
for (const f of ['db.js', 'store.js', 'dashboard.js', 'views.js', 'bodies.js', 'perks.js', 'theme-boot.js', 'dashboard.css']) copyFileSync(join(SRC, f), join(OUT, 'app', f));
for (const f of ['web.js', 'webapp.js']) copyFileSync(join(WEB, f), join(OUT, 'app', f));
writeFileSync(join(OUT, 'app', 'env.js'), readFileSync(join(WEB, 'env.js'), 'utf8').replace('__VERSION__', VERSION));

// 2. index.html（拡張機能のダッシュボードをWeb版向けに変換）
let html = readFileSync(join(SRC, 'dashboard.html'), 'utf8');
const must = (from, to) => { if (!html.includes(from)) throw new Error(`dashboard.html に「${from}」が見つかりません`); html = html.replace(from, to); };
must('<link rel="stylesheet" href="dashboard.css">', [
  '<meta name="theme-color" content="#1e56a0">',
  '<meta name="description" content="自分のnoteのアクセス数値を記録・分析する非公式ツール（Web版）">',
  '<link rel="manifest" href="manifest.webmanifest">',
  '<link rel="icon" href="icons/icon-192.png">',
  '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">',
  '<link rel="stylesheet" href="app/dashboard.css">',
].join('\n'));
must('<script src="db.js"></script>', '<script src="app/env.js"></script>\n<script src="app/db.js"></script>\n<script src="app/store.js"></script>\n<script src="app/web.js"></script>');
must('<script src="dashboard.js"></script>', '<script src="app/dashboard.js"></script>');
must('<script src="views.js"></script>', '<script src="app/views.js"></script>');
must('<script src="bodies.js"></script>', '<script src="app/bodies.js"></script>');
must('<script src="perks.js"></script>', '<script src="app/perks.js"></script>\n<script src="app/webapp.js"></script>');
must('<script src="theme-boot.js"></script>', '<script src="app/theme-boot.js"></script>');
must('<h1>Pirates of note <span class="meta">Pon</span></h1>', '<h1>Pirates of note <span class="meta">Pon Web</span></h1>');
writeFileSync(join(OUT, 'index.html'), html);

// 3. ブックマークレット
const collector = readFileSync(join(SRC, 'perk-collect.js'), 'utf8') + '\n' + readFileSync(join(WEB, 'collector.js'), 'utf8').replace('__PON_APP_URL__', APP_URL);
const { code } = await minify(`(async()=>{${collector}\nawait main();})();`, { compress: { passes: 2 }, mangle: true, format: { comments: false } });
const bookmarklet = 'javascript:' + code.replace(/%/g, '%25');
writeFileSync(join(OUT, 'bookmarklet.txt'), bookmarklet);
const install = readFileSync(join(WEB, 'install.template.html'), 'utf8').replace("/*__BOOKMARKLET__*/''", JSON.stringify(bookmarklet));
writeFileSync(join(OUT, 'install.html'), install);

// 4. その他
copyFileSync(join(WEB, 'privacy.html'), join(OUT, 'privacy.html'));
copyFileSync(join(WEB, 'manifest.webmanifest'), join(OUT, 'manifest.webmanifest'));
writeFileSync(join(OUT, 'sw.js'), readFileSync(join(WEB, 'sw.js'), 'utf8').replace('__VERSION__', VERSION));
for (const f of readdirSync(join(WEB, 'icons'))) copyFileSync(join(WEB, 'icons', f), join(OUT, 'icons', f));
writeFileSync(join(OUT, '.nojekyll'), '');
console.log(`docs/ を作成しました（v${VERSION}、ブックマークレット ${bookmarklet.length} 文字、APP_URL=${APP_URL}）`);
