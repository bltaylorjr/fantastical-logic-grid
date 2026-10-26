// Daily puzzle by email (server/src/daily-email.js): a signed-in player with a
// confirmed email can ask for each day's puzzle in their inbox. The switch
// lives on the Daily puzzle card.
import { CLOUD_URL } from './cloud-config.js';
import * as remote from './remote-config.js';
import * as account from './account.js';

export const available = () => !!CLOUD_URL && account.enabled() && remote.feature('dailyEmail');

async function call(method, body) {
  const token = await account.getIdToken();
  const res = await fetch(`${CLOUD_URL}/v1/daily-email`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'That did not work right now. Please try again later.');
  return data;
}

// { on, verified }, or null when signed out or offline.
export async function status() {
  if (!available() || !account.current()) return null;
  try { return await call('GET'); } catch (e) { return null; }
}

export const set = (on) => call('POST', { on: !!on });
