"""Translation into other languages, free and on your own computer.

Two free models, both allowed in commercial games:
  * "m2m100" (default): Meta's M2M100 418M, MIT license, 100 languages,
    ~2 GB download, runs on an ordinary computer.
  * "madlad": Google's MADLAD-400 3B, Apache 2.0 license, 400+ languages,
    ~12 GB download; slower, wants a strong computer or GPU.
Both download once from Hugging Face the first time they're used
(pip install transformers sentencepiece).

Script markup survives translation: [breath], [pause] and similar tags stay
where they were, and [warm]...[/warm] style spans keep wrapping their
(translated) words. *emphasis* can't be mapped onto words in another
language, so it is dropped. Every translation is kept in a cache, so a line
is only translated once.

Speaking a translation well needs training data in that language (see the
README); translating the text needs nothing more.
"""
from __future__ import annotations

import hashlib
import re
import sqlite3
import threading
from pathlib import Path

M2M100_LANGUAGES = {
    "af": "Afrikaans", "am": "Amharic", "ar": "Arabic", "ast": "Asturian", "az": "Azerbaijani", "ba": "Bashkir",
    "be": "Belarusian", "bg": "Bulgarian", "bn": "Bengali", "br": "Breton", "bs": "Bosnian", "ca": "Catalan",
    "ceb": "Cebuano", "cs": "Czech", "cy": "Welsh", "da": "Danish", "de": "German", "el": "Greek", "en": "English",
    "es": "Spanish", "et": "Estonian", "fa": "Persian", "ff": "Fulah", "fi": "Finnish", "fr": "French",
    "fy": "Western Frisian", "ga": "Irish", "gd": "Scottish Gaelic", "gl": "Galician", "gu": "Gujarati", "ha": "Hausa",
    "he": "Hebrew", "hi": "Hindi", "hr": "Croatian", "ht": "Haitian Creole", "hu": "Hungarian", "hy": "Armenian",
    "id": "Indonesian", "ig": "Igbo", "ilo": "Ilocano", "is": "Icelandic", "it": "Italian", "ja": "Japanese",
    "jv": "Javanese", "ka": "Georgian", "kk": "Kazakh", "km": "Khmer", "kn": "Kannada", "ko": "Korean",
    "lb": "Luxembourgish", "lg": "Ganda", "ln": "Lingala", "lo": "Lao", "lt": "Lithuanian", "lv": "Latvian",
    "mg": "Malagasy", "mk": "Macedonian", "ml": "Malayalam", "mn": "Mongolian", "mr": "Marathi", "ms": "Malay",
    "my": "Burmese", "ne": "Nepali", "nl": "Dutch", "no": "Norwegian", "ns": "Northern Sotho", "oc": "Occitan",
    "or": "Odia", "pa": "Punjabi", "pl": "Polish", "ps": "Pashto", "pt": "Portuguese", "ro": "Romanian",
    "ru": "Russian", "sd": "Sindhi", "si": "Sinhala", "sk": "Slovak", "sl": "Slovenian", "so": "Somali",
    "sq": "Albanian", "sr": "Serbian", "ss": "Swati", "su": "Sundanese", "sv": "Swedish", "sw": "Swahili",
    "ta": "Tamil", "th": "Thai", "tl": "Tagalog", "tn": "Tswana", "tr": "Turkish", "uk": "Ukrainian", "ur": "Urdu",
    "uz": "Uzbek", "vi": "Vietnamese", "wo": "Wolof", "xh": "Xhosa", "yi": "Yiddish", "yo": "Yoruba",
    "zh": "Chinese", "zu": "Zulu",
}
BACKENDS = {
    "m2m100": {"model": "facebook/m2m100_418M", "license": "MIT", "languages": 100},
    "madlad": {"model": "google/madlad400-3b-mt", "license": "Apache 2.0", "languages": 400},
}
_TAG = re.compile(r"(\[[^\]]{1,40}\])")
_SENT = re.compile(r"(?<=[.!?…])\s+")


class Translator:
    def __init__(self, backend: str = "m2m100", cache_path: str | Path | None = None, device: str = "cpu",
                 engine_fn=None):
        """engine_fn(texts, src, tgt) -> list[str] replaces the model (used in tests)."""
        if backend not in BACKENDS and engine_fn is None:
            raise ValueError(f"Unknown translation backend '{backend}'. Use {', '.join(BACKENDS)}.")
        self.backend, self.device, self._fn = backend, device, engine_fn
        self._model = self._tok = None
        self._lock = threading.Lock()
        self._db = None
        if cache_path:
            Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
            self._db = sqlite3.connect(str(cache_path), check_same_thread=False)
            self._db.execute("CREATE TABLE IF NOT EXISTS t(k TEXT PRIMARY KEY, text TEXT)")

    # ------------------------------------------------------------- languages
    def languages(self) -> list[dict]:
        if self.backend == "madlad" and self._tok is not None:
            codes = sorted({t[2:-1] for t in self._tok.get_vocab() if re.fullmatch(r"<2[a-zA-Z_\-]+>", t)})
            return [{"code": c, "name": M2M100_LANGUAGES.get(c, c)} for c in codes]
        return [{"code": c, "name": n} for c, n in sorted(M2M100_LANGUAGES.items(), key=lambda x: x[1])]

    def supports(self, code: str) -> bool:
        return self.backend == "madlad" or code in M2M100_LANGUAGES

    # --------------------------------------------------------------- loading
    def _load(self):
        if self._model is not None or self._fn is not None:
            return
        try:
            import transformers  # noqa: F401
        except ImportError as e:
            raise RuntimeError("Translation needs two free packages: pip install transformers sentencepiece") from e
        name = BACKENDS[self.backend]["model"]
        try:
            if self.backend == "m2m100":
                from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
                self._tok = M2M100Tokenizer.from_pretrained(name)
                self._model = M2M100ForConditionalGeneration.from_pretrained(name).to(self.device).eval()
            else:
                from transformers import T5ForConditionalGeneration, T5Tokenizer
                self._tok = T5Tokenizer.from_pretrained(name)
                self._model = T5ForConditionalGeneration.from_pretrained(name).to(self.device).eval()
        except Exception as e:
            self._tok = self._model = None
            raise RuntimeError(f"Couldn't load the translation model ({name}). The first use downloads it free "
                               f"from Hugging Face, so the computer needs internet once. ({type(e).__name__})") from e

    def _run(self, texts: list[str], src: str, tgt: str) -> list[str]:
        if self._fn is not None:
            return self._fn(texts, src, tgt)
        import torch
        self._load()
        with torch.no_grad():
            if self.backend == "m2m100":
                self._tok.src_lang = src
                enc = self._tok(texts, return_tensors="pt", padding=True).to(self.device)
                out = self._model.generate(**enc, forced_bos_token_id=self._tok.get_lang_id(tgt), max_new_tokens=256)
            else:
                enc = self._tok([f"<2{tgt}> {t}" for t in texts], return_tensors="pt", padding=True).to(self.device)
                out = self._model.generate(**enc, max_new_tokens=256)
        return self._tok.batch_decode(out, skip_special_tokens=True)

    # -------------------------------------------------------------- translate
    def translate(self, text: str, to: str, src: str = "en") -> str:
        """Translate a line of game dialogue, keeping its markup."""
        if not to or to == src:
            return text
        if not self.supports(to):
            raise ValueError(f"'{to}' is not one of the {self.backend} languages.")
        key = hashlib.sha256(f"{self.backend}|{src}|{to}|{text}".encode()).hexdigest()
        if self._db is not None:
            r = self._db.execute("SELECT text FROM t WHERE k=?", (key,)).fetchone()
            if r:
                return r[0]
        pieces = _TAG.split(text.replace("*", ""))
        jobs: list[tuple[int, int, str]] = []          # (piece, sentence, text)
        split_pieces: list[list[str]] = []
        for i, p in enumerate(pieces):
            if _TAG.fullmatch(p) or not p.strip():
                split_pieces.append([p])
                continue
            lead, core, trail = re.match(r"(\s*)(.*?)(\s*)$", p, re.S).groups()
            sents = [s for s in _SENT.split(core) if s.strip()]
            split_pieces.append([lead] + sents + [trail])
            for j, s in enumerate(sents):
                jobs.append((i, j + 1, s))
        with self._lock:
            done = self._run([s for _, _, s in jobs], src, to) if jobs else []
        for (i, j, _), t in zip(jobs, done):
            split_pieces[i][j] = t.strip()
        out = []
        for parts in split_pieces:
            if len(parts) == 1:
                out.append(parts[0])
            else:
                out.append(parts[0] + " ".join(parts[1:-1]) + parts[-1])
        result = re.sub(r"[ \t]+", " ", "".join(out)).strip()
        if self._db is not None:
            with self._lock:
                self._db.execute("INSERT OR REPLACE INTO t VALUES(?,?)", (key, result))
                self._db.commit()
        return result
