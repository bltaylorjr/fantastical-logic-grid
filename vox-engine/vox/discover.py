"""Discover voices: walk every American English word in the dictionary, use the
words as search keywords for openly licensed recordings, and make a new voice
from each group of words, blended from at least 3 different speakers.

    crawler = Discovery(engine, "learning", lock)
    crawler.start(voices=20, words_per_voice=3)   # runs in the background
    crawler.status()                               # progress, voices made, recent tries
    crawler.stop()

Every voice goes through the same rules as "New voice from samples": only public
domain or Creative Commons BY recordings (each license re-checked), the same
person counted once, at least 3 speakers, nobody over 40%, and the result must
not sound like any one of them. It is polite to the Internet Archive: one search
at a time, a pause between requests, one small file per recording, and every
download is deleted as soon as its voice is made or refused.

Progress is saved after each group of words, so a crawl picks up where it left
off, after a stop or a restart, until every word has been used.
"""
from __future__ import annotations

import json
import random
import re
import tempfile
import threading
import time
import urllib.parse
from pathlib import Path

import torch.nn.functional as F

from .data.process import QualityLimits
from .data.sources import LicenseError, RawItem, _download, _http_json, check_license, normalize_license
from .sampling import MIN_SPEAKERS, SpeakerFound, _speakers_in, blend
from .voices import Voice

AUDIO = (".mp3", ".ogg", ".flac", ".wav")
MAX_FILE = 40 * 1024 * 1024          # skip recordings over 40 MB: a few minutes is plenty
PAUSE = 1.5                          # seconds between requests to archive.org
SAMPLE_LINE = "Hello there. This is my voice. The quick brown fox jumps over the lazy dog."


def _slug(words: list[str]) -> str:
    s = "-".join(re.sub(r"[^a-z0-9]+", "", w.lower()) for w in words)
    return re.sub(r"-+", "-", s).strip("-")[:55] or "voice"


class Discovery:
    def __init__(self, engine, root: str | Path, lock: threading.Lock, dictionary=None):
        self.engine, self.lock = engine, lock
        self.file = Path(root) / "discover.json"
        self.dictionary = dictionary
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.job = {"running": False, "message": "", "progress": 0.0}
        self.state = {"cursor": 0, "tried": 0, "made": [], "refused": 0, "recent": []}
        if self.file.exists():
            try:
                self.state.update(json.loads(self.file.read_text()))
            except Exception:
                pass

    # ------------------------------------------------------------- words
    def _words(self) -> list[str]:
        """Every word and phrase in the installed dictionary, most-used first
        (they find the most recordings), in a fixed order so the cursor is stable."""
        d = self.dictionary
        if d is None or not d.installed:
            raise ValueError("Install the American English dictionary first (Words tab, Install).")
        with d._lock:
            rows = d._conn().execute("SELECT word FROM words ORDER BY n_senses DESC, word").fetchall()
        return [r[0] for r in rows]

    def _save(self):
        self.state["recent"] = self.state["recent"][-60:]
        self.file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, indent=1))
        tmp.replace(self.file)

    def status(self) -> dict:
        total = None
        try:
            total = len(self._words())
        except Exception:
            pass
        made = [m for m in self.state["made"] if m["name"] in set(self.engine.voices.names())]
        return {**self.job, "cursor": self.state["cursor"], "total_words": total, "tried": self.state["tried"],
                "refused": self.state["refused"], "voices": made[::-1], "recent": self.state["recent"][::-1][:20],
                "sample_line": SAMPLE_LINE}

    # ------------------------------------------------------------ crawl
    def start(self, voices: int = 20, words_per_voice: int = 3, speakers: int = 5, items_per_word: int = 3) -> None:
        if self.job["running"]:
            raise RuntimeError("Discovery is already running.")
        voices = max(1, min(int(voices), 10000))
        words_per_voice = max(1, min(int(words_per_voice), 8))
        speakers = max(MIN_SPEAKERS, min(int(speakers), 12))
        items_per_word = max(1, min(int(items_per_word), 8))
        words = self._words()
        self._stop.clear()
        self.job = {"running": True, "message": "Starting…", "progress": 0.0, "goal": voices}

        def run():
            made_now = 0
            try:
                while made_now < voices and not self._stop.is_set():
                    i = self.state["cursor"]
                    if i >= len(words):
                        self.job["message"] = "Every word in the dictionary has been used."
                        break
                    group = words[i:i + words_per_voice]
                    self.job.update(message=f"Words {i + 1:,}–{i + len(group):,} of {len(words):,}: " + ", ".join(group),
                                    progress=round(made_now / voices, 3))
                    ok, info = self._one(group, speakers, items_per_word)
                    self.state["cursor"] = i + len(group)
                    self.state["tried"] += 1
                    entry = {"words": group, "at": time.time(), "ok": ok, "detail": info}
                    if ok:
                        made_now += 1
                        self.state["made"].append({"name": info["name"], "words": group, "at": time.time(),
                                                   "speakers": info["speakers"], "sources": info["sources"]})
                    else:
                        self.state["refused"] += 1
                    self.state["recent"].append(entry)
                    self._save()
                if not self.job["message"].startswith("Every word"):
                    self.job["message"] = (f"Stopped. Made {made_now} new voice(s) this run." if self._stop.is_set()
                                           else f"Done. Made {made_now} new voice(s) this run.")
            except Exception as e:      # never takes the server down
                self.job["message"] = f"Discovery stopped: {e}"[:400]
            finally:
                self.job.update(running=False, progress=1.0)

        self._thread = threading.Thread(target=run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def reset(self) -> None:
        if self.job["running"]:
            raise RuntimeError("Stop discovery first.")
        self.state.update(cursor=0, tried=0, refused=0, recent=[])
        self._save()

    # ---------------------------------------------------- one voice
    def _search(self, word: str, n: int, dl: Path) -> list[RawItem]:
        q = f'("{word}") AND (mediatype:audio OR mediatype:movies) ' \
            f'AND (licenseurl:*publicdomain* OR licenseurl:*creativecommons.org/licenses/by/*)'
        url = "https://archive.org/advancedsearch.php?" + urllib.parse.urlencode(
            {"q": q, "fl[]": ["identifier", "licenseurl", "title", "creator"], "rows": n * 2, "output": "json"},
            doseq=True)
        out: list[RawItem] = []
        for doc in _http_json(url)["response"]["docs"]:
            if len(out) >= n or self._stop.is_set():
                break
            lic = normalize_license(doc.get("licenseurl", ""))
            try:
                check_license(lic, False)
            except LicenseError:
                continue
            time.sleep(PAUSE)
            ident = doc["identifier"]
            meta = _http_json(f"https://archive.org/metadata/{urllib.parse.quote(ident)}")
            files = [f for f in meta.get("files", []) if Path(f.get("name", "")).suffix.lower() in AUDIO
                     and int(f.get("size") or 0) and int(f.get("size")) <= MAX_FILE]
            if not files:
                continue
            f = min(files, key=lambda f: (f.get("source") != "original", int(f.get("size"))))   # one small file
            time.sleep(PAUSE)
            path = _download(f"https://archive.org/download/{ident}/{urllib.parse.quote(f['name'])}",
                             dl / ident / Path(f["name"]).name)
            creator = doc.get("creator", "unknown")
            if isinstance(creator, list):
                creator = ", ".join(creator)
            out.append(RawItem(path, "discover", lic, f"ia:{ident}", None, None,
                               f'"{doc.get("title", ident)}" by {creator}, archive.org/details/{ident} ({lic})'))
        return out

    def _one(self, words: list[str], speakers: int, items_per_word: int) -> tuple[bool, dict | str]:
        limits = QualityLimits(min_snr_db=15.0)
        with tempfile.TemporaryDirectory() as td:
            items: list[RawItem] = []
            errors: list[str] = []
            for w in words:
                if self._stop.is_set():
                    return False, "stopped"
                try:
                    items += self._search(w, items_per_word, Path(td))
                except Exception as e:      # network or archive busy: try the next word
                    errors.append(f"search “{w}”: {e}"[:160])
                time.sleep(PAUSE)
            if not items:
                return False, errors[0] if errors else "no openly licensed recordings found"
            found: list[SpeakerFound] = []
            for item in items:
                if self._stop.is_set():
                    return False, "stopped"
                try:
                    with self.lock:      # the model is shared with speech: hold it only while listening
                        sps = _speakers_in(self.engine, item, 12, limits)
                except Exception:
                    continue
                for sp in sps:
                    if not any(float(F.cosine_similarity(sp.centroid, f.centroid, dim=0)) >= 0.85 for f in found):
                        found.append(sp)
        if len(found) < MIN_SPEAKERS:
            return False, f"only {len(found)} different speaker(s) found; {MIN_SPEAKERS} are needed"
        seed = random.randrange(2 ** 31)
        try:
            emb, pick, weights, top = blend([f.centroid for f in found], min(speakers, len(found)),
                                            random.Random(seed), 0.4, 0.75)
        except ValueError as e:
            return False, str(e)
        names = set(self.engine.voices.names())
        base = _slug(words)
        name, k = base, 2
        while name in names:
            name, k = f"{base}-{k}", k + 1
        sources = sorted({found[i].attribution for i in pick if found[i].attribution})
        voice = Voice(name=name, speaker_emb=emb.cpu().tolist(), origin="sampled", seed=seed, sources=sources,
                      description=f"Discovered: blend of {len(pick)} speakers ({', '.join(words)})"[:200])
        self.engine.voices.save(voice)
        return True, {"name": name, "speakers": len(pick), "similarity": round(top, 3), "sources": sources}
