// Logic Grid Basic as one self-contained page for a private claude.ai preview
// (dist/calm-preview/index.html). Run after npm run build:
//   node scripts/build-calm-preview.mjs
// The page cannot load other files there, so scripts, styles, fonts and the
// icon are inlined, and the puzzle writer runs as a blob worker (or on the
// page if workers are blocked). Printing is turned off in the preview.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const out = join(root, 'dist', 'calm-preview');
mkdirSync(out, { recursive: true });

const worker = await build({ entryPoints: [join(web, 'worker.js')], bundle: true, format: 'iife', minify: true, write: false });
const workerCode = worker.outputFiles[0].text;

// Swap the engine client for one that makes its worker from inlined code.
const previewClient = `
import { generatePuzzle, getHint } from '../engine/index.js';
const CODE = ${JSON.stringify(workerCode)};
let w = null, seq = 0; const pending = new Map();
function get() {
  if (w !== null) return w;
  try {
    w = new Worker(URL.createObjectURL(new Blob([CODE], { type: 'text/javascript' })));
    w.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error)); };
    w.onerror = () => { const list = [...pending.values()]; pending.clear(); w.terminate(); w = false; for (const p of list) p.retry(); };
  } catch (e) { w = false; }
  return w;
}
const local = (op, args) => Promise.resolve().then(() => op === 'generate' ? generatePuzzle(args) : getHint(args.puzzle, args.marks));
function call(op, args) {
  const wk = get();
  if (!wk) return local(op, args);
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject, retry: () => local(op, args).then(resolve, reject) }); wk.postMessage({ id, op, args }); });
}
export const generate = (o) => call('generate', o);
export const hint = (puzzle, marks) => call('hint', { puzzle, marks });
`;
const swap = {
  name: 'preview-engine',
  setup(b) {
    b.onResolve({ filter: /engine-client\.js$/ }, () => ({ path: 'preview-client', namespace: 'calm' }));
    b.onLoad({ filter: /.*/, namespace: 'calm' }, () => ({ contents: previewClient, resolveDir: join(web, 'js'), loader: 'js' }));
  },
};
const app = await build({ entryPoints: [join(web, 'calm', 'calm.js')], bundle: true, format: 'esm', minify: true, write: false, plugins: [swap] });

const b64 = (f) => readFileSync(f).toString('base64');
let css = readFileSync(join(web, 'calm', 'calm.css'), 'utf8')
  .replace(/url\(\.\.\/fonts\/([\w-]+\.woff2)\)/g, (_, f) => `url(data:font/woff2;base64,${b64(join(web, 'fonts', f))})`);
const icon = `data:image/svg+xml;base64,${b64(join(web, 'icons', 'icon.svg'))}`;
const html = readFileSync(join(web, 'calm', 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '')
  .replace(/<link [^>]*>\s*/g, '').replace(/<script [^>]*><\/script>\s*/, '')
  + `<meta name="flg-mode" content="preview">\n<style>${css}</style>\n`;
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1]
  .replaceAll('../icons/icon.svg', icon)
  .replace('href="../" id="mode-full"', 'href="https://thelogicgrid.com/" target="_blank" rel="noopener" id="mode-full"');
writeFileSync(join(out, 'index.html'), `${head}${body}<script type="module">${app.outputFiles[0].text.replace(/<\/(script)/gi, '<\\/$1')}</script>\n`);
console.log(`Built dist/calm-preview/index.html (${Math.round(readFileSync(join(out, 'index.html')).length / 1024)} KB).`);
