// D1 (Cloudflare's SQLite) refuses a LIKE or GLOB pattern longer than 50
// characters ("LIKE or GLOB pattern too complex"), which local SQLite allows.
// One such migration stopped every deploy on 2026-10-30, so check them all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

test('no migration uses a LIKE or GLOB pattern D1 would refuse', () => {
  const dir = new URL('../migrations/', import.meta.url);
  const long = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(new URL(f, dir), 'utf8');
    for (const m of sql.matchAll(/\b(?:LIKE|GLOB)\s+'((?:[^']|'')*)'/gi)) if (m[1].length > 50) long.push(`${f}: ${m[1].slice(0, 40)}…`);
  }
  assert.deepEqual(long, [], 'use instr(column, text) = 1 or substr() instead');
});
