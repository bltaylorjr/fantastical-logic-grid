// Migrations that local SQLite accepts but D1 (Cloudflare's SQLite, through
// wrangler) refuses, each of which stopped every deploy on 2026-10-30:
// - a LIKE or GLOB pattern longer than 50 characters ("pattern too complex");
// - a last statement with no closing semicolon: wrangler adds its own INSERT
//   after the file, giving 'near "INSERT": syntax error'.
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

test('every migration ends its last statement with a semicolon', () => {
  const dir = new URL('../migrations/', import.meta.url);
  const open = readdirSync(dir).filter((n) => n.endsWith('.sql')).filter((f) => {
    const sql = readFileSync(new URL(f, dir), 'utf8').replace(/--[^\n]*/g, '').trim();
    return sql && !sql.endsWith(';');
  });
  assert.deepEqual(open, []);
});
