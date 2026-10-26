// Ko-fi payments (money option 2). Ko-fi calls this webhook after each
// payment, with the details as JSON in a form field named "data":
//
//   POST /v1/pay/kofi   (Ko-fi > More > API > Webhook URL)
//
// It checks Ko-fi's verification token (the KOFI_VERIFICATION_TOKEN
// Cloudflare secret), then:
//   Subscription  a membership payment: Premium for 35 days from the payment,
//                 so each monthly payment extends it and a cancelled
//                 membership runs out by itself
//   Donation      a one-off tip: the Supporter badge, with no end
//   Shop Order, Commission and anything else: nothing
// Grants are made out to the payer's email (supporters.js) and reach the
// player when they sign in to the game with that confirmed email.
import { json, readText, TooLarge } from './http.js';
import { grant, cleanEmail, secretMatches } from './supporters.js';

const MAX_BODY = 32_000;
const MEMBERSHIP_DAYS = 35;

// Ko-fi needs a 200 to stop retrying; anything it sends that we can't use is
// still answered 200, with what happened, so it shows in Ko-fi's webhook log.
const done = (req, env, result, status = 200) => json(req, env, { result }, status);

export async function handleKofi(req, env, url) {
  if (url.pathname !== '/v1/pay/kofi') return null;
  if (req.method !== 'POST') return json(req, env, { error: 'method' }, 405);
  if (!String(env.KOFI_VERIFICATION_TOKEN || '').trim()) return json(req, env, { error: 'not_set_up' }, 503);
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });

  let data;
  try {
    const form = new URLSearchParams(await readText(req, MAX_BODY));
    data = JSON.parse(form.get('data') || 'null');
  } catch (e) {
    if (e instanceof TooLarge) return json(req, env, { error: 'too_large' }, 413);
    data = null;
  }
  if (!data || typeof data !== 'object') return json(req, env, { error: 'bad_request' }, 400);
  if (!secretMatches(data.verification_token, env.KOFI_VERIFICATION_TOKEN)) return json(req, env, { error: 'forbidden' }, 403);

  const email = cleanEmail(data.email);
  const paidAt = Date.parse(data.timestamp) || Date.now();
  if (!email) return done(req, env, 'ignored: no email');
  if (data.type === 'Subscription') {
    await grant(env, {
      email, kind: 'premium', source: 'kofi', ref: `member:${email}`,
      until: paidAt + MEMBERSHIP_DAYS * 24 * 3600_000, note: data.tier_name ? `Ko-fi membership: ${String(data.tier_name).slice(0, 80)}` : 'Ko-fi membership',
    });
    return done(req, env, 'premium');
  }
  if (data.type === 'Donation') {
    await grant(env, { email, kind: 'supporter', source: 'kofi', ref: `tip:${email}`, note: 'Ko-fi tip' });
    return done(req, env, 'supporter');
  }
  return done(req, env, `ignored: ${String(data.type || 'unknown').slice(0, 40)}`);
}
