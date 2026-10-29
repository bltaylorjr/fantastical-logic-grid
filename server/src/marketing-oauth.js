// The "Get the key" helper for the marketing autopilot's sites that sign in
// with OAuth (LinkedIn, Pinterest, YouTube, TikTok and Reddit).
//
//   POST /admin/v1/marketing/oauth   { site, code, clientId, clientSecret }
//
// The admin page (admin/oauth.js) sends the owner to the site to allow the
// app; the site sends them back to /admin/ with a one-time code, and this
// swaps the code for the key at the site's token address. The key goes back
// to the owner's own browser once, to be saved as a GitHub secret. Nothing
// here is stored or logged: not the app secret, not the code, not the key.
// The token addresses are fixed below, so the Worker never calls an address
// it was given.

const SITES = {
  linkedin: { url: 'https://www.linkedin.com/oauth/v2/accessToken', style: 'form' },
  pinterest: { url: 'https://api.pinterest.com/v5/oauth/token', style: 'basic' },
  youtube: { url: 'https://oauth2.googleapis.com/token', style: 'form' },
  tiktok: { url: 'https://open.tiktokapis.com/v2/oauth/token/', style: 'tiktok' },
  reddit: { url: 'https://www.reddit.com/api/v1/access_token', style: 'basic' },
};
export const OAUTH_SITES = Object.keys(SITES);

const clean = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function exchange(site, { code, clientId, clientSecret, redirectUri }, fetcher = fetch) {
  const s = SITES[site];
  const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'web:flg-marketing:1.0 (The Fantastical Logic Grid)' };
  if (s.style === 'basic') headers.Authorization = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
  else if (s.style === 'tiktok') { form.set('client_key', clientId); form.set('client_secret', clientSecret); }
  else { form.set('client_id', clientId); form.set('client_secret', clientSecret); }
  const res = await fetcher(s.url, { method: 'POST', headers, body: form.toString() });
  const data = await res.json().catch(() => ({}));
  const token = data.data?.access_token ? data.data : data; // TikTok's older shape nests it
  if (!res.ok || !token.access_token) {
    const why = clean(String(token.error_description || token.message || token.error || `HTTP ${res.status}`), 200);
    return { ok: false, why };
  }
  return {
    ok: true,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || null,
    expiresIn: Number(token.expires_in) || null,
    refreshExpiresIn: Number(token.refresh_token_expires_in || token.refresh_expires_in) || null,
  };
}

export function oauthRoutes(Refusal) {
  return [
    ['POST', /^marketing\/oauth$/, 'admin', 'marketing.oauth', async ({ body, url }) => {
      const site = clean(body.site, 20);
      if (!SITES[site]) throw new Refusal(400, 'bad_site', 'That site is not one the autopilot signs in to.');
      const code = clean(body.code, 2000), clientId = clean(body.clientId), clientSecret = clean(body.clientSecret);
      if (!code || !clientId || !clientSecret) throw new Refusal(400, 'missing', 'The app id, the app secret and the code from the site are all needed.');
      // Must match the address the site sent the owner back to, exactly.
      const redirectUri = `${url.origin}/admin/`;
      const r = await exchange(site, { code, clientId, clientSecret, redirectUri });
      if (!r.ok) throw new Refusal(400, 'site_refused', `The site did not give a key: ${r.why}. Start again from the Get the key button (each code works once and only for a few minutes).`);
      return { body: r, detail: { site } };
    }],
  ];
}
