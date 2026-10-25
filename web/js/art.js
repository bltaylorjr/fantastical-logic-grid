// Built-in theme art: a scene for each story (drawn in layers that appear as the
// player finishes sections) and a portrait for each character.
//
// Everything is generated SVG, so it works offline and costs nothing. To use
// AI-generated art later, replace sceneSvg/portraitSvg with functions that
// return an <img> for a generated image URL; callers only insert the markup.

function rngFrom(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

// Palette per theme: sky top, sky bottom, ground, silhouette, highlight, accent.
export const THEME_LOOKS = {
  mystery: { sky: ['#1c2140', '#45406b'], ground: '#1a1a26', shape: '#0d0f1c', glow: '#f5d77a', accent: '#a23b3b' },
  action: { sky: ['#31122a', '#e0663a'], ground: '#21141c', shape: '#170d14', glow: '#ffd166', accent: '#e63946' },
  adventure: { sky: ['#1f5f6b', '#f2b766'], ground: '#2f4a2a', shape: '#1d3320', glow: '#fff1c1', accent: '#c4622d' },
  holiday: { sky: ['#14284b', '#3b5d8f'], ground: '#e8eef7', shape: '#20365c', glow: '#ffe28a', accent: '#c0392b' },
  occasion: { sky: ['#5b2a86', '#f08a9b'], ground: '#3c1f5a', shape: '#2a1442', glow: '#ffe066', accent: '#2ec4b6' },
  fantasy: { sky: ['#1b1446', '#6a3e8f'], ground: '#1d2a3a', shape: '#120d2e', glow: '#c9f0ff', accent: '#7bd389' },
  scifi: { sky: ['#03061a', '#1b2a5c'], ground: '#10142e', shape: '#070a1c', glow: '#7df9ff', accent: '#ff5c8a' },
  sports: { sky: ['#0f2a4a', '#2f6db0'], ground: '#2f7a3a', shape: '#0c1f36', glow: '#ffffff', accent: '#ffb703' },
  cooking: { sky: ['#f6e3c5', '#e9c99a'], ground: '#8b5a3c', shape: '#5b3a28', glow: '#fff7e6', accent: '#d1495b' },
  pets: { sky: ['#8fd3f4', '#d4f1c5'], ground: '#5aa04a', shape: '#3d7a35', glow: '#fffbe0', accent: '#f4845f' },
};
const lookFor = (themeId) => THEME_LOOKS[themeId] || THEME_LOOKS.mystery;

// ---------------------------------------------------------------------------
// Scenes: 800 x 260, a base layer plus five detail layers (data-layer 1..5).
// ---------------------------------------------------------------------------
const W = 800, H = 260;

function stars(r, n, color, maxY = 150) {
  let s = '';
  for (let i = 0; i < n; i++) s += `<circle cx="${(r() * W).toFixed(0)}" cy="${(r() * maxY).toFixed(0)}" r="${(0.6 + r() * 1.4).toFixed(1)}" fill="${color}" opacity="${(0.4 + r() * 0.6).toFixed(2)}"/>`;
  return s;
}
function windows(r, x, y, w, h, cols, rows, lit, glow, dark) {
  let s = '';
  const gw = w / cols, gh = h / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    s += `<rect x="${(x + i * gw + gw * 0.25).toFixed(1)}" y="${(y + j * gh + gh * 0.2).toFixed(1)}" width="${(gw * 0.5).toFixed(1)}" height="${(gh * 0.55).toFixed(1)}" fill="${r() < lit ? glow : dark}"/>`;
  }
  return s;
}
function hills(r, color, base, amp, seg = 8) {
  let d = `M0 ${H} L0 ${base}`;
  for (let i = 1; i <= seg; i++) {
    const x = (W / seg) * i, cx = x - W / seg / 2;
    d += ` Q${cx.toFixed(0)} ${(base - amp * (0.4 + r() * 0.8)).toFixed(0)} ${x.toFixed(0)} ${(base - amp * r() * 0.3).toFixed(0)}`;
  }
  return `<path d="${d} L${W} ${H} Z" fill="${color}"/>`;
}
function skyline(r, color, base, minH, maxH) {
  let s = '', x = 0;
  while (x < W) {
    const w = 30 + r() * 60, h = minH + r() * (maxH - minH);
    s += `<rect x="${x.toFixed(0)}" y="${(base - h).toFixed(0)}" width="${(w + 1).toFixed(0)}" height="${h.toFixed(0)}" fill="${color}"/>`;
    x += w;
  }
  return s;
}
function tree(x, base, h, color) {
  return `<path d="M${x} ${base - h} L${x - h * 0.32} ${base - h * 0.35} L${x - h * 0.12} ${base - h * 0.35} L${x - h * 0.4} ${base} L${x + h * 0.4} ${base} L${x + h * 0.12} ${base - h * 0.35} L${x + h * 0.32} ${base - h * 0.35} Z" fill="${color}"/>`;
}

const SCENES = {
  mystery(r, L) {
    return [
      `<circle cx="660" cy="62" r="34" fill="${L.glow}" opacity=".9"/><circle cx="676" cy="54" r="30" fill="${L.sky[0]}" opacity=".85"/>${stars(r, 40, '#fff', 120)}`,
      `${hills(r, '#26243d', 205, 50)}`,
      `<path d="M250 200 L250 110 L300 70 L350 110 L350 200 Z M350 200 L350 120 L470 120 L470 200 Z M470 200 L470 95 L520 60 L570 95 L570 200 Z" fill="${L.shape}"/><rect x="400" y="80" width="14" height="40" fill="${L.shape}"/>`,
      `${windows(r, 260, 112, 80, 80, 2, 2, 0.6, L.glow, '#20203a')}${windows(r, 360, 128, 100, 60, 4, 2, 0.5, L.glow, '#20203a')}${windows(r, 480, 100, 80, 90, 2, 3, 0.5, L.glow, '#20203a')}`,
      `<path d="M0 ${H} L0 225 Q200 210 400 228 T800 222 L800 ${H} Z" fill="${L.ground}"/><g fill="${L.shape}">${tree(120, 230, 90, L.shape)}${tree(180, 232, 70, L.shape)}${tree(700, 230, 100, L.shape)}</g>`,
      `<g opacity=".55" fill="#c8c8e0"><ellipse cx="200" cy="215" rx="160" ry="10"/><ellipse cx="620" cy="220" rx="190" ry="9"/></g><path d="M535 196 l8 -4 l8 4 l-8 4z" fill="${L.accent}"/>`,
    ];
  },
  action(r, L) {
    return [
      `<circle cx="400" cy="210" r="80" fill="${L.glow}" opacity=".85"/>`,
      skyline(r, '#4a1d33', 220, 40, 110),
      skyline(r, L.shape, 235, 60, 160),
      `${windows(r, 40, 120, 720, 100, 24, 4, 0.18, L.glow, 'transparent')}`,
      `<rect x="0" y="232" width="${W}" height="28" fill="${L.ground}"/><rect x="0" y="244" width="${W}" height="3" fill="${L.glow}" opacity=".5"/>`,
      `<path d="M560 70 l60 -8 l10 6 l-60 10z" fill="${L.shape}"/><circle cx="600" cy="62" r="3" fill="${L.accent}"/><path d="M590 64 l-40 -30 M610 62 l40 -28" stroke="${L.shape}" stroke-width="2"/>`,
    ];
  },
  adventure(r, L) {
    return [
      `<circle cx="600" cy="80" r="40" fill="${L.glow}" opacity=".9"/>`,
      hills(r, '#3f6f78', 160, 90, 5),
      hills(r, '#2f5a3a', 200, 60, 7),
      `<g>${[60, 140, 230, 520, 610, 720].map((x) => `<rect x="${x - 3}" y="150" width="6" height="70" fill="${L.shape}"/><path d="M${x} 150 q-30 -5 -40 12 M${x} 150 q30 -5 40 12 M${x} 150 q-18 -20 -36 -16 M${x} 150 q18 -20 36 -16" stroke="${L.shape}" stroke-width="6" fill="none" stroke-linecap="round"/>`).join('')}</g>`,
      `<path d="M0 ${H} L0 228 Q400 205 ${W} 230 L${W} ${H} Z" fill="${L.ground}"/><path d="M330 228 L400 150 L470 228 Z" fill="#b98a4e"/><path d="M370 228 L400 192 L430 228 Z" fill="#3a2a1a"/>`,
      `<path d="M120 236 q60 -10 120 0 t120 0" stroke="${L.accent}" stroke-width="3" fill="none" stroke-dasharray="8 6"/><text x="372" y="140" font-size="22" fill="${L.accent}" font-family="serif">✕</text>`,
    ];
  },
  holiday(r, L) {
    return [
      `${stars(r, 30, '#fff', 110)}<circle cx="120" cy="60" r="24" fill="${L.glow}" opacity=".8"/>`,
      hills(r, '#c9d6e8', 210, 40),
      `<g fill="${L.shape}"><path d="M200 210 L200 160 L240 130 L280 160 L280 210 Z"/><path d="M480 210 L480 150 L530 115 L580 150 L580 210 Z"/></g>${windows(r, 205, 165, 70, 40, 2, 1, 0.9, L.glow, '#203050')}${windows(r, 486, 158, 90, 46, 3, 1, 0.9, L.glow, '#203050')}`,
      `${tree(380, 220, 110, '#1f6b46')}${tree(660, 222, 80, '#1f6b46')}<path d="M380 108 l4 9 10 1 -8 6 3 10 -9 -6 -9 6 3 -10 -8 -6 10 -1z" fill="${L.glow}"/>`,
      `<rect x="0" y="220" width="${W}" height="40" fill="${L.ground}"/><g fill="${L.accent}"><rect x="350" y="206" width="22" height="16"/><rect x="392" y="208" width="18" height="14" fill="#2e7d32"/></g>`,
      `<g fill="#fff">${stars(r, 60, '#fff', 220)}</g>`,
    ];
  },
  occasion(r, L) {
    const balloon = (x, y, c) => `<ellipse cx="${x}" cy="${y}" rx="18" ry="23" fill="${c}"/><path d="M${x} ${y + 23} q6 30 -4 60" stroke="#fff" stroke-width="1.2" fill="none" opacity=".7"/>`;
    return [
      `${stars(r, 20, L.glow, 140)}`,
      `<path d="M0 30 Q200 70 400 30 T800 30" stroke="#fff" stroke-width="2" fill="none" opacity=".7"/>${Array.from({ length: 12 }, (_, i) => `<path d="M${30 + i * 66} ${36 + Math.sin(i) * 6} l14 26 l14 -26z" fill="${['#ffd166', '#2ec4b6', '#ef476f'][i % 3]}"/>`).join('')}`,
      `<rect x="0" y="200" width="${W}" height="60" fill="${L.ground}"/><rect x="250" y="170" width="300" height="12" fill="#f4e1ff"/><rect x="290" y="182" width="8" height="40" fill="#f4e1ff"/><rect x="502" y="182" width="8" height="40" fill="#f4e1ff"/>`,
      `<rect x="355" y="130" width="90" height="40" rx="4" fill="#fff"/><rect x="370" y="100" width="60" height="30" rx="4" fill="#ffd6e7"/>${[380, 400, 420].map((x) => `<rect x="${x - 2}" y="86" width="4" height="14" fill="#fff"/><ellipse cx="${x}" cy="82" rx="3" ry="5" fill="${L.glow}"/>`).join('')}`,
      `${balloon(120, 110, '#ef476f')}${balloon(170, 95, '#ffd166')}${balloon(640, 100, '#2ec4b6')}${balloon(690, 118, '#ef476f')}`,
      `${Array.from({ length: 40 }, () => `<rect x="${(r() * W).toFixed(0)}" y="${(r() * 200).toFixed(0)}" width="5" height="9" fill="${pick(r, ['#ffd166', '#2ec4b6', '#ef476f', '#fff'])}" transform="rotate(${(r() * 90).toFixed(0)})" transform-origin="center"/>`).join('')}`,
    ];
  },
  fantasy(r, L) {
    return [
      `${stars(r, 70, '#fff', 160)}<circle cx="150" cy="70" r="30" fill="${L.glow}" opacity=".8"/>`,
      hills(r, '#2a2458', 190, 80, 5),
      `<g fill="${L.shape}"><rect x="420" y="110" width="160" height="110"/><rect x="400" y="70" width="40" height="150"/><rect x="560" y="60" width="40" height="160"/><path d="M395 70 L420 25 L445 70Z M555 60 L580 15 L605 60Z"/><rect x="480" y="85" width="40" height="40"/><path d="M475 85 L500 45 L525 85Z"/></g>`,
      `${windows(r, 405, 90, 30, 100, 1, 3, 0.8, L.glow, '#1d1a40')}${windows(r, 565, 80, 30, 110, 1, 3, 0.8, L.glow, '#1d1a40')}<path d="M480 220 v-30 a20 20 0 0 1 40 0 v30z" fill="#2a1d10"/>`,
      `<path d="M0 ${H} L0 225 Q400 205 ${W} 228 L${W} ${H} Z" fill="${L.ground}"/>${tree(120, 228, 80, '#16233a')}${tree(720, 230, 90, '#16233a')}`,
      `<path d="M220 110 q20 -20 40 0 q-20 10 -40 0z M230 100 l-30 -14 M250 100 l30 -14" stroke="${L.accent}" stroke-width="3" fill="${L.accent}"/>${Array.from({ length: 14 }, () => `<circle cx="${(r() * W).toFixed(0)}" cy="${(120 + r() * 100).toFixed(0)}" r="2" fill="${L.accent}"/>`).join('')}`,
    ];
  },
  scifi(r, L) {
    return [
      `${stars(r, 120, '#fff', 260)}`,
      `<circle cx="640" cy="80" r="56" fill="#3b4c9b"/><ellipse cx="640" cy="80" rx="96" ry="14" fill="none" stroke="${L.glow}" stroke-width="3" opacity=".7"/>`,
      `<circle cx="140" cy="300" r="190" fill="${L.ground}"/>`,
      `<g fill="${L.shape}" stroke="${L.glow}" stroke-width="1.5"><rect x="300" y="100" width="200" height="40" rx="20"/><rect x="390" y="60" width="20" height="120"/><rect x="250" y="112" width="50" height="16"/><rect x="500" y="112" width="50" height="16"/></g>`,
      `${windows(r, 312, 108, 176, 24, 8, 1, 0.8, L.glow, '#16204a')}<circle cx="400" cy="60" r="8" fill="${L.accent}"/>`,
      `<path d="M700 200 l70 -20" stroke="${L.accent}" stroke-width="3" stroke-linecap="round"/><path d="M80 40 l40 12" stroke="${L.glow}" stroke-width="2" stroke-linecap="round" opacity=".8"/>`,
    ];
  },
  sports(r, L) {
    return [
      `${stars(r, 20, '#fff', 80)}`,
      `<path d="M0 150 L120 90 L680 90 L800 150 L800 180 L0 180Z" fill="${L.shape}"/>${windows(r, 130, 96, 540, 50, 30, 3, 0.7, '#c9d7ea', '#20385c')}`,
      `<rect x="0" y="175" width="${W}" height="85" fill="${L.ground}"/>${Array.from({ length: 8 }, (_, i) => `<rect x="${i * 100}" y="175" width="50" height="85" fill="#2a6d34"/>`).join('')}`,
      `<path d="M400 175 v85 M0 218 h800" stroke="#fff" stroke-width="2" opacity=".8"/><circle cx="400" cy="218" r="26" fill="none" stroke="#fff" stroke-width="2" opacity=".8"/>`,
      `${[60, 740].map((x) => `<rect x="${x - 3}" y="20" width="6" height="160" fill="#9aa5b1"/><rect x="${x - 24}" y="14" width="48" height="16" fill="${L.glow}"/><path d="M${x} 30 L${x - 140} 175 L${x + 140} 175Z" fill="${L.glow}" opacity=".08"/>`).join('')}`,
      `<circle cx="470" cy="228" r="9" fill="#fff"/><path d="M466 222 l8 0 l3 6 l-7 5 l-7 -5z" fill="#222"/><text x="380" y="70" font-size="26" fill="${L.accent}" font-weight="700" font-family="sans-serif">★ ★ ★</text>`,
    ];
  },
  cooking(r, L) {
    return [
      `<g opacity=".35">${Array.from({ length: 10 }, (_, i) => `<rect x="${i * 80}" y="0" width="78" height="150" fill="#fff"/>`).join('')}</g>`,
      `<rect x="80" y="30" width="180" height="90" fill="#cfe7f5" stroke="#8b5a3c" stroke-width="6"/><path d="M170 30 v90 M80 75 h180" stroke="#8b5a3c" stroke-width="4"/>`,
      `<rect x="0" y="150" width="${W}" height="110" fill="${L.ground}"/><rect x="0" y="146" width="${W}" height="10" fill="#c48b5e"/>`,
      `<g fill="${L.shape}"><rect x="360" y="110" width="90" height="40" rx="6"/><rect x="450" y="122" width="40" height="6"/><rect x="560" y="100" width="70" height="50" rx="8"/><rect x="580" y="90" width="30" height="10" rx="3"/></g>`,
      `<g fill="none" stroke="#fff" stroke-width="3" opacity=".7" stroke-linecap="round"><path d="M385 100 q-8 -14 0 -26 q8 -12 0 -24"/><path d="M415 100 q-8 -14 0 -26 q8 -12 0 -24"/><path d="M595 82 q-8 -14 0 -26"/></g>`,
      `<circle cx="700" cy="130" r="18" fill="${L.accent}"/><circle cx="725" cy="135" r="14" fill="#f2c14e"/><circle cx="300" cy="134" r="12" fill="#6bab5a"/><rect x="250" y="138" width="40" height="8" rx="4" fill="#f2e2c4"/>`,
    ];
  },
  pets(r, L) {
    return [
      `<circle cx="680" cy="60" r="34" fill="#fff6b0"/><g fill="#fff" opacity=".9"><ellipse cx="150" cy="60" rx="50" ry="16"/><ellipse cx="180" cy="50" rx="34" ry="16"/><ellipse cx="450" cy="40" rx="44" ry="12"/></g>`,
      hills(r, '#86c96a', 200, 50),
      `<rect x="0" y="210" width="${W}" height="50" fill="${L.ground}"/>${Array.from({ length: 20 }, (_, i) => `<rect x="${i * 40 + 10}" y="190" width="8" height="34" fill="#f5f0e1"/>`).join('')}<rect x="0" y="198" width="${W}" height="6" fill="#f5f0e1"/>`,
      `<g fill="${L.shape}"><rect x="96" y="120" width="14" height="94"/><circle cx="103" cy="110" r="44"/><rect x="686" y="130" width="12" height="84"/><circle cx="692" cy="120" r="36"/></g>`,
      `<path d="M330 220 L330 170 L380 140 L430 170 L430 220Z" fill="${L.accent}"/><path d="M362 220 v-26 a18 18 0 0 1 36 0 v26z" fill="#3a2a1a"/><text x="356" y="166" font-size="16" fill="#fff" font-family="sans-serif">PETS</text>`,
      `<g fill="#6b4b2e"><ellipse cx="520" cy="226" rx="20" ry="10"/><circle cx="540" cy="216" r="9"/><path d="M536 208 l-4 -8 l8 4z M546 208 l4 -8 l-8 4z"/></g><circle cx="600" cy="232" r="6" fill="#e63946"/>`,
    ];
  },
};

// The scene for a puzzle. `revealed` (0..5) is how many detail layers show.
export function sceneSvg(puzzle, revealed = 5, { animate = true } = {}) {
  const themeId = puzzle.theme.id;
  const L = lookFor(themeId);
  const r = rngFrom(puzzle.story && puzzle.story.id ? puzzle.story.id : puzzle.title);
  const draw = SCENES[themeId] || SCENES.mystery;
  const [base, ...layers] = draw(r, L);
  const id = `sky-${Math.floor(r() * 1e9)}`;
  return `<svg class="scene-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.sky[0]}"/><stop offset="1" stop-color="${L.sky[1]}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#${id})"/>
    <g data-layer="0">${base}</g>
    ${layers.map((g, i) => `<g data-layer="${i + 1}" class="layer${i < revealed ? ' on' : ''}${animate ? '' : ' still'}">${g}</g>`).join('')}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Portraits: a friendly face for each character, styled by theme.
// ---------------------------------------------------------------------------
const SKIN = ['#f6d3b3', '#e8b48f', '#c98e66', '#a36a43', '#7a4b2d', '#5a3520'];
const HAIR = ['#2b1d14', '#5a3a22', '#8b5a2b', '#c99a4b', '#e4c27a', '#9a9a9a', '#b5432f', '#1d1d1d'];
const BG = ['#d9e6f7', '#f7e1d7', '#e3f2df', '#efe3f7', '#fff1c9', '#dff3f2'];
const FUR = ['#c58b52', '#8a5a33', '#f2e2c4', '#3b3b3b', '#d9a066', '#ffffff', '#9a9a9a'];

function hat(themeId, r, L) {
  switch (themeId) {
    case 'mystery': return pick(r, [
      `<path d="M22 34 h56 v-4 h-8 l-4 -16 h-32 l-4 16 h-8z" fill="#2b2b33"/><rect x="30" y="26" width="40" height="4" fill="${L.accent}"/>`,
      `<circle cx="61" cy="47" r="7" fill="none" stroke="#c9a227" stroke-width="2"/><path d="M68 49 l6 10" stroke="#c9a227" stroke-width="1.5"/>`,
      '']);
    case 'action': return pick(r, [`<rect x="26" y="44" width="48" height="8" rx="3" fill="#111"/>`, `<path d="M24 30 q26 -12 52 0 v6 h-52z" fill="${L.accent}"/>`, '']);
    case 'adventure': return `<path d="M16 34 q34 -6 68 0 l-6 -4 q-6 -16 -28 -16 q-22 0 -28 16z" fill="#b98a4e"/><rect x="28" y="27" width="44" height="4" fill="#5a3a22"/>`;
    case 'holiday': return pick(r, [`<path d="M26 32 q24 -30 52 -6 l-4 8z" fill="#c0392b"/><circle cx="80" cy="24" r="5" fill="#fff"/><rect x="24" y="30" width="54" height="7" rx="3" fill="#fff"/>`, `<path d="M28 74 h44 v6 h-44z" fill="#c0392b"/><path d="M60 80 v12 h8 v-12z" fill="#c0392b"/>`]);
    case 'occasion': return `<path d="M38 30 L50 2 L62 30z" fill="${pick(r, ['#ef476f', '#2ec4b6', '#ffd166'])}"/><circle cx="50" cy="3" r="4" fill="#fff"/>`;
    case 'fantasy': return pick(r, [`<path d="M24 34 L50 -2 L76 34z" fill="#4b3a8f"/><path d="M20 34 h60 v4 h-60z" fill="#4b3a8f"/><text x="44" y="24" font-size="10" fill="#ffe28a">★</text>`, `<path d="M30 30 l6 -12 l7 8 l7 -12 l7 12 l7 -8 l6 12z" fill="#e9c46a"/>`]);
    case 'scifi': return `<rect x="26" y="40" width="48" height="12" rx="6" fill="${L.glow}" opacity=".85"/><rect x="22" y="38" width="4" height="16" fill="#555"/><rect x="74" y="38" width="4" height="16" fill="#555"/>`;
    case 'sports': return pick(r, [`<rect x="26" y="30" width="48" height="7" fill="${L.accent}"/>`, `<path d="M26 34 q24 -22 48 0z" fill="#1d4e89"/><path d="M70 34 h14 v4 h-14z" fill="#1d4e89"/>`]);
    case 'cooking': return `<path d="M30 30 h40 v-6 q8 -10 -2 -16 q-4 -10 -16 -6 q-12 -4 -16 6 q-10 6 -2 16z" fill="#fff" stroke="#ddd"/>`;
    default: return '';
  }
}

function animalFace(r, name) {
  const fur = pick(r, FUR), inner = '#f4c9c0';
  const cat = r() < 0.5;
  const ears = cat
    ? `<path d="M24 34 L30 8 L46 26z M76 34 L70 8 L54 26z" fill="${fur}"/><path d="M29 28 L32 14 L41 25z M71 28 L68 14 L59 25z" fill="${inner}"/>`
    : `<ellipse cx="24" cy="44" rx="10" ry="20" fill="${pick(r, FUR)}" transform="rotate(20 24 44)"/><ellipse cx="76" cy="44" rx="10" ry="20" fill="${pick(r, FUR)}" transform="rotate(-20 76 44)"/>`;
  return `${ears}<ellipse cx="50" cy="52" rx="28" ry="26" fill="${fur}"/><ellipse cx="50" cy="62" rx="14" ry="10" fill="#fff" opacity=".7"/>
    <circle cx="40" cy="48" r="4" fill="#1d1d1d"/><circle cx="60" cy="48" r="4" fill="#1d1d1d"/><circle cx="41" cy="47" r="1.3" fill="#fff"/><circle cx="61" cy="47" r="1.3" fill="#fff"/>
    <path d="M46 58 h8 l-4 4z" fill="#3a2a2a"/><path d="M50 62 q-4 5 -8 3 M50 62 q4 5 8 3" stroke="#3a2a2a" stroke-width="1.5" fill="none"/>
    ${cat ? '<path d="M30 60 h-12 M30 64 h-12 M70 60 h12 M70 64 h12" stroke="#3a2a2a" stroke-width="1"/>' : ''}`;
}

export function portraitSvg(puzzle, name, { size = 72 } = {}) {
  const themeId = puzzle.theme.id;
  const L = lookFor(themeId);
  const r = rngFrom(`${themeId}:${name}`);
  const bg = pick(r, BG);
  const isPet = themeId === 'pets' && /pet|animal|dog|cat/i.test(`${puzzle.cast && puzzle.cast.many}`);
  let face;
  if (isPet) face = animalFace(r, name);
  else {
    const skin = pick(r, SKIN), hair = pick(r, HAIR);
    const style = Math.floor(r() * 5);
    const hairBack = style === 2 ? `<path d="M22 50 q0 -34 28 -34 q28 0 28 34 v30 h-56z" fill="${hair}"/>` : style === 4 ? `<circle cx="50" cy="20" r="10" fill="${hair}"/>` : '';
    const hairTop = [
      `<path d="M26 44 q2 -26 24 -26 q24 0 24 26 q-10 -12 -24 -12 q-14 0 -24 12z" fill="${hair}"/>`,
      `<path d="M26 40 q4 -22 24 -22 q22 0 24 22 l-6 -6 l-6 6 l-6 -8 l-6 8 l-6 -8 l-6 8z" fill="${hair}"/>`,
      `<path d="M24 46 q0 -28 26 -28 q26 0 26 28 q-6 -14 -26 -16 q-20 2 -26 16z" fill="${hair}"/>`,
      `<path d="M30 30 q20 -14 40 0 q-20 -4 -40 0z" fill="${hair}"/>`,
      `<path d="M26 42 q2 -24 24 -24 q24 0 24 24 q-24 -14 -48 0z" fill="${hair}"/>`,
    ][style];
    const mouth = pick(r, ['<path d="M42 64 q8 7 16 0" stroke="#5a2e2e" stroke-width="2.4" fill="none" stroke-linecap="round"/>', '<path d="M43 65 h14" stroke="#5a2e2e" stroke-width="2.4" stroke-linecap="round"/>', '<ellipse cx="50" cy="65" rx="5" ry="3.5" fill="#5a2e2e"/>']);
    const brows = r() < 0.5 ? `<path d="M36 41 l8 -2 M56 39 l8 2" stroke="${hair}" stroke-width="2.4" stroke-linecap="round"/>` : `<path d="M36 40 h8 M56 40 h8" stroke="${hair}" stroke-width="2.4" stroke-linecap="round"/>`;
    face = `${hairBack}<rect x="42" y="72" width="16" height="12" fill="${skin}"/><path d="M18 100 q4 -20 32 -20 q28 0 32 20z" fill="${pick(r, ['#2f4858', '#86bbd8', '#9e2a2b', '#33658a', '#f6ae2d', '#55828b', '#6a4c93'])}"/>
      <ellipse cx="50" cy="52" rx="24" ry="27" fill="${skin}"/>${hairTop}
      <circle cx="41" cy="50" r="3" fill="#1d1d1d"/><circle cx="59" cy="50" r="3" fill="#1d1d1d"/>${brows}
      <path d="M50 52 q-3 7 0 9" stroke="#00000040" stroke-width="1.6" fill="none"/>${mouth}
      <circle cx="35" cy="60" r="4" fill="#ff8a8a" opacity=".25"/><circle cx="65" cy="60" r="4" fill="#ff8a8a" opacity=".25"/>${hat(themeId, r, L)}`;
  }
  return `<svg class="portrait-svg" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><circle cx="50" cy="50" r="50" fill="${bg}"/><clipPath id="pc-${size}-${name.replace(/\W/g, '')}"><circle cx="50" cy="50" r="50"/></clipPath><g clip-path="url(#pc-${size}-${name.replace(/\W/g, '')})">${face}</g></svg>`;
}
