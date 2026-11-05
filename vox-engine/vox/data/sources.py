"""Where training audio comes from, and the license gate that keeps it legal.

You describe sources in a YAML file (see examples/sources.yaml). Every source
must declare a license. The gate accepts only licenses that allow commercial
use (so you can sell a game that uses the voices) unless the project is marked
non-commercial. "Scanning online audio and video" is supported through free,
openly licensed archives (Internet Archive, LibriVox, Hugging Face datasets)
and through yt-dlp for individual videos whose license you can verify.

Nothing here needs an API key or a paid account.
"""
from __future__ import annotations

import json
import re
import subprocess
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

from ..config import COMMERCIAL_SAFE_LICENSES, NONCOMMERCIAL_LICENSES

AUDIO_EXT = {".wav", ".flac", ".mp3", ".ogg", ".m4a", ".opus"}
UA = {"User-Agent": "vox-engine-data-pipeline/1.0 (open-source TTS research)"}


@dataclass
class RawItem:
    """One audio file plus whatever we know about it."""
    path: Path
    source: str
    license: str
    speaker: str
    text: str | None = None            # transcript, if the source has one
    emotion: str | None = None         # label, if the source has one
    attribution: str = ""


@dataclass
class Source:
    name: str
    kind: str                          # local | ljspeech | crema_d | internet_archive | librivox | huggingface | media_url
    license: str
    attribution: str = ""
    options: dict = field(default_factory=dict)


class LicenseError(Exception):
    pass


def normalize_license(s: str) -> str:
    s = s.strip().lower()
    if "publicdomain/zero" in s or s in ("cc0", "cc0-1.0"):
        return "cc0"
    if "publicdomain" in s or "public domain" in s or s == "pd":
        return "public-domain"
    m = re.search(r"licenses/(by(?:-nc)?(?:-sa)?(?:-nd)?)/(\d\.\d)", s)
    if m:
        return f"cc-{m.group(1)}-{m.group(2)}"
    return s.replace(" ", "-")


def check_license(lic: str, noncommercial_project: bool) -> None:
    lic = normalize_license(lic)
    if lic in COMMERCIAL_SAFE_LICENSES:
        return
    if lic in NONCOMMERCIAL_LICENSES:
        if noncommercial_project:
            return
        raise LicenseError(f"License '{lic}' forbids commercial use. Set noncommercial_project: true "
                           "only if you will never sell anything trained on it.")
    if "-nd-" in lic or lic.endswith("-nd"):
        raise LicenseError(f"License '{lic}' forbids derivatives; a trained voice model is one.")
    raise LicenseError(f"License '{lic}' is unknown or not permitted. Allowed: "
                       f"{', '.join(sorted(COMMERCIAL_SAFE_LICENSES))}")


def load_sources(yaml_path: str | Path) -> tuple[list[Source], dict]:
    """Read a source list: .yaml/.yml (needs PyYAML) or .json (always works)."""
    path = Path(yaml_path)
    if path.suffix.lower() == ".json":
        doc = json.loads(path.read_text())
    else:
        try:
            import yaml
        except ImportError as e:
            raise SystemExit("Reading .yaml needs PyYAML (pip install pyyaml), which has no ready-made build for "
                             "the newest Python yet. Use examples/sources.json instead: same settings, JSON format.") from e
        doc = yaml.safe_load(path.read_text())
    srcs = [Source(name=s["name"], kind=s["kind"], license=s["license"],
                   attribution=s.get("attribution", ""),
                   options={k: v for k, v in s.items() if k not in ("name", "kind", "license", "attribution")})
            for s in doc.get("sources", [])]
    return srcs, doc.get("project", {})


# ------------------------------------------------------------------ fetchers
def iter_source(src: Source, download_dir: Path, noncommercial: bool) -> Iterator[RawItem]:
    check_license(src.license, noncommercial)
    fn = {"local": _local, "ljspeech": _ljspeech, "crema_d": _crema_d, "internet_archive": _internet_archive,
          "librivox": _librivox, "huggingface": _huggingface, "media_url": _media_url}.get(src.kind)
    if fn is None:
        raise ValueError(f"Unknown source kind '{src.kind}'")
    yield from fn(src, download_dir / src.name, noncommercial)


def _local(src: Source, _dl: Path, _nc) -> Iterator[RawItem]:
    """A folder of recordings: <root>/<speaker>/<file>.wav with optional
    <file>.txt transcript and <file>.emotion label next to each file.
    Ideal for your own voice actors' recordings (license: own-recording or consented)."""
    root = Path(src.options["path"]).expanduser()
    for f in sorted(root.rglob("*")):
        if f.suffix.lower() not in AUDIO_EXT:
            continue
        txt = f.with_suffix(".txt")
        emo = f.with_suffix(".emotion")
        speaker = f.parent.name if f.parent != root else src.options.get("speaker", src.name)
        yield RawItem(f, src.name, normalize_license(src.license), f"{src.name}:{speaker}",
                      txt.read_text().strip() if txt.exists() else None,
                      emo.read_text().strip() if emo.exists() else src.options.get("emotion"),
                      src.attribution)


CREMA_SENTENCES = {
    "IEO": "It's eleven o'clock.", "TIE": "That is exactly what happened.",
    "IOM": "I'm on my way to the meeting.", "IWW": "I wonder what this is about.",
    "TAI": "The airplane is almost full.", "MTI": "Maybe tomorrow it will be cold.",
    "IWL": "I would like a new alarm clock.", "ITH": "I think I have a doctor's appointment.",
    "DFA": "Don't forget a jacket.", "ITS": "I think I've seen this before.",
    "TSI": "The surface is slick.", "WSI": "We'll stop in a couple of minutes.",
}
CREMA_EMOTIONS = {"ANG": "angry", "DIS": "disgusted", "FEA": "fearful", "HAP": "happy",
                  "NEU": "neutral", "SAD": "sad"}


def _crema_d(src: Source, _dl: Path, _nc) -> Iterator[RawItem]:
    """CREMA-D emotional speech (91 actors, 6 emotions, ODbL). Point `path` at
    its AudioWAV folder. Labels come from file names like 1001_DFA_ANG_XX.wav;
    these real labels train the emotion classifier that pseudo-labels the rest."""
    root = Path(src.options["path"]).expanduser()
    for f in sorted(root.glob("*.wav")):
        parts = f.stem.split("_")
        if len(parts) < 3 or parts[1] not in CREMA_SENTENCES or parts[2] not in CREMA_EMOTIONS:
            continue
        yield RawItem(f, src.name, normalize_license(src.license), f"crema:{parts[0]}",
                      CREMA_SENTENCES[parts[1]], CREMA_EMOTIONS[parts[2]], src.attribution)


def _ljspeech(src: Source, _dl: Path, _nc) -> Iterator[RawItem]:
    """LJSpeech-style folder: metadata.csv lines 'id|text|normalized text' and wavs/<id>.wav.
    Works for LJSpeech (public domain) and many community datasets."""
    root = Path(src.options["path"]).expanduser()
    speaker = src.options.get("speaker", src.name)
    for line in (root / "metadata.csv").read_text(encoding="utf-8").splitlines():
        parts = line.split("|")
        if len(parts) < 2:
            continue
        wav = root / "wavs" / f"{parts[0]}.wav"
        if wav.exists():
            yield RawItem(wav, src.name, normalize_license(src.license), f"{src.name}:{speaker}",
                          parts[-1].strip(), None, src.attribution)


def _http_json(url: str) -> dict:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.loads(r.read().decode())


def _download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
            dest.write_bytes(r.read())
    return dest


def _internet_archive(src: Source, dl: Path, nc) -> Iterator[RawItem]:
    """Search archive.org for audio/video that carries a public-domain or
    Creative Commons license, then download the audio. Each item's own license
    is re-checked, so mislabeled uploads are skipped automatically.

    options: query (e.g. 'radio drama'), max_items (default 50), mediatype (audio|movies)
    """
    q = f'({src.options.get("query", "speech")}) AND mediatype:{src.options.get("mediatype", "audio")} ' \
        f'AND (licenseurl:*publicdomain* OR licenseurl:*creativecommons.org/licenses/by/*)'
    url = "https://archive.org/advancedsearch.php?" + urllib.parse.urlencode(
        {"q": q, "fl[]": ["identifier", "licenseurl", "title", "creator"],
         "rows": src.options.get("max_items", 50), "output": "json"}, doseq=True)
    for doc in _http_json(url)["response"]["docs"]:
        lic = normalize_license(doc.get("licenseurl", ""))
        try:
            check_license(lic, nc)
        except LicenseError:
            continue
        ident = doc["identifier"]
        meta = _http_json(f"https://archive.org/metadata/{ident}")
        for f in meta.get("files", []):
            name = f.get("name", "")
            if Path(name).suffix.lower() in (".mp3", ".flac", ".ogg", ".wav", ".mp4", ".ogv") \
                    and f.get("source") == "original":
                path = _download(f"https://archive.org/download/{ident}/{urllib.parse.quote(name)}",
                                 dl / ident / Path(name).name)
                creator = doc.get("creator", "unknown")
                yield RawItem(path, src.name, lic, f"ia:{ident}", None, None,
                              f'"{doc.get("title", ident)}" by {creator}, archive.org/details/{ident} ({lic})')


def _librivox(src: Source, dl: Path, _nc) -> Iterator[RawItem]:
    """LibriVox: thousands of hours of public-domain audiobooks read by volunteers.
    options: max_books (default 10), language (default English)"""
    url = "https://librivox.org/api/feed/audiobooks?" + urllib.parse.urlencode(
        {"format": "json", "limit": src.options.get("max_books", 10), "extended": 1})
    for book in _http_json(url).get("books", []):
        if book.get("language", "English") != src.options.get("language", "English"):
            continue
        for sec in book.get("sections", [])[: src.options.get("max_sections", 5)]:
            mp3 = sec.get("listen_url")
            if not mp3:
                continue
            path = _download(mp3, dl / str(book["id"]) / f'{sec.get("section_number", 0)}.mp3')
            reader = (sec.get("readers") or [{}])[0].get("display_name", "unknown")
            yield RawItem(path, src.name, "public-domain", f"librivox:{reader}", None, None,
                          f'LibriVox recording of "{book.get("title")}", read by {reader} (public domain)')


def _huggingface(src: Source, dl: Path, _nc) -> Iterator[RawItem]:
    """Any Hugging Face audio dataset (free download, no key needed for public ones).
    options: dataset, config, split, audio_column, text_column, speaker_column,
    emotion_column, max_items. Example: LibriTTS-R (CC BY 4.0)."""
    from datasets import load_dataset   # pip install datasets  (free)
    import soundfile as sf
    o = src.options
    ds = load_dataset(o["dataset"], o.get("config"), split=o.get("split", "train"), streaming=True)
    dl.mkdir(parents=True, exist_ok=True)
    for i, row in enumerate(ds):
        if i >= o.get("max_items", 10 ** 9):
            break
        a = row[o.get("audio_column", "audio")]
        path = dl / f"{i:08d}.wav"
        if not path.exists():
            sf.write(str(path), a["array"], a["sampling_rate"])
        spk = str(row.get(o.get("speaker_column", "speaker_id"), src.name))
        emo = row.get(o["emotion_column"]) if o.get("emotion_column") else None
        yield RawItem(path, src.name, normalize_license(src.license), f"{src.name}:{spk}",
                      row.get(o.get("text_column", "text")), emo, src.attribution)


def _media_url(src: Source, dl: Path, nc) -> Iterator[RawItem]:
    """Individual online videos/audio via yt-dlp (free). The platform's own
    license metadata is checked; a video without a Creative Commons license is
    skipped unless you declared it as your own recording or consented material.

    options: urls (list)
    """
    declared = normalize_license(src.license)
    dl.mkdir(parents=True, exist_ok=True)
    for url in src.options.get("urls", []):
        info = json.loads(subprocess.run(["yt-dlp", "-J", "--no-playlist", url], capture_output=True,
                                         text=True, check=True).stdout)
        platform_lic = (info.get("license") or "").lower()
        if declared not in ("own-recording", "consented"):
            if "creative commons" not in platform_lic and "public domain" not in platform_lic:
                print(f"  skip {url}: platform shows no open license ({platform_lic or 'none'})")
                continue
        out = dl / f'{info["id"]}.wav'
        if not out.exists():
            subprocess.run(["yt-dlp", "-x", "--audio-format", "wav", "-o", str(dl / "%(id)s.%(ext)s"), url],
                           check=True, capture_output=True)
        yield RawItem(out, src.name, declared, f"{src.name}:{info.get('channel', info['id'])}",
                      None, None, f'"{info.get("title")}" by {info.get("uploader")} ({url}), {platform_lic or declared}')
