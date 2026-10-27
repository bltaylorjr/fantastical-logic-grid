// Checks what the Microsoft Store and the Windows App Certification Kit (WACK)
// look at, without needing Windows:
//   - the web app manifest PWABuilder turns into the Store's MSIX package:
//     required fields, icon and screenshot files that exist at the sizes they claim
//   - the service worker (offline play) and the privacy and terms pages
//   - the Store listing in docs/MICROSOFT-STORE.md: text limits and screenshots
//   - both Windows desktop apps (desktop/ and desktop-admin/): publisher,
//     copyright and the Windows manifest (UAC, supported Windows versions, High DPI)
//   - no private signing keys in anything that ships
// The real WACK run on Windows is the "Windows app certification" workflow (wack.yml).
// Run: npm run build && node scripts/check-store.mjs
// Prints a summary line, then one "Problem: " or "Warning: " line each.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'dist', 'site');
const problems = [];
const warnings = [];
const problem = (m) => problems.push(m);
const warn = (m) => warnings.push(m);
if (!existsSync(join(site, 'index.html'))) { console.error('dist/site is missing; run npm run build first.'); process.exit(1); }

// Width and height from a PNG or JPEG file header.
function imageSize(file) {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), type: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i < b.length - 9;) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5), type: 'image/jpeg' };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

// --- Web app manifest (what PWABuilder packages for the Store) ---
const manifest = JSON.parse(readFileSync(join(site, 'manifest.webmanifest'), 'utf8'));
for (const f of ['id', 'name', 'short_name', 'description', 'start_url', 'scope', 'display', 'background_color', 'theme_color', 'lang', 'categories', 'icons', 'screenshots']) {
  if (manifest[f] === undefined || manifest[f] === '' || (Array.isArray(manifest[f]) && !manifest[f].length)) problem(`manifest.webmanifest is missing "${f}".`);
}
if (!['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display)) problem(`manifest display "${manifest.display}" does not open as an app window.`);
if ((manifest.name || '').length > 256) problem('manifest name is longer than 256 characters (the Store limit).');
if ((manifest.short_name || '').length > 12) warn('manifest short_name is longer than 12 characters, so Windows may cut it off under the tile.');
if (!/\bgames?\b/.test((manifest.categories || []).join(' '))) warn('manifest categories do not include "games".');

const checkImage = (label, entry) => {
  const file = join(site, entry.src);
  if (!existsSync(file)) { problem(`${label} ${entry.src} does not exist.`); return null; }
  if (entry.src.endsWith('.svg')) return null;
  const size = imageSize(file);
  if (!size) { problem(`${label} ${entry.src} is not a PNG or JPEG.`); return null; }
  if (entry.type && entry.type !== size.type) problem(`${label} ${entry.src} says ${entry.type} but is ${size.type}.`);
  if (entry.sizes && entry.sizes !== 'any' && entry.sizes !== `${size.w}x${size.h}`) problem(`${label} ${entry.src} says ${entry.sizes} but is ${size.w}x${size.h}.`);
  return size;
};
const icons = (manifest.icons || []).map((i) => ({ ...i, size: checkImage('Icon', i) }));
const pngIcon = (px, purpose) => icons.some((i) => i.size && i.size.type === 'image/png' && i.size.w === px && i.size.h === px && (i.purpose || 'any').split(' ').includes(purpose));
if (!pngIcon(512, 'any')) problem('manifest needs a 512x512 PNG icon (PWABuilder makes every Windows tile and logo from it).');
if (!pngIcon(192, 'any')) problem('manifest needs a 192x192 PNG icon.');
if (!pngIcon(512, 'maskable')) warn('manifest has no 512x512 maskable icon.');
const shots = (manifest.screenshots || []).map((s) => ({ ...s, size: checkImage('Screenshot', s) }));
if (!shots.some((s) => s.form_factor === 'wide')) problem('manifest has no wide (desktop) screenshot.');
for (const s of shots) if (!s.label) warn(`Screenshot ${s.src} has no label (screen readers and the install dialog use it).`);
for (const sc of manifest.shortcuts || []) if (!sc.name || !sc.url) problem('Every manifest shortcut needs a name and a url.');

// --- Offline play and the pages the Store links to ---
const sw = existsSync(join(site, 'sw.js')) ? readFileSync(join(site, 'sw.js'), 'utf8') : '';
if (!/addEventListener\(\s*['"]fetch['"]/.test(sw)) problem('sw.js has no fetch handler, so the app does not open offline.');
const index = readFileSync(join(site, 'index.html'), 'utf8');
if (!/<link[^>]+rel="manifest"/.test(index)) problem('index.html does not link the manifest.');
if (!/serviceWorker\.register|navigator\.serviceWorker/.test(index + readdirSync(join(site, 'js')).map((f) => f.endsWith('.js') ? readFileSync(join(site, 'js', f), 'utf8') : '').join(''))) problem('Nothing registers the service worker.');
for (const page of ['privacy', 'terms']) {
  const f = join(site, page, 'index.html');
  if (!existsSync(f)) { problem(`/${page}/ does not exist; the Store listing links to it.`); continue; }
  const text = readFileSync(f, 'utf8').replace(/<[^>]+>/g, ' ');
  if (text.split(/\s+/).length < 150) warn(`/${page}/ is very short for a Store ${page} page.`);
}

// --- Store listing text and screenshots (docs/MICROSOFT-STORE.md) ---
const doc = readFileSync(join(root, 'docs', 'MICROSOFT-STORE.md'), 'utf8');
const section = (title) => {
  const m = doc.match(new RegExp(`\\*\\*${title}[^*]*\\*\\*\\n([\\s\\S]*?)(?=\\n\\*\\*|$)`));
  return m ? m[1].trim() : null;
};
const shortDesc = section('Short description');
const longDesc = section('Description');
const terms = section('Search terms');
const whatsNew = section("What's new");
if (!shortDesc) problem('docs/MICROSOFT-STORE.md has no short description.');
else if (shortDesc.length > 200) problem(`Store short description is ${shortDesc.length} characters; keep it to 200 as the doc promises.`);
if (!longDesc) problem('docs/MICROSOFT-STORE.md has no description.');
else if (longDesc.length > 10000) problem(`Store description is ${longDesc.length} characters (the limit is 10,000).`);
if (whatsNew && whatsNew.length > 1500) problem(`Store "What's new" is ${whatsNew.length} characters (the limit is 1,500).`);
if (terms) {
  const list = terms.split(',').map((t) => t.trim()).filter(Boolean);
  if (list.length > 7) problem(`Store search terms: ${list.length} (the limit is 7).`);
  for (const t of list) if (t.length > 30) problem(`Store search term "${t}" is over 30 characters.`);
  if (list.join(' ').split(/\s+/).length > 21) problem('Store search terms have more than 21 words in total.');
} else problem('docs/MICROSOFT-STORE.md has no search terms.');
const storeShots = join(root, 'media', 'store');
const pngs = existsSync(storeShots) ? readdirSync(storeShots).filter((f) => f.endsWith('.png')) : [];
if (!pngs.length) problem('media/store has no Store screenshots.');
for (const f of pngs) {
  const s = imageSize(join(storeShots, f));
  if (!s || s.w < 1366 || s.h < 768) problem(`media/store/${f} is ${s ? `${s.w}x${s.h}` : 'unreadable'}; Store desktop screenshots must be at least 1366x768.`);
  if (statSync(join(storeShots, f)).size > 50 * 1024 * 1024) problem(`media/store/${f} is over 50 MB.`);
}
if (!doc.includes('https://thelogicgrid.com/privacy/')) problem('docs/MICROSOFT-STORE.md does not give the privacy policy address.');

// --- Windows desktop apps (WACK desktop tests) ---
const appManifestFile = join(root, 'desktop', 'windows', 'app.manifest');
const appManifest = existsSync(appManifestFile) ? readFileSync(appManifestFile, 'utf8') : '';
if (!appManifest) problem('desktop/windows/app.manifest is missing.');
else {
  if (!/requestedExecutionLevel\s+level="asInvoker"/.test(appManifest)) problem('app.manifest must ask for level="asInvoker" (WACK user account control test).');
  if (/requireAdministrator|highestAvailable|uiAccess="true"/.test(appManifest)) problem('app.manifest asks for admin rights or uiAccess; the apps are unsigned, so WACK fails that.');
  if (!/8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a/i.test(appManifest)) problem('app.manifest does not list Windows 10/11 as supported (WACK compatibility test).');
  if (!/<dpiAwareness[^>]*>[^<]*PerMonitorV2/.test(appManifest) && !/<dpiAware[^>]*>\s*true/.test(appManifest)) problem('app.manifest is not DPI aware (WACK High DPI test).');
  if (!/Microsoft\.Windows\.Common-Controls/.test(appManifest)) problem('app.manifest must keep the Common-Controls 6 dependency that Tauri needs.');
}
for (const app of ['desktop', 'desktop-admin']) {
  const dir = join(root, app, 'src-tauri');
  const conf = JSON.parse(readFileSync(join(dir, 'tauri.conf.json'), 'utf8'));
  const b = conf.bundle || {};
  for (const f of ['publisher', 'copyright', 'shortDescription']) if (!b[f]) problem(`${app}/src-tauri/tauri.conf.json bundle has no "${f}" (it becomes the installer's and the program's ${f === 'publisher' ? 'Publisher / Company name' : f}).`);
  if (!/app\.manifest/.test(readFileSync(join(dir, 'build.rs'), 'utf8'))) problem(`${app}/src-tauri/build.rs does not embed desktop/windows/app.manifest.`);
  if (!(b.icon || []).some((i) => i.endsWith('.ico'))) problem(`${app} has no .ico icon for Windows.`);
}

// --- No private keys in anything that ships ---
const secret = /\.(pfx|p12|pem|key|snk|jks|keystore)$/i;
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (secret.test(n)) problem(`${relative(root, p)} looks like a private key and would ship with the app.`);
  }
};
walk(site);
if (existsSync(join(root, 'dist', 'web'))) walk(join(root, 'dist', 'web'));

console.log(`Store check: ${problems.length} problem(s), ${warnings.length} warning(s).`);
for (const p of problems) console.log(`Problem: ${p}`);
for (const w of warnings) console.log(`Warning: ${w}`);
process.exit(problems.length ? 1 : 0);
