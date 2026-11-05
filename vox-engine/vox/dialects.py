"""English dialects as pronunciation rules.

Vox's dictionary gives General American sounds. A dialect rewrites them the
way speakers of that dialect say them: dropping R after vowels (non-rhotic),
"bahth" for bath, "dis" for this, "fink" for think, "ah" for "I", "pin" for
pen, "wery" for very, and so on, plus the dialect's rhythm and melody (some
English is syllable-timed, giving every syllable a similar length).

These are rules over the speech model's sound set (ARPAbet), so each is an
approximation; strength (0 to 1) sets how often each rule is applied. A model
trained on recordings in a dialect sounds far more natural in it.

You can also add your own dialects: a JSON file in voices/dialects/<id>.json
with {"label", "region", "rules": [...], "prosody": {...}} using the same rule
names as below.
"""
from __future__ import annotations

import json
import random
import zlib
from pathlib import Path

from .lexicon.phonemes import base, is_vowel

VOICELESS = {"P", "T", "K", "F", "TH", "S", "SH", "CH", "HH"}


def _stress(p: str) -> str:
    return p[-1] if p[-1] in "012" else ""


# ------------------------------------------------------------------ rules
# Each rule: (word, phones, next_word) -> phones. Applied in order.
def non_rhotic(w, p, nxt):
    """R is said only before a vowel (car -> cah, butter -> buttuh); kept to link
    to a next word starting with a vowel ("far away")."""
    links = bool(nxt) and nxt[0].lower() in "aeiou"
    out = []
    for i, x in enumerate(p):
        if base(x) == "ER":
            last = i == len(p) - 1
            out.append(("ER" if last and links else "AH") + _stress(x))
            continue
        if x == "R" and i > 0 and is_vowel(p[i - 1]):
            if i + 1 < len(p) and is_vowel(p[i + 1]):
                out.append(x)
            elif i == len(p) - 1 and links:
                out.append(x)
            continue
        out.append(x)
    return out


def trap_bath(w, p, nxt):
    """Bath, dance, can't with the long "ah"."""
    out = list(p)
    for i, x in enumerate(p[:-1]):
        if base(x) == "AE" and _stress(x) == "1":
            a, b = p[i + 1], p[i + 2] if i + 2 < len(p) else None
            if a in ("F", "S", "TH") or (a == "N" and b in ("T", "S", "CH", "D")) or (a == "M" and b == "P"):
                out[i] = "AA1"
    return out


def lot_rounded(w, p, nxt):
    """Lot, hot, stop with a rounded "o" (spelled o, said AA in General American)."""
    return [("AO" + _stress(x) if base(x) == "AA" and "o" in w.lower() else x) for x in p]


def th_stopping(w, p, nxt):
    return [{"TH": "T", "DH": "D"}.get(x, x) for x in p]


def th_fronting(w, p, nxt):
    return [("F" if x == "TH" else ("D" if i == 0 else "V") if x == "DH" else x) for i, x in enumerate(p)]


def h_dropping(w, p, nxt):
    return p[1:] if len(p) > 1 and p[0] == "HH" else p


def t_glottal(w, p, nxt):
    """T between vowels or at the end swallowed (bu'er, wha')."""
    return [x for i, x in enumerate(p) if not (x == "T" and i > 0 and is_vowel(p[i - 1])
                                               and (i == len(p) - 1 or is_vowel(p[i + 1])))]


def ing_to_in(w, p, nxt):
    """Walkin', talkin'."""
    if w.lower().endswith("ing") and len(p) > 2 and p[-1] == "NG" and base(p[-2]) == "IH":
        return p[:-1] + ["N"]
    return p


def ay_monophthong(w, p, nxt):
    """I, my, time as "ah" (Southern); before voiced sounds and at the end."""
    out = list(p)
    for i, x in enumerate(p):
        if base(x) == "AY" and (i + 1 == len(p) or p[i + 1] not in VOICELESS):
            out[i] = "AA" + _stress(x)
    return out


def ay_monophthong_all(w, p, nxt):
    return [("AA" + _stress(x) if base(x) == "AY" else x) for x in p]


def pin_pen(w, p, nxt):
    """Pen and pin sound alike."""
    return [("IH" + _stress(x) if base(x) == "EH" and i + 1 < len(p) and p[i + 1] in ("N", "M") else x)
            for i, x in enumerate(p)]


def final_cluster_reduction(w, p, nxt):
    """Test -> tes', hand -> han'."""
    if len(p) > 2 and p[-1] in ("T", "D") and not is_vowel(p[-2]) and p[-2] not in ("R",):
        return p[:-1]
    return p


def ae_raising(w, p, nxt):
    """Cat, bad, man raised toward "eh" (Great Lakes)."""
    return [("EH" + _stress(x) if base(x) == "AE" and _stress(x) == "1" else x) for x in p]


def canadian_raising(w, p, nxt):
    """About, house: "aboat"; right, nice: a raised "uh-ee" before P, T, K, F, S."""
    out = []
    for i, x in enumerate(p):
        nxt_p = p[i + 1] if i + 1 < len(p) else None
        if base(x) == "AW" and nxt_p in VOICELESS:
            out.append("OW" + _stress(x))
        elif base(x) == "AY" and nxt_p in VOICELESS:
            out += ["AH" + _stress(x), "IY0"]
        else:
            out.append(x)
    return out


def strut_foot(w, p, nxt):
    """Cup, bus, love with the "oo" of foot (Northern England)."""
    return [("UH" + _stress(x) if base(x) == "AH" and _stress(x) in "12" and "u" in w.lower() else x) for x in p]


def scottish_vowels(w, p, nxt):
    """House -> hoose (broad), goat and face as pure vowels."""
    return [("UW" + _stress(x) if base(x) == "AW" else x) for x in p]


def irish_vowels(w, p, nxt):
    """Nice -> noice; time with an "oy"."""
    return [("OY" + _stress(x) if base(x) == "AY" else x) for x in p]


def face_to_price(w, p, nxt):
    """Day -> die (Australian, Cockney)."""
    return [("AY" + _stress(x) if base(x) == "EY" else x) for x in p]


def price_to_choice(w, p, nxt):
    return [("OY" + _stress(x) if base(x) == "AY" else x) for x in p]


def kit_centralized(w, p, nxt):
    """Fish and chips -> "fush and chups" (New Zealand, South Africa)."""
    return [("AH" + _stress(x) if base(x) == "IH" and _stress(x) == "1" else x) for x in p]


def dress_raised(w, p, nxt):
    """Yes -> yis, bed -> bid (New Zealand)."""
    return [("IH" + _stress(x) if base(x) == "EH" else x) for x in p]


def v_w_merger(w, p, nxt):
    """Very and wary alike (South Asian English)."""
    return [("V" if x == "W" else x) for x in p]


def z_to_j(w, p, nxt):
    return [("JH" if x == "Z" and i == 0 else x) for i, x in enumerate(p)]


def f_to_p(w, p, nxt):
    return [{"F": "P", "V": "B"}.get(x, x) for x in p]


def sibilant_merger(w, p, nxt):
    """Zoo -> soo, shoe -> soo (Filipino), as Z and SH become S."""
    return [{"Z": "S", "SH": "S", "ZH": "S"}.get(x, x) for x in p]


def ch_sh_merger(w, p, nxt):
    return [("SH" if x == "CH" else x) for x in p]


def kit_fleece(w, p, nxt):
    """Ship and sheep alike (Spanish-influenced English)."""
    return [("IY" + _stress(x) if base(x) == "IH" and _stress(x) == "1" else x) for x in p]


def final_devoicing(w, p, nxt):
    """Bag -> bak, love -> luf."""
    dv = {"B": "P", "D": "T", "G": "K", "V": "F", "Z": "S", "JH": "CH"}
    return p[:-1] + [dv.get(p[-1], p[-1])] if p else p


def full_vowels(w, p, nxt):
    """Syllable-timed: unstressed vowels are said fully, not reduced to "uh"."""
    return [(x[:-1] + "2" if is_vowel(x) and x.endswith("0") else x) for x in p]


def nurse_to_dress(w, p, nxt):
    """Bird -> "behd" (Nigerian, Jamaican)."""
    return [("EH" + _stress(x) if base(x) == "ER" and _stress(x) == "1" else x) for x in p]


def goat_monophthong(w, p, nxt):
    """Go, no with a pure "aw"-like vowel."""
    return [("AO" + _stress(x) if base(x) == "OW" else x) for x in p]


RULES = {f.__name__: f for f in [non_rhotic, trap_bath, lot_rounded, th_stopping, th_fronting, h_dropping, t_glottal,
                                 ing_to_in, ay_monophthong, ay_monophthong_all, pin_pen, final_cluster_reduction,
                                 ae_raising, canadian_raising, strut_foot, scottish_vowels, irish_vowels, face_to_price,
                                 price_to_choice, kit_centralized, dress_raised, v_w_merger, z_to_j, f_to_p,
                                 sibilant_merger, ch_sh_merger, kit_fleece, final_devoicing, full_vowels,
                                 nurse_to_dress, goat_monophthong]}

# ---------------------------------------------------------------- dialects
# prosody: rate and pitch_range offsets; syllable-timed dialects add full_vowels.
DIALECTS: dict[str, dict] = {
    "general_american": {"label": "General American", "region": "United States", "rules": []},
    "southern_us": {"label": "Southern US", "region": "United States",
                    "rules": ["ay_monophthong", "pin_pen", "ing_to_in"], "prosody": {"rate": -0.25, "pitch_range": 0.25}},
    "appalachian": {"label": "Appalachian", "region": "United States (incl. Western North Carolina)",
                    "rules": ["ay_monophthong_all", "pin_pen", "ing_to_in"], "prosody": {"rate": -0.2, "pitch_range": 0.2}},
    "texan": {"label": "Texan", "region": "United States",
              "rules": ["ay_monophthong", "pin_pen", "ing_to_in"], "prosody": {"rate": -0.2, "pitch_range": 0.15}},
    "african_american": {"label": "African American English", "region": "United States",
                         "rules": ["th_fronting", "final_cluster_reduction", "ay_monophthong", "ing_to_in", "pin_pen"],
                         "prosody": {"pitch_range": 0.25}},
    "new_york": {"label": "New York City", "region": "United States",
                 "rules": ["non_rhotic", "th_stopping"], "prosody": {"rate": 0.25, "pitch_range": 0.2}},
    "boston": {"label": "Boston", "region": "United States", "rules": ["non_rhotic"], "prosody": {"rate": 0.15}},
    "great_lakes": {"label": "Great Lakes (Chicago, Detroit)", "region": "United States", "rules": ["ae_raising"]},
    "canadian": {"label": "Canadian", "region": "Canada", "rules": ["canadian_raising"]},
    "british_rp": {"label": "Standard British (RP)", "region": "England",
                   "rules": ["non_rhotic", "trap_bath", "lot_rounded"], "prosody": {"pitch_range": 0.1}},
    "london": {"label": "London (Cockney, Estuary)", "region": "England",
               "rules": ["non_rhotic", "trap_bath", "th_fronting", "h_dropping", "t_glottal", "face_to_price"],
               "prosody": {"rate": 0.15}},
    "northern_england": {"label": "Northern England", "region": "England",
                         "rules": ["non_rhotic", "strut_foot", "goat_monophthong"]},
    "scottish": {"label": "Scottish", "region": "Scotland", "rules": ["scottish_vowels", "goat_monophthong"],
                 "prosody": {"pitch_range": 0.15}},
    "irish": {"label": "Irish", "region": "Ireland", "rules": ["th_stopping", "irish_vowels"],
              "prosody": {"pitch_range": 0.3, "rate": 0.1}},
    "welsh": {"label": "Welsh", "region": "Wales", "rules": ["non_rhotic", "goat_monophthong", "full_vowels"],
              "prosody": {"pitch_range": 0.45}},
    "australian": {"label": "Australian", "region": "Australia",
                   "rules": ["non_rhotic", "price_to_choice", "face_to_price"], "prosody": {"pitch_range": 0.1}},
    "new_zealand": {"label": "New Zealand", "region": "New Zealand",
                    "rules": ["non_rhotic", "kit_centralized", "dress_raised", "face_to_price"]},
    "south_african": {"label": "South African", "region": "South Africa", "rules": ["non_rhotic", "kit_centralized"]},
    "indian": {"label": "Indian English", "region": "India and South Asia",
               "rules": ["th_stopping", "v_w_merger", "z_to_j", "full_vowels"], "prosody": {"rate": 0.2, "pitch_range": 0.2}},
    "nigerian": {"label": "Nigerian English", "region": "Nigeria and West Africa",
                 "rules": ["th_stopping", "non_rhotic", "nurse_to_dress", "full_vowels"], "prosody": {"pitch_range": 0.3}},
    "jamaican": {"label": "Jamaican and Caribbean", "region": "Caribbean",
                 "rules": ["th_stopping", "h_dropping", "non_rhotic", "nurse_to_dress", "full_vowels"],
                 "prosody": {"pitch_range": 0.35, "rate": 0.1}},
    "singaporean": {"label": "Singaporean and Malaysian", "region": "Southeast Asia",
                    "rules": ["th_stopping", "final_cluster_reduction", "final_devoicing", "full_vowels"],
                    "prosody": {"rate": 0.25}},
    "filipino": {"label": "Filipino English", "region": "Philippines",
                 "rules": ["f_to_p", "th_stopping", "sibilant_merger", "full_vowels"], "prosody": {"rate": 0.1}},
    "latino": {"label": "Latino English (Spanish-influenced)", "region": "Americas",
               "rules": ["kit_fleece", "sibilant_merger", "ch_sh_merger", "full_vowels"], "prosody": {"rate": 0.15}},
}


def user_dialects(root: str | Path | None) -> dict[str, dict]:
    out = {}
    d = Path(root) / "dialects" if root else None
    if d and d.is_dir():
        for f in sorted(d.glob("*.json")):
            try:
                v = json.loads(f.read_text())
                v["rules"] = [r for r in v.get("rules", []) if r in RULES]
                out[f.stem] = {"label": v.get("label", f.stem), "region": v.get("region", ""), **v, "custom": True}
            except Exception:
                continue
    return out


def all_dialects(root=None) -> dict[str, dict]:
    return {**DIALECTS, **user_dialects(root)}


def apply_dialect(word: str, phones: list[str], dialect: dict, strength: float = 1.0, nxt: str | None = None,
                  seed: int = 0) -> list[str]:
    if not dialect or not dialect.get("rules") or strength <= 0:
        return phones
    p = list(phones)
    for name in dialect["rules"]:
        rule = RULES.get(name)
        if rule is None:
            continue
        if strength < 1 and random.Random(zlib.crc32(f"{seed}|{name}|{word.lower()}".encode())).random() >= strength:
            continue
        p = rule(word, p, nxt) or p
    return p


def describe(root=None) -> list[dict]:
    return [{"id": k, "label": v["label"], "region": v.get("region", ""), "rules": v.get("rules", []),
             "custom": bool(v.get("custom"))} for k, v in all_dialects(root).items()]
