"""VoxEngine: the runtime your game talks to.

    engine = VoxEngine("checkpoints/vox.pt")
    line = engine.speak("Did you hear that? [breath] Something's out there...",
                        voice="old_ranger", emotion="fearful", intensity=0.6)
    line.save("ranger_042.wav")

Long passages stay consistent because:
  1. every chunk uses the same speaker embedding and style vector;
  2. each chunk is generated as a *continuation* of the previous one (the
     previous audio is the prompt), so pitch, pace and energy flow across
     sentence boundaries instead of resetting;
  3. a drift guard measures the speaker similarity of every chunk and
     regenerates any chunk that wanders, re-anchoring on the original voice.
"""
from __future__ import annotations

import hashlib
import json
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

import numpy as np
import torch

import copy
import re

from .audio import load_audio, normalize_loudness, save_audio, to_wav_bytes
from .autotune import autotune as apply_autotune, settings_from
from .config import EMOTIONS
from .model import VoxModel
from .model.style import emotion_vector
from .text import (PAD, SPECIAL_ID, Chunk, encode_text, normalize as normalize_text, parse_script, phonemize_chunk,
                   script_tokens)
from .voices import (ConsentRecord, SpeakerSpace, Voice, VoiceLibrary, cosine,
                     parse_style_prompt, random_voice_name, sha256_bytes)

SILENCE = float(np.log(1e-5))
PAUSE_AFTER = {".": 0.28, "!": 0.30, "?": 0.34, ",": 0.14, ";": 0.2, ":": 0.2}


@dataclass
class SpeechResult:
    wav: np.ndarray
    sample_rate: int
    mel: torch.Tensor                       # (T, n_mels) for editing
    text: str
    style: dict
    seed: int
    segments: list[dict] = field(default_factory=list)  # per-chunk timings (seconds)

    @property
    def duration(self) -> float:
        return len(self.wav) / self.sample_rate

    def save(self, path: str | Path) -> None:
        save_audio(path, self.wav, self.sample_rate)

    def wav_bytes(self) -> bytes:
        return to_wav_bytes(self.wav, self.sample_rate)


class VoxEngine:
    def __init__(self, model: VoxModel | str | Path, voices_dir: str | Path = "voices",
                 cache_dir: str | Path | None = "cache", device: str | None = None):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.ckpt_path = str(model) if isinstance(model, (str, Path)) else None
        self.voice_overrides: dict[str, list[float]] = {}   # temporary embeddings (learning eval)
        self.model = VoxModel.load(model, self.device) if isinstance(model, (str, Path)) else model.to(self.device).eval()
        self.cfg = self.model.cfg
        self.sr = self.cfg.audio.sample_rate
        self.hop = self.cfg.audio.hop_length
        self.voices = VoiceLibrary(voices_dir)
        self.cache_dir = Path(cache_dir) if cache_dir else None
        if self.cache_dir:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
        extras = getattr(self.model, "extras", {})
        self.space = SpeakerSpace(**extras["speaker_space"]) if extras.get("speaker_space") else None
        self._prompt_cache: dict[str, tuple[torch.Tensor, list[int]]] = {}
        self.lexicon: dict[str, str] = {}
        self._lex_re = None
        self._pronouncer = None
        self.translator = None            # set with use_translator(); loads the model on first use
        self.on_retry_pair = None        # learning hook: (text, voice, style, kept_mel, rejected_mel)
        if "narrator" not in self.voices.names():      # a default voice so speak() works at once
            self.design_voice("clear calm narrator", seed=7, name="narrator")
        self._model_id = hashlib.sha1(str(sum(p.sum().item() for p in self.model.dit.out.parameters())).encode()).hexdigest()[:8]

    # ================================================================ speaking
    @torch.inference_mode()
    def speak(self, text: str, voice: str | Voice = "narrator", emotion: str | dict | None = None,
              intensity: float = 1.0, rate: float = 0.0, pitch: float = 0.0, pitch_range: float = 0.0,
              energy: float = 0.0, style_prompt: str | None = None, seed: int | None = None,
              auto_expressions: bool = True, use_cache: bool = True,
              autotune: str | dict | None = None, translate_to: str | None = None,
              language: str | None = None, enunciate: float = 0.0, age: float | None = None,
              sex: str | None = None, dialect: str | None = None, accent: float | None = None,
              register: str | None = None, fluency: float | None = None, simplify: bool | None = None,
              processes: dict | None = None, delivery: str | None = None, sing: dict | None = None) -> SpeechResult:
        """Synthesize a line. All style arguments are optional.

        rate:        -2 (very slow) .. +2 (very fast), relative to the voice's normal pace
        pitch:       semitones up/down from the voice's normal pitch
        pitch_range: -1 (monotone) .. +1 (very expressive)
        energy:      dB louder/softer
        style_prompt: plain words, e.g. "slightly menacing, slow, hushed"
        age, sex:    1 (first words) .. 90; "male"/"female" (development.py)
        dialect:     e.g. "southern_us", "british_rp", "indian" (dialects.py); accent 0..1
        register:    conversational, storytelling, formal, playful, shy, confident, ...
        fluency:     0 (many hesitations) .. 1 (fluent); default by age
        simplify:    say it the way a child of that age would put it (changes words)
        processes:   child sound patterns on or off, e.g. {"gliding": 1.0}
        delivery:    whisper .. scream, laughing, crying, singing, ... (delivery.py)
        sing:        {"notes": "C4 D4 E4"} or {"key": "G", "scale": "major"}
        """
        seed = seed if seed is not None else random.randrange(2 ** 31)
        style = dict(voice=voice if isinstance(voice, str) else voice.name, emotion=emotion,
                     intensity=intensity, rate=rate, pitch=pitch, pitch_range=pitch_range,
                     energy=energy, style_prompt=style_prompt, auto_expressions=auto_expressions,
                     autotune=autotune, translate_to=translate_to, language=language, enunciate=enunciate,
                     age=age, sex=sex, dialect=dialect, accent=accent, register=register, fluency=fluency,
                     simplify=simplify, processes=processes, delivery=delivery, sing=sing, seed=seed)
        key = self._cache_key(text, style, seed)
        if use_cache and self.cache_dir and (self.cache_dir / f"{key}.pt").exists():
            return torch.load(self.cache_dir / f"{key}.pt", weights_only=False)

        mels, segments, t = [], [], 0.0
        text = self.translate_for(text, style)
        for chunk, mel, pause in self._iter_chunks(text, voice, style, seed):
            mels.append(mel)
            dur = mel.shape[0] * self.hop / self.sr
            segments.append({"text": chunk.plain, "start": round(t, 3), "end": round(t + dur, 3)})
            t += dur
            if pause:
                mels.append(torch.full((pause, mel.shape[1]), SILENCE, device=mel.device))
                t += pause * self.hop / self.sr
        full = torch.cat(mels) if mels else torch.full((10, self.cfg.audio.n_mels), SILENCE)
        wav = self.render(full, style)
        res = SpeechResult(wav, self.sr, full.cpu(), text, style, seed, segments)
        if use_cache and self.cache_dir:
            torch.save(res, self.cache_dir / f"{key}.pt")
        return res

    def speak_stream(self, text: str, voice: str | Voice = "narrator", seed: int | None = None,
                     **style_kw) -> Iterator[np.ndarray]:
        """Yield audio chunk by chunk so a game can start playing the first
        sentence while later ones are still being generated (low latency)."""
        seed = seed if seed is not None else random.randrange(2 ** 31)
        style = dict(voice=voice if isinstance(voice, str) else voice.name, emotion=None, intensity=1.0,
                     rate=0.0, pitch=0.0, pitch_range=0.0, energy=0.0, style_prompt=None,
                     auto_expressions=True, autotune=None, translate_to=None, language=None, enunciate=0.0)
        style.update(style_kw)
        style.setdefault("seed", seed)
        text = self.translate_for(text, style)
        gain = None
        chunks = self._iter_chunks(text, voice, style, seed)
        while True:
            with torch.inference_mode():
                item = next(chunks, None)
                if item is None:
                    return
                _, mel, pause = item
                if pause:
                    mel = torch.cat([mel, torch.full((pause, mel.shape[1]), SILENCE, device=mel.device)])
                wav = self.render(mel, style, normalize=False)
            if gain is None:   # one gain for the whole passage keeps loudness steady
                gain = float(np.abs(normalize_loudness(wav)).max() / (np.abs(wav).max() + 1e-9))
            yield np.clip(wav * gain, -1, 1)

    # ------------------------------------------------------------ internals
    def _iter_chunks(self, text, voice, style, seed):
        v = voice if isinstance(voice, Voice) else self._load_voice(voice)
        emo, pros = self._resolve_style(v, style)
        base_style = self._style_vec(v, emo, pros)
        anchor = self._voice_prompt(v)
        ic = self.infer_for(v)
        prof = self.profile_for(style, v)
        text = self.shape_text(text, prof, seed)
        text = self.apply_lexicon(text)
        chunks = parse_script(text, ic.max_chunk_chars, style["auto_expressions"], seed)
        pr = self.pronouncer_for(style)
        if pr is not None and (prof.get("dialect") or prof.get("age") is not None or prof.get("processes")):
            from .lexicon.profile import ProfilePronouncer
            pr = ProfilePronouncer(pr, prof, seed, self.voices.root)
        if pr is not None:
            chunks = [phonemize_chunk(c, pr) for c in chunks]
        if float(style.get("enunciate") or 0) >= 0.75:    # very clear: a short gap between words
            for c in chunks:
                _gap_words(c)
        rng = random.Random(seed)
        prev: tuple[torch.Tensor, list[int]] | None = None
        for i, ch in enumerate(chunks):
            prompt = prev if prev is not None else anchor
            mel = None
            rejected = []
            for attempt in range(ic.max_retries + 1):
                s = seed + i * 7919 + attempt * 104729
                mel, tokens, (a, _) = self._generate(ch.tokens, base_style, prompt, s, pros[0], ic)
                mel = self._apply_spans(mel, tokens, a, ch, v, pros, s, ic)
                gen = mel[a:]
                if not self._drifted(gen, v, ic):
                    break
                rejected.append(gen)
                prompt = anchor            # re-anchor on the original voice and retry
            if rejected and self.on_retry_pair is not None and not self._drifted(gen, v, ic):
                # free training signal: the kept take beat the drifted one
                for bad in rejected:
                    self.on_retry_pair(ch.plain, v.name, style, gen.detach().cpu(), bad.detach().cpu())
            gen = _trim_silence(mel[a:])
            prev = (gen, ch.tokens + encode_text(" ")) if gen.shape[0] < 900 else anchor
            last = i == len(chunks) - 1
            pause = 0 if last else int(PAUSE_AFTER.get(ch.plain[-1:] or ".", 0.25)
                                       * rng.uniform(0.8, 1.25) * self.sr / self.hop)
            yield ch, gen, pause

    def _generate(self, tokens: list[int], style_vec, prompt, seed: int, rate: float, ic=None):
        """Generate one chunk, optionally continuing from a prompt. Returns the
        full mel (prompt + new), the full token list, and (gen_start, gen_end)."""
        m = self.model
        if prompt is not None:
            p_mel, p_tok = prompt
        else:
            p_mel, p_tok = torch.zeros(0, self.cfg.audio.n_mels, device=self.device), []
        tok_t = torch.tensor([tokens], device=self.device)
        log_fpt = m.duration(tok_t, torch.tensor([len(tokens)], device=self.device), style_vec)
        n_pred = float(torch.exp(log_fpt)) * len(tokens)
        if p_tok:   # match the prompt's own speaking rate, adjusted by the rate control
            n_ratio = p_mel.shape[0] * len(tokens) / max(len(p_tok), 1) * float(np.exp(-0.15 * rate))
            n_pred = 0.5 * (n_pred + n_ratio)
        n_gen = int(np.clip(n_pred, len(tokens) + 2, 30 * self.sr / self.hop))
        tp = p_mel.shape[0]
        all_tok = list(p_tok) + list(tokens)
        T = max(tp + n_gen, len(all_tok))
        n_gen = T - tp
        tok_full = torch.full((1, T), PAD, dtype=torch.long, device=self.device)
        tok_full[0, : len(all_tok)] = torch.tensor(all_tok, device=self.device)
        cond = torch.cat([p_mel, torch.full((n_gen, p_mel.shape[1]), SILENCE, device=self.device)])[None]
        mask = torch.zeros(1, T, dtype=torch.bool, device=self.device)
        mask[0, tp:] = True
        out = self._sample(cond, mask, tok_full, style_vec, seed, ic)
        return out, all_tok, (tp, T)

    def _sample(self, cond, mask, tokens, style_vec, seed, ic=None):
        return m_sample(self.model, cond, mask, tokens, style_vec, ic or self.cfg.infer, seed)[0]

    def _apply_spans(self, mel, all_tok, gen_start, ch: Chunk, v: Voice, pros, seed, ic=None):
        """Emotional micro-expressions on part of a line, e.g. [warm]...[/warm]:
        regenerate just that region with a different style, using the audio on
        both sides as context so it blends in seamlessly."""
        if not ch.spans:
            return mel
        n_tok, n_gen = len(ch.tokens), mel.shape[0] - gen_start
        tok_full = torch.full((1, mel.shape[0]), PAD, dtype=torch.long, device=self.device)
        tok_full[0, : len(all_tok)] = torch.tensor(all_tok, device=self.device)
        for a, b, span in ch.spans:
            fa = gen_start + int(a / n_tok * n_gen) - 3
            fb = gen_start + int(b / n_tok * n_gen) + 3
            fa, fb = max(gen_start, fa), min(mel.shape[0], fb)
            if fb - fa < 4:
                continue
            sv = self._style_vec(v, emotion_vector({span.emotion: span.intensity}, self.device), pros)
            mask = torch.zeros(1, mel.shape[0], dtype=torch.bool, device=self.device)
            mask[0, fa:fb] = True
            mel = self._sample(mel[None], mask, tok_full, sv, seed + a, ic)
        return mel

    def _drifted(self, gen_mel, v: Voice, ic=None) -> bool:
        if gen_mel.shape[0] < 60:
            return False
        emb = self.model.speaker(gen_mel.T[None])[0]
        return cosine(emb, v.emb_tensor(self.device)) < (ic or self.cfg.infer).drift_threshold

    # ------------------------------------------------------------ refinements
    def infer_for(self, v: Voice):
        """Generation settings for a voice: the defaults plus anything auto-optimize found."""
        if not v.infer:
            return self.cfg.infer
        ic = copy.copy(self.cfg.infer)
        for k, val in v.infer.items():
            if hasattr(ic, k):
                setattr(ic, k, type(getattr(ic, k))(val))
        return ic

    def apply_lexicon(self, text: str) -> str:
        """Pronunciation fixes: whole words replaced by how they should be said,
        e.g. Aelith -> AY-lith. Markup inside [brackets] is left alone."""
        if not self.lexicon:
            return text
        if self._lex_re is None:
            words = sorted(self.lexicon, key=len, reverse=True)
            self._lex_re = re.compile(r"(?<![\w\[])(" + "|".join(map(re.escape, words)) + r")(?![\w\]])", re.I)
            self._lex_lower = {k.lower(): v for k, v in self.lexicon.items()}
        return self._lex_re.sub(lambda m: self._lex_lower.get(m.group(0).lower(), m.group(0)), text)

    def set_lexicon(self, lexicon: dict[str, str]) -> None:
        """Fixes are either a respelling ("AY-lith") or exact sounds ("EY1 L IH0 TH")."""
        from .lexicon.phonemes import valid
        self.lexicon = {k: v for k, v in lexicon.items() if not valid(v)}
        self._sound_fixes = {k: v for k, v in lexicon.items() if valid(v)}
        self._lex_re = None
        if self._pronouncer is not None:
            self._pronouncer.set_user(self._sound_fixes)

    # ------------------------------------------------------------ language
    @property
    def pronouncer(self):
        if self._pronouncer is None:
            from .lexicon.dictionary import Pronouncer
            self._pronouncer = Pronouncer.default()
            self._pronouncer.set_user(getattr(self, "_sound_fixes", {}))
        return self._pronouncer

    def pronouncer_for(self, style: dict):
        """Sounds for English; other languages are read from their letters."""
        if getattr(self.cfg.model, "text_mode", "bytes") == "bytes":
            return None
        lang = (style.get("language") or style.get("translate_to") or "en").lower()
        return self.pronouncer if lang.startswith("en") else None

    def tokens_for(self, text: str, style: dict | None = None) -> list[int]:
        return script_tokens(self.apply_lexicon(text), self.pronouncer_for(style or {}))

    def use_translator(self, backend: str = "m2m100", cache_path: str | Path | None = "cache/translations.db", **kw):
        from .translate import Translator
        self.translator = Translator(backend, cache_path, device=self.device, **kw)
        return self.translator

    def translate_for(self, text: str, style: dict) -> str:
        to = style.get("translate_to")
        if not to or to == "en":
            return text
        if self.translator is None:
            self.use_translator()
        return self.translator.translate(text, to, style.get("translate_from") or "en")

    def finish_audio(self, wav: np.ndarray, style: dict, normalize: bool = True) -> np.ndarray:
        """Last stage: auto-tune (the line's own setting, else the voice's default)."""
        spec = style.get("autotune")
        if spec is None:
            try:
                spec = self.voices.load(style["voice"]).autotune
            except KeyError:
                spec = None
        if settings_from(spec) is None:
            return wav
        out = apply_autotune(wav, self.sr, spec)
        return normalize_loudness(out) if normalize else out

    # -------------------------------------------------- who is speaking
    PROFILE_KEYS = ("age", "sex", "dialect", "accent", "register", "fluency", "simplify", "processes",
                    "delivery", "sing")

    def profile_for(self, style: dict, v: Voice | None = None) -> dict:
        """The voice's own profile, with this line's settings on top."""
        if v is None:
            try:
                v = self._load_voice(style["voice"])
            except (KeyError, ValueError):
                v = None
        prof = dict((v.profile or {}) if v is not None else {})
        for k in self.PROFILE_KEYS:
            if style.get(k) is not None:
                prof[k] = style[k]
        return prof

    def shape_text(self, text: str, prof: dict, seed: int) -> str:
        """Lines as this speaker would say them: a child's words (if asked),
        their natural hesitations, and laughs for a laughing delivery."""
        from . import delivery as dl, development as dev
        age = prof.get("age")
        if age is not None and prof.get("simplify"):
            text = dev.simplify_for_age(text, float(age), seed)
        flu = prof.get("fluency")
        if flu is None and age is not None:
            flu = dev.default_fluency(float(age))
        if flu is not None:
            text = dev.add_disfluencies(text, float(flu), float(age if age is not None else 30), seed)
        if dl.delivery(prof.get("delivery")).get("laugh"):
            text = dl.add_laughs(text, seed)
        return text

    def profile_prosody(self, prof: dict) -> dict:
        """Pace, pitch, melody, loudness and emotion from age, speaking style,
        dialect and delivery."""
        from . import delivery as dl, development as dev
        from .dialects import all_dialects
        out = {"rate": 0.0, "pitch": 0.0, "pitch_range": 0.0, "energy": 0.0, "enunciate": 0.0,
               "intensity": 1.0, "emotion": None}
        if prof.get("age") is not None or prof.get("register"):
            p = dev.prosody_for(float(prof.get("age") if prof.get("age") is not None else 30), prof.get("register"))
            for k in ("rate", "pitch_range", "energy", "enunciate"):
                out[k] += p[k]
            out["emotion"] = p["emotion"]
        d = all_dialects(self.voices.root).get(prof.get("dialect") or "")
        if d:
            strength = float(prof.get("accent") if prof.get("accent") is not None else 1.0)
            for k, val in (d.get("prosody") or {}).items():
                if k in out:
                    out[k] += val * strength
        dv = dl.delivery(prof.get("delivery"))
        for k in ("rate", "pitch", "pitch_range", "energy", "enunciate"):
            out[k] += dv.get(k, 0.0)
        if dv.get("emotion") is not None:
            out["emotion"] = dv["emotion"]
        out["intensity"] *= dv.get("intensity", 1.0)
        return out

    def render(self, mel: torch.Tensor, style: dict, normalize: bool = True) -> np.ndarray:
        """Mel to finished audio: the vocal tract sized to the speaker's age,
        the vocoder, auto-tune or singing, the age's pitch, and delivery touches."""
        from . import delivery as dl, development as dev
        prof = self.profile_for(style)
        age = prof.get("age")
        sex = prof.get("sex") or "female"
        if age is not None:
            t = dev.voice_targets(float(age), sex)
            alpha = t["formant"] / dev.formant_base(prof.get("base_sex") or sex)
            a = self.cfg.audio
            mel = dl.warp_formants(mel, alpha, a.f_min, a.f_max, SILENCE)
        dv = dl.delivery(prof.get("delivery"))
        sung = bool(dv.get("sing") or prof.get("sing"))
        wav = self._vocode(mel, normalize=normalize)
        if not sung:
            wav = self.finish_audio(wav, style, normalize=normalize)
        if age is not None:
            target = dev.voice_targets(float(age), sex)["f0"]
            shift = float(style.get("pitch") or 0.0) + dv.get("pitch", 0.0)
            wav = dl.move_pitch_to(wav, self.sr, target * 2 ** (shift / 12))
        if sung:
            wav = dl.sing(wav, self.sr, prof.get("sing") or {}, int(style.get("seed") or 0))
        wav = dl.touch(wav, self.sr, dv.get("post"), int(style.get("seed") or 0))
        return normalize_loudness(wav) if normalize else wav

    def reload(self, ckpt: str | Path) -> None:
        """Swap in another model version (used when learning promotes or rolls back)."""
        self.model = VoxModel.load(ckpt, self.device)
        self.ckpt_path = str(ckpt)
        self.cfg = self.model.cfg
        extras = getattr(self.model, "extras", {})
        self.space = SpeakerSpace(**extras["speaker_space"]) if extras.get("speaker_space") else self.space
        self._prompt_cache.clear()
        self._model_id = hashlib.sha1(str(sum(p.sum().item() for p in self.model.dit.out.parameters())).encode()).hexdigest()[:8]

    def _resolve_style(self, v: Voice, style: dict):
        emo = emotion_vector(v.default_emotion, self.device)
        pros = list(v.default_prosody)
        if style.get("style_prompt"):
            req = parse_style_prompt(style["style_prompt"])
            if req.emotion:
                emo = emotion_vector(req.emotion, self.device)
            pros = [p + q for p, q in zip(pros, req.prosody)]
        if style.get("emotion"):
            emo = emotion_vector(style["emotion"], self.device)
        add = self.profile_prosody(self.profile_for(style, v))
        if add["emotion"] is not None and not style.get("emotion"):
            emo = emotion_vector(add["emotion"], self.device)
        emo = emo * float(style.get("intensity", 1.0)) * add["intensity"]
        e = float(style.get("enunciate") or 0.0) + add["enunciate"]   # clear speech: slower, more melodic, a touch louder
        pros = [pros[0] + style.get("rate", 0.0) + add["rate"] - 1.0 * e, pros[1] + style.get("pitch", 0.0) + add["pitch"],
                pros[2] + style.get("pitch_range", 0.0) + add["pitch_range"] + 0.3 * e,
                pros[3] + style.get("energy", 0.0) + add["energy"] + 2.0 * e]
        return emo, pros

    def _style_vec(self, v: Voice, emo: torch.Tensor, pros: list[float]):
        return self.model.style(v.emb_tensor(self.device)[None], emo[None],
                                torch.tensor([pros], dtype=torch.float32, device=self.device))

    def _null_style(self):
        return self.model.style.null[None]

    def _voice_prompt(self, v: Voice):
        if v.name in self._prompt_cache:
            return self._prompt_cache[v.name]
        p = self.voices.prompt_path(v.name)
        if p is None or not v.prompt_text:
            return None
        wav = torch.from_numpy(load_audio(p, self.sr)).to(self.device)
        mel = self.model.mel(wav)[0].T
        prompt = (mel, encode_text(normalize_text(v.prompt_text) + " "))
        self._prompt_cache[v.name] = prompt
        return prompt

    def _load_voice(self, name: str) -> Voice:
        v = self.voices.load(name)
        if name in self.voice_overrides:
            v.speaker_emb = list(self.voice_overrides[name])
        return v

    @torch.no_grad()
    def _vocode(self, mel: torch.Tensor, normalize: bool = True) -> np.ndarray:
        wav = self.model.mel_to_wav(mel.T[None].to(self.device))[0].cpu().numpy()
        return normalize_loudness(wav) if normalize else wav

    def _cache_key(self, text, style, seed) -> str:
        v = style["voice"]
        vj = (self.voices.path(v) / "voice.json") if v in self.voices.names() else None
        vhash = sha256_bytes(vj.read_bytes())[:12] if vj else v
        blob = json.dumps([self._model_id, vhash, text, style, seed], sort_keys=True, default=str)
        return hashlib.sha256(blob.encode()).hexdigest()[:32]

    # ================================================================ voices
    def clone_voice(self, name: str, audio, transcript: str, consent: ConsentRecord,
                    description: str = "") -> Voice:
        """Create a voice from a 3-15 second sample. Requires a consent record."""
        consent.validate()
        raw = audio if isinstance(audio, (bytes, bytearray)) else Path(audio).read_bytes() \
            if isinstance(audio, (str, Path)) else None
        wav = load_audio(raw, self.sr) if raw is not None else np.asarray(audio, dtype=np.float32)
        secs = len(wav) / self.sr
        if secs < 3:
            raise ValueError("The sample must be at least 3 seconds of clean speech.")
        if secs > 15:
            raise ValueError("Use a sample of 15 seconds or less, cut at a sentence end, so the "
                             "transcript still matches the audio exactly.")
        if not transcript.strip():
            raise ValueError("A transcript of the sample is required (exact words spoken).")
        wav = normalize_loudness(wav)
        consent.audio_sha256 = sha256_bytes(wav.tobytes())
        with torch.no_grad():
            emb = self.model.speaker(self.model.mel(torch.from_numpy(wav).to(self.device)))[0]
        voice = Voice(name=name, speaker_emb=emb.cpu().tolist(), origin="cloned",
                      description=description, prompt_text=transcript.strip(),
                      consent=consent.__dict__)
        self.voices.save(voice, wav, self.sr)
        self._prompt_cache.pop(name, None)
        return voice

    def design_voice(self, description: str = "", seed: int | None = None, name: str | None = None,
                     attributes: dict[str, float] | None = None, diversity: float = 1.0,
                     save: bool = True) -> Voice:
        """Invent a new voice that belongs to no real person.

        description: e.g. "deep gravelly old dwarf, slow, a bit grumpy"
        attributes:  fine-tune with pitch / brightness / roughness / breathiness (-2..2)
        """
        seed = seed if seed is not None else random.randrange(2 ** 31)
        req = parse_style_prompt(description)
        attrs = {**req.attributes, **(attributes or {})}
        if self.space is not None:
            emb = self.space.sample(seed, attrs, diversity)
        else:   # untrained model: random point on the sphere
            rng = np.random.default_rng(seed)
            emb = rng.standard_normal(self.cfg.model.speaker_dim)
            emb /= np.linalg.norm(emb)
        top = max(req.emotion, key=req.emotion.get) if req.emotion else "neutral"
        voice = Voice(name=name or random_voice_name(seed), speaker_emb=[float(x) for x in emb],
                      origin="designed", description=description, default_emotion=top,
                      default_prosody=req.prosody, seed=seed)
        if save:
            self.voices.save(voice)
        return voice

    def character_voice(self, group: str, name: str | None = None, seed: int | None = None,
                        save: bool = True, **profile) -> Voice:
        """One of the six starting voices (adult, teen or adolescent; male or
        female), designed so it belongs to no real person, with its profile:
        age (1-90, "first words" to adult), dialect, accent, speaking style,
        fluency and default delivery. Children's voices are never sampled from
        real children: they are designed and shaped to the age."""
        from .development import AGE_GROUPS
        g = AGE_GROUPS.get(group)
        if g is None:
            raise ValueError(f"Unknown group '{group}'. Choose from: {', '.join(AGE_GROUPS)}")
        age = float(profile.get("age") or g["age"])
        if not 1 <= age <= 90:
            raise ValueError("Age goes from 1 (first words) to 90.")
        sex = g["sex"]
        # adults and teens start from a voice of their own sex; children from a
        # light, bright voice that is then sized to the age
        base_sex = sex if age >= 13 else "female"
        attrs = {"pitch": 1.2 if age < 13 else (0.6 if sex == "female" else -0.4 if age >= 16 else 0.2),
                 "brightness": 1.0 if age < 13 else 0.4, "roughness": -0.8 if age < 16 else 0.0}
        v = self.design_voice(g["description"], seed=seed, name=name or f"{group}_{int(age)}",
                              attributes=attrs, save=False)
        prof = {"age": age, "sex": sex, "base_sex": base_sex, "group": group}
        prof.update({k: val for k, val in profile.items() if k in self.PROFILE_KEYS and val is not None})
        prof["age"] = age
        v.profile = prof
        v.description = f"{g['label']}, age {age:g}" + (f", {profile['dialect'].replace('_', ' ')}" if profile.get("dialect") else "")
        if save:
            self.voices.save(v)
        return v

    def blend_voices(self, name: str, weights: dict[str, float]) -> Voice:
        """Mix existing voices, e.g. {"guard_a": 0.7, "guard_b": 0.3}."""
        embs = sum(w * self.voices.load(n).emb_tensor() for n, w in weights.items())
        embs = embs / embs.norm()
        voice = Voice(name=name, speaker_emb=embs.tolist(), origin="designed",
                      description="blend of " + ", ".join(f"{k} {v:.0%}" for k, v in weights.items()))
        self.voices.save(voice)
        return voice

    # ================================================================ editing
    def edit(self, result: SpeechResult) -> "EditSession":
        from .editing import EditSession
        return EditSession(self, result)


def m_sample(model: VoxModel, cond, mask, tokens, style_vec, ic, seed):
    return model.dit.sample(cond, mask, tokens, style_vec, model.style.null[None],
                            steps=ic.nfe_steps, cfg_text=ic.cfg_text, cfg_style=ic.cfg_style,
                            sway=ic.sway, seed=seed)


def _gap_words(c: Chunk) -> None:
    """Insert a short pause token after every space (dictation-style clarity)."""
    space = encode_text(" ")[0]
    out, newpos = [], []
    for t in c.tokens:
        newpos.append(len(out))
        out.append(t)
        if t == space:
            out.append(SPECIAL_ID["pause_s"])
    newpos.append(len(out))
    c.spans = [(newpos[a], newpos[b], st) for a, b, st in c.spans]
    c.tokens = out


def _trim_silence(mel: torch.Tensor, margin: int = 3, drop: float = 5.0) -> torch.Tensor:
    e = mel.mean(-1)
    if e.numel() == 0:
        return mel
    voiced = torch.nonzero(e > e.max() - drop).flatten()
    if voiced.numel() == 0:
        return mel
    a = max(0, int(voiced[0]) - margin)
    b = min(mel.shape[0], int(voiced[-1]) + margin + 1)
    return mel[a:b]


__all__ = ["VoxEngine", "SpeechResult", "ConsentRecord", "EMOTIONS"]
