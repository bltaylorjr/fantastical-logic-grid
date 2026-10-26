"""Original music and sound effects for the promo, synthesised from scratch with
numpy, so there is nothing to license: the track and every effect are made
here, by this code, and belong to the project.

music(total, sections) -> an upbeat 120 BPM track in D major (Bm-G-D-A),
with drums, bass, a pumping pad, a plucked arpeggio and a bell melody. The
arrangement follows the edit: `sections` is a list of (start_seconds, part)
with part one of intro, build, drop, full, light, outro.
"""
import numpy as np
from scipy import signal

SR = 48000
BPM = 120
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env(n, a=0.005, d=0.2, s=0.0, r=0.05, hold=None):
    """Attack-decay-sustain-release envelope over n samples."""
    t = np.arange(n) / SR
    hold = n / SR if hold is None else hold
    e = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    rel = np.clip((t - hold) / max(r, 1e-6), 0, 1)
    return e * (1 - rel)


def lp(x, f, order=2):
    b, a = signal.butter(order, min(f, SR / 2 - 100) / (SR / 2), 'low')
    return signal.lfilter(b, a, x)


def hp(x, f, order=2):
    b, a = signal.butter(order, f / (SR / 2), 'high')
    return signal.lfilter(b, a, x)


def bp(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (SR / 2), min(hi, SR / 2 - 100) / (SR / 2)], 'band')
    return signal.lfilter(b, a, x)


def saw(f, n, phase=0.0):
    t = np.arange(n) / SR
    return 2 * ((f * t + phase) % 1) - 1


def add(buf, x, at, gain=1.0, pan=0.0):
    """Mix mono x into stereo buf at time `at` (seconds), constant-power pan."""
    i = int(round(at * SR))
    if i >= len(buf) or i + len(x) <= 0:
        return
    if i < 0:
        x, i = x[-i:], 0
    x = x[: len(buf) - i]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[i:i + len(x), 0] += x * gain * l * 1.414
    buf[i:i + len(x), 1] += x * gain * r * 1.414


def reverb(buf, secs=1.8, wet=0.25):
    n = int(secs * SR)
    t = np.arange(n) / SR
    out = np.zeros_like(buf)
    for c in range(2):
        ir = rng.standard_normal(n) * np.exp(-t * 6.9 / secs)
        ir = lp(ir, 6000)
        ir[: int(0.012 * SR)] = 0
        ir /= np.sqrt(np.sum(ir ** 2))
        out[:, c] = signal.fftconvolve(buf[:, c], ir)[: len(buf)]
    return buf + out * wet


# ---------------------------------------------------------------- drums
def kick():
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 45 + 110 * np.exp(-t * 28)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)
    x += 0.4 * np.exp(-t * 300) * rng.standard_normal(n) * 0.3
    return np.tanh(x * 1.6)


def clap():
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    noise = bp(rng.standard_normal(n), 900, 5000)
    e = np.zeros(n)
    for k, off in enumerate((0, 0.011, 0.022)):
        e += (t >= off) * np.exp(-np.clip(t - off, 0, None) * (90 if k < 2 else 16))
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.4
    return (noise * e + tone) * 0.8


def hat(open_=False):
    n = int((0.25 if open_ else 0.06) * SR)
    t = np.arange(n) / SR
    x = hp(rng.standard_normal(n), 7500)
    return x * np.exp(-t * (14 if open_ else 70)) * 0.5


def crash():
    n = int(2.2 * SR)
    t = np.arange(n) / SR
    x = hp(rng.standard_normal(n), 4000) * np.exp(-t * 2.2)
    return x * 0.6


# ---------------------------------------------------------------- tones
def supersaw(freqs, n, cutoff=2600):
    x = np.zeros(n)
    for f in freqs:
        for d in (-0.18, -0.08, 0, 0.08, 0.18):
            x += saw(f * 2 ** (d / 12), n, rng.random())
    return lp(x / (len(freqs) * 5), cutoff)


def pluck(f, dur=0.22, bright=5000):
    n = int(dur * SR)
    x = 0.6 * saw(f, n) + 0.4 * np.sign(np.sin(2 * np.pi * f * np.arange(n) / SR))
    return lp(x, bright) * env(n, 0.002, 0.09, 0, 0.03)


def bell(f, dur=0.9):
    n = int(dur * SR)
    t = np.arange(n) / SR
    mod = np.sin(2 * np.pi * f * 3.5 * t) * 2.2 * np.exp(-t * 6)
    return np.sin(2 * np.pi * f * t + mod) * np.exp(-t * 3.2) * env(n, 0.003, 10, 1, 0.05)


def bass_note(f, dur):
    n = int(dur * SR)
    x = saw(f, n) * 0.7 + np.sin(2 * np.pi * f * np.arange(n) / SR) * 0.6
    return np.tanh(lp(x, 900) * 1.3) * env(n, 0.004, 0.25, 0.6, 0.03, hold=dur - 0.03)


# D major: Bm - G - D - A
CHORDS = [(59, [59, 62, 66]), (55, [55, 59, 62]), (50, [57, 62, 66]), (57, [57, 61, 64])]
# Bell melody, two bars per line, (eighth-note slot, midi, length in eighths).
MELODY = [
    [(0, 78, 2), (2, 74, 1), (3, 78, 1), (4, 83, 3), (7, 81, 1), (8, 79, 2), (10, 83, 2), (12, 86, 3), (15, 83, 1)],
    [(0, 81, 2), (2, 78, 1), (3, 81, 1), (4, 86, 2), (6, 85, 2), (8, 81, 2), (10, 76, 2), (12, 78, 4)],
]


def music(total, sections):
    buf = np.zeros((int((total + 3) * SR), 2))
    pad_bus = np.zeros_like(buf)
    K, C, H, HO, CR = kick(), clap(), hat(), hat(True), crash()
    part_at = lambda t: [p for s, p in sections if s <= t + 1e-6][-1] if any(s <= t + 1e-6 for s, _ in sections) else sections[0][1]
    nbars = int(np.ceil(total / BAR))
    starts = {round(s / BAR) for s, p in sections if p in ('drop', 'full')}
    for b in range(nbars):
        t0 = b * BAR
        part = part_at(t0 + 0.01)
        root, tones = CHORDS[b % 4]
        drums = part in ('drop', 'full', 'build')
        full = part in ('drop', 'full')
        if b in starts:
            add(buf, CR, t0, 0.35, 0.2)
        # Drums
        for beat in range(4):
            tb = t0 + beat * BEAT
            if full or (part == 'build' and beat in (0, 2)) or (part == 'light' and beat == 0):
                add(buf, K, tb, 0.85)
            if full and beat in (1, 3):
                add(buf, C, tb, 0.42, 0.05)
            if drums or part == 'light':
                for e in range(2 if part == 'light' else 4):
                    step = BEAT / (2 if part == 'light' else 4)
                    swing = 0.012 if e % 2 else 0
                    add(buf, H, tb + e * step + swing, 0.16 if e % 2 else 0.24, 0.3)
            if full:
                add(buf, HO, tb + BEAT / 2, 0.12, -0.3)
        if part == 'build' and b < nbars - 1 and part_at(t0 + BAR + 0.01) in ('drop', 'full'):
            # Snare roll into the drop.
            for k in range(16):
                add(buf, C, t0 + BAR / 2 + k * BAR / 32, 0.1 + 0.3 * k / 16, 0)
        # Bass: eighth notes, octave bounce
        if part != 'intro':
            for e in range(8):
                f = hz(root - 24 + (12 if e % 2 else 0))
                if part == 'light' and e % 2:
                    continue
                add(buf, bass_note(f, BEAT / 2 * 0.92), t0 + e * BEAT / 2, 0.42 if full else 0.3)
        # Pad, pumped by the kick in full parts
        n = int(BAR * SR)
        pad = supersaw([hz(m) for m in tones] + [hz(tones[0] - 12)], n, 1400 if part == 'intro' else 2800)
        pad *= env(n, 0.08, 10, 1, 0.12)
        if full or part == 'build':
            ph = (np.arange(n) / SR) % BEAT
            pad *= 0.35 + 0.65 * np.clip(ph / 0.22, 0, 1) ** 0.8
        add(pad_bus, pad, t0, 0.7 if part != 'intro' else 0.9)
        # Plucked arpeggio, sixteenth notes
        if part in ('drop', 'full', 'build', 'light', 'intro'):
            arp = tones + [tones[0] + 12, tones[1] + 12, tones[2], tones[1]]
            for k in range(16):
                m = arp[k % len(arp)] + 12
                cut = 1800 if part == 'intro' else 5200
                add(buf, pluck(hz(m), bright=cut), t0 + k * BEAT / 4, 0.1 if part != 'intro' else 0.22, 0.35 if k % 2 else -0.35)
        # Bell melody on the strong parts
        if full:
            line = MELODY[(b // 2) % 2]
            half = b % 2
            for slot, m, ln in line:
                if (slot >= 8) == bool(half):
                    add(buf, bell(hz(m), ln * BEAT / 2 + 0.4), t0 + (slot - 8 * half) * BEAT / 2, 0.16, 0.1)
    # Ending: the loop stops on the outro's downbeat and a big D major chord rings out.
    outs = [s for s, p in sections if p == 'outro']
    if outs:
        t0 = outs[0]
        i = int(t0 * SR)
        buf[i:] = 0
        pad_bus[i:] = 0
        n = int(4 * SR)
        add(buf, CR, t0, 0.4)
        add(buf, K, t0, 1.0)
        for m in (74, 78, 81, 86):
            add(buf, bell(hz(m), 3.0), t0, 0.12)
        add(buf, bass_note(hz(38), 2.5), t0, 0.5)
        add(pad_bus, supersaw([hz(m) for m in (62, 66, 69, 74, 50)], n, 3000) * env(n, 0.01, 1.6, 0.0, 0.1), t0, 0.45)
    mix = reverb(buf + pad_bus, 1.6, 0.18)
    mix = mix[: int((total + 3) * SR)]
    peak = np.max(np.abs(mix)) or 1
    return np.tanh(mix / peak * 1.2) * 0.8


# ---------------------------------------------------------------- effects
def whoosh(dur=0.6, up=True):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    out = np.zeros(n)
    hop = 512
    for i in range(0, n, hop):
        k = i / n
        f = 300 + (5000 if up else 2500) * (k if up else 1 - k) ** 1.5
        seg = x[max(0, i - 2048): i + hop]
        y = bp(seg, f * 0.6, f * 1.6)[-min(hop, n - i):]
        out[i:i + len(y)] = y
    e = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2
    return out * e * 0.9


def riser(dur=2.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 200 * 2 ** (3 * t / dur)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25
    noise = whoosh(dur, True) * 0.8
    return (tone + noise) * (t / dur) ** 2


def impact():
    n = int(2.0 * SR)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(30 + 90 * np.exp(-t * 9)) / SR) * np.exp(-t * 2.6)
    hit = lp(rng.standard_normal(n), 3000) * np.exp(-t * 14) * 0.6
    return np.tanh((boom + hit) * 1.5) * 0.9


def chime():
    out = np.zeros(int(1.7 * SR))
    for k, m in enumerate((74, 78, 81, 86)):
        x = bell(hz(m), 1.4)
        i = int(k * 0.07 * SR)
        out[i:i + len(x)] += x * 0.35
    return out


def pop():
    n = int(0.08 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * (500 + 900 * np.exp(-t * 60)) * t) * np.exp(-t * 55) * 0.5


def tick():
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 2500) * np.exp(-t * 180) * 0.35


def ding():
    out = bell(hz(88), 1.2) * 0.5 + bell(hz(93), 1.2) * 0.3
    return out
