// The weekly improvement run (.github/workflows/improve.yml, IMPROVE.md).
//
// 1. Gathers every signal there is: puzzle ratings and the rule findings,
//    the puzzle quality report (quit, too hard, too easy), how the daily
//    puzzle does, story parts players rate high or low, what everyone's games
//    taught the shared learning service, errors and feedback counts, free
//    limits, the nightly maintenance issue (site, SEO and speed checks) and
//    the speed scores from the last nights' Lighthouse runs.
// 2. Ranks what it found, most useful first.
// 3. Tunes what is safe to tune automatically, by adding one dated entry to
//    engine/src/house-tuning.js (daily puzzle toughness and clue mix, and
//    which story parts are picked more or less often). Each change is small
//    and bounded; past daily puzzles never change.
// 4. Writes improve.json (for the email and the workflow) and report.md (the
//    weekly improvement issue, which the weekly Claude task reads for bigger
//    fixes) into OUT_DIR.
//
// Privacy: the repository is public, so everything written here is counts,
// rates and built-in names only. No player text, ids or screen names.
//
// Env: FLG_CLOUD_URL, FLG_ADMIN_TOKEN (optional: without it only the GitHub
// side is read), GITHUB_TOKEN + GITHUB_REPOSITORY (optional), LH_DIR (folder
// of downloaded nightly Lighthouse results), OUT_DIR, FLG_TODAY (tests),
// IMPROVE_FIXTURE (a JSON file of signals instead of fetching; tests),
// IMPROVE_TUNE=0 (report only, never change the tuning file).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TUNING_FILE = join(root, 'engine', 'src', 'house-tuning.js');
const DAY = 24 * 3600_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const step = (v, s = 0.05) => Math.round(v / s) * s;
const r2 = (v) => Math.round(v * 100) / 100;
const pct = (f) => `${Math.round(f * 100)}%`;

// Limits on what the run may change by itself.
export const LIMITS = {
  minGames: 30,          // games in the last 30 days before anything is tuned
  minDailyGames: 10,     // daily puzzle games before its toughness moves
  minPartRatings: 5,     // ratings before a story part is favored or avoided
  effort: [-0.6, 0.6],   // daily toughness within a level
  effortStep: 0.2,       // most it moves in one week
  clue: [0.75, 1.4],     // clue type weights
  clueStep: 0.15,
  speedDrop: 0.05,       // Lighthouse speed drop that counts as a regression
};

// ------------------------------------------------------------------ gather
async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'flg-improve', ...headers } });
  if (!res.ok) throw new Error(`${res.status} from ${url.replace(/\?.*/, '')}`);
  return res.json();
}

export async function gather(env = process.env) {
  if (env.IMPROVE_FIXTURE) return JSON.parse(readFileSync(env.IMPROVE_FIXTURE, 'utf8'));
  const api = (env.FLG_CLOUD_URL || '').trim().replace(/\/+$/, '');
  const token = (env.FLG_ADMIN_TOKEN || '').trim();
  const s = { notes: [] };
  const admin = async (key, path) => {
    try { s[key] = await getJson(`${api}${path}`, { Authorization: `Bearer ${token}` }); } catch (e) { s.notes.push(`Could not read ${key} (${e.message}).`); }
  };
  if (api && token) {
    await admin('ratingsTier', '/admin/v1/ratings?days=30&by=tier');
    await admin('ratingsMode', '/admin/v1/ratings?days=30&by=mode');
    await admin('ratingsPart', '/admin/v1/ratings?days=30&by=part');
    await admin('quality', '/admin/v1/quality?days=30');
    await admin('alerts', '/admin/v1/alerts');
    await admin('summary', '/admin/v1/summary?days=7');
    // Ideas and problems the owner approved for processing (ids and topics only).
    await admin('queue', '/admin/v1/feedback/queue');
  } else s.notes.push('FLG_ADMIN_TOKEN or FLG_CLOUD_URL is not set, so player numbers were not read and nothing was tuned.');
  if (api) { try { s.tuning = await getJson(`${api}/v1/learn/tuning`); } catch (e) { s.notes.push(`Could not read the shared learning (${e.message}).`); } }
  // Keep only numbers from the summary: it also carries player-typed text.
  if (s.summary) {
    const x = s.summary;
    s.summary = { from: x.from, to: x.to, players: x.players, games: { finished: x.games?.finished, solved: x.games?.solved, rating: x.games?.rating },
      feedbackWaiting: x.feedback?.waiting || {}, errorKinds: (x.errors || []).length, errorCount: (x.errors || []).reduce((n, e) => n + (e.count || 0), 0),
      storyPartsWaiting: x.storyPartsWaiting || 0 };
  }
  s.github = await gatherGithub(env, s.notes);
  s.lighthouse = readLighthouse(env.LH_DIR);
  return s;
}

async function gatherGithub(env, notes) {
  const repo = env.GITHUB_REPOSITORY, token = env.GITHUB_TOKEN;
  const out = { issues: [], merged: [] };
  if (!repo || !token) return out;
  const gh = (path) => getJson(`https://api.github.com/repos/${repo}/${path}`, { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' });
  try {
    const open = await gh('issues?state=open&per_page=50');
    for (const i of open) {
      const labels = i.labels.map((l) => l.name);
      const label = ['nightly-maintenance', 'health-check', 'search-check', 'player-errors', 'free-limits'].find((l) => labels.includes(l)) || (/^Free limits/i.test(i.title) ? 'free-limits' : null);
      if (!label || i.pull_request) continue;
      // Bullet lines only; player-errors issues carry error messages, so just the title.
      const lines = label === 'player-errors' ? [] : (i.body || '').split('\n').filter((l) => /^- /.test(l)).map((l) => l.slice(2).trim()).slice(0, 25);
      out.issues.push({ label, number: i.number, title: i.title, url: i.html_url, lines });
    }
  } catch (e) { notes.push(`Could not read the GitHub issues (${e.message}).`); }
  try {
    const since = Date.now() - 7 * DAY;
    const pulls = await gh('pulls?state=closed&sort=updated&direction=desc&per_page=100');
    for (const p of pulls) {
      if (!p.merged_at || Date.parse(p.merged_at) < since) continue;
      out.merged.push({ number: p.number, title: p.title, url: p.html_url, mergedAt: p.merged_at, why: whyLine(p.body), auto: (p.labels || []).some((l) => l.name === 'improvement') });
    }
    out.merged.sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));
  } catch (e) { notes.push(`Could not read the merged pull requests (${e.message}).`); }
  return out;
}

// The first plain sentence of a PR description (skips the attribution lines,
// headings and HTML comments).
export function whyLine(body) {
  for (let line of String(body || '').split('\n')) {
    line = line.trim().replace(/^[-*]\s+/, '');
    if (!line || /^(<!--|_Requested|#|🤖|https?:|\||```|---)/.test(line)) continue;
    const plain = line.replace(/\*\*|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    return plain.length > 220 ? `${plain.slice(0, 217)}...` : plain;
  }
  return '';
}

// Nightly Lighthouse results (one folder per night, lhr-*.json inside).
export function readLighthouse(dir) {
  if (!dir || !existsSync(dir)) return [];
  const nights = [];
  for (const name of readdirSync(dir)) {
    const night = join(dir, name);
    if (!statSync(night).isDirectory()) continue;
    const files = [];
    const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/^lhr-.*\.json$/.test(f)) files.push(p); } };
    walk(night);
    for (const f of files) {
      try {
        const l = JSON.parse(readFileSync(f, 'utf8'));
        const path = new URL(l.finalDisplayedUrl || l.requestedUrl).pathname;
        const c = l.categories || {};
        nights.push({ at: l.fetchTime, path, speed: c.performance?.score ?? null, seo: c.seo?.score ?? null, access: c.accessibility?.score ?? null,
          lcp: l.audits?.['largest-contentful-paint']?.numericValue ?? null, cls: l.audits?.['cumulative-layout-shift']?.numericValue ?? null });
      } catch { /* a broken file is skipped */ }
    }
  }
  return nights.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// ------------------------------------------------------------------ analyze
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

export async function analyze(s, { today, current, engine }) {
  const findings = [];
  const add = (f) => findings.push({ forClaude: false, auto: false, ...f });
  const games30 = s.ratingsTier?.overall?.games ?? 0;

  // Ratings rule findings (theme, level, clue type, what-if, story part, ...).
  for (const f of s.ratingsTier?.improve || []) {
    const story = f.dim === 'part' || f.dim === 'theme' || f.dim === 'topic' || f.dim === 'themeTier';
    add({ area: story ? 'stories' : 'game', priority: 40 + Math.min(30, (f.rated || 0) / 2), text: f.text, action: f.advice || '', forClaude: story });
  }
  // Puzzle quality: groups players give up on or find too hard or easy.
  for (const q of (s.quality?.rows || []).filter((r) => r.issues?.length).slice(0, 8)) {
    const name = `${engine.tierName(q.tier)} ${engine.themeName(q.theme)}`;
    add({ area: 'game', priority: 35 + Math.min(35, (q.attention || 0) * 5), text: `${name} (${q.games} games): ${q.issues.map((i) => i.text).join('; ')}.`,
      action: q.issues.some((i) => i.code === 'hard' || i.code === 'quit') ? 'Check its clues read clearly and the hints help; the shared learning already eases it for players.' : q.issues.some((i) => i.code === 'easy') ? 'The shared learning already makes it tougher within the level; consider a bigger default size.' : 'Look at its stories.',
      forClaude: q.issues.some((i) => i.code === 'rating') });
  }

  // The daily puzzle.
  const daily = (s.ratingsMode?.groups || []).find((g) => g.id === 'daily');
  let dailyShift = 0;
  if (daily && daily.games >= LIMITS.minDailyGames) {
    const hard = (daily.quitRate || 0) >= 0.35 || (daily.tooHard || 0) >= 0.4;
    const easy = !hard && (daily.tooEasy || 0) >= 0.4;
    if (hard) dailyShift = -0.2;
    if (easy) dailyShift = 0.2;
    if (hard || easy) add({ area: 'daily', priority: 60, auto: true, text: `The daily puzzle (${daily.games} games): ${pct(daily.quitRate || 0)} gave up, ${pct(daily.tooHard || 0)} said too hard, ${pct(daily.tooEasy || 0)} said too easy.`, action: `Future daily puzzles are made a little ${hard ? 'gentler' : 'tougher'} within their level.` });
    if (daily.rated >= LIMITS.minPartRatings && daily.avg < 3.2) add({ area: 'daily', priority: 55, forClaude: true, text: `The daily puzzle averages ${daily.avg} of 5 stars (${daily.rated} ratings).`, action: 'Consider changing the weekday difficulty plan or the daily themes (scripts/seo.mjs DAILY_TIERS); ask Bobby first.' });
  }

  // Story parts players rate low or high.
  const parts = [];
  for (const g of s.ratingsPart?.groups || []) {
    if ((g.rated || 0) < LIMITS.minPartRatings || g.avg == null) continue;
    const [theme, topic, kind, key] = String(g.id).split('/');
    const storyKey = engine.storyKeyFor(theme, topic);
    if (!storyKey || !['o', 'i', 'm', 'e'].includes(kind)) continue;
    const v = r2(clamp((g.avg - 3.5) / 1.5, -1, 1));
    if (Math.abs(v) < 0.3) continue;
    parts.push({ storyKey, kind, key, v, name: g.name, avg: g.avg, rated: g.rated });
  }
  const weak = parts.filter((p) => p.v < 0).sort((a, b) => a.v - b.v);
  for (const p of weak.slice(0, 6)) add({ area: 'stories', priority: 50 + Math.min(20, p.rated), auto: true, forClaude: true, text: `${p.name} averages ${p.avg} of 5 stars (${p.rated} ratings).`, action: 'It is now picked less often. Write a fresh replacement part for this theme (never reuse a story).' });
  const liked = parts.filter((p) => p.v > 0);
  if (liked.length) add({ area: 'stories', priority: 20, auto: true, text: `${liked.length} story part${liked.length > 1 ? 's' : ''} players rate highly ${liked.length > 1 ? 'are' : 'is'} now picked a little more often.`, action: '' });

  // Free limits.
  for (const a of s.alerts?.alerts || []) add({ area: 'limits', priority: a.level === 'full' ? 95 : 75, text: `${a.label} is at ${a.percent}% of its free allowance.`, action: a.text });

  // Players: counts only (the daily player report handles the details).
  const sm = s.summary;
  if (sm?.errorCount) add({ area: 'players', priority: 30 + Math.min(30, sm.errorCount), text: `${sm.errorCount} error reports this week across ${sm.errorKinds} kinds.`, action: 'The daily player report lists them; fixes are marked Addressed in the admin app.' });
  const waiting = (sm?.feedbackWaiting?.idea || 0) + (sm?.feedbackWaiting?.problem || 0);
  // Approved by the owner in Communication: these come first.
  const approved = (s.queue?.approved || []).map((x) => ({ id: Number(x.id), kind: x.kind === 'idea' ? 'idea' : 'problem', topic: String(x.topic || '').replace(/[^\w-]/g, '') }));
  if (approved.length) {
    const list = approved.slice(0, 20).map((x) => `#${x.id} (${x.kind}, ${x.topic})`).join(', ');
    add({ area: 'players', priority: 90, forClaude: true, text: `${approved.length} player ${approved.length === 1 ? 'idea or problem' : 'ideas and problems'} approved for processing: ${list}.`,
      action: 'Read them privately (the encrypted Player reports method), make the clear, safe fixes, and tell Bobby which ones to Mark fixed in Communication (with a plain note for the player).' });
  }
  if (waiting) add({ area: 'players', priority: 25 + Math.min(25, waiting * 2), text: `${sm.feedbackWaiting.idea || 0} ideas and ${sm.feedbackWaiting.problem || 0} problems are waiting in the admin app.`, action: 'Read them in Communication; the weekly Claude task can read them privately (encrypted) and fix the clear ones.', forClaude: true });

  // Site, SEO and speed: the nightly checks, and the trend across nights.
  for (const i of s.github?.issues || []) {
    if (i.label === 'player-errors') continue;
    const area = i.label === 'nightly-maintenance' || i.label === 'search-check' ? 'site' : i.label === 'free-limits' ? 'limits' : 'site';
    const lines = i.lines.length ? i.lines : [i.title];
    for (const l of lines.slice(0, 10)) {
      const seo = /search|sitemap|canonical|robots|index|structured|tag|link|SEO/i.test(l);
      const speed = /Lighthouse|speed|paint|layout shift|blocking/i.test(l);
      add({ area: speed ? 'speed' : seo ? 'seo' : area, priority: i.label === 'health-check' ? 90 : 45, text: l.replace(/\s+/g, ' ').slice(0, 300), action: `Open since the ${i.label} check (#${i.number}).`, forClaude: !/dashboard|secret|Cloudflare|Search Console|Bing Webmaster|token/i.test(l) });
    }
  }
  const byPath = {};
  for (const l of s.lighthouse || []) (byPath[l.path] ||= []).push(l);
  const speed = [];
  for (const [path, list] of Object.entries(byPath)) {
    const recent = list.slice(-3), before = list.slice(-6, -3);
    const now = { speed: median(recent.map((x) => x.speed)), seo: median(recent.map((x) => x.seo)), access: median(recent.map((x) => x.access)), lcp: median(recent.map((x) => x.lcp)) };
    const was = before.length ? median(before.map((x) => x.speed)) : null;
    speed.push({ path, nights: list.length, ...now, was });
    if (was != null && now.speed != null && was - now.speed >= LIMITS.speedDrop) add({ area: 'speed', priority: 65, forClaude: true, text: `${path} speed fell from ${Math.round(was * 100)} to ${Math.round(now.speed * 100)} over the last nights.`, action: 'Find what changed (recently merged PRs) and win it back. Do not add modulepreload (it hurt first paint).' });
    else if (now.speed != null && now.speed < 0.9) add({ area: 'speed', priority: 40, forClaude: true, text: `${path} speed is ${Math.round(now.speed * 100)} (the goal is 90).`, action: 'Look at the Lighthouse report from the nightly run for the biggest saving.' });
    if (now.seo != null && now.seo < 1) add({ area: 'seo', priority: 45, forClaude: true, text: `${path} search score is ${Math.round(now.seo * 100)}.`, action: 'Fix what Lighthouse flags in the SEO section.' });
    if (now.access != null && now.access < 0.95) add({ area: 'site', priority: 45, forClaude: true, text: `${path} accessibility score is ${Math.round(now.access * 100)}.`, action: 'Fix what Lighthouse flags (contrast, labels, names), keeping the UI guidelines.' });
  }

  // De-duplicate and rank.
  const seen = new Set();
  const ranked = findings.filter((f) => (seen.has(f.text) ? false : seen.add(f.text))).sort((a, b) => b.priority - a.priority).map((f) => ({ ...f, priority: Math.round(f.priority) }));

  // ---- automatic tuning: one new entry, only when it changes something.
  const changes = [];
  let entry = null;
  if (games30 >= LIMITS.minGames) {
    const prev = current.length ? current.reduce((a, b) => (b.from >= a.from ? b : a)) : { daily: { effort: {}, clueWeights: {} }, storyPrefs: {} };
    const effort = {};
    for (const tier of engine.tiers) {
      const learned = Number(s.tuning?.effort?.[tier]) || 0;
      const target = clamp(learned * 0.5 + dailyShift, ...LIMITS.effort);
      const old = prev.daily?.effort?.[tier] || 0;
      const v = r2(step(clamp(target, old - LIMITS.effortStep, old + LIMITS.effortStep)));
      if (v) effort[tier] = v;
      if (Math.abs(v - old) >= 0.05) changes.push(`Daily ${engine.tierName(tier)} puzzles: ${v > old ? 'a little tougher' : 'a little gentler'} within the level (${old} to ${v}), ${dailyShift ? 'because of how the daily puzzle went' : 'following what everyone\'s games taught the shared learning'}.`);
    }
    const clueWeights = {};
    const types = new Set([...Object.keys(s.tuning?.clueWeights || {}), ...Object.keys(prev.daily?.clueWeights || {})]);
    for (const t of types) {
      const learned = Number(s.tuning?.clueWeights?.[t]) || 1;
      const old = prev.daily?.clueWeights?.[t] || 1;
      const target = clamp(1 + (learned - 1) * 0.5, ...LIMITS.clue);
      const v = r2(step(clamp(target, old - LIMITS.clueStep, old + LIMITS.clueStep)));
      if (Math.abs(v - 1) >= 0.05) clueWeights[t] = v;
      if (Math.abs(v - old) >= 0.05) changes.push(`Daily puzzles use ${v > old ? 'a few more' : 'a few fewer'} "${engine.clueName(t)}" clues (weight ${old} to ${v}), because players rate puzzles with them ${v > old ? 'higher' : 'lower'}.`);
    }
    // Story parts: this period's ratings, with earlier ones fading out.
    const storyPrefs = {};
    for (const [key, kinds] of Object.entries(prev.storyPrefs || {})) for (const [k, list] of Object.entries(kinds)) for (const [part, v] of Object.entries(list)) {
      const faded = r2(v * 0.8);
      if (Math.abs(faded) >= 0.2) ((storyPrefs[key] ||= {})[k] ||= {})[part] = faded;
    }
    for (const p of parts) ((storyPrefs[p.storyKey] ||= {})[p.kind] ||= {})[p.key] = p.v;
    const newWeak = weak.filter((p) => !(prev.storyPrefs?.[p.storyKey]?.[p.kind]?.[p.key] < 0));
    if (newWeak.length) changes.push(`${newWeak.length} story part${newWeak.length > 1 ? 's' : ''} players rated low ${newWeak.length > 1 ? 'are' : 'is'} now picked less often: ${newWeak.slice(0, 3).map((p) => p.name).join('; ')}.`);
    const newLiked = liked.filter((p) => !(prev.storyPrefs?.[p.storyKey]?.[p.kind]?.[p.key] > 0));
    if (newLiked.length) changes.push(`${newLiked.length} story part${newLiked.length > 1 ? 's' : ''} players rated highly ${newLiked.length > 1 ? 'are' : 'is'} now picked a little more often.`);

    const same = JSON.stringify([effort, clueWeights, storyPrefs]) === JSON.stringify([prev.daily?.effort || {}, prev.daily?.clueWeights || {}, prev.storyPrefs || {}]);
    if (!same) {
      const from = isoDay(Date.parse(`${today}T00:00:00Z`) + DAY);
      entry = { from, reasons: changes.length ? changes : ['Older story-part preferences faded out.'], daily: { effort, clueWeights }, storyPrefs };
    }
  } else if (s.ratingsTier) {
    ranked.push({ area: 'game', priority: 10, text: `${games30} games in the last 30 days; the automatic tuning waits for ${LIMITS.minGames}.`, action: '', auto: false, forClaude: false });
  }
  return { today, games30, findings: ranked, entry, changes: entry ? entry.reasons : [], speed, merged: s.github?.merged || [], summary: s.summary || null, ratings: s.ratingsTier ? { headline: s.ratingsTier.headline, average: s.ratingsTier.overall?.avg, rated: s.ratingsTier.overall?.rated } : null, notes: s.notes || [] };
}

// ------------------------------------------------------------------ outputs
const AREA = { game: 'Game', daily: 'Daily puzzle', stories: 'Stories', players: 'Players', limits: 'Free limits', speed: 'Speed', seo: 'Search (SEO)', site: 'Website' };

export function renderReport(r, { runUrl = '' } = {}) {
  const out = [`Weekly improvement report for ${r.today}${runUrl ? ` ([run](${runUrl}))` : ''}. Counts and rates only, never player text.`, ''];
  if (r.ratings?.headline) out.push(`**Ratings:** ${r.ratings.headline}`, '');
  out.push('## Changed automatically', '');
  if (r.changes.length) out.push(...r.changes.map((c) => `- ${c}`), '', `These apply from ${r.entry.from} (engine/src/house-tuning.js). Past daily puzzles do not change.`, '');
  else out.push('- Nothing this week.', '');
  const claude = r.findings.filter((f) => f.forClaude);
  out.push('## For the weekly Claude task', '', 'Pick at most three, highest first. Each becomes one small PR that merges itself once the tests pass.', '');
  if (claude.length) claude.slice(0, 12).forEach((f, i) => out.push(`${i + 1}. **${AREA[f.area] || f.area}** (priority ${f.priority}): ${f.text}${f.action ? ` ${f.action}` : ''}`));
  else out.push('- Nothing needs a code change this week.');
  out.push('', '## Everything found, by priority', '');
  if (r.findings.length) out.push('| Priority | Area | Finding | Next step |', '|---|---|---|---|', ...r.findings.map((f) => `| ${f.priority} | ${AREA[f.area] || f.area} | ${f.text.replace(/\|/g, '/')} | ${(f.auto ? '(auto) ' : '') + (f.action || '').replace(/\|/g, '/')} |`));
  else out.push('Nothing stood out.');
  if (r.speed.length) {
    out.push('', '## Speed and search scores (live site, nightly Lighthouse)', '', '| Page | Nights | Speed | Was | Search | Accessibility |', '|---|---|---|---|---|---|');
    for (const p of r.speed) out.push(`| ${p.path} | ${p.nights} | ${p.speed == null ? '-' : Math.round(p.speed * 100)} | ${p.was == null ? '-' : Math.round(p.was * 100)} | ${p.seo == null ? '-' : Math.round(p.seo * 100)} | ${p.access == null ? '-' : Math.round(p.access * 100)} |`);
  }
  if (r.merged.length) out.push('', '## Merged in the last 7 days', '', ...r.merged.map((m) => `- #${m.number} ${m.title}`));
  if (r.notes.length) out.push('', '## Notes', '', ...r.notes.map((n) => `- ${n}`));
  out.push('', 'This issue is rewritten every Monday by the weekly improvement run (IMPROVE.md).');
  return out.join('\n');
}

export function writeTuning(list, file = TUNING_FILE) {
  const src = readFileSync(file, 'utf8');
  const start = src.indexOf('export const HOUSE_TUNING = ');
  const end = src.indexOf('\n// The entry in force');
  if (start < 0 || end < 0) throw new Error('house-tuning.js does not have the expected shape');
  writeFileSync(file, `${src.slice(0, start)}export const HOUSE_TUNING = ${JSON.stringify(list, null, 2)};\n${src.slice(end)}`);
}

export async function loadEngine() {
  const { TIERS, CLUE_TYPES, THEMES, getTopics, storyKey } = await import(pathToFileURL(join(root, 'engine', 'src', 'index.js')).href);
  return {
    tiers: Object.keys(TIERS), tierName: (t) => TIERS[t]?.name || t, themeName: (t) => THEMES.find((x) => x.id === t)?.name || t, clueName: (t) => CLUE_TYPES[t] || t,
    storyKeyFor: (themeId, topicId) => {
      const theme = THEMES.find((t) => t.id === themeId);
      if (!theme) return null;
      const topics = getTopics(themeId);
      const topic = topicId ? topics.find((t) => t.id === topicId) : topics[0];
      return topic ? storyKey(theme, topic) : null;
    },
  };
}

async function main() {
  const out = process.env.OUT_DIR || join(root, 'improve-report');
  mkdirSync(out, { recursive: true });
  const today = process.env.FLG_TODAY || isoDay(Date.now());
  const { HOUSE_TUNING } = await import(`${pathToFileURL(TUNING_FILE).href}?t=${Date.now()}`);
  const signals = await gather();
  const r = await analyze(signals, { today, current: HOUSE_TUNING, engine: await loadEngine() });
  const tune = process.env.IMPROVE_TUNE !== '0' && r.entry;
  if (tune) writeTuning([...HOUSE_TUNING, r.entry]);
  else if (r.entry) { r.changes = []; r.notes.push('Report-only mode: the tuning above was worked out but not applied.'); r.entry = null; }
  writeFileSync(join(out, 'improve.json'), JSON.stringify(r, null, 2));
  writeFileSync(join(out, 'report.md'), renderReport(r, { runUrl: process.env.RUN_URL || '' }));
  console.log(`${r.findings.length} findings, ${r.findings.filter((f) => f.forClaude).length} for the Claude task, ${tune ? `a new tuning entry from ${r.entry.from}` : 'no tuning change'}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
