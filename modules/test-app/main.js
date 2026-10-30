// Private test app for puzzle modules: mounts one module on its own page,
// outside The Fantastical Logic Grid, so it can be tried before integration.
import { mount } from '../number-place/ui.js';
import { workerEngine } from '../number-place/engine-client.js';

async function engine() {
  try {
    return workerEngine(new URL('../number-place/engine-worker.js', import.meta.url));
  } catch (e) {
    // No module workers: run the engine on the page.
    const np = await import('../../engine/src/number-place.js');
    return { generate: async (o) => np.generateNumberPlace(o), hint: async (p, e2) => np.getNumberPlaceHint(p, e2) };
  }
}

const theme = document.querySelector('#theme');
const applyTheme = () => { if (theme.value === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme.value; };
theme.onchange = applyTheme;
applyTheme();

mount(document.querySelector('#np'), { engine: await engine(), storagePrefix: 'np-test', canPrint: !document.querySelector('meta[name="np-no-print"]') });
