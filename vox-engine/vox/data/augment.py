"""Synthetic augmentation, the third ingredient of the hybrid pipeline.

Once a first model is trained, use it to fill gaps in the data: emotions or
speaking styles with few real examples. Every synthetic clip must pass two
checks before it is kept:
  * the speaker still sounds like the target voice (embedding similarity);
  * the words are intelligible (Whisper transcribes them back correctly).
Synthetic clips are tagged so you can down-weight or exclude them later.
Keep synthetic data a minority (the default cap is 20%) to avoid the model
learning its own artifacts.
"""
from __future__ import annotations

import json
import random
from collections import Counter
from pathlib import Path

import torch

from ..audio import save_audio
from ..config import EMOTIONS
from ..text import words_of
from ..voices import cosine
from .process import Transcriber

PROMPTS = [
    "I never thought I would see this place again.",
    "Stay close to me and keep your voice down.",
    "Is that really what you saw out there?",
    "We have until sunrise, and not a moment longer.",
    "You did it! I knew you could!",
    "Please, just listen to me for once.",
    "The gate is locked, but I know another way in.",
    "Why would anyone leave something like this behind?",
]


def word_error_rate(ref: str, hyp: str) -> float:
    r, h = words_of(ref), words_of(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev, d[j] = d[j], cur
    return d[len(h)] / max(len(r), 1)


def synthesize_augmentation(engine, manifest: str | Path, out_dir: str | Path,
                            voices: list[str], max_fraction: float = 0.2,
                            min_similarity: float = 0.8, max_wer: float = 0.15,
                            seed: int = 0) -> int:
    manifest, out = Path(manifest), Path(out_dir)
    (out / "wavs").mkdir(parents=True, exist_ok=True)
    rows = [json.loads(l) for l in manifest.read_text().splitlines() if l.strip()]
    counts = Counter(r.get("emotion") or "neutral" for r in rows)
    budget = int(len(rows) * max_fraction)
    target = max(counts.values()) if counts else 50
    asr = Transcriber("small")
    rng = random.Random(seed)
    added = []
    for emo in EMOTIONS:
        need = min(target - counts.get(emo, 0), budget - len(added))
        tries = 0
        while need > 0 and tries < need * 4:
            tries += 1
            v, text = rng.choice(voices), rng.choice(PROMPTS)
            res = engine.speak(text, voice=v, emotion=emo, intensity=rng.uniform(0.5, 1.0),
                               seed=rng.randrange(2 ** 31), use_cache=False)
            with torch.no_grad():
                emb = engine.model.speaker(res.mel.T[None].to(engine.device))[0]
            if cosine(emb, engine.voices.load(v).emb_tensor(engine.device)) < min_similarity:
                continue
            if asr.available and word_error_rate(text, asr(res.wav, res.sample_rate)[0]) > max_wer:
                continue
            cid = f"syn_{emo}_{len(added):06d}"
            save_audio(out / "wavs" / f"{cid}.wav", res.wav, res.sample_rate)
            added.append({"id": cid, "wav": f"wavs/{cid}.wav", "text": text, "plain_text": text,
                          "speaker": f"voice:{v}", "emotion": emo, "emotion_source": "synthetic",
                          "secs": res.duration, "prosody": [0.0, 0.0, 0.0, 0.0],
                          "source": "synthetic", "license": "own-recording", "attribution": ""})
            need -= 1
    with open(out / "manifest.jsonl", "w") as f:
        for r in added:
            f.write(json.dumps(r) + "\n")
    return len(added)
