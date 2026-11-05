// A spoiler-free result picture for sharing: the grid's shape (def.shareCells:
// 0 blank, 1 open cell, 2 a clue or given) with the level, time and hints.
// Picture Grid shows its finished picture, which is the reward worth sharing.
export function resultPicture(game, def, { accent = '#5B3CC4', dark = false } = {}) {
  const p = game.p, R = p.size, C = p.cols;
  const W = 600, H = 760, pad = 60, g = W - pad * 2, cell = g / Math.max(R, C);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const bg = dark ? '#121729' : '#FFFFFF', ink = dark ? '#EEF0F8' : '#121626', soft = dark ? '#1D2541' : '#ECEAF9';
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.fillStyle = accent; x.fillRect(0, 0, W, 10);
  x.fillStyle = ink;
  x.font = '700 30px "Atkinson Hyperlegible", system-ui, sans-serif';
  x.fillText(def.name, pad, 60);
  x.font = '400 20px "Atkinson Hyperlegible", system-ui, sans-serif';
  x.fillText(`${p.difficulty.name} · ${def.sizeLabel(R)}${game.daily ? ` · Daily ${game.daily}` : ''}`, pad, 92);
  const top = 120, kinds = def.shareCells(p);
  for (let i = 0; i < R * C; i++) {
    const r = Math.floor(i / C), col = i % C, k = kinds[i];
    if (!k) continue;
    x.fillStyle = k === 2 ? accent : soft;
    x.globalAlpha = k === 2 ? 0.85 : 1;
    x.fillRect(pad + col * cell + 1.5, top + r * cell + 1.5, cell - 3, cell - 3);
  }
  x.globalAlpha = 1;
  const s = Math.floor(game.ms / 1000);
  const time = s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  x.fillStyle = ink;
  x.font = '700 34px "Atkinson Hyperlegible", system-ui, sans-serif';
  x.fillText(`Solved in ${time}`, pad, top + g + 60);
  x.font = '400 22px "Atkinson Hyperlegible", system-ui, sans-serif';
  x.fillText(game.hints ? `${game.hints} hint${game.hints === 1 ? '' : 's'}` : 'No hints', pad, top + g + 94);
  x.textAlign = 'right';
  x.fillText('The Logic Grid', W - pad, top + g + 94);
  return c;
}
