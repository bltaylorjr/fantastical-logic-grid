// Self-tuning with approval. Each night (and when an admin presses Check now)
// the game reads the same numbers as the Analysis report and suggests small,
// bounded changes. Nothing changes until an admin approves, unless they have
// pre-approved that kind of change. Every change is then measured after
// MEASURE_DAYS; one that made things worse is offered back as an undo.
//
//   GET  /admin/v1/tuning                 waiting, being measured, results, rules (viewer)
//   POST /admin/v1/tuning/check           look for new suggestions now (admin)
//   POST /admin/v1/tuning/:id/approve     apply a waiting change (admin)
//   POST /admin/v1/tuning/:id/decline     { note } (admin)
//   POST /admin/v1/tuning/:id/undo        put an applied change back (admin)
//   POST /admin/v1/tuning/rules           { kind, mode: ask|auto } pre-approval (owner)
//
// What can change, and how far:
//   level         a Logic Grid level's toughness, +-0.2 a step, never past +-0.6
//                 (house_nudges, added to GET /v1/learn/tuning: new puzzles for
//                 players who keep "Learn from how I play" on, the default)
//   theme         how often Surprise me picks a theme, x0.85 or x1.15 a step,
//                 0.6 to 1.4
//   max_level     NINETIMESNINE, Cage Math, Sum Cross, Picture Grid: the hardest
//                 level offered, one step down, never below Medium
//   tips          the same games: first-puzzle tips back on
//   support_asks  the short Support ask after a solve, on
//   ad_repeat     post an ad that brought players again, a week later, on the
//                 same channel (a copy with its own tracked link)
//   ad_pause      move the next posts on a channel whose links bring visitors
//                 but no players back to draft, until someone looks at them
// Each needs enough games behind it (MIN_GAMES) and is never suggested again
// for a while after a decline. Only counts and rates are read: no player text.
import { getSettings, saveSetting, checkSetting, SETTINGS } from './settings.js';
import { TUNING_CACHE_KEY, readNudges } from './learn.js';
import { NP_TUNING_CACHE_KEY } from './number-place.js';
import { kitTuningKey } from './kit-games.js';
import { alert } from './alerts.js';
import { THEMES } from '../../engine/src/themes.js';
import { TIER_ORDER } from '../../engine/src/tiers.js';

const DAY = 24 * 3600_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const round = (v, p = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** p) / 10 ** p);
const pct = (f) => `${Math.round(f * 100)}%`;
export const WINDOW_DAYS = 30;     // the numbers a suggestion is based on
export const MEASURE_DAYS = 14;    // how long a change runs before it is judged
const EXPIRE_DAYS = 21;            // a suggestion nobody answered goes away
const QUIET_DAYS = 30;             // no new suggestion for a target after a decline or undo
export const MIN_GAMES = 20;
const MIN_FELT = 10;
const LEVEL_STEP = 0.2, LEVEL_MAX = 0.6;
const THEME_DOWN = 0.85, THEME_UP = 1.15, THEME_MIN = 0.6, THEME_MAX = 1.4;
const GAME_LEVELS = ['basic', 'easy', 'medium', 'hard', 'expert', 'master'];
const MAX_LEVEL_FLOOR = 'medium';
const TIER_NAMES = { basic: 'Basic', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', mensa: 'Quantum Physicist', theorist: 'Theoretical Physicist' };
const LEVEL_NAMES = { basic: 'Basic', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', master: 'Master' };
const THEME_NAMES = Object.fromEntries(THEMES.map((t) => [t.id, t.name]));
const GAMES = [['np', 'NINETIMESNINE', null], ['cm', 'Cage Math', 'cm'], ['sc', 'Sum Cross', 'sc'], ['pg', 'Picture Grid', 'pg']];
const GAME_NAMES = Object.fromEntries(GAMES.map(([id, name]) => [id, name]));

export const KINDS = {
  level: { label: 'Logic Grid level toughness', limits: `${LEVEL_STEP} a step, never past ${LEVEL_MAX} either way` },
  theme: { label: 'How often Surprise me picks a theme', limits: `x${THEME_DOWN} or x${THEME_UP} a step, between ${THEME_MIN} and ${THEME_MAX}` },
  max_level: { label: 'Hardest level offered in the other games', limits: `one level down at a time, never below ${LEVEL_NAMES[MAX_LEVEL_FLOOR]}` },
  tips: { label: 'First-puzzle tips in the other games', limits: 'only switches tips back on' },
  support_asks: { label: 'Support ask after a solve', limits: 'only switches it on, when the Support link is set up' },
  ad_repeat: { label: 'Repeat a post that brought players', limits: 'one copy of a post, a week later, on the same channel; never a copy of a copy' },
  ad_pause: { label: 'Pause posts on a channel that brings no players', limits: 'only the channel\'s upcoming posts, back to draft; nothing is deleted' },
};
const AD_MIN_VISITS = 10;      // a post needs this many tracked visits to be repeated
const PAUSE_MIN_VISITS = 30;   // a channel needs this many tracked visits with no puzzle started to be paused
const REPEAT_SUFFIX = '-again';
const MODES = ['ask', 'auto'];

// ------------------------------------------------------------- values
// A target is nudge:effort:<tier>, nudge:theme:<id> or setting:<key>.
function parseTarget(target) {
  const m = /^nudge:(effort|theme):([\w-]{1,40})$/.exec(target);
  if (m) return { type: 'nudge', what: m[1], id: m[2], key: `${m[1]}:${m[2]}` };
  const ad = /^repeat:(\d{1,12})$/.exec(target);
  if (ad) return { type: 'repeat', id: Number(ad[1]) };
  const ch = /^approved:([a-z0-9][a-z0-9_-]{0,39})$/.exec(target);
  if (ch) return { type: 'approved', channel: ch[1] };
  const s = /^setting:([a-z0-9_]{1,60})$/.exec(target);
  if (s && SETTINGS[s[1]]) return { type: 'setting', key: s[1] };
  return null;
}
const nudgeDefault = (what) => (what === 'theme' ? 1 : 0);

// The not-yet-posted copy of an ad that self-tuning made, if any.
async function repeatCopy(env, id) {
  return env.DB.prepare(`SELECT c.id, c.post_on FROM campaign_ads c JOIN campaign_ads a ON a.id = ?1
    WHERE c.campaign_id = a.campaign_id AND c.channel = a.channel AND c.content = a.content || ?2 AND c.status != 'removed' LIMIT 1`).bind(id, REPEAT_SUFFIX).first();
}
// A channel's upcoming approved posts, ids in order.
async function upcomingApproved(env, channel, now = Date.now()) {
  const { results } = await env.DB.prepare(`SELECT id FROM campaign_ads WHERE channel = ?1 AND status = 'approved' AND posted_at IS NULL AND COALESCE(post_on, '9999') >= ?2 ORDER BY id`).bind(channel, isoDay(now)).all();
  return results.map((r) => r.id);
}

async function readTarget(env, target, settings) {
  const t = parseTarget(target);
  if (!t) return undefined;
  if (t.type === 'setting') return (settings || await getSettings(env))[t.key];
  if (t.type === 'repeat') {
    const copy = await repeatCopy(env, t.id);
    return copy ? { on: copy.post_on } : null;
  }
  if (t.type === 'approved') return upcomingApproved(env, t.channel);
  const row = await env.DB.prepare('SELECT value FROM house_nudges WHERE target = ?1').bind(t.key).first();
  return row ? row.value : nudgeDefault(t.what);
}

async function writeTarget(env, target, value, by, now) {
  const t = parseTarget(target);
  if (!t) throw new Error('unknown target');
  if (t.type === 'setting') {
    const c = checkSetting(t.key, value);
    if (c.error) throw new Error(c.error);
    await saveSetting(env, t.key, c.value, by);
    const g = /^(np|cm|sc|pg)_/.exec(t.key);
    if (g) await caches.default.delete(new Request(g[1] === 'np' ? NP_TUNING_CACHE_KEY : kitTuningKey(g[1]))).catch(() => {});
  } else if (t.type === 'repeat') {
    const copy = await repeatCopy(env, t.id);
    if (value && !copy) {
      await env.DB.prepare(`INSERT INTO campaign_ads (campaign_id, channel, medium, content, title, body, media, landing, status, where_to, notes, post_on, created_by, created_at, updated_at)
        SELECT campaign_id, channel, medium, content || ?2, title || ' (again)', body, media, landing, 'approved', where_to, ?3, ?4, ?5, ?6, ?6 FROM campaign_ads WHERE id = ?1`)
        .bind(t.id, REPEAT_SUFFIX, `A repeat of a post that brought players, approved in Self-tuning by ${by}.`, value.on, `self-tuning:${t.id}`, now).run();
    } else if (!value && copy) {
      await env.DB.prepare("UPDATE campaign_ads SET status = 'removed', updated_at = ?2 WHERE id = ?1 AND posted_at IS NULL").bind(copy.id, now).run();
    }
  } else if (t.type === 'approved') {
    // Set which of the channel's upcoming posts are approved: the listed ones
    // become approved, other upcoming approved ones go back to draft.
    const want = new Set((value || []).map(Number));
    const { results } = await env.DB.prepare(`SELECT id, status FROM campaign_ads WHERE channel = ?1 AND posted_at IS NULL AND status IN ('approved', 'draft') AND COALESCE(post_on, '9999') >= ?2`).bind(t.channel, isoDay(now)).all();
    for (const r of results) {
      const status = want.has(r.id) ? 'approved' : (r.status === 'approved' ? 'draft' : null);
      if (status && status !== r.status) await env.DB.prepare('UPDATE campaign_ads SET status = ?1, updated_at = ?2 WHERE id = ?3').bind(status, now, r.id).run();
    }
  } else {
    if (!Number.isFinite(value)) throw new Error('bad value');
    if (value === nudgeDefault(t.what)) await env.DB.prepare('DELETE FROM house_nudges WHERE target = ?1').bind(t.key).run();
    else await env.DB.prepare(`INSERT INTO house_nudges (target, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT (target) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(t.key, value, now, by).run();
    await caches.default.delete(new Request(TUNING_CACHE_KEY)).catch(() => {});
  }
}

// ------------------------------------------------------------- numbers
// The numbers behind a target between two days (from inclusive, to exclusive).
async function measure(env, target, from, to) {
  const t = parseTarget(target);
  const db = env.DB;
  if (t?.type === 'nudge') {
    const col = t.what === 'effort' ? 'tier' : 'theme';
    const r = await db.prepare(`SELECT COUNT(*) AS games, COALESCE(SUM(outcome = 'solved'), 0) AS solved,
        COALESCE(SUM(outcome != 'solved'), 0) AS quit, COUNT(feel) AS felt, COALESCE(SUM(feel = 'hard'), 0) AS hard, COALESCE(SUM(feel = 'easy'), 0) AS easy,
        COUNT(rating) AS rated, AVG(rating) AS rating
      FROM plays WHERE ${col} = ?1 AND day >= ?2 AND day < ?3`).bind(t.id, from, to).first();
    return shape(r);
  }
  const g = t && /^(np|cm|sc|pg)_/.exec(t.key);
  if (g) {
    const [table, where] = g[1] === 'np' ? ['np_plays', '1 = 1'] : ['kit_plays', 'game = ?3'];
    const sql = `SELECT COUNT(*) AS games, COALESCE(SUM(outcome = 'solved'), 0) AS solved, COALESCE(SUM(outcome != 'solved'), 0) AS quit,
        COUNT(feel) AS felt, COALESCE(SUM(feel = 'hard'), 0) AS hard, COALESCE(SUM(feel = 'easy'), 0) AS easy, 0 AS rated, NULL AS rating
      FROM ${table} WHERE ${where} AND day >= ?1 AND day < ?2`;
    const q = db.prepare(sql);
    return shape(await (g[1] === 'np' ? q.bind(from, to) : q.bind(from, to, g[1])).first());
  }
  if (t?.type === 'repeat') {
    const ad = await db.prepare('SELECT a.channel, a.content, c.code FROM campaign_ads a JOIN campaigns c ON c.id = a.campaign_id WHERE a.id = ?1').bind(t.id).first();
    if (!ad) return {};
    return adStats(await db.prepare(`SELECT event, SUM(n) AS n FROM campaign_stats WHERE campaign = ?1 AND source = ?2 AND content = ?3 AND day >= ?4 AND day < ?5 GROUP BY event`).bind(ad.code, ad.channel, ad.content + REPEAT_SUFFIX, from, to).all());
  }
  if (t?.type === 'approved') {
    return adStats(await db.prepare(`SELECT event, SUM(n) AS n FROM campaign_stats WHERE source = ?1 AND campaign != '(none)' AND day >= ?2 AND day < ?3 GROUP BY event`).bind(t.channel, from, to).all());
  }
  if (t?.key === 'support_asks_enabled') {
    const r = await db.prepare("SELECT COALESCE(SUM(CASE WHEN event = 'visit' THEN n END), 0) AS visits, COALESCE(SUM(CASE WHEN event = 'support' THEN n END), 0) AS support FROM campaign_stats WHERE day >= ?1 AND day < ?2").bind(from, to).first();
    return { visits: r.visits, support: r.support, supportRate: r.visits ? round(r.support / r.visits, 3) : null };
  }
  return {};
}
function adStats({ results }) {
  const e = Object.fromEntries(results.map((r) => [r.event, r.n]));
  const visits = e.visit || 0, plays = e.play || 0;
  return { visits, plays, solves: e.solve || 0, returns: e.return || 0, startRate: visits ? round(plays / visits) : null };
}
const shape = (r) => ({
  games: r.games || 0, solved: r.solved || 0, quit: r.quit || 0,
  solveRate: r.games ? round(r.solved / r.games) : null, quitRate: r.games ? round(r.quit / r.games) : null,
  felt: r.felt || 0, hardShare: r.felt ? round(r.hard / r.felt) : null, easyShare: r.felt ? round(r.easy / r.felt) : null,
  rated: r.rated || 0, rating: round(r.rating, 2),
});

// ------------------------------------------------------------- suggestions
// Every change the numbers call for now, before checking what is already
// waiting, measured or recently declined.
export async function candidates(env, now = Date.now()) {
  const db = env.DB;
  const from = isoDay(now - (WINDOW_DAYS - 1) * DAY);
  const to = isoDay(now + DAY);
  const s = await getSettings(env, now);
  const nudges = await readNudges(env);
  const out = [];
  const stat = (r) => shape(r);
  const base = `COUNT(*) AS games, COALESCE(SUM(outcome = 'solved'), 0) AS solved, COALESCE(SUM(outcome != 'solved'), 0) AS quit,
    COUNT(feel) AS felt, COALESCE(SUM(feel = 'hard'), 0) AS hard, COALESCE(SUM(feel = 'easy'), 0) AS easy`;

  // Logic Grid levels: gentler when players give up or say too hard; tougher when nearly everyone solves and says too easy.
  const tiers = (await db.prepare(`SELECT tier AS id, ${base}, 0 AS rated, NULL AS rating FROM plays WHERE day >= ?1 GROUP BY tier`).bind(from).all()).results;
  for (const r of tiers) {
    if (!TIER_ORDER.includes(r.id)) continue;
    const m = stat(r);
    if (m.games < MIN_GAMES) continue;
    const cur = nudges[`effort:${r.id}`] || 0;
    const name = TIER_NAMES[r.id];
    const hard = m.felt >= MIN_FELT && m.hardShare >= 0.4;
    const easy = m.felt >= MIN_FELT && m.easyShare >= 0.4;
    if ((m.quitRate >= 0.35 || hard) && cur > -LEVEL_MAX) {
      out.push({ kind: 'level', target: `nudge:effort:${r.id}`, from: cur, to: round(Math.max(-LEVEL_MAX, cur - LEVEL_STEP)), baseline: m, dir: 'down',
        label: `Make ${name} puzzles a little gentler`,
        reason: `In the last ${WINDOW_DAYS} days ${pct(m.quitRate)} of ${m.games} ${name} games ended without a solve${m.felt >= MIN_FELT ? ` and ${pct(m.hardShare)} of players who answered said it was too hard` : ''}.`,
        watch: `${name}: share of games given up (now ${pct(m.quitRate)}) and "too hard" answers.` });
    } else if (m.solveRate >= 0.9 && easy && cur < LEVEL_MAX) {
      out.push({ kind: 'level', target: `nudge:effort:${r.id}`, from: cur, to: round(Math.min(LEVEL_MAX, cur + LEVEL_STEP)), baseline: m, dir: 'up',
        label: `Make ${name} puzzles a little tougher`,
        reason: `${pct(m.solveRate)} of ${m.games} ${name} games were solved and ${pct(m.easyShare)} of players who answered called them too easy.`,
        watch: `${name}: "too easy" answers (now ${pct(m.easyShare)}) while the solve rate stays high.` });
    }
  }

  // Themes Surprise me picks: less often when rated low or given up on, more often when loved.
  const themes = (await db.prepare(`SELECT theme AS id, ${base}, COUNT(rating) AS rated, AVG(rating) AS rating FROM plays WHERE day >= ?1 GROUP BY theme`).bind(from).all()).results;
  const off = new Set(s.disabled_themes || []);
  for (const r of themes) {
    if (!THEME_NAMES[r.id] || off.has(r.id)) continue;
    const m = stat(r);
    if (m.games < MIN_GAMES) continue;
    const cur = nudges[`theme:${r.id}`] ?? 1;
    const name = THEME_NAMES[r.id];
    if (((m.rated >= 5 && m.rating < 3) || m.quitRate >= 0.45) && cur > THEME_MIN) {
      out.push({ kind: 'theme', target: `nudge:theme:${r.id}`, from: cur, to: round(Math.max(THEME_MIN, cur * THEME_DOWN)), baseline: m, dir: 'down',
        label: `Pick the ${name} theme a little less often in Surprise me`,
        reason: m.rated >= 5 && m.rating < 3 ? `${name} puzzles average ${m.rating.toFixed(1)} stars from ${m.rated} ratings.` : `${pct(m.quitRate)} of ${m.games} ${name} games ended without a solve.`,
        watch: `${name}: rating and share of games given up. Players can still choose it themselves.` });
    } else if (m.rated >= 10 && m.rating >= 4.5 && m.quitRate < 0.25 && cur < THEME_MAX) {
      out.push({ kind: 'theme', target: `nudge:theme:${r.id}`, from: cur, to: round(Math.min(THEME_MAX, cur * THEME_UP)), baseline: m, dir: 'up',
        label: `Pick the ${name} theme a little more often in Surprise me`,
        reason: `${name} puzzles average ${m.rating.toFixed(1)} stars from ${m.rated} ratings and few are given up (${pct(m.quitRate)}).`,
        watch: `${name}: rating stays high as more players get it.` });
    }
  }

  // NINETIMESNINE and the grid-kit games: the hardest level offered, and first-puzzle tips.
  for (const [id, gameName] of GAMES) {
    const enabled = s[`${id}_enabled`];
    if (enabled === false) continue;
    const q = id === 'np'
      ? db.prepare(`SELECT level AS id, ${base} FROM np_plays WHERE day >= ?1 GROUP BY level`).bind(from)
      : db.prepare(`SELECT level AS id, ${base} FROM kit_plays WHERE game = ?2 AND day >= ?1 GROUP BY level`).bind(from, id);
    let rows = [];
    try { rows = (await q.all()).results; } catch (e) { continue; }
    const all = shape(rows.reduce((a, r) => ({ games: a.games + r.games, solved: a.solved + r.solved, quit: a.quit + r.quit, felt: a.felt + r.felt, hard: a.hard + r.hard, easy: a.easy + r.easy }), { games: 0, solved: 0, quit: 0, felt: 0, hard: 0, easy: 0 }));
    const maxKey = `${id}_max_level`;
    const top = s[maxKey];
    const topRow = rows.find((r) => r.id === top);
    const i = GAME_LEVELS.indexOf(top);
    if (topRow && topRow.games >= 10 && topRow.solved / topRow.games < 0.2 && i > GAME_LEVELS.indexOf(MAX_LEVEL_FLOOR)) {
      const m = shape(topRow);
      out.push({ kind: 'max_level', target: `setting:${maxKey}`, from: top, to: GAME_LEVELS[i - 1], baseline: all, dir: 'down',
        label: `${gameName}: offer up to ${LEVEL_NAMES[GAME_LEVELS[i - 1]]} instead of ${LEVEL_NAMES[top]}`,
        reason: `Only ${pct(m.solveRate)} of ${m.games} ${LEVEL_NAMES[top]} games were solved in the last ${WINDOW_DAYS} days.`,
        watch: `${gameName}: share of all games given up (now ${pct(all.quitRate)}).` });
    }
    const tipsKey = `${id}_coach_tips`;
    if (s[tipsKey] === false && all.games >= 30 && all.quitRate >= 0.4) {
      out.push({ kind: 'tips', target: `setting:${tipsKey}`, from: false, to: true, baseline: all, dir: 'up',
        label: `${gameName}: switch first-puzzle tips back on`,
        reason: `${pct(all.quitRate)} of ${all.games} ${gameName} games ended without a solve, and new players get no tips.`,
        watch: `${gameName}: share of games given up.` });
    }
  }

  // Support asks: people already press Support, so a short thank-you ask after a solve may help.
  if (s.support_link_enabled && s.support_url && !s.support_asks_enabled) {
    const m = await measure(env, 'setting:support_asks_enabled', from, to);
    if (m.visits >= 100 && m.support >= 5) {
      out.push({ kind: 'support_asks', target: 'setting:support_asks_enabled', from: false, to: true, baseline: m, dir: 'up',
        label: 'Show the short Support ask after a solve',
        reason: `${m.support} of ${m.visits} tracked visitors pressed Support in the last ${WINDOW_DAYS} days without being asked.`,
        watch: 'Support presses per visitor, and new supporters.' });
    }
  }
  // Marketing: repeat a post whose tracked link brought players; pause a
  // channel whose links bring visitors but nobody starts a puzzle.
  const ads = (await db.prepare(`SELECT a.id, a.channel, a.medium, a.content, a.title, c.code, c.status AS cstatus,
      COALESCE(SUM(CASE WHEN s.event = 'visit' THEN s.n END), 0) AS visits, COALESCE(SUM(CASE WHEN s.event = 'play' THEN s.n END), 0) AS plays,
      COALESCE(SUM(CASE WHEN s.event = 'return' THEN s.n END), 0) AS returns
    FROM campaign_ads a JOIN campaigns c ON c.id = a.campaign_id
    LEFT JOIN campaign_stats s ON s.campaign = c.code AND s.source = a.channel AND s.content = a.content AND s.day >= ?1
    WHERE a.status = 'posted' AND a.content != '' AND substr(a.content, -length(?2)) != ?2
      -- One repeat per post: once it has a copy (the same test as repeatCopy),
      -- it is not suggested again after that copy has been measured.
      AND NOT EXISTS (SELECT 1 FROM campaign_ads r WHERE r.campaign_id = a.campaign_id AND r.channel = a.channel
        AND r.content = a.content || ?2 AND r.status != 'removed')
    GROUP BY a.id`).bind(from, REPEAT_SUFFIX).all()).results;
  for (const a of ads) {
    if (a.cstatus !== 'active' || a.visits < AD_MIN_VISITS || a.plays / a.visits < 0.3) continue;
    const on = isoDay(now + 7 * DAY);
    const m = { visits: a.visits, plays: a.plays, startRate: round(a.plays / a.visits), returns: a.returns };
    out.push({ kind: 'ad_repeat', target: `repeat:${a.id}`, from: null, to: { on }, baseline: m, dir: 'up',
      label: `Post "${a.title}" again on ${on}`,
      reason: `Its link brought ${a.visits} visitors in the last ${WINDOW_DAYS} days and ${pct(m.startRate)} of them started a puzzle.`,
      watch: `Visitors and puzzles started from the repeat's own tracked link, ${MEASURE_DAYS} days after approval.` });
  }
  const channels = (await db.prepare(`SELECT source, COALESCE(SUM(CASE WHEN event = 'visit' THEN n END), 0) AS visits, COALESCE(SUM(CASE WHEN event = 'play' THEN n END), 0) AS plays
    FROM campaign_stats WHERE campaign NOT IN ('(none)', '(other)') AND day >= ?1 GROUP BY source`).bind(from).all()).results;
  for (const c of channels) {
    if (c.visits < PAUSE_MIN_VISITS || c.plays) continue;
    const ids = await upcomingApproved(env, c.source, now);
    if (!ids.length) continue;
    out.push({ kind: 'ad_pause', target: `approved:${c.source}`, from: ids, to: [], baseline: { visits: c.visits, plays: 0, startRate: 0 }, dir: 'down',
      label: `Pause the next ${ids.length} ${c.source} post${ids.length === 1 ? '' : 's'} until you look at them`,
      reason: `${c.visits} visitors came from ${c.source} posts in the last ${WINDOW_DAYS} days and none started a puzzle. Check the posts use their tracked link before posting more.`,
      watch: `Nothing is posted on ${c.source} while paused; approve the posts again in Marketing when ready.` });
  }
  return out;
}

// ------------------------------------------------------------- the run
const row = (r) => ({
  id: r.id, kind: r.kind, kindLabel: KINDS[r.kind]?.label || 'Take back a change', target: r.target, label: r.label,
  from: r.from_value == null ? null : JSON.parse(r.from_value), to: JSON.parse(r.to_value), reason: r.reason, watch: r.watch,
  baseline: r.baseline ? JSON.parse(r.baseline) : null, status: r.status, auto: !!r.auto, undoOf: r.undo_of,
  createdAt: r.created_at, decidedAt: r.decided_at, decidedBy: r.decided_by, note: r.note, checkAt: r.check_at,
  result: r.result ? JSON.parse(r.result) : null, checkedAt: r.checked_at,
});

export async function rules(env) {
  try {
    const { results } = await env.DB.prepare('SELECT kind, mode FROM tuning_rules').all();
    const set = Object.fromEntries(results.map((r) => [r.kind, r.mode]));
    return Object.fromEntries(Object.keys(KINDS).map((k) => [k, MODES.includes(set[k]) ? set[k] : 'ask']));
  } catch (e) { return Object.fromEntries(Object.keys(KINDS).map((k) => [k, 'ask'])); }
}

// Apply a waiting suggestion. Refuses when the value moved since it was
// suggested (someone changed it by hand), so nothing is overwritten blindly.
export async function applyProposal(env, id, by, now = Date.now(), { auto = false } = {}) {
  const r = await env.DB.prepare('SELECT * FROM tuning_proposals WHERE id = ?1').bind(id).first();
  if (!r) return { error: 'not_found', message: 'That suggestion is not there any more.' };
  if (r.status !== 'waiting') return { error: 'decided', message: 'That suggestion has already been answered.' };
  const cur = await readTarget(env, r.target);
  if (JSON.stringify(cur) !== r.from_value) {
    await env.DB.prepare("UPDATE tuning_proposals SET status = 'replaced', decided_at = ?1, decided_by = ?2, note = 'The value was changed by hand after this was suggested.' WHERE id = ?3").bind(now, by, id).run();
    return { error: 'moved', message: 'That value was changed since this was suggested, so nothing was applied. Press Check now for a fresh suggestion.' };
  }
  await writeTarget(env, r.target, JSON.parse(r.to_value), by, now);
  await env.DB.prepare("UPDATE tuning_proposals SET status = 'applied', auto = ?1, decided_at = ?2, decided_by = ?3, check_at = ?4 WHERE id = ?5")
    .bind(auto ? 1 : 0, now, by, now + MEASURE_DAYS * DAY, id).run();
  // An undo that was approved closes the change it takes back.
  if (r.kind === 'undo' && r.undo_of) await env.DB.prepare("UPDATE tuning_proposals SET status = 'undone' WHERE id = ?1 AND status = 'applied'").bind(r.undo_of).run();
  return { ok: true };
}

export async function undoChange(env, id, by, now = Date.now()) {
  const r = await env.DB.prepare('SELECT * FROM tuning_proposals WHERE id = ?1').bind(id).first();
  if (!r || r.status !== 'applied') return { error: 'not_applied', message: 'Only an applied change can be undone.' };
  const cur = await readTarget(env, r.target);
  if (JSON.stringify(cur) !== r.to_value) return { error: 'moved', message: 'That value has changed again since, so it was left alone. Change it in Settings if needed.' };
  await writeTarget(env, r.target, JSON.parse(r.from_value), by, now);
  await env.DB.prepare("UPDATE tuning_proposals SET status = 'undone', note = COALESCE(note, '') || ?1 WHERE id = ?2").bind(`Undone by ${by}.`, id).run();
  // A waiting undo suggestion for it is no longer needed.
  await env.DB.prepare("UPDATE tuning_proposals SET status = 'replaced', decided_at = ?1, decided_by = ?2 WHERE undo_of = ?3 AND status = 'waiting'").bind(now, by, id).run();
  return { ok: true };
}

// Judge a change after MEASURE_DAYS: did the numbers it was meant to move move?
function verdict(r, before, after) {
  const kind = r.kind;
  if (kind === 'support_asks') {
    if (!after.visits || after.visits < 50) return ['not_enough', 'Too few visitors since the change to tell.'];
    const d = (after.supportRate || 0) - (before.supportRate || 0);
    return d > 0.002 ? ['helped', `Support presses went from ${pct(before.supportRate || 0)} to ${pct(after.supportRate || 0)} of visitors.`] : d < -0.002 ? ['worse', `Support presses fell from ${pct(before.supportRate || 0)} to ${pct(after.supportRate || 0)} of visitors.`] : ['no_change', 'Support presses stayed about the same.'];
  }
  if (kind === 'ad_repeat') {
    if (!after.visits || after.visits < 5) return ['not_enough', `The repeat brought ${after.visits || 0} visitors: too few to tell.`];
    return after.startRate >= 0.3 ? ['helped', `The repeat brought ${after.visits} visitors and ${pct(after.startRate)} started a puzzle.`] : ['no_change', `The repeat brought ${after.visits} visitors, but only ${pct(after.startRate || 0)} started a puzzle.`];
  }
  if (kind === 'ad_pause') return ['no_change', `Paused. ${after.visits || 0} visitors came from earlier ${r.target.slice('approved:'.length)} posts since; approve its posts again in Marketing when ready.`];
  if (!after.games || after.games < 10) return ['not_enough', `Only ${after.games || 0} games since the change: too few to tell. It stays as it is.`];
  const dir = kind === 'level' && JSON.parse(r.to_value) > JSON.parse(r.from_value) ? 'up' : 'down';
  if (kind === 'theme' && before.rating != null && after.rating != null && after.rated >= 5) {
    const d = after.rating - before.rating;
    if (d <= -0.3) return ['worse', `The rating went from ${before.rating.toFixed(1)} to ${after.rating.toFixed(1)} stars.`];
    if (d >= 0.2) return ['helped', `The rating went from ${before.rating.toFixed(1)} to ${after.rating.toFixed(1)} stars.`];
  }
  const q0 = before.quitRate ?? 0, q1 = after.quitRate ?? 0;
  if (kind === 'level' && dir === 'up') {
    if (q1 - q0 >= 0.1) return ['worse', `More players gave up: ${pct(q0)} before, ${pct(q1)} after.`];
    if (before.easyShare != null && after.easyShare != null && after.felt >= 5 && after.easyShare < before.easyShare - 0.05) return ['helped', `"Too easy" answers went from ${pct(before.easyShare)} to ${pct(after.easyShare)}, with ${pct(after.solveRate)} still solved.`];
    return ['no_change', `About the same: ${pct(after.solveRate)} solved, ${pct(q1)} given up.`];
  }
  if (q0 - q1 >= 0.05) return ['helped', `Fewer players gave up: ${pct(q0)} before, ${pct(q1)} after.`];
  if (q1 - q0 >= 0.05) return ['worse', `More players gave up: ${pct(q0)} before, ${pct(q1)} after.`];
  return ['no_change', `About the same: ${pct(q0)} given up before, ${pct(q1)} after.`];
}

async function checkResults(env, now, made) {
  const { results } = await env.DB.prepare("SELECT * FROM tuning_proposals WHERE status = 'applied' AND result IS NULL AND check_at <= ?1 LIMIT 20").bind(now).all();
  for (const r of results) {
    const before = r.baseline ? JSON.parse(r.baseline) : {};
    const after = await measure(env, r.target, isoDay(r.decided_at), isoDay(now + DAY));
    const [v, text] = r.kind === 'undo' ? ['no_change', 'A change taken back: nothing to judge.'] : verdict(r, before, after);
    await env.DB.prepare('UPDATE tuning_proposals SET result = ?1, checked_at = ?2 WHERE id = ?3').bind(JSON.stringify({ verdict: v, text, before, after }), now, r.id).run();
    // Worse: offer to take it back (always asks first).
    if (v === 'worse') {
      const cur = await readTarget(env, r.target);
      if (JSON.stringify(cur) === r.to_value) {
        await env.DB.prepare(`INSERT INTO tuning_proposals (kind, target, label, from_value, to_value, reason, watch, baseline, undo_of, created_at)
          VALUES ('undo', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`).bind(r.target, `Take back: ${r.label}`, r.to_value, r.from_value, `After ${MEASURE_DAYS} days: ${text}`, 'The same numbers as before the change.', JSON.stringify(after), r.id, now).run();
        made.push('undo');
      }
    }
  }
  return results.length;
}

// The nightly run (and Check now): expire old suggestions, judge changes that
// have run long enough, then add new suggestions and apply the pre-approved ones.
export async function runTuning(env, { now = Date.now(), ctx = null, by = 'nightly' } = {}) {
  const db = env.DB;
  await db.prepare("UPDATE tuning_proposals SET status = 'expired', decided_at = ?1 WHERE status = 'waiting' AND created_at < ?2").bind(now, now - EXPIRE_DAYS * DAY).run();
  const made = [];
  const checked = await checkResults(env, now, made);
  const found = await candidates(env, now);
  const { results: recent } = await db.prepare(`SELECT target, status, check_at, created_at, decided_at, to_value, from_value FROM tuning_proposals
    WHERE status = 'waiting' OR (status = 'applied' AND (check_at > ?1 OR result IS NULL)) OR (status IN ('declined', 'undone') AND COALESCE(decided_at, created_at) > ?2)`).bind(now, now - QUIET_DAYS * DAY).all();
  const busy = new Set(recent.map((r) => r.target));
  const mode = await rules(env);
  const added = [], applied = [];
  for (const c of found) {
    if (busy.has(c.target)) continue;
    busy.add(c.target);
    const row = await db.prepare(`INSERT INTO tuning_proposals (kind, target, label, from_value, to_value, reason, watch, baseline, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`).bind(c.kind, c.target, c.label, JSON.stringify(c.from), JSON.stringify(c.to), c.reason, c.watch, JSON.stringify(c.baseline), now).first();
    if (mode[c.kind] === 'auto') {
      const a = await applyProposal(env, row.id, 'pre-approved', now, { auto: true });
      if (a.ok) { applied.push(c.label); continue; }
    }
    added.push(c.label);
  }
  const waiting = added.length + made.length;
  if (waiting) {
    await alert(env, ctx, { category: 'approvals', title: `${waiting} tuning change${waiting === 1 ? '' : 's'} waiting for your OK`, body: [...added, ...made.map(() => 'Take back a change that made things worse')].slice(0, 3).join('; '), link: 'analysis', dedupe: `tuning-${isoDay(now)}` });
  }
  if (applied.length) {
    await alert(env, ctx, { category: 'approvals', title: `${applied.length} pre-approved tuning change${applied.length === 1 ? '' : 's'} applied`, body: applied.slice(0, 3).join('; '), link: 'analysis', dedupe: `tuning-auto-${isoDay(now)}` });
  }
  return { checked, added: added.length, applied: applied.length, undos: made.length, by };
}

export async function tuningView(env, now = Date.now()) {
  const db = env.DB;
  const [waiting, measuring, done] = await Promise.all([
    db.prepare("SELECT * FROM tuning_proposals WHERE status = 'waiting' ORDER BY kind = 'undo' DESC, created_at DESC LIMIT 50").all(),
    db.prepare("SELECT * FROM tuning_proposals WHERE status = 'applied' ORDER BY decided_at DESC LIMIT 50").all(),
    db.prepare("SELECT * FROM tuning_proposals WHERE status NOT IN ('waiting', 'applied') ORDER BY COALESCE(decided_at, created_at) DESC LIMIT 40").all(),
  ]);
  const last = await db.prepare("SELECT MAX(created_at) AS at FROM tuning_proposals").first();
  return {
    waiting: waiting.results.map(row), applied: measuring.results.map(row), history: done.results.map(row),
    rules: await rules(env), kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { ...v, measureDays: MEASURE_DAYS }])),
    minGames: MIN_GAMES, windowDays: WINDOW_DAYS, measureDays: MEASURE_DAYS, lastSuggestion: last?.at || null, now,
  };
}

export function tuningRoutes(Refusal) {
  const idOf = (raw) => Number(raw);
  const done = (r) => { if (r.error) throw new Refusal(r.error === 'not_found' ? 404 : 409, r.error, r.message); return r; };
  return [
    ['GET', /^tuning$/, 'viewer', 'tuning.view', async ({ env, now }) => ({ body: await tuningView(env, now), quiet: true })],
    ['POST', /^tuning\/check$/, 'admin', 'tuning.check', async ({ env, ctx, now, who }) => {
      const r = await runTuning(env, { now, ctx, by: who.actor });
      return { body: r, detail: r };
    }],
    ['POST', /^tuning\/(\d{1,12})\/approve$/, 'admin', 'tuning.approve', async ({ env, params: [raw], who, now }) => {
      done(await applyProposal(env, idOf(raw), who.actor, now));
      return { body: { ok: true }, target: raw };
    }],
    ['POST', /^tuning\/(\d{1,12})\/decline$/, 'admin', 'tuning.decline', async ({ env, params: [raw], who, now, body }) => {
      const note = String(body?.note || '').replace(/\s+/g, ' ').trim().slice(0, 300) || null;
      const r = await env.DB.prepare("UPDATE tuning_proposals SET status = 'declined', decided_at = ?1, decided_by = ?2, note = ?3 WHERE id = ?4 AND status = 'waiting'").bind(now, who.actor, note, idOf(raw)).run();
      if (!r.meta?.changes) throw new Refusal(409, 'decided', 'That suggestion has already been answered.');
      return { body: { ok: true }, target: raw, detail: { note } };
    }],
    ['POST', /^tuning\/(\d{1,12})\/undo$/, 'admin', 'tuning.undo', async ({ env, params: [raw], who, now }) => {
      done(await undoChange(env, idOf(raw), who.actor, now));
      return { body: { ok: true }, target: raw };
    }],
    ['POST', /^tuning\/rules$/, 'owner', 'tuning.rules', async ({ env, body, who, now }) => {
      if (!KINDS[body?.kind] || !MODES.includes(body?.mode)) throw new Refusal(400, 'bad_rule', 'Pick a kind of change and Ask me first or Pre-approved.');
      await env.DB.prepare(`INSERT INTO tuning_rules (kind, mode, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT (kind) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(body.kind, body.mode, now, who.actor).run();
      return { body: { ok: true, rules: await rules(env) }, target: body.kind, detail: { mode: body.mode } };
    }],
  ];
}
