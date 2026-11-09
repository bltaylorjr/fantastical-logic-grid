// House tuning: what the weekly improvement run (scripts/improve.mjs) learned
// from everyone's games, as small, bounded nudges.
//
// Each entry applies from its `from` date (UTC) on, and entries are only ever
// added, never changed: the website rebuilds every daily puzzle from the first
// one on each publish, so a daily puzzle for a day uses the newest entry dated
// on or before that day, and past daily puzzles never change.
//
// An entry may hold:
//   daily.effort       per level, -1 (gentler) to 1 (tougher) within the level
//   daily.clueWeights  per clue type, 0.75 to 1.4 (1 is the level's normal mix)
//   storyPrefs         { storyKey: { o|i|m|e: { partKey: -1 to 1 } } }: story
//                      parts players rated low are picked less often, liked
//                      ones more (never a used storyline; see story.js)
//   reasons            plain words for the weekly email and the PR
//
// The game uses the newest entry's storyPrefs as a gentle starting point when
// "Learn from how I play" is on (web/js/learn.js); the player's own ratings
// count more. Daily puzzles planned by hand in the admin dashboard ignore it.
//
// Written by the weekly run. Edit by hand only to remove a bad entry that has
// not reached its `from` date yet.
export const HOUSE_TUNING = [
  {
    "from": "2026-11-10",
    "reasons": [
      "Daily Basic puzzles: a little tougher within the level (0 to 0.2), because of how the daily puzzle went.",
      "Daily Easy puzzles: a little tougher within the level (0 to 0.2), because of how the daily puzzle went.",
      "Daily Medium puzzles: a little tougher within the level (0 to 0.1), because of how the daily puzzle went.",
      "Daily Hard puzzles: a little tougher within the level (0 to 0.05), because of how the daily puzzle went.",
      "Daily Expert puzzles: a little tougher within the level (0 to 0.2), because of how the daily puzzle went.",
      "Daily Quantum Physicist puzzles: a little tougher within the level (0 to 0.2), because of how the daily puzzle went.",
      "Daily Theoretical Physicist puzzles: a little tougher within the level (0 to 0.2), because of how the daily puzzle went."
    ],
    "daily": {
      "effort": {
        "basic": 0.2,
        "easy": 0.2,
        "medium": 0.1,
        "hard": 0.05,
        "expert": 0.2,
        "mensa": 0.2,
        "theorist": 0.2
      },
      "clueWeights": {}
    },
    "storyPrefs": {}
  }
];

// The entry in force on `day` (YYYY-MM-DD), or null.
export function houseTuningFor(day, list = HOUSE_TUNING) {
  let best = null;
  for (const e of list) if (e.from <= day && (!best || e.from >= best.from)) best = e;
  return best;
}

// generatePuzzle() options for a daily puzzle at `tier` on `day`: {} when no
// entry is in force, so days before the first entry are built exactly as before.
export function houseDailyOptions(day, tier, list = HOUSE_TUNING) {
  const e = houseTuningFor(day, list);
  if (!e) return {};
  const learning = {};
  const effort = e.daily?.effort?.[tier];
  if (typeof effort === 'number' && effort) learning.effort = effort;
  if (e.daily?.clueWeights && Object.keys(e.daily.clueWeights).length) learning.clueWeights = e.daily.clueWeights;
  return {
    ...(Object.keys(learning).length ? { learning } : {}),
    ...(e.storyPrefs && Object.keys(e.storyPrefs).length ? { storyPrefs: e.storyPrefs } : {}),
  };
}
