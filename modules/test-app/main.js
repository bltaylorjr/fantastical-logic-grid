// Private test app for puzzle modules: mounts one module on its own page,
// outside The Logic Grid, so it can be tried before integration. The Game
// menu (or ?game=cm, sc, pg, np) picks the module.
import { NP_STORY_THEMES } from '../../engine/src/number-place-story.js';

const themes = NP_STORY_THEMES.map((t) => ({ id: t.id, name: t.name }));
const KIT = { cm: 'cage-math', sc: 'sum-cross', pg: 'picture-grid' };
const params = new URLSearchParams(location.search);
let game = params.get('game');
try { if (!game) game = localStorage.getItem('module-test.game'); } catch (e) { /* private mode */ }
if (!['np', 'cm', 'sc', 'pg'].includes(game)) game = 'np';

async function npEngine() {
  const { workerEngine } = await import('../number-place/engine-client.js');
  try {
    return workerEngine(new URL('../number-place/engine-worker.js', import.meta.url), { themes });
  } catch (e) {
    // No module workers: run the engine on the page.
    const [np, st] = await Promise.all([import('../../engine/src/number-place.js'), import('../../engine/src/number-place-styles.js')]);
    return {
      themes, generate: async (o) => np.generateNumberPlace(o), hint: async (p, e2) => np.getNumberPlaceHint(p, e2),
      move: async (p, g, o) => st.nextPlacement(p, g, o), tide: async (p, o) => st.planTide(p, o), ebb: async (p, g, w) => st.ebbTide(p, g, w),
    };
  }
}

async function kitEngine(id) {
  const { workerEngine } = await import('../grid-kit/engine-client.js');
  try {
    return workerEngine(new URL('../grid-kit/engine-worker.js', import.meta.url), id);
  } catch (e) {
    const { OPS } = await import(`../../engine/src/${id}-ops.js`);
    return { generate: async (o) => OPS.generate(o), hint: async (p, e2) => OPS.hint({ puzzle: p, entries: e2 }) };
  }
}

const theme = document.querySelector('#theme');
const applyTheme = () => { if (theme.value === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme.value; };
theme.onchange = applyTheme;
applyTheme();
const picker = document.querySelector('#game');
picker.value = game;
picker.onchange = () => { try { localStorage.setItem('module-test.game', picker.value); } catch (e) { /* private mode */ } const u = new URL(location.href); u.searchParams.set('game', picker.value); location.href = u.href; };

// The test app has no learning service: records stay on this device and are listed in the console.
const framed = !!document.querySelector('meta[name="np-no-print"]');
const host = {
  canPrint: !framed,
  canDownload: !framed,
  onPlay: (rec) => console.info('%s play record (would go to the learning service):', game === 'np' ? 'NINETIMESNINE' : game, rec),
  setWorld: (w) => { document.documentElement.dataset.world = w; },
};
const el = document.querySelector('#np');
if (game === 'np') {
  const { mount } = await import('../number-place/ui.js');
  mount(el, { ...host, engine: await npEngine(), storagePrefix: 'np-test' });
} else {
  const { mount } = await import(`../${KIT[game]}/ui.js`);
  mount(el, { ...host, engine: await kitEngine(game), storagePrefix: `${game}-test` });
}
