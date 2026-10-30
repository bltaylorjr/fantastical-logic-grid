// Ratings and insights: the 1 to 5 stars players give after solving
// (server/src/ratings.js). Averages, the spread of stars and trends, grouped
// any way the admin picks, and a plain-words list of what is working and
// what to improve, with a short Workers AI summary.
const $ = (s, el = document) => el.querySelector(s);

let h = null; // helpers from admin.js
const stars = (v) => (v == null ? '–' : `${Number(v).toFixed(1)} ★`);
const p = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);

// The 1-5 spread as a small bar per star (SVG: the dashboard's content
// policy allows no inline styles), with the numbers in words for screen readers.
function spreadBars(spread, { big = false } = {}) {
  const total = spread.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...spread);
  const words = spread.map((n, i) => `${i + 1} star${i ? 's' : ''}: ${n}`).join(', ');
  if (!big) {
    const bars = spread.map((n, i) => `<rect class="b1" x="${i * 12 + 1}" y="${(20 - (n / max) * 19).toFixed(1)}" width="10" height="${((n / max) * 19 + 1).toFixed(1)}"><title>${i + 1}★ ${n}</title></rect>`).join('');
    return `<svg class="spread" viewBox="0 0 60 21" role="img" aria-label="${h.esc(words)}">${bars}</svg>`;
  }
  const rows = spread.map((n, i) => ({ n, i })).reverse();
  return `<figure class="chart"><h3>How players rated</h3><p class="muted">${h.fmt(total)} ratings</p>
    <ul class="spread-list" role="img" aria-label="${h.esc(words)}">${rows.map(({ n, i }) => `<li><span>${i + 1} ★</span><svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="b1" x="0" y="0" height="10" width="${((n / max) * 100).toFixed(1)}"></rect></svg><span class="num">${h.fmt(n)} (${total ? Math.round((100 * n) / total) : 0}%)</span></li>`).join('')}</ul></figure>`;
}

// Average stars per day (per week for long periods) as a line, with a dot
// where there were ratings.
function trendChart(trend) {
  let pts = trend;
  if (trend.length > 60) {
    pts = [];
    for (let i = 0; i < trend.length; i += 7) {
      const wk = trend.slice(i, i + 7);
      const rated = wk.reduce((a, d) => a + d.rated, 0);
      pts.push({ day: wk[0].day, rated, avg: rated ? wk.reduce((a, d) => a + (d.avg || 0) * d.rated, 0) / rated : null });
    }
  }
  const w = 600, ht = 120, n = Math.max(1, pts.length - 1);
  const x = (i) => (i / n) * (w - 12) + 6;
  const y = (v) => ht - 6 - ((v - 1) / 4) * (ht - 12);
  const marks = pts.map((d, i) => (d.avg == null ? null : [x(i), y(d.avg), d])).filter(Boolean);
  const line = marks.length > 1 ? `<polyline class="trend" points="${marks.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ')}"></polyline>` : '';
  const dots = marks.map(([a, b, d]) => `<circle class="dot" cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="3.5"><title>${h.esc(d.day)}: ${Number(d.avg).toFixed(1)} stars from ${d.rated}</title></circle>`).join('');
  const grid = [1, 3, 5].map((v) => `<line class="axis" x1="0" x2="${w}" y1="${y(v)}" y2="${y(v)}"></line>`).join('');
  const rated = marks.map((m) => m[2]);
  const first = rated[0], last = rated[rated.length - 1];
  const summary = rated.length ? `Average stars ${trend.length > 60 ? 'per week' : 'per day'}: from ${Number(first.avg).toFixed(1)} on ${first.day} to ${Number(last.avg).toFixed(1)} on ${last.day}.` : 'No ratings in this period.';
  return `<figure class="chart"><h3>Average stars over time</h3><p class="muted">${trend.length > 60 ? 'Per week' : 'Per day'}; lines at 1, 3 and 5 stars</p>
    <svg viewBox="0 0 ${w} ${ht}" preserveAspectRatio="none" role="img" aria-label="${h.esc(summary)}">${grid}${line}${dots}</svg></figure>`;
}

function changeText(g) {
  if (g.change == null) return '<span class="muted">–</span>';
  const up = g.change > 0;
  if (Math.abs(g.change) < 0.1) return 'steady';
  return `<span class="badge ${up ? 'ok' : 'bad'}">${up ? '▲ up' : '▼ down'} ${Math.abs(g.change).toFixed(1)}</span>`;
}

function findingList(list, empty) {
  if (!list.length) return `<p class="muted">${h.esc(empty)}</p>`;
  return `<ul class="findings">${list.map((f) => `<li><p>${h.esc(f.text)}</p>${f.advice ? `<p class="muted">${h.esc(f.advice)}</p>` : ''}</li>`).join('')}</ul>`;
}

function summaryCard(s, days) {
  const body = s.status === 'ok' ? `<p class="ai-text">${h.esc(s.text)}</p><p class="muted">Written by Workers AI (${h.esc(s.model)}) from the numbers on this page, ${h.when(s.at)}. Check it against the findings below.</p>` : `<p class="muted">${h.esc(s.note)}</p>`;
  const again = h.can('admin') && !['off', 'not_set_up'].includes(s.status) ? `<button class="btn small" type="button" id="rt-again" data-days="${days}">Write it again</button>` : '';
  return `<section class="card" aria-labelledby="rt-ai-h"><div class="head"><h2 id="rt-ai-h">In a few words</h2>${again}</div>${body}
    <p class="muted">AI summaries today: ${h.fmt(s.usedToday)} of ${h.fmt(s.cap)} (Settings and switches &gt; Alerts and reports).</p></section>`;
}

async function render() {
  const days = Math.max(1, Math.min(365, Number($('#rt-days').value) || 30)); // a number, never page text
  const by = $('#rt-by').value;
  const r = await h.api(`ratings?days=${days}&by=${by}`);
  const o = r.overall;
  h.setCount('#count-ratings', r.improve.length);
  const label = r.dimensions[by];
  const rows = (r.groups || []).map((g) => [h.esc(g.name), h.fmt(g.rated), g.rated ? `<b>${stars(g.avg)}</b>` : '–', spreadBars(g.spread), h.fmt(g.games), p(g.solveRate), p(g.quitRate), p(g.tooHard), p(g.tooEasy), changeText(g)]);
  $('#ratings-body').innerHTML = `
    <div class="tiles">${h.tile('Average rating', stars(o.avg), `${h.fmt(o.rated)} ratings since ${h.esc(r.since)}`)}
      ${h.tile('Puzzles rated', p(o.rateShare), `of ${h.fmt(o.games)} finished`)}
      ${h.tile('Change', o.change == null ? '–' : `${o.change > 0 ? '+' : ''}${o.change.toFixed(1)} ★`, `second half of the period against the first${o.change == null ? ` (needs ${r.minRated} ratings in each)` : ''}`)}
      ${h.tile('Rated 4 or 5 stars', o.rated ? p((o.spread[3] + o.spread[4]) / o.rated) : '–', 'very good or excellent')}</div>
    <div class="charts">${spreadBars(o.spread, { big: true })}${trendChart(r.trend)}</div>
    ${summaryCard(r.summary, days)}
    <div class="insights">
      <section class="card" aria-labelledby="rt-good-h"><h2 id="rt-good-h">What's working</h2>${findingList(r.good, 'Nothing stands out yet. A group needs 5 ratings and an average well above the rest.')}</section>
      <section class="card" aria-labelledby="rt-improve-h"><h2 id="rt-improve-h">What to improve</h2>${findingList(r.improve, 'Nothing stands out yet. A group needs 5 ratings and an average well below the rest.')}</section>
    </div>
    ${r.findings.filter((f) => f.kind === 'note').map((f) => `<p class="note">${h.esc(f.text)} ${h.esc(f.advice || '')}</p>`).join('')}
    <h2 id="rt-table-h">By ${h.esc(label.toLowerCase())}</h2>
    ${h.table([{ label }, { label: 'Ratings', num: 1 }, { label: 'Average', num: 1 }, { label: '1 to 5 stars' }, { label: 'Games', num: 1 }, { label: 'Solved', num: 1 }, { label: 'Gave up', num: 1 }, { label: 'Too hard', num: 1 }, { label: 'Too easy', num: 1 }, { label: 'Trend' }],
      rows, 'Nothing to show yet for this grouping. Older app versions do not send topic, story, character, version or play mode.')}
    <p class="muted">Trend compares the second half of the period with the first (each half needs ${r.minRated} ratings).</p>`;
}

export function ratingsView(helpers) {
  h = helpers;
  return render();
}

export function initRatings(helpers, show) {
  h = helpers;
  $('#rt-days').onchange = () => show('ratings', { keepFocus: true });
  $('#rt-by').onchange = () => show('ratings', { keepFocus: true });
  $('#ratings-body').addEventListener('click', (e) => {
    const b = e.target.closest('#rt-again');
    if (!b) return;
    h.act(b, async () => {
      const r = await h.api('ratings/summary', { method: 'POST', body: { days: Number(b.dataset.days) } });
      if (r.summary.status !== 'ok') throw new Error(r.summary.note || 'No summary this time.');
      await render();
    }, 'Summary written again.');
  });
}
