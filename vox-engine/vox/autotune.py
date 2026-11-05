"""Auto-Tune: pitch correction for any voice, from subtle polish to the hard
robotic effect, plus singing-style vibrato. Written from scratch with
TD-PSOLA (pitch-synchronous overlap-add): each vocal-cord pulse is cut out and
re-spaced, so pitch changes while the voice's character (formants) stays.

    from vox.autotune import autotune, PRESETS
    out = autotune(wav, 24000, preset="hard", key="A", scale="minor")

Options
  key           C, C#, D ... B
  scale         chromatic, major, minor, pentatonic, minor_pentatonic, blues,
                dorian, harmonic_minor, monotone (one note: robot / chant)
  retune_ms     how fast pitch snaps to the note: 0 = instant (the famous
                hard-tune effect), 20-50 = pop polish, 100+ = gentle
  amount        0..1, how far toward the note to pull
  humanize      0..1, keep some natural drift on held notes
  transpose     semitones up/down (e.g. -5 for a giant, +7 for a pixie)
  vibrato_rate  Hz (5-6 sounds like singing), vibrato_depth in cents
  mix           0..1 blend of corrected and original voice
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, fields

import numpy as np

from .audio import track_pitch

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLATS = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"}
SCALES = {
    "chromatic": list(range(12)),
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "pentatonic": [0, 2, 4, 7, 9],
    "minor_pentatonic": [0, 3, 5, 7, 10],
    "blues": [0, 3, 5, 6, 7, 10],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "harmonic_minor": [0, 2, 3, 5, 7, 8, 11],
    "monotone": [],
}


@dataclass
class AutoTuneSettings:
    key: str = "C"
    scale: str = "chromatic"
    retune_ms: float = 50.0
    amount: float = 1.0
    humanize: float = 0.0
    transpose: float = 0.0
    vibrato_rate: float = 0.0
    vibrato_depth: float = 0.0
    mix: float = 1.0

    def validate(self) -> "AutoTuneSettings":
        self.key = FLATS.get(self.key, self.key)
        if self.key not in NOTE_NAMES:
            raise ValueError(f"Unknown key '{self.key}'. Use one of {', '.join(NOTE_NAMES)}.")
        if self.scale not in SCALES:
            raise ValueError(f"Unknown scale '{self.scale}'. Use one of {', '.join(SCALES)}.")
        self.amount = float(np.clip(self.amount, 0, 1))
        self.humanize = float(np.clip(self.humanize, 0, 1))
        self.mix = float(np.clip(self.mix, 0, 1))
        self.retune_ms = float(np.clip(self.retune_ms, 0, 1000))
        self.transpose = float(np.clip(self.transpose, -12, 12))
        self.vibrato_rate = float(np.clip(self.vibrato_rate, 0, 12))
        self.vibrato_depth = float(np.clip(self.vibrato_depth, 0, 200))
        return self


PRESETS: dict[str, dict] = {
    "subtle":  {"retune_ms": 140, "amount": 0.5, "humanize": 0.6, "label": "Gentle polish, still natural"},
    "natural": {"retune_ms": 80, "amount": 0.8, "humanize": 0.35, "label": "Clearly in tune, human"},
    "pop":     {"retune_ms": 25, "amount": 1.0, "humanize": 0.1, "label": "Modern pop vocal"},
    "hard":    {"retune_ms": 0, "amount": 1.0, "humanize": 0.0, "label": "Hard-tune robotic effect"},
    "robot":   {"retune_ms": 0, "amount": 1.0, "scale": "monotone", "label": "One flat note: robot, golem, AI"},
    "bard":    {"retune_ms": 40, "amount": 0.9, "scale": "major", "vibrato_rate": 5.5, "vibrato_depth": 35,
                "humanize": 0.2, "label": "Sing-song with vibrato"},
    "giant":   {"retune_ms": 60, "amount": 0.3, "transpose": -5, "humanize": 0.5, "label": "Deeper, bigger creature"},
    "pixie":   {"retune_ms": 30, "amount": 0.7, "transpose": 7, "scale": "pentatonic", "label": "Tiny, sparkly creature"},
}


def settings_from(spec: str | dict | AutoTuneSettings | None) -> AutoTuneSettings | None:
    """'pop' | {'preset': 'bard', 'key': 'D'} | {'retune_ms': 10, ...} -> settings."""
    if spec is None or spec is False or spec == "off" or spec == {}:
        return None
    if isinstance(spec, AutoTuneSettings):
        return spec.validate()
    if isinstance(spec, str):
        spec = {"preset": spec}
    spec = dict(spec)
    if spec.pop("enabled", True) is False:
        return None
    base = {}
    if "preset" in spec:
        name = spec.pop("preset")
        if name in (None, "", "off", "custom"):
            pass
        elif name not in PRESETS:
            raise ValueError(f"Unknown auto-tune preset '{name}'. Use one of {', '.join(PRESETS)}.")
        else:
            base = {k: v for k, v in PRESETS[name].items() if k != "label"}
    allowed = {f.name for f in fields(AutoTuneSettings)}
    base.update({k: v for k, v in spec.items() if k in allowed and v is not None})
    return AutoTuneSettings(**base).validate()


# ------------------------------------------------------------------ pitch plan
def _target_notes(midi: np.ndarray, voiced: np.ndarray, s: AutoTuneSettings) -> np.ndarray:
    root = NOTE_NAMES.index(s.key)
    if s.scale == "monotone":
        med = np.median(midi[voiced]) if voiced.any() else 60.0
        return np.full_like(midi, round(med))
    allowed = np.array(sorted({(root + d) % 12 for d in SCALES[s.scale]}))
    out = np.zeros_like(midi)
    prev = None
    for i, m in enumerate(midi):
        if not voiced[i]:
            prev = None
            continue
        # nearest allowed note, with hysteresis so it doesn't flicker between two notes
        base = np.floor(m / 12) * 12
        cands = np.concatenate([base - 12 + allowed, base + allowed, base + 12 + allowed])
        best = cands[np.argmin(np.abs(cands - m))]
        if prev is not None and abs(m - prev) < 0.65 and prev % 12 in allowed:
            best = prev
        out[i] = prev = best
    return out


def pitch_plan(wav: np.ndarray, sr: int, s: AutoTuneSettings, hop: int):
    """Returns (f0 per frame, correction in semitones per frame)."""
    f0 = track_pitch(wav, sr, hop, fmin=60.0, fmax=900.0)
    voiced = f0 > 0
    # fill 1-2 frame dropouts inside notes
    for i in range(1, len(f0) - 2):
        if not voiced[i] and voiced[i - 1] and (voiced[i + 1] or voiced[i + 2]):
            f0[i] = f0[i - 1]; voiced[i] = True
    midi = np.where(voiced, 69 + 12 * np.log2(np.maximum(f0, 1e-6) / 440.0), 0.0)
    target = _target_notes(midi, voiced, s)
    goal = target + s.humanize * 0.5 * (midi - target)
    corr = np.where(voiced, s.amount * (goal - midi), 0.0)
    # retune speed: one-pole smoothing of the correction, reset at each note onset
    if s.retune_ms > 0:
        a = np.exp(-hop / (sr * s.retune_ms / 1000.0))
        sm = np.zeros_like(corr)
        for i in range(len(corr)):
            if voiced[i] and (i == 0 or not voiced[i - 1]):
                sm[i] = corr[i] * (1 - a)
            elif voiced[i]:
                sm[i] = a * sm[i - 1] + (1 - a) * corr[i]
        corr = sm
    if s.vibrato_rate > 0 and s.vibrato_depth > 0:
        t = np.arange(len(corr)) * hop / sr
        corr = corr + np.where(voiced, s.vibrato_depth / 100.0 * np.sin(2 * np.pi * s.vibrato_rate * t), 0.0)
    corr = corr + s.transpose
    return f0, voiced, corr


# ----------------------------------------------------------------------- PSOLA
def _analysis_marks(wav, sr, f0, voiced, hop):
    """Pitch marks: one per glottal pulse in voiced parts, every 5 ms elsewhere.
    Only the first mark of each voiced stretch snaps to a waveform peak; the
    rest advance by the exact period, which stays phase-locked to the voice and
    avoids alternating between two peaks (that would halve the pitch)."""
    n = len(wav)
    marks, periods, is_v = [], [], []
    t = 0.0
    unv = 0.005 * sr
    was_voiced = False
    while t < n:
        fi = min(int(t) // hop, len(f0) - 1)
        if voiced[fi] and f0[fi] > 0:
            p = sr / f0[fi]
            if not was_voiced:
                lo, hi = int(t), min(n, int(t + p))
                if hi > lo:
                    t = float(lo + int(np.argmax(np.abs(wav[lo:hi]))))
            marks.append(int(round(t))); periods.append(p); is_v.append(True)
            t += p
            was_voiced = True
        else:
            marks.append(int(round(t))); periods.append(unv); is_v.append(False)
            t += unv
            was_voiced = False
    return np.array(marks), np.array(periods, dtype=np.float64), np.array(is_v)


def psola_shift(wav: np.ndarray, sr: int, ratio_at, f0, voiced, hop) -> np.ndarray:
    marks, periods, is_v = _analysis_marks(wav, sr, f0, voiced, hop)
    n = len(wav)
    out = np.zeros(n + 2 * sr // 50)
    norm = np.zeros_like(out)
    ts = float(marks[0]) if len(marks) else 0.0
    k = 0
    while ts < n and len(marks):
        while k + 1 < len(marks) and abs(marks[k + 1] - ts) <= abs(marks[k] - ts):
            k += 1
        m, pf = int(marks[k]), float(periods[k])
        p = int(round(pf))
        r = ratio_at(int(ts)) if is_v[k] else 1.0
        a, b = max(0, m - p), min(n, m + p)
        grain = wav[a:b]
        win = np.hanning(2 * p + 1)[(a - (m - p)):(a - (m - p)) + len(grain)]
        start = int(round(ts)) - (m - a)
        if start >= 0 and start + len(grain) <= len(out):
            out[start:start + len(grain)] += grain * win
            norm[start:start + len(grain)] += win
        ts += max(pf / max(r, 0.25), 1.0)
    out = out[:n] / np.maximum(norm[:n], 1e-3)
    quiet = norm[:n] < 0.1                     # edges: fall back to the original
    out[quiet] = wav[quiet]
    return out.astype(np.float32)


def autotune(wav: np.ndarray, sr: int, settings: str | dict | AutoTuneSettings | None = None,
             **overrides) -> np.ndarray:
    """Apply pitch correction. Returns audio the same length as the input."""
    spec = settings if settings is not None else {}
    if isinstance(spec, str):
        spec = {"preset": spec}
    if isinstance(spec, dict):
        spec = {**spec, **overrides}
    s = settings_from(spec)
    if s is None or len(wav) < sr // 20:
        return wav
    hop = max(1, sr // 200)                     # 5 ms analysis frames
    f0, voiced, corr = pitch_plan(wav.astype(np.float64), sr, s, hop)
    ratio = 2.0 ** (corr / 12.0)
    ratio_at = lambda i: float(ratio[min(i // hop, len(ratio) - 1)])  # noqa: E731
    wet = psola_shift(wav.astype(np.float64), sr, ratio_at, f0, voiced, hop)
    out = s.mix * wet + (1 - s.mix) * wav
    peak = np.abs(out).max()
    return (out / peak * 0.98 if peak > 0.98 else out).astype(np.float32)


def describe_presets() -> list[dict]:
    return [{"name": k, "label": v["label"], **{f: v[f] for f in v if f != "label"}} for k, v in PRESETS.items()]


__all__ = ["autotune", "AutoTuneSettings", "PRESETS", "SCALES", "NOTE_NAMES", "settings_from",
           "describe_presets", "asdict"]
