#!/usr/bin/env node
// Save a login to the owner's Passwords vault without being able to read it
// back: the login is locked to the vault's public drop box key
// (admin/vault-drop.js) and lands in the drop box; the owner's dashboard files
// it the next time Passwords is unlocked.
//
// Use this whenever Claude (or an automation) sets up an account or makes a
// key, so nothing is kept in plain text anywhere else.
//
//   Give the login as JSON on stdin (never put a password on the command line):
//     { "title": "Resend", "url": "https://resend.com", "loginUrl": "https://resend.com/login",
//       "username": "...", "email": "...", "password": "...", "totp": "otpauth://...",
//       "notes": "...", "kind": "api", "fields": [{ "label": "API key", "value": "re_...", "secret": true }] }
//   An array saves several. kind is one of login, email, hosting, social, money, api, device, other.
//
//   node scripts/vault-drop.mjs --source Claude < login.json
//     With FLG_ADMIN_TOKEN (or an assistant key in FLG_ADMIN_KEY) set: sends it straight in.
//     Without one: --push makes a vault-drop/<time> branch holding only the locked file(s);
//     .github/workflows/vault-drop.yml sends them in and deletes the branch.
//     --out <folder> only writes the locked file(s).
//   node scripts/vault-drop.mjs post <file>...   send locked files (used by the workflow).
import { sealDrop } from '../admin/vault-drop.js';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const API = (process.env.FLG_CLOUD_URL || 'https://flg-api.btay74.workers.dev').replace(/\/$/, '');
const TOKEN = process.env.FLG_ADMIN_KEY || process.env.FLG_ADMIN_TOKEN || '';
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const die = (msg) => { console.error(msg); process.exit(1); };

async function send(locked) {
  const r = await fetch(`${API}/admin/v1/vault/inbox`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(locked) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) die(`The drop box refused it (${r.status}): ${body.message || body.error || 'no reason given'}`);
  return body.id;
}

if (args[0] === 'post') {
  const files = args.slice(1);
  if (!files.length) die('Name the locked files to send.');
  if (!TOKEN) die('Set FLG_ADMIN_TOKEN or FLG_ADMIN_KEY to send.');
  for (const f of files) {
    const locked = JSON.parse(readFileSync(f, 'utf8'));
    for (const one of Array.isArray(locked) ? locked : [locked]) console.log(`sent ${path.basename(f)} -> drop box #${await send(one)}`);
  }
  process.exit(0);
}

const source = (opt('--source') || 'Claude').slice(0, 60);
let input = '';
try { input = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
if (!input.trim()) die('Give the login as JSON on stdin. See the top of scripts/vault-drop.mjs.');
let logins;
try { logins = JSON.parse(input); } catch { die('That is not valid JSON.'); }
logins = Array.isArray(logins) ? logins : [logins];
for (const l of logins) if (!l || typeof l !== 'object' || !(l.title || l.name || l.url || l.loginUrl)) die('Each login needs at least a title or a url.');

const kr = await fetch(`${API}/v1/vault-drop-key`).catch((e) => die(`Could not reach ${API}: ${e.message}`));
const kb = await kr.json().catch(() => ({}));
if (!kr.ok || !kb.pub) die(kb.message || `No drop box key at ${API} (${kr.status}). Open Passwords in the admin app once to turn it on.`);
const locked = [];
for (const l of logins) locked.push({ ...(await sealDrop(kb.pub, l)), source });

const out = opt('--out');
if (TOKEN && !out && !args.includes('--push')) {
  for (const one of locked) console.log(`sent -> drop box #${await send(one)}`);
  process.exit(0);
}
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const name = `${stamp}-${Math.random().toString(36).slice(2, 7)}.json`;
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, name), `${JSON.stringify(locked, null, 2)}\n`);
  console.log(`locked ${locked.length} login(s) into ${path.join(out, name)}`);
  process.exit(0);
}
if (!args.includes('--push')) die('No FLG_ADMIN_TOKEN or FLG_ADMIN_KEY: add --push to send through a vault-drop branch, or --out <folder>.');

// --push: a throwaway worktree on a new branch from origin/main holding only the locked file.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const root = git('rev-parse', '--show-toplevel');
const branch = `vault-drop/${stamp}`;
const tree = path.join(root, '.git', `vault-drop-${stamp}`);
git('-C', root, 'fetch', '--depth', '1', 'origin', 'main');
git('-C', root, 'worktree', 'add', '--detach', tree, 'FETCH_HEAD');
try {
  mkdirSync(path.join(tree, 'vault-inbox'), { recursive: true });
  writeFileSync(path.join(tree, 'vault-inbox', name), `${JSON.stringify(locked, null, 2)}\n`);
  git('-C', tree, 'add', `vault-inbox/${name}`);
  git('-C', tree, '-c', 'user.name=Claude', '-c', 'user.email=noreply@anthropic.com', 'commit', '-q', '-m', `Passwords drop box: ${locked.length} locked login(s) from ${source}`);
  git('-C', tree, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
  console.log(`pushed ${branch}: the vault-drop workflow sends ${locked.length} locked login(s) to the drop box and deletes the branch.`);
} finally {
  try { git('-C', root, 'worktree', 'remove', '--force', tree); } catch { rmSync(tree, { recursive: true, force: true }); }
}
