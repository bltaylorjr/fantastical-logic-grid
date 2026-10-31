// A spoiler-free result picture for sharing: the grid's shape with the given
// cells shaded (no numbers), the level, time and hints.
export function resultPicture(game, { title = 'NINETIMESNINE', accent = '#5B3CC4', dark = false } = {}) {
  const p = game.p, N = p.size, [br, bc] = p.box;
  const W = 600, H = 760, pad = 60, g = W - pad * 2, cell = g / N;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const bg = dark ? '#121729' : '#FFFFFF', ink = dark ? '#EEF0F8' : '#121626', soft = dark ? '#1D2541' : '#ECEAF9';
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.fillStyle = accent; x.fillRect(0, 0, W, 10);
  x.fillStyle = ink;
  x.font = '700 30px "Atkinson Hyperlegible", system-ui, sans-serif';
  x.fillText(title, pad, 60);
  x.font = '400 20px "Atkinson Hyperlegible", system-ui, sans-serif';
  x.fillText(`${game.styleName || 'NINETIMESNINE'} · ${p.difficulty.name}${game.daily ? ` · Daily ${game.daily}` : ''}`, pad, 92);
  const top = 120;
  for (let i = 0; i < N * N; i++) {
    const r = Math.floor(i / N), col = i % N;
    x.fillStyle = p.givens[i] ? accent : soft;
    x.globalAlpha = p.givens[i] ? 0.85 : 1;
    x.fillRect(pad + col * cell + 2, top + r * cell + 2, cell - 4, cell - 4);
  }
  x.globalAlpha = 1;
  x.strokeStyle = ink; x.lineWidth = 4;
  x.strokeRect(pad, top, g, g);
  x.lineWidth = 3;
  for (let k = 1; k < N; k++) {
    if (k % bc === 0) { x.beginPath(); x.moveTo(pad + k * cell, top); x.lineTo(pad + k * cell, top + g); x.stroke(); }
    if (k % br === 0) { x.beginPath(); x.moveTo(pad, top + k * cell); x.lineTo(pad + g, top + k * cell); x.stroke(); }
  }
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
