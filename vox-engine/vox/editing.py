"""Flexible editing: change words, emotion, timing or breaths inside a line
that has already been generated, without re-recording the whole thing.

    take = engine.speak("The treasure is hidden in the old mill.", voice="guide")
    ed = engine.edit(take)
    ed.replace("old mill", "abandoned lighthouse")     # new words, same voice & flow
    ed.restyle("hidden", emotion="fearful", intensity=0.7)
    ed.insert_pause(after="treasure", ms=300)
    ed.undo()                                          # changed your mind
    ed.render().save("line_edited.wav")

Edits use the generator's infilling ability: the edited region is masked and
regenerated with the audio on both sides as context, so joins are seamless.

Word positions are estimated from the text (the model has no hard alignment),
with a small safety margin. For frame-exact control use regenerate(start_s, end_s).
"""
from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np
import torch

from .model.style import emotion_vector
from .text import PAD, script_tokens

if TYPE_CHECKING:
    from .engine import SpeechResult, VoxEngine

SILENCE = float(np.log(1e-5))


class EditSession:
    MARGIN = 3

    def __init__(self, engine: "VoxEngine", result: "SpeechResult"):
        self.engine = engine
        self.base = result
        self._history = [(result.mel.clone().to(engine.device), result.text)]
        self._pos = 0
        self._seed = result.seed

    # ------------------------------------------------------------- state
    @property
    def mel(self) -> torch.Tensor:
        return self._history[self._pos][0]

    @property
    def text(self) -> str:
        return self._history[self._pos][1]

    def _push(self, mel, text):
        self._history = self._history[: self._pos + 1] + [(mel, text)]
        self._pos += 1
        self._seed += 1

    def undo(self) -> bool:
        if self._pos == 0:
            return False
        self._pos -= 1
        return True

    def redo(self) -> bool:
        if self._pos >= len(self._history) - 1:
            return False
        self._pos += 1
        return True

    @property
    def can_undo(self) -> bool:
        return self._pos > 0

    @property
    def can_redo(self) -> bool:
        return self._pos < len(self._history) - 1

    # ------------------------------------------------------------- edits
    def replace(self, old: str, new: str, occurrence: int = 0, **style) -> "EditSession":
        """Swap a word or phrase for new words. Keeps voice, emotion and rhythm."""
        a, b = self._frames_of(old, occurrence)
        ratio = len(self._tokens(new)) / max(len(self._tokens(old)), 1)
        new_len = max(4, int(round((b - a) * ratio)))
        new_text = _replace_nth(self.text, old, new, occurrence)
        mel = torch.cat([self.mel[:a], torch.full((new_len, self.mel.shape[1]), SILENCE,
                                                  device=self.mel.device), self.mel[b:]])
        out = self._infill(mel, new_text, a, a + new_len, style)
        self._push(out, new_text)
        return self

    def restyle(self, phrase: str, occurrence: int = 0, **style) -> "EditSession":
        """Re-deliver a phrase with a different emotion / pace / pitch.
        Example: restyle("my friend", emotion="tender", intensity=0.9)"""
        a, b = self._frames_of(phrase, occurrence)
        self._push(self._infill(self.mel.clone(), self.text, a, b, style), self.text)
        return self

    def regenerate(self, start_s: float, end_s: float, **style) -> "EditSession":
        """Re-generate an exact time range (seconds), e.g. to fix a glitch."""
        fps = self.engine.sr / self.engine.hop
        a, b = int(start_s * fps), min(self.mel.shape[0], int(end_s * fps))
        self._push(self._infill(self.mel.clone(), self.text, a, b, style), self.text)
        return self

    def insert_pause(self, after: str, ms: int = 300, occurrence: int = 0) -> "EditSession":
        _, b = self._frames_of(after, occurrence, margin=0)
        n = int(ms / 1000 * self.engine.sr / self.engine.hop)
        mel = torch.cat([self.mel[:b], torch.full((n, self.mel.shape[1]), SILENCE,
                                                  device=self.mel.device), self.mel[b:]])
        self._push(mel, self.text)
        return self

    def insert_breath(self, before: str, occurrence: int = 0) -> "EditSession":
        return self.replace(before, "[breath] " + before, occurrence)

    def change_speed(self, factor: float) -> "EditSession":
        """Re-time the whole line (factor 1.2 = 20% faster). The original is
        stretched to the new length and used as a guide, then cleaned up by the
        generator so it sounds naturally faster/slower rather than sped up."""
        n = max(8, int(self.mel.shape[0] / factor))
        idx = torch.linspace(0, self.mel.shape[0] - 1, n, device=self.mel.device).round().long()
        guide = self.mel[idx]
        rate = float(np.log(factor) / 0.15)
        self._push(self._infill(guide, self.text, 0, n, {"rate": rate}, init=guide), self.text)
        return self

    def render(self) -> "SpeechResult":
        from .engine import SpeechResult
        wav = self.engine.render(self.mel, self.base.style)
        return SpeechResult(wav, self.engine.sr, self.mel.cpu(), self.text, self.base.style,
                            self._seed, [])

    # ------------------------------------------------------------- internals
    def _tokens(self, text: str) -> list[int]:
        return self.engine.tokens_for(text, self.base.style)

    def _frames_of(self, phrase: str, occurrence: int, margin: int | None = None):
        margin = self.MARGIN if margin is None else margin
        idx = _find_nth(self.text, phrase, occurrence)
        if idx < 0:
            raise ValueError(f"'{phrase}' not found in: {self.text!r}")
        total = max(len(self._tokens(self.text)), 1)
        ta = len(self._tokens(self.text[:idx])) + (1 if idx > 0 else 0)
        tb = ta + len(self._tokens(phrase))
        T = self.mel.shape[0]
        a = max(0, int(ta / total * T) - margin)
        b = min(T, int(tb / total * T) + margin)
        return a, max(b, a + 1)

    @torch.inference_mode()
    def _infill(self, mel, text, a, b, style_over: dict, init=None):
        e = self.engine
        st = {**self.base.style, **style_over}
        voice = e._load_voice(st["voice"])
        emo, pros = e._resolve_style(voice, st)
        sv = e._style_vec(voice, emo, pros)
        toks = self._tokens(text)
        T = max(mel.shape[0], len(toks))
        if T > mel.shape[0]:
            mel = torch.cat([mel, torch.full((T - mel.shape[0], mel.shape[1]), SILENCE, device=mel.device)])
            b = T if b >= mel.shape[0] else b
        tok = torch.full((1, T), PAD, dtype=torch.long, device=e.device)
        tok[0, : len(toks)] = torch.tensor(toks, device=e.device)
        mask = torch.zeros(1, T, dtype=torch.bool, device=e.device)
        mask[0, a:b] = True
        if init is None:
            return e._sample(mel[None], mask, tok, sv, self._seed, e.infer_for(voice))
        ic = e.cfg.infer
        return e.model.dit.sample(mel[None], mask, tok, sv, e.model.style.null[None], steps=ic.nfe_steps,
                                  cfg_text=ic.cfg_text, cfg_style=ic.cfg_style, sway=0.0,
                                  seed=self._seed, init_mel=init[None], t_start=0.4)[0]


def _find_nth(s: str, sub: str, n: int) -> int:
    i = -1
    for _ in range(n + 1):
        i = s.find(sub, i + 1)
        if i < 0:
            return -1
    return i


def _replace_nth(s: str, old: str, new: str, n: int) -> str:
    i = _find_nth(s, old, n)
    if i < 0:
        raise ValueError(f"'{old}' not found")
    return s[:i] + new + s[i + len(old):]
