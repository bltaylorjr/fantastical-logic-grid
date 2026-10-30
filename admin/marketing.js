// Marketing: every campaign and ad, the words to post, the media they use,
// tracked links, and what each link brought in (server/src/marketing.js).
// The numbers are anonymous daily counts sent by the game (web/js/campaign.js).
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let h = null; // helpers from admin.js
let data = null; // the last GET /admin/v1/marketing
const EVENT_NAMES = { visit: 'Visits', play: 'First puzzles', solve: 'Solves', return: 'Came back within a week', install: 'Installs', download: 'Windows downloads', support: 'Support presses', edu_request: 'Educator requests', edu_confirm: 'School emails confirmed', edu_sent: 'Educator packages sent' };
const STATUS_BADGE = { draft: '', approved: 'warn', posted: 'ok', removed: 'bad', active: 'ok', paused: 'warn', ended: '' };
const STATUS_NAMES = { draft: 'Draft', approved: 'Approved to post', posted: 'Posted', removed: 'Taken down', active: 'Running', paused: 'Paused', ended: 'Ended' };
const MEDIUM_NAMES = { social: 'Social post', video: 'Video', forum: 'Forum', community: 'Community', directory: 'Directory', store: 'Store or game site', email: 'Email', referral: 'Link from a site', search: 'Search engine', print: 'Print', qr: 'QR code', other: 'Other' };
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');
const badge = (s) => `<span class="badge ${STATUS_BADGE[s] || ''}">${h.esc(STATUS_NAMES[s] || s)}</span>`;
const fillLink = (text, link) => String(text || '').replaceAll('{link}', link);
const adCampaign = (a) => data.campaigns.find((c) => c.id === a.campaignId);

async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); h.toast(`${what} copied.`); } catch (e) { h.toast('Copying is blocked here. Select the text and copy it.'); }
}

// Visits and solves per day.
function trendChart(trend) {
  const w = 600, ht = 120, n = Math.max(1, trend.length - 1);
  const max = Math.max(1, ...trend.map((d) => Math.max(d.visit, d.solve)));
  const x = (i) => (i / n) * (w - 12) + 6;
  const y = (v) => ht - 6 - (v / max) * (ht - 12);
  const line = (k, cls) => `<polyline class="${cls}" points="${trend.map((d, i) => `${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ')}"></polyline>`;
  const visits = trend.reduce((s, d) => s + d.visit, 0), solves = trend.reduce((s, d) => s + d.solve, 0);
  const summary = `Visits from campaigns and other sites: ${h.fmt(visits)}; puzzles solved by those visitors: ${h.fmt(solves)}, from ${trend[0]?.day} to ${trend[trend.length - 1]?.day}.`;
  return `<figure class="chart"><h3>Visits and solves per day</h3><p class="muted">${h.fmt(visits)} visits, ${h.fmt(solves)} solves</p>
    <svg viewBox="0 0 ${w} ${ht}" preserveAspectRatio="none" role="img" aria-label="${h.esc(summary)}"><line class="axis" x1="0" x2="${w}" y1="${ht - 0.5}" y2="${ht - 0.5}"></line>${line('visit', 'mk-visits')}${line('solve', 'mk-solves')}</svg>
    <div class="legend"><span><i class="k1"></i>Visits</span><span><i class="k2"></i>Solves</span></div></figure>`;
}

const numberCells = (s) => [h.fmt(s.visit), h.fmt(s.play), h.fmt(s.solve), h.fmt(s.return || 0), h.fmt(s.install), h.fmt(s.download), pct(s.play, s.visit), pct(s.solve, s.visit), pct(s.return || 0, s.visit)];
const numberHead = [{ label: 'Visits', num: 1 }, { label: 'First puzzles', num: 1 }, { label: 'Solves', num: 1 }, { label: 'Came back', num: 1 }, { label: 'Installs', num: 1 }, { label: 'Downloads', num: 1 }, { label: 'Visit to play', num: 1 }, { label: 'Solves per visit', num: 1 }, { label: 'Came back within a week', num: 1 }];

// Educator package requests from the Educators page (server/src/educators.js), counted for the ad the teacher came from.
const eduCells = (s) => [h.fmt(s.visit), h.fmt(s.edu_request || 0), h.fmt(s.edu_confirm || 0), h.fmt(s.edu_sent || 0), pct(s.edu_request || 0, s.visit)];
const eduHead = [{ label: 'Visits', num: 1 }, { label: 'Requests', num: 1 }, { label: 'Confirmed', num: 1 }, { label: 'Packages sent', num: 1 }, { label: 'Visit to request', num: 1 }];
const hasEdu = (s) => (s.edu_request || 0) + (s.edu_confirm || 0) + (s.edu_sent || 0) > 0;

function mediaName(id) {
  const m = data.media.find((x) => x.id === id);
  return m ? `<a href="${h.esc(m.url)}" target="_blank" rel="noopener">${h.esc(m.title)}</a>` : '<span class="muted">(removed)</span>';
}

// Channels scripts/marketing-post.py can post to by itself (the rest are emailed).
// Facebook posts go to the game's Page; group posts are always by hand.
// The same rule as is_auto() in scripts/marketing-post.py.
const AUTO_CHANNELS = ['bluesky', 'mastodon', 'x', 'facebook', 'instagram', 'threads', 'linkedin', 'pinterest', 'youtube', 'tiktok', 'reddit'];
const SUBREDDIT = /^https:\/\/www\.reddit\.com\/r\/[A-Za-z0-9_]{2,21}\/?$/;
const isAuto = (a) => AUTO_CHANNELS.includes(a.channel) && !(a.channel === 'facebook' && a.medium === 'community')
  && (a.channel !== 'reddit' || SUBREDDIT.test((a.where || '').trim()));

function adCard(a, admin) {
  const text = fillLink(a.body, a.link);
  const s = a.stats;
  return `<details class="mk-ad" data-ad="${a.id}">
    <summary><span class="mk-ad-title">${h.esc(a.title)}</span> ${badge(a.status)} <span class="muted">${h.esc(a.channel)} · ${h.esc(MEDIUM_NAMES[a.medium] || a.medium)} · ${h.fmt(s.visit)} visits · ${/^\/educators\//.test(a.landing || '') ? `${h.fmt(s.edu_request || 0)} educator requests` : `${h.fmt(s.solve)} solves`}</span></summary>
    <div class="stack">
      ${a.postOn ? `<p><b>Posting day:</b> ${h.esc(a.postOn)}${isAuto(a) ? ' (posted automatically once its key is saved)' : ' (emailed to you that morning to post by hand)'}</p>` : ''}
      ${a.autoNote ? `<p class="note"><b>Automatic posting:</b> ${h.esc(a.autoNote)}</p>` : ''}
      ${a.where ? `<p><b>Where:</b> ${/^https:\/\//.test(a.where) ? `<a href="${h.esc(a.where)}" target="_blank" rel="noopener">${h.esc(a.where)}</a>` : h.esc(a.where)}</p>` : ''}
      <div class="field"><label for="mk-text-${a.id}">Words to post (the tracked link is filled in)</label><textarea id="mk-text-${a.id}" rows="8" readonly>${h.esc(text)}</textarea></div>
      <div class="field"><label for="mk-link-${a.id}">Tracked link</label><input id="mk-link-${a.id}" type="text" readonly value="${h.esc(a.link)}"></div>
      <div class="row"><button class="btn small" type="button" data-copy-text="${a.id}">Copy the words</button><button class="btn small" type="button" data-copy-link="${a.id}">Copy the link</button></div>
      ${a.media.length ? `<p><b>Media:</b> ${a.media.map(mediaName).join(', ')}</p>` : ''}
      ${a.notes ? `<p class="note">${h.esc(fillLink(a.notes, a.link))}</p>` : ''}
      ${a.postUrl ? `<p><b>Live post:</b> <a href="${h.esc(a.postUrl)}" target="_blank" rel="noopener">${h.esc(a.postUrl)}</a>${a.postedAt ? ` (posted ${h.esc(h.when(a.postedAt))})` : ''}</p>` : ''}
      <p class="muted">${Object.entries(EVENT_NAMES).map(([k, v]) => `${v}: ${h.fmt(s[k])}`).join(' · ')}</p>
      ${admin ? `<div class="row">${a.status !== 'posted' ? `<button class="btn small primary" type="button" data-ad-posted="${a.id}">Mark as posted</button>` : ''}<button class="btn small" type="button" data-ad-edit="${a.id}">Edit</button><button class="btn small danger" type="button" data-ad-delete="${a.id}">Delete</button></div>` : ''}
    </div></details>`;
}

function campaignCard(c, admin) {
  const ads = data.ads.filter((a) => a.campaignId === c.id);
  const s = data.byCampaign.find((x) => x.campaign === c.code);
  const counts = ['draft', 'approved', 'posted'].map((k) => `${ads.filter((a) => a.status === k).length} ${STATUS_NAMES[k].toLowerCase()}`).join(', ');
  return `<section class="card mk-campaign" aria-labelledby="mk-c-${c.id}">
    <div class="head"><h3 id="mk-c-${c.id}">${h.esc(c.name)} ${badge(c.status)}</h3>
      ${admin ? `<div class="row"><button class="btn small" type="button" data-ad-new="${c.id}">Add an ad</button><button class="btn small" type="button" data-c-edit="${c.id}">Edit</button><button class="btn small danger" type="button" data-c-delete="${c.id}">Delete</button></div>` : ''}</div>
    <p class="muted">Link code <code>${h.esc(c.code)}</code>${c.starts ? ` · ${h.esc(c.starts)}` : ''}${c.ends ? ` to ${h.esc(c.ends)}` : ''} · ${ads.length} ads (${counts})${s ? ` · ${h.fmt(s.visit)} visits, ${h.fmt(s.solve)} solves` : ''}</p>
    ${c.goal ? `<p><b>Goal:</b> ${h.esc(c.goal)}</p>` : ''}
    ${c.notes ? `<p class="note">${h.esc(c.notes)}</p>` : ''}
    ${ads.length ? ads.map((a) => adCard(a, admin)).join('') : '<p class="muted">No ads yet.</p>'}
  </section>`;
}

function mediaCard(m, admin) {
  const used = data.ads.filter((a) => a.media.includes(m.id)).length;
  const pic = m.preview && m.preview.startsWith('/admin/') ? `<img src="${h.esc(m.preview)}" alt="" loading="lazy">` : '';
  return `<li class="mk-media">${pic}<div><b>${h.esc(m.title)}</b> <span class="badge">${h.esc(m.kind)}</span>
    <p class="muted">${h.esc(m.size || '')}${m.size ? ' · ' : ''}used by ${used} ad${used === 1 ? '' : 's'}</p>
    ${m.notes ? `<p>${h.esc(m.notes)}</p>` : ''}
    <div class="row"><a class="btn small" href="${h.esc(m.url)}" target="_blank" rel="noopener">Open or download</a>${admin ? `<button class="btn small" type="button" data-m-edit="${m.id}">Edit</button><button class="btn small danger" type="button" data-m-delete="${m.id}">Delete</button>` : ''}</div></div></li>`;
}

function builder() {
  const opts = data.campaigns.map((c) => `<option value="${h.esc(c.code)}">${h.esc(c.name)}</option>`).join('');
  return `<section class="card" aria-labelledby="mk-b-h"><h2 id="mk-b-h">Make a tracked link</h2>
    <p class="muted">For anything not listed above: a comment, a QR code on a flyer, a link in a profile. Visits are counted for campaigns listed here; other codes show as "Unknown campaign codes".</p>
    <div class="mk-builder">
      <div class="field"><label for="mk-b-c">Campaign</label><select id="mk-b-c">${opts}</select></div>
      <div class="field"><label for="mk-b-s">Channel (source)</label><input id="mk-b-s" list="mk-sources" value="reddit" autocomplete="off"><datalist id="mk-sources">${data.sources.map((s) => `<option value="${h.esc(s)}">`).join('')}</datalist></div>
      <div class="field"><label for="mk-b-m">Kind (medium)</label><select id="mk-b-m">${data.mediums.map((m) => `<option value="${m}">${h.esc(MEDIUM_NAMES[m] || m)}</option>`).join('')}</select></div>
      <div class="field"><label for="mk-b-k">Ad name (content, optional)</label><input id="mk-b-k" autocomplete="off"></div>
      <div class="field"><label for="mk-b-l">Opens</label><select id="mk-b-l"><option value="/?play=now">A quick Easy puzzle</option><option value="/">The home screen</option></select></div>
    </div>
    <div class="field"><label for="mk-b-out">Link</label><input id="mk-b-out" type="text" readonly></div>
    <button class="btn small" type="button" id="mk-b-copy">Copy the link</button></section>`;
}
const slugify = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
function buildLink() {
  const out = $('#mk-b-out');
  if (!out) return;
  const [path, query] = $('#mk-b-l').value.split('?');
  const q = new URLSearchParams(query || '');
  q.set('utm_source', slugify($('#mk-b-s').value) || 'other');
  q.set('utm_medium', $('#mk-b-m').value);
  q.set('utm_campaign', $('#mk-b-c').value);
  const k = slugify($('#mk-b-k').value);
  if (k) q.set('utm_content', k);
  out.value = `${data.site.replace(/\/+$/, '')}${path}?${q}`;
}

async function render() {
  const days = $('#mk-days').value;
  data = await h.api(`marketing?days=${days}`);
  const admin = h.can('admin');
  const t = data.totals;
  const sources = data.bySource.map((s) => [h.esc(s.source), h.esc(MEDIUM_NAMES[s.medium] || s.medium), ...numberCells(s)]);
  const campaigns = data.byCampaign.map((s) => [h.esc(s.name), `<code>${h.esc(s.campaign)}</code>`, ...numberCells(s)]);
  const adRows = data.ads.filter((a) => a.stats.visit || a.stats.solve || a.status === 'posted')
    .map((a) => [h.esc(a.title), h.esc(adCampaign(a)?.name || ''), badge(a.status), ...numberCells(a.stats)]);
  const eduAds = data.ads.filter((a) => /^\/educators\//.test(a.landing || '') || hasEdu(a.stats));
  const eduRows = eduAds.filter((a) => a.stats.visit || hasEdu(a.stats) || a.status === 'posted')
    .map((a) => [h.esc(a.title), h.esc(a.channel), badge(a.status), ...eduCells(a.stats)]);
  // Worth your time: for each site you post on, visits and solves per post, so
  // the sites that bring players stand out from the ones that only take time.
  // Posts are the ads marked posted; visits are everything from that site in the period.
  const worth = [...new Set(data.ads.filter((a) => a.status === 'posted').map((a) => a.channel))].map((ch) => {
    const posts = data.ads.filter((a) => a.status === 'posted' && a.channel === ch).length;
    const sum = (e) => data.bySource.filter((x) => x.source === ch).reduce((n, x) => n + (x[e] || 0), 0);
    return { ch, posts, visit: sum('visit'), solve: sum('solve') };
  }).sort((a, b) => b.visit / b.posts - a.visit / a.posts || b.solve - a.solve);
  const worthRows = worth.map((w) => [h.esc(w.ch), h.fmt(w.posts), h.fmt(w.visit), (w.visit / w.posts).toFixed(1), h.fmt(w.solve), (w.solve / w.posts).toFixed(1)]);
  const worthNote = worth.length >= 2 && worth[0].visit > 0
    ? `<p>Over the last ${h.fmt(data.days)} days, <b>${h.esc(worth[0].ch)}</b> brought the most visits per post (${(worth[0].visit / worth[0].posts).toFixed(1)}), and <b>${h.esc(worth.at(-1).ch)}</b> the fewest (${(worth.at(-1).visit / worth.at(-1).posts).toFixed(1)}).</p>`
    : '<p class="muted">Once two or more sites have posts and visits, this compares them.</p>';
  const eduSources = data.bySource.filter(hasEdu).map((s) => [h.esc(s.source), h.esc(MEDIUM_NAMES[s.medium] || s.medium), ...eduCells(s)]);
  const posted = data.ads.filter((a) => a.status === 'posted').length;
  const waiting = data.ads.filter((a) => a.status === 'approved').length;
  $('#marketing-body').innerHTML = `
    <div class="tiles">${h.tile('Visits', h.fmt(t.visit), `from campaign links and other sites since ${h.esc(data.since)}`)}
      ${h.tile('First puzzles', h.fmt(t.play), `${pct(t.play, t.visit)} of visits`)}
      ${h.tile('Solves', h.fmt(t.solve), 'by those visitors, within 30 days')}
      ${h.tile('Came back', h.fmt(t.return || 0), `${pct(t.return || 0, t.visit)} of visits, on a later day within a week`)}
      ${h.tile('Installs and downloads', h.fmt(t.install + t.download), `${h.fmt(t.install)} app installs, ${h.fmt(t.download)} Windows downloads`)}
      ${h.tile('Ads posted', h.fmt(posted), `${h.fmt(waiting)} approved and waiting, ${h.fmt(data.ads.length)} in all`)}
      ${h.tile('Educator requests', h.fmt(t.edu_request || 0), `${h.fmt(t.edu_confirm || 0)} school emails confirmed, ${h.fmt(t.edu_sent || 0)} packages sent, from campaign links and other sites`)}</div>
    <div class="charts">${trendChart(data.trend)}</div>
    <h2 id="mk-worth-h">Worth your time</h2>
    ${worthNote}
    ${h.table([{ label: 'Site' }, { label: 'Posts', num: true }, { label: 'Visits', num: true }, { label: 'Visits per post', num: true }, { label: 'Solves', num: true }, { label: 'Solves per post', num: true }], worthRows, 'No ad is marked posted yet.')}
    <h2 id="mk-src-h">By channel</h2>
    ${h.table([{ label: 'Channel' }, { label: 'Kind' }, ...numberHead], sources, 'No visits from campaign links or other sites in this period yet.')}
    <h2 id="mk-camp-h">By campaign</h2>
    ${h.table([{ label: 'Campaign' }, { label: 'Code' }, ...numberHead], campaigns, 'No campaign visits in this period yet.')}
    <h2 id="mk-ads-h">By ad</h2>
    ${h.table([{ label: 'Ad' }, { label: 'Campaign' }, { label: 'Status' }, ...numberHead], adRows, 'No ad has been posted or brought a visit yet.')}
    ${eduAds.length || eduSources.length ? `<h2 id="mk-edu-h">Educator requests</h2>
    <p class="muted">Requests on the Educators page from teachers who came by a campaign link or another site, then confirmed school emails and packages emailed. Every request, tracked or not, is in Educator requests.</p>
    <h3>By ad</h3>
    ${h.table([{ label: 'Ad' }, { label: 'Channel' }, { label: 'Status' }, ...eduHead], eduRows, 'No educator ad has been posted or brought a visit yet.')}
    <h3>By channel</h3>
    ${h.table([{ label: 'Channel' }, { label: 'Kind' }, ...eduHead], eduSources, 'No educator requests from campaign links or other sites in this period yet.')}` : ''}
    ${admin ? '<p><button class="btn small" type="button" data-export="marketing">Download every number (CSV)</button></p>' : ''}
    <div class="head"><h2 id="mk-list-h">Campaigns and ads</h2>${admin ? '<button class="btn small primary" type="button" id="mk-c-new">New campaign</button>' : ''}</div>
    <p class="muted">Every ad keeps the exact words to post, its media, where it goes and its tracked link. Mark an ad as posted with the live link so the numbers can be checked against it.</p>
    ${data.campaigns.length ? data.campaigns.map((c) => campaignCard(c, admin)).join('') : '<p class="muted">No campaigns yet.</p>'}
    <div class="head"><h2 id="mk-media-h">Media</h2>${admin ? '<button class="btn small" type="button" id="mk-m-new">Add media</button>' : ''}</div>
    <p class="muted">Videos and pictures for the ads. The files are kept in the game's GitHub repository (media/promo and media/marketing) or on the channel; this list links to them.</p>
    <ul class="mk-media-list">${data.media.map((m) => mediaCard(m, admin)).join('')}</ul>
    ${data.campaigns.length ? builder() : ''}`;
  buildLink();
}

// ------------------------------------------------------------- forms
// A form in the marketing dialog. fields: [{ name, label, type, value, options, help }];
// type 'checks' is a list of checkboxes (options [[value, label]]), value a list.
function form(title, fields, okText = 'Save') {
  const dlg = $('#mk-dialog');
  $('#mk-dialog-title').textContent = title;
  $('#mk-dialog-ok').textContent = okText;
  $('#mk-dialog-error').hidden = true;
  $('#mk-dialog-body').innerHTML = fields.map((f, i) => {
    const id = `mk-f-${i}`;
    const help = f.help ? `<span class="muted">${h.esc(f.help)}</span>` : '';
    if (f.type === 'select') return `<div class="field"><label for="${id}">${h.esc(f.label)}</label><select id="${id}" name="${f.name}">${f.options.map(([v, l]) => `<option value="${h.esc(v)}"${String(v) === String(f.value) ? ' selected' : ''}>${h.esc(l)}</option>`).join('')}</select>${help}</div>`;
    if (f.type === 'textarea') return `<div class="field"><label for="${id}">${h.esc(f.label)}</label><textarea id="${id}" name="${f.name}" rows="${f.rows || 4}">${h.esc(f.value || '')}</textarea>${help}</div>`;
    if (f.type === 'checks') return `<fieldset class="field mk-checks"><legend>${h.esc(f.label)}</legend>${f.options.map(([v, l], j) => `<label><input type="checkbox" name="${f.name}" value="${h.esc(v)}"${(f.value || []).includes(v) ? ' checked' : ''} id="${id}-${j}"> ${h.esc(l)}</label>`).join('') || '<span class="muted">Nothing to choose yet.</span>'}${help}</fieldset>`;
    return `<div class="field"><label for="${id}">${h.esc(f.label)}</label><input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${h.esc(f.value ?? '')}" autocomplete="off">${help}</div>`;
  }).join('');
  return new Promise((resolve) => {
    const done = (v) => { dlg.close(); $('#mk-dialog-form').onsubmit = null; $('#mk-dialog-cancel').onclick = null; dlg.oncancel = null; resolve(v); };
    $('#mk-dialog-form').onsubmit = (e) => {
      e.preventDefault();
      const v = {};
      for (const f of fields) v[f.name] = f.type === 'checks' ? $$(`[name="${f.name}"]:checked`, dlg).map((c) => Number(c.value)) : $(`[name="${f.name}"]`, dlg).value;
      done(v);
    };
    $('#mk-dialog-cancel').onclick = () => done(null);
    dlg.oncancel = () => done(null);
    dlg.showModal();
    $('input, select, textarea', $('#mk-dialog-body'))?.focus();
  });
}

const opts = (list, names = {}) => list.map((v) => [v, names[v] || v]);

async function editCampaign(c = {}) {
  const v = await form(c.id ? 'Edit campaign' : 'New campaign', [
    { name: 'name', label: 'Name', value: c.name },
    { name: 'code', label: 'Link code (utm_campaign)', value: c.code, help: 'Lowercase letters, numbers and dashes. Changing it stops counting links already posted with the old code.' },
    { name: 'status', label: 'Status', type: 'select', value: c.status || 'draft', options: opts(data.campaignStatus, STATUS_NAMES) },
    { name: 'starts', label: 'Starts', type: 'date', value: c.starts || '' },
    { name: 'ends', label: 'Ends', type: 'date', value: c.ends || '' },
    { name: 'goal', label: 'Goal', type: 'textarea', rows: 2, value: c.goal },
    { name: 'notes', label: 'Notes', type: 'textarea', rows: 3, value: c.notes },
  ]);
  if (!v) return;
  await h.act(null, async () => { await h.api('marketing/campaigns', { method: 'POST', body: { ...v, id: c.id } }); await render(); }, 'Campaign saved.');
}

async function editAd(a) {
  const v = await form(a.id ? 'Edit ad' : 'New ad', [
    { name: 'title', label: 'Title (for this list)', value: a.title },
    { name: 'campaignId', label: 'Campaign', type: 'select', value: a.campaignId, options: data.campaigns.map((c) => [c.id, c.name]) },
    { name: 'channel', label: 'Channel (utm_source)', value: a.channel, help: 'For example reddit, facebook, pinterest.' },
    { name: 'medium', label: 'Kind (utm_medium)', type: 'select', value: a.medium || 'social', options: opts(data.mediums, MEDIUM_NAMES) },
    { name: 'content', label: 'Ad name in the link (utm_content)', value: a.content, help: 'Tells two ads on the same channel apart. Made from the title if left empty.' },
    { name: 'body', label: 'Words to post', type: 'textarea', rows: 8, value: a.body, help: 'Write {link} where the tracked link goes.' },
    { name: 'media', label: 'Media', type: 'checks', value: a.media || [], options: data.media.map((m) => [m.id, `${m.title} (${m.size || m.kind})`]) },
    { name: 'landing', label: 'Opens this page', value: a.landing || '/?play=now', help: '/?play=now starts a quick Easy puzzle straight away; / opens the home screen; /daily/ the daily puzzle page.' },
    { name: 'where', label: 'Where to post it', value: a.where },
    { name: 'postOn', label: 'Posting day', type: 'date', value: a.postOn || '', help: 'Approved ads go out on this day: automatically on Bluesky, Mastodon, X, the Facebook Page, Instagram and Threads, and by an email to you for the rest.' },
    { name: 'status', label: 'Status', type: 'select', value: a.status || 'draft', options: opts(data.adStatus, STATUS_NAMES) },
    { name: 'postUrl', label: 'Live post link (once posted)', type: 'url', value: a.postUrl || '' },
    { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, value: a.notes },
  ]);
  if (!v) return;
  await h.act(null, async () => { await h.api('marketing/ads', { method: 'POST', body: { ...v, campaignId: Number(v.campaignId), id: a.id } }); await render(); }, 'Ad saved.');
}

async function markPosted(a) {
  const v = await form(`Posted: ${a.title}`, [{ name: 'postUrl', label: 'Link to the live post', type: 'url', value: a.postUrl || '', help: 'Optional, but it lets you find the post again.' }], 'Mark as posted');
  if (!v) return;
  await h.act(null, async () => { await h.api('marketing/ads', { method: 'POST', body: { ...a, status: 'posted', postUrl: v.postUrl } }); await render(); }, 'Marked as posted.');
}

async function editMedia(m = {}) {
  const v = await form(m.id ? 'Edit media' : 'Add media', [
    { name: 'title', label: 'Name', value: m.title },
    { name: 'kind', label: 'Kind', type: 'select', value: m.kind || 'image', options: opts(data.mediaKinds) },
    { name: 'url', label: 'Link to the file', type: 'url', value: m.url, help: 'Where it can be seen or downloaded, starting https://' },
    { name: 'size', label: 'Size', value: m.size, help: 'For example 1080x1920, 30 s.' },
    { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, value: m.notes },
  ]);
  if (!v) return;
  await h.act(null, async () => { await h.api('marketing/media', { method: 'POST', body: { ...v, id: m.id } }); await render(); }, 'Media saved.');
}

export function marketingView(helpers) {
  h = helpers;
  return render();
}

export function initMarketing(helpers, show) {
  h = helpers;
  $('#mk-days').onchange = () => show('marketing', { keepFocus: true });
  const body = $('#marketing-body');
  body.addEventListener('input', (e) => { if (e.target.closest('.mk-builder')) buildLink(); });
  body.addEventListener('change', (e) => { if (e.target.closest('.mk-builder')) buildLink(); });
  body.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || !data) return;
    const d = t.dataset;
    const ad = (id) => data.ads.find((a) => a.id === Number(id));
    if (d.copyText) { const a = ad(d.copyText); return copy(fillLink(a.body, a.link), 'The words'); }
    if (d.copyLink) return copy(ad(d.copyLink).link, 'The link');
    if (t.id === 'mk-b-copy') return copy($('#mk-b-out').value, 'The link');
    if (t.id === 'mk-c-new') return editCampaign();
    if (t.id === 'mk-m-new') return editMedia();
    if (d.cEdit) return editCampaign(data.campaigns.find((c) => c.id === Number(d.cEdit)));
    if (d.adNew) return editAd({ campaignId: Number(d.adNew), medium: 'social', status: 'draft', media: [] });
    if (d.adEdit) return editAd(ad(d.adEdit));
    if (d.adPosted) return markPosted(ad(d.adPosted));
    if (d.mEdit) return editMedia(data.media.find((m) => m.id === Number(d.mEdit)));
    if (d.cDelete) {
      const c = data.campaigns.find((x) => x.id === Number(d.cDelete));
      const v = await h.ask({ title: 'Delete this campaign?', text: `This removes "${h.esc(c.name)}" and all its ads. Its numbers stay. Type the link code <b>${h.esc(c.code)}</b> to confirm.`, fields: [{ name: 'confirm', label: 'Link code' }], ok: 'Delete', danger: true });
      if (v) await h.act(t, async () => { await h.api(`marketing/campaigns/${c.id}/delete`, { method: 'POST', body: v }); await render(); }, 'Campaign deleted.');
      return;
    }
    if (d.adDelete) {
      const a = ad(d.adDelete);
      if (await h.ask({ title: 'Delete this ad?', text: `"${h.esc(a.title)}" will be removed. Its numbers stay in the campaign totals.`, ok: 'Delete', danger: true })) {
        await h.act(t, async () => { await h.api(`marketing/ads/${a.id}/delete`, { method: 'POST', body: {} }); await render(); }, 'Ad deleted.');
      }
      return;
    }
    if (d.mDelete) {
      const m = data.media.find((x) => x.id === Number(d.mDelete));
      if (await h.ask({ title: 'Remove this media?', text: `"${h.esc(m.title)}" is taken off the list. The file itself is not deleted.`, ok: 'Remove', danger: true })) {
        await h.act(t, async () => { await h.api(`marketing/media/${m.id}/delete`, { method: 'POST', body: {} }); await render(); }, 'Media removed.');
      }
    }
  });
}
