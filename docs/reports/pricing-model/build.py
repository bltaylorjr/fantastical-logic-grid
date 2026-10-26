import json, math
D = json.load(open('model.json')); R = D['rows']; A = D['assumptions']
NET = 2.10  # average net a month per paying supporter, after fees
def k(n): return f"{n/1000:g}k" if n < 1e6 else f"{n/1e6:g}M"
def usd(x, cents=False):
    if x == 0: return "$0"
    return f"${x:,.2f}" if cents or x < 10 else f"${x:,.0f}"
C = dict(ink='#1d1b29', muted='#5d5a70', line='#d9d5e6', brand='#3b2a7a', gold='#9a6f08', soft='#f4f1fb',
         s1='#3b2a7a', s2='#2f7d6d', s3='#c0662d', s4='#8a8fa8', s5='#b23a5b', s6='#c99a1a')

# ---------- charts (inline SVG) ----------
def bar_limits():
    items = [('GitHub Pages bandwidth (100 GB/mo)', 10_000, 'free fix'), ('Gmail sending (about 500/day)', 10_000, 'then ~$0.10 per 1,000'),
             ('Workers requests (100k/day)', 11_000, '$5/mo plan'), ('D1 rows written (100k/day)', 18_000, 'same $5 plan'),
             ('D1 database size (500 MB)', 33_000, 'same $5 plan'), ('Workers AI (10k neurons/day)', 40_000, 'pennies'),
             ('D1 rows read (5M/day)', 50_000, 'same $5 plan'), ('Paid plan included requests (10M/mo)', 53_000, '$0.30 per million'),
             ('Firebase sign-ins (50k signed-in)', 167_000, '$0.0055 per user')]
    W, top, rh, L = 700, 22, 30, 262
    H = top + len(items) * rh + 22
    lo, hi = math.log10(1000), math.log10(400_000)
    x = lambda v: L + (math.log10(v) - lo) / (hi - lo) * (W - L - 150)
    out = [f'<svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="Players at which each free limit is crossed">']
    for t in [1000, 3000, 10_000, 30_000, 100_000, 300_000]:
        out.append(f'<line x1="{x(t):.1f}" x2="{x(t):.1f}" y1="{top-6}" y2="{H-18}" stroke="{C["line"]}"/>'
                   f'<text x="{x(t):.1f}" y="{H-4}" font-size="11" fill="{C["muted"]}" text-anchor="middle">{k(t)}</text>')
    for i, (lab, v, note) in enumerate(items):
        y = top + i * rh
        col = C['s2'] if 'free' in note else (C['s3'] if v < 60_000 else C['s5'])
        out.append(f'<text x="{L-8}" y="{y+15}" font-size="12" text-anchor="end" fill="{C["ink"]}">{lab}</text>'
                   f'<rect x="{L}" y="{y+4}" width="{x(v)-L:.1f}" height="16" rx="3" fill="{col}"/>'
                   f'<text x="{x(v)+6:.1f}" y="{y+16}" font-size="11.5" fill="{C["ink"]}"><tspan font-weight="700">{k(v)}</tspan> · {note}</text>')
    out.append('</svg>'); return ''.join(out)

def stacked():
    keys = [('cloudflare', 'Cloudflare Workers + D1', C['s1']), ('firebase', 'Firebase sign-ins', C['s5']),
            ('email', 'Email', C['s3']), ('workers_ai', 'Workers AI', C['s2']), ('domain', 'Domain', C['s4'])]
    W, H, L, B = 700, 260, 56, 40
    top = max(r['infra_total'] for r in R) * 1.12
    bw = (W - L - 10) / len(R)
    out = [f'<svg viewBox="0 0 {W} {H+30}" width="100%" role="img" aria-label="Monthly running costs by players">']
    for t in [0, 200, 400, 600]:
        y = H - B - t / top * (H - B - 10)
        out.append(f'<line x1="{L}" x2="{W-10}" y1="{y:.1f}" y2="{y:.1f}" stroke="{C["line"]}"/><text x="{L-6}" y="{y+4:.1f}" font-size="11" text-anchor="end" fill="{C["muted"]}">${t}</text>')
    for i, r in enumerate(R):
        x0 = L + i * bw + bw * 0.18; acc = 0
        for key, _, col in keys:
            v = r['infra'][key]
            if v <= 0: continue
            h = v / top * (H - B - 10); y = H - B - (acc + v) / top * (H - B - 10)
            out.append(f'<rect x="{x0:.1f}" y="{y:.1f}" width="{bw*0.64:.1f}" height="{max(h,1.2):.1f}" fill="{col}"/>'); acc += v
        y = H - B - acc / top * (H - B - 10)
        out.append(f'<text x="{x0+bw*0.32:.1f}" y="{y-5:.1f}" font-size="11" font-weight="700" text-anchor="middle" fill="{C["ink"]}">{usd(acc)}</text>'
                   f'<text x="{x0+bw*0.32:.1f}" y="{H-B+16}" font-size="11.5" text-anchor="middle" fill="{C["ink"]}">{k(r["mau"])}</text>')
    out.append(f'<text x="{(W+L)/2}" y="{H-B+32}" font-size="11" text-anchor="middle" fill="{C["muted"]}">monthly active players</text>')
    lx = L
    for _, lab, col in keys:
        out.append(f'<rect x="{lx}" y="{H+8}" width="11" height="11" rx="2" fill="{col}"/><text x="{lx+15}" y="{H+18}" font-size="11.5" fill="{C["ink"]}">{lab}</text>')
        lx += 26 + len(lab) * 6.2
    out.append('</svg>'); return ''.join(out)

def breakeven():
    W, H, L, B = 700, 250, 60, 34
    ymax = 33_000
    lo, hi = math.log10(1000), math.log10(500_000)
    x = lambda v: L + (math.log10(v) - lo) / (hi - lo) * (W - L - 24)
    y = lambda v: H - B - min(v, ymax) / ymax * (H - B - 10)
    out = [f'<svg viewBox="0 0 {W} {H+40}" width="100%" role="img" aria-label="Revenue scenarios against total monthly cost">']
    for t in range(0, ymax + 1, 5000):
        out.append(f'<line x1="{L}" x2="{W-24}" y1="{y(t):.1f}" y2="{y(t):.1f}" stroke="{C["line"]}"/><text x="{L-6}" y="{y(t)+4:.1f}" font-size="11" text-anchor="end" fill="{C["muted"]}">${t//1000}k</text>')
    for r in R:
        out.append(f'<text x="{x(r["mau"]):.1f}" y="{H-B+16}" font-size="11" text-anchor="middle" fill="{C["ink"]}">{k(r["mau"])}</text>')
    series = [('Total cost a month', lambda r: r['total'], C['s5'], ''), ('Revenue, 0.5% pay', lambda r: r['mau']*0.005*NET, C['s4'], '5 4'),
              ('Revenue, 1.5% pay (expected)', lambda r: r['mau']*0.015*NET, C['s2'], ''), ('Revenue, 3% pay', lambda r: r['mau']*0.03*NET, C['s1'], '2 3')]
    for lab, f, col, dash in series:
        d = ' '.join(f'{"M" if i==0 else "L"}{x(r["mau"]):.1f},{y(f(r)):.1f}' for i, r in enumerate(R))
        out.append(f'<path d="{d}" fill="none" stroke="{col}" stroke-width="2.6" stroke-dasharray="{dash}"/>')
    lx = L
    for lab, _, col, dash in series:
        out.append(f'<line x1="{lx}" x2="{lx+20}" y1="{H+20}" y2="{H+20}" stroke="{col}" stroke-width="2.6" stroke-dasharray="{dash}"/><text x="{lx+25}" y="{H+24}" font-size="11" fill="{C["ink"]}">{lab}</text>')
        lx += 40 + len(lab) * 5.7
    out.append('</svg>'); return ''.join(out)

# ---------- tables ----------
def head(rows): return '<table class="num"><thead><tr><th>Monthly players</th>' + ''.join(f'<th>{k(r["mau"])}</th>' for r in rows) + '</tr></thead><tbody>'
def stage_table():
    h = head(R)
    def row(lab, f, cls=''):
        return f'<tr class="{cls}"><td>{lab}</td>' + ''.join(f'<td>{f(r)}</td>' for r in R) + '</tr>'
    h += row('Daily players (25%)', lambda r: f'{r["dau"]:,}')
    h += row('Signed-in players (30%)', lambda r: f'{r["signed"]:,}')
    h += f'<tr class="grp"><td colspan="{len(R)+1}">Running costs a month</td></tr>'
    for key, lab in [('cloudflare', 'Cloudflare Workers + D1'), ('workers_ai', 'Workers AI (pictures, translation)'), ('firebase', 'Firebase sign-ins'),
                     ('email', 'Email (Amazon SES after Gmail)'), ('hosting', 'Website hosting (after free fix)'), ('voices', 'Server voices (kept at free caps)'), ('domain', 'Domain (about $15 a year)')]:
        h += row(lab, lambda r, key=key: usd(r['infra'][key]))
    h += row('<b>Running costs total</b>', lambda r: f'<b>{usd(r["infra_total"])}</b>', 'tot')
    h += f'<tr class="grp"><td colspan="{len(R)+1}">People, tools and safety a month (estimates you control)</td></tr>'
    for key, lab in [('build_tools', 'Design and build tools (AI coding plan)'), ('art_music', 'Art, music and voice extras'), ('moderation', 'Help with names, reports, support'), ('security', 'Security review and insurance')]:
        h += row(lab, lambda r, key=key: usd(r['people'][key]))
    h += row('<b>Total a month</b>', lambda r: f'<b>{usd(r["total"])}</b>', 'tot')
    h += row('Cost per 1,000 players', lambda r: usd(r['total'] / r['mau'] * 1000, True))
    h += row('Supporters needed to break even', lambda r: f'{math.ceil(r["total"]/NET):,}')
    h += row('…as a share of players', lambda r: f'{r["total"]/NET/r["mau"]*100:.2g}%')
    return h + '</tbody></table>'

def voice_table():
    rs = R[2:]; h = head(rs)
    h += '<tr><td>Chirp 3 HD, uncapped</td>' + ''.join(f'<td>{usd(r["chirp_uncapped"])}</td>' for r in rs) + '</tr>'
    h += '<tr><td>Gemini Flash TTS, uncapped (2026 price)</td>' + ''.join(f'<td>{usd(r["gemini_uncapped"])}</td>' for r in rs) + '</tr>'
    h += '<tr><td>Gemini Flash TTS, uncapped (from Jan 2027)</td>' + ''.join(f'<td>{usd(r["gemini_uncapped"]*2)}</td>' for r in rs) + '</tr>'
    h += '<tr class="tot"><td><b>As built today (caps on, Kokoro on the device)</b></td>' + ''.join('<td><b>$0</b></td>' for r in rs) + '</tr>'
    return h + '</tbody></table>'

def rev_table():
    h = head(R)
    for p in [0.005, 0.015, 0.03]:
        h += f'<tr><td>Revenue if {p*100:g}% pay</td>' + ''.join(f'<td>{usd(r["mau"]*p*NET)}</td>' for r in R) + '</tr>'
        cells = []
        for r in R:
            d = r['mau'] * p * NET - r['total']
            cells.append(f'<td class="{"neg" if d < 0 else "pos"}">{"−" if d < 0 else "+"}{usd(abs(d))}</td>')
        h += '<tr class="sub"><td>&nbsp;&nbsp;left after all costs</td>' + ''.join(cells) + '</tr>'
    return h + '</tbody></table>'

html = open('template.html').read()
html = html.replace('{{LIMITS}}', bar_limits()).replace('{{STACK}}', stacked()).replace('{{BREAKEVEN}}', breakeven()) \
           .replace('{{STAGES}}', stage_table()).replace('{{VOICES}}', voice_table()).replace('{{REVENUE}}', rev_table())
for key, v in C.items(): html = html.replace('{{C.' + key + '}}', v)
r500 = R[-1]; r50 = R[4]; r10 = R[2]
for key, v in {'INFRA500': usd(r500['infra_total']), 'TOTAL500': usd(r500['total']), 'INFRA50': usd(r50['infra_total']), 'TOTAL50': usd(r50['total']),
               'BE50': f'{math.ceil(r50["total"]/NET):,}', 'BE500': f'{math.ceil(r500["total"]/NET):,}', 'BE10': f'{math.ceil(r10["total"]/NET):,}',
               'INFRA100': usd(R[5]['infra_total']), 'INFRA250': usd(R[6]['infra_total'])}.items():
    html = html.replace('{{' + key + '}}', v)
assert '{{' not in html, html[html.index('{{'):html.index('{{')+40]
open('report.html', 'w').write(html)
print('ok')
