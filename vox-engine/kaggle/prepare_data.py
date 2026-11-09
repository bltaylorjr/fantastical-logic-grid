"""Vox's base training data, prepared on Kaggle (a CPU session: no GPU quota).

Downloads three openly licensed speech corpora, converts every clip to 24 kHz
mono FLAC (what Vox trains on), and writes one manifest per corpus with each
clip's transcript, speaker, license, credit and (where known) dialect:

  LJSpeech 1.1      public domain       ~24 h, one American speaker
  VCTK 0.92         CC BY 4.0           ~44 h, 110 speakers with UK, Irish, Scottish,
                                        Welsh, US, Canadian, Indian, ... accents
  LibriTTS-R        CC BY 4.0           train-clean-100: ~54 h, 247 speakers
    (train-clean-100)

Output (/kaggle/working/vox-data, about 11 GB, kept as this notebook's output
and read by the training notebook):
  lj.jsonl  vctk.jsonl  libritts_r.jsonl   one clip per line
  <corpus>/...flac                         the audio
  CREDITS.md                               what CC BY asks for
  done.json                                hours and clips per corpus

Runs on its own: kaggle/orchestrate.py pushes it once (and again if it fails).
Set VOX_DATA_LIMIT=<clips per corpus> for a quick test.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import shutil
import sys
import tarfile
import time
import urllib.request
import zipfile
from concurrent.futures import ProcessPoolExecutor
from fractions import Fraction
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

OUT = Path(os.environ.get("VOX_DATA_OUT", "/kaggle/working/vox-data"))
TMP = Path(os.environ.get("VOX_DATA_TMP", "/tmp/vox-download"))
LIMIT = int(os.environ.get("VOX_DATA_LIMIT", "0") or 0)
SR = 24000
MIN_SECS, MAX_SECS = 1.0, 15.0
UA = {"User-Agent": "vox-engine-data/1.0 (open-source TTS; Kaggle)"}

CORPORA = {
    "lj": {
        "name": "LJSpeech 1.1", "license": "public-domain",
        "url": "https://data.keithito.com/data/speech/LJSpeech-1.1.tar.bz2",
        "credit": "LJ Speech Dataset by Keith Ito and Linda Johnson (public domain), https://keithito.com/LJ-Speech-Dataset/",
    },
    "vctk": {
        "name": "CSTR VCTK Corpus 0.92", "license": "cc-by-4.0",
        "url": "https://datashare.ed.ac.uk/bitstream/handle/10283/3443/VCTK-Corpus-0.92.zip",
        "credit": "CSTR VCTK Corpus: English Multi-speaker Corpus for CSTR Voice Cloning Toolkit (version 0.92), "
                  "Junichi Yamagishi, Christophe Veaux, Kirsten MacDonald, University of Edinburgh, CSTR, "
                  "https://doi.org/10.7488/ds/2645 , licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). "
                  "Converted to 24 kHz mono FLAC; silence trimmed by the publisher.",
    },
    "libritts_r": {
        "name": "LibriTTS-R train-clean-100", "license": "cc-by-4.0",
        "url": "https://us.openslr.org/resources/141/train_clean_100.tar.gz",
        "credit": "LibriTTS-R: A Restored Multi-Speaker Text-to-Speech Corpus, Y. Koizumi et al. (2023), "
                  "https://www.openslr.org/141/ , licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); "
                  "derived from LibriTTS (H. Zen et al., CC BY 4.0) and LibriVox recordings (public domain). "
                  "Converted to 24 kHz mono FLAC.",
    },
}

for _k, _c in CORPORA.items():                      # VOX_URL_LJ=... to use a copy (tests, mirrors)
    _c["url"] = os.environ.get(f"VOX_URL_{_k.upper()}", _c["url"])

# VCTK's speaker-info accents -> Vox dialect ids (vox/dialects.py)
VCTK_ACCENTS = {
    "english": "british_rp", "scottish": "scottish", "northernirish": "irish", "irish": "irish",
    "welsh": "welsh", "american": "general_american", "canadian": "canadian", "australian": "australian",
    "newzealand": "new_zealand", "southafrican": "south_african", "indian": "indian",
}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def to_24k(src: str | bytes, dst: Path) -> float | None:
    """Read audio, mono 24 kHz, write FLAC; return seconds (None if out of range)."""
    wav, sr = sf.read(io.BytesIO(src) if isinstance(src, bytes) else src, dtype="float32", always_2d=True)
    wav = wav.mean(axis=1)
    if sr != SR:
        f = Fraction(SR, sr).limit_denominator(1000)
        wav = resample_poly(wav, f.numerator, f.denominator).astype(np.float32)
    secs = len(wav) / SR
    if not (MIN_SECS <= secs <= MAX_SECS):
        return None
    peak = float(np.abs(wav).max()) or 1.0
    if peak > 0.99:
        wav = wav * (0.99 / peak)
    dst.parent.mkdir(parents=True, exist_ok=True)
    sf.write(dst, wav, SR, format="FLAC", subtype="PCM_16")
    return round(secs, 3)


_ZIP = None


def _open_zip(path):
    global _ZIP
    _ZIP = zipfile.ZipFile(path) if path else None


def _job(args):
    src, dst, row = args
    try:
        if isinstance(src, tuple):                           # ("zip", member): read inside the worker
            src = _ZIP.read(src[1])
        secs = to_24k(src, OUT / dst)
        if isinstance(args[0], str) and args[0].startswith(str(TMP)):
            os.unlink(args[0])                               # the raw copy is no longer needed
    except Exception as e:                                   # a damaged file: skip it
        return None, f"{dst}: {e}"
    if secs is None:
        return None, None
    return {**row, "wav": dst, "secs": secs}, None


def stream(url: str):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=600)


def download(url: str, dest: Path) -> Path:
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    with stream(url) as r, open(part, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 22)
    part.replace(dest)
    return dest


def write_manifest(key: str, rows: list[dict]) -> dict:
    meta = CORPORA[key]
    with open(OUT / f"{key}.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps({**r, "license": meta["license"], "source": meta["name"]}) + "\n")
    hours = sum(r["secs"] for r in rows) / 3600
    log(f"{meta['name']}: {len(rows)} clips, {hours:.1f} h")
    return {"clips": len(rows), "hours": round(hours, 2), "speakers": len({r["speaker"] for r in rows})}


def convert(jobs, zip_path: str | None = None) -> list[dict]:
    rows, errors = [], 0
    with ProcessPoolExecutor(max(1, os.cpu_count() or 2), initializer=_open_zip, initargs=(zip_path,)) as ex:
        for i, (row, err) in enumerate(ex.map(_job, jobs, chunksize=32)):
            if row:
                rows.append(row)
            if err:
                errors += 1
            if i % 2000 == 0:
                log(f"  {i} files, {len(rows)} kept")
    if errors:
        log(f"  skipped {errors} files that couldn't be read")
    return rows


def norm_text(t: str) -> str:
    return re.sub(r"\s+", " ", t).strip()


# ---------------------------------------------------------------- the corpora
def _tar_corpus(key: str, mode: str, text_of, row_for) -> list[dict]:
    """Stream a tar from the server: each audio file goes to a temporary file,
    and every few thousand (once their transcripts are known) are converted and
    deleted, so neither memory nor disk fills up.
    text_of(member_name, data) -> {clip id: text} for transcript files, else None.
    row_for(clip id) -> (destination, row)."""
    raw = TMP / key
    raw.mkdir(parents=True, exist_ok=True)
    texts, waiting, rows, n = {}, {}, [], 0

    def flush(force=False):
        ready = [k for k in waiting if k in texts]
        if not ready or (len(ready) < 3000 and not force):
            return
        jobs = []
        for k in ready:
            dst, row = row_for(k)
            jobs.append((str(waiting.pop(k)), dst, {**row, "text": texts[k]}))
        rows.extend(convert(jobs))

    with stream(CORPORA[key]["url"]) as r, tarfile.open(fileobj=r, mode=mode) as tar:
        for m in tar:
            if not m.isfile():
                continue
            if m.name.endswith(".wav"):
                k = Path(m.name).stem
                p = raw / f"{k}.wav"
                with open(p, "wb") as f:
                    shutil.copyfileobj(tar.extractfile(m), f, 1 << 20)
                waiting[k] = p
                n += 1
                if LIMIT and n >= LIMIT:
                    break
            else:
                t = text_of(m.name, tar.extractfile(m).read())
                if t:
                    texts.update(t)
            flush()
    flush(force=True)
    shutil.rmtree(raw, ignore_errors=True)
    return rows


def lj() -> dict:
    def text_of(name, data):
        if not name.endswith("metadata.csv"):
            return None
        out = {}
        for line in data.decode("utf-8").splitlines():
            p = line.split("|")
            if len(p) >= 3:
                out[p[0]] = norm_text(p[2])
        return out
    row = {"speaker": "lj:lj", "language": "en", "dialect": "general_american", "attribution": CORPORA["lj"]["credit"]}
    return write_manifest("lj", _tar_corpus("lj", "r|bz2", text_of, lambda k: (f"lj/{k}.flac", row)))


def vctk() -> dict:
    zpath = download(CORPORA["vctk"]["url"], TMP / "vctk.zip")
    z = zipfile.ZipFile(zpath)
    names = z.namelist()
    info = {}
    spk_file = next((n for n in names if n.endswith("speaker-info.txt")), None)
    if spk_file:
        for line in z.read(spk_file).decode("utf-8", "replace").splitlines()[1:]:
            p = line.split()
            if len(p) >= 4:
                info[p[0]] = {"age": p[1], "gender": p[2], "accent": p[3]}
    texts = {Path(n).stem: n for n in names if "/txt/" in n and n.endswith(".txt")}
    jobs = []
    for n in names:
        if not (n.endswith("_mic1.flac") and "wav48_silence_trimmed" in n):
            continue
        clip = Path(n).stem.replace("_mic1", "")
        if clip not in texts:
            continue
        spk = clip.split("_")[0]
        i = info.get(spk, {})
        text = norm_text(z.read(texts[clip]).decode("utf-8", "replace"))
        row = {"text": text, "speaker": f"vctk:{spk}", "language": "en",
               "dialect": VCTK_ACCENTS.get(i.get("accent", "").lower().replace(" ", "")),
               "age": int(i["age"]) if i.get("age", "").isdigit() else None,
               "sex": {"F": "female", "M": "male"}.get(i.get("gender", "")), "attribution": CORPORA["vctk"]["credit"]}
        jobs.append((("zip", n), f"vctk/{spk}/{clip}.flac", row))
        if LIMIT and len(jobs) >= LIMIT:
            break
    z.close()
    rows = convert(jobs, str(zpath))
    zpath.unlink(missing_ok=True)
    return write_manifest("vctk", rows)


def libritts_r() -> dict:
    def text_of(name, data):
        if name.endswith(".normalized.txt"):
            return {Path(name).name.replace(".normalized.txt", ""): norm_text(data.decode("utf-8", "replace"))}
        return None

    def row_for(k):
        spk = k.split("_")[0]
        return f"libritts_r/{spk}/{k}.flac", {"speaker": f"libritts:{spk}", "language": "en",
                                               "attribution": CORPORA["libritts_r"]["credit"]}
    return write_manifest("libritts_r", _tar_corpus("libritts_r", "r|gz", text_of, row_for))


def credits(done: dict) -> None:
    lines = ["# Credits for Vox's base training data", "",
             "Vox's own speech model is trained on these openly licensed recordings.", ""]
    for k, c in CORPORA.items():
        if k in done:
            lines += [f"- **{c['name']}** ({c['license']}): {c['credit']}"]
    (OUT / "CREDITS.md").write_text("\n".join(lines) + "\n")


def main(which: list[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)
    done_file = OUT / "done.json"
    done = json.loads(done_file.read_text()) if done_file.exists() else {}
    for key, fn in (("lj", lj), ("vctk", vctk), ("libritts_r", libritts_r)):
        if key not in which or key in done:
            continue
        log(f"Preparing {CORPORA[key]['name']}")
        try:
            done[key] = fn()
        except Exception as e:                       # one corpus failing doesn't stop the others
            log(f"{CORPORA[key]['name']} failed: {e}")
            continue
        done_file.write_text(json.dumps(done, indent=1))
        credits(done)
    shutil.rmtree(TMP, ignore_errors=True)
    total = sum(d["hours"] for d in done.values())
    log(f"Done: {total:.1f} hours from {len(done)} corpora")
    if not done:
        sys.exit("No corpus could be prepared.")


if __name__ == "__main__":
    main(sys.argv[1:] or list(CORPORA))
