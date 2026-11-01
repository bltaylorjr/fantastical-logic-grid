// Copies the puzzle engine (engine/src) into admin/engine so the dashboard's
// Book publishing page (admin/books.js) makes book puzzles with exactly the
// engine players get. The files are copied unchanged. Run after changing the engine:
//   node scripts/admin-engine.mjs
// server/test/books.test.mjs fails when the copy is out of date.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ENGINE_SRC = join(root, 'engine', 'src');
export const ENGINE_COPY = join(root, 'admin', 'engine');
export const engineFiles = () => readdirSync(ENGINE_SRC).filter((f) => f.endsWith('.js')).sort();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  rmSync(ENGINE_COPY, { recursive: true, force: true });
  mkdirSync(ENGINE_COPY, { recursive: true });
  for (const f of engineFiles()) writeFileSync(join(ENGINE_COPY, f), readFileSync(join(ENGINE_SRC, f)));
  console.log(`${engineFiles().length} engine files -> admin/engine`);
}
