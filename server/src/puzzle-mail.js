// Puzzle emails: anyone, signed in or not, can ask for the weekly puzzle and
// special edition puzzles by email. The domain's DNS is not on Cloudflare, so
// the Worker cannot send email: the GitHub Action .github/workflows/puzzle-mail.yml
// asks for what is due every 15 minutes (the claim routes below), sends it
// from the game's address and reports back.
//
//   GET  /v1/mail                         signed in: { weekly, special, pending, verified }
//   POST /v1/mail { weekly, special }     signed in with a confirmed email: set the lists
//   POST /v1/mail/signup { email, weekly, special }
//                                         anyone: we email a confirm link first (a signed-in
//                                         player's own confirmed address needs none)
//   GET|POST /v1/mail/confirm?t=          the confirm link: a page with a Confirm button
//                                         (mail scanners open links, so only the button confirms)
//   GET|POST /v1/mail/unsubscribe?t=&l=   the link in every email; l = weekly, special or all.
//                                         POST is the mail programs' one-click unsubscribe
//   GET|POST /v1/mail/settings?t=         a page to change which emails come
//
// Kept: the address, which lists, a random token for the links and, for a
// player, the account id. Nothing is sent to a guest's address except the
// confirm email until they press Confirm; an unconfirmed address is removed
// after 7 days. Unsubscribing from both lists, the admin removing it or
// deleting the account removes the row. Limits: each address gets at most 3
// confirm emails a day, 10 minutes apart; puzzle_mail_daily_cap emails a day
// in all; the switches in the admin dashboard (Settings > Puzzle emails).
import { verifyIdToken, AuthError } from './auth.js';
import { getSettings } from './settings.js';
import { json, readText, TooLarge } from './http.js';
import { editionRows } from './editions.js';

const DAY = 24 * 3600_000;
const CLAIM_MAX = 100;
const CONFIRM_TTL = 7 * DAY;
const CONFIRM_GAP = 10 * 60_000;
const CONFIRM_PER_DAY = 3;
const PENDING_MAX = 5000; // unconfirmed addresses kept at once, so a flood cannot fill the database
const SEND_HOUR = 11; // UTC: about 7 am Eastern (6 am in winter)
const SPECIAL_DAYS = 7; // a special edition keeps going out for a week after its day
const GOT_KEEP = 120 * DAY;
const ROUTE = /^\/v1\/mail(?:\/(signup|confirm|unsubscribe|settings))?$/;
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,63}$/;
const TOKEN = /^[0-9a-f]{32}$/;
const LISTS = ['weekly', 'special'];
const NAMES = { weekly: 'the weekly puzzle', special: 'special edition puzzles' };

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const bearer = (req) => (req.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/)?.[1] || '';
export const cleanEmail = (v) => { const e = typeof v === 'string' ? v.trim().toLowerCase() : ''; return e.length <= 254 && EMAIL.test(e) ? e : null; };
// The Monday (UTC) that starts the week of `ms`.
export const weekOf = (ms) => { const d = new Date(ms); return isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))); };
const at = (day, hour = 0) => Date.parse(`${day}T00:00:00Z`) + hour * 3600_000;
const listWords = (l) => l.map((x) => NAMES[x]).join(' and ');

function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------- pages
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const BTN = 'display:inline-block;background:#7a3e00;color:#ffffff;border:0;border-radius:8px;padding:12px 20px;font:bold 17px Arial,Helvetica,sans-serif;cursor:pointer;text-decoration:none';

// paras: plain text lines; form: { action, fields: {name: value}, checks: [[name, label, on]], button }.
function page(title, paras, { form, links = [], status = 200 } = {}) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head>
<body style="margin:0;padding:24px;background:#f6f1e7;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.5;color:#1f1a14">
<main style="max-width:520px;margin:40px auto;background:#fffdf8;border-radius:10px;padding:24px"><h1 style="font-size:22px;margin:0 0 12px">${esc(title)}</h1>${paras.map((p) => `<p>${esc(p)}</p>`).join('')}
${form ? `<form method="post" action="${esc(form.action)}">${Object.entries(form.fields || {}).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}
${(form.checks || []).map(([k, label, on]) => `<p><label style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="${esc(k)}" value="1"${on ? ' checked' : ''} style="width:22px;height:22px"> ${esc(label)}</label></p>`).join('')}
<p><button type="submit" style="${BTN}">${esc(form.button)}</button></p></form>` : ''}
${[...links, ['https://thelogicgrid.com/', 'Go to The Fantastical Logic Grid']].map(([href, text]) => `<p><a href="${esc(href)}" style="color:#7a3e00">${esc(text)}</a></p>`).join('')}</main></body></html>`;
  return new Response(body, { status, headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  } });
}

async function formBody(req) {
  try { return new URLSearchParams(await readText(req, 2000)); } catch (e) { return new URLSearchParams(); }
}

// ------------------------------------------------------------- the list
const byEmail = (db, email) => db.prepare('SELECT * FROM puzzle_mail WHERE email = ?1').bind(email).first();
const byToken = (db, col, t) => (TOKEN.test(t || '') ? db.prepare(`SELECT * FROM puzzle_mail WHERE ${col} = ?1`).bind(t).first() : null);
const listsOf = (r) => LISTS.filter((l) => r && r[l]);
const wantOf = (r) => String((r && r.want) || '').split(',').filter((l) => LISTS.includes(l));

// Sets a confirmed address's lists directly; none at all removes it.
async function setLists(db, { email, uid = null, weekly, special, source }, now) {
  if (!weekly && !special) {
    await db.prepare('DELETE FROM puzzle_mail WHERE email = ?1').bind(email).run();
    return;
  }
  await db.prepare(`INSERT INTO puzzle_mail (email, uid, weekly, special, token, source, created_at, confirmed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
    ON CONFLICT (email) DO UPDATE SET uid = COALESCE(excluded.uid, uid), weekly = excluded.weekly, special = excluded.special,
      confirmed_at = COALESCE(confirmed_at, excluded.confirmed_at), want = NULL, confirm = NULL, confirm_due = 0`)
    .bind(email, uid, weekly ? 1 : 0, special ? 1 : 0, newToken(), source, now).run();
}

// Unconfirmed addresses go after 7 days; old send records after 120.
async function prune(db, now) {
  await db.batch([
    db.prepare('DELETE FROM puzzle_mail WHERE weekly = 0 AND special = 0 AND (confirm_at IS NULL OR confirm_at < ?1)').bind(now - CONFIRM_TTL),
    db.prepare('UPDATE puzzle_mail SET want = NULL, confirm = NULL, confirm_due = 0 WHERE confirm IS NOT NULL AND confirm_at < ?1').bind(now - CONFIRM_TTL),
    db.prepare('DELETE FROM puzzle_mail_got WHERE at < ?1').bind(now - GOT_KEEP),
    db.prepare('DELETE FROM puzzle_mail_days WHERE day < ?1').bind(isoDay(now - 30 * DAY)),
  ]);
}

// Asks for a confirm email for `lists`. Always looks the same to the caller,
// so the form cannot be used to find out who is on the list.
export async function requestConfirm(env, email, lists, source, now) {
  const db = env.DB;
  const day = isoDay(now);
  const r = await byEmail(db, email);
  const want = [...new Set([...wantOf(r), ...lists])].join(',');
  if (r) {
    if (lists.every((l) => r[l])) return 'already';
    const n = r.confirm_day === day ? r.confirm_n : 0;
    if (n >= CONFIRM_PER_DAY || (r.confirm_at && now - r.confirm_at < CONFIRM_GAP)) {
      if (r.confirm) await db.prepare('UPDATE puzzle_mail SET want = ?1 WHERE id = ?2').bind(want, r.id).run();
      return 'waiting';
    }
    await db.prepare('UPDATE puzzle_mail SET want = ?1, confirm = ?2, confirm_due = 1, confirm_at = ?3, confirm_day = ?4, confirm_n = ?5 WHERE id = ?6')
      .bind(want, newToken(), now, day, n + 1, r.id).run();
    return 'sent';
  }
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM puzzle_mail WHERE weekly = 0 AND special = 0').first();
  if (n >= PENDING_MAX) return 'full';
  await db.prepare(`INSERT INTO puzzle_mail (email, weekly, special, token, want, confirm, confirm_due, confirm_at, confirm_day, confirm_n, source, created_at)
    VALUES (?1, 0, 0, ?2, ?3, ?4, 1, ?5, ?6, 1, ?7, ?5)`).bind(email, newToken(), want, newToken(), now, day, source).run();
  return 'sent';
}

async function confirmToken(db, t, now) {
  const r = await byToken(db, 'confirm', t);
  if (!r || !r.confirm_at || now - r.confirm_at > CONFIRM_TTL) return null;
  const want = wantOf(r);
  await db.prepare('UPDATE puzzle_mail SET weekly = MAX(weekly, ?1), special = MAX(special, ?2), want = NULL, confirm = NULL, confirm_due = 0, confirmed_at = COALESCE(confirmed_at, ?3) WHERE id = ?4')
    .bind(want.includes('weekly') ? 1 : 0, want.includes('special') ? 1 : 0, now, r.id).run();
  return { ...r, weekly: r.weekly || want.includes('weekly') ? 1 : 0, special: r.special || want.includes('special') ? 1 : 0 };
}

async function unsubscribe(db, r, which) {
  const off = which === 'weekly' || which === 'special' ? [which] : LISTS;
  const left = LISTS.filter((l) => r[l] && !off.includes(l));
  if (!left.length) await db.prepare('DELETE FROM puzzle_mail WHERE id = ?1').bind(r.id).run();
  else await db.prepare(`UPDATE puzzle_mail SET ${off.map((l) => `${l} = 0`).join(', ')} WHERE id = ?1`).bind(r.id).run();
  return left;
}

async function readJson(req) {
  try { return { body: JSON.parse(await readText(req, 1000)) }; } catch (e) {
    return { error: e instanceof TooLarge ? 'too_large' : 'bad_request', status: e instanceof TooLarge ? 413 : 400 };
  }
}

async function account(req, env) {
  if (!bearer(req)) return null;
  try {
    const user = await verifyIdToken(bearer(req), env);
    const email = cleanEmail(user.email);
    return { uid: user.uid, email, verified: !!user.emailVerified && !!email };
  } catch (e) {
    if (e instanceof AuthError) return { bad: true };
    throw e;
  }
}

// The lists that are switched on in the admin dashboard.
const openLists = (s) => (s.puzzle_mail_enabled ? LISTS.filter((l) => s[`${l}_mail_enabled`]) : []);
const OFF = { error: 'off', message: 'Puzzle emails are switched off for now.' };
const SAVED = { sent: 'Check your inbox: we sent you a link to confirm. Nothing else comes until you press Confirm in that email.', waiting: 'Check your inbox for the confirm link we sent you. If it is not there, look in spam, or try again later.', already: 'You are already signed up for those.', full: 'Sign-ups are full for now. Please try again tomorrow.' };

export async function handlePuzzleMail(req, env, url) {
  const m = url.pathname.match(ROUTE);
  if (!m) return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_AUTHLESS && !(await env.LIMIT_AUTHLESS.limit({ key: ip })).success) return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  const db = env.DB;
  const now = Date.now();
  const kind = m[1] || '';
  if (req.method !== 'GET' && req.method !== 'POST') return json(req, env, { error: 'not_found' }, 404);

  // ---- the links in emails: pages, not JSON
  if (kind === 'confirm') {
    const t = req.method === 'POST' ? (await formBody(req)).get('t') : url.searchParams.get('t');
    const r = await byToken(db, 'confirm', t);
    const expired = () => page('This link has expired', ['This confirm link was already used or is more than 7 days old. To sign up again, open Menu > Puzzle emails in the game.'], { status: 404 });
    if (!r || !r.confirm_at || now - r.confirm_at > CONFIRM_TTL) return expired();
    if (req.method === 'GET') {
      return page('Confirm your puzzle emails', [`Press Confirm to get ${listWords(wantOf(r))} from The Fantastical Logic Grid at ${r.email}.`, 'If you did not ask for this, close this page and nothing more will come.'],
        { form: { action: '/v1/mail/confirm', fields: { t }, button: 'Confirm' } });
    }
    const done = await confirmToken(db, t, now);
    if (!done) return expired();
    return page('You are signed up', [`You will get ${listWords(listsOf(done))} at ${done.email}.`, 'Every email has a one-click unsubscribe link, and the change my emails link lets you pick again.'],
      { links: [[`/v1/mail/settings?t=${done.token}`, 'Change my emails']] });
  }
  if (kind === 'unsubscribe') {
    const t = url.searchParams.get('t') || (req.method === 'POST' ? (await formBody(req)).get('t') : '');
    const which = url.searchParams.get('l') || 'all';
    const r = await byToken(db, 'token', t);
    const left = r ? await unsubscribe(db, r, which) : [];
    // The same answer whether or not the token was on the list.
    if (req.method === 'POST') return new Response(null, { status: 204 });
    const gone = which === 'weekly' || which === 'special' ? NAMES[which] : 'puzzle emails';
    return page('You are unsubscribed', [`You will not get ${gone} by email any more.`, left.length ? `You still get ${listWords(left)}.` : 'You can sign up again from Menu > Puzzle emails in the game at any time.'],
      { links: r && left.length ? [[`/v1/mail/settings?t=${r.token}`, 'Change my emails']] : [] });
  }
  if (kind === 'settings') {
    const f = req.method === 'POST' ? await formBody(req) : null;
    const t = f ? f.get('t') : url.searchParams.get('t');
    const r = await byToken(db, 'token', t);
    if (!r) return page('These emails are off', ['This address is not on the list any more. You can sign up again from Menu > Puzzle emails in the game.'], { status: 404 });
    if (f) {
      const weekly = f.get('weekly') === '1', special = f.get('special') === '1';
      await setLists(db, { email: r.email, weekly, special, source: r.source }, now);
      const on = LISTS.filter((l) => ({ weekly, special })[l]);
      return page('Saved', [on.length ? `You will get ${listWords(on)} at ${r.email}.` : `${r.email} is off the list. Nothing more will come.`],
        { links: on.length ? [[`/v1/mail/settings?t=${t}`, 'Change my emails']] : [] });
    }
    return page('Your puzzle emails', [`For ${r.email}. Untick both to stop every email.`],
      { form: { action: '/v1/mail/settings', fields: { t }, checks: [['weekly', 'The weekly puzzle (Mondays)', !!r.weekly], ['special', 'Special edition puzzles', !!r.special]], button: 'Save' } });
  }

  // ---- the game
  const s = await getSettings(env, now);
  const open = openLists(s);
  const who = await account(req, env);
  if (who && who.bad) return json(req, env, { error: 'sign_in' }, 401);

  if (kind === '') {
    if (!who) return json(req, env, { error: 'sign_in' }, 401);
    const r = who.email ? await db.prepare('SELECT * FROM puzzle_mail WHERE email = ?1 OR uid = ?2 ORDER BY (email = ?1) DESC LIMIT 1').bind(who.email, who.uid).first()
      : await db.prepare('SELECT * FROM puzzle_mail WHERE uid = ?1').bind(who.uid).first();
    if (req.method === 'GET') return json(req, env, { weekly: !!(r && r.weekly), special: !!(r && r.special), pending: wantOf(r), verified: who.verified, open });
    if (!who.verified) return json(req, env, { error: 'unverified', message: 'Confirm your account\'s email address first: open the link we sent when you made your account.' }, 403);
    const b = await readJson(req);
    if (b.error) return json(req, env, { error: b.error }, b.status);
    const turnOn = LISTS.filter((l) => b.body && b.body[l]);
    if (turnOn.some((l) => !open.includes(l) && !(r && r[l]))) return json(req, env, OFF, 403);
    // A player's old address (the account's email changed) moves to the new one.
    if (r && r.email !== who.email) await db.prepare('DELETE FROM puzzle_mail WHERE id = ?1').bind(r.id).run();
    await setLists(db, { email: who.email, uid: who.uid, weekly: turnOn.includes('weekly'), special: turnOn.includes('special'), source: 'account' }, now);
    return json(req, env, { weekly: turnOn.includes('weekly'), special: turnOn.includes('special'), pending: [], verified: true, open });
  }

  // kind === 'signup'
  if (req.method !== 'POST') return json(req, env, { error: 'not_found' }, 404);
  const b = await readJson(req);
  if (b.error) return json(req, env, { error: b.error }, b.status);
  const lists = LISTS.filter((l) => b.body && b.body[l]);
  if (!lists.length) return json(req, env, { error: 'no_lists', message: 'Tick at least one kind of email.' }, 400);
  if (!open.length || lists.some((l) => !open.includes(l))) return json(req, env, OFF, 403);
  const typed = b.body.email ? cleanEmail(b.body.email) : null;
  if (b.body.email && !typed) return json(req, env, { error: 'bad_email', message: 'That does not look like an email address. Check it and try again.' }, 400);
  const email = typed || (who && who.email);
  if (!email) return json(req, env, { error: 'bad_email', message: 'Type your email address.' }, 400);
  await prune(db, now);
  // A signed-in player's own confirmed address: no confirm email needed.
  if (who && who.verified && email === who.email) {
    const r = await byEmail(db, email);
    await setLists(db, { email, uid: who.uid, weekly: lists.includes('weekly') || !!(r && r.weekly), special: lists.includes('special') || !!(r && r.special), source: 'account' }, now);
    return json(req, env, { status: 'on', message: `Done. You will get ${listWords(lists)} at ${email}.` });
  }
  const result = await requestConfirm(env, email, lists, 'game', now);
  return json(req, env, { status: result === 'full' ? 'full' : 'check_email', message: SAVED[result === 'already' ? 'sent' : result] });
}

export const deletePuzzleMailStatement = (env, uid) => env.DB.prepare('DELETE FROM puzzle_mail WHERE uid = ?1').bind(uid);

// ------------------------------------------------------------- the sender
// How many more puzzle emails may go today, and counting the ones handed out.
async function allowance(db, s, limit, now) {
  const used = (await db.prepare('SELECT n FROM puzzle_mail_days WHERE day = ?1').bind(isoDay(now)).first())?.n || 0;
  return Math.max(0, Math.min(CLAIM_MAX, Math.max(1, Number(limit) || CLAIM_MAX), s.puzzle_mail_daily_cap - used));
}
const countSent = (db, n, now) => db.prepare('INSERT INTO puzzle_mail_days (day, n) VALUES (?1, ?2) ON CONFLICT (day) DO UPDATE SET n = n + excluded.n').bind(isoDay(now), n);

// What is due now: the confirm emails waiting, this week's weekly puzzle (from
// Monday at SEND_HOUR UTC) and the special editions whose day has come.
export async function mailDue(env, now = Date.now()) {
  const s = await getSettings(env, now);
  if (!s.puzzle_mail_enabled) return { off: true, confirms: 0, weekly: null, specials: [] };
  const db = env.DB;
  await prune(db, now);
  const confirms = (await db.prepare('SELECT COUNT(*) AS n FROM puzzle_mail WHERE confirm_due = 1').first()).n;
  const week = weekOf(now);
  const weekly = s.weekly_mail_enabled && now >= at(week, SEND_HOUR) ? week : null;
  const today = isoDay(now);
  const specials = !s.special_mail_enabled ? [] : (await editionRows(env))
    .filter((e) => e.date <= today && e.date > isoDay(now - SPECIAL_DAYS * DAY) && now >= at(e.date, SEND_HOUR))
    .map((e) => ({ id: e.id, date: e.date, title: e.title, note: e.note }));
  // The support line in the email footer, only once support asks are switched on.
  const support = s.support_asks_enabled && s.support_link_enabled && s.support_url ? s.support_url : '';
  return { off: false, confirms, weekly, specials, support };
}

// Confirm emails: hands them out once (a failed one is put back).
export async function claimConfirms(env, limit, now = Date.now()) {
  const s = await getSettings(env, now);
  if (!s.puzzle_mail_enabled) return { off: true, list: [] };
  const db = env.DB;
  const n = await allowance(db, s, limit, now);
  if (!n) return { off: false, list: [] };
  const { results } = await db.prepare('SELECT id, email, confirm, want FROM puzzle_mail WHERE confirm_due = 1 AND confirm_at >= ?1 ORDER BY confirm_at LIMIT ?2').bind(now - CONFIRM_TTL, n).all();
  if (results.length) await db.batch([...results.map((r) => db.prepare('UPDATE puzzle_mail SET confirm_due = 0 WHERE id = ?1').bind(r.id)), countSent(db, results.length, now)]);
  return { off: false, list: results.map((r) => ({ token: r.confirm, email: r.email, lists: wantOf(r) })) };
}

export async function finishConfirms(env, failed, refused) {
  const tokens = (v) => (Array.isArray(v) ? v : []).filter((t) => typeof t === 'string' && TOKEN.test(t)).slice(0, CLAIM_MAX);
  const db = env.DB;
  const stmts = [
    ...tokens(failed).map((t) => db.prepare('UPDATE puzzle_mail SET confirm_due = 1 WHERE confirm = ?1').bind(t)),
    // An address the mail service refuses: gone if it had no lists yet.
    ...tokens(refused).map((t) => db.prepare('DELETE FROM puzzle_mail WHERE confirm = ?1 AND weekly = 0 AND special = 0').bind(t)),
    ...tokens(refused).map((t) => db.prepare('UPDATE puzzle_mail SET want = NULL, confirm = NULL, confirm_due = 0 WHERE confirm = ?1').bind(t)),
  ];
  if (stmts.length) await db.batch(stmts);
  return { retry: tokens(failed).length, removed: tokens(refused).length };
}

// A weekly or special send: 'weekly-<Monday>' or 'special-<edition id>'.
// Each address gets it once; checked against what is due now.
async function sendList(env, send, now) {
  const due = await mailDue(env, now);
  if (due.off) return { off: true };
  const m = String(send).match(/^(weekly|special)-(.+)$/);
  if (!m) return { error: 'bad_send' };
  if (m[1] === 'weekly') return due.weekly === m[2] ? { list: 'weekly', due } : { error: 'not_due' };
  return due.specials.some((e) => e.id === m[2]) ? { list: 'special', due } : { error: 'not_due' };
}

export async function claimSend(env, send, limit, now = Date.now()) {
  const v = await sendList(env, send, now);
  if (v.off) return { off: true, list: [] };
  if (v.error) return { error: v.error };
  const db = env.DB;
  const s = await getSettings(env, now);
  const n = await allowance(db, s, limit, now);
  if (!n) return { off: false, list: [], capped: true };
  const { results } = await db.prepare(`SELECT id, token, email FROM puzzle_mail WHERE ${v.list} = 1
    AND id NOT IN (SELECT mail_id FROM puzzle_mail_got WHERE send = ?1) ORDER BY id LIMIT ?2`).bind(send, n).all();
  if (results.length) await db.batch([...results.map((r) => db.prepare('INSERT OR IGNORE INTO puzzle_mail_got (send, mail_id, at) VALUES (?1, ?2, ?3)').bind(send, r.id, now)), countSent(db, results.length, now)]);
  return { off: false, list: results.map((r) => ({ token: r.token, email: r.email })) };
}

export async function finishSend(env, send, failed, refused) {
  const tokens = (v) => (Array.isArray(v) ? v : []).filter((t) => typeof t === 'string' && TOKEN.test(t)).slice(0, CLAIM_MAX);
  const db = env.DB;
  const stmts = [
    ...tokens(failed).map((t) => db.prepare('DELETE FROM puzzle_mail_got WHERE send = ?1 AND mail_id = (SELECT id FROM puzzle_mail WHERE token = ?2)').bind(String(send), t)),
    ...tokens(refused).map((t) => db.prepare('DELETE FROM puzzle_mail WHERE token = ?1').bind(t)),
  ];
  if (stmts.length) await db.batch(stmts);
  return { retry: tokens(failed).length, removed: tokens(refused).length };
}

// ------------------------------------------------------------- the dashboard
async function overview(env, now) {
  const db = env.DB;
  const c = await db.prepare(`SELECT SUM(weekly) AS weekly, SUM(special) AS special, SUM(weekly = 0 AND special = 0) AS waiting,
    SUM(weekly = 1 OR special = 1) AS people, SUM(uid IS NOT NULL AND (weekly = 1 OR special = 1)) AS players FROM puzzle_mail`).first();
  const { results: sends } = await db.prepare('SELECT send, COUNT(*) AS n, MIN(at) AS first, MAX(at) AS last FROM puzzle_mail_got GROUP BY send ORDER BY first DESC LIMIT 20').all();
  const today = (await db.prepare('SELECT n FROM puzzle_mail_days WHERE day = ?1').bind(isoDay(now)).first())?.n || 0;
  const s = await getSettings(env, now);
  return {
    counts: { weekly: c.weekly || 0, special: c.special || 0, waiting: c.waiting || 0, people: c.people || 0, players: c.players || 0 },
    sends, today, cap: s.puzzle_mail_daily_cap, week: weekOf(now),
    switches: { puzzle_mail_enabled: s.puzzle_mail_enabled, weekly_mail_enabled: s.weekly_mail_enabled, special_mail_enabled: s.special_mail_enabled },
  };
}

const rowOut = (r) => ({ id: r.id, email: r.email, player: !!r.uid, weekly: !!r.weekly, special: !!r.special, waiting: wantOf(r), source: r.source, createdAt: r.created_at, confirmedAt: r.confirmed_at });

export function puzzleMailRoutes(Refusal) {
  return [
    ['GET', /^mail$/, 'viewer', 'mail.view', async ({ env, now }) => ({ body: await overview(env, now), quiet: true })],
    // Addresses are only shown to admins, and only what was searched for.
    ['GET', /^mail\/find$/, 'admin', 'mail.find', async ({ env, url }) => {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 100);
      if (q.length < 3) throw new Refusal(400, 'short', 'Type at least 3 letters of the address.');
      const { results } = await env.DB.prepare("SELECT * FROM puzzle_mail WHERE email LIKE ?1 ESCAPE '\\' ORDER BY email LIMIT 50").bind(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`).all();
      return { body: { rows: results.map(rowOut) }, detail: { found: results.length } };
    }],
    ['POST', /^mail\/(\d{1,12})\/remove$/, 'admin', 'mail.remove', async ({ env, params: [id] }) => {
      const r = await env.DB.prepare('DELETE FROM puzzle_mail WHERE id = ?1').bind(Number(id)).run();
      if (!r.meta.changes) throw new Refusal(404, 'gone', 'That address is not on the list.');
      return { body: { ok: true }, target: id };
    }],
    // Someone asked by email or in person: they still get a confirm link, so
    // nobody is put on the list without saying yes themselves.
    ['POST', /^mail\/add$/, 'admin', 'mail.add', async ({ env, body, now }) => {
      const email = cleanEmail(body.email);
      if (!email) throw new Refusal(400, 'bad_email', 'Enter an email address.');
      const lists = LISTS.filter((l) => body[l]);
      if (!lists.length) throw new Refusal(400, 'no_lists', 'Tick at least one kind of email.');
      const r = await requestConfirm(env, email, lists, 'admin', now);
      const words = { sent: 'A confirm link goes out within 15 minutes.', waiting: 'A confirm link was sent a moment ago (at most 3 a day, 10 minutes apart).', already: 'That address already gets those.', full: 'Too many unconfirmed addresses right now.' };
      return { body: { ok: r !== 'full', status: r, message: words[r] }, detail: { lists, status: r } };
    }],
    ['GET', /^export\/mail\.csv$/, 'owner', 'mail.export', async ({ env, now }) => {
      const { results } = await env.DB.prepare('SELECT * FROM puzzle_mail WHERE weekly = 1 OR special = 1 ORDER BY id').all();
      const cell = (v) => { let t = String(v ?? ''); if (/^[=+\-@]/.test(t)) t = `'${t}`; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
      const lines = [['email', 'weekly', 'special', 'player', 'signed up', 'confirmed'], ...results.map((r) => [r.email, r.weekly ? 'yes' : 'no', r.special ? 'yes' : 'no', r.uid ? 'yes' : 'no', isoDay(r.created_at), r.confirmed_at ? isoDay(r.confirmed_at) : ''])];
      return { file: `﻿${lines.map((l) => l.map(cell).join(',')).join('\r\n')}\r\n`, type: 'text/csv; charset=utf-8', name: `logic-grid-puzzle-emails-${isoDay(now)}.csv`, detail: { rows: results.length } };
    }],
    // ---- for the GitHub Action (.github/workflows/puzzle-mail.yml); addresses are never written to the audit log.
    ['POST', /^mail\/due$/, 'owner', 'mail.due', async ({ env, now }) => {
      const r = await mailDue(env, now);
      return { body: r, quiet: true };
    }],
    ['POST', /^mail\/claim$/, 'owner', 'mail.claim', async ({ env, body, now }) => {
      const send = String(body.send || '');
      const r = send === 'confirm' ? await claimConfirms(env, body.limit, now) : await claimSend(env, send, body.limit, now);
      if (r.error) throw new Refusal(400, r.error);
      return { body: r, quiet: !r.list.length, target: send, detail: { claimed: r.list.length, off: !!r.off } };
    }],
    ['POST', /^mail\/done$/, 'owner', 'mail.done', async ({ env, body }) => {
      const send = String(body.send || '');
      const r = send === 'confirm' ? await finishConfirms(env, body.failed, body.refused) : await finishSend(env, send, body.failed, body.refused);
      return { body: r, target: send, detail: r };
    }],
  ];
}

