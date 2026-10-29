"""Edits the promo video from the clips that capture.cjs filmed.

  python3 media/promo/tools/build.py            # both cuts
  python3 media/promo/tools/build.py wide       # 16:9 only
  python3 media/promo/tools/build.py tall       # 9:16 only

For each cut it voices the script with Kokoro (am_michael, the game's own
narrator), times every scene to the voice and snaps cuts to the beat of the
music, composites the gameplay into a branded frame with Pillow, mixes the
voice over the original music and effects from sound.py (the music ducks under
the voice), and writes, into media/promo/out/:
  <cut>.mp4            clean picture, for sites that show captions themselves
  <cut>-captioned.mp4  captions burned in, for social feeds that autoplay muted
  <cut>.srt / .vtt     the captions
Free tools only: Kokoro-82M (Apache-2.0), ffmpeg, Pillow, numpy/scipy, and the
game's own fonts (Cinzel and Atkinson Hyperlegible, both OFL).
"""
import bisect, hashlib, json, math, os, subprocess, sys, textwrap, urllib.request, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import signal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sound  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PROMO = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(PROMO))
OUT = os.path.join(PROMO, 'out')
CLIPS = os.path.join(OUT, 'clips')
KDIR = os.environ.get('KOKORO_DIR', os.path.join(PROMO, '.kokoro'))
KURL = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/'
VOICE = os.environ.get('VOICE', 'am_michael')
SPEED = float(os.environ.get('SPEED', '1.04'))
FPS = 30
SR = sound.SR
BEAT = sound.BEAT
BAR = sound.BAR
LEAD, GAP, TAIL = 0.25, 0.16, 0.35
XF = 0.35  # crossfade between shots

GOLD = (245, 196, 81)
WHITE = (255, 255, 255)
SOFT = (227, 230, 246)
URL = 'thelogicgrid.com'

# ------------------------------------------------------------------ the script
# A scene: what is said (lines; a line can be [caption, spoken]), what is shown
# (kind + shots), the headline beside the footage, and the music part.
# Shot: (clip, in, out, zoom, follow); zoom is the share of the source frame's
# width the camera shows, follow how far it leans toward the pointer.
WIDE = [
    dict(kind='hook', part='intro', snap='bar', shots=[('grid', 3, 40, 0.75, 0.5)],
         beats=['EVERY PUZZLE\nTELLS A STORY', 'AND EVERY STORY\nIS BRAND NEW'],
         lines=['Every puzzle tells a story.', 'And every story is brand new.']),
    dict(kind='logo', part='drop', min=4.0,
         lines=['Welcome to The Fantastical Logic Grid!']),
    dict(kind='clip', part='full', kicker='Pick a world', head='14 themes', sub='New: Around Town, National Parks, Vacation Destinations and Architectural Wonders',
         shots=[('themes', 2.0, 24.5, 0.8, 0.55)],
         lines=['Pick from fourteen worlds.', 'Spooky mysteries, secret agents, fantasy and sci-fi, Around Town, National Parks, and more.']),
    dict(kind='clip', part='full', kicker='Choose your challenge', head='Basic to Quantum Physicist', sub='Six levels, from first-timers to masterminds',
         shots=[('tiers', 9.5, 24.8, 0.8, 0.5)],
         lines=[['Then choose your challenge, from Basic all the way up to Quantum Physicist.', 'Then choose your challenge, from Basic, all the way up to Quantum Physicist.']]),
    dict(kind='clip', part='full', kicker='Press Generate', head='A brand new story', sub='Written for you in seconds, and never repeated',
         shots=[('generate', 3.0, 6.3, 0.8, 0.6), ('generate', 6.4, 99, 0.85, 0.3)],
         lines=['Press Generate, and a one-of-a-kind story is written just for you.', 'No two cases are ever the same.']),
    dict(kind='clip', part='full', kicker='Talk to the cast', head='Every character has a clue',
         shots=[('cast', 4.5, 17.5, 0.72, 0.8)],
         lines=['Meet the characters, and hear the clues they remember, read aloud.']),
    dict(kind='clip', part='full', kicker='Solve the grid', head="Mark X's and O's",
         shots=[('grid', 1.5, 25, 0.68, 0.6)],
         lines=[["Then dive into the grid. Mark an X to rule something out, and an O to lock in a match.", 'Then dive into the grid. Mark an ex to rule something out, and an oh to lock in a match.']]),
    dict(kind='clip', part='full', kicker='Never stuck for long', head='Smart hints', sub='A nudge, the exact square, or the full reasoning',
         shots=[('hint', 3.5, 99, 0.7, 0.8)],
         lines=['Stuck? Smart hints guide you step by step, without spoiling the fun.']),
    dict(kind='clip', part='full', kicker='Bring it to life', head='Case closed!',
         shots=[('reveal', 0.1, 99, 0.85, 0.0), ('solve', 14.5, 99, 0.7, 0.6)],
         lines=['Every section you finish brings the scene to life,', 'until you crack the case!']),
    dict(kind='clip', part='full', kicker='Play against others', head='Race your friends', sub='Same puzzle, same moment. Fastest solve wins.',
         shots=[('race-start', 15.5, 99, 0.7, 0.5), ('race-play', 4.5, 8.5, 0.7, 0.5), ('race-play', 38.5, 99, 0.7, 0.6)],
         lines=['Race friends on the very same puzzle.', 'Share a code, or challenge any player by screen name.']),
    dict(kind='clip', part='full', kicker='Every solve earns points', head='Climb the scoreboard',
         shots=[('board', 6.0, 99, 0.72, 0.5)],
         lines=['Every solve earns points, so climb the weekly scoreboard and claim the top spot!']),
    dict(kind='clip', part='light', kicker='Yours to keep', head='Print it. Save it. Sync it.',
         shots=[('print', 3.5, 99, 0.8, 0.5), ('saved', 0.3, 99, 0.8, 0.6)],
         lines=['Print any puzzle with its answer key.', 'Your progress saves automatically, and a free account syncs it across your devices.']),
    dict(kind='clip', part='light', kicker='Made for everyone', head='Play your way', sub='Light, dark and high contrast. Keyboard and screen reader friendly.',
         shots=[('looks', 0.3, 99, 0.85, 0.0)],
         lines=['Play in light, dark, or high contrast, with full keyboard and screen reader support.']),
    dict(kind='clip', part='full', kicker='Free to play', head='Browser or desktop', sub='Play at thelogicgrid.com, or install the Windows app',
         shots=[('install', 2.5, 99, 0.8, 0.5)], snap='bar',
         lines=['Play free in your browser, or install the Windows desktop app.']),
    dict(kind='cta', part='outro', min=6.5,
         lines=['The Fantastical Logic Grid.', ['Your next case is waiting at thelogicgrid.com!', 'Your next case is waiting, at the logic grid dot com!']]),
]

TALL = [
    dict(kind='clip', part='intro', snap='bar', kicker='', head='Every puzzle tells a brand new story',
         shots=[('grid', 5, 40, 0.55, 0.9)],
         lines=['Every puzzle tells a brand new story.']),
    dict(kind='logo', part='drop', min=3.0,
         lines=['This is The Fantastical Logic Grid!']),
    dict(kind='clip', part='full', kicker='14 themes, 6 levels', head='Pick your world',
         shots=[('themes', 2.0, 24.5, 0.6, 0.9)],
         lines=[['Fourteen worlds, six levels, from Basic to Quantum Physicist.', 'Fourteen worlds. Six levels, from Basic, to Quantum Physicist.']]),
    dict(kind='clip', part='full', kicker='Never repeated', head='A story written for you',
         shots=[('generate', 6.4, 99, 0.6, 0.5)],
         lines=['And every case is written fresh, just for you.']),
    dict(kind='clip', part='full', kicker='Solve the grid', head="Mark X's and O's",
         shots=[('grid', 1.5, 25, 0.5, 0.95)],
         lines=[["Follow the clues, mark your X's and O's,", 'Follow the clues, mark your exes and ohs,']]),
    dict(kind='clip', part='full', kicker='', head='Case closed!', min=3.0,
         shots=[('solve', 14.5, 99, 0.62, 0.8)],
         lines=['and crack the case!']),
    dict(kind='clip', part='full', kicker='Play against others', head='Race your friends',
         shots=[('race-play', 12, 30, 0.5, 0.9), ('board', 6.0, 99, 0.6, 0.5)], snap='bar',
         lines=['Race your friends, and climb the scoreboard.']),
    dict(kind='cta', part='outro', min=5.0,
         lines=[['Play free at thelogicgrid.com!', 'Play free, at the logic grid dot com!']]),
]

# "How to play logic puzzles": a short vertical series for Reels, Shorts and
# TikTok, from the same footage and voice as the promo. One idea per video.
TIP_GRID = [
    dict(kind='clip', part='intro', snap='bar', kicker='How to play, part 1', head='The logic grid',
         shots=[('grid', 0.5, 12, 0.7, 0.6)],
         lines=["New to logic grid puzzles? Here's how they work."]),
    dict(kind='clip', part='full', kicker='Every square', head='is a pair',
         shots=[('grid', 1.5, 14, 0.5, 0.95)],
         lines=['Every square in the grid pairs two things from the story.']),
    dict(kind='clip', part='full', kicker="Can't go together?", head='Mark an X',
         shots=[('grid', 8, 22, 0.5, 0.95)],
         lines=[["If a clue says two things can't go together, mark an X.", "If a clue says two things can't go together, mark an ex."]]),
    dict(kind='clip', part='full', kicker='Must go together?', head='Mark an O',
         shots=[('grid', 14, 30, 0.5, 0.95)],
         lines=[['If they must go together, mark an O.', 'If they must go together, mark an oh.']]),
    dict(kind='clip', part='full', kicker='The golden rule', head='One O per row',
         shots=[('reveal', 0.5, 99, 0.55, 0.8)],
         lines=[['Each row has exactly one O, so the rest of that row is all X.', 'Each row has exactly one oh, so the rest of that row is all exes.']]),
    dict(kind='clip', part='full', kicker='', head='Case closed!', min=3.0,
         shots=[('solve', 14.5, 99, 0.62, 0.8)],
         lines=['Fill in every square, and the case is closed!']),
    dict(kind='cta', part='outro', min=5.0,
         lines=[['Try one free at thelogicgrid.com!', 'Try one free, at the logic grid dot com!']]),
]

TIP_CLUES = [
    dict(kind='clip', part='intro', snap='bar', kicker='How to play, part 2', head='Reading the clues',
         shots=[('cast', 0.5, 12, 0.6, 0.7)],
         lines=['Logic puzzle tip number two: reading the clues.']),
    dict(kind='clip', part='full', kicker='Every clue', head='is a fact',
         shots=[('cast', 1.0, 99, 0.6, 0.7)],
         lines=['Every clue is a fact you can mark on the grid.']),
    dict(kind='clip', part='full', kicker='Start easy', head="The X's come first",
         shots=[('grid', 1.5, 16, 0.5, 0.95)],
         lines=[["Start with the clues that say what is NOT true. They give you easy X's.", "Start with the clues that say what is not true. They give you easy exes."]]),
    dict(kind='clip', part='full', kicker='One square left?', head="It's the O",
         shots=[('grid', 12, 30, 0.5, 0.95)],
         lines=[['When only one square is left in a row, it has to be the O.', 'When only one square is left in a row, it has to be the oh.']]),
    dict(kind='clip', part='full', kicker='Carry it across', head='Grids talk to each other',
         shots=[('reveal', 0.5, 99, 0.55, 0.8)],
         lines=['What you learn in one grid carries across to the others.']),
    dict(kind='cta', part='outro', min=5.0,
         lines=[['Put it to the test at thelogicgrid.com!', 'Put it to the test, at the logic grid dot com!']]),
]

TIP_HINTS = [
    dict(kind='clip', part='intro', snap='bar', kicker='How to play, part 3', head='Stuck? Ask for a hint',
         shots=[('hint', 0.2, 6, 0.6, 0.6)],
         lines=["Stuck on a logic puzzle? Here's how to get moving again."]),
    dict(kind='clip', part='full', kicker='Press Hint', head='A gentle nudge',
         shots=[('hint', 0.8, 5.5, 0.55, 0.8)],
         lines=['Press Hint, and first you get a nudge toward the right clue.']),
    dict(kind='clip', part='full', kicker='Still stuck?', head='The exact square',
         shots=[('hint', 3.5, 99, 0.55, 0.8)],
         lines=['Ask again for the exact square, and then the full reasoning.']),
    dict(kind='clip', part='full', kicker='No guessing', head='Exactly one answer',
         shots=[('grid', 1.5, 25, 0.5, 0.95)],
         lines=['Every puzzle has exactly one answer, and you can always reach it by logic. No guessing needed.']),
    dict(kind='clip', part='full', kicker='', head='Case closed!', min=3.0,
         shots=[('solve', 14.5, 99, 0.62, 0.8)],
         lines=['Follow the clues, and crack the case!']),
    dict(kind='cta', part='outro', min=5.0,
         lines=[['Play free at thelogicgrid.com!', 'Play free, at the logic grid dot com!']]),
]

FORMATS = {
    'wide': dict(w=1920, h=1080, edit=WIDE, name='the-fantastical-logic-grid-promo-16x9'),
    'tall': dict(w=1080, h=1920, edit=TALL, name='the-fantastical-logic-grid-promo-9x16'),
    'tip-grid': dict(w=1080, h=1920, edit=TIP_GRID, name='how-to-play-1-the-grid-9x16'),
    'tip-clues': dict(w=1080, h=1920, edit=TIP_CLUES, name='how-to-play-2-the-clues-9x16'),
    'tip-hints': dict(w=1080, h=1920, edit=TIP_HINTS, name='how-to-play-3-hints-9x16'),
}
# With no names given, build.py makes the two promo cuts; `build.py tips` makes the series.
TIPS = ['tip-grid', 'tip-clues', 'tip-hints']


# ------------------------------------------------------------------ helpers
def ease(k):
    k = min(1.0, max(0.0, k))
    return 1 - (1 - k) ** 3


def ease_io(k):
    k = min(1.0, max(0.0, k))
    return 4 * k ** 3 if k < 0.5 else 1 - (-2 * k + 2) ** 3 / 2


def back(k):
    k = min(1.0, max(0.0, k))
    c = 1.9
    return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2


def fonts():
    d = os.path.join(OUT, 'fonts')
    os.makedirs(d, exist_ok=True)
    from fontTools.ttLib import TTFont
    names = {'cinzel': 'cinzel-700', 'a400': 'atkinson-400', 'a700': 'atkinson-700'}
    paths = {}
    for k, f in names.items():
        dst = os.path.join(d, f + '.ttf')
        if not os.path.exists(dst):
            t = TTFont(os.path.join(ROOT, 'web', 'fonts', f + '.woff2'))
            t.flavor = None
            t.save(dst)
        paths[k] = dst
    return paths


FONTS = None
_fc = {}


def font(k, size):
    if (k, size) not in _fc:
        _fc[(k, size)] = ImageFont.truetype(FONTS[k], size)
    return _fc[(k, size)]


def wrap(text, f, width):
    out = []
    for para in text.split('\n'):
        words, line = para.split(), ''
        for w in words:
            t = (line + ' ' + w).strip()
            if f.getlength(t) <= width or not line:
                line = t
            else:
                out.append(line)
                line = w
        out.append(line)
    return out


def text_layer(lines_spec, width, align='left'):
    """lines_spec: list of (text, font, color, gap_after). Returns RGBA image."""
    rows = []
    for text, f, color, gap in lines_spec:
        if not text:
            continue
        for i, ln in enumerate(wrap(text, f, width)):
            rows.append((ln, f, color, 0))
        rows[-1] = rows[-1][:3] + (gap,)
    if not rows:
        return Image.new('RGBA', (width, 1))
    hts = [r[1].getbbox('Ay')[3] + 12 + r[3] for r in rows]
    img = Image.new('RGBA', (width + 40, sum(hts) + 40))
    d = ImageDraw.Draw(img)
    y = 10
    for (ln, f, color, gap), h in zip(rows, hts):
        w = f.getlength(ln)
        x = 20 + (0 if align == 'left' else (width - w) / 2)
        d.text((x, y), ln, font=f, fill=color)
        y += h
    shadow = Image.new('RGBA', img.size, (0, 0, 0, 0))
    shadow.putalpha(img.getchannel('A').point(lambda a: a * 0.55).filter(ImageFilter.GaussianBlur(8)))
    out = Image.new('RGBA', img.size)
    out.alpha_composite(shadow, (0, 3))
    out.alpha_composite(img)
    return out


def fade(img, a):
    if a >= 0.999:
        return img
    im = img.copy()
    im.putalpha(im.getchannel('A').point(lambda v: int(v * max(0.0, a))))
    return im


def rounded_mask(w, h, r):
    m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w - 1, h - 1), r, fill=255)
    return m


def background(w, h):
    """Brand backdrop (the title-card look): deep indigo, purple and teal glows, faint grid."""
    W, H = w + 240, h + 240
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    k = (x / W * 0.35 + y / H * 0.65)
    base = np.stack([18 + (34 - 18) * k, 23 + (25 - 23) * k, 51 + (90 - 51) * k], -1)

    def glow(cx, cy, rx, ry, col, s):
        g = np.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2) * 1.6)[..., None]
        return g * np.array(col, np.float32) * s
    img = base + glow(W * 0.82, H * 0.12, W * 0.5, H * 0.55, (118, 86, 224), 0.75) + glow(W * 0.1, H * 0.9, W * 0.42, H * 0.45, (80, 200, 220), 0.35)
    img = np.clip(img, 0, 255).astype(np.uint8)
    im = Image.fromarray(img, 'RGB')
    d = ImageDraw.Draw(im, 'RGBA')
    step = 64
    for gx in range(0, W, step):
        d.line([(gx, 0), (gx, H)], fill=(255, 255, 255, 12))
    for gy in range(0, H, step):
        d.line([(0, gy), (W, gy)], fill=(255, 255, 255, 12))
    return im


# ------------------------------------------------------------------ clips
class Clip:
    def __init__(self, c):
        self.name = c['name']
        self.dur = c['duration']
        self.frames = c['frames']
        self.ts = [f['t'] for f in self.frames]
        self.clicks = c.get('clicks', [])
        pts = c.get('pointer') or []
        n = int(self.dur * FPS) + 2
        px = np.full(n, 960.0)
        py = np.full(n, 540.0)
        if pts:
            ts = np.array([p[0] for p in pts])
            for i in range(n):
                j = max(0, min(len(pts) - 1, np.searchsorted(ts, i / FPS, 'right') - 1))
                if i / FPS < ts[0]:
                    j = 0
                px[i], py[i] = pts[j][1], pts[j][2]
        # Zero-phase smoothing so the camera glides after the pointer.
        b, a = signal.butter(1, 0.9 / (FPS / 2))
        if n > 12:
            px, py = signal.filtfilt(b, a, px), signal.filtfilt(b, a, py)
        self.px, self.py = px, py
        self._cache = {}

    def load(self, i):
        if i not in self._cache:
            if len(self._cache) > 8:
                self._cache.pop(next(iter(self._cache)))
            self._cache[i] = Image.open(os.path.join(CLIPS, self.name, self.frames[i]['f'])).convert('RGB')
        return self._cache[i]

    def frame(self, t):
        # The screencast delivers about 7 frames a second, and only when the
        # page changes; dissolve into each new frame for smoother motion.
        i = max(0, bisect.bisect_right(self.ts, t) - 1)
        im = self.load(i)
        if i + 1 < len(self.ts):
            t1 = self.ts[i + 1]
            blend = min(0.16, t1 - self.ts[i])
            if t > t1 - blend:
                im = Image.blend(im, self.load(i + 1), (t - (t1 - blend)) / blend)
        return im

    def pointer(self, t):
        i = max(0, min(len(self.px) - 1, int(t * FPS)))
        return self.px[i], self.py[i]


# ------------------------------------------------------------------ voice
_tts = None


def tts():
    global _tts
    if _tts is None:
        os.makedirs(KDIR, exist_ok=True)
        for f in ('kokoro-v1.0.onnx', 'voices-v1.0.bin'):
            p = os.path.join(KDIR, f)
            if not os.path.exists(p):
                print(f'downloading {f}')
                urllib.request.urlretrieve(KURL + f, p + '.part')
                os.replace(p + '.part', p)
        from kokoro_onnx import Kokoro
        _tts = Kokoro(os.path.join(KDIR, 'kokoro-v1.0.onnx'), os.path.join(KDIR, 'voices-v1.0.bin'))
    return _tts


def voice(text):
    key = hashlib.sha1(f'{VOICE}|{SPEED}|{text}'.encode()).hexdigest()[:16]
    p = os.path.join(OUT, 'vo', key + '.npy')
    if os.path.exists(p):
        return np.load(p)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    samples, sr = tts().create(text, voice=VOICE, speed=SPEED, lang='en-us')
    a = signal.resample_poly(np.asarray(samples, np.float64), SR, sr)
    # Trim the model's leading and trailing silence so lines sit tight on the beat.
    nz = np.where(np.abs(a) > 0.01)[0]
    if len(nz):
        a = a[max(0, nz[0] - int(0.03 * SR)): nz[-1] + int(0.08 * SR)]
    np.save(p, a)
    return a


# ------------------------------------------------------------------ timeline
def plan(edit):
    t = 0.0
    out = []
    for sc in edit:
        lines = []
        cur = t + LEAD
        for ln in sc['lines']:
            cap, spoken = (ln if isinstance(ln, list) else (ln, ln))
            a = voice(spoken)
            d = len(a) / SR
            lines.append(dict(start=cur, end=cur + d, cap=cap, audio=a))
            cur += d + GAP
        need = max(cur - GAP + TAIL - t, sc.get('min', 0))
        unit = BAR if sc.get('snap') == 'bar' else BEAT
        dur = math.ceil(need / unit - 1e-6) * unit
        out.append(dict(sc, start=t, dur=dur, vo=lines))
        t += dur
    # The outro needs to start on a bar for the final hit.
    return out, t


# ------------------------------------------------------------------ compositor
class Cut:
    def __init__(self, fmt, scenes, total, clips):
        self.W, self.H = fmt['w'], fmt['h']
        self.tall = self.H > self.W
        self.scenes, self.total, self.clips = scenes, total, clips
        self.bg = background(self.W, self.H)
        W, H = self.W, self.H
        if self.tall:
            self.win = (40, 590, 1000, 1000)  # content box x, y, w, h (square)
            self.col = (60, 210, 960)          # headline x, y, width
        else:
            self.win = (470, 128, 1400, 788)
            self.col = (64, 230, 380)
        x, y, w, h = self.win
        self.chrome = 44
        self.frame_layer = self.window_frame(w, h)
        self.icon = Image.open(os.path.join(ROOT, 'web', 'icons', 'icon-1024.png')).convert('RGBA')
        self._heads = {}
        self._beats = {}

    def window_frame(self, w, h):
        c = self.chrome
        pad = 60
        img = Image.new('RGBA', (w + 2 * pad, h + c + 2 * pad))
        sh = Image.new('L', img.size, 0)
        ImageDraw.Draw(sh).rounded_rectangle((pad, pad + 18, pad + w, pad + h + c + 18), 22, fill=150)
        img.putalpha(sh.filter(ImageFilter.GaussianBlur(26)))
        body = Image.new('RGBA', (w, h + c), (246, 247, 252, 255))
        d = ImageDraw.Draw(body)
        d.rectangle((0, 0, w, c), fill=(232, 234, 245, 255))
        for i, col in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
            d.ellipse((18 + i * 24, c / 2 - 7, 32 + i * 24, c / 2 + 7), fill=col + (255,))
        pw = min(420, w - 200)
        d.rounded_rectangle(((w - pw) / 2, 8, (w + pw) / 2, c - 8), 12, fill=(255, 255, 255, 255))
        f = font('a700', 20)
        tw = f.getlength(URL)
        d.text(((w - tw) / 2, c / 2 - 12), URL, font=f, fill=(70, 72, 100, 255))
        img.paste(body, (pad, pad), rounded_mask(w, h + c, 22))
        return img, pad

    # -- pieces
    def head(self, sc):
        key = id(sc)
        if key not in self._heads:
            x, y, w = self.col
            big = 92 if self.tall else 66
            # Shrink the headline until its longest word fits the column.
            while big > 40 and max(font('cinzel', big).getlength(wd) for wd in sc.get('head', 'x').split()) > w - 10:
                big -= 2
            spec = [(sc.get('kicker', '').upper(), font('a700', 34 if self.tall else 26), GOLD, 10),
                    (sc.get('head', ''), font('cinzel', big), WHITE, 18),
                    (sc.get('sub', '') if not self.tall else '', font('a400', 30), SOFT, 0)]
            self._heads[key] = text_layer(spec, w, 'center' if self.tall else 'left')
        return self._heads[key]

    def beat_layer(self, text):
        if text not in self._beats:
            size = 120 if not self.tall else 96
            self._beats[text] = text_layer([(text, font('cinzel', size), WHITE, 0)], self.W - 160, 'center')
        return self._beats[text]

    def shot_at(self, sc, t):
        """Which shot of a scene plays at scene time t, and the clip time."""
        shots = sc['shots']
        n = len(shots)
        lens = []
        for clip, a, b, *_ in shots:
            b = min(b, self.clips[clip].dur)
            lens.append(max(0.3, b - a))
        share = sc['dur'] / sum(lens)
        bounds = np.cumsum([0] + [L * share for L in lens])
        i = min(n - 1, int(np.searchsorted(bounds, t, 'right') - 1))
        clip, a, b, zoom, follow = shots[i]
        L = lens[i]
        local = t - bounds[i]
        span = bounds[i + 1] - bounds[i]
        rate = min(4.0, max(1.0, L / span))
        return i, clip, a + local * rate, zoom, follow, bounds

    def camera(self, clip, ct, zoom, follow, aspect):
        c = self.clips[clip]
        sw, sh = 1920, 1080
        w = sw * zoom
        h = w / aspect
        if h > sh:
            h = sh
            w = h * aspect
        px, py = c.pointer(ct)
        cx = sw / 2 + (px - sw / 2) * follow
        cy = sh / 2 + (py - sh / 2) * follow
        cx = min(max(cx, w / 2), sw - w / 2)
        cy = min(max(cy, h / 2), sh - h / 2)
        return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)

    def content(self, sc, t, size):
        cw, ch = size
        i, clip, ct, zoom, follow, bounds = self.shot_at(sc, t)
        img = self.clips[clip].frame(ct).crop(tuple(int(round(v)) for v in self.camera(clip, ct, zoom, follow, cw / ch)))
        img = img.resize((cw, ch), Image.LANCZOS)
        # Crossfade into the next shot of the same scene.
        if i + 1 < len(sc['shots']) and bounds[i + 1] - t < XF:
            j, clip2, ct2, z2, f2, _ = self.shot_at(sc, bounds[i + 1] + 0.001)
            img2 = self.clips[clip2].frame(ct2).crop(tuple(int(round(v)) for v in self.camera(clip2, ct2, z2, f2, cw / ch))).resize((cw, ch), Image.LANCZOS)
            img = Image.blend(img2, img, (bounds[i + 1] - t) / XF)
        return img

    # -- scenes
    def draw(self, T):
        W, H = self.W, self.H
        drift = int(60 + 50 * math.sin(T / 9)), int(60 + 40 * math.cos(T / 11))
        frame = self.bg.crop((drift[0], drift[1], drift[0] + W, drift[1] + H)).convert('RGBA')
        k = max(0, bisect.bisect_right([s['start'] for s in self.scenes], T) - 1)
        sc = self.scenes[k]
        t = T - sc['start']
        prev = self.scenes[k - 1] if k > 0 else None
        nxt = self.scenes[k + 1] if k + 1 < len(self.scenes) else None
        getattr(self, 'draw_' + sc['kind'])(frame, sc, t, prev, nxt)
        return frame.convert('RGB')

    def place_window(self, frame, sc, t, appear, leave):
        x, y, w, h = self.win
        (layer, pad) = self.frame_layer
        s = 1.0
        a = 1.0
        if appear:
            k = ease(t / 0.55)
            s, a = 0.86 + 0.14 * k, k
        if leave is not None:
            k = ease(leave / 0.4)
            s, a = s * (1 - 0.08 * k), a * (1 - k)
        if a <= 0.01:
            return
        content = self.content(sc, t, (w, h)).convert('RGBA')
        win = layer.copy()
        win.paste(content, (pad, pad + self.chrome))
        # Round the bottom corners of the content.
        m = rounded_mask(w, h + self.chrome, 22)
        body = win.crop((pad, pad, pad + w, pad + h + self.chrome))
        win.paste((246, 247, 252, 0), (pad, pad, pad + w, pad + h + self.chrome))
        win.paste(body, (pad, pad), m)
        if s != 1.0:
            nw, nh = int(win.width * s), int(win.height * s)
            win = win.resize((nw, nh), Image.BILINEAR)
        win = fade(win, a)
        cx, cy = x + w / 2, y + (h + self.chrome) / 2 - self.chrome
        frame.alpha_composite(win, (int(cx - win.width / 2), int(cy - win.height / 2 + self.chrome / 2)))

    def place_head(self, frame, sc, t, leave_t=None):
        layer = self.head(sc)
        x, y, w = self.col
        k = ease((t - 0.08) / 0.5)
        dx = int((1 - k) * (-60 if not self.tall else 0))
        dy = int((1 - k) * (40 if self.tall else 0))
        a = k
        if leave_t is not None:
            a *= 1 - ease(leave_t / 0.25)
        if self.tall:
            yy = int(y + (330 - layer.height) / 2)
            frame.alpha_composite(fade(layer, a), (int(x - 20 + dx), yy + dy))
        else:
            yy = int(self.win[1] + (self.win[3] + self.chrome - layer.height) / 2 - 10)
            frame.alpha_composite(fade(layer, a), (int(x - 20 + dx), yy + dy))

    def draw_clip(self, frame, sc, t, prev, nxt):
        appear = not prev or prev['kind'] != 'clip'
        leave = (t - (sc['dur'] - 0.4)) if (nxt and nxt['kind'] != 'clip' and t > sc['dur'] - 0.4) else None
        self.place_window(frame, sc, t, appear, leave)
        lt = t - (sc['dur'] - 0.25) if t > sc['dur'] - 0.25 else None
        self.place_head(frame, sc, t, lt)

    def draw_hook(self, frame, sc, t, prev, nxt):
        W, H = self.W, self.H
        clip, a, b, zoom, follow = sc['shots'][0]
        c = self.clips[clip]
        ct = a + t * 3.0
        z = zoom * (1 - 0.06 * t / sc['dur'])
        img = c.frame(ct).crop(tuple(int(v) for v in self.camera(clip, ct, z, follow, W / H))).resize((W, H), Image.LANCZOS).convert('RGBA')
        dark = Image.new('RGBA', (W, H), (14, 16, 40, 175))
        img.alpha_composite(dark)
        frame.alpha_composite(img)
        # One kinetic headline per spoken line.
        for i, (txt, ln) in enumerate(zip(sc['beats'], sc['vo'])):
            s0 = ln['start'] - sc['start'] - 0.1
            s1 = sc['vo'][i + 1]['start'] - sc['start'] - 0.15 if i + 1 < len(sc['vo']) else sc['dur']
            if s0 <= t < s1:
                layer = self.beat_layer(txt)
                k = ease((t - s0) / 0.45)
                sc_ = 1.12 - 0.12 * k
                lay = layer.resize((int(layer.width * sc_), int(layer.height * sc_)), Image.BILINEAR)
                a = k * (1 - ease((t - (s1 - 0.2)) / 0.2) if t > s1 - 0.2 else k)
                frame.alpha_composite(fade(lay, a), (int((W - lay.width) / 2), int((H - lay.height) / 2)))
        # Flash to white into the logo.
        if t > sc['dur'] - 0.25:
            fl = Image.new('RGBA', (W, H), (255, 255, 255, int(255 * ease((t - (sc['dur'] - 0.25)) / 0.25) * 0.85)))
            frame.alpha_composite(fl)

    def logo_block(self, frame, t, cy, title_size, sub, sub2=None, pop=True):
        W, H = self.W, self.H
        k = back(t / 0.7) if pop else 1
        size = int((300 if not self.tall else 340) * max(0.01, k))
        if size > 4:
            # Glow behind the icon.
            g = Image.new('RGBA', (size * 2, size * 2))
            ImageDraw.Draw(g).ellipse((size * 0.3, size * 0.3, size * 1.7, size * 1.7), fill=(150, 120, 255, 120))
            g = g.filter(ImageFilter.GaussianBlur(size * 0.18))
            frame.alpha_composite(g, (int(W / 2 - size), int(cy - size)))
            ic = self.icon.resize((size, size), Image.LANCZOS)
            frame.alpha_composite(ic, (int(W / 2 - size / 2), int(cy - size / 2)))
        ty = cy + (190 if not self.tall else 220)
        kt = ease((t - 0.35) / 0.6)
        title = self.beat_layer_cached('The Fantastical Logic Grid', title_size)
        frame.alpha_composite(fade(title, kt), (int((W - title.width) / 2), int(ty + (1 - kt) * 30)))
        if sub:
            ks = ease((t - 0.7) / 0.6)
            s = self.text_cached(sub, 'a700', 40 if not self.tall else 46, GOLD)
            frame.alpha_composite(fade(s, ks), (int((W - s.width) / 2), int(ty + title.height + (1 - ks) * 20)))
            if sub2:
                ks2 = ease((t - 1.0) / 0.6)
                s2 = self.text_cached(sub2, 'a400', 34 if not self.tall else 40, SOFT)
                frame.alpha_composite(fade(s2, ks2), (int((W - s2.width) / 2), int(ty + title.height + s.height + (1 - ks2) * 20)))

    def beat_layer_cached(self, text, size):
        k = ('title', text, size)
        if k not in self._beats:
            self._beats[k] = text_layer([(text, font('cinzel', size), WHITE, 0)], self.W - 120, 'center')
        return self._beats[k]

    def text_cached(self, text, f, size, color):
        k = ('t', text, f, size)
        if k not in self._beats:
            self._beats[k] = text_layer([(text, font(f, size), color, 0)], self.W - 120, 'center')
        return self._beats[k]

    def draw_logo(self, frame, sc, t, prev, nxt):
        W, H = self.W, self.H
        cy = H * (0.36 if not self.tall else 0.36)
        self.logo_block(frame, t, cy, 96 if not self.tall else 84, 'STORY LOGIC PUZZLES', None)
        # White flash fading out from the hook.
        if t < 0.35:
            frame.alpha_composite(Image.new('RGBA', (W, H), (255, 255, 255, int(255 * 0.85 * (1 - ease(t / 0.35))))))
        if t > sc['dur'] - 0.3:
            frame.alpha_composite(Image.new('RGBA', (W, H), (18, 23, 51, int(200 * ease((t - (sc['dur'] - 0.3)) / 0.3)))))

    def draw_cta(self, frame, sc, t, prev, nxt):
        W, H = self.W, self.H
        cy = H * (0.3 if not self.tall else 0.32)
        self.logo_block(frame, t, cy, 96 if not self.tall else 84, None)
        # The address, big, in a pill.
        k = back((t - 0.9) / 0.6)
        if k > 0.01:
            f = font('a700', 64 if not self.tall else 70)
            tw = f.getlength(URL)
            pw, ph = int(tw + 110), 120
            pill = Image.new('RGBA', (pw, ph))
            d = ImageDraw.Draw(pill)
            d.rounded_rectangle((0, 0, pw - 1, ph - 1), ph // 2, fill=GOLD + (255,))
            d.text(((pw - tw) / 2, ph / 2 - 40), URL, font=f, fill=(24, 22, 60, 255))
            s = max(0.01, k)
            pl = pill.resize((max(1, int(pw * s)), max(1, int(ph * s))), Image.BILINEAR)
            title = self.beat_layer_cached('The Fantastical Logic Grid', 96 if not self.tall else 84)
            py = cy + (190 if not self.tall else 220) + title.height + 10
            frame.alpha_composite(pl, (int((W - pl.width) / 2), int(py + (ph - pl.height) / 2)))
            ks = ease((t - 1.4) / 0.6)
            s1 = self.text_cached('PLAY FREE IN YOUR BROWSER  ·  WINDOWS DESKTOP APP', 'a700', 30 if not self.tall else 30, SOFT)
            frame.alpha_composite(fade(s1, ks), (int((W - s1.width) / 2), int(py + ph + 30)))
        if t < 0.3:
            frame.alpha_composite(Image.new('RGBA', (W, H), (255, 255, 255, int(255 * 0.6 * (1 - ease(t / 0.3))))))
        if t > sc['dur'] - 0.6:
            frame.alpha_composite(Image.new('RGBA', (W, H), (0, 0, 0, int(255 * ease((t - (sc['dur'] - 0.6)) / 0.6)))))


# ------------------------------------------------------------------ audio
def mix(scenes, total, clips, cut):
    n = int((total + 0.5) * SR)
    vo = np.zeros(n)
    for sc in scenes:
        for ln in sc['vo']:
            i = int(ln['start'] * SR)
            a = ln['audio'][: n - i]
            vo[i:i + len(a)] += a
    sections = [(sc['start'], sc['part']) for sc in scenes]
    mus = sound.music(total, sections)[:n]
    fx = np.zeros((n, 2))
    starts = [sc['start'] for sc in scenes]
    for k, sc in enumerate(scenes):
        t0 = sc['start']
        if sc['kind'] == 'logo':
            r = sound.riser(1.6)
            sound.add(fx, r, t0 - 1.6, 0.35)
            sound.add(fx, sound.impact(), t0, 0.7)
            sound.add(fx, sound.chime(), t0 + 0.4, 0.25)
        elif sc['kind'] == 'cta':
            sound.add(fx, sound.impact(), t0, 0.55)
            sound.add(fx, sound.chime(), t0 + 0.9, 0.3)
        elif k > 0:
            sound.add(fx, sound.whoosh(0.5, k % 2 == 0), t0 - 0.25, 0.22 if scenes[k - 1]['kind'] == 'clip' else 0.3, 0.4 if k % 2 else -0.4)
        # Clicks in the footage, at the moment they happen on screen.
        if sc['kind'] == 'clip':
            cut_obj = cut
            seen = set()
            for tt in np.arange(0, sc['dur'], 1 / FPS):
                i, clip, ct, *_ = cut_obj.shot_at(sc, tt)
                for c in clips[clip].clicks:
                    key = (i, c)
                    if key not in seen and ct >= c:
                        seen.add(key)
                        if ct - c < 0.2:
                            sound.add(fx, sound.pop(), t0 + tt, 0.16, 0.0)
            if sc.get('head') == 'Case closed!':
                # Chime when the case is solved (the last click of the solve).
                for tt in np.arange(0, sc['dur'], 1 / FPS):
                    i, clip, ct, *_ = cut_obj.shot_at(sc, tt)
                    if clip == 'solve' and clips['solve'].clicks and ct >= clips['solve'].clicks[-1]:
                        sound.add(fx, sound.chime(), t0 + tt + 0.15, 0.35)
                        break
    # Duck the music under the voice.
    envl = np.abs(vo)
    b, a = signal.butter(1, 6 / (SR / 2))
    envl = signal.filtfilt(b, a, envl)
    envl = np.clip(envl / (np.percentile(envl[envl > 1e-4], 90) if np.any(envl > 1e-4) else 1), 0, 1)
    duck = 1 - 0.62 * np.clip(signal.filtfilt(*signal.butter(1, 3 / (SR / 2)), np.minimum(1, envl * 3)), 0, 1)
    out = mus * 0.62 * duck[:, None] + fx + vo[:, None] * 1.0
    out = out / max(1e-6, np.max(np.abs(out))) * 0.95
    return out


def write_wav(path, x):
    a = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(a.tobytes())


def ts(x, sep):
    h, m, s = int(x // 3600), int(x % 3600 // 60), x % 60
    return f'{h:02d}:{m:02d}:{int(s):02d}{sep}{int(round((s - int(s)) * 1000)):03d}'


def captions(scenes, name, tall):
    cues = []
    for sc in scenes:
        for ln in sc['vo']:
            cues.append((ln['start'], ln['end'] + 0.25, ln['cap']))
    cues = [(a, min(b, cues[i + 1][0] - 0.02) if i + 1 < len(cues) else b, c) for i, (a, b, c) in enumerate(cues)]
    width = 30 if tall else 52
    wrapc = lambda c: '\n'.join(textwrap.wrap(c, width))
    with open(os.path.join(OUT, name + '.srt'), 'w') as f:
        for i, (a, b, c) in enumerate(cues, 1):
            f.write(f'{i}\n{ts(a, ",")} --> {ts(b, ",")}\n{wrapc(c)}\n\n')
    with open(os.path.join(OUT, name + '.vtt'), 'w') as f:
        f.write('WEBVTT\n\n')
        for i, (a, b, c) in enumerate(cues, 1):
            f.write(f'{i}\n{ts(a, ".")} --> {ts(b, ".")}\n{wrapc(c)}\n\n')
    ats = lambda x: f'{int(x // 3600)}:{int(x % 3600 // 60):02d}:{x % 60:05.2f}'
    W, H = (1080, 1920) if tall else (1920, 1080)
    size, mv = (54, 150) if tall else (40, 22)
    with open(os.path.join(OUT, name + '.ass'), 'w') as f:
        f.write(f'[Script Info]\nScriptType: v4.00+\nPlayResX: {W}\nPlayResY: {H}\nWrapStyle: 0\n\n[V4+ Styles]\n'
                'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
                f'Style: Cap,Atkinson Hyperlegible,{size},&H00FFFFFF,&H00FFFFFF,&H30101028,&H30101028,1,0,0,0,100,100,0,0,3,12,0,2,80,80,{mv},1\n\n'
                '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n')
        for a, b, c in cues:
            f.write(f'Dialogue: 0,{ats(a)},{ats(b)},Cap,,0,0,0,,' + r'\N'.join(textwrap.wrap(c, width)) + '\n')
    return cues


def build(key):
    fmt = FORMATS[key]
    data = json.load(open(os.path.join(OUT, 'clips.json')))
    clips = {c['name']: Clip(c) for c in data['clips']}
    scenes, total = plan(fmt['edit'])
    print(f'{key}: {total:.1f} s, {len(scenes)} scenes')
    for sc in scenes:
        print(f"  {sc['start']:6.2f} {sc['dur']:5.2f} {sc['kind']:5} {sc.get('head') or sc['lines'][0]}")
    cut = Cut(fmt, scenes, total, clips)
    name = fmt['name']
    audio = os.path.join(OUT, name + '.wav')
    write_wav(audio, mix(scenes, total, clips, cut))
    captions(scenes, name, cut.tall)
    fdir = os.path.join(OUT, 'fonts')
    W, H = fmt['w'], fmt['h']
    enc = ['-c:v', 'libx264', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-r', str(FPS), '-profile:v', 'high',
           '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']
    ff = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                           '-i', audio, '-filter_complex',
                           f"[0:v]split[v1][v2];[v2]subtitles={os.path.join(OUT, name + '.ass')}:fontsdir={fdir}[vc];"
                           '[1:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,asplit[a1][a2]',
                           '-map', '[v1]', '-map', '[a1]', '-crf', '20', *enc, '-t', f'{total:.3f}', os.path.join(OUT, name + '.mp4'),
                           '-map', '[vc]', '-map', '[a2]', '-crf', '20', *enc, '-t', f'{total:.3f}', os.path.join(OUT, name + '-captioned.mp4')],
                          stdin=subprocess.PIPE)
    nframes = int(round(total * FPS))
    for i in range(nframes):
        ff.stdin.write(cut.draw(i / FPS).tobytes())
        if i % 150 == 0:
            print(f'  frame {i}/{nframes}', flush=True)
    ff.stdin.close()
    if ff.wait():
        raise SystemExit('ffmpeg failed')
    # A still for the post's thumbnail.
    k = [s for s in scenes if s['kind'] == 'cta'][0]
    cut.draw(k['start'] + 2.4).save(os.path.join(OUT, name + '-thumbnail.png'))
    print(f'wrote {name}.mp4, {name}-captioned.mp4, captions and thumbnail')


if __name__ == '__main__':
    FONTS = fonts()
    which = [n for a in sys.argv[1:] for n in (TIPS if a == 'tips' else [a]) if n in FORMATS] or ['wide', 'tall']
    for k in which:
        build(k)
