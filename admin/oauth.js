// "Get the key" for the marketing sites that sign in with OAuth. The owner
// types the app id and secret from the site's developer page, allows the app
// on the site, and comes back here with a one-time code; the Worker swaps it
// for the key (server/src/marketing-oauth.js), which is shown once to be saved
// as a GitHub secret. Only the app id and a random check word wait in this tab
// (sessionStorage) while the owner is on the site; the app secret is typed
// when they are back, so it is never stored in the browser.

const PENDING = 'flg-oauth';

export const OAUTH = {
  linkedin: {
    name: 'LinkedIn', idLabel: 'Client ID', secretLabel: 'Primary Client Secret',
    authorize: 'https://www.linkedin.com/oauth/v2/authorization',
    params: { response_type: 'code', scope: 'openid profile w_member_social' },
    secrets: { id: null, secret: null, access: 'LINKEDIN_TOKEN' },
    after: 'LinkedIn keys last 60 days. When the check says LinkedIn stopped working, press Get the key again.',
  },
  pinterest: {
    name: 'Pinterest', idLabel: 'App id', secretLabel: 'App secret key',
    authorize: 'https://www.pinterest.com/oauth/',
    params: { response_type: 'code', scope: 'boards:read,pins:read,pins:write' },
    secrets: { id: 'PINTEREST_APP_ID', secret: 'PINTEREST_APP_SECRET', refresh: 'PINTEREST_REFRESH_TOKEN' },
    after: 'The refresh key lasts a year. The autopilot makes a fresh daily key from it.',
  },
  youtube: {
    name: 'YouTube', idLabel: 'Client ID', secretLabel: 'Client secret',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    params: { response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly', access_type: 'offline', prompt: 'consent' },
    secrets: { id: 'YOUTUBE_CLIENT_ID', secret: 'YOUTUBE_CLIENT_SECRET', refresh: 'YOUTUBE_REFRESH_TOKEN' },
    after: 'The refresh key keeps working while the Google app is set to In production.',
  },
  tiktok: {
    name: 'TikTok', idLabel: 'Client key', secretLabel: 'Client secret', idParam: 'client_key',
    authorize: 'https://www.tiktok.com/v2/auth/authorize/',
    params: { response_type: 'code', scope: 'user.info.basic,video.publish' },
    secrets: { id: 'TIKTOK_CLIENT_KEY', secret: 'TIKTOK_CLIENT_SECRET', refresh: 'TIKTOK_REFRESH_TOKEN' },
    after: 'The refresh key lasts a year.',
  },
  reddit: {
    name: 'Reddit', idLabel: 'Client id (under the app name)', secretLabel: 'Secret',
    authorize: 'https://www.reddit.com/api/v1/authorize',
    params: { response_type: 'code', duration: 'permanent', scope: 'identity submit' },
    secrets: { id: 'REDDIT_CLIENT_ID', secret: 'REDDIT_CLIENT_SECRET', refresh: 'REDDIT_REFRESH_TOKEN' },
    after: 'The refresh key does not expire unless you remove the app on Reddit.',
  },
};

export const redirectUri = () => `${location.origin}/admin/`;

export async function startOAuth(site, { ask, esc, toast }) {
  const s = OAUTH[site];
  const v = await ask({
    title: `Get the ${s.name} key`,
    text: `Copy the ${esc(s.idLabel.toLowerCase())} from the app you made on ${esc(s.name)}'s developer page. Its redirect address must be exactly <code>${esc(redirectUri())}</code>. You then sign in to ${esc(s.name)} and allow the app, and come straight back here, where you paste the ${esc(s.secretLabel.toLowerCase())}.`,
    fields: [{ name: 'clientId', label: s.idLabel }],
    ok: `Go to ${s.name}`,
    check: (x) => (!x.clientId.trim() ? 'The app id is needed.' : ''),
  });
  if (!v) return;
  const state = `flg-${site}-${crypto.randomUUID()}`;
  try {
    sessionStorage.setItem(PENDING, JSON.stringify({ site, state, clientId: v.clientId.trim(), at: Date.now() }));
  } catch (e) { toast('This browser window cannot remember the sign-in for the trip. Try a normal (not private) window.'); return; }
  const q = new URLSearchParams({ ...s.params, [s.idParam || 'client_id']: v.clientId.trim(), redirect_uri: redirectUri(), state });
  location.assign(`${s.authorize}?${q}`);
}

// Called on load: takes the code off the address bar straight away, so it is
// never bookmarked or shared, and returns what is needed to finish.
export function takeOAuthReturn() {
  const q = new URLSearchParams(location.search);
  const state = q.get('state') || '';
  if (!state.startsWith('flg-')) return null;
  history.replaceState(null, '', `${location.pathname}#connections`);
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(PENDING) || 'null'); sessionStorage.removeItem(PENDING); } catch (e) { /* private window */ }
  return { state, code: q.get('code') || '', error: q.get('error_description') || q.get('error') || '', pending };
}

export async function finishOAuth(back, { api, ask, esc, toast }) {
  const p = back.pending;
  if (!p || p.state !== back.state || Date.now() - p.at > 30 * 60_000) { toast('That sign-in could not be matched to this window. Press Get the key again.'); return; }
  const s = OAUTH[p.site];
  if (back.error || !back.code) { toast(`${s.name} did not allow the app${back.error ? `: ${back.error}` : ''}.`); return; }
  const typed = await ask({
    title: `Finish the ${s.name} key`,
    text: `${esc(s.name)} allowed the app. Paste its ${esc(s.secretLabel.toLowerCase())} to finish (within a few minutes: the code from ${esc(s.name)} runs out).`,
    fields: [{ name: 'clientSecret', label: s.secretLabel, type: 'password' }],
    ok: 'Get the key',
    check: (x) => (!x.clientSecret.trim() ? 'The secret is needed.' : ''),
  });
  if (!typed) return;
  let r;
  try {
    r = await api('marketing/oauth', { method: 'POST', body: { site: p.site, code: back.code, clientId: p.clientId, clientSecret: typed.clientSecret.trim() } });
  } catch (e) { toast(e.message); return; }
  const rows = [
    s.secrets.id && { name: s.secrets.id, value: p.clientId },
    s.secrets.refresh && { name: s.secrets.refresh, value: r.refreshToken || '' },
    s.secrets.access && { name: s.secrets.access, value: r.accessToken },
  ].filter(Boolean);
  if (s.secrets.refresh && !r.refreshToken) { toast(`${s.name} gave a key without a refresh key. Check the app settings and press Get the key again.`); return; }
  await ask({
    title: `${s.name} key ready`,
    text: `Save each of these as a GitHub repository secret with exactly this name (<a href="https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions" target="_blank" rel="noopener">open GitHub secrets</a>). ${s.secrets.secret ? `Also save the ${esc(s.secretLabel.toLowerCase())} you typed as <code>${s.secrets.secret}</code>. ` : ''}This is the only time the key is shown, and it is not kept here. ${esc(s.after)}`,
    fields: rows.map((x) => ({ name: x.name, label: x.name, value: x.value })),
    ok: 'Done',
  });
}
