"""The American English dictionary Vox installs on your computer.

    vox dictionary install          # one-time, free download (~2 minutes)
    vox dictionary look enunciation

Sources (both free for commercial use):
  * CMU Pronouncing Dictionary: ~135,000 words with American pronunciations
    and stress (BSD license), installed with `pip install cmudict`.
  * Open English WordNet: ~160,000 words and phrases with part of speech,
    definitions, example sentences and synonyms (CC BY 4.0, credit:
    "Open English WordNet, globalwordnet.github.io").
Words in neither (names, new words) get a pronunciation from Vox's own
letters-to-sounds model (g2p.py), so no word is ever unpronounceable.

No list holds "every" word: English adds words all the time. This covers
standard American English, and the letters-to-sounds model covers the rest.
"""
from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
from pathlib import Path

from . import heteronyms
from .g2p import G2P
from .phonemes import respell, split, stress_pattern, syllables, to_ipa, valid

DEFAULT_DB = Path.home() / ".vox" / "dictionary.db"
POS_NAMES = {"n": "noun", "v": "verb", "a": "adjective", "s": "adjective", "r": "adverb"}
WORD_RE = re.compile(r"[A-Za-z][A-Za-z'\-]*")


class Dictionary:
    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path else DEFAULT_DB
        self._db = None
        self._lock = threading.Lock()

    @property
    def installed(self) -> bool:
        return self.path.exists() and self._meta("built") is not None

    def _conn(self):
        if self._db is None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._db = sqlite3.connect(str(self.path), check_same_thread=False)
            self._db.executescript("""
              CREATE TABLE IF NOT EXISTS words(word TEXT PRIMARY KEY, prons TEXT, n_senses INTEGER DEFAULT 0);
              CREATE TABLE IF NOT EXISTS senses(word TEXT, pos TEXT, definition TEXT, examples TEXT, synonyms TEXT);
              CREATE INDEX IF NOT EXISTS senses_word ON senses(word);
              CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);""")
        return self._db

    def _meta(self, k):
        if not self.path.exists():
            return None
        with self._lock:
            r = self._conn().execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
        return json.loads(r[0]) if r else None

    def stats(self) -> dict:
        if not self.installed:
            return {"installed": False}
        with self._lock:
            c = self._conn()
            n = c.execute("SELECT COUNT(*) FROM words").fetchone()[0]
            with_p = c.execute("SELECT COUNT(*) FROM words WHERE prons != '[]'").fetchone()[0]
            senses = c.execute("SELECT COUNT(*) FROM senses").fetchone()[0]
        return {"installed": True, "words": n, "with_pronunciation": with_p, "senses": senses,
                "built": self._meta("built"), "sources": self._meta("sources")}

    # ----------------------------------------------------------------- build
    def install(self, progress=lambda p, m: None, g2p: G2P | None = None) -> dict:
        """Download (free) and build the dictionary. Safe to run again."""
        import cmudict
        progress(0.02, "Loading the CMU Pronouncing Dictionary")
        cmu = cmudict.dict()
        prons: dict[str, list[dict]] = {w: [{"arpabet": " ".join(p), "source": "cmudict"} for p in ps]
                                        for w, ps in cmu.items()}
        progress(0.15, "Downloading Open English WordNet (first time only)")
        import wn
        try:
            wnet = wn.Wordnet("oewn:2024")
        except wn.Error:
            wn.download("oewn:2024", progress_handler=None)
            wnet = wn.Wordnet("oewn:2024")
        progress(0.35, "Reading meanings, examples and synonyms")
        senses: list[tuple] = []
        n_senses: dict[str, int] = {}
        synsets = wnet.synsets()
        for i, ss in enumerate(synsets):
            lemmas = ss.lemmas()
            pos = POS_NAMES.get(ss.pos, ss.pos)
            definition = ss.definition() or ""
            examples = json.dumps(ss.examples()[:3])
            for lemma in lemmas:
                key = lemma.lower()
                syn = json.dumps([x for x in lemmas if x.lower() != key][:8])
                senses.append((key, pos, definition, examples, syn))
                n_senses[key] = n_senses.get(key, 0) + 1
            if i % 20000 == 0:
                progress(0.35 + 0.3 * i / len(synsets), f"Reading meanings ({i:,} of {len(synsets):,})")
        # every WordNet word gets a pronunciation: from CMU, or built word by word, or guessed
        progress(0.7, "Working out pronunciations for words not in the CMU dictionary")
        missing = [w for w in n_senses if w not in prons]
        g2p = g2p or G2P.load()
        unknown_parts = sorted({p for w in missing for p in re.split(r"[ \-]", w) if p and p not in cmu})
        guessed = dict(zip(unknown_parts, g2p.batch(unknown_parts))) if g2p and unknown_parts else {}
        for w in missing:
            parts = [p for p in re.split(r"[ \-]", w) if p]
            arp = []
            for p in parts:
                if p in cmu:
                    arp.append(" ".join(cmu[p][0]))
                elif guessed.get(p):
                    arp.append(guessed[p])
                else:
                    arp = None
                    break
            if arp:
                prons[w] = [{"arpabet": " ".join(arp), "source": "built" if all(p in cmu for p in parts) else "guessed"}]
        progress(0.85, "Saving")
        allwords = set(prons) | set(n_senses)
        with self._lock:
            c = self._conn()
            c.execute("DELETE FROM words"); c.execute("DELETE FROM senses")
            c.executemany("INSERT INTO words VALUES(?,?,?)",
                          ((w, json.dumps(prons.get(w, [])), n_senses.get(w, 0)) for w in allwords))
            c.executemany("INSERT INTO senses VALUES(?,?,?,?,?)", senses)
            meta = {"built": time.strftime("%Y-%m-%d %H:%M"),
                    "sources": ["CMU Pronouncing Dictionary (BSD)", "Open English WordNet 2024 (CC BY 4.0)",
                                "Vox letters-to-sounds model for the rest"]}
            c.executemany("INSERT INTO meta VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
                          [(k, json.dumps(v)) for k, v in meta.items()])
            c.commit()
        progress(1.0, f"Installed {len(allwords):,} words and phrases")
        return self.stats()

    # ---------------------------------------------------------------- lookup
    def prons(self, word: str) -> list[dict]:
        if not self.installed:
            return []
        with self._lock:
            r = self._conn().execute("SELECT prons FROM words WHERE word=?", (word.lower(),)).fetchone()
        return json.loads(r[0]) if r else []

    def lookup(self, word: str, g2p: G2P | None = None, user: dict | None = None) -> dict:
        """Everything about a word: how to say it, its parts, meanings and usage."""
        w = word.strip().lower()
        out = {"word": w, "found": False, "pronunciations": [], "senses": [], "usage_pronunciations": []}
        plist = self.prons(w)
        if user and w in user:
            say = user[w]
            if valid(say):
                plist = [{"arpabet": say, "source": "your fix"}] + plist
        if not plist and g2p is not None and WORD_RE.fullmatch(w):
            plist = [{"arpabet": g2p(w), "source": "guessed"}]
        out["pronunciations"] = [_describe(p) for p in plist if p.get("arpabet")]
        out["usage_pronunciations"] = [_describe(v) for v in heteronyms.variants(w)]
        if self.installed:
            with self._lock:
                rows = self._conn().execute("SELECT pos, definition, examples, synonyms FROM senses WHERE word=?",
                                            (w,)).fetchall()
            out["senses"] = [{"pos": r[0], "definition": r[1], "examples": json.loads(r[2]),
                              "synonyms": json.loads(r[3])} for r in rows]
        out["found"] = bool(out["pronunciations"] or out["senses"])
        return out

    def search(self, prefix: str, limit: int = 20) -> list[str]:
        if not self.installed or not prefix.strip():
            return []
        p = prefix.strip().lower().replace("%", "").replace("_", "")
        with self._lock:
            rows = self._conn().execute("SELECT word FROM words WHERE word >= ? AND word < ? ORDER BY n_senses DESC, "
                                        "length(word) LIMIT ?", (p, p + "￿", limit)).fetchall()
        return [r[0] for r in rows]


def _describe(p: dict) -> dict:
    a = p["arpabet"]
    return {**p, "ipa": to_ipa(a), "respelling": respell(a), "syllables": len(syllables(split(a))),
            "stress": stress_pattern(a)}


class Pronouncer:
    """Turns words into sounds for the speech model: your fixes first, then
    usage rules for words like read/record, then the dictionary, then the
    letters-to-sounds model. Words in other alphabets are left as letters."""

    def __init__(self, dictionary: Dictionary | None = None, g2p: G2P | None = None):
        self.dictionary = dictionary
        self.g2p = g2p
        self.user: dict[str, str] = {}
        self._cmu = None
        self._cache: dict[str, str | None] = {}

    @classmethod
    def default(cls) -> "Pronouncer":
        d = Dictionary()
        return cls(d if d.installed else None, G2P.load())

    def _cmu_dict(self):
        if self._cmu is None:
            try:
                import cmudict
                self._cmu = cmudict.dict()
            except ImportError:
                self._cmu = {}
        return self._cmu

    def set_user(self, lexicon: dict[str, str]):
        self.user = {k.lower(): v for k, v in lexicon.items() if valid(v)}
        self._cache.clear()

    def word(self, word: str, prev: str | None = None, nxt: str | None = None) -> str | None:
        w = word.lower()
        if not WORD_RE.fullmatch(w):
            return None
        if w in self.user:
            return self.user[w]
        h = heteronyms.choose(w, prev, nxt)
        if h:
            return h
        if w in self._cache:
            return self._cache[w]
        arp = None
        if self.dictionary is not None:
            ps = self.dictionary.prons(w)
            arp = ps[0]["arpabet"] if ps else None
        if arp is None:
            c = self._cmu_dict().get(w)
            arp = " ".join(c[0]) if c else None
        if arp is None and self.g2p is not None:
            arp = self.g2p(w) or None
        self._cache[w] = arp
        return arp
