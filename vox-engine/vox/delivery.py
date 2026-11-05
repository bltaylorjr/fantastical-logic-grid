"""The full vocal range, and shaping a voice to an age.

Deliveries go from a whisper to a scream: whisper, murmur, soft, normal,
projected, calling out, shout, yell, scream, plus laughing, crying, breathy,
raspy, vocal fry, falsetto and singing. Each one combines the model's own
emotions (whisper and shout are trained ones) with pace, pitch, loudness and,
where needed, a final audio touch (breath noise, rasp, a sob's tremble).

Singing: give notes ("C4 D4 E4 F4 G4", one per syllable, repeating) or let it
make a tune in a key. Each syllable is held on its note, with vibrato on long
notes; how sung it sounds depends on the trained model.

Age shaping (development.py): before the vocoder the spectrum is warped so the
vocal tract sounds bigger or smaller (formants), and afterwards the pitch is
moved to the age's typical speaking pitch, measured on the line itself.
"""
from __future__ import annotations

import random
import re
import zlib

import numpy as np
import torch

from .audio import track_pitch
from .autotune import NOTE_NAMES, SCALES, psola_shift

DELIVERIES: dict[str, dict] = {
    "whisper": {"label": "Whisper", "emotion": "whisper", "energy": -10, "rate": -0.1},
    "murmur": {"label": "Murmur", "emotion": "calm", "energy": -7, "rate": -0.2, "pitch_range": -0.4, "post": {"breathy": 0.3}},
    "soft": {"label": "Soft", "emotion": "tender", "energy": -4, "rate": -0.1},
    "normal": {"label": "Normal", "energy": 0},
    "projected": {"label": "Projected (to a room)", "energy": 4, "enunciate": 0.5, "pitch": 1, "rate": -0.1},
    "calling": {"label": "Calling out", "emotion": "excited", "intensity": 0.6, "energy": 6, "pitch": 3, "pitch_range": 0.4, "rate": -0.3},
    "shout": {"label": "Shout", "emotion": "shout", "energy": 8, "pitch": 3},
    "yell": {"label": "Yell", "emotion": {"shout": 1.0, "angry": 0.4}, "intensity": 1.2, "energy": 10, "pitch": 5, "post": {"raspy": 0.2}},
    "scream": {"label": "Scream", "emotion": {"shout": 1.0, "fearful": 0.6}, "intensity": 1.3, "energy": 11, "pitch": 9, "post": {"raspy": 0.35}},
    "laughing": {"label": "Laughing while talking", "emotion": "happy", "intensity": 1.1, "pitch": 2, "pitch_range": 0.5, "laugh": True, "post": {"tremble": 0.25}},
    "crying": {"label": "Crying", "emotion": "sad", "intensity": 1.2, "pitch": 2, "rate": -0.4, "post": {"tremble": 0.55, "breathy": 0.35}},
    "breathy": {"label": "Breathy", "energy": -2, "post": {"breathy": 0.6}},
    "raspy": {"label": "Raspy", "pitch": -1, "post": {"raspy": 0.55}},
    "vocal_fry": {"label": "Vocal fry (creaky)", "pitch": -5, "pitch_range": -0.4, "energy": -2, "post": {"raspy": 0.4}},
    "falsetto": {"label": "Falsetto", "pitch": 10, "energy": -2, "post": {"breathy": 0.35}},
    "singing": {"label": "Singing", "emotion": "calm", "rate": -0.6, "energy": 2, "sing": True},
}


def delivery(name: str | None) -> dict:
    return DELIVERIES.get(name or "", {})


def describe() -> dict:
    return {"deliveries": [{"id": k, "label": v["label"]} for k, v in DELIVERIES.items()],
            "keys": NOTE_NAMES, "scales": list(SCALES)}


def add_laughs(text: str, seed: int = 0) -> str:
    """Laughing delivery: a laugh between some sentences."""
    rng = random.Random(zlib.crc32(f"{seed}|laugh|{text}".encode()))
    parts = re.split(r"(?<=[.!?])\s+", text)
    return " ".join(p + (" [laugh]" if i < len(parts) - 1 and rng.random() < 0.5 else "") for i, p in enumerate(parts))


# --------------------------------------------------------------- spectrum
def warp_formants(mel: torch.Tensor, alpha: float, f_min: float, f_max: float, floor: float) -> torch.Tensor:
    """Scale the vocal tract: alpha > 1 sounds smaller (a child), < 1 bigger.
    mel: (frames, n_mels) log-mel on the HTK mel scale."""
    if abs(alpha - 1.0) < 0.01:
        return mel
    n = mel.shape[1]
    to_mel = lambda f: 2595.0 * np.log10(1.0 + f / 700.0)       # noqa: E731
    to_hz = lambda m: 700.0 * (10 ** (m / 2595.0) - 1.0)         # noqa: E731
    pts = np.linspace(to_mel(f_min), to_mel(f_max), n + 2)[1:-1]
    hz = to_hz(pts)
    src = to_mel(hz / alpha)                                    # this bin takes what was at f / alpha
    idx = np.interp(src, pts, np.arange(n), left=-1.0, right=float(n))
    lo = np.clip(np.floor(idx), 0, n - 1).astype(np.int64)
    hi = np.clip(lo + 1, 0, n - 1)
    frac = torch.tensor(np.clip(idx - lo, 0.0, 1.0), dtype=mel.dtype, device=mel.device)
    out = mel[:, lo] * (1 - frac) + mel[:, hi] * frac
    beyond = torch.tensor(idx >= n - 1, device=mel.device)
    if beyond.any():                                           # nothing above the old top: fade to quiet
        out[:, beyond] = torch.maximum(out[:, beyond] - 3.0, torch.full_like(out[:, beyond], floor))
    return out


# ------------------------------------------------------------------ pitch
def _f0(wav, sr, hop):
    f0 = track_pitch(wav.astype(np.float64), sr, hop, fmin=60.0, fmax=900.0)
    return f0, f0 > 0


def move_pitch_to(wav: np.ndarray, sr: int, target_hz: float, max_semitones: float = 15.0) -> np.ndarray:
    """Shift the whole line so its typical pitch is target_hz (melody kept)."""
    if len(wav) < sr // 10 or not target_hz:
        return wav
    hop = max(1, sr // 200)
    f0, voiced = _f0(wav, sr, hop)
    if voiced.sum() < 5:
        return wav
    shift = 12 * np.log2(target_hz / float(np.median(f0[voiced])))
    shift = float(np.clip(shift, -max_semitones, max_semitones))
    if abs(shift) < 0.3:
        return wav
    r = 2 ** (shift / 12)
    return psola_shift(wav.astype(np.float64), sr, lambda i: r, f0, voiced, hop)


def melody(spec: dict | None, n: int, seed: int = 0) -> list[float]:
    """MIDI notes for n syllables: the notes given, or a tune in a key."""
    spec = spec or {}
    notes = []
    for tok in re.split(r"[\s,]+", str(spec.get("notes", "")).strip()):
        m = re.fullmatch(r"([A-Ga-g])([#b]?)(-?\d)?", tok)
        if not m:
            continue
        name = m.group(1).upper() + ("#" if m.group(2) == "#" else "")
        semis = NOTE_NAMES.index(name) if name in NOTE_NAMES else NOTE_NAMES.index(m.group(1).upper())
        if m.group(2) == "b":
            semis -= 1
        octave = int(m.group(3)) if m.group(3) else 4
        notes.append(12 * (octave + 1) + semis)
    if notes:
        return [float(notes[i % len(notes)]) for i in range(n)]
    key = spec.get("key", "C") if spec.get("key") in NOTE_NAMES else "C"
    scale = SCALES.get(spec.get("scale") or "pentatonic") or SCALES["pentatonic"]
    root = 12 * 5 + NOTE_NAMES.index(key)                      # around C4..C5
    rng = random.Random(zlib.crc32(f"{seed}|tune".encode()))
    step, out = 0, []
    for i in range(n):
        step = max(-2, min(len(scale) + 2, step + rng.choice([-2, -1, -1, 0, 1, 1, 2])))
        if i == n - 1:
            step = 0                                            # end on the home note
        octave, deg = divmod(step, len(scale))
        out.append(float(root + 12 * octave + scale[deg]))
    return out


def sing(wav: np.ndarray, sr: int, spec: dict | None, seed: int = 0, base_shift: float = 0.0) -> np.ndarray:
    """Hold each syllable (voiced stretch) on a note, with vibrato on long ones."""
    hop = max(1, sr // 200)
    f0, voiced = _f0(wav, sr, hop)
    if voiced.sum() < 5:
        return wav
    runs, i = [], 0                                            # voiced stretches = syllables
    while i < len(voiced):
        if voiced[i]:
            j = i
            while j < len(voiced) and voiced[j]:
                j += 1
            if j - i >= 4:
                runs.append((i, j))
            i = j
        else:
            i += 1
    if not runs:
        return wav
    tune = melody(spec, len(runs), seed)
    shift_oct = 12 * round((np.median(69 + 12 * np.log2(f0[voiced] / 440.0)) - np.median(tune)) / 12)
    corr = np.zeros(len(f0))
    for (a, b), note in zip(runs, tune):
        target = note + shift_oct + base_shift
        midi = 69 + 12 * np.log2(np.maximum(f0[a:b], 1e-6) / 440.0)
        c = target - midi
        if b - a > 40:                                         # long note: 5.5 Hz vibrato, starting late
            t = np.arange(b - a) * hop / sr
            c = c + 0.35 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.15) / 0.2, 0, 1)
        corr[a:b] = c
    ratio = 2.0 ** (corr / 12.0)
    return psola_shift(wav.astype(np.float64), sr, lambda k: float(ratio[min(k // hop, len(ratio) - 1)]), f0, voiced, hop)


# ------------------------------------------------------------ voice touches
def touch(wav: np.ndarray, sr: int, post: dict | None, seed: int = 0) -> np.ndarray:
    """Breath noise, rasp and tremble for the deliveries that need them."""
    if not post:
        return wav
    rng = np.random.default_rng(zlib.crc32(f"{seed}|touch".encode()))
    out = wav.astype(np.float32).copy()
    env = np.convolve(np.abs(out), np.ones(240) / 240, mode="same")
    if post.get("breathy"):                    # air: noise that follows the voice, high-passed
        noise = rng.standard_normal(len(out)).astype(np.float32)
        noise = noise - np.convolve(noise, np.ones(8) / 8, mode="same")
        out = out * (1 - 0.35 * post["breathy"]) + noise * env * 1.6 * post["breathy"]
    if post.get("raspy"):                      # rough: fast random amplitude flutter
        flutter = np.repeat(rng.uniform(1 - post["raspy"], 1.0, len(out) // 60 + 1), 60)[:len(out)]
        out = out * flutter.astype(np.float32)
    if post.get("tremble"):                    # sob or laugh: 6-7 Hz tremble
        t = np.arange(len(out)) / sr
        out = out * (1 - 0.45 * post["tremble"] * (0.5 + 0.5 * np.sin(2 * np.pi * 6.5 * t))).astype(np.float32)
    peak = float(np.abs(out).max())
    return out / peak * 0.98 if peak > 0.98 else out
