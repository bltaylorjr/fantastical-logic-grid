"""End-to-end smoke test on a laptop CPU in a few minutes.

It builds a synthetic toy dataset (buzzy vowel-like sounds, not real speech),
runs the full data pipeline, trains every network for a handful of steps,
then exercises the engine, editing, voice design, cloning and the game server.
It proves the plumbing works; it does NOT produce a usable voice (that takes
real data and many hours of GPU training; see README).

    python tests/smoke_test.py
"""
from __future__ import annotations

import json
import shutil
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from vox.audio import save_audio  # noqa: E402
from vox.config import VoxConfig  # noqa: E402

WORK = Path(__import__("tempfile").gettempdir()) / "vox_smoke"
SR = 24000
SENTENCES = ["the old gate is locked", "follow me to the river", "did you hear that",
             "we leave at dawn", "keep your sword ready", "the king is waiting",
             "is anyone there", "light the torches now"]


def fake_speech(text: str, f0: float, rng: np.random.Generator) -> np.ndarray:
    """Each letter -> 75 ms of a buzzy tone with a letter-specific 'formant'."""
    out = [np.zeros(int(0.25 * SR))]
    for ch in text:
        n = int(0.075 * SR)
        t = np.arange(n) / SR
        if ch == " ":
            out.append(np.zeros(int(0.05 * SR)) + rng.normal(0, 1e-4, int(0.05 * SR))); continue
        form = 300 + (ord(ch) - 97) * 120
        sig = sum(np.sin(2 * np.pi * f0 * k * t) / k * np.exp(-((f0 * k - form) / 600) ** 2)
                  for k in range(1, 40) if f0 * k < 11000)
        sig = sig + rng.normal(0, 0.05, n) * (ch in "stfhz")       # fricative noise
        out.append(sig * np.hanning(n) ** 0.3)
    out.append(np.zeros(int(0.25 * SR)))
    w = np.concatenate(out)
    return (0.3 * w / (np.abs(w).max() + 1e-9) + rng.normal(0, 1e-4, len(w))).astype(np.float32)


def make_dataset() -> Path:
    rng = np.random.default_rng(0)
    raw = WORK / "raw"
    emotions = ["neutral", "happy", "sad", "angry"]
    for s, f0 in enumerate([110, 140, 190, 230]):
        d = raw / f"speaker{s}"
        d.mkdir(parents=True, exist_ok=True)
        for i, sent in enumerate(SENTENCES):
            wav = fake_speech(sent, f0 * (1 + 0.1 * (i % 3)), rng)
            save_audio(d / f"utt{i}.wav", wav, SR)
            (d / f"utt{i}.txt").write_text(sent + ("?" if sent.startswith(("did", "is")) else "."))
            (d / f"utt{i}.emotion").write_text(emotions[(i + s) % 4])
    yaml = WORK / "sources.yaml"
    yaml.write_text(f"""project:
  noncommercial: false
sources:
  - name: toy
    kind: local
    path: {raw}
    license: own-recording
  - name: should_be_rejected
    kind: local
    path: {raw}
    license: cc-by-nc-4.0
""")
    return yaml


def main():
    t0 = time.time()
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True)
    from vox.data.process import QualityLimits, build_dataset, coverage_report

    print("== data pipeline")
    yaml = make_dataset()
    manifest = build_dataset(yaml, WORK / "data", limits=QualityLimits(min_bandwidth_hz=2000, min_snr_db=10))
    rows = [json.loads(l) for l in manifest.read_text().splitlines()]
    report = json.loads((WORK / "data" / "report.json").read_text())
    assert report["rejected_sources"] == 1, "non-commercial source should be rejected"
    assert len(rows) == 32, f"expected 32 clips, got {len(rows)}"
    cov = coverage_report(WORK / "data" / "vocabulary.json", ["The dragon is waiting at the river."])
    print("coverage:", cov["coverage"], "never heard:", list(cov["never_heard"]))
    assert "dragon" in cov["never_heard"]

    print("== train generator")
    from vox.train import pseudo_label_emotions, train, train_emotion_classifier, train_vocoder
    cfg = VoxConfig.preset("tiny")
    cfg.train.batch_frames = 2400; cfg.train.warmup_steps = 10; cfg.train.log_every = 20
    cfg.train.save_every = 10 ** 9; cfg.train.lr = 2e-3; cfg.infer.nfe_steps = 8
    ckpt = train(manifest, WORK / "run", cfg, max_steps=120)
    log = [json.loads(l) for l in (WORK / "run" / "log.jsonl").read_text().splitlines()]
    first, last = log[0]["flow"], np.mean([r["flow"] for r in log[-2:]])
    print(f"flow loss {first:.3f} -> {last:.3f}")
    assert last < first, "loss should go down"

    print("== resume training")
    train(manifest, WORK / "run", resume=str(ckpt), max_steps=130)

    print("== emotion classifier + pseudo labels")
    train_emotion_classifier(str(ckpt), manifest, steps=30, batch=8)
    pseudo_label_emotions(str(ckpt), str(manifest), threshold=0.0)

    print("== vocoder")
    train_vocoder(str(ckpt), manifest, steps=30, batch=4, adv_start=15, segment_secs=0.5, save_every=30)

    print("== engine")
    from vox.engine import ConsentRecord, VoxEngine
    eng = VoxEngine(ckpt, voices_dir=WORK / "voices", cache_dir=WORK / "cache")
    assert eng.space is not None and eng.model.vocoder_trained
    v = eng.design_voice("deep gravelly old guard, slow and stern", seed=11, name="guard")
    line = eng.speak("Halt! Who goes there? [breath] *Nobody* passes without the password.",
                     voice="guard", emotion={"angry": 0.6}, rate=-0.5, seed=3)
    line.save(WORK / "guard.wav")
    print(f"line: {line.duration:.2f}s, segments: {len(line.segments)}")
    from vox.audio import load_audio
    clip = np.concatenate([load_audio(WORK / "raw" / "speaker1" / f"utt{i}.wav", SR) for i in (0, 1)])
    sample = WORK / "clone_sample.wav"
    save_audio(sample, clip, SR)
    eng.clone_voice("ranger", str(sample), "the old gate is locked. follow me to the river.",
                    ConsentRecord("Test Speaker", "Test Speaker", "Synthetic test voice, any use permitted."))
    long_text = " ".join(f"Sentence number {i} keeps the same voice." for i in range(1, 7))
    eng.cfg.infer.max_chunk_chars = 60
    longf = eng.speak(long_text, voice="ranger", seed=5)
    print(f"long-form: {len(longf.segments)} chunks, {longf.duration:.1f}s")
    ed = eng.edit(longf)
    ed.replace("number 3", "number three hundred").restyle("same voice", emotion="happy")
    assert "three hundred" in ed.text
    ed.undo(); assert "three hundred" in ed.text and ed.can_redo
    ed.render().save(WORK / "edited.wav")

    print("== auto-tune")
    from vox.audio import track_pitch
    sr_t = np.arange(SR * 2) / SR
    ph = 2 * np.pi * 220 * 2 ** (0.35 / 12) * sr_t
    sharp = (0.3 * sum(np.sin(k * ph) / k for k in range(1, 15))).astype(np.float32)
    from vox.autotune import autotune
    f = track_pitch(autotune(sharp, SR, "hard").astype(np.float64), SR, 120)
    assert abs(np.median(f[f > 0]) - 220) < 1.5, np.median(f[f > 0])
    tuned = eng.speak("Sing it, bard.", voice="guard", autotune="bard", seed=9)
    assert tuned.style["autotune"] == "bard"

    print("== game server + learning")
    from fastapi.testclient import TestClient
    from vox.learning import LearningSystem
    from vox.server import admin_token_for, create_app
    learn = LearningSystem(eng, WORK / "learning")
    learn.update_settings({"steps": 15, "min_examples": 1, "min_quality": 0, "min_gain": -100,
                           "auto_learn": False, "voice_min_likes": 1, "benchmark_voices": 1})
    token = admin_token_for(WORK / "learning")
    client = TestClient(create_app(eng, learn, token))
    A = {"X-Vox-Admin-Token": token}
    r = client.options("/v1/speak", headers={"Origin": "https://flg-api.btay74.workers.dev",
                                              "Access-Control-Request-Method": "POST",
                                              "Access-Control-Request-Private-Network": "true"})
    assert r.headers.get("access-control-allow-private-network") == "true"
    assert client.get("/v1/admin/learning").status_code == 401
    assert client.get("/v1/admin/learning", headers={"X-Vox-Admin-Token": "wrong"}).status_code == 401
    assert client.get("/v1/health").json()["status"] == "ok"
    r = client.post("/v1/speak", json={"text": "Welcome, traveler.", "voice": "guard", "seed": 1})
    assert r.status_code == 200 and r.content[:4] == b"RIFF", r.text
    assert "guard" in [v["name"] for v in client.get("/v1/voices").json()]
    r = client.post("/v1/voices/design", json={"description": "bright cheerful young merchant", "seed": 4})
    assert r.status_code == 200, r.text
    form = {"name": "nope", "transcript": "x", "speaker_name": "A", "granted_by": "A", "consent_statement": "short"}
    r = client.post("/v1/voices/clone", data=form, files={"audio": ("a.wav", sample.read_bytes(), "audio/wav")})
    assert r.status_code == 401, "cloning needs the admin token"
    r = client.post("/v1/voices/clone", data=form, headers=A,
                    files={"audio": ("a.wav", sample.read_bytes(), "audio/wav")})
    assert r.status_code == 403, "clone without real consent must be refused"
    with client.websocket_connect("/v1/stream") as ws:
        ws.send_json({"text": "First part. Second part.", "voice": "guard", "seed": 2})
        n = 0
        while True:
            msg = ws.receive()
            if msg.get("bytes"):
                n += 1
            elif msg.get("text") and json.loads(msg["text"]).get("event") == "end":
                break
        assert n >= 1
    r = client.post("/v1/bake", json={"lines": [{"id": "g1", "text": "Stop right there.", "voice": "guard"},
                                                {"id": "g2", "text": "Move along.", "voice": "guard"}]})
    assert r.status_code == 200 and len(r.json()["lines"]) == 2, r.text

    print("== learning loop")
    r = client.post("/v1/speak", json={"text": "The north gate is closed.", "voice": "guard", "seed": 21})
    take1 = r.headers["x-vox-take-id"]
    assert "x-vox-quality" in r.headers
    r = client.post("/v1/edit", json={"take": r.headers["x-vox-take"], "ops": [{"op": "regenerate", "start": 0.1, "end": 0.3}]})
    take2 = r.headers["x-vox-take-id"]
    assert learn.take(take2)["parent"] == take1
    assert client.post(f"/v1/admin/takes/{take2}/feedback", json={"rating": 1}, headers=A).status_code == 200
    assert client.post(f"/v1/admin/takes/{take1}/feedback", json={"rating": -1}, headers=A).status_code == 200
    ab = client.post("/v1/admin/ab", json={"text": "Keep moving.", "voice": "guard"}, headers=A).json()
    assert client.post("/v1/admin/compare", json={"winner": ab["a"], "loser": ab["b"]}, headers=A).status_code == 200
    bad = client.post("/v1/admin/compare", json={"winner": ab["a"], "loser": take1}, headers=A)
    assert bad.status_code == 400, "A/B needs the same line"
    st = client.get("/v1/admin/learning", headers=A).json()
    assert st["preferences"] >= 2 and st["rated"] == 2, st
    assert client.get(f"/v1/admin/takes/{take1}/audio", headers=A).content[:4] == b"RIFF"
    assert len(client.get("/v1/admin/takes?rated=liked", headers=A).json()) == 1
    # pronunciation fix applies to every line at once
    assert client.put("/v1/admin/lexicon", json={"word": "Aelith", "say_as": "AY-lith"}, headers=A).status_code == 200
    assert eng.apply_lexicon("Ask aelith. [breath] Aelith's here") == "Ask AY-lith. [breath] AY-lith's here"
    # a refinement round
    assert client.post("/v1/admin/learning/refine", headers=A).status_code == 200
    learn.wait()
    rnd = client.get("/v1/admin/learning", headers=A).json()["rounds"][0]
    print("round:", rnd["status"], rnd["message"])
    assert rnd["status"] == "done" and rnd["promoted"] == 1, rnd
    vers = client.get("/v1/admin/models", headers=A).json()
    assert [v for v in vers if v["current"]][0]["version"] == "v0002" and len(vers) == 2
    assert eng.voices.load("guard").history, "liked voice should have been refined"
    assert client.post("/v1/admin/voices/guard/undo-refine", headers=A).status_code == 200
    assert client.post("/v1/admin/models/rollback", headers=A).json()["current"] == "v0001"
    assert client.post("/v1/admin/models/v0002/promote", headers=A).status_code == 200
    learn2 = LearningSystem(eng, WORK / "learning")      # restart: current version survives
    assert learn2.store.get("current") == "v0002"
    # auto-optimize and auto-tune defaults for a voice
    assert client.post("/v1/admin/voices/guard/optimize", headers=A).status_code == 200
    learn.wait()
    assert eng.voices.load("guard").infer, learn.job
    print("optimize:", learn.job["message"])
    r = client.patch("/v1/admin/voices/guard", json={"autotune": {"preset": "pop", "key": "D", "scale": "major"}}, headers=A)
    assert r.status_code == 200 and r.json()["autotune"]["key"] == "D"
    assert client.patch("/v1/admin/voices/guard", json={"autotune": {"scale": "nope"}}, headers=A).status_code == 400
    assert client.post("/v1/speak", json={"text": "Tuned by default.", "voice": "guard"}).status_code == 200
    assert "bard" in [p["name"] for p in client.get("/v1/autotune/presets").json()["presets"]]
    r = client.post("/v1/autotune", data={"settings": '{"preset": "hard", "key": "A", "scale": "minor"}'},
                    files={"audio": ("s.wav", sample.read_bytes(), "audio/wav")})
    assert r.status_code == 200 and r.content[:4] == b"RIFF"

    print("== dictionary, sounds and usage")
    from vox.lexicon.dictionary import Dictionary
    from vox.text import PHONE_OFFSET
    dic = Dictionary(WORK / "dictionary.db")
    stats = dic.install()
    assert stats["words"] > 200000, stats
    eng._pronouncer = None
    eng.pronouncer.dictionary = dic
    toks = eng.tokens_for("I have read the record.")
    assert sum(t >= PHONE_OFFSET for t in toks) > 10, "English words become sounds"
    assert not any(t >= PHONE_OFFSET for t in eng.tokens_for("Hola amigo", {"language": "es"})), "Spanish stays letters"
    client = TestClient(create_app(eng, learn, token, dictionary=dic))
    w = client.get("/v1/dictionary/record").json()
    assert w["pronunciations"] and w["senses"] and len(w["usage_pronunciations"]) == 2, w
    assert w["pronunciations"][0]["respelling"] and w["pronunciations"][0]["ipa"]
    assert "enunciate" in client.get("/v1/dictionary?prefix=enunc").json()["words"]
    assert client.put("/v1/admin/lexicon", json={"word": "Zorvex", "say_as": "Z AO1 R V EH0 K S"}, headers=A).status_code == 200
    assert eng.pronouncer.word("Zorvex") == "Z AO1 R V EH0 K S", "a sound-spelled fix is used exactly"
    r = client.post("/v1/speak", json={"text": "Speak clearly, please.", "voice": "guard", "enunciate": 1.0, "seed": 4})
    assert r.status_code == 200

    print("== translation")
    calls = []
    def fake(texts, src, tgt):
        calls.append(texts)
        return [f"{tgt.upper()}: {t}" for t in texts]
    eng.use_translator("m2m100", WORK / "translations.db", engine_fn=fake)
    r = client.post("/v1/translate", json={"text": "Halt! [breath] *Nobody* passes.", "to": "es"})
    assert r.json()["text"] == "ES: Halt! [breath] ES: Nobody passes.", r.json()
    assert len(client.get("/v1/languages").json()["languages"]) == 100
    r = client.post("/v1/speak", json={"text": "Welcome, friend.", "voice": "guard", "translate_to": "fr", "seed": 5})
    assert r.status_code == 200 and json.loads(r.headers["x-vox-segments"])[0]["text"].startswith("FR:")
    assert client.post("/v1/translate", json={"text": "Hi", "to": "xx"}).status_code == 400

    print("== voices from many speakers")
    uploads = []
    for spk in range(4):
        clip = np.concatenate([np.concatenate([load_audio(WORK / "raw" / f"speaker{spk}" / f"utt{i}.wav", SR),
                                               np.zeros(SR // 2, np.float32)]) for i in range(8)])
        buf = WORK / f"spk{spk}.wav"; save_audio(buf, clip, SR)
        uploads.append(("files", (f"spk{spk}.wav", buf.read_bytes(), "audio/wav")))
    r = client.post("/v1/admin/voices/from-samples", data={"name": "nolicense"}, files=uploads[:1], headers=A)
    assert r.status_code == 400, "uploads need a license"
    r = client.post("/v1/admin/voices/from-samples", data={"name": "crowd", "license": "own-recording",
                                                           "speakers": "3", "seed": "3"}, files=uploads, headers=A)
    job = r.json()["job"]
    for _ in range(600):
        j = client.get(f"/v1/admin/jobs/{job}", headers=A).json()
        if j["done"]:
            break
        time.sleep(0.2)
    print("samples:", j["message"], {k: j.get("result", {}).get(k) for k in ("speakers", "used", "max_similarity")})
    if not j.get("failed"):
        res = j["result"]
        assert res["used"] >= 3 and res["max_similarity"] < 0.75 and max(res["weights"]) <= 0.45 + 1e-6, res
        assert eng.voices.load("crowd").origin == "sampled"
    else:
        assert "speaker" in j["message"] or "different enough" in j["message"], j
    from vox.sampling import blend
    import torch
    rng = __import__("random").Random(0)
    cents = [torch.nn.functional.normalize(torch.randn(32), dim=0) for _ in range(6)]
    emb, pick, wts, top = blend(cents, 4, rng)
    assert len(pick) >= 4 and top < 0.75 and max(wts) <= 0.4 + 1e-6

    print("== online")
    pub = TestClient(create_app(eng, learn, token, public=True, rate_per_minute=3, dictionary=dic))
    r = pub.options("/v1/speak", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert r.headers.get("access-control-allow-origin") != "https://evil.example", "other websites are refused"
    r = pub.options("/v1/speak", headers={"Origin": "https://flg-api.btay74.workers.dev", "Access-Control-Request-Method": "POST"})
    assert r.headers.get("access-control-allow-origin") == "https://flg-api.btay74.workers.dev"
    assert pub.post("/v1/voices/design", json={"description": "x"}).status_code == 401, "design needs the token online"
    codes = [pub.get("/v1/dictionary/cat").status_code for _ in range(5)]
    assert 429 in codes, codes
    assert pub.get("/v1/dictionary/cat", headers=A).status_code == 200, "the admin isn't rate-limited"
    import os
    from vox.tunnel import start_quick_tunnel
    if os.name == "nt":      # the stand-in tunnel below is a Linux/Mac shell script
        print(f"\nALL SMOKE TESTS PASSED in {time.time() - t0:.0f}s")
        return
    fake_cf = WORK / "cloudflared"
    fake_cf.write_text("#!/bin/sh\necho 'INF Your quick Tunnel has been created! Visit it at'\n"
                       "echo 'INF |  https://happy-ocean-words.trycloudflare.com  |'\nsleep 30\n")
    fake_cf.chmod(0o755)
    proc, url = start_quick_tunnel(5150, exe=str(fake_cf))
    proc.terminate()
    assert url == "https://happy-ocean-words.trycloudflare.com", url
    print(f"\nALL SMOKE TESTS PASSED in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
