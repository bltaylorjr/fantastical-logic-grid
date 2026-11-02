// How to play pages for the games with a page of their own (website only,
// called by seo.mjs): ninetimesnine/how-to-play/, cage-math/how-to-play/,
// sum-cross/how-to-play/, picture-grid/how-to-play/. Each mirrors The
// Fantastical Logic Grid's how-to-play/: the rules, the levels, a video, tips
// and a play button. The words come from the games themselves (each game's
// How to play window), so the pages never drift from the games.
//
// Videos (web/media/games):
//   <video>.mp4 / .jpg / .vtt              the game's short introduction
//   <video>-how-to-play.mp4 / .jpg / .vtt  an in-depth how-to-play video
// Either one shows only once its file is in the build; the page leaves its
// spot out until then, so adding the file is all it takes.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OWN_PAGES, hasVideo, videoTag } from './hub.mjs';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The game's own How to play text uses h3 for its sections; on a page with
// its own h1 they become h2 (and h4 becomes h3).
const promote = (html) => html.replace(/<(\/?)h3>/g, '<$1h2>').replace(/<(\/?)h4>/g, '<$1h3>');

const STYLE = `
.gk-howto-cols { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 28px; align-items: start; }
.gk-howto-ex { position: sticky; top: 16px; padding: 14px 18px; border: 1px solid var(--line, rgb(127 127 127 / .35)); border-radius: 14px; }
.gk-howto-ex > p { margin: 8px 0; }
@media (max-width: 760px) { .gk-howto-cols { grid-template-columns: minmax(0, 1fr); } .gk-howto-ex { position: static; } }
.guide-videos video { display: block; width: 100%; height: auto; border-radius: 12px; background: #000; margin: 0 0 6px; }
.style-rules { margin: 0 0 28px; }`;

async function load(root, file) {
  return import(pathToFileURL(join(root, 'modules', file)).href);
}

// Each game's text: the lede, the rules (HTML), the levels and the tips.
async function guideFor(root, g) {
  if (g.id === 'ninetimesnine') {
    const { HOWTO } = await load(root, 'number-place/howto.js');
    const { STYLES } = await load(root, 'number-place/styles.js');
    const name = (id) => STYLES.find((s) => s.id === id)?.short || id;
    const list = (items) => `<ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
    const classic = HOWTO.find((h) => h.id === 'classic');
    return {
      lede: 'NINETIMESNINE is the number puzzle where every row, column and box holds each number once. Play the classic game on a 4×4, 6×6 or 9×9 grid, or try one of four new ways to play. Every puzzle has exactly one answer you can reach by logic alone.',
      rules: `<h2>The rules</h2>
<p>${esc(classic.goal)}</p>
${list(classic.rules)}
<h2>Tools that help</h2>
${list(classic.tools)}
<h2>Every way to play</h2>
${HOWTO.filter((h) => h.id !== 'classic').map((h) => `<section class="style-rules"><h3>${esc(name(h.id))}</h3><p>${esc(h.goal)}</p>${list(h.rules)}</section>`).join('\n')}`,
      levels: null,
      tips: HOWTO.flatMap((h) => (h.tips || []).slice(0, h.id === 'classic' ? 4 : 1)),
      steps: [['Pick a style and a size', 'Choose Classic or another style, a grid size and a difficulty.'], ['Fill in a number', 'Tap a cell, then a number. Each row, column and box holds every number once.'], ['Use notes', 'Switch Notes on to pencil in what a cell could be.'], ['Ask for a hint', 'A hint gives a nudge, then where to look, then why.'], ['Finish the grid', 'Fill every cell correctly to solve the puzzle.']],
    };
  }
  const { def } = await load(root, `${g.id}/game.js`);
  return {
    lede: def.lede,
    rules: promote(def.howto),
    levels: def.levels,
    sizeLabel: def.sizeLabel,
    tips: def.coach,
    keys: def.keysHelp,
    steps: null,
  };
}

export async function writeGuides({ root, site, url, page, updated }) {
  for (const g of OWN_PAGES) {
    const path = `${g.page}how-to-play/`;
    const guide = await guideFor(root, g);
    const deep = `${g.video}-how-to-play`;
    const videos = [
      hasVideo(site, deep) && { file: deep, label: `How to play ${g.name}, in depth`, note: 'The full walkthrough, narrated, with captions.' },
      hasVideo(site, g.video) && { file: g.video, label: `${g.name} in a minute`, note: 'A quick look at the game.' },
    ].filter(Boolean);
    const videoSchema = videos.map((v) => ({
      '@context': 'https://schema.org', '@type': 'VideoObject', name: v.label, description: `${v.note} ${g.description}`,
      thumbnailUrl: [existsSync(join(site, 'media', 'games', `${v.file}.jpg`)) ? url(`media/games/${v.file}.jpg`) : url('og-image.jpg')],
      uploadDate: `${updated}T00:00:00Z`, contentUrl: url(`media/games/${v.file}.mp4`), embedUrl: url(path), inLanguage: 'en',
    }));
    const steps = guide.steps || [
      ['Pick a level', 'Choose a difficulty from Basic to Master. Each level picks a grid size to suit it.'],
      ['Read the clues', 'Every number on the board is a clue about the cells beside it.'],
      ['Fill in what must be true', 'Start where the clues leave only one choice.'],
      ['Ask for a hint when stuck', 'A hint gives a nudge, then where to look, then why.'],
      ['Finish the grid', 'Complete every cell correctly to solve the puzzle.'],
    ];
    page({
      path, priority: 0.8, app: true,
      title: `How to play ${g.name} | The Logic Grid`,
      description: `Learn how to play ${g.name}: the rules, the levels, tips to get started and a video. ${g.description}`,
      crumbs: [[g.page, g.name], [path, 'How to play']],
      style: STYLE,
      schema: [
        { '@context': 'https://schema.org', '@type': 'HowTo', name: `How to play ${g.name}`, description: g.description,
          step: steps.map(([n, t], i) => ({ '@type': 'HowToStep', position: i + 1, name: n, text: t })) },
        ...videoSchema,
      ],
      body: (up) => `<h1>How to play ${esc(g.name)}</h1>
<p class="lede">${esc(guide.lede)}</p>
<p><a class="btn big" href="${up}${g.page}">Play ${esc(g.name)} now</a></p>
${videos.length ? `<div class="guide-videos">${videos.map((v, i) => `<h2>${i === 0 ? 'Watch: ' : ''}${esc(v.label)}</h2>\n${videoTag(site, up, v.file, v.label, i === 0 ? 'metadata' : 'none')}\n<p class="muted">${esc(v.note)}</p>`).join('\n')}</div>` : ''}
${guide.rules}
${guide.levels ? `<h2>The levels</h2>
<div class="table-wrap"><table>
<caption>${guide.levels.length} levels, from ${esc(guide.levels[0].name)} to ${esc(guide.levels[guide.levels.length - 1].name)}</caption>
<thead><tr><th scope="col">Level</th><th scope="col">Grid sizes</th><th scope="col">What it brings</th></tr></thead>
<tbody>${guide.levels.map((l) => `<tr><th scope="row">${esc(l.name)}</th><td>${l.sizes.map((n) => esc(guide.sizeLabel(n))).join(' or ')}</td><td>${esc(l.note)}</td></tr>`).join('')}</tbody>
</table></div>
<p>The game learns from how you play and offers puzzles at the right level for you, and it never gives you the same puzzle twice.</p>` : ''}
<h2>Tips to get started</h2>
<ul>${guide.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
${guide.keys ? `<h2>Playing with a keyboard</h2>\n<p>${esc(guide.keys)}</p>` : ''}
<p><a class="btn big" href="${up}${g.page}">Play ${esc(g.name)}</a></p>
<p class="muted">More games: ${OWN_PAGES.filter((o) => o !== g).map((o) => `<a href="${up}${o.page}how-to-play/">${esc(o.name)}</a>`).join(' · ')} · <a href="${up}how-to-play/">The Fantastical Logic Grid</a></p>`,
    });
  }
}
