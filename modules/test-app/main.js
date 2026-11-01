// Private test app for puzzle modules: mounts one module on its own page,
// outside The Fantastical Logic Grid, so it can be tried before integration.
import { mount } from '../number-place/ui.js';
import { workerEngine } from '../number-place/engine-client.js';
import { NP_STORY_THEMES } from '../../engine/src/number-place-story.js';

const themes = NP_STORY_THEMES.map((t) => ({ id: t.id, name: t.name }));

async function engine() {
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

const theme = document.querySelector('#theme');
const applyTheme = () => { if (theme.value === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme.value; };
theme.onchange = applyTheme;
applyTheme();

// The test app has no learning service: records stay on this device and are listed in the console.
const framed = !!document.querySelector('meta[name="np-no-print"]');
mount(document.querySelector('#np'), {
  engine: await engine(),
  storagePrefix: 'np-test',
  canPrint: !framed,
  canDownload: !framed,
  onPlay: (rec) => console.info('NINETIMESNINE play record (would go to the learning service):', rec),
  setWorld: (w) => { document.documentElement.dataset.world = w; },
});
