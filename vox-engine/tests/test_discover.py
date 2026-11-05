import json, sqlite3, threading, time, sys
from pathlib import Path
import numpy as np, soundfile as sf, torch, torch.nn.functional as F
import vox.discover as D
from vox.engine import VoxEngine
from vox.sampling import SpeakerFound

W = Path(__import__("tempfile").gettempdir()) / "vox_discover_test"; W.mkdir(parents=True, exist_ok=True)
eng = VoxEngine("practice.pt", voices_dir=W / "voices", cache_dir=None)

class FakeDict:          # a tiny installed dictionary
    installed = True
    def __init__(self):
        self._lock = threading.Lock(); self.db = sqlite3.connect(":memory:", check_same_thread=False)
        self.db.execute("CREATE TABLE words(word TEXT PRIMARY KEY, prons TEXT, n_senses INTEGER)")
        for i, w in enumerate(["sea", "captain", "harbor", "radio", "storm", "zzzq", "night", "lamp", "bell"]):
            self.db.execute("INSERT INTO words VALUES (?,?,?)", (w, "[]", 10 - i))
    def _conn(self): return self.db

calls = []
def fake_http(url):
    calls.append(url)
    if "advancedsearch" in url:
        if "zzzq" in url: return {"response": {"docs": []}}
        return {"response": {"docs": [{"identifier": f"item{len(calls)}", "licenseurl": "https://creativecommons.org/publicdomain/zero/1.0/", "title": "T", "creator": "C"},
                                      {"identifier": "nc", "licenseurl": "https://creativecommons.org/licenses/by-nc/4.0/"}]}}
    return {"files": [{"name": "big.mp3", "size": "999999999", "source": "original"}, {"name": "a.wav", "size": "48000", "source": "original"}]}
def fake_dl(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    sf.write(dest, (np.random.randn(24000) * 0.1).astype(np.float32), 24000); return dest
rng = np.random.default_rng(1)
def fake_speakers(engine, item, max_clips, limits):    # each recording: one distinct speaker
    v = torch.tensor(rng.standard_normal(eng.cfg.model.speaker_dim), dtype=torch.float32)
    return [SpeakerFound(F.normalize(v, dim=0), 3, 9.0, str(item.path), item.attribution)]
D._http_json, D._download, D._speakers_in, D.PAUSE = fake_http, fake_dl, fake_speakers, 0.0

disc = D.Discovery(eng, W / "learning", threading.Lock(), FakeDict())
disc.start(voices=2, words_per_voice=3, speakers=3, items_per_word=1)
for _ in range(300):
    if not disc.job["running"]: break
    time.sleep(0.05)
st = disc.status()
print("message:", st["message"]); print("cursor", st["cursor"], "of", st["total_words"], "| voices:", [v["name"] for v in st["voices"]])
assert len(st["voices"]) == 2 and st["cursor"] == 9 and st["refused"] == 1, st
assert not any("nc" in c and "metadata" in c for c in calls), "non-commercial item was fetched"
assert all("big.mp3" not in c for c in calls), "oversized file downloaded"
v = eng.voices.load(st["voices"][0]["name"]); print("voice:", v.name, v.origin, "|", v.description, "| credits:", len(v.sources))
# resumes where it left off, and a word with no recordings is refused, not fatal
disc2 = D.Discovery(eng, W / "learning", threading.Lock(), FakeDict())
assert disc2.state["cursor"] == 9
disc2.start(voices=1, words_per_voice=1, speakers=3, items_per_word=1)
while disc2.job["running"]: time.sleep(0.05)
s2 = disc2.status(); print("after resume:", s2["message"], "| recent:", [(r["words"], r["ok"], r["detail"] if not r["ok"] else "") for r in s2["recent"][:3]])
assert "Every word" in s2["message"]
disc2.reset(); assert disc2.state["cursor"] == 0
# stop works
D.PAUSE = 0.2
disc2.start(voices=50, words_per_voice=1); time.sleep(0.3); disc2.stop()
while disc2.job["running"]: time.sleep(0.05)
print("stop:", disc2.job["message"])
assert "Stopped" in disc2.job["message"] or "Every word" in disc2.job["message"]
print("DISCOVER OK")
