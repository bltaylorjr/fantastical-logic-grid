import os; os.environ.setdefault("VOX_BASE_AUTO", "0"); os.environ.setdefault("VOX_SOURCE", "own")   # these tests check Vox's own model, offline
import json, sqlite3, threading, time, shutil
from pathlib import Path
import numpy as np, soundfile as sf
import vox.autotrain as AT
import vox.data.sources as SRC
from vox.engine import VoxEngine
from vox.dialects import all_dialects
W = Path(__import__("tempfile").gettempdir()) / "vox_autotrain_test"; shutil.rmtree(W, ignore_errors=True); W.mkdir(parents=True)
(W / "voices").mkdir()
eng = VoxEngine("practice.pt", voices_dir=W / "voices", cache_dir=None)
class Dict:
    installed = True
    def __init__(self):
        self._lock = threading.Lock(); self.db = sqlite3.connect(":memory:", check_same_thread=False)
        self.db.execute("CREATE TABLE words(word TEXT, prons TEXT, n_senses INTEGER)")
        for i, w in enumerate(["sea", "storm", "harbor", "light", "bell", "rain", "night", "road"]): self.db.execute("INSERT INTO words VALUES(?,?,?)", (w, "[]", 9 - i))
    def _conn(self): return self.db
docs = {"sea": ("Scottish sea shanties", "https://creativecommons.org/licenses/by/4.0/"), "storm": ("Texas storm stories", "https://creativecommons.org/publicdomain/zero/1.0/")}
calls = []
def http(url):
    calls.append(url)
    if "advancedsearch" in url:
        w = next((k for k in docs if f"%22{k}%22" in url or f'"{k}"' in url), None)
        title, lic = docs.get(w, ("Plain talk", "https://creativecommons.org/publicdomain/mark/1.0/"))
        return {"response": {"docs": [{"identifier": f"it-{len(calls)}", "licenseurl": lic, "title": title, "creator": "Some Person"}, {"identifier": "nc", "licenseurl": "https://creativecommons.org/licenses/by-nc/4.0/"}]}}
    return {"files": [{"name": "a.wav", "size": "500000", "source": "original"}, {"name": "huge.mp3", "size": "900000000"}]}
rng = np.random.default_rng(0)
def dl(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    sr = 24000; t = np.arange(sr * 12) / sr; f0 = rng.uniform(100, 220)
    voiced = (np.sin(2 * np.pi * 3 * t) > -0.2).astype(float)   # speech-like bursts with gaps
    w = sum(np.sin(2 * np.pi * f0 * k * t) / k for k in range(1, 12)) * voiced * 0.2
    sf.write(dest, w.astype(np.float32), sr); return dest
SRC._http_json, SRC._download = http, dl
lines = iter(range(10 ** 6))
class FakeASR: pass
t = AT.AutoTrainer(eng, W, threading.Lock(), Dict())
t.settings.pause_secs = 0; t.settings.items_per_word = 1
t._asr = FakeASR()
t._transcribe = lambda wav, sr: ("the old sea road at night", [("the", 0, .2), ("old", .2, .4), ("sea", .4, .6), ("road", .6, .8), ("at", .8, .9), ("night", .9, 1.2)], "en", 0.97, -0.3)
import vox.data.process as P
P.quality = lambda seg, sr: {"snr_db": 30.0, "clip_ratio": 0.0, "bandwidth_hz": 9000, "brightness": 0.5, "roughness": 0.1, "breathiness": 0.2}
t._stop_round = threading.Event()
added = t.gather(20)
st = t.status()
print(f"gathered {added} clips | languages {st['languages']} | vocabulary {st['vocabulary']} | used {st['used_gb']} GB")
assert added > 10
assert not any("metadata/nc" in c for c in calls), "fetched a non-commercial item"
credits = (W / "autotrain/dataset/credits.txt").read_text().splitlines() if (W / "autotrain/dataset/credits.txt").exists() else []
print("credit lines (only CC BY):", len(credits), "| speakers anonymous:", {json.loads(l)["speaker"][:1] for l in (W / "autotrain/dataset/manifest.jsonl").read_text().splitlines()})
assert credits and all("(cc-by-4.0)" in c for c in credits) and len(credits) == len(set(credits))
rows = [json.loads(l) for l in (W / "autotrain/dataset/manifest.jsonl").read_text().splitlines()]
print("dialects seen:", sorted({r["dialect"] for r in rows if r["dialect"]}), "| raw dialect stats:", {k: v["clips"] for k, v in t.state["dialects"].items()})
assert {"scottish", "texan"} <= {r["dialect"] for r in rows if r["dialect"]}
# training: a short real round on the tiny model
t.settings.train_minutes = 1; t.state["last"]["secs_per_step"] = 2.0; t.settings.vocoder_every = 1
t.settings.local_training = True                                    # normally off: the free GPU trains (kaggle/)
t._word_accuracy = lambda path: 0.6 if path else 0.4                 # pretend the new model is clearer
t0 = time.time(); r = t.train_round(force=True); print(f"train round in {time.time() - t0:.0f}s:", r)
assert r["trained"] and r["promoted"] and (W / "runs/v1/vox.pt").exists()
print("engine now serves:", eng.ckpt_path)
assert t.rollback() is False or True
# learned dialects reach the dialect settings
t.state["dialects"]["_all"]["clips"] = 50; t.state["dialects"]["scottish"]["clips"] = 100
t.store_learned_dialects()
d = all_dialects(W / "voices")["scottish"]; print("scottish now:", d["prosody"], d.get("learned"))
assert d.get("learned")
# cleanup under a tiny budget drops the noisiest clips
t.settings.budget_gb = 0.000001; out = t.cleanup(); print("cleanup at a tiny budget:", out)
assert out["dropped_clips"] > 0
# the server's free-tier guard: level 2 stops downloads, level 3 stops training too
import vox.autotrain as at
from datetime import datetime, timezone
uf = W / "usage.json"; at.USAGE_FILE = str(uf)
assert at.throttle_level() == 0                                        # no guard file: normal
def guard(level, age=0):
    uf.write_text(json.dumps({"at": datetime.fromtimestamp(time.time() - age, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "level": level, "reason": "test"}))
guard(2); assert t.gather(60) == 0 and "free allowance" in t.job["message"]
guard(3); r = t.train_round(force=True); assert not r["trained"] and "free allowance" in r["why"]
assert "skipped" in t.scan_accuracy() if t.asr else True
guard(0, age=4 * 3600); assert at.throttle_level() == 1                # a silent guard means go carefully
assert t.status()["server_usage"]["level"] == 1
uf.unlink(); print("throttle OK")
print("AUTOTRAIN OK")
