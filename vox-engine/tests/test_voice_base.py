"""Base voices, promotion over them, the open-data preparation and the Kaggle
training loop. Offline: the corpora are small stand-ins served from files, and
Kaggle is a stand-in command line. The base-voice speech check runs when the
base voices are installed and downloaded (VOX_BASE_DIR points at their folder)."""
import os; os.environ.setdefault("VOX_BASE_AUTO", "0")
import io, json, shutil, subprocess, sys, tarfile, tempfile, threading, time, zipfile
from pathlib import Path
import numpy as np, soundfile as sf

HERE = Path(__file__).resolve().parents[1]
W = Path(tempfile.gettempdir()) / "vox_base_test"; shutil.rmtree(W, ignore_errors=True); W.mkdir(parents=True)
sys.path.insert(0, str(HERE))
import vox.base as B
import vox.autotrain as AT
from vox.engine import VoxEngine

# ---------------------------------------------------------------- choosing voices
blend, code, base_sex = B.BaseVoices.choose("innkeeper", {"age": 45, "sex": "male", "dialect": "scottish"})
assert code == "en-gb-scotland" and base_sex == "male" and all(n.startswith("bm_") for n in blend), blend
assert abs(sum(blend.values()) - 1) < 1e-6 and len(blend) == 2
assert B.BaseVoices.choose("innkeeper", {"age": 45, "sex": "male", "dialect": "scottish"})[0] == blend      # stable per voice
assert B.BaseVoices.choose("baker", {"age": 45, "sex": "male", "dialect": "scottish"})[0] != blend          # another character, another timbre
b2, c2, s2 = B.BaseVoices.choose("kid", {"age": 6, "sex": "male"})
assert s2 == "female" and c2 == "en-us" and all(n.startswith("af_") for n in b2)                           # children start from a woman's voice
assert B.BaseVoices.choose("x", {"dialect": "jamaican"})[1] == "en-029"
assert B.BaseVoices.choose("x", {"dialect": "indian", "sex": "female"})[0].keys() <= {"hf_alpha", "hf_beta"}
assert B.BaseVoices.choose("x", {"dialect": "scottish", "accent": 0.2})[1] == "en-us"                        # a light accent
assert B.BaseVoices.choose("x", {}, "es")[1] == "es"
assert B.BaseVoices.choose("x", {"base_voice": "bf_emma"})[0] == {"bf_emma": 1.0}
print("choosing voices OK")

# ------------------------------------------------- which model speaks
assert B.voice_source(W)["source"] == "base"
B.set_voice_source(W, "own", own_accuracy=0.93, base_accuracy=0.9)
assert B.voice_source(W) == {"source": "own", "own_accuracy": 0.93, "base_accuracy": 0.9}
os.environ["VOX_SOURCE"] = "base"; assert B.voice_source(W)["source"] == "base"; del os.environ["VOX_SOURCE"]
B.source_file(W).unlink()

# the engine speaks with its own model until the base voices are downloaded
(W / "voices").mkdir()
practice = W / "practice.pt"
subprocess.run([sys.executable, "-m", "vox.cli", "init", "--preset", "tiny", "--out", str(practice)], cwd=HERE, check=True, capture_output=True)
eng = VoxEngine(str(practice), voices_dir=W / "voices", cache_dir=None)
assert eng.source == "own"
bdir = os.environ.get("VOX_BASE_DIR")
if bdir and B.available():
    shutil.copytree(bdir, W / "base")
    assert eng.refresh_source() == "base"
    from vox.delivery import _f0
    from vox.development import voice_targets
    for age, sex, extra in ((5, "male", {}), (45, "male", {"dialect": "scottish"}), (15, "female", {"dialect": "british_rp"}), (30, "male", {"delivery": "whisper"})):
        r = eng.speak("The lantern was in the blue house.", age=age, sex=sex, use_cache=False, seed=1, **extra)
        f0, v = _f0(r.wav, r.sample_rate, 120)
        assert r.duration > 1 and r.mel.shape[1] == 100
        if extra.get("delivery") != "whisper":
            med = float(np.median(f0[v])); want = voice_targets(age, sex)["f0"]
            assert abs(np.log2(med / want)) < 0.15, (age, sex, med, want)                                  # within ~2 semitones
    chunks = list(eng.speak_stream("First line. Second line!", voice="narrator"))
    assert len(chunks) == 2
    print("base voices speak at the right pitch for each age OK")
else:
    print("(base voices not downloaded here: skipped the speech check)")

# ------------------------------------------------- promotion over the base voices
class FakeASR: pass
eng.source = "base"
eng.refresh_source = lambda: eng.source                       # keep the stand-in on "base" without the files
t = AT.AutoTrainer(eng, W, threading.Lock(), None)
t._asr = FakeASR()
import torch
cand = W / "cand.pt"; shutil.copy2(eng.ckpt_path, cand)
t._word_accuracy = lambda path: 0.5 if path else 0.9          # the new model is worse than the base voices
r = t.evaluate_and_promote(cand)
assert not r["promoted"] and r["against"] == "base" and B.voice_source(W)["source"] == "base"
reloaded = []
eng.reload = lambda p: (reloaded.append(str(p)), setattr(eng, "source", B.voice_source(W)["source"]))
t._word_accuracy = lambda path: 0.95 if path else 0.9         # clearer than the base voices by more than min_gain
r = t.evaluate_and_promote(cand)
assert r["promoted"] and B.voice_source(W)["source"] == "own" and B.voice_source(W)["base_accuracy"] == 0.9
assert reloaded and eng.source == "own"
eng.refresh_source = lambda: setattr(eng, "source", B.voice_source(W)["source"]) or eng.source
assert t.rollback() and B.voice_source(W)["source"] == "base" and eng.source == "base"     # back to the base voices
print("promotion over the base voices, and back, OK")

# ------------------------------------------------- models arriving from the free GPU
os.environ["VOX_GPU_MODELS"] = str(W / "models"); (W / "models").mkdir()
assert t.import_gpu_model() is None
shutil.copy2(cand, W / "models/vox-step2000.pt")
(W / "models/gpu-status.json").write_text(json.dumps({"at": "2026-11-08T03:17:00+00:00", "notes": ["A training session is running on Kaggle's GPU."]}))
(W / "models/progress.json").write_text(json.dumps({"step": 2000, "gpu_hours": 7.9, "sessions": [{"at": "2026-11-08T03:00:00Z", "hours": 7.9, "gpu": "Tesla P100", "step": 2000}]}))
tried = []
t.evaluate_and_promote = lambda p: (tried.append(p.name), {"candidate": 0.4, "live": 0.9, "against": "base", "promoted": False})[1]
assert t.import_gpu_model()["file"] == "vox-step2000.pt"
assert t.import_gpu_model() is None and tried == ["vox-step2000.pt"]                      # each model tried once
g = t.gpu_status(); assert g["step"] == 2000 and g["last_tried"]["file"] == "vox-step2000.pt" and g["report"]["notes"]
t.settings.local_training = False
shutil.copy2(cand, W / "models/vox-step4000.pt"); os.utime(W / "models/vox-step4000.pt", (time.time() + 5, time.time() + 5))
r = t.train_round(force=True)
assert r["imported"]["file"] == "vox-step4000.pt" and not r["trained"]
r = t.train_round(force=True)
assert not r["trained"] and "free GPU" in r["why"]                                          # no CPU training by default
print("models from the free GPU: tried once each, no CPU training OK")

# ------------------------------------------------- preparing the open data (stand-in corpora)
rng = np.random.default_rng(1)
def tone(secs, sr):
    t = np.arange(int(secs * sr)) / sr
    return (0.2 * np.sin(2 * np.pi * rng.uniform(110, 220) * t) * (np.sin(2 * np.pi * 3 * t) > -0.3)).astype(np.float32)
def wav_bytes(secs, sr, fmt="WAV"):
    b = io.BytesIO(); sf.write(b, tone(secs, sr), sr, format=fmt); return b.getvalue()
src = W / "corpora"; src.mkdir()
def add(tar, name, data):
    ti = tarfile.TarInfo(name); ti.size = len(data); tar.addfile(ti, io.BytesIO(data))
with tarfile.open(src / "lj.tar.bz2", "w:bz2") as tar:                 # LJSpeech: the transcripts come last here
    for i in range(6):
        add(tar, f"LJSpeech-1.1/wavs/LJ001-{i:04d}.wav", wav_bytes(2 + i * 0.3, 22050))
    add(tar, "LJSpeech-1.1/wavs/LJ001-0099.wav", wav_bytes(0.4, 22050))  # too short: dropped
    add(tar, "LJSpeech-1.1/metadata.csv", "\n".join(f"LJ001-{i:04d}|raw {i}|Clue number {i} is true." for i in [*range(6), 99]).encode())
with zipfile.ZipFile(src / "vctk.zip", "w") as z:
    z.writestr("VCTK-Corpus-0.92/speaker-info.txt", "ID  AGE  GENDER  ACCENTS  REGION COMMENTS\np225  23  F    English    Southern  England\np234  22  F    Scottish  West Dumfries\n")
    for spk in ("p225", "p234"):
        for i in range(1, 4):
            z.writestr(f"VCTK-Corpus-0.92/wav48_silence_trimmed/{spk}/{spk}_{i:03d}_mic1.flac", wav_bytes(2.5, 48000, "FLAC"))
            z.writestr(f"VCTK-Corpus-0.92/wav48_silence_trimmed/{spk}/{spk}_{i:03d}_mic2.flac", wav_bytes(2.5, 48000, "FLAC"))
            z.writestr(f"VCTK-Corpus-0.92/txt/{spk}/{spk}_{i:03d}.txt", f"Please call Stella {i}.\n")
with tarfile.open(src / "libri.tar.gz", "w:gz") as tar:
    for spk in ("103", "1034"):
        for i in range(3):
            k = f"{spk}_1240_{i:06d}_000000"
            add(tar, f"LibriTTS_R/train-clean-100/{spk}/1240/{k}.wav", wav_bytes(3, 24000))
            add(tar, f"LibriTTS_R/train-clean-100/{spk}/1240/{k}.normalized.txt", f"The road was long {i}.".encode())
            add(tar, f"LibriTTS_R/train-clean-100/{spk}/1240/{k}.original.txt", b"ignored")
env = {**os.environ, "VOX_DATA_OUT": str(W / "vox-data"), "VOX_DATA_TMP": str(W / "tmp")}
env.update(VOX_URL_LJ=(src / "lj.tar.bz2").as_uri(), VOX_URL_VCTK=(src / "vctk.zip").as_uri(), VOX_URL_LIBRITTS_R=(src / "libri.tar.gz").as_uri())
r = subprocess.run([sys.executable, str(HERE / "kaggle/prepare_data.py")], env=env, capture_output=True, text=True, timeout=600)
assert r.returncode == 0, r.stdout + r.stderr
done = json.loads((W / "vox-data/done.json").read_text())
assert done["lj"]["clips"] == 6 and done["vctk"]["clips"] == 6 and done["libritts_r"]["clips"] == 6, done
lj = [json.loads(l) for l in (W / "vox-data/lj.jsonl").read_text().splitlines()]
assert lj[0]["text"].startswith("Clue number") and lj[0]["license"] == "public-domain" and lj[0]["dialect"] == "general_american"
vc = [json.loads(l) for l in (W / "vox-data/vctk.jsonl").read_text().splitlines()]
assert {r["dialect"] for r in vc} == {"british_rp", "scottish"} and {r["sex"] for r in vc} == {"female"} and all(r["license"] == "cc-by-4.0" for r in vc)
w, sr = sf.read(W / "vox-data" / vc[0]["wav"]); assert sr == 24000 and w.ndim == 1 and abs(len(w) / sr - vc[0]["secs"]) < 0.01
assert "CC BY 4.0" in (W / "vox-data/CREDITS.md").read_text()
assert not (W / "tmp").exists()                                                              # downloads cleaned up
print("open data prepared: 24 kHz FLAC, transcripts, licenses, credits, VCTK accents OK")

# ------------------------------------------------- a training session stops on time
from vox.train import train
from vox.config import VoxConfig
cfg = VoxConfig.preset("tiny"); cfg.train.batch_frames = 3000; cfg.train.log_every = 5; cfg.train.save_every = 10 ** 9
cfg.model.text_mode = "bytes"
t0 = time.time()
train([str(W / "vox-data/lj.jsonl"), str(W / "vox-data/libritts_r.jsonl")], W / "run", cfg=cfg, max_steps=10 ** 6, deadline=time.time() + 15)
took = time.time() - t0
st = torch.load(W / "run/vox.pt", map_location="cpu", weights_only=False)
assert took < 120 and st["train_state"]["step"] > 0, took
print(f"training stops at its deadline and saves ({took:.0f}s, step {st['train_state']['step']}) OK")

# ------------------------------------------------- the Kaggle loop, against a stand-in Kaggle
fake = W / "fake_kaggle.py"; state = W / "kaggle_state.json"
fake.write_text("""
import json, sys, os, shutil
from pathlib import Path
S = Path(os.environ['FAKE_STATE']); st = json.loads(S.read_text()) if S.exists() else {'datasets': {}, 'kernels': {}, 'log': []}
a = sys.argv[1:]; st['log'].append(' '.join(a[:2]))
def save(): S.write_text(json.dumps(st))
def meta(p, name): return json.loads((Path(p) / name).read_text())
if a[:2] == ['datasets', 'files']:
    d = st['datasets'].get(a[2])
    if d is None: print('404 Not Found'); save(); sys.exit(1)
    print('name,size'); [print(f + ',1') for f in d]
elif a[:2] in (['datasets', 'create'], ['datasets', 'version']):
    p = a[a.index('-p') + 1]; m = meta(p, 'dataset-metadata.json')
    st['datasets'][m['id']] = sorted(x.name for x in Path(p).iterdir() if x.name != 'dataset-metadata.json'); print('ok')
elif a[:2] == ['datasets', 'status']: print('ready')
elif a[:2] == ['kernels', 'status']:
    k = st['kernels'].get(a[2])
    if k is None: print('404 Not Found'); save(); sys.exit(1)
    print(f'{a[2]} has status "KernelWorkerStatus.{k["status"].upper()}"')
elif a[:2] == ['kernels', 'push']:
    p = a[a.index('-p') + 1]; m = meta(p, 'kernel-metadata.json')
    code = (Path(p) / m['code_file']).read_text()
    st['kernels'][m['id']] = {'status': 'running', 'meta': m, 'hours': code.split("'VOX_HOURS', '")[1].split("'")[0] if 'VOX_HOURS' in code else None}; print('pushed')
elif a[:2] == ['kernels', 'output']:
    p = Path(a[a.index('-p') + 1]); out = st['kernels'][a[2]].get('output', {})
    for name, text in out.items(): (p / name).write_text(text)
elif a[:2] == ['kernels', 'list']: print('ref,title,author,lastRunTime,totalVotes')
save()
""")
envk = {**os.environ, "KAGGLE_CLI": f"{sys.executable} {fake}", "FAKE_STATE": str(state), "KAGGLE_USERNAME": "bobby"}
def go(*extra):
    r = subprocess.run([sys.executable, str(HERE / "kaggle/orchestrate.py"), "--repo-root", str(HERE.parent), "--work", str(W / "kwork"),
                        "--outbox", str(W / "kout"), *extra], env=envk, capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stdout + r.stderr
    return json.loads((W / "kout/report.json").read_text())
def st(): return json.loads(state.read_text())
def setk(ref, **kw):
    s = st(); s["kernels"][ref].update(kw); state.write_text(json.dumps(s))
r = go(); assert r["state"] == "data"                                                       # code published, data notebook pushed
s = st(); assert any(f.startswith("code-") for f in s["datasets"]["bobby/vox-engine-code"])
assert s["kernels"]["bobby/vox-data"]["meta"]["enable_gpu"] is False and s["kernels"]["bobby/vox-data"]["meta"]["is_private"]
r = go(); assert r["state"] == "data" and "still being prepared" in r["notes"][-1]
assert st()["log"].count("datasets create") == 1 and "datasets version" not in st()["log"]   # code unchanged: not uploaded again
setk("bobby/vox-data", status="complete")
r = go(); assert r["state"] == "started" and r["session_hours"] == 8                       # first session: a new model
m = st()["kernels"]["bobby/vox-train"]["meta"]
assert m["enable_gpu"] and m["kernel_sources"] == ["bobby/vox-data"] and m["dataset_sources"] == ["bobby/vox-engine-code"]
r = go(); assert r["state"] == "training"
prog = {"step": 40000, "gpu_hours": 8.0, "preset": "small", "sessions": [{"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "hours": 8.0, "step": 40000}]}
setk("bobby/vox-train", status="complete", output={"vox.pt": "full", "vox-serve.pt": "slim", "progress.json": json.dumps(prog)})
r = go()
assert r["delivered"] == "vox-step40000.pt" and (W / "kout/vox-step40000.pt").read_text() == "slim"
assert "step-40000.txt" in st()["datasets"]["bobby/vox-ckpt"] and "vox.pt" in st()["datasets"]["bobby/vox-ckpt"]
assert r["state"] == "started" and r["week_hours"] == 8.0 and r["session_hours"] == 8      # resumes, 16 of 24 hours left
assert st()["kernels"]["bobby/vox-train"]["meta"]["dataset_sources"] == ["bobby/vox-engine-code", "bobby/vox-ckpt"]
prog["sessions"] += [{"at": prog["sessions"][0]["at"], "hours": 8.0}, {"at": prog["sessions"][0]["at"], "hours": 7.5}]; prog["step"] = 120000
setk("bobby/vox-train", status="complete", output={"vox.pt": "full2", "vox-serve.pt": "slim2", "progress.json": json.dumps(prog)})
for f in (W / "kout").glob("vox-step*.pt"): f.unlink()
r = go(); assert r["delivered"] == "vox-step120000.pt" and r["state"] == "budget"           # 23.5 of 24 hours used this week
r = go(); assert r["state"] == "budget" and "already saved" in " ".join(r["notes"])          # not saved twice
r = go("--dry-run"); assert r["state"] == "budget"
setk("bobby/vox-train", status="error")
r = go(); assert r["state"] == "started"                                                    # an error: start again (no recent run time known)
assert not list((HERE / "kaggle").glob("push-*")), "staged uploads belong in the work folder, not the repo"
print("Kaggle loop: code once, data once, sessions resume, checkpoints saved once, weekly budget kept OK")
print("VOICE BASE OK")
