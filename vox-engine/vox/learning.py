"""Continuous learning: the more Vox speaks, the better it gets.

The loop
  1. Every line it speaks is saved and scored automatically (voice match,
     intelligibility, emotion match, liveliness, pacing, clean audio). No human
     needed; this is how plain use turns into training material.
  2. Your feedback is the strongest signal: thumbs up/down on a take, A/B
     choices between two takes of the same line, and edits you keep.
     Each becomes a "preference pair" (this take is better than that one).
     The engine also makes pairs on its own: when the drift guard rejects a
     take and regenerates, and when auto-optimize compares settings.
  3. A refinement round fine-tunes a *candidate* copy of the model on
       * its best takes (self-training, gated by quality),
       * the preference pairs (Diffusion-DPO adapted to flow matching:
         push the model toward winners and away from losers, relative to a
         frozen reference so it can't drift far in one round),
       * a replay of the original training data so it never forgets.
     Voices with several liked takes have their identity nudged toward what
     you liked. Pacing preferences tune the duration model.
  4. The candidate and the current model both speak a fixed benchmark set
     with fixed seeds. The candidate is promoted only if it scores higher.
     Every version is kept; roll back at any time.
  5. Rounds start on their own after enough new feedback or takes (and not
     more often than you allow), or when you press Refine now.

Pronunciation fixes (lexicon) apply immediately to every line, and words the
transcriber keeps mishearing are listed so you can add fixes.

Everything is stored locally: learning/learning.db (SQLite) and
learning/takes/*.npy, learning/models/vNNNN/.
"""
from __future__ import annotations

import copy
import json
import math
import random
import shutil
import sqlite3
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from .audio import track_pitch
from .config import EMOTIONS
from .model import VoxModel
from .model.dit import norm_mel
from .text import PAD, parse_script, script_tokens, words_of
from .voices import cosine

BENCHMARK_LINES = [
    "Welcome back, traveler. The road was long, but you made it.",
    "Did you hear that? Something is moving in the dark.",
    "I told you a hundred times: never open the north gate!",
    "Take this lantern. You'll need it more than I will.",
    "Three keys, two doors, and only one of them leads home.",
    "Well... I suppose that's one way to solve a puzzle.",
]


@dataclass
class LearningSettings:
    auto_learn: bool = True
    every_n_feedback: int = 20        # start a round after this many new ratings/choices
    every_n_takes: int = 300          # ...or this many new auto-scored takes
    min_hours_between: float = 6.0
    min_quality: float = 75.0         # takes at or above this join self-training
    min_examples: int = 8             # skip a round with less new material than this
    steps: int = 300
    lr: float = 1e-5
    beta: float = 500.0               # preference strength (Diffusion-DPO beta)
    w_sft: float = 1.0
    w_dpo: float = 1.0
    replay_manifests: list = field(default_factory=list)  # original training data
    refine_voices: bool = True
    voice_min_likes: int = 3
    voice_step: float = 0.2           # how far a voice moves toward liked takes per round
    min_gain: float = 0.25            # benchmark points a candidate must win by
    benchmark_voices: int = 3
    use_whisper: bool = True          # if installed; enables intelligibility + word issues
    keep_takes_days: int = 90


class LearningStore:
    SCHEMA = """
    CREATE TABLE IF NOT EXISTS takes(id TEXT PRIMARY KEY, created REAL, text TEXT, voice TEXT,
        style TEXT, seed INTEGER, version TEXT, secs REAL, scores TEXT, quality REAL,
        rating INTEGER DEFAULT 0, note TEXT DEFAULT '', source TEXT, parent TEXT, used_in TEXT);
    CREATE INDEX IF NOT EXISTS takes_created ON takes(created);
    CREATE TABLE IF NOT EXISTS prefs(id INTEGER PRIMARY KEY AUTOINCREMENT, created REAL,
        winner TEXT, loser TEXT, kind TEXT, used_in TEXT);
    CREATE TABLE IF NOT EXISTS lexicon(word TEXT PRIMARY KEY, say_as TEXT, created REAL);
    CREATE TABLE IF NOT EXISTS word_issues(word TEXT PRIMARY KEY, misses INTEGER, seen INTEGER, last REAL);
    CREATE TABLE IF NOT EXISTS versions(version TEXT PRIMARY KEY, created REAL, path TEXT,
        parent TEXT, quality REAL, status TEXT, note TEXT, voices TEXT);
    CREATE TABLE IF NOT EXISTS rounds(id INTEGER PRIMARY KEY AUTOINCREMENT, started REAL,
        finished REAL, status TEXT, reason TEXT, version TEXT, n_takes INTEGER, n_prefs INTEGER,
        n_replay INTEGER, before REAL, after REAL, promoted INTEGER, message TEXT);
    CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
    """

    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        (root / "takes").mkdir(exist_ok=True)
        (root / "models").mkdir(exist_ok=True)
        self.db = sqlite3.connect(str(root / "learning.db"), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            self.db.executescript(self.SCHEMA)

    def q(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def x(self, sql, args=()):
        with self.lock:
            cur = self.db.execute(sql, args)
            self.db.commit()
            return cur.lastrowid

    def get(self, k, default=None):
        r = self.q("SELECT v FROM kv WHERE k=?", (k,))
        return json.loads(r[0]["v"]) if r else default

    def put(self, k, v):
        self.x("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, json.dumps(v)))


# ======================================================================= scoring
class QualityScorer:
    """0-100 scores a listener would care about, computed automatically."""
    WEIGHTS = {"voice_match": 0.3, "intelligibility": 0.3, "emotion_match": 0.1,
               "liveliness": 0.1, "pacing": 0.1, "clean_audio": 0.1}

    def __init__(self, engine, use_whisper: bool = True):
        self.engine = engine
        self._asr = None
        self.use_whisper = use_whisper

    @property
    def asr(self):
        if self._asr is None and self.use_whisper:
            from .data.process import Transcriber
            self._asr = Transcriber("base")
        return self._asr if self._asr is not None and self._asr.available else None

    @torch.no_grad()
    def score(self, mel: torch.Tensor, wav: np.ndarray, text: str, voice, style: dict) -> tuple[dict, list[str]]:
        e = self.engine
        sr = e.sr
        plain = " ".join(c.plain for c in parse_script(text, 10 ** 6, False))
        s: dict[str, float | None] = {}
        dev = e.device
        m = mel.to(dev)
        if m.shape[0] >= 20:
            emb = e.model.speaker(m.T[None])[0]
            s["voice_match"] = float(np.clip((cosine(emb, voice.emb_tensor(dev)) - 0.5) / 0.45, 0, 1) * 100)
        emo = style.get("emotion")
        if emo:
            name = emo if isinstance(emo, str) else max(emo, key=emo.get)
            name = "tender" if name == "warm" else name
            if name in EMOTIONS and m.shape[0] >= 20:
                prob = torch.softmax(e.model.emotion_clf(m.T[None]), -1)[0, EMOTIONS.index(name)]
                s["emotion_match"] = float(prob) * 100
        robotic = str(style.get("autotune") or voice.autotune or "").find("robot") >= 0
        secs = len(wav) / sr
        if secs > 0.3 and not robotic:
            seg = wav[: sr * 8].astype(np.float64)
            f0 = track_pitch(seg, sr, 480)
            v = f0[f0 > 0]
            if len(v) > 10:
                spread = float(np.std(12 * np.log2(v / np.median(v))))
                s["liveliness"] = float(np.clip(spread / 2.0, 0, 1) * 100)
        if secs > 0.3 and plain:
            cps = len(plain) / secs
            s["pacing"] = float(100 if 9 <= cps <= 18 else max(0.0, 100 - 12 * min(abs(cps - 9), abs(cps - 18))))
        clip = float(np.mean(np.abs(wav) > 0.995))
        frame = sr // 50
        env = np.sqrt(np.convolve(wav.astype(np.float64) ** 2, np.ones(frame) / frame, "same"))[::frame]
        quiet = env < max(1e-4, env.max() * 0.01)
        longest = _longest_run(quiet[5:-5]) / 50 if len(quiet) > 10 else 0
        s["clean_audio"] = float(max(0.0, 100 - clip * 5000 - max(0.0, longest - 1.2) * 40))
        missed: list[str] = []
        if self.asr is not None and plain:
            from .data.augment import word_error_rate
            heard = self.asr(wav, sr)[0]
            s["intelligibility"] = float(max(0.0, 1 - word_error_rate(plain, heard)) * 100)
            hw = set(words_of(heard))
            missed = [w for w in words_of(plain) if w not in hw and len(w) > 2]
        have = {k: v for k, v in s.items() if v is not None}
        wsum = sum(self.WEIGHTS[k] for k in have)
        s["overall"] = round(sum(self.WEIGHTS[k] * v for k, v in have.items()) / wsum, 2) if wsum else 0.0
        return {k: (round(v, 1) if v is not None else None) for k, v in s.items()}, missed


def _longest_run(mask) -> int:
    best = cur = 0
    for b in mask:
        cur = cur + 1 if b else 0
        best = max(best, cur)
    return best


# ====================================================================== system
class LearningSystem:
    def __init__(self, engine, root: str | Path = "learning", engine_lock: threading.Lock | None = None):
        self.engine = engine
        self.root = Path(root)
        self.store = LearningStore(self.root)
        self.lock = engine_lock or threading.RLock()
        self.settings = LearningSettings(**{k: v for k, v in self.store.get("settings", {}).items()
                                            if k in LearningSettings.__dataclass_fields__})
        self.scorer = QualityScorer(engine, self.settings.use_whisper)
        self.job: dict | None = None
        self._job_thread: threading.Thread | None = None
        engine.on_retry_pair = self._retry_pair
        engine.set_lexicon(self.lexicon())
        if not self.store.q("SELECT 1 FROM versions LIMIT 1"):
            self.store.x("INSERT INTO versions VALUES(?,?,?,?,?,?,?,?)",
                         ("v0001", time.time(), engine.ckpt_path or "", None, None, "current",
                          "Starting model", "{}"))
            self.store.put("current", "v0001")
        cur = self.current_version()
        if cur and cur["path"] and engine.ckpt_path and Path(cur["path"]).resolve() != Path(engine.ckpt_path).resolve() \
                and Path(cur["path"]).exists():
            engine.reload(cur["path"])

    # ------------------------------------------------------------ settings
    def update_settings(self, changes: dict) -> LearningSettings:
        d = asdict(self.settings)
        for k, v in changes.items():
            if k not in d:
                raise ValueError(f"Unknown learning setting '{k}'")
            d[k] = type(d[k])(v) if not isinstance(d[k], list) else list(v)
        self.settings = LearningSettings(**d)
        self.scorer.use_whisper = self.settings.use_whisper
        self.store.put("settings", d)
        return self.settings

    # --------------------------------------------------------------- takes
    def log_take(self, result, source: str = "speak", parent: str | None = None) -> str:
        """Save and score a take. Returns its id."""
        tid = uuid.uuid4().hex[:12]
        np.save(self.root / "takes" / f"{tid}.npy", result.mel.numpy().astype(np.float16))
        try:
            voice = self.engine._load_voice(result.style["voice"])
            scores, missed = self.scorer.score(result.mel, result.wav, result.text, voice, result.style)
        except Exception as e:     # scoring must never break speaking
            scores, missed = {"overall": 0.0, "error": str(e)[:200]}, []
        self.store.x("INSERT INTO takes(id,created,text,voice,style,seed,version,secs,scores,quality,source,parent)"
                     " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                     (tid, time.time(), result.text, result.style["voice"], json.dumps(result.style, default=str),
                      result.seed, self.store.get("current"), result.duration, json.dumps(scores),
                      scores.get("overall", 0.0), source, parent))
        self._note_words(result.text, missed)
        self._maybe_auto_learn()
        return tid

    def _note_words(self, text: str, missed: list[str]):
        if self.scorer.asr is None:
            return
        now = time.time()
        miss = set(missed)
        for w in set(words_of(text)):
            self.store.x("INSERT INTO word_issues VALUES(?,?,1,?) ON CONFLICT(word) DO UPDATE SET "
                         "misses=misses+excluded.misses, seen=seen+1, last=excluded.last",
                         (w, 1 if w in miss else 0, now))

    def take(self, tid: str) -> dict | None:
        r = self.store.q("SELECT * FROM takes WHERE id=?", (tid,))
        if not r:
            return None
        t = r[0]
        t["style"] = json.loads(t["style"]); t["scores"] = json.loads(t["scores"])
        return t

    def take_mel(self, tid: str) -> torch.Tensor:
        return torch.from_numpy(np.load(self.root / "takes" / f"{tid}.npy").astype(np.float32))

    def take_audio(self, tid: str) -> np.ndarray:
        t = self.take(tid)
        if t is None:
            raise KeyError(tid)
        with self.lock:
            return self.engine.render(self.take_mel(tid).to(self.engine.device), t["style"])

    def recent_takes(self, limit: int = 50, rated: str | None = None, voice: str | None = None) -> list[dict]:
        where, args = [], []
        if rated == "unrated":
            where.append("rating=0")
        elif rated == "liked":
            where.append("rating>0")
        elif rated == "disliked":
            where.append("rating<0")
        if voice:
            where.append("voice=?"); args.append(voice)
        sql = "SELECT id,created,text,voice,secs,quality,scores,rating,source,version FROM takes"
        if where:
            sql += " WHERE " + " AND ".join(where)
        rows = self.store.q(sql + " ORDER BY created DESC LIMIT ?", (*args, int(limit)))
        for r in rows:
            r["scores"] = json.loads(r["scores"])
        return rows

    # ------------------------------------------------------------ feedback
    def feedback(self, tid: str, rating: int, note: str = "") -> None:
        """rating: +1 good, -1 bad, 0 clear."""
        t = self.take(tid)
        if t is None:
            raise KeyError(f"No take '{tid}'")
        rating = int(np.sign(rating))
        self.store.x("UPDATE takes SET rating=?, note=? WHERE id=?", (rating, note[:500], tid))
        if rating > 0 and t["parent"]:
            p = self.take(t["parent"])
            if p and p["text"] == t["text"]:
                self._add_pref(tid, p["id"], "edit")
        if rating != 0:   # pair with an opposite-rated take of the same line and voice
            other = self.store.q("SELECT id FROM takes WHERE text=? AND voice=? AND rating=? AND id!=? "
                                 "ORDER BY created DESC LIMIT 1", (t["text"], t["voice"], -rating, tid))
            if other:
                w, l = (tid, other[0]["id"]) if rating > 0 else (other[0]["id"], tid)
                self._add_pref(w, l, "rating")
        self._maybe_auto_learn()

    def compare(self, winner: str, loser: str) -> None:
        a, b = self.take(winner), self.take(loser)
        if not a or not b:
            raise KeyError("Unknown take")
        if a["text"] != b["text"]:
            raise ValueError("A/B choices need two takes of the same line.")
        self._add_pref(winner, loser, "ab")
        self._maybe_auto_learn()

    def _add_pref(self, w, l, kind):
        if not self.store.q("SELECT 1 FROM prefs WHERE winner=? AND loser=?", (w, l)):
            self.store.x("INSERT INTO prefs(created,winner,loser,kind) VALUES(?,?,?,?)", (time.time(), w, l, kind))

    def _retry_pair(self, text, voice, style, kept_mel, rejected_mel):
        """Called by the engine when the drift guard replaced a chunk."""
        from .engine import SpeechResult
        ids = []
        for mel in (kept_mel, rejected_mel):
            res = SpeechResult(np.zeros(1, dtype=np.float32), self.engine.sr, mel, text, {**style, "voice": voice}, 0)
            tid = uuid.uuid4().hex[:12]
            np.save(self.root / "takes" / f"{tid}.npy", mel.numpy().astype(np.float16))
            self.store.x("INSERT INTO takes(id,created,text,voice,style,seed,version,secs,scores,quality,source)"
                         " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                         (tid, time.time(), text, voice, json.dumps(res.style, default=str), 0,
                          self.store.get("current"), mel.shape[0] * self.engine.hop / self.engine.sr,
                          "{}", 0.0, "retry"))
            ids.append(tid)
        self._add_pref(ids[0], ids[1], "auto")

    def make_ab_pair(self, text: str, voice: str, style: dict | None = None) -> list[str]:
        """Two takes of the same line with different seeds, for an A/B choice."""
        ids = []
        for _ in range(2):
            with self.lock:
                res = self.engine.speak(text, voice=voice, seed=random.randrange(2 ** 31), use_cache=False,
                                        **(style or {}))
            ids.append(self.log_take(res, source="ab"))
        return ids

    # ------------------------------------------------------------- lexicon
    def lexicon(self) -> dict[str, str]:
        return {r["word"]: r["say_as"] for r in self.store.q("SELECT word, say_as FROM lexicon ORDER BY word")}

    def set_word(self, word: str, say_as: str) -> None:
        word, say_as = word.strip(), say_as.strip()
        if not word or not say_as or len(word) > 64 or len(say_as) > 128:
            raise ValueError("Give the word and how to say it (up to 64 and 128 characters).")
        self.store.x("INSERT INTO lexicon VALUES(?,?,?) ON CONFLICT(word) DO UPDATE SET say_as=excluded.say_as",
                     (word, say_as, time.time()))
        self.engine.set_lexicon(self.lexicon())
        self.store.x("DELETE FROM word_issues WHERE word=?", (word.lower(),))

    def delete_word(self, word: str) -> None:
        self.store.x("DELETE FROM lexicon WHERE word=?", (word,))
        self.engine.set_lexicon(self.lexicon())

    def word_issues(self, limit: int = 30) -> list[dict]:
        return self.store.q("SELECT word, misses, seen, ROUND(1.0*misses/seen, 2) AS miss_rate FROM word_issues "
                            "WHERE misses >= 2 AND 1.0*misses/seen >= 0.4 ORDER BY misses DESC LIMIT ?", (limit,))

    # ------------------------------------------------------------ versions
    def current_version(self) -> dict | None:
        r = self.store.q("SELECT * FROM versions WHERE version=?", (self.store.get("current"),))
        return r[0] if r else None

    def versions(self) -> list[dict]:
        rows = self.store.q("SELECT version,created,parent,quality,status,note FROM versions ORDER BY created DESC")
        cur = self.store.get("current")
        for r in rows:
            r["current"] = r["version"] == cur
        return rows

    def promote(self, version: str) -> None:
        """Make a version current (also used to roll back)."""
        r = self.store.q("SELECT * FROM versions WHERE version=?", (version,))
        if not r:
            raise KeyError(f"No version '{version}'")
        v = r[0]
        if not v["path"] or not Path(v["path"]).exists():
            raise ValueError("That version's model file is missing.")
        with self.lock:
            self.engine.reload(v["path"])
            self._apply_voice_set(json.loads(v["voices"] or "{}"))
        old = self.store.get("current")
        self.store.x("UPDATE versions SET status='kept' WHERE version=? AND status='current'", (old,))
        self.store.x("UPDATE versions SET status='current' WHERE version=?", (version,))
        self.store.put("current", version)

    def rollback(self) -> str:
        cur = self.current_version()
        if not cur or not cur["parent"]:
            raise ValueError("Nothing to roll back to.")
        self.promote(cur["parent"])
        return cur["parent"]

    def _apply_voice_set(self, voices: dict[str, list[float]]) -> None:
        lib = self.engine.voices
        for name, emb in voices.items():
            if name in lib.names():
                v = lib.load(name)
                if v.speaker_emb != emb:
                    v.history = (v.history + [v.speaker_emb])[-10:]
                    v.speaker_emb = emb
                    lib.save(v)

    # -------------------------------------------------------------- status
    def status(self) -> dict:
        q = self.store.q
        last_round = q("SELECT * FROM rounds ORDER BY id DESC LIMIT 1")
        since = last_round[0]["started"] if last_round else 0
        trend = q("SELECT date(created,'unixepoch') AS day, ROUND(AVG(quality),1) AS quality, COUNT(*) AS takes "
                  "FROM takes WHERE source!='retry' AND created > ? GROUP BY day ORDER BY day",
                  (time.time() - 30 * 86400,))
        return {
            "current": self.store.get("current"),
            "takes": q("SELECT COUNT(*) n FROM takes")[0]["n"],
            "rated": q("SELECT COUNT(*) n FROM takes WHERE rating!=0")[0]["n"],
            "liked": q("SELECT COUNT(*) n FROM takes WHERE rating>0")[0]["n"],
            "preferences": q("SELECT COUNT(*) n FROM prefs")[0]["n"],
            "new_feedback": q("SELECT COUNT(*) n FROM prefs WHERE created>?", (since,))[0]["n"]
            + q("SELECT COUNT(*) n FROM takes WHERE rating!=0 AND created>?", (since,))[0]["n"],
            "new_takes": q("SELECT COUNT(*) n FROM takes WHERE created>?", (since,))[0]["n"],
            "avg_quality_7d": q("SELECT ROUND(AVG(quality),1) a FROM takes WHERE source!='retry' AND created>?",
                                (time.time() - 7 * 86400,))[0]["a"],
            "trend": trend,
            "job": self.job,
            "rounds": q("SELECT * FROM rounds ORDER BY id DESC LIMIT 10"),
            "settings": asdict(self.settings),
            "whisper": self.scorer.asr is not None,
        }

    # --------------------------------------------------------- background jobs
    def _start_job(self, kind: str, fn, *args) -> bool:
        if self._job_thread is not None and self._job_thread.is_alive():
            return False
        self.job = {"kind": kind, "progress": 0.0, "message": "Starting…", "started": time.time()}

        def run():
            try:
                fn(*args)
            except Exception as e:   # surfaced in status, never crashes the server
                self.job = {**(self.job or {}), "message": f"Failed: {e}", "failed": True}
                if kind == "refine":
                    self.store.x("UPDATE rounds SET status='failed', finished=?, message=? WHERE id="
                                 "(SELECT MAX(id) FROM rounds)", (time.time(), str(e)[:500]))
            finally:
                if self.job and not self.job.get("failed"):
                    self.job = {**self.job, "progress": 1.0, "done": True}
        self._job_thread = threading.Thread(target=run, daemon=True)
        self._job_thread.start()
        return True

    def _maybe_auto_learn(self):
        s = self.settings
        if not s.auto_learn or (self._job_thread is not None and self._job_thread.is_alive()):
            return
        last = self.store.q("SELECT started FROM rounds ORDER BY id DESC LIMIT 1")
        if last and time.time() - last[0]["started"] < s.min_hours_between * 3600:
            return
        st = self.status()
        if st["new_feedback"] >= s.every_n_feedback or st["new_takes"] >= s.every_n_takes:
            self.refine(reason="auto")

    def refine(self, reason: str = "manual", wait: bool = False) -> bool:
        ok = self._start_job("refine", self._run_round, reason)
        if ok and wait:
            self._job_thread.join()
        return ok

    def wait(self):
        if self._job_thread is not None:
            self._job_thread.join()

    # --------------------------------------------------------------- a round
    def _progress(self, p, msg):
        self.job = {**(self.job or {}), "progress": round(float(p), 3), "message": msg}

    def _run_round(self, reason: str):
        s = self.settings
        e = self.engine
        rid = self.store.x("INSERT INTO rounds(started,status,reason) VALUES(?,?,?)", (time.time(), "running", reason))
        cur = self.current_version()
        dev = e.device

        sft = self.store.q("SELECT * FROM takes WHERE source NOT IN ('retry') AND rating>=0 AND "
                           "(rating>0 OR quality>=?) ORDER BY rating DESC, created DESC LIMIT 2000", (s.min_quality,))
        prefs = self.store.q("SELECT * FROM prefs ORDER BY created DESC LIMIT 2000")
        replay = self._replay_dataset()
        n_rep = len(replay) if replay else 0
        self.store.x("UPDATE rounds SET n_takes=?, n_prefs=?, n_replay=? WHERE id=?", (len(sft), len(prefs), n_rep, rid))
        if len(sft) + len(prefs) < s.min_examples:
            msg = f"Skipped: needs {s.min_examples} good takes or preferences, has {len(sft) + len(prefs)}."
            self.store.x("UPDATE rounds SET status='skipped', finished=?, message=? WHERE id=?", (time.time(), msg, rid))
            self._progress(1.0, msg)
            return

        self._progress(0.02, "Preparing training material")
        with self.lock:
            policy = copy.deepcopy(e.model).to(dev).train()
            ref = copy.deepcopy(e.model).to(dev).eval().requires_grad_(False)
        examples = [ex for ex in (self._example(t) for t in sft) if ex is not None]
        pairs = []
        for p in prefs:
            w, l = self._example_id(p["winner"]), self._example_id(p["loser"])
            if w is not None and l is not None:
                pairs.append((w, l))
        params = list(policy.dit.parameters()) + list(policy.style.parameters()) + list(policy.duration.parameters())
        opt = torch.optim.AdamW(params, lr=s.lr, weight_decay=0.0)
        rep_iter = iter(replay) if replay else None
        for step in range(1, s.steps + 1):
            loss = torch.zeros((), device=dev)
            if examples:
                ex = random.choice(examples)
                st = policy.style(ex["emb"][None], ex["emo"][None], ex["pros"][None])
                fm = policy.dit.flow_matching_loss(ex["mel"][None], ex["len"], ex["tok_frames"][None], st,
                                                   torch.zeros(1, dtype=torch.bool, device=dev),
                                                   torch.rand(1, device=dev) < 0.3)
                dur = policy.duration.loss(ex["tok"][None], ex["tok_len"], st, ex["len"])
                loss = loss + s.w_sft * (fm + 0.1 * dur)
            if rep_iter is not None:
                try:
                    batch = next(rep_iter)
                except StopIteration:
                    rep_iter = iter(replay); batch = next(rep_iter)
                loss = loss + self._replay_loss(policy, batch)
            if pairs:
                w, l = random.choice(pairs)
                loss = loss + s.w_dpo * self._dpo_loss(policy, ref, w, l, s.beta)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(params, 1.0)
            opt.step()
            if step % 10 == 0 or step == s.steps:
                self._progress(0.05 + 0.6 * step / s.steps, f"Refining: step {step} of {s.steps}")
        policy.eval()

        voice_set = self._refined_voices(policy) if s.refine_voices else {}
        self._progress(0.7, "Testing the current model")
        before = cur["quality"] if cur and cur["quality"] is not None else self._benchmark(None, {})
        if cur and cur["quality"] is None:
            self.store.x("UPDATE versions SET quality=? WHERE version=?", (before, cur["version"]))
        self._progress(0.85, "Testing the refined model")
        after = self._benchmark(policy, voice_set)

        n = len(self.store.q("SELECT version FROM versions")) + 1
        ver = f"v{n:04d}"
        vdir = self.root / "models" / ver
        vdir.mkdir(parents=True, exist_ok=True)
        policy.save(vdir / "vox.pt", {k: v for k, v in getattr(e.model, "extras", {}).items() if k != "train_state"})
        full_voices = {name: e.voices.load(name).speaker_emb for name in e.voices.names()}
        full_voices.update(voice_set)
        promoted = after >= before + s.min_gain
        self.store.x("INSERT INTO versions VALUES(?,?,?,?,?,?,?,?)",
                     (ver, time.time(), str(vdir / "vox.pt"), cur["version"] if cur else None, after,
                      "candidate", f"Round {rid} ({reason})", json.dumps(full_voices)))
        if cur and not json.loads(cur["voices"] or "{}"):   # remember the starting voices for rollback
            self.store.x("UPDATE versions SET voices=? WHERE version=?",
                         (json.dumps({name: e.voices.load(name).speaker_emb for name in e.voices.names()}), cur["version"]))
        if promoted:
            self.promote(ver)
            used = ",".join("?" * len(sft))
            if sft:
                self.store.x(f"UPDATE takes SET used_in=? WHERE id IN ({used})", (ver, *[t["id"] for t in sft]))
            self.store.x("UPDATE prefs SET used_in=? WHERE used_in IS NULL", (ver,))
            msg = f"Promoted {ver}: benchmark {before:.1f} → {after:.1f}."
        else:
            self.store.x("UPDATE versions SET status='rejected' WHERE version=?", (ver,))
            msg = f"Kept {cur['version'] if cur else 'current'}: {ver} scored {after:.1f}, needed {before + s.min_gain:.1f}."
        self.store.x("UPDATE rounds SET status='done', finished=?, version=?, before=?, after=?, promoted=?, message=? "
                     "WHERE id=?", (time.time(), ver, before, after, int(promoted), msg, rid))
        self._prune_takes()
        self._progress(1.0, msg)

    # ---------------------------------------------------------- round helpers
    def _example_id(self, tid):
        t = self.take(tid)
        return self._example(t) if t else None

    def _example(self, t: dict) -> dict | None:
        e = self.engine
        try:
            style = t["style"] if isinstance(t["style"], dict) else json.loads(t["style"])
            voice = e._load_voice(t["voice"])
            mel = self.take_mel(t["id"]).to(e.device)
        except (KeyError, FileNotFoundError, ValueError):
            return None
        toks = e.tokens_for(t["text"], style)
        if not toks or mel.shape[0] < len(toks) or mel.shape[0] > 3000:
            return None
        emo, pros = e._resolve_style(voice, style)
        dev = e.device
        tok = torch.tensor(toks, device=dev)
        tok_frames = torch.full((mel.shape[0],), PAD, dtype=torch.long, device=dev)
        tok_frames[: len(toks)] = tok
        return {"mel": mel, "len": torch.tensor([mel.shape[0]], device=dev), "tok": tok,
                "tok_len": torch.tensor([len(toks)], device=dev), "tok_frames": tok_frames,
                "emb": voice.emb_tensor(dev), "emo": emo.to(dev),
                "pros": torch.tensor(pros, dtype=torch.float32, device=dev), "voice": t["voice"]}

    @staticmethod
    def _flow_err(model, ex, t, x0):
        x1 = norm_mel(ex["mel"])[None]
        x_t = (1 - t) * x0 + t * x1
        st = model.style(ex["emb"][None], ex["emo"][None], ex["pros"][None])
        v = model.dit(x_t, torch.zeros_like(x1), ex["tok_frames"][None], t.view(1), st)
        return ((v - (x1 - x0)) ** 2).mean()

    def _dpo_loss(self, policy, ref, w, l, beta):
        """Diffusion-DPO (Wallace et al. 2023) for flow matching: lower error on
        the winner and higher on the loser, measured against the frozen reference."""
        t = torch.sigmoid(torch.randn(1, device=w["mel"].device))
        x0w, x0l = torch.randn_like(w["mel"])[None], torch.randn_like(l["mel"])[None]
        ew, el = self._flow_err(policy, w, t, x0w), self._flow_err(policy, l, t, x0l)
        with torch.no_grad():
            rw, rl = self._flow_err(ref, w, t, x0w), self._flow_err(ref, l, t, x0l)
        diff = (ew - rw) - (el - rl)
        return -F.logsigmoid(-beta * diff)

    def _replay_dataset(self):
        paths = [p for p in self.settings.replay_manifests if Path(p).exists()]
        if not paths:
            return None
        from torch.utils.data import DataLoader
        from .train import ClipDataset, FrameBatchSampler, collate
        ds = ClipDataset(paths, self.engine.cfg)
        if len(ds) == 0:
            return None
        return DataLoader(ds, batch_sampler=FrameBatchSampler(ds, min(self.engine.cfg.train.batch_frames, 6000)),
                          collate_fn=collate)

    def _replay_loss(self, policy, batch):
        dev = self.engine.device
        b = {k: v.to(dev) for k, v in batch.items()}
        B = b["mel"].shape[0]
        with torch.no_grad():
            emb = policy.speaker(b["ref"], b["ref_mask"])
        emo_w = torch.zeros(B, len(EMOTIONS), device=dev)
        known = b["emotion"] >= 0
        emo_w[known] = F.one_hot(b["emotion"][known], len(EMOTIONS)).float()
        st = policy.style(emb, emo_w, b["prosody"])
        return policy.dit.flow_matching_loss(b["mel"], b["lens"], b["tok_frames"], st,
                                             torch.zeros(B, dtype=torch.bool, device=dev),
                                             torch.rand(B, device=dev) < 0.3)

    @torch.no_grad()
    def _refined_voices(self, policy) -> dict[str, list[float]]:
        s = self.settings
        out = {}
        for r in self.store.q("SELECT voice, COUNT(*) n FROM takes WHERE rating>0 GROUP BY voice HAVING n>=?",
                              (s.voice_min_likes,)):
            name = r["voice"]
            if name not in self.engine.voices.names():
                continue
            v = self.engine.voices.load(name)
            if v.origin == "cloned":     # a cloned voice must stay the consenting person's voice
                continue
            liked = self.store.q("SELECT id FROM takes WHERE voice=? AND rating>0 ORDER BY created DESC LIMIT 20", (name,))
            embs = [policy.speaker(self.take_mel(t["id"]).to(self.engine.device).T[None])[0] for t in liked]
            target = F.normalize(torch.stack(embs).mean(0), dim=-1)
            new = F.normalize((1 - s.voice_step) * v.emb_tensor(self.engine.device) + s.voice_step * target, dim=-1)
            out[name] = new.cpu().tolist()
        return out

    def _benchmark_voices(self) -> list[str]:
        rows = self.store.q("SELECT voice, COUNT(*) n FROM takes GROUP BY voice ORDER BY n DESC LIMIT ?",
                            (self.settings.benchmark_voices,))
        names = [r["voice"] for r in rows if r["voice"] in self.engine.voices.names()]
        return names or ["narrator"]

    @torch.no_grad()
    def _benchmark(self, model, voice_set: dict) -> float:
        """Average quality on fixed lines and seeds. model=None uses the current one."""
        e = self.engine
        scores = []
        with self.lock:
            saved_model, saved_over, saved_hook = e.model, dict(e.voice_overrides), e.on_retry_pair
            e.on_retry_pair = None        # benchmark takes are not training material
            try:
                if model is not None:
                    e.model = model
                e.voice_overrides.update(voice_set)
                for vname in self._benchmark_voices():
                    voice = e._load_voice(vname)
                    for i, line in enumerate(BENCHMARK_LINES):
                        res = e.speak(line, voice=vname, seed=1000 + i, use_cache=False)
                        sc, _ = self.scorer.score(res.mel, res.wav, line, voice, res.style)
                        scores.append(sc["overall"])
            finally:
                e.model, e.voice_overrides, e.on_retry_pair = saved_model, saved_over, saved_hook
        return round(float(np.mean(scores)), 2) if scores else 0.0

    def _prune_takes(self):
        cutoff = time.time() - self.settings.keep_takes_days * 86400
        old = self.store.q("SELECT id FROM takes WHERE created<? AND rating=0 AND id NOT IN "
                           "(SELECT winner FROM prefs UNION SELECT loser FROM prefs)", (cutoff,))
        for r in old:
            (self.root / "takes" / f"{r['id']}.npy").unlink(missing_ok=True)
        if old:
            self.store.x(f"DELETE FROM takes WHERE id IN ({','.join('?' * len(old))})", tuple(r["id"] for r in old))

    # --------------------------------------------------------- auto-optimize
    OPT_GRID = [(1.5, 1.0), (2.0, 1.5), (2.5, 1.5), (3.0, 2.0), (2.0, 2.5), (1.0, 1.0)]

    def optimize_voice(self, name: str, wait: bool = False) -> bool:
        """Search generation settings for one voice and keep the best."""
        if name not in self.engine.voices.names():
            raise KeyError(f"No voice named '{name}'")
        ok = self._start_job("optimize", self._run_optimize, name)
        if ok and wait:
            self._job_thread.join()
        return ok

    def _run_optimize(self, name: str):
        e = self.engine
        lines = BENCHMARK_LINES[:3]
        results = []
        voice = e.voices.load(name)
        original = voice.infer
        try:
            for i, (ct, cs) in enumerate(self.OPT_GRID):
                self._progress(i / len(self.OPT_GRID), f"Trying setting {i + 1} of {len(self.OPT_GRID)}")
                trial = {"cfg_text": ct, "cfg_style": cs}
                ids, total = [], 0.0
                for j, line in enumerate(lines):
                    with self.lock:
                        v = e.voices.load(name); v.infer = trial; e.voices.save(v)
                        res = e.speak(line, voice=name, seed=500 + j, use_cache=False)
                    tid = self.log_take(res, source="optimize")
                    total += self.take(tid)["quality"]
                    ids.append(tid)
                results.append((total / len(lines), trial, ids))
        finally:
            with self.lock:
                v = e.voices.load(name); v.infer = original; e.voices.save(v)
        results.sort(key=lambda r: r[0], reverse=True)
        best, worst = results[0], results[-1]
        if best[0] - worst[0] >= 10:      # clear differences become free preference pairs
            for wid, lid in zip(best[2], worst[2]):
                self._add_pref(wid, lid, "auto")
        with self.lock:
            v = e.voices.load(name)
            v.infer = best[1]
            e.voices.save(v)
        self.job = {**(self.job or {}), "result": [{"score": round(r[0], 1), **r[1]} for r in results]}
        self._progress(1.0, f"Best for {name}: guidance {best[1]['cfg_text']}/{best[1]['cfg_style']} "
                            f"(score {best[0]:.1f})")
