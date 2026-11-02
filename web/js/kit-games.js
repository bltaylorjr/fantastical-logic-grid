// Cage Math, Sum Cross and Picture Grid: three games on their own screens
// (#screen-cm, #screen-sc, #screen-pg) with The Logic Grid's look. Each is the
// shared game screen (modules/grid-kit, copied to web/modules by the build)
// with its game's definition, loaded the first time the player opens it, so
// start-up stays as fast as before. Their engines run in the shared game
// worker (engine/src/games.js: cm, sc, pg). Each keeps its own saves,
// settings and stats; the only thing shared is anonymous play data for the
// learning service (kit-share.js).
import { gameLink } from './engine-links.js';
import { kitGame } from './remote-config.js';
import * as share from './kit-share.js';

// Card id (games.js) -> engine and screen id, folder and name.
export const KIT_GAMES = {
  'cage-math': { id: 'cm', dir: 'cage-math', name: 'Cage Math' },
  'sum-cross': { id: 'sc', dir: 'sum-cross', name: 'Sum Cross' },
  'picture-grid': { id: 'pg', dir: 'picture-grid', name: 'Picture Grid' },
};
export const byScreen = (id) => Object.entries(KIT_GAMES).find(([, g]) => g.id === id)?.[0] || null;

const mods = {};
const loading = {};

function loadCss() {
  if (document.getElementById('gk-css')) return;
  const link = document.createElement('link');
  link.id = 'gk-css';
  link.rel = 'stylesheet';
  link.href = new URL('../modules/grid-kit/kit.css', import.meta.url).href;
  document.head.append(link);
}

// The dashboard's choices for one game (admin console, its own section).
const config = (id) => () => {
  const c = kitGame(id);
  return { stories: c.stories, coachTips: c.coachTips, daily: c.daily, maxLevel: c.maxLevel, adaptStrength: c.adaptStrength, practiceChance: c.practiceChance, sharedWeight: c.sharedWeight };
};

// Whether the dashboard has the game switched on (card id).
export const enabled = (card) => !!KIT_GAMES[card] && kitGame(KIT_GAMES[card].id).enabled !== false;

export async function open(card, host = {}) {
  const g = KIT_GAMES[card];
  if (!g) return;
  loadCss();
  host.setWorld?.('random');
  const rootEl = document.getElementById(`${g.id}-root`);
  if (!mods[g.id]) {
    loading[g.id] ||= (async () => {
      const ui = await import(`../modules/${g.dir}/ui.js`);
      const link = gameLink(g.id);
      ui.mount(rootEl, {
        engine: { generate: (options) => link.call('generate', options), hint: (puzzle, entries) => link.call('hint', { puzzle, entries }) },
        storagePrefix: `flg.${g.id}`,
        shared: share.shared(g.id),
        onPlay: (rec) => share.record(g.id, rec),
        celebrate: host.celebrate,
        setWorld: host.setWorld,
        config: config(g.id),
      });
      mods[g.id] = ui;
      share.refresh(g.id).then((s) => { if (s) ui.setShared(s); });
      share.flush(g.id);
    })();
    try { await loading[g.id]; } catch (e) {
      loading[g.id] = null;
      rootEl.innerHTML = `<p class="muted">${g.name} could not load. Check your connection and try again.</p>`;
      return;
    }
  } else mods[g.id].reopen();
  document.getElementById(`screen-${g.id}`).focus();
}

// Leaving a game's screen: stop its clock and save.
export function leave(screen) {
  for (const [id, m] of Object.entries(mods)) if (id !== screen) m.suspend();
}
