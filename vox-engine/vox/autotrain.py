"""Automatic training: Vox teaches itself, on a schedule, within a fixed budget.

Each night (1 to 6 a.m. by default) on a machine that isn't busy:

  1. Gather. One plain dictionary word at a time, and nothing else (no names,
     places or channels), is searched for openly licensed recordings (public
     domain, CC0 or Creative Commons BY; each license re-checked). One small
     file per recording is cut into clean speech clips, Whisper writes what's
     said and which language it is, and the clips join Vox's own dataset as
     compressed FLAC. Speakers are anonymous codes; a credit line is kept,
     separately, only where the license requires it.
  2. Learn dialects and languages. Where a recording's own details name a
     region ("Scotland", "Texas", "Nigeria"...), its clips teach that dialect's
     pace and melody; the learned values are stored with the dialect and blend
     into its settings as evidence grows. Every word Whisper hears is counted in
     a vocabulary for its language.
  3. Train. When enough new clips have arrived, the model trains for a set time
     (resuming where it stopped), and every few rounds the vocoder too.
  4. Check, then keep or discard. The new model and the live one both say the
     same test sentences; Whisper scores how many words come through. Only a
     clearly better model goes live (the old one is kept to roll back to).
  5. Scan accuracy. A rotating sample of dictionary words is spoken and
     checked every day, building an accuracy history and a list of words to fix.

It stays inside a storage budget (40 GB by default): downloads are deleted at
once, the lowest-quality clips go first when the dataset is full, and old
models are pruned. `python -m vox.autotrain --cleanup` runs the same cleanup
from outside (the server's daily maintenance does).
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
import shutil
import sqlite3
import tempfile
import threading
import time
import urllib.parse
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

import numpy as np

AUDIO = (".mp3", ".ogg", ".flac", ".wav")
MAX_FILE = 30 * 1024 * 1024
TEST_LINES = [
    "The quick brown fox jumps over the lazy dog.",
    "Please call Stella and ask her to bring these things with her from the store.",
    "She sells sea shells by the sea shore.",
    "We will meet at the old mill when the bells ring at noon.",
    "How much wood would a woodchuck chuck if a woodchuck could chuck wood?",
    "The treasure is hidden behind the waterfall, under the third stone.",
]
# Words in a recording's own details (title, subject, description, place) that
# name the region of an English dialect. Searches never use these.
REGIONS = {
    "scottish": r"scotland|scottish|glasgow|edinburgh|highlands",
    "irish": r"ireland|irish|dublin|cork|belfast",
    "welsh": r"\bwales\b|welsh|cardiff",
    "london": r"london|cockney|east end",
    "northern_england": r"yorkshire|lancashire|manchester|liverpool|newcastle|geordie|scouse",
    "british_rp": r"\bbbc\b|received pronunciation|oxford|cambridge|\bengland\b|british",
    "australian": r"australia|australian|sydney|melbourne|queensland",
    "new_zealand": r"new zealand|aotearoa|auckland|wellington",
    "south_african": r"south africa|johannesburg|cape town",
    "indian": r"\bindia\b|indian english|delhi|mumbai|bangalore|kolkata|chennai",
    "nigerian": r"nigeria|nigerian|lagos|abuja",
    "jamaican": r"jamaica|jamaican|caribbean|trinidad|barbados",
    "singaporean": r"singapore|malaysia|kuala lumpur",
    "filipino": r"philippines|filipino|manila",
    "canadian": r"canada|canadian|toronto|ontario|vancouver",
    "new_york": r"new york|brooklyn|bronx|queens",
    "boston": r"boston|massachusetts",
    "great_lakes": r"chicago|detroit|michigan|wisconsin|minnesota|cleveland",
    "texan": r"texas|texan|houston|dallas",
    "appalachian": r"appalachia|appalachian|kentucky|west virginia|blue ridge|smoky mountains|asheville",
    "southern_us": r"georgia|alabama|mississippi|louisiana|tennessee|carolina|arkansas",
    "african_american": r"african american",
    "latino": r"chicano|latino|tejano",
}


@dataclass
class Settings:
    enabled: bool = False
    start_hour: int = 1            # local time window for the night's work
    end_hour: int = 6
    timezone: str = "America/New_York"
    budget_gb: float = 40.0        # Vox's dataset and models together
    gather_minutes: int = 90
    train_minutes: int = 120
    min_new_clips: int = 150       # train only when this many new clips arrived
    preset: str = "tiny"           # model size to train if starting from scratch
    threads: int = 1               # processor cores for training (leave the rest for others)
    items_per_word: int = 2
    pause_secs: float = 2.0        # between requests to the archive
    max_load: float = 1.5          # skip a round when the machine is busier than this
    vocoder_every: int = 3         # train the vocoder every Nth round
    min_gain: float = 0.02         # how much better (word accuracy) a model must be to go live
    # Vox's own model learns on a free GPU (kaggle/); a processor is far too slow
    # to teach it speech, so training here is off unless there's a GPU or you
    # turn it on (for fine-tuning a model that already speaks).
    local_training: bool = False


USAGE_FILE = os.environ.get("VOX_USAGE_FILE", "/srv/vox/usage.json")


def server_usage() -> dict | None:
    """The Oracle server's free-tier guard (scripts/runner/flg-usage.sh), if Vox
    runs there: level 0 normal, 1 careful, 2 throttled, 3 essential only."""
    try:
        u = json.loads(Path(USAGE_FILE).read_text())
        if time.time() - datetime.fromisoformat(u["at"].replace("Z", "+00:00")).timestamp() > 3 * 3600:
            u = {**u, "level": max(1, int(u.get("level", 0))), "reason": "The free-tier guard hasn't reported for 3 hours; going carefully."}
        return u
    except Exception:
        return None


def throttle_level() -> int:
    u = server_usage()
    return int(u.get("level", 0)) if u else 0


class AutoTrainer:
    def __init__(self, engine, root: str | Path, lock: threading.Lock, dictionary=None, learning=None):
        self.engine, self.lock, self.dictionary, self.learning = engine, lock, dictionary, learning
        self.root = Path(root)
        self.dir = self.root / "autotrain"
        self.data = self.dir / "dataset"
        (self.data / "clips").mkdir(parents=True, exist_ok=True)
        self.manifest = self.data / "manifest.jsonl"
        self.vocab_db = self.dir / "vocabulary.db"
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.job = {"running": False, "phase": "", "message": "", "progress": 0.0}
        self.settings = Settings(**{**asdict(Settings()), **self._read("settings.json", {})})
        if os.environ.get("VOX_AUTOTRAIN") == "1" and not (self.dir / "settings.json").exists():
            self.settings.enabled = True            # on by default on the server
        self.state = {"cursor": 0, "clips": 0, "hours": 0.0, "new_clips": 0, "rounds": 0, "languages": {},
                      "dialects": {}, "history": [], "accuracy": [], "last": {}, "skipped": Counter()}
        self.state.update(self._read("state.json", {}))
        self.state["skipped"] = Counter(self.state.get("skipped") or {})
        self._asr = None

    # ------------------------------------------------------------ storage
    def _read(self, name, default):
        try:
            return json.loads((self.dir / name).read_text())
        except Exception:
            return default

    def _write(self, name, value):
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.dir / (name + ".tmp")
        tmp.write_text(json.dumps(value, indent=1, default=lambda o: dict(o) if isinstance(o, Counter) else str(o)))
        tmp.replace(self.dir / name)

    def save(self):
        self.state["history"] = self.state["history"][-60:]
        self.state["accuracy"] = self.state["accuracy"][-120:]
        self._write("state.json", self.state)
        self._write("settings.json", asdict(self.settings))

    def update_settings(self, changes: dict) -> dict:
        cur = asdict(self.settings)
        for k, v in changes.items():
            if k not in cur:
                raise ValueError(f"Unknown setting '{k}'.")
            cur[k] = type(cur[k])(v)
        if not (0 <= cur["start_hour"] <= 23 and 0 <= cur["end_hour"] <= 23):
            raise ValueError("Hours go from 0 to 23.")
        if not 2 <= cur["budget_gb"] <= 500:
            raise ValueError("The storage budget goes from 2 to 500 GB.")
        if cur["preset"] not in ("tiny", "small", "base"):
            raise ValueError("Model size is tiny, small or base.")
        self.settings = Settings(**cur)
        self.save()
        return cur

    def used_bytes(self) -> int:
        total = 0
        for d in (self.dir, self.root / "runs", self.root / "cache"):
            if d.exists():
                total += sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
        return total

    # --------------------------------------------------------- vocabulary
    def _vocab(self):
        db = sqlite3.connect(str(self.vocab_db))
        db.execute("CREATE TABLE IF NOT EXISTS words(lang TEXT, word TEXT, n INTEGER, PRIMARY KEY(lang, word))")
        return db

    def _count_words(self, lang: str, words: list[str]):
        db = self._vocab()
        with db:
            for w in words:
                w = re.sub(r"[^\w'\-]", "", w.lower())
                if w and not w.isdigit():
                    db.execute("INSERT INTO words VALUES(?,?,1) ON CONFLICT(lang, word) DO UPDATE SET n = n + 1", (lang, w))
        db.close()

    def vocabulary(self) -> dict:
        if not self.vocab_db.exists():
            return {}
        db = self._vocab()
        rows = db.execute("SELECT lang, COUNT(*), SUM(n) FROM words GROUP BY lang ORDER BY COUNT(*) DESC").fetchall()
        db.close()
        return {lang: {"words": n, "heard": int(total)} for lang, n, total in rows}

    # ------------------------------------------------------------- status
    def status(self) -> dict:
        s = self.state
        learned = self.learned_dialects()
        total_words = None
        try:
            total_words = len(self._words())
        except Exception:
            pass
        return {**self.job, "settings": asdict(self.settings), "cursor": s["cursor"], "total_words": total_words,
                "clips": s["clips"], "hours": round(s["hours"], 2), "new_clips": s["new_clips"], "rounds": s["rounds"],
                "languages": s["languages"], "vocabulary": self.vocabulary(), "dialects": learned,
                "history": s["history"][::-1][:20], "accuracy": s["accuracy"][-30:], "last": s["last"],
                "skipped": dict(s["skipped"].most_common(8)), "used_gb": round(self.used_bytes() / 1e9, 2),
                "in_window": self.in_window(),
                "whisper": __import__("importlib.util").util.find_spec("faster_whisper") is not None,
                "server_maintenance": self._read_maintenance(), "server_usage": server_usage(),
                "voice_source": {**__import__("vox.base", fromlist=["x"]).voice_source(self.root), "speaking": self.engine.source},
                "gpu": self.gpu_status()}

    @staticmethod
    def _read_maintenance():
        """The Oracle server's last daily cleanup and repair, if Vox runs there."""
        try:
            return json.loads(Path("/srv/vox/maintenance.json").read_text())
        except Exception:
            return None

    # ---------------------------------------------------------- scheduling
    def in_window(self) -> bool:
        try:
            from zoneinfo import ZoneInfo
            h = datetime.now(ZoneInfo(self.settings.timezone)).hour
        except Exception:
            h = datetime.now().hour
        a, b = self.settings.start_hour, self.settings.end_hour
        return a <= h < b if a <= b else (h >= a or h < b)

    def busy(self) -> bool:
        try:
            return os.getloadavg()[0] > self.settings.max_load * max(1, os.cpu_count() or 1) / 2
        except (AttributeError, OSError):         # Windows has no load average
            return False

    def start_scheduler(self):
        if self._thread and self._thread.is_alive():
            return

        def loop():
            last_day = None
            while not self._stop.wait(600):       # look every 10 minutes
                if not self.settings.enabled or self.job["running"] or not self.in_window() or self.busy():
                    continue
                today = datetime.now().date().isoformat()
                if last_day == today and self.state["last"].get("night") == today:
                    continue
                last_day = today
                self.run("night")
        self._thread = threading.Thread(target=loop, daemon=True)
        self._thread.start()

    def run(self, phase: str = "night", background: bool = True):
        """phase: night (everything), gather, train, scan, cleanup."""
        if self.job["running"]:
            raise RuntimeError("Automatic training is already running.")
        if phase not in ("night", "gather", "train", "scan", "cleanup"):
            raise ValueError("Unknown phase.")
        self._stop_round = threading.Event()
        self.job = {"running": True, "phase": phase, "message": "Starting…", "progress": 0.0}

        def work():
            try:
                if phase in ("night", "cleanup"):
                    self.cleanup()
                if phase in ("night", "gather"):
                    self.gather(self.settings.gather_minutes * 60)
                if phase in ("night", "train"):
                    self.train_round(force=phase == "train")
                if phase in ("night", "scan"):
                    self.scan_accuracy()
                if phase == "night":
                    self.state["last"]["night"] = datetime.now().date().isoformat()
                self.job["message"] = "Done."
            except Exception as e:                 # never takes Vox down
                self.job["message"] = f"Stopped: {e}"[:400]
            finally:
                self.save()
                self.job.update(running=False, progress=1.0)
        if background:
            threading.Thread(target=work, daemon=True).start()
        else:
            work()

    def stop(self):
        if getattr(self, "_stop_round", None):
            self._stop_round.set()

    def _stopped(self) -> bool:
        return getattr(self, "_stop_round", None) is not None and self._stop_round.is_set()

    # -------------------------------------------------------------- gather
    def _words(self) -> list[str]:
        d = self.dictionary
        if d is None or not d.installed:
            raise ValueError("Install the American English dictionary first (Words tab).")
        with d._lock:
            rows = d._conn().execute("SELECT word FROM words WHERE word NOT LIKE '% %' ORDER BY n_senses DESC, word").fetchall()
        return [r[0] for r in rows]

    @property
    def asr(self):
        if self._asr is None:
            try:
                from faster_whisper import WhisperModel
                self._asr = WhisperModel("base", compute_type="int8", cpu_threads=max(1, self.settings.threads))
            except Exception:
                self._asr = False
        return self._asr or None

    def _transcribe(self, wav: np.ndarray, sr: int):
        from .audio import resample
        x = resample(wav, sr, 16000) if sr != 16000 else wav
        segs, info = self.asr.transcribe(x.astype(np.float32), word_timestamps=True, vad_filter=False)
        segs = list(segs)
        words = [(w.word.strip(), w.start, w.end) for s in segs for w in (s.words or [])]
        conf = float(np.mean([s.avg_logprob for s in segs])) if segs else -9.0
        return " ".join(w for w, _, _ in words), words, info.language, float(info.language_probability), conf

    def _search(self, word: str, n: int, dl: Path) -> list[dict]:
        from .data.sources import LicenseError, _download, _http_json, check_license, normalize_license
        q = f'("{word}") AND (mediatype:audio OR mediatype:movies) ' \
            f'AND (licenseurl:*publicdomain* OR licenseurl:*creativecommons.org/licenses/by/*)'
        url = "https://archive.org/advancedsearch.php?" + urllib.parse.urlencode(
            {"q": q, "fl[]": ["identifier", "licenseurl", "title", "creator", "language", "coverage", "subject",
                              "description"], "rows": n * 3, "output": "json"}, doseq=True)
        out = []
        for doc in _http_json(url)["response"]["docs"]:
            if len(out) >= n or self._stopped():
                break
            lic = normalize_license(doc.get("licenseurl", ""))
            try:
                check_license(lic, False)
            except LicenseError:
                self.state["skipped"]["license"] += 1
                continue
            time.sleep(self.settings.pause_secs)
            ident = doc["identifier"]
            meta = _http_json(f"https://archive.org/metadata/{urllib.parse.quote(ident)}")
            files = [f for f in meta.get("files", []) if Path(f.get("name", "")).suffix.lower() in AUDIO
                     and 0 < int(f.get("size") or 0) <= MAX_FILE]
            if not files:
                self.state["skipped"]["no_small_audio"] += 1
                continue
            f = min(files, key=lambda f: (f.get("source") != "original", int(f.get("size"))))
            time.sleep(self.settings.pause_secs)
            path = _download(f"https://archive.org/download/{ident}/{urllib.parse.quote(f['name'])}",
                             dl / hashlib.sha1(ident.encode()).hexdigest()[:12] / Path(f["name"]).name)
            text = " ".join(str(doc.get(k) if not isinstance(doc.get(k), list) else " ".join(map(str, doc.get(k))))
                            for k in ("title", "coverage", "subject", "description", "language") if doc.get(k))
            credit = ""
            if lic.startswith("cc-by"):              # only Creative Commons BY needs a credit
                creator = doc.get("creator", "unknown")
                creator = ", ".join(creator) if isinstance(creator, list) else creator
                credit = f'"{doc.get("title", ident)}" by {creator}, archive.org/details/{ident} ({lic})'
            out.append({"path": path, "license": lic, "credit": credit, "about": text[:3000],
                        "speaker": "s" + hashlib.sha1(ident.encode()).hexdigest()[:10]})
        return out

    @staticmethod
    def region_of(about: str) -> str | None:
        t = about.lower()
        for did, pat in REGIONS.items():
            if re.search(pat, t):
                return did
        return None

    def gather(self, seconds: float) -> int:
        """Collect clips for up to `seconds`. Returns how many were added."""
        import soundfile as sf
        from .audio import normalize_loudness
        from .data.process import QualityLimits, _decode, fingerprint, label_delivery, quality, segment
        from .text import normalize
        if self.asr is None:
            raise RuntimeError("Whisper isn't installed (Learning tab, Install Whisper).")
        level = throttle_level()
        if level >= 2:                                # throttled: no downloads at all
            self.job["message"] = f"Gathering paused to stay within the free allowance: {(server_usage() or {}).get('reason', '')}"
            self.state["history"].append({"at": time.time(), "phase": "gather", "added": 0, "paused": True})
            return 0
        if level == 1:                                # careful: half as long, twice the pauses
            seconds /= 2
        pause = self.settings.pause_secs * (2 if level == 1 else 1)
        words = self._words()
        sr = self.engine.sr
        limits = QualityLimits(min_snr_db=18.0)
        seen = set(self._read("fingerprints.json", []))
        end = time.time() + seconds
        added = 0
        while time.time() < end and not self._stopped():
            i = self.state["cursor"] % len(words)
            word = words[i]
            self.state["cursor"] = i + 1
            self.job.update(phase="gather", message=f"Listening for “{word}” (word {i + 1:,} of {len(words):,})",
                            progress=round(1 - (end - time.time()) / seconds, 3))
            with tempfile.TemporaryDirectory() as td:
                try:
                    items = self._search(word, self.settings.items_per_word, Path(td))
                except Exception as e:
                    self.state["skipped"]["search_failed"] += 1
                    time.sleep(self.settings.pause_secs * 5)
                    continue
                for it in items:
                    try:
                        wav = _decode(it["path"], sr)[: sr * 600]
                    except Exception:
                        self.state["skipped"]["decode"] += 1
                        continue
                    region = self.region_of(it["about"])
                    credited = False
                    for n, (a, b) in enumerate(segment(wav, sr, limits)[:40]):
                        seg = wav[a:b]
                        secs = len(seg) / sr
                        if not (limits.min_secs <= secs <= limits.max_secs):
                            continue
                        q = quality(seg, sr)
                        if q["snr_db"] < limits.min_snr_db or q["clip_ratio"] > limits.max_clip_ratio \
                                or q["bandwidth_hz"] < limits.min_bandwidth_hz:
                            self.state["skipped"]["quality"] += 1
                            continue
                        fp = fingerprint(seg, sr)
                        if fp in seen:
                            continue
                        seen.add(fp)
                        seg = normalize_loudness(seg)
                        text, wtimes, lang, lang_p, conf = self._transcribe(seg, sr)
                        if conf < -0.8 or lang_p < 0.6 or len(text.strip()) < 3:
                            self.state["skipped"]["unclear"] += 1
                            continue
                        plain = normalize(text) if lang == "en" else text.strip()
                        labeled, stats = label_delivery(seg, sr, wtimes, plain)
                        cid = hashlib.sha1(f"{it['speaker']}:{fp}".encode()).hexdigest()[:16]
                        sf.write(str(self.data / "clips" / f"{cid}.flac"), np.clip(seg, -1, 1), sr, subtype="PCM_16")
                        row = {"id": cid, "wav": f"clips/{cid}.flac", "text": labeled, "plain_text": plain,
                               "speaker": it["speaker"], "emotion": None, "emotion_source": "none",
                               "secs": round(secs, 3), "chars_per_sec": len(plain) / secs, "snr_db": q["snr_db"],
                               "brightness": q["brightness"], "roughness": q["roughness"],
                               "breathiness": q["breathiness"], "source": "autotrain", "license": it["license"],
                               "attribution": "", "language": lang, "dialect": region if lang == "en" else None,
                               "prosody": [0.0, 0.0, 0.0, 0.0], **stats}
                        with open(self.manifest, "a") as f:
                            f.write(json.dumps(row) + "\n")
                        if it["credit"] and not credited:     # one line per recording
                            with open(self.data / "credits.txt", "a") as f:
                                f.write(it["credit"] + "\n")
                            credited = True
                        self._learn(lang, region, row, [w for w, _, _ in wtimes])
                        added += 1
                        if self._stopped() or time.time() >= end:
                            break
            self._write("fingerprints.json", sorted(seen)[-200000:])
            self.save()
            time.sleep(pause)
            if throttle_level() >= 2:
                self.job["message"] = "Gathering paused to stay within the free allowance."
                break
        self.state["history"].append({"at": time.time(), "phase": "gather", "added": added})
        self.cleanup(quiet=True)
        return added

    def _learn(self, lang, region, row, words):
        s = self.state
        s["clips"] += 1
        s["new_clips"] += 1
        s["hours"] += row["secs"] / 3600
        L = s["languages"].setdefault(lang, {"clips": 0, "hours": 0.0})
        L["clips"] += 1
        L["hours"] = round(L["hours"] + row["secs"] / 3600, 4)
        self._count_words(lang, words)
        if lang == "en":                                  # all English, and the dialect if known
            for key in (["_all", region] if region else ["_all"]):
                d = s["dialects"].setdefault(key, {"clips": 0, "rate": 0.0, "range": 0.0})
                n = d["clips"] = d["clips"] + 1               # running means
                d["rate"] += (row["chars_per_sec"] - d["rate"]) / n
                d["range"] += (float(row.get("f0_range_st") or 0) - d["range"]) / n

    def learned_dialects(self) -> dict:
        """Each dialect's pace and melody compared with all English heard,
        and how strongly that is blended into its settings (more clips, more weight)."""
        ds = self.state["dialects"]
        base = ds.get("_all")
        out = {}
        if not base or base["clips"] < 20:
            return out
        for did, d in ds.items():
            if did == "_all" or d["clips"] < 5:
                continue
            weight = min(0.6, d["clips"] / 500)
            rate = float(np.clip((d["rate"] - base["rate"]) / max(base["rate"], 1e-3) * 4, -1, 1))
            rng = float(np.clip((d["range"] - base["range"]) / max(base["range"], 1e-3) * 2, -1, 1))
            out[did] = {"clips": d["clips"], "weight": round(weight, 3),
                        "prosody": {"rate": round(rate, 3), "pitch_range": round(rng, 3)}}
        return out

    def store_learned_dialects(self):
        """Write what was learned where dialects.py reads it (voices/dialects-learned.json)."""
        path = Path(self.engine.voices.root) / "dialects-learned.json"
        path.write_text(json.dumps(self.learned_dialects(), indent=1))

    # --------------------------------------------------------------- train
    def _split(self):
        rows = [json.loads(l) for l in self.manifest.read_text().splitlines() if l.strip()] if self.manifest.exists() else []
        rows = [r for r in rows if r.get("language", "en") == "en"]   # the model speaks English text for now
        train_p, val = self.data / "train.jsonl", self.data / "val.jsonl"
        with open(train_p, "w") as ft, open(val, "w") as fv:
            for r in rows:
                (fv if int(r["id"][:2], 16) < 5 else ft).write(json.dumps(r) + "\n")   # about 2% held out
        return train_p, len(rows)

    def train_round(self, force: bool = False) -> dict:
        import torch
        from .config import VoxConfig
        from .train import train, train_vocoder
        self.store_learned_dialects()
        if throttle_level() >= 3:
            msg = "Training paused to stay within the free allowance (essential work only)."
            self.job["message"] = msg
            return {"trained": False, "why": msg}
        imported = self.import_gpu_model()
        if imported:
            return {"trained": False, "imported": imported, "why": "Checked the newest model from the free GPU."}
        if not force and self.state["new_clips"] < self.settings.min_new_clips:
            msg = f"Waiting for more clips ({self.state['new_clips']} of {self.settings.min_new_clips})."
            self.job["message"] = msg
            return {"trained": False, "why": msg}
        if not (self.settings.local_training or torch.cuda.is_available()):
            msg = ("Vox's own model trains on the free GPU (Kaggle); this computer gathers words, "
                   "checks how clearly Vox speaks and tries each new model from the GPU.")
            self.job["message"] = msg
            return {"trained": False, "why": msg}
        train_p, n = self._split()
        if n < 20:
            return {"trained": False, "why": "Fewer than 20 English clips so far."}
        torch.set_num_threads(max(1, self.settings.threads))
        run = self.dir / "run"
        run.mkdir(exist_ok=True)
        ckpt = run / "vox.pt"
        resume = str(ckpt) if ckpt.exists() else None
        cfg = None if resume else VoxConfig.preset(self.settings.preset)
        if cfg is not None:
            cfg.train.batch_frames = 6000               # small batches for a processor
            cfg.train.log_every, cfg.train.save_every = 20, 10 ** 9
        step0 = 0
        if resume:
            step0 = int((torch.load(resume, map_location="cpu", weights_only=False).get("train_state") or {})
                        .get("step", 0))
        speed = self.state["last"].get("secs_per_step") or 4.0
        steps = max(20, int(self.settings.train_minutes * 60 / speed))
        self.job.update(phase="train", message=f"Training ({steps} steps, about {self.settings.train_minutes} minutes)", progress=0.1)
        t0 = time.time()
        train([str(train_p)], run, cfg=cfg, resume=resume, max_steps=step0 + steps)
        self.state["last"]["secs_per_step"] = round((time.time() - t0) / steps, 3)
        self.state["rounds"] += 1
        if self.state["rounds"] % max(1, self.settings.vocoder_every) == 0:
            self.job.update(message="Training the vocoder", progress=0.6)
            train_vocoder(str(ckpt), [str(train_p)], steps=max(50, steps // 4), batch=4, save_every=10 ** 9)
        self.state["new_clips"] = 0
        result = self.evaluate_and_promote(ckpt)
        self.state["history"].append({"at": time.time(), "phase": "train", "steps": steps, **result})
        return {"trained": True, **result}

    def _word_accuracy(self, model_path: str | None) -> float:
        """Share of the test sentences' words Whisper hears back (0..1)."""
        from .engine import VoxEngine
        if self.asr is None:
            return 0.0
        if model_path is None:
            eng = self.engine
            voice = "narrator" if "narrator" in eng.voices.names() else (eng.voices.names() or ["narrator"])[0]
        else:                    # its own test voice, so a model of another size can't trip over saved voices
            eng = VoxEngine(model_path, voices_dir=self.dir / "eval-voices", cache_dir=None, device="cpu")
            eng.source = "own"                 # the candidate itself, never the base voices
            if "eval" not in eng.voices.names():
                eng.design_voice("clear neutral narrator", seed=1, name="eval")
            voice = "eval"
        hit = total = 0
        for i, line in enumerate(TEST_LINES):
            if model_path is None:
                with self.lock:
                    res = eng.speak(line, voice=voice, seed=100 + i)
            else:
                res = eng.speak(line, voice=voice, seed=100 + i)
            heard = set(re.sub(r"[^a-z' ]", " ", self._transcribe(res.wav, res.sample_rate)[0].lower()).split())
            want = re.sub(r"[^a-z' ]", " ", line.lower()).split()
            hit += sum(1 for w in want if w in heard)
            total += len(want)
        return hit / max(1, total)

    def evaluate_and_promote(self, ckpt: Path) -> dict:
        """Go live with ckpt if Whisper hears more of the test lines from it than
        from what speaks now (the base voices, or the live model)."""
        from . import base as basevox
        self.job.update(phase="check", message="Checking the new model against the live voices", progress=0.8)
        new = self._word_accuracy(str(ckpt))
        live = self._word_accuracy(None)
        was = self.engine.source
        out = {"candidate": round(new, 3), "live": round(live, 3), "against": was, "promoted": False}
        if self.asr is not None and new >= live + self.settings.min_gain:
            live_dir = self.root / "runs" / "v1"
            live_dir.mkdir(parents=True, exist_ok=True)
            if (live_dir / "vox.pt").exists():
                shutil.copy2(live_dir / "vox.pt", live_dir / "previous.pt")
            shutil.copy2(ckpt, live_dir / "vox.pt")
            info = {"own_accuracy": round(new, 3), "at": time.time()}
            if was == "base":
                info["base_accuracy"] = round(live, 3)
            basevox.set_voice_source(self.root, "own", **info)
            with self.lock:
                self.engine.reload(live_dir / "vox.pt")
            out["promoted"] = True
        elif was == "base":
            self.state["last"]["base_accuracy"] = round(live, 3)
        return out

    # ------------------------------------------------- models from the free GPU
    def gpu_status(self) -> dict | None:
        """Where training on the free GPU stands (written by vox-gpu-train.yml)."""
        for d in self.gpu_dirs():
            out = {}
            for name in ("gpu-status.json", "progress.json"):
                try:
                    out[name.split(".")[0].replace("-", "_")] = json.loads((d / name).read_text())
                except Exception:
                    pass
            if out:
                p = out.get("progress") or {}
                return {"report": out.get("gpu_status"), "step": p.get("step"), "gpu_hours": p.get("gpu_hours"),
                        "sessions": (p.get("sessions") or [])[-5:], "last_tried": self.state["last"].get("gpu_model")}
        return {"last_tried": self.state["last"].get("gpu_model")} if self.state["last"].get("gpu_model") else None

    def gpu_dirs(self) -> list[Path]:
        """Where models trained on the free GPU arrive (kaggle/ and the
        vox-gpu-train workflow put them in the server's models folder)."""
        dirs = [Path(os.environ.get("VOX_GPU_MODELS", "/srv/vox/models")), self.dir / "gpu"]
        return [d for d in dirs if d.is_dir()]

    def import_gpu_model(self) -> dict | None:
        """Try the newest model from the free GPU that hasn't been tried yet."""
        seen = self.state.setdefault("gpu_seen", [])
        found = sorted((p for d in self.gpu_dirs() for p in d.glob("vox-*.pt")), key=lambda p: p.stat().st_mtime)
        new = [p for p in found if f"{p.name}:{int(p.stat().st_mtime)}" not in seen]
        if not new:
            return None
        ckpt = new[-1]
        self.job.update(phase="check", message=f"Trying the newest model from the free GPU ({ckpt.name})", progress=0.5)
        res = self.evaluate_and_promote(ckpt)
        seen.extend(f"{p.name}:{int(p.stat().st_mtime)}" for p in new)
        del seen[:-200]
        self.state["last"]["gpu_model"] = {"file": ckpt.name, **res, "at": time.time()}
        self.save()
        return {"file": ckpt.name, **res}

    def rollback(self) -> bool:
        """The previous live model, or the base voices if Vox's own model was the
        first to go live."""
        from . import base as basevox
        live_dir = self.root / "runs" / "v1"
        if not (live_dir / "previous.pt").exists():
            if self.engine.source == "own" and basevox.voice_source(self.root).get("source") == "own":
                basevox.set_voice_source(self.root, "base", at=time.time(), rolled_back=True)
                with self.lock:
                    self.engine.refresh_source()
                return True
            return False
        shutil.copy2(live_dir / "previous.pt", live_dir / "vox.pt")
        with self.lock:
            self.engine.reload(live_dir / "vox.pt")
        return True

    # ----------------------------------------------------- accuracy scans
    def scan_accuracy(self, n_words: int = 40) -> dict:
        """Speak a rotating sample of dictionary words; record how many Whisper hears."""
        if self.asr is None:
            return {"skipped": "no Whisper"}
        if throttle_level() >= 3:
            return {"skipped": "paused to stay within the free allowance"}
        words = self._words()
        start = self.state["last"].get("scan_cursor", 0)
        sample = [words[(start + i) % len(words)] for i in range(n_words)]
        self.state["last"]["scan_cursor"] = (start + n_words) % len(words)
        names = self.engine.voices.names()
        voice = "narrator" if "narrator" in names else (names or ["narrator"])[0]
        hit, missed = 0, []
        for i, w in enumerate(sample):
            self.job.update(phase="scan", message=f"Checking how clearly Vox says “{w}”", progress=i / n_words)
            with self.lock:
                res = self.engine.speak(f"{w}.", voice=voice, seed=7)
            heard = re.sub(r"[^a-z' ]", "", self._transcribe(res.wav, res.sample_rate)[0].lower()).split()
            if w.lower() in heard:
                hit += 1
            else:
                missed.append(w)
        acc = hit / n_words
        self.state["accuracy"].append({"at": time.time(), "words": n_words, "accuracy": round(acc, 3)})
        self.state["last"]["missed"] = missed[:40]
        return {"accuracy": acc, "missed": missed}

    # -------------------------------------------------------------- cleanup
    def cleanup(self, quiet: bool = False) -> dict:
        """Stay inside the storage budget: old caches, old model files, and the
        lowest-quality clips first when the dataset is over budget."""
        freed = 0
        now = time.time()
        cache = self.root / "cache"
        if cache.exists():                                  # rendered lines older than two weeks
            for f in cache.glob("*.pt"):
                if now - f.stat().st_mtime > 14 * 86400:
                    freed += f.stat().st_size
                    f.unlink(missing_ok=True)
        for f in (self.dir / "run").glob("*.tmp") if (self.dir / "run").exists() else []:
            freed += f.stat().st_size
            f.unlink(missing_ok=True)
        budget = self.settings.budget_gb * 1e9
        used = self.used_bytes()
        dropped = 0
        if used > budget and self.manifest.exists():
            rows = [json.loads(l) for l in self.manifest.read_text().splitlines() if l.strip()]
            rows.sort(key=lambda r: r.get("snr_db", 0))     # noisiest first
            keep = []
            for r in rows:
                if used > budget * 0.9:
                    p = self.data / r["wav"]
                    if p.exists():
                        size = p.stat().st_size
                        p.unlink()
                        used -= size
                        freed += size
                    dropped += 1
                else:
                    keep.append(r)
            keep.sort(key=lambda r: r["id"])
            tmp = self.manifest.with_suffix(".tmp")
            tmp.write_text("".join(json.dumps(r) + "\n" for r in keep))
            tmp.replace(self.manifest)
        out = {"freed_mb": round(freed / 1e6, 1), "dropped_clips": dropped, "used_gb": round(self.used_bytes() / 1e9, 2)}
        if not quiet:
            self.state["history"].append({"at": now, "phase": "cleanup", **out})
            self.save()
        return out


if __name__ == "__main__":               # the server's daily maintenance: python -m vox.autotrain --cleanup
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--cleanup", action="store_true")
    ap.add_argument("--root", default=".")
    a = ap.parse_args()
    if a.cleanup:
        class _E:                       # cleanup needs no model
            class voices:
                root = Path(a.root) / "voices"
        t = AutoTrainer(_E(), a.root, threading.Lock())
        print(json.dumps(t.cleanup()))
