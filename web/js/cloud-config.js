// Address of the shared Cloudflare service (server/). Empty means the game
// runs fully on its own: no shared learning and no server voices. The build
// fills it in from the FLG_CLOUD_URL environment variable.
export const CLOUD_URL = '__FLG_CLOUD_URL__'.startsWith('__') ? '' : '__FLG_CLOUD_URL__';
