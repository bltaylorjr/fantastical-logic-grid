"""A pronouncer for one speaker: General American sounds from the dictionary,
then the speaker's dialect, then (for a young child, or when switched on) the
child sound patterns of their age."""
from __future__ import annotations

from .phonemes import PHONE_INDEX, split


class ProfilePronouncer:
    def __init__(self, base, profile: dict, seed: int = 0, voices_root=None):
        from ..development import process_strengths
        from ..dialects import all_dialects
        self.base = base
        self.seed = int(seed or 0)
        self.dialect = all_dialects(voices_root).get(profile.get("dialect") or "")
        self.accent = float(profile.get("accent") if profile.get("accent") is not None else 1.0)
        age = profile.get("age")
        self.strengths = process_strengths(float(age) if age is not None else 30.0, profile.get("processes"))
        self.dictionary = getattr(base, "dictionary", None)

    def word(self, word: str, prev: str | None = None, nxt: str | None = None) -> str | None:
        from ..development import apply_processes
        from ..dialects import apply_dialect
        arp = self.base.word(word, prev, nxt)
        if not arp:
            return arp
        p = split(arp)
        if self.dialect:
            p = apply_dialect(word, p, self.dialect, self.accent, nxt, self.seed)
        p = apply_processes(word, p, self.strengths, self.seed)
        p = [x for x in p if x in PHONE_INDEX]
        return " ".join(p) if p else arp

    def __getattr__(self, name):          # anything else (set_user, ...) goes to the base pronouncer
        return getattr(self.base, name)
