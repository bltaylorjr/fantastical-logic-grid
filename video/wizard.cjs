// Records the Puzzle Wizard's how-to videos (one for each game) and The Logic
// Grid intro from the real website, and writes the narration for each scene:
//   video/out-wizard-fantastical/scenes.json
//   video/out-wizard-ninetimesnine/scenes.json
//   video/out-tlg/scenes.json
// Every entry of the wizard gets its own scene, narrated from the same words
// the wizard shows (web/js/wizard-fields.js: what to write, and how it is used
// in the puzzle), so the videos always match the form. Run from the repo root
// after `npm run build`:
//   node video/wizard.cjs
//   VIDEO=wizard-fantastical python3 video/build.py --install
//   VIDEO=wizard-ninetimesnine python3 video/build.py --install
//   VIDEO=tlg python3 video/build.py --install
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SITE_PORT = 8173;
const SITE = `http://localhost:${SITE_PORT}`;
const VIEW = { width: 1440, height: 810 };
const SCALE = 4 / 3;
const CSS = `
  #__hl{position:fixed;pointer-events:none;z-index:2147483646;border:4px solid #f5a524;border-radius:14px;box-shadow:0 0 0 9999px rgba(10,15,30,.38),0 0 0 8px rgba(245,165,36,.35)}
  #c-send-msg{visibility:hidden}`;

// The sample puzzles typed into the wizard.
const FLG = {
  title: 'The Midnight Gala', look: 'mystery', tone: 'Mysterious', difficulty: 'medium',
  story: 'The lights went out at the Midnight Gala, and when they came back on, the tiara was gone. Every guest was somewhere different, with a different drink in hand.',
  ending: 'The tiara turns up in the greenhouse, and the gala dances on until dawn.',
  castOne: 'guest', castMany: 'guests', names: ['Lady Ashford', 'Colonel Pike', 'Miss Lane', 'Mr. Finch'],
  categories: [['Room', 'Library, Kitchen, Garden, Attic', ''], ['Arrival', '7:00 PM, 7:15 PM, 7:30 PM, 7:45 PM', 'earlier']],
};

(async () => {
  const W = await import(path.join(ROOT, 'web/js/wizard-fields.js'));
  const { generateNumberPlace } = await import(path.join(ROOT, 'engine/src/number-place.js'));
  // A 6 × 6 grid the author "types in": the wizard checks it has one answer.
  const NTN = generateNumberPlace({ difficulty: 'medium', size: 6, seed: 'wizard-video', story: false });

  const site = spawn('node', [path.join(ROOT, 'scripts/serve.mjs'), path.join(ROOT, 'dist', 'site'), String(SITE_PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  try {
    await recordWizard(browser, W, 'fantastical', async (p, step) => fillFlg(p, step));
    await recordWizard(browser, W, 'ninetimesnine', async (p, step) => fillNtn(p, step, NTN));
    await recordIntro(browser);
  } finally {
    await browser.close();
    site.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });

function helpers(p, shots, scenes) {
  const clear = () => p.evaluate(() => document.querySelectorAll('#__hl').forEach((e) => e.remove()));
  return {
    async hl(sels, pad = 10) {
      await p.addStyleTag({ content: CSS });
      await p.evaluate(({ sels, pad }) => {
        document.querySelectorAll('#__hl').forEach((e) => e.remove());
        const rs = sels.flatMap((s) => [...document.querySelectorAll(s)]).map((e) => e.getBoundingClientRect()).filter((r) => r.width);
        if (!rs.length) return;
        const x = Math.min(...rs.map((r) => r.left)) - pad; const y = Math.min(...rs.map((r) => r.top)) - pad;
        const w = Math.max(...rs.map((r) => r.right)) + pad - x; const h = Math.max(...rs.map((r) => r.bottom)) + pad - y;
        const d = document.createElement('div'); d.id = '__hl';
        Object.assign(d.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
        document.body.append(d);
      }, { sels: [].concat(sels), pad });
    },
    async view(sel, offset = -120) {
      await p.evaluate(({ sel, offset }) => { const e = document.querySelector(sel); if (e) window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY + offset); }, { sel, offset });
      await p.waitForTimeout(250);
    },
    async scene(name, sentences) {
      await p.waitForTimeout(250);
      await p.screenshot({ path: path.join(shots, `${name}.png`) });
      scenes.push({ shot: `shots/${name}.png`, sentences });
      await clear();
    },
    card(name, sentences) { scenes.push({ shot: `shots/card-${name}.png`, sentences }); },
  };
}

async function cards(browser, shots, names) {
  const cp = await browser.newPage({ viewport: VIEW, deviceScaleFactor: SCALE });
  for (const k of names) {
    await cp.goto(`file://${path.join(__dirname, 'card.html')}#${k}`); await cp.reload(); await cp.waitForTimeout(400);
    await cp.screenshot({ path: path.join(shots, `card-${k}.png`) });
  }
  await cp.close();
}

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: true });
  await ctx.addInitScript(() => { if (!localStorage.getItem('flg.settings')) localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, welcomed: true, voiceProvider: 'device', silent: true })); });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('page error:', e.message));
  return p;
}

// ---------------------------------------------------------------- the wizard
async function recordWizard(browser, W, game, fill) {
  const out = path.join(__dirname, `out-wizard-${game}`);
  const shots = path.join(out, 'shots');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(shots, { recursive: true });
  const scenes = [];
  const p = await newPage(browser);
  const { hl, view, scene, card } = helpers(p, shots, scenes);
  const g = W.GAMES[game];
  const say = (k) => {
    const f = W.FIELDS[game][k];
    if (f.type === 'consent') return ['Permission, which is required. Tick the box to say you made the puzzle yourself, and that the team may use and publish it with the credit you chose.', f.use];
    return [`${f.label}${f.req ? ', which is required' : ''}. ${f.help}`, f.use];
  };

  card(`wiz${game}`, [`Submit Puzzle Ideas helps you make your own puzzle for ${g.name}, step by step, and send it to the team.`, 'This video shows every entry, what it is for, and how it fits into the puzzle the wizard builds.']);

  await p.goto(`${SITE}/`);
  await p.waitForSelector('.app-item[data-wizard]');
  await view('.app-item[data-wizard]', -200);
  await hl('.app-item[data-wizard]', 8);
  await scene('button', ['On thelogicgrid.com, choose Submit Puzzle Ideas, under One account for every game.']);
  await p.click('.app-item[data-wizard]');
  await p.waitForSelector('#wizard-pick[open]');
  await hl(`#wizard-pick a[href$="${game}"]`, 6);
  await scene('pick', [`A box asks which puzzle you would like to make. Choose ${g.name}.`]);

  await p.goto(`${SITE}/wizard/?game=${game}`);
  await p.waitForSelector('#w-form .w-step');
  await hl(['.w-progress']);
  await scene('steps', [`The wizard goes one step at a time. There are ${W.STEPS[game].length} steps, and you can jump back to any of them.`]);
  await hl(['#w-saved', '#w-restart']);
  await scene('autosave', ['Everything you type is saved on this device as you go. Leave and come back later, and your draft is waiting.', 'Start over clears it when you want a fresh start.']);
  await hl(['#w-watch', 'label:has(#w-guidance)']);
  await scene('help', ['Watch how it works opens this video and a written guide to every entry.', 'Show help on every field shows what to write, an example, and how each entry is used in your puzzle.']);

  for (const [i, s] of W.STEPS[game].entries()) {
    await fill(p, s.id);
    await p.evaluate(() => window.scrollTo(0, 0));
    await hl('#w-form h2', 8);
    await scene(`step-${s.id}`, [`Step ${i + 1}: ${s.title}.`, s.intro]);
    for (const k of s.fields) {
      const sel = `[data-field="${k}"]`;
      if (!(await p.$(sel))) continue;
      await view(sel);
      await hl(sel, 8);
      await scene(`${s.id}-${k}`, say(k));
    }
    if (i === W.STEPS[game].length - 2) {
      await view('#w-preview', -200);
      await hl(['.w-story']);
      await scene('story', ['At the bottom of every step, you see your storyline as you write it: the puzzle\'s words, just as players will read them.', 'You cannot type in it. It changes as you fill in the fields above.']);
    }
    if (i < W.STEPS[game].length - 1) await p.click('#w-next');
  }
  await p.click('#w-next');
  await p.waitForURL(/check/);
  await p.waitForSelector('#c-status.good', { timeout: 60000 });
  await hl(['#c-status', '.c-issues-card']);
  await scene('check', ['Check my puzzle opens a new page.', 'The box at the top says whether your puzzle is ready: it must have exactly one answer that players can reason out.', 'Anything missing or wrong is listed, with a link straight to the field, and suggestions to make it better.']);
  await view('#w-form', -140);
  await hl('#w-form', 6);
  await scene('editor', ['Every entry is here in one editor, so you can fix or change anything.', 'Each change is checked again straight away, so you always know whether the puzzle is still valid.']);
  await p.click('#c-build');
  await p.waitForSelector('#c-result:not([hidden])', { timeout: 60000 });
  await p.evaluate(() => window.scrollTo(0, 0));
  await hl('#c-result', 8);
  await scene('result', ['When you are happy, press Build my puzzle.', 'Download the PDF to keep or share it, or print it straight away. It has your puzzle and its answer key.',
    'Your puzzle is also saved to your Saved puzzles, so you can play it in the game, and a copy goes to the team, who may publish it with your credit.']);
  await hl('#c-edit', 8);
  await scene('again', ['Want to change something? Make changes takes you back to the editor, with suggestions shown and the one-answer check, then build it again.']);
  card('wizoutro', ['Answer the questions, check and fix, then build, print and play. Have fun making puzzles!']);
  await cards(browser, shots, [`wiz${game}`, 'wizoutro']);
  fs.writeFileSync(path.join(out, 'scenes.json'), JSON.stringify({ scenes }, null, 1));
  console.log(`${game}: ${scenes.length} scenes written`);
  await p.context().close();
}

async function fillFlg(p, step) {
  if (step === 'story') {
    await p.fill('#w-title', FLG.title);
    await p.selectOption('#w-look', FLG.look).catch(() => {});
    await p.fill('#w-story', FLG.story);
    await p.fill('#w-ending', FLG.ending);
    await p.selectOption('#w-tone', FLG.tone);
    await p.selectOption('#w-difficulty', FLG.difficulty);
  } else if (step === 'cast') {
    await p.fill('#w-cast-one', FLG.castOne);
    await p.fill('#w-cast-many', FLG.castMany);
    for (const [i, n] of FLG.names.entries()) await p.fill(`#w-names-${i}`, n);
  } else if (step === 'lists') {
    for (const [i, [name, items, order]] of FLG.categories.entries()) {
      await p.fill(`#w-categories-${i}-name`, name);
      await p.fill(`#w-categories-${i}-items`, items);
      if (order) await p.selectOption(`#w-categories-${i}-order`, order);
    }
  } else if (step === 'answer') {
    await p.click('[data-act=answer-fill]');
  } else if (step === 'credit') {
    await p.check('[data-k=consent]');
  }
}

async function fillNtn(p, step, sample) {
  if (step === 'story') {
    await p.fill('#w-title', 'The Clockmaker\'s Drawers');
    await p.selectOption('#w-world', 'vault');
    await p.fill('#w-opening', 'The clockmaker locked every drawer in her workshop with a number puzzle, and the key to the shop is inside one of them.');
    await p.fill('#w-stakes', 'The shop opens in an hour.');
    await p.fill('#w-ending', 'The last drawer clicks open, and there is the key, wrapped in a note: "Well reasoned."');
  } else if (step === 'grid') {
    await p.check('input[data-k=size][value="6"]');
  } else if (step === 'givens') {
    for (const [c, d] of sample.givens.entries()) if (d) await p.fill(`[data-cell="${c}"]`, String(d));
    await p.waitForTimeout(300);
  } else if (step === 'credit') {
    await p.check('[data-k=consent]');
  }
}

// ---------------------------------------------------------------- The Logic Grid intro
async function recordIntro(browser) {
  const out = path.join(__dirname, 'out-tlg');
  const shots = path.join(out, 'shots');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(shots, { recursive: true });
  const scenes = [];
  const p = await newPage(browser);
  const { hl, view, scene, card } = helpers(p, shots, scenes);
  card('tlg', ['Welcome to The Logic Grid: logic and number puzzle games, free to play in your browser.']);
  await p.goto(`${SITE}/`);
  await p.waitForSelector('.games .card');
  await hl('.games', 8);
  await scene('cards', ['Choose a game from the cards.']);
  await hl('.card[data-game="flg"]', 6);
  await scene('flg', ['The Fantastical Logic Grid. Story logic puzzles where every case is brand new.']);
  await hl('.card[data-game="ntn"]', 6);
  await scene('ntn', ['NINETIMESNINE. Number puzzles, with five ways to play.']);
  await view('.app-item[data-wizard]', -200);
  await hl('.app-item[data-wizard]', 8);
  await scene('wizard', ['New: Submit Puzzle Ideas. Make your own puzzle for either game, step by step.', 'It checks your puzzle has exactly one answer, gives you a PDF to print, and saves it to your Saved puzzles.']);
  await p.click('.app-item[data-wizard]');
  await p.waitForSelector('#wizard-pick[open]');
  await hl('#wizard-pick', 6);
  await scene('wizard-pick', ['Choose which puzzle to make, and the wizard asks only what that puzzle needs.']);
  await p.keyboard.press('Escape');
  await view('#app', -60);
  await hl('#app', 8);
  await scene('app', ['One account works in every game: your saves, stats and settings follow you.', 'Messages, ideas, problem reports and installing the app are all here too.']);
  card('tlgoutro', ['Pick your puzzle, or make your own. Happy puzzling!']);
  await cards(browser, shots, ['tlg', 'tlgoutro']);
  fs.writeFileSync(path.join(out, 'scenes.json'), JSON.stringify({ scenes }, null, 1));
  console.log(`The Logic Grid intro: ${scenes.length} scenes written`);
  await p.context().close();
}
