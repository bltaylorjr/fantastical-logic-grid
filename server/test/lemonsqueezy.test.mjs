// Lemon Squeezy payments (lemonsqueezy.js): the signed body, a paid order
// giving Premium to the buyer's account and email, refunds, and events that
// are ignored. Run with `npm test` in server/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { makeSigner } from './signer.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'flg-test';
const SECRET = 'lemon-signing-secret-for-tests-42';
const ADMIN = 'break-glass-token-for-lemon-tests';
const ORIGIN = 'https://thelogicgrid.com';
const signer = makeSigner(PROJECT);
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
    bindings: { FIREBASE_PROJECT_ID: PROJECT, TEST_JWKS: JSON.stringify(signer.jwks), LEMONSQUEEZY_SIGNING_SECRET: SECRET, ADMIN_TOKEN: ADMIN, ALLOWED_ORIGINS: ORIGIN },
  });
  db = await mf.getD1Database('DB');
  for (const f of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
});
after(() => mf.dispose());

const order = (event, { id = 1001, status = 'paid', email = 'buyer@example.com', uid, total = 499, variant = 'Default' } = {}) => ({
  meta: { event_name: event, test_mode: true, ...(uid ? { custom_data: { uid } } : {}) },
  data: { type: 'orders', id: String(id), attributes: { status, user_email: email, identifier: `ord-${id}`, total, first_order_item: { product_name: 'Supporter extras', variant_name: variant } } },
});
async function send(payload, { secret = SECRET, signature } = {}) {
  const body = JSON.stringify(payload);
  const r = await mf.dispatchFetch('https://api.test/v1/pay/lemonsqueezy', {
    method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Signature': signature ?? createHmac('sha256', secret).update(body).digest('hex') },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const perks = async (uid, email) => (await mf.dispatchFetch('https://api.test/v1/perks', { headers: { Authorization: `Bearer ${signer.token({ sub: uid, ...(email ? { email, email_verified: true } : {}) })}` } })).json();

test('orders are refused while Lemon Squeezy payments are switched off', async () => {
  assert.equal((await send(order('order_created', { id: 9001, uid: 'p-early' }))).status, 503);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM supporters').first()).n, 0);
  const r = await mf.dispatchFetch('https://api.test/admin/v1/settings', {
    method: 'POST', headers: { Authorization: `Bearer ${ADMIN}`, Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'lemonsqueezy_payments_enabled', value: true }),
  });
  assert.equal(r.status, 200);
});

test('an unsigned or wrongly signed order is refused', async () => {
  assert.equal((await send(order('order_created'), { secret: 'some-other-secret-entirely' })).status, 403);
  assert.equal((await send(order('order_created'), { signature: '' })).status, 403);
  assert.equal((await mf.dispatchFetch('https://api.test/v1/pay/lemonsqueezy')).status, 405);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM supporters').first()).n, 0);
});

test('a paid order gives Premium to the account in the checkout link', async () => {
  assert.equal((await send(order('order_created', { id: 1001, email: 'paid-with-other@example.com', uid: 'p-buyer' }))).body.result, 'premium');
  assert.deepEqual(await perks('p-buyer'), { supporter: true, premium: true, tier: 1, until: null });
  // The same webhook again adds nothing.
  await send(order('order_created', { id: 1001, email: 'paid-with-other@example.com', uid: 'p-buyer' }));
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM supporters WHERE source = 'lemonsqueezy'").first()).n, 1);
});

test('an order without the account reaches the player by email', async () => {
  await send(order('order_created', { id: 1002, email: 'Email@Example.com' }));
  assert.equal((await perks('p-email', 'email@example.com')).premium, true);
});

test('a refund ends that order, and unpaid orders and other events change nothing', async () => {
  assert.equal((await send(order('order_refunded', { id: 1001, status: 'refunded' }))).body.result, 'ended');
  assert.equal((await perks('p-buyer')).premium, false);
  assert.equal((await perks('p-email', 'email@example.com')).premium, true, 'other orders keep theirs');
  assert.equal((await send(order('order_created', { id: 1003, status: 'pending', email: 'pending@example.com' }))).body.result, 'ignored: order pending');
  assert.equal((await send({ meta: { event_name: 'subscription_created' }, data: { type: 'subscriptions', id: '7' } })).body.result, 'ignored: subscription_created');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM supporters WHERE email = 'pending@example.com'").first()).n, 0);
});

test('the badge tier comes from the variant name or the price', async () => {
  await send(order('order_created', { id: 3001, uid: 'p-tier', total: 1999 }));
  assert.equal((await perks('p-tier')).tier, 3, '$19.99 is Gold');
  await send(order('order_created', { id: 3002, uid: 'p-tier2', total: 299, variant: 'Platinum' }));
  assert.equal((await perks('p-tier2')).tier, 4, 'a Platinum variant is Platinum');
});
