// The shared Cloudflare Worker (server/). learnUrl turns on learning from
// every game and the free server voices; it comes from FLG_CLOUD_URL at build
// time. Empty means the game runs fully on its own.
//
// Player accounts and save sync. Accounts stay switched off until both values
// are filled in, either here or at build time from the FLG_FIREBASE_API_KEY
// and FLG_CLOUD_URL environment variables (see server/README.md).
// The Firebase web API key is not a secret: it only names the project.
export const CLOUD = {
  firebaseApiKey: '',
  syncUrl: '',
  learnUrl: '',
  authUrl: 'https://identitytoolkit.googleapis.com/v1',
  tokenUrl: 'https://securetoken.googleapis.com/v1',
  // The public website (FLG_SITE_URL at build time). The desktop app reads the
  // daily puzzle from it.
  siteUrl: 'https://thelogicgrid.com',
  // The app version (package.json), stamped in at build time for error reports.
  appVersion: '',
  // The public half of the key that signs app keys (web/js/license.js). Not a
  // secret: it can only check a signature, never make one. The private half is
  // the LICENSE_SIGNING_KEY Cloudflare secret.
  licenseKey: { kty: 'EC', crv: 'P-256', x: 'Qv4J2JvfbXxBkWQHtXeAZGgBoUW6LtAkXjsfcSYxg_U', y: 'Sq8rwhJriq_2WUTQDcEhwAObKUvK8YIHNB47UWaOt_4' },
};

export const cloudEnabled = () => !!(CLOUD.firebaseApiKey && CLOUD.syncUrl);
export const CLOUD_URL = CLOUD.learnUrl;
