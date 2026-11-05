"""New voices from many people's recordings, without recording anyone.

    voice = create_voice_from_samples(engine, "harbor_master",
                                      keywords=["old sea captain", "harbor radio"])

How it works
  1. Keywords search openly licensed archives (Internet Archive items marked
     public domain or Creative Commons BY; each item's license is re-checked).
     You can add your own links or files too, with their license.
  2. Recordings are split into speech clips and grouped by speaker. The same
     person found in two recordings is counted once.
  3. At least 3 different speakers (5 by default) are blended into one new
     voice, and no single speaker may carry more than 40% of it.
  4. The result must not sound like any one of them: its similarity to every
     source speaker has to stay below a limit (0.75). If it doesn't, the
     blend is rebalanced or more speakers are added, or the voice is refused.
So no one person is singled out or copied. To copy one specific person's
voice, use cloning, which needs that person's consent.
"""
from __future__ import annotations

import random
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from .audio import load_audio, normalize_loudness
from .data.process import QualityLimits, quality, segment
from .data.sources import LicenseError, RawItem, Source, check_license, iter_source, normalize_license
from .voices import Voice

MIN_SPEAKERS = 3


@dataclass
class SpeakerFound:
    centroid: torch.Tensor
    clips: int
    seconds: float
    source: str
    attribution: str


@dataclass
class SampleReport:
    searched: list[str] = field(default_factory=list)
    recordings: int = 0
    skipped: list[str] = field(default_factory=list)
    speakers: int = 0
    used: int = 0
    weights: list[float] = field(default_factory=list)
    max_similarity: float = 0.0
    sources: list[str] = field(default_factory=list)


def _gather(keywords, urls, files, max_items, noncommercial, workdir: Path, report: SampleReport, progress):
    items: list[RawItem] = []
    for kw in keywords or []:
        progress(f"Searching openly licensed recordings for “{kw}”")
        for media in ("audio", "movies"):
            src = Source(f"kw-{abs(hash((kw, media))) % 10 ** 8}", "internet_archive", "public-domain",
                         options={"query": kw, "mediatype": media, "max_items": max_items})
            try:
                found = list(iter_source(src, workdir, noncommercial))
            except Exception as e:      # network down or archive busy: keep going with what we have
                report.skipped.append(f"search “{kw}” ({media}): {e}")
                continue
            items.extend(found[:max_items])
        report.searched.append(kw)
    for u in urls or []:
        lic = normalize_license(u.get("license", ""))
        try:
            check_license(lic, noncommercial)
        except LicenseError as e:
            report.skipped.append(f"{u.get('url')}: {e}")
            continue
        src = Source(f"url-{abs(hash(u['url'])) % 10 ** 8}", "media_url", lic, u.get("attribution", ""),
                     options={"urls": [u["url"]]})
        try:
            items.extend(iter_source(src, workdir, noncommercial))
        except Exception as e:
            report.skipped.append(f"{u['url']}: {e}")
    for f in files or []:
        lic = normalize_license(f.get("license", ""))
        try:
            check_license(lic, noncommercial)
        except LicenseError as e:
            report.skipped.append(f"{f.get('name', 'upload')}: {e}")
            continue
        path = Path(f["path"]) if "path" in f else None
        if path is None:
            path = workdir / f"upload-{len(items)}-{Path(f.get('name', 'a.wav')).name}"
            path.write_bytes(f["data"])
        items.append(RawItem(path, "upload", lic, f.get("speaker", f"upload:{path.name}"), None, None,
                             f.get("attribution", f.get("name", path.name))))
    return items


@torch.no_grad()
def _speakers_in(engine, item: RawItem, max_clips: int, limits: QualityLimits) -> list[SpeakerFound]:
    sr = engine.sr
    try:
        wav = load_audio(item.path, sr)
    except Exception:
        from .data.process import _decode
        wav = _decode(item.path, sr)
    wav = wav[: sr * 600]                               # first 10 minutes is plenty
    found: list[dict] = []
    spans = segment(wav, sr, limits)
    random.Random(0).shuffle(spans)
    for a, b in spans[: max_clips * 3]:
        seg = wav[a:b]
        q = quality(seg, sr)
        if q["snr_db"] < limits.min_snr_db or q["clip_ratio"] > limits.max_clip_ratio:
            continue
        mel = engine.model.mel(torch.from_numpy(normalize_loudness(seg)).to(engine.device))
        emb = engine.model.speaker(mel)[0]
        for g in found:                                  # same speaker as an earlier clip?
            if float(F.cosine_similarity(emb, F.normalize(g["sum"], dim=-1), dim=0)) >= 0.8:
                g["sum"] += emb; g["n"] += 1; g["secs"] += len(seg) / sr
                break
        else:
            found.append({"sum": emb.clone(), "n": 1, "secs": len(seg) / sr})
        if sum(g["n"] for g in found) >= max_clips:
            break
    return [SpeakerFound(F.normalize(g["sum"], dim=-1), g["n"], g["secs"], str(item.path), item.attribution)
            for g in found if g["n"] >= 2 or g["secs"] >= 6]


def blend(centroids: list[torch.Tensor], k: int, rng: random.Random, max_weight: float = 0.4,
          max_similarity: float = 0.75) -> tuple[torch.Tensor, list[int], list[float], float]:
    """Mix k speakers so the result is close to none of them."""
    order = list(range(len(centroids)))
    rng.shuffle(order)
    for extra in range(0, len(centroids) - k + 1):
        pick = order[: k + extra]
        n = len(pick)
        cap = max(max_weight, 1.0 / n + 1e-6)
        w = np.array([rng.gammavariate(2.0, 1.0) for _ in pick])
        w = w / w.sum()
        for _ in range(50):
            w = np.minimum(w, cap); w = w / w.sum()
            if w.max() <= cap + 1e-9:
                break
        stack = torch.stack([centroids[i] for i in pick])
        for _ in range(30):
            emb = F.normalize((torch.tensor(w, dtype=stack.dtype, device=stack.device)[:, None] * stack).sum(0), dim=-1)
            sims = F.cosine_similarity(emb[None], torch.stack(centroids), dim=-1)
            top = float(sims.max())
            if top < max_similarity:
                return emb, pick, w.tolist(), top
            j = int(sims.argmax())           # pull back from whoever it sounds most like
            if j in pick:
                w[pick.index(j)] *= 0.7
                w = w / w.sum()
            else:
                break
    raise ValueError("Couldn't make a voice that is different enough from every source speaker. "
                     "Try other keywords or more recordings.")


def create_voice_from_samples(engine, name: str, keywords: list[str] | None = None, urls: list[dict] | None = None,
                              files: list[dict] | None = None, speakers: int = 5, seed: int | None = None,
                              description: str = "", max_items: int = 6, max_clips: int = 12,
                              max_weight: float = 0.4, max_similarity: float = 0.75, noncommercial: bool = False,
                              limits: QualityLimits | None = None, progress=lambda m, p=None: None) -> tuple[Voice, SampleReport]:
    if not (keywords or urls or files):
        raise ValueError("Give keywords to search for, or links or files to sample.")
    speakers = max(MIN_SPEAKERS, int(speakers))
    max_weight = min(max_weight, 0.45)
    seed = seed if seed is not None else random.randrange(2 ** 31)
    rng = random.Random(seed)
    limits = limits or QualityLimits(min_snr_db=15.0)
    report = SampleReport()
    with tempfile.TemporaryDirectory() as td:
        items = _gather(keywords, urls, files, max_items, noncommercial, Path(td), report,
                        lambda m: progress(m, 0.1))
        report.recordings = len(items)
        found: list[SpeakerFound] = []
        for i, item in enumerate(items):
            progress(f"Listening for different speakers ({i + 1} of {len(items)})", 0.2 + 0.6 * i / max(1, len(items)))
            try:
                for sp in _speakers_in(engine, item, max_clips, limits):
                    same = [f for f in found if float(F.cosine_similarity(sp.centroid, f.centroid, dim=0)) >= 0.85]
                    if not same:                 # the same person in two recordings counts once
                        found.append(sp)
            except Exception as e:
                report.skipped.append(f"{Path(item.path).name}: {e}")
    report.speakers = len(found)
    if len(found) < MIN_SPEAKERS:
        raise ValueError(f"Found {len(found)} different speaker(s); at least {MIN_SPEAKERS} are needed so no one "
                         "person is copied. Try broader keywords or add more recordings.")
    progress("Blending the voices", 0.9)
    emb, pick, weights, top = blend([f.centroid for f in found], min(speakers, len(found)), rng,
                                    max_weight, max_similarity)
    report.used, report.weights, report.max_similarity = len(pick), [round(w, 3) for w in weights], round(top, 3)
    report.sources = sorted({found[i].attribution for i in pick if found[i].attribution})
    desc = description or f"Blend of {len(pick)} speakers" + (f" ({', '.join(keywords)})" if keywords else "")
    voice = Voice(name=name, speaker_emb=emb.cpu().tolist(), origin="sampled", description=desc[:200], seed=seed,
                  sources=report.sources)
    engine.voices.save(voice)
    progress(f"Made “{name}” from {len(pick)} speakers", 1.0)
    return voice, report
