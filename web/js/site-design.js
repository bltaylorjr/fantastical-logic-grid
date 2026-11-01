// The website's design: every option the admin dashboard's Website page
// offers, in categories. One file, shared by
//   - the admin dashboard (dropdowns and text boxes; copied to admin/ by scripts/admin-media.mjs),
//   - the Worker (checks what the dashboard saves; server/src/site-design.js),
//   - the site build (writes the published design into every page; scripts/site-design-build.mjs),
//   - the live preview in the dashboard (js/design-preview.js).
// The defaults are the site as it was designed, so the default design changes
// nothing. Only choices that differ from the defaults are written into pages.
// The high contrast look is never changed, so it always stays readable.

const pick = (value, label) => ({ value, label });

// Accent colors for light pages: each one keeps white button text readable
// (contrast 4.5:1 or more). Accents for dark pages keep dark button text readable.
const ACCENT_LIGHT = [pick('#5B3CC4', 'Royal purple'), pick('#1F5FAD', 'Ocean blue'), pick('#0E7490', 'Deep teal'), pick('#2F7D4F', 'Forest green'),
  pick('#B42318', 'Crimson'), pick('#C2410C', 'Burnt orange'), pick('#86198F', 'Plum'), pick('#334155', 'Slate')];
const ACCENT_DARK = [pick('#F5C451', 'Gold'), pick('#7DD3FC', 'Sky blue'), pick('#6EE7B7', 'Mint'), pick('#FDA4AF', 'Rose'), pick('#C4B5FD', 'Lavender'), pick('#FDBA74', 'Apricot')];
const PAGE_LIGHT = [pick('#E9EDF7', 'Cool gray'), pick('#F5F0E6', 'Warm paper'), pick('#FFFFFF', 'White'), pick('#E6F0FA', 'Mist blue'), pick('#EEF5EE', 'Sage')];
const PAGE_DARK = [pick('#080B16', 'Midnight'), pick('#111111', 'Charcoal'), pick('#0A1428', 'Deep navy'), pick('#160F24', 'Night plum')];
const SHOW = [pick('show', 'Show'), pick('hide', 'Hide')];

const DEFAULT_TEXT = {
  heroEyebrow: 'Puzzle games',
  heroTitle: 'Pick your puzzle.',
  heroText: 'Two logic games, free to play in your browser. No guessing needed in either one — every puzzle can be solved by reasoning alone.',
  flgTag: 'Story logic puzzles',
  flgText: 'Read the clues, mark the grid, and work out who did what. Every puzzle tells a story.',
  flgButton: 'Play The Fantastical Logic Grid',
  ntnTag: 'Number puzzles',
  ntnText: 'Fill the grid so every row, column and box holds each number once. Start small at 4×4 or go for the full 9×9.',
  ntnButton: 'Play NINETIMESNINE',
  wizardButton: 'Submit Puzzle Ideas',
  appTitle: 'One account for every game',
  appText: 'Sign in once and your saves, stats and settings stay in step in every game, on every device.',
  footerNote: 'Questions? support@thelogicgrid.com',
  infoPlay: 'Play free',
  hubTitle: 'The Logic Grid | Free logic and number puzzle games',
  hubDescription: 'The Logic Grid: The Fantastical Logic Grid story logic puzzles and NINETIMESNINE number puzzles. Free to play in your browser.',
  npTitle: 'NINETIMESNINE | Free number puzzles | The Logic Grid',
  npDescription: 'Free number puzzles: fill the grid so every row, column and box holds each number once. Classic, Rival Grid, Chain Reaction, Tidewater and Glyph Quest.',
};

const text = (key, label, max, opts = {}) => ({ key, label, type: opts.long ? 'textarea' : 'text', max, default: DEFAULT_TEXT[key], ...opts });
const select = (key, label, choices, def, help) => ({ key, label, type: 'select', choices, default: def, help });

// page: which page the preview turns to when an option in the category changes
// ('any': the option shows on every page, so the preview stays where it is).
export const CATEGORIES = [
  { id: 'colors', name: 'Colors', page: 'any', help: 'Button, link and background colors on every page except the games themselves.', options: [
    select('accentLight', 'Accent color (light look)', ACCENT_LIGHT, '#5B3CC4'),
    select('accentDark', 'Accent color (dark look)', ACCENT_DARK, '#F5C451'),
    select('pageLight', 'Background (light look)', PAGE_LIGHT, '#E9EDF7'),
    select('pageDark', 'Background (dark look)', PAGE_DARK, '#080B16'),
  ] },
  { id: 'type', name: 'Fonts and text size', page: 'any', help: 'Headings and reading size on every page except the games themselves.', options: [
    select('headingFont', 'Heading font', [pick('cinzel', 'Cinzel (classic capitals)'), pick('serif', 'Book serif'), pick('sans', 'Atkinson Hyperlegible (easy to read)'), pick('system', 'Device font')], 'cinzel'),
    select('textSize', 'Text size', [pick('standard', 'Standard'), pick('large', 'Large'), pick('xlarge', 'Extra large')], 'standard'),
  ] },
  { id: 'shape', name: 'Shapes and layout', page: 'any', help: 'Corners, cards, shadows and page width.', options: [
    select('corners', 'Corners', [pick('square', 'Square'), pick('soft', 'Soft'), pick('round', 'Rounded'), pick('pill', 'Extra round')], 'round'),
    select('cardStyle', 'Card style', [pick('glass', 'Frosted glass'), pick('solid', 'Solid'), pick('outline', 'Outline only')], 'glass'),
    select('shadows', 'Shadows', [pick('none', 'None'), pick('soft', 'Soft'), pick('strong', 'Strong')], 'soft'),
    select('width', 'Page width', [pick('narrow', 'Narrow'), pick('standard', 'Standard'), pick('wide', 'Wide')], 'standard'),
  ] },
  { id: 'hero', name: 'Front page: top', page: 'hub', help: 'The words and layout at the top of thelogicgrid.com.', options: [
    select('heroAlign', 'Alignment', [pick('center', 'Centered'), pick('left', 'Left')], 'center'),
    select('heroEyebrowShow', 'Small label above the heading', SHOW, 'show'),
    text('heroEyebrow', 'Small label text', 40),
    text('heroTitle', 'Heading', 60),
    text('heroText', 'Introduction', 220, { long: true }),
    text('wizardButton', 'Submit Puzzle Ideas button', 50),
  ] },
  { id: 'cards', name: 'Front page: game cards', page: 'hub', help: 'The two game cards: order, layout and words.', options: [
    select('cardOrder', 'Order', [pick('flg', 'The Fantastical Logic Grid first'), pick('ntn', 'NINETIMESNINE first')], 'flg'),
    select('cardLayout', 'Layout', [pick('side', 'Side by side'), pick('stack', 'One above the other')], 'side'),
    select('cardBullets', 'Feature lists', SHOW, 'show'),
    text('flgTag', 'The Fantastical Logic Grid: label', 40),
    text('flgText', 'The Fantastical Logic Grid: description', 200, { long: true }),
    text('flgButton', 'The Fantastical Logic Grid: button', 40),
    text('ntnTag', 'NINETIMESNINE: label', 40),
    text('ntnText', 'NINETIMESNINE: description', 200, { long: true }),
    text('ntnButton', 'NINETIMESNINE: button', 40),
  ] },
  { id: 'app', name: 'Front page: shared by every game', page: 'hub', help: 'The section under the game cards: account, messages, ideas, problems, installing, support, news and social links.', options: [
    select('appSection', 'Show this section', SHOW, 'show'),
    text('appTitle', 'Heading', 60),
    text('appText', 'Introduction', 200, { long: true }),
  ] },
  { id: 'effects', name: 'Front page: visual effects', page: 'hub', help: 'Movement is always switched off for visitors whose device asks for less motion.', options: [
    select('fxArrival', 'When the page opens', [pick('none', 'No animation'), pick('rise', 'Cards rise in'), pick('fade', 'Fade in')], 'none'),
    select('fxHover', 'When the pointer is on a card', [pick('none', 'Nothing'), pick('lift', 'Card lifts'), pick('spotlight', 'Lifts with a gold spotlight'), pick('tilt', '3D tilt')], 'lift'),
    select('fxArt', 'Card pictures', [pick('still', 'Still'), pick('solve', 'Puzzle solves itself on hover')], 'still'),
    select('fxBackdrop', 'Background', [pick('grid', 'Graph paper with glow'), pick('drift', 'Drifting graph paper'), pick('glow', 'Glow only'), pick('plain', 'Plain color')], 'grid'),
    select('fxSparkles', 'Twinkling stars', [pick('off', 'Off'), pick('on', 'On')], 'off'),
  ] },
  { id: 'chrome', name: 'Front page: header and footer', page: 'hub', options: [
    select('themePicker', 'Light and dark picker (Look)', SHOW, 'show'),
    select('footerLinks', 'Privacy and terms links', SHOW, 'show'),
    text('footerNote', 'Footer note', 80),
  ] },
  { id: 'ntnpage', name: 'NINETIMESNINE page', page: 'np', options: [
    select('npHeader', 'Header bar', [pick('light', 'Light'), pick('accent', 'Accent color')], 'light'),
    select('npFlgLink', 'Link to The Fantastical Logic Grid', SHOW, 'show'),
  ] },
  { id: 'info', name: 'Information pages', page: 'how-to-play', help: 'How to play, daily puzzle, printables, themes, difficulty levels, educators, privacy and terms.', options: [
    select('infoHeader', 'Header bar', [pick('light', 'Light'), pick('accent', 'Accent color')], 'light'),
    select('infoNav', 'Page links in the header', SHOW, 'show'),
    text('infoPlay', 'Play button', 30),
  ] },
  { id: 'seo', name: 'Search results and sharing', page: 'hub', help: 'What search engines and shared links show. Keep titles under about 60 characters and descriptions under about 160.', options: [
    text('hubTitle', 'Front page title', 70),
    text('hubDescription', 'Front page description', 170, { long: true }),
    text('npTitle', 'NINETIMESNINE title', 70),
    text('npDescription', 'NINETIMESNINE description', 170, { long: true }),
  ] },
];

export const OPTIONS = CATEGORIES.flatMap((c) => c.options.map((o) => ({ ...o, category: c.id })));
const BY_KEY = Object.fromEntries(OPTIONS.map((o) => [o.key, o]));

// The pages the preview can show: [id, label, path on the site].
export const PREVIEW_PAGES = [['hub', 'Front page', ''], ['np', 'NINETIMESNINE', 'ninetimesnine/'], ['how-to-play', 'How to play', 'how-to-play/'],
  ['daily', 'Daily puzzle', 'daily/'], ['printables', 'Printables', 'printables/'], ['themes', 'Themes', 'themes/'], ['educators', 'For educators', 'educators/'], ['privacy', 'Privacy', 'privacy/']];

export const defaults = () => Object.fromEntries(OPTIONS.map((o) => [o.key, o.default]));

// Only known options, only listed choices, plain text of a set length. Anything
// else falls back to the default, so a bad save can never break a page.
export function normalize(input) {
  const out = defaults();
  if (!input || typeof input !== 'object') return out;
  for (const o of OPTIONS) {
    const v = input[o.key];
    if (o.type === 'select') { if (o.choices.some((c) => c.value === v)) out[o.key] = v; continue; }
    if (typeof v !== 'string') continue;
    const clean = v.replace(/[<>]/g, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, o.max);
    if (clean) out[o.key] = clean;
  }
  return out;
}

// Only the choices that differ from the defaults (what is saved and published).
export function changes(design) {
  const d = normalize(design);
  return Object.fromEntries(OPTIONS.filter((o) => d[o.key] !== o.default).map((o) => [o.key, d[o.key]]));
}

const FONTS = {
  cinzel: '"Cinzel", "Iowan Old Style", "Palatino Linotype", Georgia, serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
  sans: '"Atkinson Hyperlegible", "Segoe UI", system-ui, -apple-system, sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};
const RADIUS = { square: '4px', soft: '10px', round: '18px', pill: '28px' };
const SIZE = { standard: 1, large: 1.12, xlarge: 1.25 };
const BASE_SIZE = { hub: 17, info: 18, np: 16 }; // each page's own reading size
const WIDTH = { narrow: '880px', standard: '1080px', wide: '1280px' };
const lighter = (c) => `color-mix(in srgb, ${c} 80%, white)`;

// The attributes on <html> that switch effects and layout choices.
export function attributes(design) {
  const d = normalize(design);
  return {
    'data-fx-arrival': d.fxArrival, 'data-fx-hover': d.fxHover, 'data-fx-art': d.fxArt, 'data-fx-backdrop': d.fxBackdrop, 'data-fx-sparkles': d.fxSparkles,
    'data-card-order': d.cardOrder, 'data-card-layout': d.cardLayout, 'data-card-bullets': d.cardBullets, 'data-hero-align': d.heroAlign,
    'data-hero-eyebrow': d.heroEyebrowShow, 'data-theme-picker': d.themePicker, 'data-footer-links': d.footerLinks, 'data-app-section': d.appSection,
    'data-np-header': d.npHeader, 'data-np-flg': d.npFlgLink, 'data-info-header': d.infoHeader, 'data-info-nav': d.infoNav,
    'data-card-style': d.cardStyle, 'data-shadows': d.shadows,
  };
}

// The CSS for the chosen colors, fonts and shapes. Empty for the default design.
// Pages mark themselves with <html data-site="hub|np|info">.
export function css(design) {
  const c = changes(design);
  const d = normalize(design);
  const out = [];
  const light = [];
  const dark = [];
  if (c.accentLight) light.push(`--accent:${d.accentLight}`, `--accent-hi:${lighter(d.accentLight)}`, `--focus:${d.accentLight}`);
  if (c.pageLight) light.push(`--page:${d.pageLight}`);
  if (c.accentDark) dark.push(`--accent:${d.accentDark}`, `--accent-hi:${lighter(d.accentDark)}`, `--focus:${d.accentDark}`);
  if (c.pageDark) dark.push(`--page:${d.pageDark}`);
  if (c.headingFont) light.push(`--display:${FONTS[d.headingFont]}`), dark.push(`--display:${FONTS[d.headingFont]}`);
  if (light.length) {
    out.push(`@media not (prefers-color-scheme: dark){:root:not([data-theme="dark"]):not([data-theme="contrast"]){${light.join(';')}}}`);
    out.push(`:root[data-theme="light"]{${light.join(';')}}`);
  }
  if (dark.length) {
    out.push(`@media (prefers-color-scheme: dark){:root:not([data-theme="light"]):not([data-theme="contrast"]){${dark.join(';')}}}`);
    out.push(`:root[data-theme="dark"]{${dark.join(';')}}`);
  }
  if (c.headingFont) out.push(`[data-site="info"] h1,[data-site="info"] h2,[data-site="info"] .brand{font-family:var(--display)}`);
  if (c.textSize) out.push(Object.entries(BASE_SIZE).map(([site, px]) => `[data-site="${site}"] body{font-size:${Math.round(px * SIZE[d.textSize] * 10) / 10}px}`).join(''));
  if (c.corners) out.push(`:root{--radius:${RADIUS[d.corners]}}[data-site="info"] .btn,[data-site="info"] .card,[data-site="info"] .panel{border-radius:${RADIUS[d.corners]}}`);
  if (c.width) out.push(`[data-site="hub"] .wrap{width:min(${WIDTH[d.width]},100% - 40px)}[data-site="info"] main{max-width:${WIDTH[d.width]}}`);
  return out.join('\n');
}

// The words on the pages, by key (elements marked data-design-text="key").
export const texts = (design) => {
  const d = normalize(design);
  return Object.fromEntries(OPTIONS.filter((o) => o.type !== 'select').map((o) => [o.key, d[o.key]]));
};
export const optionFor = (key) => BY_KEY[key];
