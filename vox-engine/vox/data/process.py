"""The hybrid data pipeline: raw audio in, clean labeled training clips out.

Stages:
  1. license gate (sources.py)
  2. decode + resample to 24 kHz mono
  3. split long recordings at natural pauses into 2-15 s clips (voice activity)
  4. quality filter: noise level, clipping, bandwidth (rejects phone-quality)
  5. de-duplicate (audio fingerprint)
  6. transcribe with Whisper if no transcript (free, local; optional)
  7. auto-label delivery: pauses, breaths, emphasis, question rise/fall,
     pitch/energy/rate stats; these become the markup tokens the model learns
  8. speaker-relative prosody (so "fast" means fast *for that speaker*)
  9. vocabulary + coverage report, attribution file for CC-BY sources

Labeled emotion data, pseudo-labeled data (see train.pseudo_label_emotions)
and filtered synthetic data (augment.py) are merged into one manifest: that
mix is what "hybrid" means here.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from ..audio import (frame_energy_db, load_audio, normalize_loudness, save_audio,
                     semitones, track_pitch)
from ..config import EMOTIONS, VoxConfig
from ..text import normalize, words_of
from .sources import LicenseError, RawItem, iter_source, load_sources


@dataclass
class QualityLimits:
    min_secs: float = 1.5
    max_secs: float = 15.0
    min_snr_db: float = 20.0
    max_clip_ratio: float = 0.001
    min_bandwidth_hz: float = 7000.0


@dataclass
class Clip:
    id: str
    wav: str
    text: str                 # transcript with auto-labeled markup
    plain_text: str
    speaker: str
    emotion: str | None
    emotion_source: str       # "label" | "pseudo" | "none" | "synthetic"
    secs: float
    f0_median_hz: float
    f0_range_st: float
    energy_db: float
    chars_per_sec: float
    brightness: float
    roughness: float
    breathiness: float
    snr_db: float
    source: str
    license: str
    attribution: str
    prosody: list[float] | None = None   # filled in by speaker normalization


# ------------------------------------------------------------- segmentation
def segment(wav: np.ndarray, sr: int, limits: QualityLimits, hop: int = 240):
    """Energy-based voice activity detection; cut at the quietest gaps so
    clips start and end at natural pauses. Returns list of (start, end) samples."""
    e = frame_energy_db(wav, hop, 960)
    floor = np.percentile(e, 10)
    speech = e > floor + 12
    # fill short gaps (< 0.3 s) so words aren't split
    gap = int(0.3 * sr / hop)
    idx = np.flatnonzero(speech)
    if len(idx) == 0:
        return []
    regions, start, prev = [], idx[0], idx[0]
    for i in idx[1:]:
        if i - prev > gap:
            regions.append((start, prev + 1)); start = i
        prev = i
    regions.append((start, prev + 1))
    # merge regions into clips up to max_secs
    max_f, min_f = int(limits.max_secs * sr / hop), int(limits.min_secs * sr / hop)
    clips, cur = [], None
    for a, b in regions:
        if cur is None:
            cur = [a, b]
        elif b - cur[0] <= max_f:
            cur[1] = b
        else:
            clips.append(tuple(cur)); cur = [a, b]
    if cur:
        clips.append(tuple(cur))
    pad = int(0.12 * sr / hop)
    out = []
    for a, b in clips:
        if b - a < min_f:
            continue
        if b - a > max_f:       # one long unbroken region: hard split
            for s in range(a, b, max_f):
                if min(b, s + max_f) - s >= min_f:
                    out.append((s * hop, min(b, s + max_f) * hop))
            continue
        out.append((max(0, a - pad) * hop, min(len(e), b + pad) * hop))
    return out


# ------------------------------------------------------------------ quality
def quality(wav: np.ndarray, sr: int) -> dict:
    e = frame_energy_db(wav, 240, 960)
    snr = float(np.percentile(e, 90) - np.percentile(e, 10))
    clip = float(np.mean(np.abs(wav) > 0.999))
    spec = np.abs(np.fft.rfft(wav * np.hanning(len(wav)))) ** 2
    freqs = np.fft.rfftfreq(len(wav), 1 / sr)
    cum = np.cumsum(spec) / (spec.sum() + 1e-12)
    bandwidth = float(freqs[np.searchsorted(cum, 0.995)])
    centroid = float((freqs * spec).sum() / (spec.sum() + 1e-12))
    flatness = float(np.exp(np.mean(np.log(spec + 1e-12))) / (np.mean(spec) + 1e-12))
    hf = float(spec[freqs > 4000].sum() / (spec[freqs <= 4000].sum() + 1e-12))
    return {"snr_db": snr, "clip_ratio": clip, "bandwidth_hz": bandwidth,
            "brightness": centroid, "roughness": flatness, "breathiness": hf}


def fingerprint(wav: np.ndarray, sr: int = 24000) -> str:
    """Coarse time x frequency energy map. Re-uploads of the same recording
    collide; the same sentence from a different speaker does not."""
    rows = []
    for seg in np.array_split(wav, 16):
        if len(seg) < 64:
            rows.append(np.zeros(12)); continue
        spec = np.abs(np.fft.rfft(seg)) ** 2
        f = np.fft.rfftfreq(len(seg), 1 / sr)
        edges = np.geomspace(80, sr / 2, 13)
        rows.append([spec[(f >= a) & (f < b)].sum() for a, b in zip(edges[:-1], edges[1:])])
    m = np.log10(np.array(rows) + 1e-9)
    q = np.round((m - m.max()) / 1.5).astype(np.int8)     # ~15 dB steps
    return hashlib.md5(q.tobytes() + str(len(wav) // 4800).encode()).hexdigest()


# ------------------------------------------------------------ transcription
class Transcriber:
    """Uses faster-whisper or openai-whisper if installed (both free, run locally).
    Returns (text, [(word, start_s, end_s), ...])."""

    def __init__(self, model_size: str = "small"):
        self.kind, self.model = None, None
        try:
            from faster_whisper import WhisperModel
            self.model = WhisperModel(model_size, compute_type="int8"); self.kind = "faster"
        except ImportError:
            try:
                import whisper
                self.model = whisper.load_model(model_size); self.kind = "openai"
            except ImportError:
                pass

    @property
    def available(self) -> bool:
        return self.model is not None

    def __call__(self, wav: np.ndarray, sr: int):
        from ..audio import resample
        x = resample(wav, sr, 16000) if sr != 16000 else wav
        if self.kind == "faster":
            segs, _ = self.model.transcribe(x, word_timestamps=True)
            words = [(w.word.strip(), w.start, w.end) for s in segs for w in (s.words or [])]
        else:
            r = self.model.transcribe(x, word_timestamps=True)
            words = [(w["word"].strip(), w["start"], w["end"]) for s in r["segments"] for w in s.get("words", [])]
        return " ".join(w for w, _, _ in words), words


# ----------------------------------------------------------- auto-labeling
def label_delivery(wav: np.ndarray, sr: int, words: list[tuple[str, float, float]] | None,
                   text: str, hop: int = 240) -> tuple[str, dict]:
    """Return the transcript with delivery markup + prosody stats.

    With word timings we can mark pauses, breaths, emphasized words and the
    pitch movement on the final word. Without timings we still get stats.
    """
    f0 = track_pitch(wav, sr, hop)
    en = frame_energy_db(wav, hop)
    voiced = f0 > 0
    med = float(np.median(f0[voiced])) if voiced.sum() > 10 else 0.0
    st = semitones(f0, med) if med else np.zeros_like(f0)
    stats = {"f0_median_hz": med,
             "f0_range_st": float(np.std(st[voiced])) if voiced.sum() > 10 else 0.0,
             "energy_db": float(np.mean(en[en > np.percentile(en, 30)]))}
    if not words:
        return text, stats

    fps = sr / hop
    floor = np.percentile(en, 10)
    w_st, w_en = [], []
    for _, a, b in words:
        i, j = int(a * fps), max(int(b * fps), int(a * fps) + 1)
        v = voiced[i:j]
        w_st.append(float(np.mean(st[i:j][v])) if v.sum() > 2 else np.nan)
        w_en.append(float(np.mean(en[i:j])))
    w_st, w_en = np.array(w_st), np.array(w_en)
    z_st = (w_st - np.nanmean(w_st)) / (np.nanstd(w_st) + 1e-6)
    z_en = (w_en - w_en.mean()) / (w_en.std() + 1e-6)

    out = []
    for k, (w, a, b) in enumerate(words):
        if k > 0:
            gap = a - words[k - 1][2]
            if gap >= 0.15:
                i, j = int(words[k - 1][2] * fps), int(a * fps)
                g_en, g_v = en[i:j], voiced[i:j]
                if len(g_en) and np.mean(g_en > floor + 6) > 0.4 and np.mean(g_v) < 0.2 and 0.15 <= gap <= 0.9:
                    out.append("[breath]")
                elif gap >= 0.8:
                    out.append("[pause:long]")
                elif gap >= 0.4:
                    out.append("[pause]")
                else:
                    out.append("[pause:short]")
        is_last = k == len(words) - 1
        if is_last and len(words) > 2:
            i, j = int(a * fps), int(b * fps)
            v = voiced[i:j]
            if v.sum() > 4:
                slope = float(np.polyfit(np.arange(v.sum()), st[i:j][v], 1)[0] * v.sum())
                if slope > 2.0:
                    out.append("[rise]")
                elif slope < -2.0 and w.endswith("?"):
                    out.append("[fall]")
        emph = len(words) > 3 and not np.isnan(z_st[k]) and z_st[k] > 1.2 and z_en[k] > 1.0
        out.append(f"*{w}*" if emph else w)
    return " ".join(out), stats


# ---------------------------------------------------------------- pipeline
def build_dataset(sources_yaml: str | Path, out_dir: str | Path, cfg: VoxConfig | None = None,
                  limits: QualityLimits | None = None, whisper_size: str = "small") -> Path:
    cfg = cfg or VoxConfig()
    limits = limits or QualityLimits()
    out = Path(out_dir)
    (out / "wavs").mkdir(parents=True, exist_ok=True)
    sources, project = load_sources(sources_yaml)
    nc = bool(project.get("noncommercial", cfg.noncommercial_project))
    sr = cfg.audio.sample_rate
    asr = Transcriber(whisper_size)
    seen: set[str] = set()
    clips: list[Clip] = []
    report = Counter()
    attributions: set[str] = set()

    for src in sources:
        print(f"[source] {src.name} ({src.kind}, {src.license})")
        try:
            items = list(iter_source(src, out / "downloads", nc))
        except LicenseError as e:
            print(f"  REJECTED: {e}"); report["rejected_sources"] += 1
            continue
        for item in items:
            try:
                wav = _decode(item.path, sr)
            except Exception as e:     # corrupt or unsupported file
                print(f"  skip {item.path.name}: {e}"); report["decode_errors"] += 1
                continue
            spans = [(0, len(wav))] if item.text and len(wav) / sr <= limits.max_secs \
                else segment(wav, sr, limits)
            for n, (a, b) in enumerate(spans):
                seg = wav[a:b]
                clip = _process_clip(seg, sr, item, n, limits, asr, seen, report)
                if clip:
                    save_audio(out / "wavs" / f"{clip.id}.wav", seg, sr)
                    clip.wav = f"wavs/{clip.id}.wav"
                    clips.append(clip)
                    if clip.attribution:
                        attributions.add(clip.attribution)
    speaker_normalize(clips)
    with open(out / "manifest.jsonl", "w") as f:
        for c in clips:
            f.write(json.dumps(asdict(c)) + "\n")
    write_vocabulary(clips, out / "vocabulary.json")
    (out / "ATTRIBUTION.md").write_text(
        "# Training data credits\n\nThis voice model was trained on openly licensed audio:\n\n"
        + "\n".join(f"- {a}" for a in sorted(attributions)) + "\n")
    report["clips"] = len(clips)
    report["hours"] = round(sum(c.secs for c in clips) / 3600, 3)
    (out / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return out / "manifest.jsonl"


def _decode(path: Path, sr: int) -> np.ndarray:
    try:
        return load_audio(path, sr)
    except Exception:
        # video or codec soundfile can't read: convert with ffmpeg (free)
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td) / "a.wav"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-ac", "1",
                            "-ar", str(sr), str(tmp)], check=True)
            return load_audio(tmp, sr)


def _process_clip(seg, sr, item: RawItem, n, limits, asr, seen, report) -> Clip | None:
    secs = len(seg) / sr
    if not (limits.min_secs <= secs <= limits.max_secs):
        report["bad_length"] += 1; return None
    q = quality(seg, sr)
    if q["snr_db"] < limits.min_snr_db:
        report["too_noisy"] += 1; return None
    if q["clip_ratio"] > limits.max_clip_ratio:
        report["clipped"] += 1; return None
    if q["bandwidth_hz"] < limits.min_bandwidth_hz:
        report["low_bandwidth"] += 1; return None
    fp = fingerprint(seg, sr)
    if fp in seen:
        report["duplicate"] += 1; return None
    seen.add(fp)
    seg = normalize_loudness(seg)
    words = None
    text = item.text
    if asr.available:
        asr_text, words = asr(seg, sr)
        if not text:
            text = asr_text
    if not text or len(text.strip()) < 2:
        report["no_transcript"] += 1; return None
    text = normalize(text)
    labeled, stats = label_delivery(seg, sr, words, text)
    cid = hashlib.sha1(f"{item.path}:{n}".encode()).hexdigest()[:16]
    emo = item.emotion if item.emotion in EMOTIONS else None
    return Clip(id=cid, wav="", text=labeled, plain_text=text, speaker=item.speaker, emotion=emo,
                emotion_source="label" if emo else "none", secs=round(secs, 3),
                chars_per_sec=len(text) / secs, snr_db=q["snr_db"], brightness=q["brightness"],
                roughness=q["roughness"], breathiness=q["breathiness"], source=item.source,
                license=item.license, attribution=item.attribution, **stats)


def speaker_normalize(clips: list[Clip]) -> None:
    """Express each clip's delivery relative to its speaker's average, so the
    prosody controls mean the same thing for every voice."""
    by = defaultdict(list)
    for c in clips:
        by[c.speaker].append(c)
    for cs in by.values():
        rate = np.array([c.chars_per_sec for c in cs])
        f0 = np.array([c.f0_median_hz for c in cs])
        rng = np.array([c.f0_range_st for c in cs])
        en = np.array([c.energy_db for c in cs])
        f0_ref = np.median(f0[f0 > 0]) if (f0 > 0).any() else 0
        for c in cs:
            c.prosody = [
                float((c.chars_per_sec - rate.mean()) / (rate.std() + 1e-6)) if len(cs) > 1 else 0.0,
                float(12 * np.log2(c.f0_median_hz / f0_ref)) if c.f0_median_hz > 0 and f0_ref else 0.0,
                float(np.log2((c.f0_range_st + 1e-3) / (np.median(rng) + 1e-3))),
                float(c.energy_db - np.median(en)),
            ]
            c.prosody = [float(np.clip(p, -12, 12)) for p in c.prosody]


# ------------------------------------------------------------- vocabulary
def write_vocabulary(clips: list[Clip], path: Path) -> None:
    """Word list of everything the model has heard, with counts. The coverage
    tool compares your game script against it."""
    counts = Counter(w for c in clips for w in words_of(c.plain_text))
    path.write_text(json.dumps({"total_words": sum(counts.values()), "unique": len(counts),
                                "words": dict(counts.most_common())}, indent=1))


def coverage_report(vocab_json: str | Path, script_lines: list[str], min_count: int = 3) -> dict:
    """Which words in your game script the model has rarely or never heard.
    Those are the ones most likely to be mispronounced (fantasy names!). Record
    a few lines containing them and add them to the dataset."""
    vocab = json.loads(Path(vocab_json).read_text())["words"]
    need = Counter(w for line in script_lines for w in words_of(normalize(line)))
    missing = {w: n for w, n in need.items() if vocab.get(w, 0) == 0}
    rare = {w: vocab[w] for w in need if 0 < vocab.get(w, 0) < min_count}
    covered = 1 - len(missing) / max(len(need), 1)
    return {"script_unique_words": len(need), "coverage": round(covered, 4),
            "never_heard": dict(sorted(missing.items(), key=lambda x: -x[1])),
            "rarely_heard": rare}
