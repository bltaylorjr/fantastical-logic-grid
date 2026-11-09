import os; os.environ.setdefault("VOX_BASE_AUTO", "0"); os.environ.setdefault("VOX_SOURCE", "own")   # these tests check Vox's own model, offline
import io, time, numpy as np, soundfile as sf
from pathlib import Path
from fastapi.testclient import TestClient
from vox.engine import VoxEngine
from vox.learning import LearningSystem
from vox.server import create_app
W = Path(__import__("tempfile").gettempdir()) / "vox_voices_test"; W.mkdir(parents=True, exist_ok=True)
eng = VoxEngine("practice.pt", voices_dir=W / "voices", cache_dir=None)
L = LearningSystem(eng, W / "learning")
c = TestClient(create_app(eng, L, "tok-123456789012345"), base_url="http://127.0.0.1:5150", client=("127.0.0.1", 50000))
A = {"X-Vox-Admin-Token": "tok-123456789012345"}
o = c.get("/v1/voices/options").json()
print("options:", len(o["groups"]), "groups,", len(o["stages"]), "stages,", len(o["processes"]), "sound patterns,", len(o["registers"]), "styles,", len(o["dialects"]), "dialects,", len(o["deliveries"]), "deliveries")
assert c.post("/v1/admin/voices/starters", json={}).status_code == 401
r = c.post("/v1/admin/voices/starters", json={}, headers=A).json(); print("starters:", r["made"])
assert len(r["made"]) == 6
assert c.post("/v1/admin/voices/starters", json={}, headers=A).json()["made"] == []      # no duplicates
r = c.post("/v1/admin/voices/starters", json={"dialect": "southern_us"}, headers=A).json(); print("southern set:", r["made"][:2], "...")
vs = {v["name"]: v for v in c.get("/v1/voices").json()}
print("adolescent_female profile:", vs["adolescent_female"]["profile"], "|", vs["adolescent_female"]["description"])
def dur(resp):
    assert resp.status_code == 200, resp.text[:300]
    w, sr = sf.read(io.BytesIO(resp.content)); assert np.isfinite(w).all() and len(w) > 0; return len(w) / sr
t0 = time.time()
line = "The quick brown fox jumps over the lazy dog. Can we go now?"
print("toddler (age 2):", f"{dur(c.post('/v1/speak', json={'text': line, 'voice': 'adolescent_male', 'age': 2, 'seed': 1})):.2f}s")
print("first words, simplified:", f"{dur(c.post('/v1/speak', json={'text': line, 'voice': 'adolescent_female', 'age': 1, 'simplify': True, 'seed': 1})):.2f}s")
print("teen boy, playful:", f"{dur(c.post('/v1/speak', json={'text': line, 'voice': 'teen_male', 'speaking_style': 'playful', 'seed': 1})):.2f}s")
for d in ("british_rp", "indian", "jamaican", "appalachian"):
    dur(c.post('/v1/speak', json={'text': line, 'voice': 'adult_female', 'dialect': d, 'seed': 2}))
print("dialects spoke OK")
for dv in [x["id"] for x in o["deliveries"]]:
    dur(c.post('/v1/speak', json={'text': "Hello there, how are you today?", 'voice': 'adult_male', 'delivery': dv, 'seed': 3}))
print("every delivery spoke OK (whisper .. scream, singing)")
print("sung on notes:", f"{dur(c.post('/v1/speak', json={'text': 'Twinkle twinkle little star', 'voice': 'teen_female', 'delivery': 'singing', 'sing': {'notes': 'C4 C4 G4 G4 A4 A4 G4'}, 'seed': 4})):.2f}s")
assert c.post('/v1/speak', json={'text': 'x', 'voice': 'adult_male', 'age': 200}).status_code == 422
# profile edits and validation
assert c.put("/v1/admin/voices/teen_male/profile", json={"dialect": "nope"}, headers=A).status_code == 400
r = c.put("/v1/admin/voices/teen_male/profile", json={"dialect": "irish", "accent": 0.6, "processes": {"gliding": 1}}, headers=A).json(); print("teen_male now:", r["profile"])
dur(c.post('/v1/speak', json={'text': "Run, rabbit, run!", 'voice': 'teen_male', 'seed': 5}))
r = c.post("/v1/admin/voices/character", json={"group": "adolescent_male", "name": "kid3", "age": 3, "dialect": "scottish", "delivery": "excited" if False else "calling"}, headers=A).json(); print("custom kid:", r)
# your own dialect
assert c.put("/v1/admin/dialects/asheville_local", json={"label": "Asheville local", "region": "Western NC", "rules": ["bogus"]}, headers=A).status_code == 400
assert c.put("/v1/admin/dialects/asheville_local", json={"label": "Asheville local", "region": "Western NC", "rules": ["ay_monophthong_all", "ing_to_in"], "prosody": {"rate": -0.2}}, headers=A).status_code == 200
assert any(d["id"] == "asheville_local" and d["custom"] for d in c.get("/v1/voices/options").json()["dialects"])
dur(c.post('/v1/speak', json={'text': "I'm fixing to go fishing tonight.", 'voice': 'adult_male', 'dialect': 'asheville_local', 'seed': 6}))
assert c.delete("/v1/admin/dialects/asheville_local", headers=A).status_code == 200
# discovery endpoints and pairing
r = c.post("/v1/admin/discover/start", json={"voices": 2}, headers=A); print("discover start without a dictionary:", r.status_code, r.json()["detail"])
assert r.status_code == 400
d = c.get("/v1/admin/discover", headers=A).json(); print("discover status:", {k: d[k] for k in ("running", "cursor", "total_words")})
assert c.get("/v1/pair", headers={"Origin": "https://flg-api.btay74.workers.dev"}).json()["token"] == "tok-123456789012345"
assert c.get("/v1/pair", headers={"Origin": "https://evil.example"}).status_code == 403
# the old way still works: a plain line with no profile
dur(c.post('/v1/speak', json={'text': "Plain line.", 'voice': 'narrator' if 'narrator' in vs else 'adult_male', 'seed': 7}))
print(f"SERVER OK in {time.time() - t0:.0f}s")
