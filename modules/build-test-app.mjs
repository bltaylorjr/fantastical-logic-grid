// Builds the private module test app into dist/module-test: the test page,
// the live game's stylesheet and fonts (so modules look exactly as they will
// in the game), the modules and the engine files they use.
// Run: node modules/build-test-app.mjs
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'module-test');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'engine', 'src'), { recursive: true });
cpSync(join(root, 'modules', 'test-app', 'index.html'), join(out, 'index.html'));
// The game's stylesheet, with the body backdrop kept and font paths intact.
writeFileSync(join(out, 'app.css'), readFileSync(join(root, 'web', 'app.css')));
const fonts = join(root, 'web', 'fonts');
if (existsSync(fonts)) cpSync(fonts, join(out, 'fonts'), { recursive: true });
for (const dir of ['number-place', 'test-app']) {
  cpSync(join(root, 'modules', dir), join(out, 'modules', dir), { recursive: true, filter: (f) => !f.endsWith('.cjs') && !f.endsWith('.html') });
}
for (const f of ["number-place.js", "number-place-styles.js", "number-place-story.js", "rng.js"]) cpSync(join(root, 'engine', 'src', f), join(out, 'engine', 'src', f));
// The same page without its document wrapper, for the private claude.ai preview
// (which adds its own wrapper and cannot print).
const page = readFileSync(join(out, 'index.html'), 'utf8');
const head = page.match(/<head>([\s\S]*)<\/head>/)[1].replace(/<meta charset[^>]*>\n|<meta name="viewport"[^>]*>\n/g, '');
const body = page.match(/<body>([\s\S]*)<\/body>/)[1];
writeFileSync(join(out, 'preview.html'), `<!DOCTYPE html>\n${head.replace('<title>', '<meta name="claude:viewport-fit-sides" content="cover">\n<meta name="np-no-print" content="1">\n<title>')}${body}`);
console.log(`Built ${out}`);
