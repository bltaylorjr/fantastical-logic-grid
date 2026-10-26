// Lemon Squeezy payments (money option 3): a one-time unlock of the
// supporter extras. Lemon Squeezy is the seller of record, so it handles
// sales tax and VAT. It calls this webhook after each order:
//
//   POST /v1/pay/lemonsqueezy   (Lemon Squeezy > Settings > Webhooks)
//
// It does nothing until the admin turns on Settings > Support and premium >
// Lemon Squeezy payments. The body is signed: X-Signature is the hex HMAC-SHA256 of the raw body with
// the webhook's signing secret (the LEMONSQUEEZY_SIGNING_SECRET Cloudflare
// secret). Then:
//   order_created (paid)  Premium with no end, made out to the buyer's email,
//                         and to their game account when the checkout link
//                         carried it (checkout[custom][uid], added by the game).
//                         The badge tier comes from the variant or product name
//                         if it names one, otherwise from the price paid
//                         (supporters.js tierFor)
//   order_refunded        ends that order's Premium
//   anything else         nothing
import { json, readText, TooLarge } from './http.js';
import { grant, revoke, secretMatches, tierFor } from './supporters.js';
import { getSettings } from './settings.js';

const MAX_BODY = 64_000;
const UID = /^[\w-]{1,128}$/;

async function signature(body, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const done = (req, env, result) => json(req, env, { result });

export async function handleLemonSqueezy(req, env, url) {
  if (url.pathname !== '/v1/pay/lemonsqueezy') return null;
  if (req.method !== 'POST') return json(req, env, { error: 'method' }, 405);
  const secret = String(env.LEMONSQUEEZY_SIGNING_SECRET || '').trim();
  if (!secret) return json(req, env, { error: 'not_set_up' }, 503);
  // Off until launch (Settings > Support and premium > Lemon Squeezy payments); Lemon Squeezy retries refused calls.
  if (!(await getSettings(env)).lemonsqueezy_payments_enabled) return json(req, env, { error: 'switched_off' }, 503);
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });

  let raw;
  try { raw = await readText(req, MAX_BODY); } catch (e) {
    if (e instanceof TooLarge) return json(req, env, { error: 'too_large' }, 413);
    throw e;
  }
  if (!secretMatches(req.headers.get('X-Signature'), await signature(raw, secret))) return json(req, env, { error: 'forbidden' }, 403);
  let event;
  try { event = JSON.parse(raw); } catch (e) { return json(req, env, { error: 'bad_request' }, 400); }
  const name = event && event.meta && event.meta.event_name;
  const order = event && event.data;
  if (!order || order.type !== 'orders' || !order.id) return done(req, env, `ignored: ${String(name || 'unknown').slice(0, 40)}`);
  const a = order.attributes || {};
  const ref = `order:${order.id}`;

  if (name === 'order_created') {
    if (a.status !== 'paid') return done(req, env, `ignored: order ${String(a.status).slice(0, 20)}`);
    const custom = (event.meta && event.meta.custom_data) || {};
    const uid = typeof custom.uid === 'string' && UID.test(custom.uid) ? custom.uid : null;
    const item = a.first_order_item || {};
    await grant(env, {
      uid, email: a.user_email, kind: 'premium', source: 'lemonsqueezy', ref,
      // total is in cents, before any refund.
      tier: await tierFor(env, { amount: (Number(a.total) || 0) / 100, name: `${item.variant_name || ''} ${item.product_name || ''}` }),
      note: `${event.meta.test_mode ? 'TEST: ' : ''}Lemon Squeezy order ${String(a.identifier || order.id).slice(0, 40)}${item.product_name ? `, ${String(item.product_name).slice(0, 80)}` : ''}`,
    });
    return done(req, env, 'premium');
  }
  if (name === 'order_refunded') {
    await revoke(env, 'lemonsqueezy', ref);
    return done(req, env, 'ended');
  }
  return done(req, env, `ignored: ${String(name || 'unknown').slice(0, 40)}`);
}
