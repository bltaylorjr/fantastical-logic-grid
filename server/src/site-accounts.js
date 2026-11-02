// Site accounts: the game's accounts on outside sites (social media, developer
// portals, hosting), listed at the top of admin > Connections and setup so
// there is one place to see where each account is, which email signs in to
// it and where its keys are kept.
//
// This is deliberately not a password vault. Only details that are safe to
// read are kept; passwords, keys and tokens stay in a password manager and in
// GitHub or Cloudflare secrets. Anything that looks like one is refused.
//
// Admin routes (siteAccountRoutes, wired into admin.js):
//   GET  /admin/v1/site-accounts              the list (admin)
//   POST /admin/v1/site-accounts              { id?, site, url, loginEmail, handle, keysIn, status, notes } add or change (admin)
//   POST /admin/v1/site-accounts/:id/delete   remove one (admin)
export const STATUSES = ['not-started', 'waiting', 'set-up', 'paused'];
const LIMITS = { site: 40, url: 300, loginEmail: 120, handle: 80, keysIn: 300, notes: 1000 };
const MAX_ROWS = 60;

const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, n);

// True when the text looks like a password, key or token: a "password:" style
// label, a known key prefix, or a long unbroken run of mixed letters and digits.
export function looksSecret(text) {
  const t = String(text || '');
  if (/\b(pass(word|wd|code)?|pwd|secret|token|api[ _-]?key)\s*[:=]/i.test(t)) return true;
  if (/\b(flgk_|ghp_|gho_|github_pat_|sk_live_|sk_test_|rk_live_|xox[abp]-|AIza|ya29\.|EAA[A-Za-z0-9]{20})/.test(t)) return true;
  return t.split(/[\s,;()"'<>]+/).some((w) => {
    const bare = w.replace(/^https?:\/\/\S*$/, '');
    return bare.length >= 24 && /[a-z]/.test(bare) && /[A-Z]/.test(bare) && /\d/.test(bare) && !/[@/]/.test(bare);
  });
}

export function checkAccount(body) {
  const a = {
    site: clean(body.site, LIMITS.site), url: clean(body.url, LIMITS.url), loginEmail: clean(body.loginEmail, LIMITS.loginEmail),
    handle: clean(body.handle, LIMITS.handle), keysIn: clean(body.keysIn, LIMITS.keysIn), notes: clean(body.notes, LIMITS.notes),
    status: STATUSES.includes(body.status) ? body.status : 'set-up',
  };
  if (!a.site) return { error: 'Give the site a name, for example YouTube.' };
  if (a.url) {
    try {
      if (new URL(a.url).protocol !== 'https:') return { error: 'The address must start with https://.' };
    } catch (e) { return { error: 'The address is not a web address.' }; }
  }
  if (a.loginEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.loginEmail)) return { error: 'The sign-in email does not look like an email address.' };
  if (Object.values(a).some(looksSecret)) {
    return { error: 'That looks like a password, key or token. Keep those in your password manager or in GitHub secrets; write only where they are kept.' };
  }
  return { value: a };
}

const view = (r) => ({ id: r.id, site: r.site, url: r.url, loginEmail: r.login_email, handle: r.handle, keysIn: r.keys_in, status: r.status, notes: r.notes, updatedAt: r.updated_at, updatedBy: r.updated_by });

export function siteAccountRoutes(Refusal) {
  return [
    ['GET', /^site-accounts$/, 'admin', 'site-accounts.view', async ({ env }) => {
      const { results } = await env.DB.prepare('SELECT * FROM site_accounts ORDER BY site COLLATE NOCASE LIMIT ?1').bind(MAX_ROWS).all();
      return { body: { accounts: results.map(view), statuses: STATUSES }, quiet: true };
    }],
    ['POST', /^site-accounts$/, 'admin', 'site-accounts.save', async ({ env, body, who, now }) => {
      const r = checkAccount(body || {});
      if (r.error) throw new Refusal(400, 'bad_account', r.error);
      const a = r.value;
      const id = Number(body.id) || 0;
      if (id) {
        const done = await env.DB.prepare('UPDATE site_accounts SET site = ?1, url = ?2, login_email = ?3, handle = ?4, keys_in = ?5, status = ?6, notes = ?7, updated_at = ?8, updated_by = ?9 WHERE id = ?10')
          .bind(a.site, a.url, a.loginEmail, a.handle, a.keysIn, a.status, a.notes, now, who.actor, id).run();
        if (!done.meta?.changes) throw new Refusal(404, 'not_found', 'That account is not in the list any more.');
        return { body: { ok: true, id }, target: id, detail: { site: a.site } };
      }
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM site_accounts').first();
      if (n >= MAX_ROWS) throw new Refusal(409, 'too_many', `The list holds ${MAX_ROWS} accounts. Remove one first.`);
      const row = await env.DB.prepare('INSERT INTO site_accounts (site, url, login_email, handle, keys_in, status, notes, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id')
        .bind(a.site, a.url, a.loginEmail, a.handle, a.keysIn, a.status, a.notes, now, who.actor).first();
      return { body: { ok: true, id: row.id }, target: row.id, detail: { site: a.site } };
    }],
    ['POST', /^site-accounts\/(\d+)\/delete$/, 'admin', 'site-accounts.delete', async ({ env, params: [raw] }) => {
      const id = Number(raw);
      const done = await env.DB.prepare('DELETE FROM site_accounts WHERE id = ?1').bind(id).run();
      if (!done.meta?.changes) throw new Refusal(404, 'not_found', 'That account is not in the list any more.');
      return { body: { ok: true }, target: id };
    }],
  ];
}
