// Ko-fi payments (kofi.js): the verification token, memberships giving
// Premium for 35 days and extending, tips giving the badge, and payments that
// are ignored. Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'flg-test';
const KOFI = '8f1c2a7e-0b5d-4c3e-9a61-2d7f5e4b3c21';
const signer = makeSigner(PROJECT);
const DAY = 24 * 3600_000;
const ADMIN = 'break-glass-token-for-kofi-tests';
const ORIGIN = 'https://thelogicgrid.com';
let mf;
let db;

before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    modulesRoot: join(root, '..'),
    scriptPath: join(root, 'src/index.js'),
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
    bindings: { FIREBASE_PROJECT_ID: PROJECT, TEST_JWKS: JSON.stringify(signer.jwks), KOFI_VERIFICATION_TOKEN: `${KOFI}\n`, ADMIN_TOKEN: ADMIN, ALLOWED_ORIGINS: ORIGIN },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});

test('payments are refused while Ko-fi payments are switched off', async () => {
  assert.equal((await kofi({ type: 'Donation' })).status, 503);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM supporters').first()).n, 0);
  const r = await mf.dispatchFetch('https://api.test/admin/v1/settings', {
    method: 'POST', headers: { Authorization: `Bearer ${ADMIN}`, Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'kofi_payments_enabled', value: true }),
  });
  assert.equal(r.status, 200);
});
after(() => mf.dispose());

// The shape Ko-fi sends: a form with the payment as JSON in "data".
async function kofi(fields) {
  const data = { verification_token: KOFI, message_id: crypto.randomUUID(), timestamp: new Date().toISOString(), type: 'Donation', email: 'fan@example.com', amount: '3.00', currency: 'USD', kofi_transaction_id: crypto.randomUUID(), ...fields };
  const r = await mf.dispatchFetch('https://api.test/v1/pay/kofi', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: JSON.stringify(data) }).toString(),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const perks = async (uid, email) => (await mf.dispatchFetch('https://api.test/v1/perks', { headers: { Authorization: `Bearer ${signer.token({ sub: uid, email, email_verified: true })}` } })).json();

test('a payment without the right verification token is refused', async () => {
  assert.equal((await kofi({ verification_token: 'wrong-token-wrong-token-wrong-token!' })).status, 403);
  assert.equal((await kofi({ verification_token: undefined })).status, 403);
  const r = await mf.dispatchFetch('https://api.test/v1/pay/kofi', { method: 'POST', body: 'data=not-json' });
  assert.equal(r.status, 400);
  assert.equal((await mf.dispatchFetch('https://api.test/v1/pay/kofi')).status, 405);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM supporters').first()).n, 0);
});

test('a tip gives the Supporter badge once', async () => {
  assert.equal((await kofi({ type: 'Donation', email: 'Fan@Example.com' })).body.result, 'supporter');
  assert.equal((await kofi({ type: 'Donation', email: 'fan@example.com' })).body.result, 'supporter');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM supporters WHERE source = 'kofi'").first()).n, 1);
  assert.deepEqual(await perks('p-fan', 'fan@example.com'), { supporter: true, premium: false, tier: 1, until: null });
  // A bigger tip raises the badge; a smaller one after it doesn't lower it.
  await kofi({ type: 'Donation', email: 'fan@example.com', amount: '20.00' });
  await kofi({ type: 'Donation', email: 'fan@example.com', amount: '1.00' });
  assert.equal((await perks('p-fan', 'fan@example.com')).tier, 3);
});

test('a membership gives Premium for 35 days, and each payment extends it', async () => {
  const first = Date.now() - 40 * DAY;
  assert.equal((await kofi({ type: 'Subscription', email: 'member@example.com', is_subscription_payment: true, is_first_subscription_payment: true, tier_name: 'Supporter extras', timestamp: new Date(first).toISOString() })).body.result, 'premium');
  assert.equal((await perks('p-member', 'member@example.com')).premium, false, 'a lapsed membership has run out');
  const second = Date.now();
  await kofi({ type: 'Subscription', email: 'member@example.com', is_subscription_payment: true, tier_name: 'Supporter extras', timestamp: new Date(second).toISOString() });
  const p = await perks('p-member', 'member@example.com');
  assert.equal(p.premium, true);
  assert.equal(p.until, Date.parse(new Date(second).toISOString()) + 35 * DAY);
  assert.equal(p.tier, 1, 'a $3 membership with no badge in its name is Bronze');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM supporters WHERE email = 'member@example.com'").first()).n, 1, 'one row per member');
  // Moving to a tier named after a badge gives that badge, and moving back down lowers it.
  await kofi({ type: 'Subscription', email: 'member@example.com', amount: '15.00', tier_name: 'Gold supporters' });
  assert.equal((await perks('p-member', 'member@example.com')).tier, 3);
  await kofi({ type: 'Subscription', email: 'member@example.com', amount: '5.00', tier_name: 'Silver supporters' });
  assert.equal((await perks('p-member', 'member@example.com')).tier, 2);
});

test('shop orders and payments without an email change nothing', async () => {
  assert.equal((await kofi({ type: 'Shop Order', email: 'shop@example.com' })).body.result, 'ignored: Shop Order');
  assert.equal((await kofi({ type: 'Donation', email: '' })).body.result, 'ignored: no email');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM supporters WHERE email = 'shop@example.com'").first()).n, 0);
});
