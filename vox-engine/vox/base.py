"""The base voices: real speech from day one, while Vox's own model learns.

Vox's own speech model starts out knowing nothing, so until it has trained on
enough speech (on a free GPU; see kaggle/) it would only make noise. The base
voices fill that gap with Kokoro, an open speech model (82 million parameters,
Apache 2.0 weights, runs on an ordinary CPU) in 54 voices and 8 languages.
Everything that makes a Vox voice a Vox voice still applies on top:

  age and sex      the vocal tract sized to the age (formants), then the age's pitch
  dialect          espeak's accent phonology (US, New York, British, RP, Scottish,
                   Lancashire, West Midlands, Caribbean) plus the dialect's prosody
  delivery         whisper .. yell, laughing, crying, singing, auto-tune
  speaking style   pace, pitch and loudness from age, register and style prompts
  text             a child's words, hesitations, laughs, the pronunciation lexicon

Each Vox voice gets its own timbre: a blend of two base voices of the right sex
and accent chosen from the voice's name, so no two characters sound alike. A
voice can also name its own blend in its profile: {"base_voice": "bf_emma"} or
{"base_voice": {"af_heart": 0.7, "af_bella": 0.3}}.

The engine switches to Vox's own model when that model is clearer than these
voices (Whisper hears more of the test lines); see autotrain.evaluate_and_promote
and voice_source() below.

Files (about 120 MB, downloaded once into <data>/base/ and checked by SHA-256):
  kokoro-v1.0.int8.onnx   the model, 8-bit (fast on CPU)
  voices-v1.0.bin         the 54 voice styles
from the kokoro-onnx project's releases (MIT code; Apache 2.0 weights).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import threading
import types
import urllib.request
from pathlib import Path

import numpy as np

RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = {
    "kokoro-v1.0.int8.onnx": "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}
SR = 24000
CREDIT = ("Base voices: Kokoro-82M by hexgrad (Apache 2.0), via kokoro-onnx (MIT). "
          "Includes CC BY audio credited at huggingface.co/hexgrad/Kokoro-82M.")

# Base voices by accent family and sex (the 'a' voices are American, 'b' British).
FAMILY = {
    ("us", "female"): ["af_heart", "af_bella", "af_nicole", "af_sarah", "af_aoede", "af_kore", "af_jessica", "af_nova", "af_river", "af_alloy", "af_sky"],
    ("us", "male"): ["am_michael", "am_adam", "am_eric", "am_liam", "am_onyx", "am_echo", "am_fenrir", "am_puck"],
    ("gb", "female"): ["bf_emma", "bf_isabella", "bf_alice", "bf_lily"],
    ("gb", "male"): ["bm_george", "bm_lewis", "bm_daniel", "bm_fable"],
    ("in", "female"): ["hf_alpha", "hf_beta"],
    ("in", "male"): ["hm_omega", "hm_psi"],
}
# Vox dialect -> (espeak accent, voice family). The espeak accent sets the
# vowels and consonants; Vox's dialect prosody sets the tune and pace.
DIALECT = {
    "general_american": ("en-us", "us"), "southern_us": ("en-us", "us"), "appalachian": ("en-us", "us"),
    "texan": ("en-us", "us"), "african_american": ("en-us", "us"), "new_york": ("en-us-nyc", "us"),
    "boston": ("en-us-nyc", "us"), "great_lakes": ("en-us", "us"), "canadian": ("en-us", "us"),
    "latino": ("en-us", "us"), "filipino": ("en-us", "us"),
    "british_rp": ("en-gb-x-rp", "gb"), "london": ("en-gb", "gb"), "northern_england": ("en-gb-x-gbclan", "gb"),
    "scottish": ("en-gb-scotland", "gb"), "irish": ("en-gb", "gb"), "welsh": ("en-gb-x-gbcwmd", "gb"),
    "australian": ("en-gb", "gb"), "new_zealand": ("en-gb", "gb"), "south_african": ("en-gb", "gb"),
    "singaporean": ("en-gb", "gb"), "nigerian": ("en-gb", "gb"), "jamaican": ("en-029", "gb"),
    "indian": ("en-gb", "in"),
}
# Other languages the base voices speak (Vox language code -> espeak code, voices).
LANGUAGES = {
    "es": ("es", {"female": ["ef_dora"], "male": ["em_alex", "em_santa"]}),
    "fr": ("fr-fr", {"female": ["ff_siwis"], "male": ["ff_siwis"]}),
    "it": ("it", {"female": ["if_sara"], "male": ["im_nicola"]}),
    "pt": ("pt-br", {"female": ["pf_dora"], "male": ["pm_alex", "pm_santa"]}),
    "hi": ("hi", {"female": ["hf_alpha", "hf_beta"], "male": ["hm_omega", "hm_psi"]}),
    "ja": ("ja", {"female": ["jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro"], "male": ["jm_kumo"]}),
    "zh": ("cmn", {"female": ["zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi"], "male": ["zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang"]}),
}


def _system_espeak():
    """Where a system-wide espeak-ng lives (Linux on ARM has no bundled copy)."""
    import ctypes.util
    lib = os.environ.get("PHONEMIZER_ESPEAK_LIBRARY") or ctypes.util.find_library("espeak-ng") or ""
    for cand in ("/usr/lib/aarch64-linux-gnu/libespeak-ng.so.1", "/usr/lib/x86_64-linux-gnu/libespeak-ng.so.1", "/usr/lib/libespeak-ng.so.1"):
        if not lib and Path(cand).exists():
            lib = cand
    data = os.environ.get("ESPEAK_DATA_PATH") or ""
    for cand in ("/usr/lib/aarch64-linux-gnu/espeak-ng-data", "/usr/lib/x86_64-linux-gnu/espeak-ng-data", "/usr/share/espeak-ng-data"):
        if not data and Path(cand).exists():
            data = cand
    return lib, data


def _ensure_loader():
    """kokoro-onnx imports espeakng_loader, which has no build for Linux on ARM.
    There, stand in for it with the system's espeak-ng."""
    try:
        import espeakng_loader  # noqa: F401
        return
    except ImportError:
        pass
    lib, data = _system_espeak()
    shim = types.ModuleType("espeakng_loader")
    shim.get_library_path = lambda: lib
    shim.get_data_path = lambda: data
    sys.modules["espeakng_loader"] = shim


def available() -> bool:
    """Whether the base voices' software is installed (the files download on first use)."""
    import importlib.util
    return importlib.util.find_spec("kokoro_onnx") is not None and importlib.util.find_spec("onnxruntime") is not None


def install(progress=None) -> None:
    """Install the base voices' software into this Python (free, from PyPI).
    Linux on ARM has no bundled espeak-ng, so there the package goes in without
    it and uses the system's (the server image installs espeak-ng)."""
    import importlib
    import platform
    import subprocess
    if available():
        return
    pip = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "-q"]
    if progress:
        progress("Installing the base voices (about 30 MB of software)")
    arm_linux = sys.platform.startswith("linux") and platform.machine().lower() in ("aarch64", "arm64")
    steps = ([pip + ["--no-deps", "kokoro-onnx>=0.5"], pip + ["phonemizer>=3.4", "onnxruntime>=1.20"]] if arm_linux
             else [pip + ["kokoro-onnx>=0.5"]])
    for cmd in steps:
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError("Installing the base voices didn't work: " + (r.stderr or r.stdout).strip()[-400:])
    importlib.invalidate_caches()


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def ensure_files(root: Path, progress=None) -> Path:
    """Download the model and voices once (checked), and return their folder."""
    d = Path(root) / "base"
    d.mkdir(parents=True, exist_ok=True)
    for name, digest in FILES.items():
        p = d / name
        if p.exists() and (d / f"{name}.ok").exists():
            continue
        if progress:
            progress(f"Downloading the base voices ({name})")
        tmp = d / f"{name}.part"
        req = urllib.request.Request(RELEASE + name, headers={"User-Agent": "vox-engine/1.0"})
        with urllib.request.urlopen(req, timeout=600) as r, open(tmp, "wb") as f:
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                f.write(b)
        if _sha256(tmp) != digest:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"The base voice file {name} didn't match its checksum; it will be fetched again.")
        tmp.replace(p)
        (d / f"{name}.ok").write_text(digest)
    return d


def _pick(names: list[str], key: str, k: int = 2) -> dict[str, float]:
    """A blend of k voices from names, chosen and weighted by key (stable)."""
    h = hashlib.sha1(key.encode()).digest()
    if len(names) == 1:
        return {names[0]: 1.0}
    a = names[h[0] % len(names)]
    b = names[(h[0] + 1 + h[1] % (len(names) - 1)) % len(names)]
    w = 0.55 + (h[2] / 255) * 0.35          # the main voice: 55-90%
    return {a: round(w, 3), b: round(1 - w, 3)}


class BaseVoices:
    """Kokoro, loaded once and shared; thread-safe."""

    def __init__(self, root: str | Path):
        self.root = Path(root)
        self._k = None
        self._lock = threading.Lock()
        self.error: str | None = None
        self.message: str | None = None

    @property
    def ready(self) -> bool:
        d = self.root / "base"
        return available() and all((d / f"{n}.ok").exists() for n in FILES)

    def load(self, progress=None):
        with self._lock:
            if self._k is None:
                _ensure_loader()
                from kokoro_onnx import Kokoro
                from kokoro_onnx.config import EspeakConfig
                d = ensure_files(self.root, progress)
                cfg = None
                try:
                    import espeakng_loader
                    if not getattr(espeakng_loader, "__file__", None):   # our stand-in
                        lib, data = _system_espeak()
                        cfg = EspeakConfig(lib_path=lib, data_path=data)
                except ImportError:
                    pass
                self._k = Kokoro(str(d / "kokoro-v1.0.int8.onnx"), str(d / "voices-v1.0.bin"), espeak_config=cfg)
            return self._k

    def prefetch(self, on_ready=None, auto_install: bool = True) -> threading.Thread:
        """Install (if needed), download and load in the background so the first
        line is quick. on_ready() runs once the voices can speak."""
        def run():
            try:
                if auto_install and not available():
                    install(lambda m: setattr(self, "message", m))
                self.message = "Loading the base voices"
                self.load(lambda m: setattr(self, "message", m))
                self.error = None
                self.message = "Ready"
                if on_ready:
                    on_ready()
            except Exception as e:                     # shown in status; tried again on the next start
                self.error = str(e)
                self.message = None
        t = threading.Thread(target=run, daemon=True)
        t.start()
        return t

    # ------------------------------------------------------------ choosing
    @staticmethod
    def choose(voice_name: str, prof: dict, language: str | None = None) -> tuple[dict[str, float], str, str]:
        """(voice blend, espeak language, the sex the base voice has)."""
        age = prof.get("age")
        sex = "male" if str(prof.get("sex") or "female").lower().startswith("m") else "female"
        # Children's and young teens' voices start from a woman's voice: closest
        # in tract and pitch, so the age shaping has less to do.
        base_sex = "female" if (age is not None and float(age) < 13) else sex
        lang = (language or "").split("-")[0].lower()
        own = prof.get("base_voice")
        if lang and lang != "en" and lang in LANGUAGES:
            code, by_sex = LANGUAGES[lang]
            blend = own if isinstance(own, dict) else ({own: 1.0} if own else _pick(by_sex[base_sex], voice_name))
            return blend, code, base_sex
        code, fam = DIALECT.get(prof.get("dialect") or "", ("en-us", "us"))
        if float(prof.get("accent") if prof.get("accent") is not None else 1.0) < 0.35:
            code, fam = "en-us", "us"                  # a light accent: mostly general American
        names = FAMILY[(fam, base_sex)]
        if isinstance(own, dict):
            blend = own
        elif own:
            blend = {own: 1.0}
        else:
            blend = _pick(names, voice_name)
        return blend, code, base_sex

    def style(self, blend: dict[str, float]) -> np.ndarray:
        k = self.load()
        total = sum(blend.values()) or 1.0
        out = None
        for name, w in blend.items():
            v = k.get_voice_style(name) * (w / total)
            out = v if out is None else out + v
        return out

    def speak(self, text: str, blend: dict[str, float], lang: str, speed: float = 1.0) -> np.ndarray:
        k = self.load()
        speed = float(np.clip(speed, 0.5, 2.0))
        audio, sr = k.create(text, voice=self.style(blend), speed=speed, lang=lang)
        assert sr == SR
        return np.asarray(audio, dtype=np.float32)

    def status(self) -> dict:
        d = self.root / "base"
        return {"installed": available(), "downloaded": all((d / f"{n}.ok").exists() for n in FILES),
                "loaded": self._k is not None, "error": self.error, "message": self.message, "voices": sum(len(v) for v in FAMILY.values()),
                "credit": CREDIT}


# ------------------------------------------------------------------ choosing the source
def source_file(root: str | Path) -> Path:
    return Path(root) / "learning" / "voice-source.json"


def voice_source(root: str | Path) -> dict:
    """Which model speaks: "base" until Vox's own model is promoted over it."""
    forced = os.environ.get("VOX_SOURCE")
    try:
        s = json.loads(source_file(root).read_text())
    except Exception:
        s = {"source": "base"}
    if forced in ("base", "own"):
        s = {**s, "source": forced, "forced": True}
    return s


def set_voice_source(root: str | Path, source: str, **info) -> dict:
    p = source_file(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    s = {"source": source, **info}
    p.write_text(json.dumps(s, indent=1))
    return s


def speed_for(rate: float) -> float:
    """Vox's rate (-2 very slow .. +2 very fast) as a speaking speed."""
    return float(1.25 ** float(rate or 0.0))


_WORDS = re.compile(r"\S")


def has_words(text: str) -> bool:
    return bool(_WORDS.search(text or ""))


if __name__ == "__main__":     # python -m vox.base --root DIR : install and download now
    import argparse
    ap = argparse.ArgumentParser(description="Install and download Vox's base voices.")
    ap.add_argument("--root", default=".")
    a = ap.parse_args()
    install(print)
    ensure_files(Path(a.root), print)
    print("Base voices ready.")
