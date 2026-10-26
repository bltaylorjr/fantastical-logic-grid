// Which ads and sites bring players (admin Marketing, server/src/marketing.js).
// A visit that arrives on a tracked campaign link (utm_source, utm_medium,
// utm_campaign, utm_content) or from another website is counted once, and the
// campaign is remembered on this device for 30 days so that the first puzzle
// played, puzzles solved, coming back on a later day within a week, an
// install and a Windows download can be counted for it too. The link's tags
// are then taken out of the address bar, so a shared or bookmarked page stays
// clean.
//
// Sent: the event, the campaign tags, the platform. Never sent: names, ids,
// saves or anything else about the player. Visits without a campaign or
// another website (typed in, bookmarks, the installed app) send nothing.
import { CLOUD_URL } from './cloud-config.js';
import { platform } from './errors.js';

const KEY = 'flg-campaign';
const KEEP_MS = 30 * 24 * 3600 * 1000;
const MAX_SOLVES_PER_DAY = 20;
// Sites people arrive from, by the end of their host name.
const REFERRERS = [
  [/(^|\.)google\.[a-z.]+$/, 'google', 'search'], [/(^|\.)bing\.com$/, 'bing', 'search'], [/(^|\.)duckduckgo\.com$/, 'duckduckgo', 'search'],
  [/(^|\.)yahoo\.[a-z.]+$/, 'yahoo', 'search'], [/(^|\.)ecosia\.org$/, 'ecosia', 'search'], [/(^|\.)search\.brave\.com$/, 'brave', 'search'],
  [/(^|\.)reddit\.com$|^redd\.it$/, 'reddit', 'forum'], [/(^|\.)facebook\.com$|^fb\.me$/, 'facebook', 'social'], [/(^|\.)instagram\.com$/, 'instagram', 'social'],
  [/^t\.co$|(^|\.)x\.com$|(^|\.)twitter\.com$/, 'x', 'social'], [/(^|\.)threads\.(net|com)$/, 'threads', 'social'], [/(^|\.)bsky\.app$/, 'bluesky', 'social'],
  [/(^|\.)youtube\.com$|^youtu\.be$/, 'youtube', 'video'], [/(^|\.)tiktok\.com$/, 'tiktok', 'video'], [/(^|\.)pinterest\.[a-z.]+$|^pin\.it$/, 'pinterest', 'social'],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'linkedin', 'social'], [/(^|\.)discord(app)?\.com$/, 'discord', 'community'], [/(^|\.)itch\.io$/, 'itch', 'store'],
  [/(^|\.)producthunt\.com$/, 'producthunt', 'directory'], [/^news\.ycombinator\.com$/, 'hackernews', 'community'], [/(^|\.)indiehackers\.com$/, 'indiehackers', 'community'],
  [/(^|\.)alternativeto\.net$/, 'alternativeto', 'directory'], [/(^|\.)github\.com$/, 'github', 'referral'], [/(^|\.)quora\.com$/, 'quora', 'forum'],
  [/(^|\.)(mail\.google|outlook\.live|mail\.yahoo)\.com$/, 'email', 'email'],
];
const slug = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const today = () => new Date().toISOString().slice(0, 10);

function load() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    return c && Date.now() - c.at < KEEP_MS ? c : null;
  } catch (e) { return null; }
}
function store(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* private window */ } }

function send(event, c) {
  if (!CLOUD_URL || !c) return;
  const body = JSON.stringify({ e: event, c: c.c, s: c.s, m: c.m, k: c.k, p: platform() });
  // text/plain keeps this a simple request (no CORS preflight).
  try { fetch(`${CLOUD_URL}/v1/m`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true }).catch(() => {}); } catch (e) { /* offline */ }
}

// Where this visit came from: the campaign tags, else the site that linked here.
export function arrival(href = location.href, referrer = document.referrer) {
  const url = new URL(href);
  const q = url.searchParams;
  if (q.get('utm_source') || q.get('utm_campaign')) {
    return { c: slug(q.get('utm_campaign')), s: slug(q.get('utm_source')), m: slug(q.get('utm_medium')), k: slug(q.get('utm_content')) };
  }
  let host = '';
  try { host = new URL(referrer).hostname.toLowerCase(); } catch (e) { return null; }
  if (!host || host === url.hostname || /(^|\.)thelogicgrid\.com$/.test(host)) return null;
  const hit = REFERRERS.find(([re]) => re.test(host));
  return { c: '', s: hit ? hit[1] : 'other', m: hit ? hit[2] : 'referral', k: '' };
}

function cleanAddress() {
  const url = new URL(location.href);
  const tags = [...url.searchParams.keys()].filter((k) => /^utm_/.test(k) || k === 'fbclid' || k === 'gclid');
  if (!tags.length) return;
  for (const k of tags) url.searchParams.delete(k);
  try { history.replaceState(history.state, '', url.pathname + (url.search || '') + url.hash); } catch (e) { /* framed preview */ }
}

// Once per page load, before anything else reads the address.
export function init() {
  try {
    const a = arrival();
    cleanAddress();
    cameBack(a);
    if (!a) return;
    // One visit per browser tab, so reloads are not counted again.
    const seen = `${a.c}|${a.s}|${a.k}`;
    let counted = false;
    try { counted = sessionStorage.getItem(KEY) === seen; sessionStorage.setItem(KEY, seen); } catch (e) { /* private window */ }
    const c = { ...a, at: Date.now(), played: false, solves: {} };
    // A plain link from another site never replaces a campaign the player came from.
    const prev = load();
    if (a.c || !prev?.c) store(c);
    if (!counted) send('visit', c);
  } catch (e) { /* never break the game */ }
}

// A player from a campaign visit who comes back on a later day within a week
// counts once as a return (the market test's 7-day return), whatever link or
// bookmark they come back by.
const RETURN_DAYS = 7;
function cameBack(a) {
  const c = load();
  if (!c || c.returned || (a && a.c && a.c !== c.c)) return;
  const days = (Date.parse(`${today()}T00:00:00Z`) - Date.parse(`${new Date(c.at).toISOString().slice(0, 10)}T00:00:00Z`)) / 86400_000;
  if (days < 1 || days > RETURN_DAYS) return;
  c.returned = true;
  store(c);
  send('return', c);
}

// The first puzzle opened after a campaign visit.
export function played() {
  const c = load();
  if (!c || c.played) return;
  c.played = true;
  store(c);
  send('play', c);
}

export function solved() {
  const c = load();
  if (!c) return;
  const d = today();
  c.solves = { [d]: (c.solves?.[d] || 0) + 1 };
  if (c.solves[d] > MAX_SOLVES_PER_DAY) return;
  store(c);
  send('solve', c);
}

export function installed() { send('install', load()); }
// A press of Support the game (the market test's support pass mark).
export function supportPressed() { const c = load(); if (c) send('support', c); }
export function downloaded() { send('download', load()); }
