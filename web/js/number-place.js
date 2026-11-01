// The NINETIMESNINE screen: a separate numbers game with The Fantastical Logic
// Grid's look. The module (modules/number-place, copied to web/modules by the
// build) and its stylesheet load the first time the player opens it, so the
// Logic Grid's own start-up stays as fast as before. NINETIMESNINE keeps its own
// saves, settings and stats; the only thing it shares is anonymous play data
// for the learning service (np-share.js).
import * as npShare from './np-share.js';
import { numberPlace as npConfig } from './remote-config.js';

let mod = null;
let loading = null;

function loadCss() {
  if (document.getElementById('np-css')) return;
  const link = document.createElement('link');
  link.id = 'np-css';
  link.rel = 'stylesheet';
  link.href = new URL('../modules/number-place/ui.css', import.meta.url).href;
  document.head.append(link);
}

async function engine(themes) {
  try {
    const { workerEngine } = await import('../modules/number-place/engine-client.js');
    return workerEngine(new URL('../np-worker.js', import.meta.url), { themes });
  } catch (e) {
    // No module workers: run the engine on the page.
    const [np, st] = await Promise.all([import('../engine/number-place.js'), import('../engine/number-place-styles.js')]);
    return {
      themes, generate: async (o) => np.generateNumberPlace(o), hint: async (p, en) => np.getNumberPlaceHint(p, en),
      // The game styles: the rival's move and the Tidewater pools and ebb.
      move: async (p, g, o) => st.nextPlacement(p, g, o), tide: async (p, o) => st.planTide(p, o), ebb: async (p, g, w) => st.ebbTide(p, g, w),
    };
  }
}

// The dashboard's choices for the module (admin console, NINETIMESNINE section).
function config() {
  const c = npConfig();
  return {
    stories: c.stories, coachTips: c.coachTips, daily: c.daily, variants: c.variants, maxLevel: c.maxLevel,
    adaptStrength: c.adaptStrength, practiceChance: c.practiceChance, sharedWeight: c.sharedWeight,
  };
}

// Whether the menu offers NINETIMESNINE (the dashboard can switch it off).
export const enabled = () => npConfig().enabled !== false;

export async function open(host = {}) {
  loadCss();
  host.setWorld?.('random');
  if (!mod) {
    loading ||= (async () => {
      const [ui, story] = await Promise.all([import('../modules/number-place/ui.js'), import('../engine/number-place-story.js')]);
      const themes = story.NP_STORY_THEMES.map((t) => ({ id: t.id, name: t.name }));
      ui.mount(document.getElementById('np-root'), {
        engine: await engine(themes),
        storagePrefix: 'flg.np',
        shared: npShare.shared(),
        onPlay: (rec) => npShare.record(rec),
        celebrate: host.celebrate,
        setWorld: host.setWorld,
        config,
      });
      mod = ui;
      npShare.refresh().then((s) => { if (s) ui.setShared(s); });
      npShare.flush();
    })();
    try { await loading; } catch (e) {
      loading = null;
      document.getElementById('np-root').innerHTML = '<p class="muted">NINETIMESNINE could not load. Check your connection and try again.</p>';
      return;
    }
  } else mod.reopen();
  // A game card's link to one of the games (Rival Grid, Tidewater...) picks it on the setup screen.
  if (host.style) mod.pickStyle(host.style);
  document.getElementById('screen-np').focus();
}

// Leaving the screen: stop the clock and save.
export function leave() { mod?.suspend(); }
