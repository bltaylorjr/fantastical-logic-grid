// Screen names, races and the scoreboard: calls to the game's Worker
// (server/src/compete.js). Only on when accounts are switched on in the build.
import { CLOUD, cloudEnabled } from './cloud-config.js';
import * as account from './account.js';
import * as store from './store.js';

export const enabled = cloudEnabled;
export const SHARE_ORIGIN = 'https://thelogicgrid.com';
export const CODE = /^[A-HJ-NP-Z2-9]{6}$/;

export class CompeteError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

const WORDS = {
  OFFLINE: 'You seem to be offline. Connect to the internet to race or see the scoreboard.',
  sign_in: 'Please sign in again.',
  slow_down: 'Too many tries in a row. Wait a minute, then try again.',
  no_screen_name: 'Choose a screen name first.',
  bad_puzzle: 'This puzzle could not be shared. Try a new one.',
  too_large: 'This puzzle is too big to share. Try a smaller size.',
  server: 'Something went wrong on our side. Please try again.',
};

async function call(path, { method = 'GET', body, auth = true } = {}) {
  const send = async (token) => {
    try {
      return await fetch(`${CLOUD.syncUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) { throw new CompeteError('OFFLINE', WORDS.OFFLINE, 0); }
  };
  const withToken = auth && account.current();
  let res = await send(withToken ? await account.getIdToken() : null);
  if (res.status === 401 && withToken) res = await send(await account.getIdToken({ force: true }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CompeteError(data.error || `HTTP_${res.status}`, data.message || WORDS[data.error] || WORDS.server, res.status);
  return data;
}

// ------------------------------------------------------------ screen name
// Kept on the device too, so the home screen can show it straight away.
const PROFILE = 'profile';
export function cachedName() {
  const p = store.getLocal(PROFILE);
  const user = account.current();
  return p && user && p.uid === user.uid ? p.screenName : null;
}
function remember(screenName) {
  const user = account.current();
  store.setLocal(PROFILE, user && screenName ? { uid: user.uid, screenName } : undefined);
  return screenName;
}
let acceptInvites = true;
// False while an admin has not approved a new or changed name yet: other
// players see "New player" until then.
let nameApproved = true;
export const isNameApproved = () => nameApproved;
export const acceptsInvites = () => acceptInvites;
export async function loadName() {
  const r = await call('/v1/profile');
  acceptInvites = r.acceptInvites !== false;
  nameApproved = r.nameApproved !== false;
  return remember(r.screenName);
}
export async function setName(screenName, accept = acceptInvites) {
  const r = await call('/v1/profile', { method: 'PUT', body: { screenName, acceptInvites: !!accept } });
  acceptInvites = r.acceptInvites !== false;
  nameApproved = r.nameApproved !== false;
  return remember(r.screenName);
}
export async function setAcceptInvites(accept) {
  const r = await call('/v1/profile', { method: 'PUT', body: { acceptInvites: !!accept } });
  acceptInvites = r.acceptInvites !== false;
  return acceptInvites;
}
export async function leave() { await call('/v1/profile', { method: 'DELETE' }); remember(null); }
export function forget() { store.setLocal(PROFILE, undefined); }

// Quick checks before asking the server, which has the full rules.
export function nameProblem(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 20) return 'Use 3 to 20 characters.';
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(name)) return 'Use letters, numbers, spaces, dots, dashes or underscores, starting with a letter or number.';
  return null;
}

// A friendly made-up name, such as "SwiftOwl42", for players who would rather
// not think one up. Always 3 to 20 characters and passes nameProblem; the
// server still checks it is free.
const NAME_ADJ = ['Swift', 'Clever', 'Bright', 'Quiet', 'Lucky', 'Brave', 'Keen', 'Sly', 'Sunny', 'Misty', 'Golden', 'Silver', 'Cosmic', 'Witty', 'Nimble', 'Merry', 'Bold', 'Calm', 'Starry', 'Sharp'];
const NAME_NOUN = ['Owl', 'Fox', 'Sleuth', 'Riddler', 'Wizard', 'Falcon', 'Badger', 'Comet', 'Dragon', 'Otter', 'Raven', 'Sphinx', 'Lynx', 'Puzzler', 'Gryphon', 'Hawk', 'Seeker', 'Pixie', 'Tiger', 'Scout'];
export function suggestName(rand = Math.random) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  return `${pick(NAME_ADJ)}${pick(NAME_NOUN)}${10 + Math.floor(rand() * 90)}`;
}

// ------------------------------------------------------------ scores
export const scoreboard = (period) => call(`/v1/scoreboard?period=${period === 'all' ? 'all' : 'week'}`);

export function postScore(save) {
  const p = save.puzzle;
  return call('/v1/scores', {
    method: 'POST',
    body: {
      storyId: save.storyId, tier: p.difficulty.id, categories: p.categories.length, items: p.categories[0].items.length,
      elapsedMs: Math.round(save.elapsedMs), hints: save.hintsUsed || 0, checks: save.checksUsed || 0,
    },
  });
}

// ------------------------------------------------------------ races
export const createRace = (puzzle, isPublic) => call('/v1/races', { method: 'POST', body: { puzzle, public: !!isPublic } });
export const findRace = (tier, skip = []) => call('/v1/races/find', { method: 'POST', body: { tier, skip } });
export const joinRace = (code) => call(`/v1/races/${code}/join`, { method: 'POST' });
export const raceStandings = (code) => call(`/v1/races/${code}`);
export function finishRace(save, pairs) {
  return call(`/v1/races/${save.race.code}/finish`, {
    method: 'POST',
    body: { elapsedMs: Math.round(save.elapsedMs), hints: save.hintsUsed || 0, checks: save.checksUsed || 0, revealed: !!save.revealed, pairs },
  });
}

// Challenges: invite one player by screen name to a race you are in.
export const invitePlayer = (code, screenName) => call(`/v1/races/${code}/invite`, { method: 'POST', body: { screenName } });
export const listInvites = () => call('/v1/invites');
export const declineInvite = (id) => call(`/v1/invites/${id}/decline`, { method: 'POST' });

export const shareLink = (code) => `${SHARE_ORIGIN}/?race=${code}`;
export const cleanCode = (raw) => String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
