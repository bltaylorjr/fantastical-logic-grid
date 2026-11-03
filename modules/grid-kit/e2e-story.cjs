// Shared browser checks for story themes, story moments and the solved card's
// next-level offer, used by every kit game's e2e file.
//   await story.seed(page, P, level, { outcome }) two quick past solves (or give-ups) at a level (reloads)
//   await story.pick(page, P, theme, moments) on the setup screen
//   await story.watch(page, P)                once the puzzle is open
//   await story.solved(page, P, DIR, { theme, moments, next }, assert)
const LEVELS = { basic: 'Basic', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', master: 'Master' };
const ORDER = Object.keys(LEVELS);

async function seed(page, P, level, { n = 2, outcome = 'solved' } = {}) {
  await page.evaluate(([P, level, n, outcome]) => {
    const k = `${P}-test.learn`;
    const d = JSON.parse(localStorage.getItem(k) || '{}');
    const plays = Array.from({ length: n }, (_, i) => ({ pid: `seed${i}`, fp: `seed${i}`, d: level, size: 4, mode: 'free', outcome, ms: 15000, hints: 0, mistakes: 0, checks: 0, stuck: [], feel: null, at: Date.now() - 100000 + i, daily: null }));
    localStorage.setItem(k, JSON.stringify({ v: 1, seen: [], stories: [], gallery: [], ...d, plays: [...(d.plays || []), ...plays] }));
  }, [P, level, n, outcome]);
  await page.reload();
  await page.waitForSelector(`#${P}-setup-view:not([hidden]) #${P}-levels .choice`);
  return n;
}

async function pick(page, P, theme, moments = true) {
  await page.selectOption(`#${P}-theme`, theme);
  const box = page.locator(`#${P}-moments`);
  if (!(await box.isVisible())) await page.click(`#${P}-setup .gk-more summary`);
  await box.setChecked(moments);
}

async function watch(page, P) {
  await page.evaluate((P) => {
    window.__moments = [];
    const el = document.querySelector(`#${P}-moment`);
    new MutationObserver(() => {
      const t = el.querySelector(`#${P}-moment-text`).textContent.trim();
      if (!el.hidden && t && window.__moments[window.__moments.length - 1] !== t) window.__moments.push(t);
    }).observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
  }, P);
}

async function solved(page, P, DIR, { theme, moments, next }, assert) {
  const info = await page.evaluate(async ([dir, P]) => {
    const G = (await import(`./modules/${dir}/ui.js`)).state();
    return { story: G.p.story, level: G.p.difficulty.id, title: document.querySelector(`#${P}-title`)?.textContent };
  }, [DIR, P]);
  const seen = await page.evaluate(() => window.__moments || []);
  if (theme) assert(info.story.theme === theme && info.title === info.story.title, `${P}: the chosen story theme (${theme}) tells the story: "${info.story.title}"`);
  if (moments) {
    assert(seen.length >= 1 && seen.every((t) => info.story.beats.includes(t) && !/\d/.test(t)), `${P}: story moments appeared while solving (${seen.length}): "${seen[0]}"`);
    assert((await page.textContent(`#${P}-moment-live`)).trim().length > 0, `${P}: the story moment is read out politely`);
  } else assert(seen.length === 0, `${P}: no story moments with the setting off`);
  assert(await page.locator(`#${P}-moment`).isHidden(), `${P}: the story moment steps aside on the solved card`);
  if (next) {
    const up = ORDER.indexOf(next) > ORDER.indexOf(info.level);
    assert((await page.textContent(`#${P}-adapt-note`)).includes(up ? `ready for ${LEVELS[next]}` : `Try ${LEVELS[next]}`), `${P}: the solved card suggests ${LEVELS[next]}`);
    assert((await page.textContent(`#${P}-again`)).includes(`Try ${LEVELS[next]}`) && await page.locator(`#${P}-again-same`).isVisible(), `${P}: Next puzzle goes to ${LEVELS[next]}, the same level is still offered`);
  } else assert(await page.locator(`#${P}-adapt-note`).isHidden() && await page.locator(`#${P}-again-same`).isHidden(), `${P}: no level change offered`);
}

module.exports = { seed, pick, watch, solved };
