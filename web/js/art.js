// Built-in theme art: a scene for each story (drawn in layers that appear as the
// player finishes sections) and a portrait for each character.
//
// Everything is generated SVG, so it works offline and costs nothing. To use
// AI-generated art later, replace sceneSvg/portraitSvg with functions that
// return an <img> for a generated image URL; callers only insert the markup.

import { genderOf } from './gender.js';

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
  town: { sky: ['#9fd3f2', '#e8f4fb'], ground: '#5b6470', shape: '#8a5a44', glow: '#fff3b0', accent: '#d1495b' },
  parks: { sky: ['#6fb3e0', '#d8eef5'], ground: '#3f6b3a', shape: '#24452a', glow: '#fff4c2', accent: '#c4622d' },
  travel: { sky: ['#4cc3e8', '#fde6b8'], ground: '#f1d9a7', shape: '#2f8f4e', glow: '#fff1a8', accent: '#e63946' },
  wonders: { sky: ['#2b2350', '#e8916b'], ground: '#2a2340', shape: '#1a1530', glow: '#ffe3a3', accent: '#c9a227' },
  music: { sky: ['#1a1038', '#5b2a86'], ground: '#1c1430', shape: '#0f0a20', glow: '#ffe066', accent: '#ef476f' },
  nautical: { sky: ['#5fb4e6', '#e3f3fb'], ground: '#e9d8a6', shape: '#1d3557', glow: '#fff4c2', accent: '#e63946' },
  farm: { sky: ['#7cc6ee', '#fbe7b5'], ground: '#6a9a3a', shape: '#b23a2e', glow: '#fff3b0', accent: '#f2c14e' },
  science: { sky: ['#dfeaf7', '#f5f8fc'], ground: '#9aa7b8', shape: '#2f4a6b', glow: '#7df9c0', accent: '#2563eb' },
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
  town(r, L) {
    const awning = (x, w, c) => `<path d="M${x} 150 h${w} l-6 16 h-${w - 12}z" fill="${c}"/>${Array.from({ length: Math.floor(w / 16) }, (_, i) => `<rect x="${x + 4 + i * 16}" y="150" width="8" height="16" fill="#fff" opacity=".55"/>`).join('')}`;
    return [
      `<circle cx="110" cy="62" r="30" fill="${L.glow}"/><g fill="#fff" opacity=".85"><ellipse cx="520" cy="54" rx="56" ry="14"/><ellipse cx="560" cy="44" rx="34" ry="14"/><ellipse cx="300" cy="70" rx="40" ry="10"/></g>`,
      skyline(r, '#c7d3e3', 200, 30, 70),
      `<g fill="${L.shape}"><rect x="60" y="120" width="120" height="96"/><rect x="200" y="132" width="110" height="84"/><path d="M340 216 V120 l50 -30 l50 30 V216z"/><rect x="383" y="40" width="14" height="52"/><path d="M378 44 L390 14 L402 44z"/><rect x="470" y="128" width="130" height="88"/><rect x="620" y="112" width="120" height="104"/></g><path d="M384 30 h12 M390 24 v14" stroke="${L.glow}" stroke-width="3"/>`,
      `${windows(r, 66, 128, 108, 24, 4, 1, 0.9, '#fdf6d8', '#30455e')}${windows(r, 476, 134, 118, 20, 5, 1, 0.9, '#fdf6d8', '#30455e')}${windows(r, 626, 120, 108, 30, 4, 1, 0.9, '#fdf6d8', '#30455e')}${awning(66, 108, L.accent)}${awning(206, 98, '#2a9d8f')}${awning(476, 118, '#e9c46a')}<path d="M372 216 v-34 a18 18 0 0 1 36 0 v34z" fill="#5a3a22"/><g fill="#f1ede4">${[636, 668, 700].map((x) => `<rect x="${x}" y="170" width="10" height="46"/>`).join('')}</g><text x="652" y="164" font-size="11" fill="#f1ede4" font-family="sans-serif">LIBRARY</text>`,
      `<rect x="0" y="216" width="${W}" height="44" fill="${L.ground}"/><rect x="0" y="214" width="${W}" height="6" fill="#d9d4c7"/>${Array.from({ length: 10 }, (_, i) => `<rect x="${i * 84 + 20}" y="238" width="40" height="4" fill="#f4e9a3"/>`).join('')}`,
      `${tree(20, 216, 60, '#3d7a35')}${tree(770, 216, 70, '#3d7a35')}<g><rect x="250" y="196" width="34" height="18" rx="4" fill="${L.accent}"/><circle cx="257" cy="216" r="4" fill="#222"/><circle cx="277" cy="216" r="4" fill="#222"/></g><rect x="446" y="176" width="3" height="40" fill="#555"/><circle cx="447" cy="172" r="6" fill="${L.glow}"/>`,
    ];
  },
  parks(r, L) {
    return [
      `<circle cx="640" cy="64" r="32" fill="${L.glow}"/><g fill="#fff" opacity=".8"><ellipse cx="200" cy="50" rx="50" ry="12"/><ellipse cx="420" cy="36" rx="40" ry="10"/></g>`,
      `<path d="M0 200 L120 80 L210 160 L330 50 L470 180 L580 70 L720 170 L800 120 L800 260 L0 260Z" fill="#6f8fa8"/><path d="M120 80 l-26 26 l14 -4 l12 10 l12 -10 l14 4z M330 50 l-34 34 l18 -6 l16 12 l16 -12 l18 6z M580 70 l-30 30 l16 -5 l14 10 l14 -10 l16 5z" fill="#fff"/>`,
      `<path d="M0 ${H} L0 190 Q200 170 400 192 T800 186 L800 ${H} Z" fill="#4e7d4a"/><ellipse cx="560" cy="214" rx="150" ry="16" fill="#7cc4e4"/><path d="M420 214 q70 6 140 0" stroke="#fff" stroke-width="2" opacity=".6" fill="none"/>`,
      `<g>${[40, 90, 150, 690, 740, 780].map((x, i) => tree(x, 226, 70 + (i % 3) * 18, L.shape)).join('')}</g>`,
      `<path d="M0 ${H} L0 236 Q400 222 ${W} 240 L${W} ${H} Z" fill="${L.ground}"/><path d="M250 260 q40 -30 120 -40 t160 -14" stroke="#c9a66b" stroke-width="8" fill="none" stroke-linecap="round"/>`,
      `<g fill="#3b2a1e"><ellipse cx="300" cy="214" rx="26" ry="14"/><ellipse cx="282" cy="206" rx="12" ry="11"/><rect x="288" y="222" width="5" height="12"/><rect x="310" y="222" width="5" height="12"/><path d="M276 198 q-4 -6 -10 -4 M288 198 q4 -6 10 -4" stroke="#3b2a1e" stroke-width="2" fill="none"/></g><path d="M640 120 q10 -8 20 0 q10 -8 20 0" stroke="#2b2b2b" stroke-width="2" fill="none"/><rect x="200" y="196" width="4" height="34" fill="#6b4b2e"/><rect x="186" y="190" width="32" height="14" rx="2" fill="${L.accent}"/>`,
    ];
  },
  travel(r, L) {
    const palm = (x, base, h, flip = 1) => `<path d="M${x} ${base} q${8 * flip} ${-h / 2} ${-6 * flip} ${-h}" stroke="#7a5230" stroke-width="7" fill="none" stroke-linecap="round"/>${[[-40, 6], [-30, -14], [36, 4], [26, -16], [0, -26]].map(([dx, dy]) => `<path d="M${x - 6 * flip} ${base - h} q${dx / 2} ${dy - 14} ${dx} ${dy + 10}" stroke="#2f8f4e" stroke-width="7" fill="none" stroke-linecap="round"/>`).join('')}`;
    return [
      `<circle cx="160" cy="70" r="36" fill="${L.glow}"/><g fill="#fff" opacity=".9"><ellipse cx="480" cy="50" rx="50" ry="13"/><ellipse cx="520" cy="40" rx="30" ry="12"/></g>`,
      `<rect x="0" y="150" width="${W}" height="70" fill="#2bb3c0"/><path d="M0 170 q40 -6 80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0" stroke="#fff" stroke-width="2" opacity=".5" fill="none"/><path d="M560 150 q60 -50 120 0z" fill="#3f8f5a" opacity=".8"/>`,
      `<path d="M0 ${H} L0 214 Q300 196 ${W} 222 L${W} ${H} Z" fill="${L.ground}"/>`,
      `${palm(90, 226, 110)}${palm(720, 230, 120, -1)}`,
      `<g transform="translate(330 60) rotate(-8)"><path d="M0 10 h90 q10 0 10 6 q0 6 -10 6 h-90z" fill="#f5f7fa"/><path d="M40 12 l-20 -26 h12 l26 26z M40 20 l-20 24 h12 l26 -24z M2 12 l-8 -14 h8 l10 14z" fill="${L.accent}"/></g><path d="M80 90 q120 10 250 -16" stroke="#fff" stroke-width="3" stroke-dasharray="6 8" fill="none" opacity=".9"/>`,
      `<rect x="430" y="196" width="46" height="34" rx="6" fill="${L.accent}"/><rect x="444" y="188" width="18" height="8" rx="3" fill="none" stroke="#5a3a22" stroke-width="3"/><path d="M430 210 h46" stroke="#fff" stroke-width="3"/><rect x="500" y="204" width="30" height="26" rx="5" fill="#f4a261"/><ellipse cx="300" cy="234" rx="40" ry="6" fill="#e76f51"/><path d="M300 234 v-46" stroke="#555" stroke-width="3"/><path d="M262 192 q38 -26 76 0z" fill="#ffd166"/>`,
    ];
  },
  wonders(r, L) {
    return [
      `${stars(r, 30, '#fff', 90)}<circle cx="650" cy="70" r="30" fill="${L.glow}" opacity=".9"/>`,
      `<path d="M0 ${H} L0 200 Q400 180 ${W} 205 L${W} ${H} Z" fill="#4a3f6b"/>`,
      `<g fill="${L.shape}"><path d="M120 216 L160 40 L200 216 h-14 L160 100 L134 216z"/><rect x="138" y="140" width="44" height="6"/><path d="M128 190 q32 -26 64 0" stroke="${L.shape}" stroke-width="6" fill="none"/></g>`,
      `<g fill="${L.shape}"><path d="M260 216 L340 130 L420 216z"/><rect x="470" y="150" width="120" height="66"/><path d="M470 150 q60 -70 120 0z"/><rect x="525" y="96" width="10" height="24"/>${[480, 505, 530, 555, 575].map((x) => `<rect x="${x}" y="160" width="8" height="56" fill="${L.sky[1]}" opacity=".35"/>`).join('')}</g>`,
      `<path d="M600 216 q100 -90 200 0" stroke="${L.accent}" stroke-width="6" fill="none"/><path d="M600 216 L800 216" stroke="${L.accent}" stroke-width="5"/>${[630, 660, 690, 720, 750].map((x) => `<path d="M${x} 216 V${216 - Math.round(90 * Math.sin(Math.PI * (x - 600) / 200)) + 4}" stroke="${L.accent}" stroke-width="2"/>`).join('')}`,
      `<rect x="0" y="216" width="${W}" height="44" fill="${L.ground}"/><g fill="${L.glow}" opacity=".9"><circle cx="160" cy="40" r="4"/><circle cx="530" cy="94" r="4"/></g>${Array.from({ length: 12 }, () => `<circle cx="${(r() * W).toFixed(0)}" cy="${(226 + r() * 26).toFixed(0)}" r="2" fill="${L.glow}" opacity=".7"/>`).join('')}`,
    ];
  },
  music(r, L) {
    const note = (x, y, c) => `<ellipse cx="${x}" cy="${y}" rx="7" ry="5" fill="${c}" transform="rotate(-20 ${x} ${y})"/><path d="M${x + 6} ${y - 2} v-26 q8 4 10 12" stroke="${c}" stroke-width="2.5" fill="none"/>`;
    return [
      `${stars(r, 40, '#fff', 120)}`,
      `<g fill="${L.glow}" opacity=".12">${[160, 400, 640].map((x) => `<path d="M${x} 20 L${x - 90} 200 L${x + 90} 200Z"/>`).join('')}</g>`,
      `<path d="M150 200 V90 q250 -70 500 0 V200z" fill="${L.shape}"/><rect x="170" y="110" width="460" height="90" fill="#2a1f4a"/><rect x="140" y="196" width="520" height="14" fill="#3a2d5c"/>`,
      `<g fill="#111"><rect x="180" y="140" width="34" height="58" rx="3"/><rect x="586" y="140" width="34" height="58" rx="3"/></g><g fill="#444">${[157, 177].map((y) => `<circle cx="197" cy="${y}" r="9"/><circle cx="603" cy="${y}" r="9"/>`).join('')}</g><circle cx="330" cy="176" r="20" fill="${L.accent}" stroke="#ddd" stroke-width="3"/><rect x="292" y="166" width="20" height="12" rx="2" fill="${L.accent}"/><path d="M352 150 h26 M365 150 v46" stroke="#ccc" stroke-width="3"/><rect x="458" y="150" width="3" height="46" fill="#bbb"/><circle cx="459" cy="148" r="5" fill="#bbb"/>`,
      `<rect x="0" y="210" width="${W}" height="50" fill="${L.ground}"/>${Array.from({ length: 26 }, (_, i) => `<circle cx="${i * 31 + 10 + Math.round(r() * 8)}" cy="${(226 + r() * 10).toFixed(0)}" r="10" fill="#0b0716"/>`).join('')}${[60, 230, 520, 700].map((x) => `<path d="M${x} 222 l-6 -22 M${x + 14} 222 l6 -22" stroke="#0b0716" stroke-width="4" stroke-linecap="round"/>`).join('')}`,
      `${note(90, 80, L.glow)}${note(700, 64, L.accent)}${note(260, 50, '#7bdff2')}${note(560, 40, L.glow)}<g fill="${L.glow}">${[200, 300, 400, 500, 600].map((x) => `<circle cx="${x}" cy="96" r="4"/>`).join('')}</g>`,
    ];
  },
  nautical(r, L) {
    const sail = (x, base, h, c) => `<path d="M${x - 30} ${base} q30 12 60 0 l-6 10 h-48z" fill="${L.shape}"/><path d="M${x} ${base - 2} V${base - h}" stroke="#5a3a22" stroke-width="3"/><path d="M${x + 2} ${base - h} L${x + 2} ${base - 6} L${x + 34} ${base - 6}Z" fill="#fff"/><path d="M${x - 2} ${base - h + 14} L${x - 2} ${base - 6} L${x - 26} ${base - 6}Z" fill="${c}"/><path d="M${x} ${base - h} l12 4 l-12 4z" fill="${L.accent}"/>`;
    return [
      `<circle cx="560" cy="48" r="26" fill="${L.glow}"/><g fill="#fff" opacity=".9"><ellipse cx="180" cy="50" rx="54" ry="13"/><ellipse cx="220" cy="40" rx="32" ry="12"/><ellipse cx="460" cy="70" rx="40" ry="10"/></g>`,
      `<rect x="0" y="140" width="${W}" height="120" fill="#2a7fb8"/>${Array.from({ length: 6 }, (_, j) => `<path d="M0 ${156 + j * 18} ${Array.from({ length: 20 }, () => 'q20 -6 40 0').join(' ')}" stroke="#fff" stroke-width="1.5" opacity="${(0.5 - j * 0.06).toFixed(2)}" fill="none"/>`).join('')}`,
      `<path d="M700 160 L700 140 Q740 120 800 130 L800 160Z" fill="#6b7d5a"/><g><path d="M736 132 L742 60 h12 L760 132z" fill="#fff"/><path d="M738 112 h20 l1 8 h-22z M740 88 h16 l1 8 h-18z" fill="${L.accent}"/><rect x="738" y="48" width="20" height="12" fill="${L.glow}"/><path d="M736 48 L748 36 L760 48z" fill="#333"/></g><path d="M758 54 L640 30 L640 78z" fill="${L.glow}" opacity=".25"/>`,
      `${sail(180, 186, 90, '#f4a261')}${sail(420, 170, 70, '#2a9d8f')}${sail(580, 200, 100, '#e9c46a')}`,
      `<path d="M0 ${H} L0 236 Q220 222 440 238 L440 ${H} Z" fill="${L.ground}"/><g><rect x="60" y="214" width="6" height="30" fill="#7a5230"/><rect x="100" y="214" width="6" height="30" fill="#7a5230"/><rect x="40" y="210" width="90" height="6" fill="#9c6b3e"/></g>`,
      `<path d="M300 56 l200 0" stroke="#555" stroke-width="1"/>${['#e63946', '#f1c453', '#1d3557', '#2a9d8f', '#fff', '#e63946', '#f1c453', '#1d3557'].map((c, i) => `<path d="M${310 + i * 24} 56 l8 16 l8 -16z" fill="${c}"/>`).join('')}<g transform="translate(250 226)"><circle cx="0" cy="-18" r="5" fill="none" stroke="#5a5a5a" stroke-width="3"/><path d="M0 -13 V12 M-8 -6 h16 M-16 2 q16 18 32 0" stroke="#5a5a5a" stroke-width="3" fill="none" stroke-linecap="round"/></g><path d="M80 110 q8 -6 16 0 q8 -6 16 0 M520 100 q6 -5 12 0 q6 -5 12 0" stroke="#2b2b2b" stroke-width="2" fill="none"/>`,
    ];
  },
  farm(r, L) {
    return [
      `<circle cx="640" cy="62" r="32" fill="${L.glow}"/><g fill="#fff" opacity=".9"><ellipse cx="200" cy="54" rx="52" ry="14"/><ellipse cx="236" cy="44" rx="32" ry="13"/><ellipse cx="460" cy="40" rx="40" ry="11"/></g>`,
      hills(r, '#9cc95e', 190, 40),
      `<path d="M0 ${H} L0 205 Q400 190 ${W} 208 L${W} ${H} Z" fill="${L.ground}"/>${Array.from({ length: 9 }, (_, i) => `<path d="M${i * 90 + 420} 260 L${560 + i * 30} 206" stroke="#557d2c" stroke-width="5" opacity=".6"/>`).join('')}`,
      `<g><path d="M150 210 V130 L210 92 L270 130 V210Z" fill="${L.shape}"/><path d="M140 134 L210 86 L280 134" stroke="#f5f0e1" stroke-width="6" fill="none"/><rect x="186" y="150" width="48" height="60" fill="#f5f0e1"/><path d="M186 150 L234 210 M234 150 L186 210" stroke="${L.shape}" stroke-width="5"/><rect x="198" y="112" width="24" height="20" fill="#f5f0e1"/><rect x="290" y="80" width="40" height="130" fill="#c9ccd1"/><path d="M290 80 q20 -26 40 0z" fill="#9aa2ad"/><path d="M290 110 h40 M290 140 h40 M290 170 h40" stroke="#9aa2ad" stroke-width="3"/></g>`,
      `<g fill="#f5f0e1">${Array.from({ length: 12 }, (_, i) => `<rect x="${400 + i * 34}" y="196" width="6" height="30"/>`).join('')}</g><rect x="400" y="202" width="380" height="5" fill="#f5f0e1"/><rect x="400" y="214" width="380" height="5" fill="#f5f0e1"/>${tree(60, 214, 80, '#3d7a35')}`,
      `<g><ellipse cx="520" cy="232" rx="30" ry="15" fill="#fff"/><circle cx="508" cy="228" r="6" fill="#222"/><circle cx="530" cy="236" r="5" fill="#222"/><ellipse cx="552" cy="226" rx="11" ry="9" fill="#fff"/><rect x="500" y="242" width="5" height="12" fill="#fff"/><rect x="536" y="242" width="5" height="12" fill="#fff"/></g><g><rect x="620" y="222" width="54" height="22" rx="3" fill="${L.accent}"/><rect x="650" y="204" width="22" height="20" fill="${L.accent}"/><circle cx="632" cy="248" r="9" fill="#333"/><circle cx="664" cy="246" r="13" fill="#333"/></g><ellipse cx="380" cy="240" rx="10" ry="8" fill="#c0392b"/><path d="M372 234 l8 -6 l8 6" fill="#e9c46a"/>`,
    ];
  },
  science(r, L) {
    const flask = (x, base, c) => `<path d="M${x - 8} ${base - 60} h16 v20 l18 34 q4 8 -6 8 h-38 q-10 0 -6 -8 l18 -34z" fill="#fff" opacity=".85" stroke="#9aa7b8" stroke-width="2"/><path d="M${x - 18} ${base - 22} h36 l8 14 q2 4 -4 4 h-44 q-6 0 -4 -4z" fill="${c}"/>`;
    return [
      `<g opacity=".5">${Array.from({ length: 9 }, (_, i) => `<rect x="${i * 90 + 10}" y="10" width="80" height="120" fill="#fff"/>`).join('')}</g>`,
      `<rect x="80" y="30" width="200" height="100" rx="6" fill="#1f3b2f" stroke="#8b6b3e" stroke-width="6"/><g fill="none" stroke="#f5f8fc" stroke-width="2" opacity=".85"><circle cx="140" cy="76" r="18"/><ellipse cx="140" cy="76" rx="34" ry="10"/><ellipse cx="140" cy="76" rx="34" ry="10" transform="rotate(60 140 76)"/><path d="M200 60 h50 M200 80 h36 M200 100 h44"/></g>`,
      `<rect x="0" y="170" width="${W}" height="90" fill="${L.ground}"/><rect x="0" y="164" width="${W}" height="12" fill="${L.shape}"/>`,
      `${flask(400, 166, L.glow)}${flask(470, 166, '#ff7aa8')}<g><rect x="560" y="120" width="12" height="46" rx="5" fill="#fff" opacity=".85" stroke="#9aa7b8" stroke-width="2"/><rect x="561" y="144" width="10" height="20" rx="4" fill="#ffd166"/><rect x="584" y="120" width="12" height="46" rx="5" fill="#fff" opacity=".85" stroke="#9aa7b8" stroke-width="2"/><rect x="585" y="136" width="10" height="28" rx="4" fill="${L.accent}"/><rect x="552" y="150" width="54" height="6" fill="${L.shape}"/></g>`,
      `<g fill="${L.shape}"><rect x="660" y="150" width="50" height="10" rx="3"/><rect x="680" y="96" width="10" height="56" rx="3" transform="rotate(-20 685 124)"/><rect x="684" y="80" width="18" height="30" rx="4" transform="rotate(-20 693 95)"/><rect x="694" y="146" width="20" height="8"/></g>`,
      `<g fill="#fff" opacity=".8">${Array.from({ length: 8 }, () => `<circle cx="${(390 + r() * 100).toFixed(0)}" cy="${(40 + r() * 60).toFixed(0)}" r="${(3 + r() * 5).toFixed(1)}"/>`).join('')}</g><g transform="translate(330 210)"><path d="M0 0 h50 l-6 26 h-38z" fill="#c9a227"/><path d="M8 0 q-16 -2 -14 12 M42 0 q16 -2 14 12" stroke="#c9a227" stroke-width="4" fill="none"/></g>`,
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
    case 'town': return pick(r, [`<path d="M26 34 q24 -24 48 0z" fill="${L.accent}"/><path d="M70 34 h14 v4 h-14z" fill="${L.accent}"/>`, '']);
    case 'parks': return `<path d="M14 34 h72 v4 h-72z" fill="#8b6b3e"/><path d="M30 34 q2 -18 20 -20 q18 2 20 20z" fill="#a0814f"/><path d="M42 16 l8 -6 l8 6" stroke="#6b4f2a" stroke-width="2" fill="none"/>`;
    case 'travel': return pick(r, [`<path d="M14 36 q36 -10 72 0 l-10 -4 q-4 -16 -26 -16 q-22 0 -26 16z" fill="#f2d16b"/><rect x="26" y="29" width="48" height="4" fill="${L.accent}"/>`, `<rect x="30" y="44" width="16" height="9" rx="3" fill="#1d1d1d"/><rect x="54" y="44" width="16" height="9" rx="3" fill="#1d1d1d"/><path d="M46 47 h8" stroke="#1d1d1d" stroke-width="2"/>`]);
    case 'wonders': return `<path d="M22 34 q28 -30 56 0z" fill="#f2c14e"/><rect x="18" y="32" width="64" height="5" rx="2" fill="#e0a92e"/><rect x="47" y="10" width="6" height="22" fill="#e0a92e"/>`;
    case 'music': return pick(r, [`<path d="M24 50 q0 -32 26 -32 q26 0 26 32" stroke="#222" stroke-width="4" fill="none"/><rect x="18" y="44" width="10" height="16" rx="4" fill="${L.accent}"/><rect x="72" y="44" width="10" height="16" rx="4" fill="${L.accent}"/>`, `<rect x="30" y="44" width="16" height="9" rx="3" fill="#1d1d1d"/><rect x="54" y="44" width="16" height="9" rx="3" fill="#1d1d1d"/><path d="M46 47 h8" stroke="#1d1d1d" stroke-width="2"/>`, '']);
    case 'nautical': return `<path d="M26 32 q24 -18 48 0z" fill="#fff" stroke="#ccc"/><rect x="24" y="30" width="52" height="6" rx="2" fill="#1d3557"/><path d="M74 34 h12 v3 h-12z" fill="#1d3557"/><circle cx="50" cy="26" r="3" fill="#c9a227"/>`;
    case 'farm': return pick(r, [`<path d="M14 36 q36 -10 72 0 l-10 -4 q-4 -16 -26 -16 q-22 0 -26 16z" fill="#e9c46a"/><rect x="26" y="29" width="48" height="4" fill="#b23a2e"/>`, `<path d="M26 34 q24 -22 48 0z" fill="#b23a2e"/><path d="M70 34 h14 v4 h-14z" fill="#b23a2e"/>`]);
    case 'science': return `<rect x="24" y="40" width="22" height="12" rx="5" fill="${L.glow}" opacity=".75" stroke="#2f4a6b" stroke-width="2"/><rect x="54" y="40" width="22" height="12" rx="5" fill="${L.glow}" opacity=".75" stroke="#2f4a6b" stroke-width="2"/><path d="M46 46 h8" stroke="#2f4a6b" stroke-width="2"/>`;
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
    // Women have long hair (and sometimes a bun); men have short styles.
    const female = genderOf(name) === 'f';
    const style = (female ? [0, 2, 4] : [0, 1, 3])[Math.floor(r() * 3)];
    const longHair = `<path d="M22 50 q0 -34 28 -34 q28 0 28 34 v30 h-56z" fill="${hair}"/>`;
    const hairBack = female ? longHair + (style === 4 ? `<circle cx="50" cy="20" r="10" fill="${hair}"/>` : '') : '';
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
  const gender = isPet ? '' : ` data-gender="${genderOf(name)}"`;
  return `<svg class="portrait-svg"${gender} width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><circle cx="50" cy="50" r="50" fill="${bg}"/><clipPath id="pc-${size}-${name.replace(/\W/g, '')}"><circle cx="50" cy="50" r="50"/></clipPath><g clip-path="url(#pc-${size}-${name.replace(/\W/g, '')})">${face}</g></svg>`;
}
