// Share my result: a spoiler-free card (title, level, theme, time, hints,
// daily streak) as a picture and a short message with a link to the game,
// in the player's language.
// Never includes answers, marks or clues.
import { CLOUD } from './cloud-config.js';
import * as i18n from './i18n.js';

const W = 1200, H = 630;

function siteUrl(daily) {
  const site = (CLOUD.siteUrl || 'https://thelogicgrid.com').replace(/\/+$/, '');
  return daily ? `${site}/daily/` : `${site}/`;
}

// info: { title, tier, theme, size, time, hints, revealed, daily (a date label), streak }
// The message without its link, which is never translated.
function message(info) {
  const how = info.hints ? `with ${info.hints} hint${info.hints === 1 ? '' : 's'}` : 'with no hints';
  const parts = [
    `I solved “${info.title}” (${info.tier} · ${info.theme}) in ${info.time} ${how} on The Fantastical Logic Grid.`,
    info.daily ? `Daily puzzle, ${info.daily}.${info.streak > 1 ? ` ${info.streak}-day streak!` : ''}` : '',
    'Can you crack it?',
  ];
  return parts.filter(Boolean).join(' ');
}
export const shareText = (info) => `${message(info)} ${siteUrl(!!info.daily)}`;

// The picture's words in the player's language.
const WORDS = { closed: 'Case closed', daily: 'Daily puzzle', time: 'Time', hints: 'Hints', streak: 'Streak', day: 'day', days: 'days' };
async function translated(info) {
  if (i18n.isEnglish()) return { info, words: WORDS, text: shareText(info) };
  const keys = Object.keys(WORDS);
  const [text, title, tier, theme, daily, ...w] = await i18n.tAll([message(info), info.title, info.tier, info.theme, info.daily || '', ...keys.map((k) => WORDS[k])]);
  return {
    info: { ...info, title, tier, theme, daily: info.daily ? daily : null },
    words: Object.fromEntries(keys.map((k, i) => [k, w[i]])),
    text: `${text} ${siteUrl(!!info.daily)}`,
  };
}

function wrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxWidth && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

export async function shareImage(info, words = WORDS) {
  try { await Promise.all([document.fonts.load('700 40px Cinzel'), document.fonts.load('400 30px "Atkinson Hyperlegible"'), document.fonts.load('700 30px "Atkinson Hyperlegible"')]); } catch (e) { /* system fonts are fine */ }
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#5B3CC4';
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#1b1440');
  g.addColorStop(1, accent);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // A faint grid in the corner, as on the game's icon.
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 6; i++) {
    ctx.beginPath(); ctx.moveTo(840 + i * 50, 40); ctx.lineTo(840 + i * 50, 340); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(840, 40 + i * 50); ctx.lineTo(1140, 40 + i * 50); ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 30px "Atkinson Hyperlegible", system-ui, sans-serif';
  ctx.fillText(info.daily ? `${words.daily} · ${info.daily}`.toUpperCase() : words.closed.toUpperCase(), 64, 92);
  ctx.font = '700 64px Cinzel, Georgia, serif';
  const lines = wrap(ctx, info.title, 760).slice(0, 2);
  lines.forEach((l, i) => ctx.fillText(l, 64, 180 + i * 76));
  ctx.font = '400 32px "Atkinson Hyperlegible", system-ui, sans-serif';
  ctx.fillText(`${info.tier} · ${info.theme} · ${info.size}`, 64, 180 + lines.length * 76 + 10);
  const stats = [[words.time, info.time], [words.hints, String(info.hints)]];
  if (info.daily && info.streak) stats.push([words.streak, `${info.streak} ${info.streak === 1 ? words.day : words.days}`]);
  stats.forEach(([k, v], i) => {
    const x = 64 + i * 300;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x, 410, 270, 130);
    ctx.fillStyle = '#ffffff';
    ctx.font = '400 26px "Atkinson Hyperlegible", system-ui, sans-serif';
    ctx.fillText(k, x + 24, 452);
    ctx.font = '700 48px "Atkinson Hyperlegible", system-ui, sans-serif';
    ctx.fillText(v, x + 24, 512);
  });
  ctx.font = '700 28px "Atkinson Hyperlegible", system-ui, sans-serif';
  ctx.fillText('The Fantastical Logic Grid', 64, 596);
  ctx.textAlign = 'right';
  ctx.font = '400 28px "Atkinson Hyperlegible", system-ui, sans-serif';
  ctx.fillText(siteUrl(false).replace(/^https?:\/\//, '').replace(/\/$/, ''), W - 64, 596);
  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
}

// Uses the device's share sheet when there is one (with the picture where
// supported), otherwise copies the message. Returns what happened.
export async function shareResult(english) {
  const { info, words, text } = await translated(english);
  let blob = null;
  try { blob = await shareImage(info, words); } catch (e) { /* the text is enough */ }
  const file = blob && typeof File === 'function' ? new File([blob], 'my-logic-grid-result.png', { type: 'image/png' }) : null;
  if (navigator.share) {
    try {
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text });
      else await navigator.share({ text });
      return { done: 'shared', blob };
    } catch (e) {
      if (e && e.name === 'AbortError') return { done: 'cancelled', blob };
    }
  }
  try { await navigator.clipboard.writeText(text); return { done: 'copied', text, blob }; } catch (e) { return { done: 'show', text, blob }; }
}
