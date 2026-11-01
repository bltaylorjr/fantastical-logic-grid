// Challenge a friend (server/src/challenges.js): after solving, a short link
// opens the very same puzzle for anyone, no account needed, with this
// player's time to beat. The link is ?challenge=CODE on the website.
//
// Sent: the puzzle, the time and the number of hints. Never a name, account
// or anything else about the player.
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import * as remote from './remote-config.js';

const CODE = /^[A-Z0-9]{6}$/;
export const available = () => !!CLOUD_URL && remote.feature('challenges');
const site = () => (CLOUD.siteUrl || 'https://thelogicgrid.com').replace(/\/+$/, '');
// The game's page on the website is fantastical/ (the site's front page lists every game).
export const linkFor = (code) => `${site()}/fantastical/?challenge=${code}`;

async function call(path, body) {
  const r = await fetch(`${CLOUD_URL}/v1/challenges${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.message || 'The challenge could not be reached. Check the connection and try again.');
  return out;
}

// A link for a solved puzzle: { code, url }.
export async function create(puzzle, elapsedMs, hints) {
  const { code } = await call('', { puzzle, elapsedMs: Math.max(5000, Math.round(elapsedMs)), hints: hints || 0 });
  return { code, url: linkFor(code) };
}
export const load = (code) => call(`/${code}`);
export const sendResult = (code, elapsedMs, hints) => call(`/${code}/result`, { elapsedMs: Math.max(5000, Math.round(elapsedMs)), hints: hints || 0 });

// The code in this page's address, taken out so a reload or bookmark is clean.
export function linkCode() {
  const url = new URL(location.href);
  const raw = url.searchParams.get('challenge');
  if (raw === null) return null;
  url.searchParams.delete('challenge');
  try { history.replaceState(history.state, '', url.pathname + url.search + url.hash); } catch (e) { /* framed preview */ }
  const code = raw.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

export const message = ({ title, time, hints }) => `I solved “${title}” in ${time}${hints ? ` with ${hints} hint${hints === 1 ? '' : 's'}` : ''} on The Fantastical Logic Grid. Can you beat my time?`;
