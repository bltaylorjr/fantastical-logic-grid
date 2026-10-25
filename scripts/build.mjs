// Build: copy the engine and fonts into web/, then write dist/web with a
// service worker that precaches every file. Run: npm run build
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildSeo } from './seo.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const engineSrc = process.env.ENGINE_DIR || (existsSync(join(root, 'engine', 'src')) ? join(root, 'engine', 'src') : '/mnt/project-files/logic-grid-engine/src');
const out = join(root, 'dist', 'web');

// 1. Engine (never edited here; the engine thread owns it).
if (existsSync(engineSrc)) {
  // Copy file by file (the shared folder is a network mount) and check that
  // every module the engine imports arrived.
  rmSync(join(web, 'engine'), { recursive: true, force: true });
  mkdirSync(join(web, 'engine'), { recursive: true });
  const names = readdirSync(engineSrc).filter((n) => n.endsWith('.js'));
  for (const n of names) writeFileSync(join(web, 'engine', n), readFileSync(join(engineSrc, n)));
  for (const n of names) {
    for (const [, dep] of readFileSync(join(web, 'engine', n), 'utf8').matchAll(/from '\.\/([\w.-]+)'/g)) {
      if (!existsSync(join(web, 'engine', dep))) throw new Error(`Engine file ${dep} (imported by ${n}) is missing`);
    }
  }
} else if (!existsSync(join(web, 'engine'))) throw new Error(`Engine not found at ${engineSrc}`);

// 2. Fonts.
const fontDir = join(root, 'node_modules/@fontsource/atkinson-hyperlegible/files');
mkdirSync(join(web, 'fonts'), { recursive: true });
for (const [from, to] of [['latin-400-normal', 'atkinson-400'], ['latin-700-normal', 'atkinson-700'], ['latin-400-italic', 'atkinson-400-italic']]) {
  const f = join(fontDir, `atkinson-hyperlegible-${from}.woff2`);
  if (existsSync(f)) cpSync(f, join(web, 'fonts', `${to}.woff2`));
}
const cinzel = join(root, 'node_modules/@fontsource/cinzel/files/cinzel-latin-700-normal.woff2');
if (existsSync(cinzel)) cpSync(cinzel, join(web, 'fonts', 'cinzel-700.woff2'));

// 3. dist/web with a stamped service worker.
rmSync(out, { recursive: true, force: true });
cpSync(web, out, { recursive: true });
// Player accounts switch on when the build is given the Firebase web API key
// and the sync Worker's address (GitHub repository variables in CI).
const cloudFile = join(out, 'js', 'cloud-config.js');
let cloud = readFileSync(cloudFile, 'utf8');
// FLG_CLOUD_URL is the shared Worker address (also used for learning).
const cloudEnv = { firebaseApiKey: process.env.FLG_FIREBASE_API_KEY, syncUrl: process.env.FLG_SYNC_URL || process.env.FLG_CLOUD_URL, learnUrl: process.env.FLG_CLOUD_URL };
for (const [field, value] of Object.entries(cloudEnv)) {
  if (value) cloud = cloud.replace(new RegExp(`${field}: '[^']*'`), `${field}: ${JSON.stringify(value.replace(/\/+$/, ''))}`);
}
const appVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
cloud = cloud.replace(/appVersion: '[^']*'/, `appVersion: ${JSON.stringify(appVersion)}`);
writeFileSync(cloudFile, cloud);
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files.push(relative(out, p).split('\\').join('/')); } };
walk(out);
// The Kokoro voice engine (about 28 MB) is cached when first used, not on install.
const shell = ['./', ...files.filter((f) => f !== 'sw.js' && !f.endsWith('icon-1024.png') && !/^vendor\/(ort|kokoro)\//.test(f) && f !== 'kokoro-worker.js' && !f.startsWith('media/'))];
const hash = createHash('sha256');
for (const f of files.sort()) hash.update(f).update(readFileSync(join(out, f)));
const version = hash.digest('hex').slice(0, 10);
const sw = readFileSync(join(web, 'sw.js'), 'utf8').replace('__VERSION__', version).replace('__FILES__', JSON.stringify(shell));
writeFileSync(join(out, 'sw.js'), sw);
console.log(`Built dist/web (${files.length} files, version ${version}).`);

// 4. dist/preview: the same app as a claude.ai Artifact page (no service
// worker; the host adds the document skeleton, so only head content + body stay).
const prev = join(root, 'dist', 'preview');
rmSync(prev, { recursive: true, force: true });
cpSync(out, prev, { recursive: true });
rmSync(join(prev, 'sw.js'));
let html = readFileSync(join(web, 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '').replace(/<link rel="manifest"[^>]*>\s*/, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
html = head.replace('<title>The Fantastical Logic Grid</title>', '<title>The Fantastical Logic Grid</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<meta name="flg-mode" content="preview">') + body;
writeFileSync(join(prev, 'index.html'), html);
console.log('Built dist/preview for the claude.ai page.');

// 5. dist/site: the web build plus host settings files and a deploy guide,
// ready to upload to any static host (see hosting/DEPLOY.md).
const site = join(root, 'dist', 'site');
rmSync(site, { recursive: true, force: true });
cpSync(out, site, { recursive: true });
cpSync(join(root, 'hosting'), site, { recursive: true });
// Search pages, daily puzzle, sitemap and search tags (website only).
const seo = await buildSeo({ root, site });
console.log(`Built dist/site for web hosting (${seo.pages.length} pages in the sitemap).`);
