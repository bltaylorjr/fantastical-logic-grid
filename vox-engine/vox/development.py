"""Speech across the lifespan: from first words to adult.

A voice can be any age from 1 to 90, and age sets everything a listener uses
to hear how old someone is, following the usual milestones of speech and
language development:

  Voice and resonance   how high the voice is (pitch, F0) and how small the
                        vocal tract sounds (formants). Children's voices are
                        higher in both; boys' drop at puberty (13 to 16).
  Articulation and      the sound patterns young children use before they can
  phonology             say every sound, each fading out at its usual age:
                        "wabbit" for rabbit, "tat" for cat, "poon" for spoon,
                        "nana" for banana, "baba" for bottle and so on.
  Fluency               the normal hesitations of young speakers (word and
                        part-word repeats, "um"), fading with age; or set a
                        level yourself, for a character who stammers.
  Expressive language   optional: lines said the way a child of that age
                        would put them (one word, then two words, then short
                        "telegraphic" sentences, then "goed" and "mouses").
  Pragmatics            how they talk to others: the melody, pace, pauses and
                        energy of a toddler, a child, a teen or an adult, and
                        a speaking style (conversational, storytelling, formal,
                        playful, shy, confident).

Receptive language (how well someone understands) is part of the same
milestones, but there is nothing to hear in a voice for it.

Everything is seeded, so the same line comes out the same way every time.
"""
from __future__ import annotations

import random
import re
import zlib

from .lexicon.phonemes import base, is_vowel, syllables

# ------------------------------------------------------------ age groups
# The six starting voices. Any age 1-90 can be set on a voice afterwards.
AGE_GROUPS = {
    "adult_male": {"label": "Adult male", "age": 32, "sex": "male",
                   "description": "adult man, warm, natural, mid-range"},
    "adult_female": {"label": "Adult female", "age": 32, "sex": "female",
                     "description": "adult woman, warm, natural, mid-range"},
    "teen_male": {"label": "Teen male", "age": 15, "sex": "male",
                  "description": "teenage boy, youthful, light"},
    "teen_female": {"label": "Teen female", "age": 15, "sex": "female",
                    "description": "teenage girl, youthful, bright"},
    "adolescent_male": {"label": "Adolescent male (child, first words to 12)", "age": 10, "sex": "male",
                        "description": "young boy, bright, light, high"},
    "adolescent_female": {"label": "Adolescent female (child, first words to 12)", "age": 10, "sex": "female",
                          "description": "young girl, bright, light, high"},
}

STAGES = [   # shown in the age picker; the number is the age in years
    (1.0, "First words (about 1)"), (1.5, "Single words (18 months)"), (2.0, "Two-word phrases (2)"),
    (3.0, "Short sentences (3)"), (4.0, "Preschool (4)"), (5.0, "Kindergarten (5)"), (7.0, "Early school (7)"),
    (10.0, "Child (10)"), (12.0, "Preteen (12)"), (15.0, "Teen (15)"), (18.0, "Young adult (18)"),
    (32.0, "Adult (32)"), (50.0, "Middle age (50)"), (72.0, "Older adult (72)"),
]


def _interp(age: float, table: list[tuple[float, float]]) -> float:
    if age <= table[0][0]:
        return table[0][1]
    for (a0, v0), (a1, v1) in zip(table, table[1:]):
        if age <= a1:
            return v0 + (v1 - v0) * (age - a0) / (a1 - a0)
    return table[-1][1]


# Typical speaking pitch (Hz) and vocal-tract size (formant scale relative to
# an adult man; higher = smaller tract) by age, from published norms.
F0 = {
    "male": [(1, 390), (2, 350), (3, 300), (5, 280), (7, 265), (10, 240), (12, 228), (13, 205), (14, 165),
             (15, 140), (16, 127), (18, 118), (30, 112), (50, 115), (72, 125)],
    "female": [(1, 395), (2, 355), (3, 305), (5, 285), (7, 270), (10, 245), (12, 235), (13, 228), (15, 218),
               (18, 212), (30, 205), (50, 195), (72, 188)],
}
FORMANT = {
    "male": [(1, 1.62), (2, 1.55), (3, 1.47), (5, 1.40), (7, 1.33), (10, 1.27), (12, 1.22), (13, 1.18), (14, 1.12),
             (15, 1.07), (16, 1.04), (18, 1.01), (30, 1.0), (72, 0.98)],
    "female": [(1, 1.63), (2, 1.56), (3, 1.48), (5, 1.41), (7, 1.35), (10, 1.29), (12, 1.25), (14, 1.21),
               (16, 1.18), (18, 1.17), (30, 1.16), (72, 1.13)],
}
# Pace (rate units, -2..2), melody range and loudness changes by age.
RATE = [(1, -1.1), (2, -0.9), (3, -0.7), (4, -0.5), (6, -0.25), (9, -0.05), (12, 0.05), (15, 0.2), (20, 0.1),
        (40, 0.0), (60, -0.1), (75, -0.3)]
PITCH_RANGE = [(1, 0.55), (3, 0.5), (6, 0.4), (10, 0.3), (13, 0.15), (16, 0.05), (25, 0.0), (75, -0.1)]


def voice_targets(age: float, sex: str = "female") -> dict:
    """What a voice of this age and sex sounds like (pitch Hz, formant scale,
    pace and melody offsets)."""
    sex = "male" if str(sex).lower().startswith("m") else "female"
    age = max(1.0, min(90.0, float(age)))
    return {"f0": _interp(age, F0[sex]), "formant": _interp(age, FORMANT[sex]),
            "rate": _interp(age, RATE), "pitch_range": _interp(age, PITCH_RANGE)}


def formant_base(sex: str) -> float:
    """Designed voices start from adult speech: a man's or a woman's tract."""
    return 1.0 if str(sex).lower().startswith("m") else 1.16


# ------------------------------------------------- phonological processes
# Each pattern: the age it has usually gone by (most children stop using it),
# a plain-English label and an example. Its chance in a word falls from full at
# 1.5 years to nothing at that age.
PROCESSES = {
    "reduplication": (3.0, "Repeating a syllable", "bottle -> baba"),
    "final_consonant_deletion": (3.25, "Dropping the last consonant", "cat -> ca"),
    "consonant_harmony": (3.25, "Matching consonants", "dog -> gog"),
    "velar_fronting": (3.5, "K and G said at the front", "cat -> tat, go -> do"),
    "weak_syllable_deletion": (4.0, "Dropping unstressed syllables", "banana -> nana"),
    "stopping_fricatives": (3.75, "F, V, S, Z, SH said as stops", "sun -> tun, fish -> pish"),
    "deaffrication": (4.0, "CH and J said as SH and ZH", "chair -> share"),
    "cluster_reduction": (4.5, "Simplifying consonant clusters", "spoon -> poon, tree -> tee"),
    "frontal_lisp": (4.5, "S and Z with the tongue forward", "sun -> thun"),
    "stopping_th": (5.0, "TH said as T or D", "this -> dis, thumb -> tum"),
    "gliding": (6.0, "R and L said as W", "rabbit -> wabbit, leg -> weg"),
    "r_vocalization": (6.0, "Vowel R said without the R", "bird -> buhd, car -> cah"),
    "th_fronting": (7.0, "TH said as F or V", "thumb -> fum, brother -> bruvver"),
}
START = 1.5
STOPS = {"F": "P", "V": "B", "S": "T", "Z": "D", "SH": "T", "ZH": "D"}
VELAR = {"K": "T", "G": "D", "NG": "N"}
FRICATIVE_LISP = {"S": "TH", "Z": "DH"}
STOPWORDS = set("""a an the is am are was were be been being to of and or but in on at for with by from as it its
this that these those i you he she we they me him her us them my your his our their do does did have has had
will would can could shall should may might must not so if then than there here very just""".split())


def process_strengths(age: float, overrides: dict | None = None) -> dict[str, float]:
    """Chance (0-1) of each pattern in a word at this age; overrides set any
    pattern at any age (an adult character who says "wabbit", say)."""
    out = {}
    for name, (gone, _, _) in PROCESSES.items():
        out[name] = max(0.0, min(1.0, (gone - age) / (gone - START))) if age < gone else 0.0
    for k, v in (overrides or {}).items():
        if k in PROCESSES and v is not None:
            out[k] = max(0.0, min(1.0, float(v)))
    return out


def _rng(word: str, seed: int, salt: str) -> random.Random:
    return random.Random(zlib.crc32(f"{seed}|{salt}|{word.lower()}".encode()))


def apply_processes(word: str, phones: list[str], strengths: dict[str, float], seed: int = 0) -> list[str]:
    """Child-speech sound patterns on one word's sounds (ARPAbet with stress)."""
    if not phones or not any(strengths.values()):
        return phones
    p = list(phones)

    def on(name):
        s = strengths.get(name, 0.0)
        return s > 0 and _rng(word, seed, name).random() < s

    def subst(table, only=None):
        return [table.get(x, x) if (only is None or only(i)) else x for i, x in enumerate(p)]

    content = word.lower() not in STOPWORDS
    if on("weak_syllable_deletion") and content:
        syl = syllables(p)
        if len(syl) >= 2:
            weak = [i for i, s in enumerate(syl) if any(is_vowel(x) and x.endswith("0") for x in s)]
            stressed = [i for i, s in enumerate(syl) if any(is_vowel(x) and x[-1] in "12" for x in s)]
            if weak and stressed and weak[0] < stressed[0]:          # "banana" -> "nana"
                del syl[weak[0]]
                p = [x for s in syl for x in s]
    if on("reduplication") and content:
        syl = syllables(p)
        if len(syl) >= 2:
            first = []
            for x in syl[0]:                                           # onset and vowel of the first syllable
                first.append(x)
                if is_vowel(x):
                    break
            p = first + [x[:-1] + "0" if is_vowel(x) else x for x in first]   # "bottle" -> "baba"
    if on("cluster_reduction"):
        out, i = [], 0
        while i < len(p):
            if i + 1 < len(p) and not is_vowel(p[i]) and not is_vowel(p[i + 1]) and (i == 0 or is_vowel(p[i - 1])):
                a, b = p[i], p[i + 1]
                out.append(b if a == "S" else a)                    # "spoon" -> "poon", "tree" -> "tee"
                i += 2
                continue
            out.append(p[i]); i += 1
        p = out
    if on("final_consonant_deletion") and len(p) > 1 and not is_vowel(p[-1]):
        while len(p) > 1 and not is_vowel(p[-1]):
            p.pop()
    if on("velar_fronting"):
        p = subst(VELAR)
    if on("deaffrication"):
        p = subst({"CH": "SH", "JH": "ZH"})
    if on("stopping_fricatives"):
        p = subst(STOPS)
    elif on("frontal_lisp"):
        p = subst(FRICATIVE_LISP)
    if on("stopping_th"):
        p = subst({"TH": "T", "DH": "D"})
    elif on("th_fronting"):
        p = [("F" if x == "TH" else ("D" if i == 0 else "V") if x == "DH" else x) for i, x in enumerate(p)]
    if on("r_vocalization"):
        p = [("AH" + x[-1] if base(x) == "ER" else x) for x in p]
        p = [x for i, x in enumerate(p) if not (x == "R" and i > 0 and is_vowel(p[i - 1])
                                                    and (i + 1 == len(p) or not is_vowel(p[i + 1])))]
    if on("gliding"):
        p = [("W" if x in ("R", "L") and (i + 1 < len(p) and is_vowel(p[i + 1])) else x) for i, x in enumerate(p)]
    if on("consonant_harmony") and content:
        cons = [i for i, x in enumerate(p) if not is_vowel(x)]
        if len(cons) >= 2 and p[cons[-1]] in ("K", "G") and p[cons[0]] in ("D", "T"):
            p[cons[0]] = p[cons[-1]]                                 # "dog" -> "gog"
    return p or phones


# ---------------------------------------------------------------- fluency
def default_fluency(age: float) -> float:
    """1 = completely fluent. Normal developmental hesitations peak at 2-5."""
    return max(0.0, min(1.0, _interp(age, [(1, 0.9), (2.5, 0.72), (4, 0.75), (6, 0.86), (9, 0.93), (14, 0.95),
                                            (30, 0.96), (75, 0.94)])))


FILLERS = {"child": ["um", "uh"], "teen": ["um", "like", "uh"], "adult": ["um", "uh", "you know"]}


def add_disfluencies(text: str, fluency: float, age: float, seed: int = 0) -> str:
    """Repeats, part-word repeats and fillers, as people really hesitate. Markup
    in [brackets] is left alone."""
    level = 1.0 - max(0.0, min(1.0, float(fluency)))
    if level <= 0.02:
        return text
    rng = random.Random(zlib.crc32(f"{seed}|fluency|{text}".encode()))
    fill = FILLERS["child" if age < 12 else "teen" if age < 20 else "adult"]
    out = []
    first_in_sentence = True
    for tok in re.split(r"(\[[^\]]*\]|\s+)", text):
        if not tok or tok.isspace() or tok.startswith("["):
            out.append(tok)
            continue
        m = re.match(r"^([A-Za-z']+)(.*)$", tok)
        if m and rng.random() < level * (0.55 if first_in_sentence else 0.22):
            w, rest = m.groups()
            kind = rng.random()
            if kind < 0.45:
                tok = f"{w}, {w}{rest}"                              # word repeat
            elif kind < 0.7 and len(w) > 2:
                tok = f"{w[0]}- {w[0]}- {w}{rest}"                  # part-word repeat
            elif kind < 0.9:
                tok = f"{rng.choice(fill)}, {w}{rest}"              # filler
            else:
                tok = f"[pause:short] {w}{rest}"                    # brief hold
        out.append(tok)
        first_in_sentence = bool(re.search(r"[.!?]$", tok))
    return "".join(out)


# ---------------------------------------------------- expressive language
IRREGULAR = {"went": "goed", "ran": "runned", "ate": "eated", "came": "comed", "saw": "seed", "fell": "falled",
             "broke": "breaked", "took": "taked", "made": "maked", "gave": "gived", "feet": "foots",
             "mice": "mouses", "children": "childs", "teeth": "tooths", "men": "mans", "caught": "catched",
             "brought": "bringed", "drank": "drinked", "sang": "singed", "found": "finded"}
PREPOSITIONS = set("after before about over under into onto with without up down off out around through".split())
DETERMINERS = set("the a an my your his her our their this that some".split())
FUNCTION = set("""a an the is am are was were be been being to of do does did has have had will would shall
should can could may might must that which""".split())


def simplify_for_age(text: str, age: float, seed: int = 0) -> str:
    """Say a line the way a child of this age would put it. Off by default,
    since it changes the words of the script."""
    if age >= 5:
        return text
    rng = random.Random(zlib.crc32(f"{seed}|simplify|{text}".encode()))
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    out = []
    for s in sentences:
        end = s[-1] if s and s[-1] in ".!?" else "."
        words = re.findall(r"[A-Za-z']+", s)
        if not words:
            continue
        content = [w for w in words if w.lower() not in STOPWORDS and w.lower() not in PREPOSITIONS] or words
        # things first: a word after "the", "a", "my"... is most likely a noun
        nouns = [words[i + 1] for i, w in enumerate(words[:-1]) if w.lower() in DETERMINERS
                 and words[i + 1].lower() not in STOPWORDS] or content
        if age < 1.75:
            out.append(nouns[0].lower() + "!")                                 # one word: ball!
        elif age < 2.5:
            verbs = [w for w in content if w not in nouns]
            pick = [verbs[0], nouns[0]] if verbs else nouns[:2]
            out.append(" ".join(pick).lower() + end)                           # two words: want ball
        else:
            keep = [w for w in words if w.lower() not in FUNCTION or (age >= 3.5 and rng.random() < 0.5)]
            keep = [IRREGULAR.get(w.lower(), w) if rng.random() < (0.6 if age < 4 else 0.35) else w for w in keep]
            out.append(" ".join(keep) + end)                                   # telegraphic, "goed"
    return " ".join(out)


# ---------------------------------------------------------------- pragmatics
REGISTERS = {   # speaking styles: pace, melody, loudness, pauses and the emotion it leans to
    "conversational": {"label": "Conversational", "rate": 0.0, "pitch_range": 0.0, "energy": 0.0},
    "storytelling": {"label": "Storytelling", "rate": -0.25, "pitch_range": 0.45, "energy": 1.0, "emotion": "calm"},
    "formal": {"label": "Formal or presenting", "rate": -0.15, "pitch_range": -0.1, "energy": 1.5, "enunciate": 0.6},
    "playful": {"label": "Playful", "rate": 0.2, "pitch_range": 0.55, "energy": 1.0, "emotion": "happy"},
    "shy": {"label": "Shy or reserved", "rate": -0.2, "pitch_range": -0.35, "energy": -4.0, "emotion": "calm"},
    "confident": {"label": "Confident", "rate": 0.05, "pitch_range": 0.15, "energy": 2.5, "enunciate": 0.3},
    "comforting": {"label": "Comforting", "rate": -0.3, "pitch_range": 0.1, "energy": -2.0, "emotion": "tender"},
    "excited": {"label": "Excited", "rate": 0.35, "pitch_range": 0.6, "energy": 3.0, "emotion": "excited"},
}


def prosody_for(age: float, register: str | None = None) -> dict:
    """Pace, melody and loudness offsets for this age and speaking style."""
    t = voice_targets(age)
    out = {"rate": t["rate"], "pitch_range": t["pitch_range"], "energy": 0.0, "enunciate": 0.0, "emotion": None}
    r = REGISTERS.get(register or "")
    if r:
        for k in ("rate", "pitch_range", "energy", "enunciate"):
            out[k] += r.get(k, 0.0)
        out["emotion"] = r.get("emotion")
    return out


def describe() -> dict:
    """Everything the admin page needs to show the choices."""
    return {"groups": [{"id": k, **v} for k, v in AGE_GROUPS.items()],
            "stages": [{"age": a, "label": l} for a, l in STAGES],
            "processes": [{"id": k, "gone_by": v[0], "label": v[1], "example": v[2]} for k, v in PROCESSES.items()],
            "registers": [{"id": k, "label": v["label"]} for k, v in REGISTERS.items()]}
