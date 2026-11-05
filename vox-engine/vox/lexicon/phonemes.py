"""American English sounds: the ARPAbet phoneme set (as used by the CMU
Pronouncing Dictionary), conversion to IPA, syllables, stress, and an
easy-to-read respelling like "en-UN-see-AY-shun".
"""
from __future__ import annotations

VOWELS = ["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]
CONSONANTS = ["B", "CH", "D", "DH", "F", "G", "HH", "JH", "K", "L", "M", "N", "NG", "P", "R",
              "S", "SH", "T", "TH", "V", "W", "Y", "Z", "ZH"]
# Every symbol the model can be given: vowels carry stress 0 (none), 1 (primary), 2 (secondary).
PHONE_SET = [v + s for v in VOWELS for s in "012"] + CONSONANTS
PHONE_INDEX = {p: i for i, p in enumerate(PHONE_SET)}

IPA = {
    "AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ", "EH": "ɛ", "ER": "ɝ",
    "EY": "eɪ", "IH": "ɪ", "IY": "i", "OW": "oʊ", "OY": "ɔɪ", "UH": "ʊ", "UW": "u",
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ", "HH": "h", "JH": "dʒ", "K": "k",
    "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p", "R": "ɹ", "S": "s", "SH": "ʃ", "T": "t",
    "TH": "θ", "V": "v", "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ",
}
# Respelling for readers who don't know IPA (newspaper/dictionary style).
RESPELL = {
    "AA": "ah", "AE": "a", "AH": "uh", "AO": "aw", "AW": "ow", "AY": "eye", "EH": "eh", "ER": "ur",
    "EY": "ay", "IH": "ih", "IY": "ee", "OW": "oh", "OY": "oy", "UH": "uu", "UW": "oo",
    "B": "b", "CH": "ch", "D": "d", "DH": "th", "F": "f", "G": "g", "HH": "h", "JH": "j", "K": "k",
    "L": "l", "M": "m", "N": "n", "NG": "ng", "P": "p", "R": "r", "S": "s", "SH": "sh", "T": "t",
    "TH": "th", "V": "v", "W": "w", "Y": "y", "Z": "z", "ZH": "zh",
}
# Two-consonant onsets English allows at the start of a syllable ("st", "pl", ...).
ONSETS2 = {("S", c) for c in ("P", "T", "K", "M", "N", "L", "W", "F")} | \
          {(c, "R") for c in ("P", "B", "T", "D", "K", "G", "F", "TH", "SH")} | \
          {(c, "L") for c in ("P", "B", "K", "G", "F", "S")} | \
          {(c, "W") for c in ("T", "D", "K", "G", "S", "TH")} | \
          {(c, "Y") for c in ("P", "B", "K", "G", "F", "V", "M", "HH")}
ONSETS3 = {("S", "P", "R"), ("S", "T", "R"), ("S", "K", "R"), ("S", "P", "L"), ("S", "K", "W"), ("S", "K", "L")}


def split(arpabet: str) -> list[str]:
    return [p for p in arpabet.replace("-", " ").split() if p]


def base(p: str) -> str:
    return p.rstrip("012")


def is_vowel(p: str) -> bool:
    return base(p) in VOWELS


def valid(arpabet: str) -> bool:
    ps = split(arpabet)
    return bool(ps) and all(p in PHONE_INDEX for p in ps)


def syllables(phones: list[str]) -> list[list[str]]:
    """Split into syllables by maximizing legal onsets."""
    nuclei = [i for i, p in enumerate(phones) if is_vowel(p)]
    if not nuclei:
        return [phones] if phones else []
    bounds = [0]
    for a, b in zip(nuclei, nuclei[1:]):
        cons = phones[a + 1:b]
        n = len(cons)
        take = 0
        if n >= 3 and tuple(base(c) for c in cons[-3:]) in ONSETS3:
            take = 3
        elif n >= 2 and tuple(base(c) for c in cons[-2:]) in ONSETS2:
            take = 2
        elif n >= 1:
            take = 1
        bounds.append(b - take)
    bounds.append(len(phones))
    return [phones[s:e] for s, e in zip(bounds, bounds[1:])]


def stress_of(syl: list[str]) -> int:
    for p in syl:
        if is_vowel(p):
            return int(p[-1]) if p[-1].isdigit() else 0
    return 0


def to_ipa(arpabet: str) -> str:
    out = []
    for syl in syllables(split(arpabet)):
        s = stress_of(syl)
        mark = "ˈ" if s == 1 else "ˌ" if s == 2 else ""
        body = ""
        for p in syl:
            b = base(p)
            if b == "AH" and p.endswith("0"):
                body += "ə"
            elif b == "ER" and p.endswith("0"):
                body += "ɚ"
            else:
                body += IPA.get(b, b.lower())
        out.append(mark + body)
    return "".join(out)


def respell(arpabet: str) -> str:
    """'EH0 N AH2 N S IY0 EY1 SH AH0 N' -> 'ih-nun-see-AY-shun' (stressed part in capitals)."""
    parts = []
    for syl in syllables(split(arpabet)):
        txt = ""
        for p in syl:
            b = base(p)
            r = RESPELL.get(b, b.lower())
            if b == "AH" and p.endswith("0"):
                r = "uh"
            txt += r
        parts.append(txt.upper() if stress_of(syl) == 1 else txt)
    return "-".join(parts)


def stress_pattern(arpabet: str) -> str:
    """'010' style: one digit per syllable."""
    return "".join(str(stress_of(s)) for s in syllables(split(arpabet)))
