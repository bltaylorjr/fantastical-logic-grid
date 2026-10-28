// Alerts for the owner and admins: a push to their phones and computers, and
// an email, when something needs them. Each admin chooses for themselves in
// the dashboard (Settings > My alerts).
//
//   problems   something is broken or money is at risk: sent at once
//   approvals  something waits for a yes or no: sent at once
//   messages   players wrote in: gathered and sent at most once an hour
//
// Anything not sent at once (or that could not be) goes out with the hourly
// round-up (the "23 * * * *" cron in wrangler.toml). Pushes are free (the
// browser's own push service); emails go through Resend from
// noreply@thelogicgrid.com when the RESEND_API_KEY secret is set.
//
//   GET  /admin/v1/notify                 my choices, my devices, the push key
//   POST /admin/v1/notify/prefs           { emailTo, emailOn, problems, approvals, messages }
//   POST /admin/v1/notify/devices         { endpoint, p256dh, auth, label } this device
//   POST /admin/v1/notify/devices/:id/remove
//   POST /admin/v1/notify/test            a test alert to my devices and email
import { newVapidKeys, sendPush } from './webpush.js';

export const CATEGORIES = ['problems', 'approvals', 'messages'];
const CATEGORY_WORDS = { problems: 'Problem', approvals: 'Waiting for you', messages: 'Messages' };
const KEEP_MS = 30 * 24 * 3600_000;
const DEDUPE_MS = 6 * 3600_000;
const MAX_DEVICES = 10;
const MAIL_FROM = 'The Fantastical Logic Grid <noreply@thelogicgrid.com>';
const ADMIN_URL = 'https://flg-api.btay74.workers.dev/admin/';
// Only the browsers' own push services, so a device address can never point
// the Worker at anything else.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /^push\.services\.mozilla\.com$/];

export function pushHostAllowed(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.username && !u.password && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch (e) { return false; }
}

const clean = (text, max) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
const emailOk = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(e);

// Record an alert. Problems and approvals go out at once when `ctx` is given
// (or with the hourly round-up otherwise); messages wait for the round-up.
// `dedupe` skips a repeat of the same alert within 6 hours. Never throws:
// an alert must never break what the player was doing.
export async function alert(env, ctx, { category, title, body, link = '', dedupe = null, instant = null }) {
  try {
    if (!CATEGORIES.includes(category) || !env.DB) return;
    const now = Date.now();
    if (dedupe) {
      const seen = await env.DB.prepare('SELECT 1 FROM alert_queue WHERE dedupe = ?1 AND created_at > ?2 LIMIT 1').bind(dedupe, now - DEDUPE_MS).first();
      if (seen) return;
    }
    const sendNow = instant ?? category !== 'messages';
    await env.DB.prepare('INSERT INTO alert_queue (category, instant, title, body, link, dedupe, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(category, sendNow ? 1 : 0, clean(title, 120), clean(body, 400), clean(link, 60), dedupe, now).run();
    if (sendNow && ctx?.waitUntil) ctx.waitUntil(sendWaiting(env, { instantOnly: true }).catch((e) => console.error('alerts', e)));
  } catch (e) { console.error('alert not recorded', e); }
}

async function vapidKeys(env) {
  const row = await env.DB.prepare('SELECT public_key, private_jwk FROM alert_keys WHERE id = 1').first();
  if (row) return { publicKey: row.public_key, privateJwk: JSON.parse(row.private_jwk) };
  const keys = await newVapidKeys();
  await env.DB.prepare('INSERT OR IGNORE INTO alert_keys (id, public_key, private_jwk, created_at) VALUES (1, ?1, ?2, ?3)')
    .bind(keys.publicKey, JSON.stringify(keys.privateJwk), Date.now()).run();
  const again = await env.DB.prepare('SELECT public_key, private_jwk FROM alert_keys WHERE id = 1').first();
  return { publicKey: again.public_key, privateJwk: JSON.parse(again.private_jwk) };
}

const subjectFor = (env) => `mailto:${String(env.OWNER_EMAIL || 'support@thelogicgrid.com').trim()}`;

// Admins who still may sign in, with their choices.
async function recipients(env) {
  const { results } = await env.DB.prepare(`SELECT a.actor, p.email_to, COALESCE(p.email_on, 0) AS email_on, COALESCE(p.problems, 1) AS problems,
      COALESCE(p.approvals, 1) AS approvals, COALESCE(p.messages, 1) AS messages
    FROM (SELECT actor FROM alert_prefs UNION SELECT actor FROM alert_devices) a LEFT JOIN alert_prefs p ON p.actor = a.actor`).all();
  const owner = String(env.OWNER_EMAIL || '').trim().toLowerCase();
  const out = [];
  for (const r of results) {
    const ok = r.actor === owner || !!(await env.DB.prepare('SELECT 1 FROM admins WHERE email = ?1').bind(r.actor).first());
    if (ok) out.push(r);
  }
  return out;
}

// One push per device and one email per admin for a batch of alerts.
function summarize(items) {
  if (items.length === 1) {
    const a = items[0];
    return { title: a.title, body: a.body, link: a.link || '', tag: `flg-${a.category}` };
  }
  const counts = {};
  for (const a of items) counts[a.category] = (counts[a.category] || 0) + 1;
  const title = `${items.length} things in the Logic Grid dashboard`;
  const body = Object.entries(counts).map(([c, n]) => `${CATEGORY_WORDS[c]}: ${n}`).join(' · ') + `. Latest: ${items.at(-1).title}`;
  return { title, body: clean(body, 400), link: items.find((a) => a.category === 'problems')?.link || items.at(-1).link || '', tag: 'flg-roundup' };
}

async function sendEmail(env, to, items) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: 'no_key' };
  const s = summarize(items);
  const base = ADMIN_URL;
  const lines = items.map((a) => `• ${CATEGORY_WORDS[a.category]}: ${a.title}\n  ${a.body}${a.link ? `\n  ${base}#${a.link}` : ''}`);
  const text = `${lines.join('\n\n')}\n\nOpen the dashboard: ${base}\nChange or stop these alerts in the dashboard: Settings > My alerts.`;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px">${items.map((a) => `<p><b>${esc(CATEGORY_WORDS[a.category])}: ${esc(a.title)}</b><br>${esc(a.body)}${a.link ? `<br><a href="${esc(`${base}#${a.link}`)}">Open in the dashboard</a>` : ''}</p>`).join('')}<p style="color:#666;font-size:13px">Change or stop these alerts in the dashboard: Settings &gt; My alerts.</p></div>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject: `[Logic Grid] ${s.title}`, text, html, headers: { 'Auto-Submitted': 'auto-generated' } }),
  });
  return { ok: res.ok, reason: res.ok ? null : `resend_${res.status}` };
}

async function deliver(env, who, items, keys, now) {
  const wanted = items.filter((a) => who[a.category]);
  const result = { pushed: 0, emailed: false, failed: 0 };
  if (!wanted.length) return result;
  const payload = summarize(wanted);
  const { results: devices } = await env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM alert_devices WHERE actor = ?1').bind(who.actor).all();
  for (const d of devices) {
    try {
      const r = await sendPush(d, payload, keys, subjectFor(env), { urgency: wanted.some((a) => a.category === 'problems') ? 'high' : 'normal' });
      if (r.gone) await env.DB.prepare('DELETE FROM alert_devices WHERE id = ?1').bind(d.id).run();
      else await env.DB.prepare('UPDATE alert_devices SET last_sent_at = ?2, last_error = ?3 WHERE id = ?1').bind(d.id, now, r.ok ? null : `status ${r.status}`).run();
      if (r.ok) result.pushed++; else result.failed++;
    } catch (e) {
      result.failed++;
      await env.DB.prepare('UPDATE alert_devices SET last_error = ?2 WHERE id = ?1').bind(d.id, clean(e.message, 120)).run();
    }
  }
  if (who.email_on && emailOk(who.email_to)) {
    try { result.emailed = (await sendEmail(env, who.email_to, wanted)).ok; } catch (e) { console.error('alert email', e); }
  }
  return result;
}

// Send what is waiting. With instantOnly, just the problems and approvals
// (right after one is recorded); otherwise everything (the hourly round-up).
export async function sendWaiting(env, { instantOnly = false, now = Date.now() } = {}) {
  const { results: items } = await env.DB.prepare(`SELECT id, category, title, body, link FROM alert_queue WHERE sent_at IS NULL ${instantOnly ? 'AND instant = 1' : ''} ORDER BY id LIMIT 100`).all();
  if (!items.length) return { sent: 0 };
  // Mark them first, so two copies of the Worker never send the same alert twice.
  const ids = items.map((a) => a.id);
  const claimed = await env.DB.prepare(`UPDATE alert_queue SET sent_at = ?1 WHERE sent_at IS NULL AND id IN (${ids.map(() => '?').join(',')}) RETURNING id`).bind(now, ...ids).all();
  const mine = new Set(claimed.results.map((r) => r.id));
  const batch = items.filter((a) => mine.has(a.id));
  if (!batch.length) return { sent: 0 };
  const keys = await vapidKeys(env);
  const people = await recipients(env);
  const totals = { sent: batch.length, pushed: 0, emailed: 0, failed: 0 };
  for (const who of people) {
    const r = await deliver(env, who, batch, keys, now);
    totals.pushed += r.pushed; totals.failed += r.failed; totals.emailed += r.emailed ? 1 : 0;
  }
  await env.DB.prepare('DELETE FROM alert_queue WHERE created_at < ?1').bind(now - KEEP_MS).run();
  return totals;
}

// ---- Dashboard routes (admin.js adds these to its list) ----
export function alertRoutes(Refusal) {
  const prefsOf = async (env, actor) => {
    const p = await env.DB.prepare('SELECT email_to, email_on, problems, approvals, messages FROM alert_prefs WHERE actor = ?1').bind(actor).first();
    return { emailTo: p?.email_to || '', emailOn: !!p?.email_on, problems: p ? !!p.problems : true, approvals: p ? !!p.approvals : true, messages: p ? !!p.messages : true };
  };
  const mineOnly = (who) => { if (!who.uid) throw new Refusal(403, 'sign_in', 'Sign in with your own account to set up alerts.'); };
  return [
    ['GET', /^notify$/, 'viewer', 'notify.view', async ({ env, who }) => {
      mineOnly(who);
      const keys = await vapidKeys(env);
      const { results } = await env.DB.prepare('SELECT id, label, created_at AS createdAt, last_sent_at AS lastSentAt, last_error AS lastError FROM alert_devices WHERE actor = ?1 ORDER BY id').bind(who.actor).all();
      return { body: { publicKey: keys.publicKey, prefs: await prefsOf(env, who.actor), devices: results, emailReady: !!env.RESEND_API_KEY, signedInAs: who.actor }, quiet: true };
    }],
    ['POST', /^notify\/prefs$/, 'viewer', 'notify.prefs', async ({ env, who, body, now }) => {
      mineOnly(who);
      const emailTo = clean(body.emailTo, 254);
      if (emailTo && !emailOk(emailTo)) throw new Refusal(400, 'bad_email', 'That email address does not look right.');
      const emailOn = body.emailOn === true;
      if (emailOn && !emailTo) throw new Refusal(400, 'bad_email', 'Type the email address to send alerts to.');
      const flags = CATEGORIES.map((c) => (body[c] === false ? 0 : 1));
      await env.DB.prepare(`INSERT INTO alert_prefs (actor, email_to, email_on, problems, approvals, messages, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT (actor) DO UPDATE SET email_to = excluded.email_to, email_on = excluded.email_on, problems = excluded.problems, approvals = excluded.approvals, messages = excluded.messages, updated_at = excluded.updated_at`)
        .bind(who.actor, emailTo || null, emailOn ? 1 : 0, ...flags, now).run();
      return { body: { ok: true, prefs: await prefsOf(env, who.actor) }, detail: { emailOn, problems: !!flags[0], approvals: !!flags[1], messages: !!flags[2] } };
    }],
    ['POST', /^notify\/devices$/, 'viewer', 'notify.device_add', async ({ env, who, body, now }) => {
      mineOnly(who);
      const endpoint = String(body.endpoint || '');
      if (endpoint.length > 1000 || !pushHostAllowed(endpoint)) throw new Refusal(400, 'bad_device', 'This browser\'s push service is not supported.');
      if (!/^[\w-]{80,100}$/.test(String(body.p256dh)) || !/^[\w-]{16,32}$/.test(String(body.auth))) throw new Refusal(400, 'bad_device', 'The browser sent an incomplete push address.');
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM alert_devices WHERE actor = ?1 AND endpoint != ?2').bind(who.actor, endpoint).first();
      if (n >= MAX_DEVICES) throw new Refusal(409, 'too_many', `You can have up to ${MAX_DEVICES} devices. Remove one first.`);
      const label = clean(body.label, 60) || 'This device';
      const row = await env.DB.prepare(`INSERT INTO alert_devices (actor, endpoint, p256dh, auth, label, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT (endpoint) DO UPDATE SET actor = excluded.actor, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label, last_error = NULL RETURNING id`)
        .bind(who.actor, endpoint, body.p256dh, body.auth, label, now).first();
      return { body: { ok: true, id: row.id }, target: String(row.id), detail: { label } };
    }],
    ['POST', /^notify\/devices\/(\d{1,12})\/remove$/, 'viewer', 'notify.device_remove', async ({ env, who, params: [id] }) => {
      mineOnly(who);
      await env.DB.prepare('DELETE FROM alert_devices WHERE id = ?1 AND actor = ?2').bind(Number(id), who.actor).run();
      return { body: { ok: true }, target: id };
    }],
    ['POST', /^notify\/test$/, 'viewer', 'notify.test', async ({ env, who, now }) => {
      mineOnly(who);
      const keys = await vapidKeys(env);
      const p = await env.DB.prepare('SELECT email_to, email_on FROM alert_prefs WHERE actor = ?1').bind(who.actor).first();
      const me = { actor: who.actor, email_to: p?.email_to, email_on: p?.email_on || 0, problems: 1, approvals: 1, messages: 1 };
      const r = await deliver(env, me, [{ category: 'problems', title: 'Test alert', body: 'Alerts are working on this device.', link: 'settings' }], keys, now);
      return { body: { ok: true, ...r, emailReady: !!env.RESEND_API_KEY }, quiet: true };
    }],
  ];
}
