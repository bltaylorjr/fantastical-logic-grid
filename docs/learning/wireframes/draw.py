"""Draws the wireframes for the learning build sheets (docs/learning/).
A wireframe is a simple sketch of a screen: where your change shows up and
what it should look like. The part you change is outlined in purple.
Run: python3 docs/learning/wireframes/draw.py   (needs Pillow)
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1200, 760
BG, PAGE, CARD, LINE, INK, MUTED = '#EEF1F7', '#FFFFFF', '#F6F7FB', '#C9D0DC', '#1F2A44', '#6B7385'
HI, HI_FILL, KEEP = '#7A3E9D', '#F1E8F7', '#B8BFCC'
F = '/usr/share/fonts/opentype/inter/Inter-Regular.otf'
FB = '/usr/share/fonts/opentype/inter/Inter-Bold.otf'
if not os.path.exists(F):
    F = FB = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font = lambda s, b=False: ImageFont.truetype(FB if b else F, s)


def frame(title):
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([30, 30, W - 30, H - 30], 18, fill=PAGE, outline=LINE, width=2)
    d.rectangle([30, 30, W - 30, 78], fill='#E4E8F0')
    for i, c in enumerate(['#E5786D', '#F2C14E', '#7FC97F']):
        d.ellipse([52 + i * 26, 46, 68 + i * 26, 62], fill=c)
    d.rounded_rectangle([150, 42, W - 60, 66], 12, fill=PAGE)
    d.text((166, 45), 'thelogicgrid.com', font=font(15), fill=MUTED)
    d.text((W - 40, H - 22), title, font=font(14), fill=MUTED, anchor='rs')
    return im, d


def appbar(d, y=96):
    d.rounded_rectangle([60, y, W - 60, y + 50], 10, fill=CARD, outline=LINE)
    d.text((80, y + 14), 'The Fantastical Logic Grid', font=font(18, True), fill=INK)
    for i, t in enumerate(['How to play', 'Introduction', 'Menu']):
        d.text((W - 380 + i * 115, y + 16), t, font=font(15), fill=MUTED)


def lines(d, x, y, w, n, gap=22, h=10, color='#DCE1EA', last=0.6):
    for i in range(n):
        ww = w * (last if i == n - 1 else 1)
        d.rounded_rectangle([x, y + i * gap, x + ww, y + i * gap + h], 5, fill=color)


def highlight(d, box, label, side='right'):
    x0, y0, x1, y1 = box
    for i in range(0, int(2 * (x1 - x0 + y1 - y0)), 18):
        pass
    d.rounded_rectangle([x0 - 8, y0 - 8, x1 + 8, y1 + 8], 12, outline=HI, width=4)
    tw = d.textlength(label, font=font(17, True))
    if side == 'right':
        lx, ly = x1 + 30, (y0 + y1) / 2 - 18
        d.line([x1 + 8, (y0 + y1) / 2, lx, (y0 + y1) / 2], fill=HI, width=3)
    elif side == 'above':
        lx, ly = x0, y0 - 56
    else:
        lx, ly = x0, y1 + 20
    d.rounded_rectangle([lx, ly, lx + tw + 28, ly + 36], 18, fill=HI)
    d.text((lx + 14, ly + 8), label, font=font(17, True), fill='white')


def keep(d, box, label):
    x0, y0, x1, y1 = box
    d.rounded_rectangle([x0 - 6, y0 - 6, x1 + 6, y1 + 6], 10, outline=KEEP, width=2)
    d.text((x1 + 14, (y0 + y1) / 2 - 9), label, font=font(15), fill=MUTED)


def button(d, x, y, t, primary=False):
    w = d.textlength(t, font=font(15, True)) + 36
    d.rounded_rectangle([x, y, x + w, y + 40], 20, fill=HI if primary else CARD, outline=LINE)
    d.text((x + 18, y + 11), t, font=font(15, True), fill='white' if primary else INK)
    return x + w


def tips():
    im, d = frame('Learning 1 · How to play screen')
    appbar(d)
    d.text((80, 170), 'How to play', font=font(32, True), fill=INK)
    for i in range(4):
        y = 225 + i * 62
        d.rounded_rectangle([80, y, 760, y + 50], 10, fill=CARD, outline=LINE)
        d.ellipse([96, y + 13, 120, y + 37], outline=LINE, width=3)
        lines(d, 136, y + 14, 400, 1, last=1)
        lines(d, 136, y + 30, 260, 1, last=1, h=8)
    d.rounded_rectangle([80, 490, 760, 680], 14, fill=CARD, outline=LINE)
    d.text((104, 508), 'Tips and tricks', font=font(24, True), fill=INK)
    d.text((104, 552), 'Your new description goes here, in one or two', font=font(18), fill=INK)
    d.text((104, 578), 'sentences.', font=font(18), fill=INK)
    button(d, 104, 622, 'Read the tips and tricks')
    highlight(d, (100, 548, 560, 604), 'You change this text')
    keep(d, (104, 508, 290, 536), 'heading stays')
    im.save(os.path.join(HERE, 'learning-1-tips.png'))


def welcome():
    im, d = frame('Learning 2 · Welcome box (first visit)')
    appbar(d)
    lines(d, 80, 180, 900, 8, gap=34, h=14, color='#E6E9F0', last=0.7)
    d.rectangle([32, 80, W - 32, H - 32], fill='#B5BBC9')
    d.rounded_rectangle([230, 150, 970, 650], 18, fill=PAGE, outline=LINE, width=2)
    d.text((270, 185), 'Welcome, detective!', font=font(30, True), fill=INK)
    for i, t in enumerate(['Never solved a logic grid puzzle? How to play teaches you...', 'Or watch the Introduction, an 11-minute narrated video...', 'Both are always at the top of the page.']):
        d.text((270, 250 + i * 56), t, font=font(18), fill=INK if i < 2 else MUTED)
    x = button(d, 270, 560, 'Play a quick puzzle')
    x = button(d, x + 12, 560, 'How to play', True)
    button(d, x + 12, 560, 'Watch the video')
    highlight(d, (266, 180, 930, 400), 'You change the heading and these 3 lines', side='above')
    d.rounded_rectangle([262, 552, 940, 608], 12, outline=KEEP, width=2)
    d.text((270, 620), 'Buttons stay exactly as they are', font=font(15), fill=MUTED)
    im.save(os.path.join(HERE, 'learning-2-welcome.png'))


def falling():
    im, d = frame('Learning 3 · Solved puzzle, falling celebration')
    appbar(d)
    d.rounded_rectangle([200, 300, 1000, 660], 18, fill=CARD, outline=LINE)
    d.text((240, 330), 'Case closed!', font=font(34, True), fill=INK)
    lines(d, 240, 400, 700, 4, gap=30, h=12)
    button(d, 240, 590, 'New puzzle', True)
    import random
    r = random.Random(3)
    labels = ['1', '2', '3']
    for k in range(26):
        x, y = r.randint(80, 1110), r.randint(150, 700)
        if 190 < x < 1010 and 290 < y < 670:
            continue
        s = r.randint(30, 44)
        d.ellipse([x, y, x + s, y + s], fill=HI_FILL, outline=HI, width=3)
        d.text((x + s / 2, y + s / 2), labels[k % 3], font=font(16, True), fill=HI, anchor='mm')
    d.rounded_rectangle([80, 170, 640, 270], 14, fill=PAGE, outline=HI, width=3)
    d.text((100, 184), 'Your 3 emoji fall like snow', font=font(20, True), fill=HI)
    d.text((100, 218), "scifi: ['1', '2', '3'],  each circle is one of yours", font=font(17), fill=INK)
    im.save(os.path.join(HERE, 'learning-3-falling.png'))


def colors():
    im, d = frame('Learning 4 · Home screen, theme colors')
    glow = Image.new('RGB', (W, H), PAGE)
    g = ImageDraw.Draw(glow)
    for i in range(60, 0, -1):
        t = i / 60
        c1 = tuple(int(255 - (255 - v) * (1 - t) * 0.5) for v in (124, 92, 255))
        c2 = tuple(int(255 - (255 - v) * (1 - t) * 0.5) for v in (34, 184, 207))
        g.ellipse([900 - i * 6, 330 - i * 4, 900 + i * 6, 330 + i * 4], fill=c1)
        g.ellipse([960 - i * 5, 560 - i * 3, 960 + i * 5, 560 + i * 3], fill=c2)
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle([32, 80, W - 32, H - 32], 16, fill=255)
    im.paste(glow, (0, 0), mask)
    d = ImageDraw.Draw(im)
    appbar(d)
    
    d.text((80, 190), 'New puzzle', font=font(32, True), fill=INK)
    for i in range(6):
        x = 80 + (i % 3) * 200
        y = 250 + (i // 3) * 130
        d.rounded_rectangle([x, y, x + 180, y + 110], 14, fill=CARD, outline=LINE)
        lines(d, x + 20, y + 70, 120, 1, last=1)
    highlight(d, (760, 250, 1040, 410), 'color --w1', side='above')
    highlight(d, (820, 500, 1100, 620), 'color --w2', side='below')
    d.text((80, 560), 'Each theme tints the background with its own two colors.', font=font(18), fill=INK)
    d.text((80, 590), 'Pick the theme on this screen to see your colors.', font=font(18), fill=MUTED)
    im.save(os.path.join(HERE, 'learning-4-colors.png'))


def mixup():
    im, d = frame('Learning 5 · Puzzle screen, The story')
    appbar(d)
    d.rounded_rectangle([80, 170, 1120, 600], 14, fill=CARD, outline=LINE)
    d.text((104, 190), 'The story', font=font(24, True), fill=INK)
    d.text((104, 240), 'Four friends filled the old inn for the holidays.  A grand snowman', font=font(18), fill=INK)
    d.text((104, 268), 'appeared in the yard overnight.', font=font(18), fill=INK)
    d.text((104, 304), 'Your new mix-up sentence appears here, explaining why the facts', font=font(18, True), fill=HI)
    d.text((104, 332), 'got scrambled.', font=font(18, True), fill=HI)
    lines(d, 104, 390, 900, 2, gap=28, h=12)
    lines(d, 104, 470, 900, 2, gap=28, h=12, last=0.4)
    highlight(d, (100, 298, 760, 358), 'Your sentence', side='below')
    d.text((104, 640), 'Opening + incident + your mix-up: the first paragraph of every holiday story that uses it.', font=font(16), fill=MUTED)
    im.save(os.path.join(HERE, 'learning-5-mixup.png'))




def box(d, xy, title, sub='', fill='#FFFFFF', edge=LINE, title_color=INK):
    x0, y0, x1, y1 = xy
    d.rounded_rectangle(xy, 14, fill=fill, outline=edge, width=2)
    d.text(((x0 + x1) / 2, y0 + 18), title, font=font(17, True), fill=title_color, anchor='mt')
    for k, line in enumerate(sub.split('\n') if sub else []):
        d.text(((x0 + x1) / 2, y0 + 44 + k * 20), line, font=font(14), fill=MUTED, anchor='mt')


def arrow(d, a, b, label='', color='#8A93A6'):
    import math
    d.line([a, b], fill=color, width=3)
    ang = math.atan2(b[1] - a[1], b[0] - a[0])
    for s in (-0.45, 0.45):
        d.line([b, (b[0] - 14 * math.cos(ang + s), b[1] - 14 * math.sin(ang + s))], fill=color, width=3)
    if label:
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        tw = d.textlength(label, font=font(13))
        d.rounded_rectangle([mx - tw / 2 - 6, my - 11, mx + tw / 2 + 6, my + 11], 8, fill=BG)
        d.text((mx, my), label, font=font(13), fill=INK, anchor='mm')


def connections():
    im = Image.new('RGB', (1400, 900), BG)
    d = ImageDraw.Draw(im)
    d.text((440, 30), 'How The Fantastical Logic Grid connects', font=font(28, True), fill=INK)
    d.text((440, 70), 'Every service here is on a free plan. Arrows show which way requests go.', font=font(16), fill=MUTED)
    PLAY, SERVE, CODE, OUT = '#E8F0FE', '#F1E8F7', '#E5F4E4', '#FFF4DE'
    box(d, (560, 120, 840, 220), 'Players', 'browser, Windows app, phone', PLAY, '#7FA7E8')
    box(d, (120, 300, 440, 420), 'Website', 'GitHub Pages: the game files\nthelogicgrid.com (domain + DNS)', PLAY, '#7FA7E8')
    box(d, (540, 300, 860, 440), 'Game server', 'Cloudflare Worker "flg-api"\naccounts, races, scores, admin', SERVE, HI)
    box(d, (960, 300, 1280, 420), 'Sign-in', 'Firebase Authentication\nplayers and the admin', SERVE, HI)
    box(d, (520, 520, 780, 630), 'Database', 'Cloudflare D1 "flg"\nsaves, scores, settings', SERVE, HI)
    box(d, (840, 520, 1100, 630), 'AI helpers', 'Workers AI: pictures, translation\nGemini / Google voices', SERVE, HI)
    box(d, (1140, 520, 1380, 630), 'Email out', 'Gmail: your reports\nResend: player emails', OUT, '#E2A93B')
    box(d, (80, 700, 420, 830), 'GitHub', 'the code, pull requests, issues\nActions: tests, nightly checks,\nyour emails, social posts', CODE, '#5FAF6A')
    box(d, (80, 110, 400, 210), 'Search engines', 'Google Search Console, Bing,\nIndexNow (new pages)', OUT, '#E2A93B')
    box(d, (560, 720, 880, 820), 'Social posting', 'Bluesky, Mastodon, X,\nFacebook, Instagram, Threads', OUT, '#E2A93B')
    arrow(d, (640, 220), (320, 300), 'loads the game')
    arrow(d, (700, 220), (700, 300), 'saves, races')
    arrow(d, (780, 220), (1060, 300), 'signs in')
    arrow(d, (1000, 400), (860, 400), 'checks tokens')
    arrow(d, (660, 440), (650, 520), 'reads, writes')
    arrow(d, (800, 440), (930, 520), 'asks')
    arrow(d, (860, 425), (1220, 520), 'sends')
    arrow(d, (250, 700), (250, 420), 'publishes')
    arrow(d, (420, 715), (545, 440), 'deploys')
    arrow(d, (240, 210), (240, 300), 'reads the pages', color='#C9A24B')
    arrow(d, (420, 790), (560, 790), 'posts ads')
    im.save(os.path.join(HERE, 'connections-map.png'))


def schedule():
    im = Image.new('RGB', (1400, 620), BG)
    d = ImageDraw.Draw(im)
    d.text((40, 30), "The game's daily and weekly routine (Eastern time)", font=font(28, True), fill=INK)
    x0, x1, y = 80, 1320, 230
    d.rounded_rectangle([x0, y - 6, x1, y + 6], 6, fill='#D6DBE4')
    for h in range(0, 25, 3):
        x = x0 + (x1 - x0) * h / 24
        d.line([x, y - 14, x, y + 14], fill='#AAB2C2', width=2)
        lab = '12 am' if h in (0, 24) else ('12 pm' if h == 12 else (f'{h} am' if h < 12 else f'{h - 12} pm'))
        d.text((x, y + 24), lab, font=font(14), fill=MUTED, anchor='mt')
    events = [(2, 'Cleanup + database tidy', 'Worker, 2:00 am', HI, -1),
              (2.33, 'Nightly checks', 'links, speed, security, 2:20 am', HI, 1),
              (3.0, 'Player report', '7:13 UTC (3:13 am)', '#E2A93B', -2),
              (7.2, 'Your to-do email', 'learning tasks, 7:13 am', '#5FAF6A', 1),
              (20.3, 'Daily puzzle published', '00:17 UTC (8:17 pm)', '#7FA7E8', -1)]
    for h, title, sub, color, lane in events:
        x = x0 + (x1 - x0) * h / 24
        ty = y - 40 - 70 * (abs(lane) - 1) if lane < 0 else y + 60 + 70 * (lane - 1)
        d.line([x, y, x, ty + (30 if lane < 0 else 0)], fill=color, width=2)
        d.ellipse([x - 8, y - 8, x + 8, y + 8], fill=color)
        tw = max(d.textlength(title, font=font(15, True)), d.textlength(sub, font=font(13))) + 20
        bx = min(max(x - 10, x0), x1 - tw)
        d.rounded_rectangle([bx, ty - 22, bx + tw, ty + 30], 10, fill='#FFFFFF', outline=color, width=2)
        d.text((bx + 10, ty - 16), title, font=font(15, True), fill=INK)
        d.text((bx + 10, ty + 6), sub, font=font(13), fill=MUTED)
    d.text((80, 420), 'Every 3 hours: health check of the website, server, database and update file (opens an issue if something is down).', font=font(16), fill=INK)
    d.text((80, 452), 'On every pull request: all the tests. On every merge to main: the website republishes and the server redeploys.', font=font(16), fill=INK)
    d.text((80, 484), 'Mondays: archive email (when switched on), the weekly summary, and the weekly improvement report and tuning.', font=font(16), fill=INK)
    d.text((80, 516), 'Weekly: Dependabot library updates. Small ones that pass the tests merge themselves; big ones wait for you.', font=font(16), fill=INK)
    d.text((80, 560), 'Times in UTC shift by an hour with daylight saving; the 2 am jobs follow New York time automatically.', font=font(14), fill=MUTED)
    im.save(os.path.join(HERE, 'maintenance-schedule.png'))


if __name__ == '__main__':
    tips(); welcome(); falling(); colors(); mixup(); connections(); schedule()
    print('ok')
