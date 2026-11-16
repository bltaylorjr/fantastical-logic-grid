"""Fixes how Whisper writes down what it hears.

Whisper spells sound-words many ways. "Humf" can come back as hmph, humph,
hmf, hrmph or harrumph. "Hmm" can come back as hm, mm or hmmmmm, and "uh-huh"
as mhm, uh huh or mm-hmm. Some words come back spelled wrong. Unless this is
fixed, the engine counts its own correct line as misheard, the "words it may
be saying wrong" list fills with false alarms, and recordings gathered for
training are saved with the wrong words.

Three steps run on every transcript:

1. Your own fixes ("Whisper writes" -> "Should be") come first and always win.
2. Stretched sounds are shortened ("hmmmmm" -> "hmm", "ughhhh" -> "ugh").
3. Each sound-word is given one spelling (the first name in its SOUNDS row).

To check whether the engine said a line clearly, both the script and what
Whisper heard are run through `compare_words`. That way "humf" in the script
and "hmph" from Whisper count as the same word.
"""
from __future__ import annotations

import re
import threading

# Spelling used -> every way Whisper (or a script writer) may write the sound.
# Only sounds are listed, never ordinary dictionary words ("hum", "err" and
# "tut" are real words, so they're left alone).
SOUNDS: dict[str, list[str]] = {
    "humph": ["hmph", "humph", "humf", "hmf", "hmpf", "humpf", "hmff", "hrmph", "hrmf", "hrumph",
              "harrumph", "harumph", "hurmph", "hmphf"],
    "hmm": ["hm", "hmm", "mm", "mmm", "hmn", "hrm", "hrmm"],
    "uh-huh": ["uh-huh", "uh huh", "uhhuh", "uhuh", "mhm", "mm-hmm", "mm hmm", "mmhmm", "mm-hm", "mmhm",
               "uh-hu", "uh-hum"],
    "uh-uh": ["uh-uh", "unh-unh", "unh unh", "mm-mm", "mm mm", "nuh-uh", "nuh uh"],
    "uh-oh": ["uh-oh", "uh oh", "uhoh", "oh-oh"],
    "uh": ["uh", "uhh", "uhhh", "er", "ehm"],
    "um": ["um", "umm", "uhm", "erm"],
    "ah": ["ah", "ahh", "aah", "aahh"],
    "aw": ["aw", "aww", "awh"],
    "oh": ["oh", "ohh", "ohhh"],
    "ooh": ["ooh", "oooh", "ouh"],
    "ugh": ["ugh", "ughh", "uggh", "ug", "uhg"],
    "blech": ["blech", "bleh", "blegh"],
    "pfft": ["pfft", "pff", "pft", "pfff", "phft", "phht", "pssh", "psh"],
    "psst": ["psst", "pst", "pssst"],
    "shh": ["sh", "shh", "shhh", "ssh", "sshh"],
    "tsk": ["tsk", "tsk-tsk", "tsk tsk", "tch", "tsch"],
    "whoa": ["whoa", "woah", "woa", "whoah"],
    "huh": ["huh", "hu", "huhh"],
    "eh": ["eh", "ehh"],
    "meh": ["meh", "mehh"],
    "phew": ["phew", "whew", "phoo", "fwew"],
    "oof": ["oof", "ooph", "ouf"],
    "ow": ["ow", "oww", "owww", "owie"],
    "ha": ["ha", "hah"],
    "haha": ["haha", "hahaha", "ha-ha", "ha ha", "ha-ha-ha", "ha ha ha", "bwahaha", "muahaha", "mwahaha"],
    "heh": ["heh", "hehe", "hehehe", "heh-heh", "heh heh"],
    "hee-hee": ["hee-hee", "hee hee", "teehee", "tee-hee", "tee hee"],
    "eek": ["eek", "eep", "eeek"],
    "argh": ["argh", "arg", "arrgh", "aargh", "aarrgh"],
    "grr": ["grr", "grrr", "grrrr"],
    "brr": ["brr", "brrr"],
    "nah": ["nah", "naw", "nawh"],
    "yay": ["yay", "yey", "yaay"],
    "ahem": ["ahem", "a-hem", "ah-hem"],
    "achoo": ["achoo", "ah-choo", "atchoo", "achu", "ahchoo"],
    "zzz": ["zzz", "zz", "zzzz"],
    "oops": ["oops", "whoops", "woops", "oopsie", "whoopsie"],
    "yikes": ["yikes", "yikers"],
    "wow": ["wow", "woww", "wowie"],
    "yo": ["yo", "yoh"],
    "mwah": ["mwah", "mwa", "muah"],
}

_VARIANT: dict[str, str] = {}
for _canon, _vs in SOUNDS.items():
    for _v in [_canon, *_vs]:
        _VARIANT.setdefault(_v, _canon)

_MULTI = sorted((v for v in _VARIANT if " " in v), key=len, reverse=True)
_MULTI_RE = re.compile(r"(?<![A-Za-z'])(" + "|".join(re.escape(v) for v in _MULTI) + r")(?![A-Za-z'])", re.I)
_WORD = re.compile(r"[A-Za-z][A-Za-z'-]*[A-Za-z]|[A-Za-z]")
_STRETCH = re.compile(r"([a-z])\1{2,}")
_KEEP_START, _KEEP_END = "\x02", "\x03"            # marks text from your own fixes so nothing else changes it


def _sound(word: str) -> str | None:
    """The spelling for a sound-word, or None if it isn't one."""
    w = word.lower()
    if w in _VARIANT:
        return _VARIANT[w]
    if _STRETCH.search(w):                         # "hmmmmm", "ughhhh"
        two = _STRETCH.sub(r"\1\1", w)
        if two in _VARIANT:
            return _VARIANT[two]
        return _VARIANT.get(_STRETCH.sub(r"\1", w))
    return None


def _match_case(src: str, out: str) -> str:
    if src.isupper() and len(src) > 1:
        return out.upper()
    if src[:1].isupper():
        return out[:1].upper() + out[1:]
    return out


class HeardFixer:
    """Your own fixes plus the built-in sound spellings. Safe to share between threads."""

    def __init__(self, fixes: dict[str, str] | None = None):
        self._lock = threading.Lock()
        self.load(fixes or {})

    def load(self, fixes: dict[str, str]) -> None:
        clean = {k.strip().lower(): v.strip() for k, v in fixes.items() if k and k.strip() and v and v.strip()}
        keys = sorted(clean, key=len, reverse=True)
        rx = re.compile(r"(?<![A-Za-z'])(" + "|".join(re.escape(k) for k in keys) + r")(?![A-Za-z'])", re.I) \
            if keys else None
        with self._lock:
            self.fixes, self._rx = clean, rx

    def fix_text(self, text: str) -> str:
        """What Whisper wrote, with your fixes and one spelling per sound."""
        if not text:
            return text
        with self._lock:
            fixes, rx = self.fixes, self._rx
        t = text
        if rx is not None:
            t = rx.sub(lambda m: _KEEP_START + _match_case(m[1], fixes[m[1].lower()]) + _KEEP_END, t)
        parts = re.split(f"({_KEEP_START}[^{_KEEP_END}]*{_KEEP_END})", t)
        for i, p in enumerate(parts):
            if p.startswith(_KEEP_START):
                parts[i] = p[1:-1]
                continue
            p = _MULTI_RE.sub(lambda m: _match_case(m[1], _VARIANT[m[1].lower()]), p)
            parts[i] = _WORD.sub(lambda m: _match_case(m[0], _sound(m[0]) or m[0]), p)
        return "".join(parts)

    def fix_words(self, words: list[tuple[str, float, float]]) -> list[tuple[str, float, float]]:
        """Word timings from Whisper with each word fixed. A word your fix turns
        into nothing is dropped; a two-word fix ("hum f" -> "humf") is applied
        by fix_text on the joined line, so timings keep Whisper's own words."""
        out = []
        for w, a, b in words:
            f = self.fix_text(w)
            if f.strip():
                out.append((f.strip(), a, b))
        return out

    def compare_words(self, text: str) -> list[str]:
        """Words for checking a script against what Whisper heard: your fixes,
        then one spelling per sound on both sides, so 'humf' matches 'hmph'."""
        t = self.fix_text(text)
        out = []
        for w in re.findall(r"[a-zA-Z']+(?:-[a-zA-Z']+)*", t.lower()):
            out.extend((_sound(w) or w).split("-"))
        return [w for w in out if w.strip("'")]


# One shared fixer. The engine's server loads your saved fixes into it at start
# and whenever you change them; command-line tools get the built-in spellings.
FIXER = HeardFixer()


def fix_text(text: str) -> str:
    return FIXER.fix_text(text)


def compare_words(text: str) -> list[str]:
    return FIXER.compare_words(text)
