"""Voice library: cloned voices (with recorded consent), designed voices
(invented from a description), and voices learned during training.

Every voice is a folder:  voices/<name>/voice.json  (+ prompt.wav if cloned)
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import random
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from .config import EMOTIONS


@dataclass
class ConsentRecord:
    """Proof that the person whose voice is cloned agreed to it.
    Cloning is refused without one. Keep these with your game's legal records."""
    speaker_name: str
    granted_by: str                 # who confirmed it (the speaker or their agent)
    statement: str                  # what they agreed to, e.g. scope and project
    date: str = field(default_factory=lambda: _dt.date.today().isoformat())
    audio_sha256: str = ""          # fingerprint of the exact sample they approved

    def validate(self) -> None:
        if len(self.statement.strip()) < 20 or not self.speaker_name.strip() or not self.granted_by.strip():
            raise PermissionError(
                "Voice cloning needs a consent record: the speaker's name, who granted "
                "consent, and a statement of what they agreed to (at least 20 characters).")


@dataclass
class Voice:
    name: str
    speaker_emb: list[float]
    origin: str = "designed"        # "cloned" | "designed" | "sampled" | "trained"
    description: str = ""
    prompt_text: str = ""           # transcript of prompt.wav (cloned voices)
    default_emotion: str = "neutral"
    default_prosody: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0, 0.0])
    consent: dict | None = None
    seed: int | None = None
    autotune: dict | None = None    # default auto-tune for this voice (see autotune.py)
    infer: dict | None = None       # tuned generation settings found by auto-optimize
    history: list = field(default_factory=list)   # earlier embeddings, newest last (for undo)
    sources: list = field(default_factory=list)   # credits for sampled voices
    # Who the voice is (development.py, dialects.py, delivery.py): age, sex,
    # dialect, accent strength, speaking style, fluency, sound patterns and a
    # default delivery. Every line can override any of these.
    profile: dict | None = None

    @classmethod
    def from_dict(cls, d: dict) -> "Voice":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in d.items() if k in known})

    def emb_tensor(self, device="cpu") -> torch.Tensor:
        return torch.tensor(self.speaker_emb, dtype=torch.float32, device=device)


class VoiceLibrary:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, name: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9_\-]{1,64}", name):
            raise ValueError("Voice names may use letters, numbers, - and _ only.")
        return self.root / name

    def save(self, voice: Voice, prompt_wav: np.ndarray | None = None, sr: int = 24000) -> None:
        d = self.path(voice.name)
        d.mkdir(parents=True, exist_ok=True)
        (d / "voice.json").write_text(json.dumps(asdict(voice), indent=2))
        if prompt_wav is not None:
            from .audio import save_audio
            save_audio(d / "prompt.wav", prompt_wav, sr)

    def load(self, name: str) -> Voice:
        f = self.path(name) / "voice.json"
        if not f.exists():
            raise KeyError(f"No voice named '{name}'. Available: {', '.join(self.names()) or 'none'}")
        return Voice.from_dict(json.loads(f.read_text()))

    def prompt_path(self, name: str) -> Path | None:
        p = self.path(name) / "prompt.wav"
        return p if p.exists() else None

    def names(self) -> list[str]:
        return sorted(p.parent.name for p in self.root.glob("*/voice.json"))

    def delete(self, name: str) -> None:
        import shutil
        shutil.rmtree(self.path(name), ignore_errors=True)


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


# --------------------------------------------------------------- voice design
@dataclass
class SpeakerSpace:
    """Statistics of the speaker-embedding space learned in training. Lets us
    invent brand-new, plausible voices (diverse voice creation) and steer them
    with human attributes."""
    mean: list[float]
    components: list[list[float]]   # principal directions (K, D)
    stds: list[float]               # spread along each direction (K,)
    attribute_dirs: dict[str, list[float]]  # e.g. "pitch": direction in emb space

    @classmethod
    def fit(cls, embs: np.ndarray, attrs: dict[str, np.ndarray], k: int = 16) -> "SpeakerSpace":
        mean = embs.mean(0)
        x = embs - mean
        _, s, vt = np.linalg.svd(x, full_matrices=False)
        k = min(k, len(s))
        stds = s[:k] / max(np.sqrt(len(embs) - 1), 1)
        dirs = {}
        for name, y in attrs.items():
            y = (y - y.mean()) / (y.std() + 1e-8)
            w, *_ = np.linalg.lstsq(x, y, rcond=None)     # emb change per +1 std of attr
            dirs[name] = (w / (np.linalg.norm(w) + 1e-8)).tolist()
        return cls(mean.tolist(), vt[:k].tolist(), stds.tolist(), dirs)

    def sample(self, seed: int, attributes: dict[str, float] | None = None,
               diversity: float = 1.0) -> np.ndarray:
        rng = np.random.default_rng(seed)
        mean, comps, stds = np.array(self.mean), np.array(self.components), np.array(self.stds)
        z = rng.standard_normal(len(stds)) * diversity
        emb = mean + (z * stds) @ comps
        scale = float(np.mean(stds)) * 2 if len(stds) else 0.1
        for name, amount in (attributes or {}).items():
            if name in self.attribute_dirs:
                emb = emb + amount * scale * np.array(self.attribute_dirs[name])
        return emb / (np.linalg.norm(emb) + 1e-8)


# Words a writer might use in a voice/style prompt, mapped to controls.
_ATTR_WORDS = {
    "pitch": {"deep": -1.5, "low": -1.0, "bass": -1.5, "baritone": -0.8, "high": 1.0,
              "squeaky": 1.8, "shrill": 1.4, "soprano": 1.4, "child": 1.6, "childlike": 1.6,
              "tiny": 1.2, "giant": -1.8, "booming": -1.0},
    "brightness": {"bright": 1.0, "crisp": 0.8, "clear": 0.6, "dark": -1.0, "muffled": -1.2,
                   "warm": -0.4, "nasal": 0.9, "young": 0.6, "youthful": 0.6},
    "roughness": {"gravelly": 1.5, "raspy": 1.4, "rough": 1.2, "hoarse": 1.2, "smooth": -1.0,
                  "silky": -1.2, "old": 0.8, "elderly": 0.9, "ancient": 1.2, "grizzled": 1.3},
    "breathiness": {"breathy": 1.4, "airy": 1.2, "soft": 0.6, "whispery": 1.6, "strong": -0.8,
                    "powerful": -1.0, "commanding": -0.9},
}
_RATE_WORDS = {"slow": -0.8, "slowly": -0.8, "measured": -0.5, "deliberate": -0.6, "drawling": -1.0,
               "fast": 0.8, "quick": 0.7, "quickly": 0.7, "rapid": 1.0, "hurried": 0.9, "nervous": 0.5}
_ENERGY_WORDS = {"loud": 4.0, "booming": 5.0, "quiet": -4.0, "soft": -3.0, "gentle": -2.0,
                 "hushed": -5.0, "intense": 3.0}
_RANGE_WORDS = {"monotone": -0.6, "flat": -0.5, "robotic": -0.8, "expressive": 0.5,
                "animated": 0.6, "dramatic": 0.7, "sing-song": 0.8, "lively": 0.5}
_EMOTION_WORDS = {
    "happy": "happy", "cheerful": "happy", "jolly": "happy", "joyful": "happy",
    "sad": "sad", "melancholy": "sad", "mournful": "sad", "grieving": "sad",
    "angry": "angry", "furious": "angry", "menacing": "angry", "stern": "angry",
    "scared": "fearful", "afraid": "fearful", "fearful": "fearful", "terrified": "fearful",
    "surprised": "surprised", "shocked": "surprised", "disgusted": "disgusted",
    "calm": "calm", "serene": "calm", "wise": "calm", "soothing": "calm",
    "excited": "excited", "energetic": "excited", "enthusiastic": "excited",
    "warm": "tender", "kind": "tender", "tender": "tender", "loving": "tender", "motherly": "tender",
    "whispering": "whisper", "whisper": "whisper", "shouting": "shout", "yelling": "shout",
}


@dataclass
class StyleRequest:
    attributes: dict[str, float]
    emotion: dict[str, float]
    prosody: list[float]            # rate, pitch shift (semitones), pitch range, energy (dB)


def parse_style_prompt(prompt: str) -> StyleRequest:
    """'a gravelly old wizard, slow and warm, slightly menacing' -> controls.

    Modifiers 'very/extremely' strengthen and 'slightly/a bit' soften the next word.
    """
    words = re.findall(r"[a-z\-]+", prompt.lower())
    attrs: dict[str, float] = {}
    emo: dict[str, float] = {}
    pros = [0.0, 0.0, 0.0, 0.0]
    mult = 1.0
    for w in words:
        if w in ("very", "extremely", "really", "super"):
            mult = 1.6; continue
        if w in ("slightly", "somewhat", "bit", "little", "mildly"):
            mult = 0.5; continue
        for attr, table in _ATTR_WORDS.items():
            if w in table:
                attrs[attr] = attrs.get(attr, 0.0) + table[w] * mult
        if w in _RATE_WORDS:
            pros[0] += _RATE_WORDS[w] * mult
        if w in _RANGE_WORDS:
            pros[2] += _RANGE_WORDS[w] * mult
        if w in _ENERGY_WORDS:
            pros[3] += _ENERGY_WORDS[w] * mult
        if w in _EMOTION_WORDS:
            e = _EMOTION_WORDS[w]
            emo[e] = min(1.0, emo.get(e, 0.0) + 0.7 * mult)
        mult = 1.0
    if "pitch" in attrs:
        pros[1] += attrs["pitch"] * 1.5          # also nudge delivered pitch (semitones)
    total = sum(emo.values())
    if total > 1.0:
        emo = {k: v / total for k, v in emo.items()}
    return StyleRequest(attrs, emo, pros)


def random_voice_name(seed: int) -> str:
    r = random.Random(seed)
    a = ["amber", "brisk", "cinder", "dusk", "ember", "frost", "gale", "hollow", "iron", "jade"]
    b = ["fox", "heron", "lynx", "moth", "owl", "pike", "raven", "stag", "wren", "yak"]
    return f"{r.choice(a)}-{r.choice(b)}-{seed % 1000}"


def cosine(a: torch.Tensor, b: torch.Tensor) -> float:
    return float(F.cosine_similarity(a.flatten()[None], b.flatten()[None]))


__all__ = ["ConsentRecord", "Voice", "VoiceLibrary", "SpeakerSpace", "StyleRequest",
           "parse_style_prompt", "random_voice_name", "cosine", "EMOTIONS", "sha256_bytes"]
