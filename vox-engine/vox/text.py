"""Text front end: normalization, the script markup game writers use, the
tokenizer, and the prosody planner that adds natural micro-expressions.

Script markup (all optional):
    *word*                    emphasis on a word or phrase
    [breath]                  audible breath
    [pause] [pause:short] [pause:long]
    [laugh] [sigh]
    [warm]...[/warm]          speak a span with a different emotion; any emotion
    [angry 0.6]...[/angry]    name works, with an optional intensity 0-1
    ...                       trailing-off pause;  --  short break

The tokenizer reads UTF-8 bytes, so any language works with no extra
dictionaries or paid phonemizer.
"""
from __future__ import annotations

import random
import re
from dataclasses import dataclass, field

from .config import EMOTIONS

# --------------------------------------------------------------------- vocabulary
PAD = 0
SPECIALS = ["breath", "pause_s", "pause_m", "pause_l", "laugh", "sigh",
            "emph_open", "emph_close", "rise", "fall"]
SPECIAL_ID = {name: i + 1 for i, name in enumerate(SPECIALS)}
BYTE_OFFSET = len(SPECIALS) + 1
PHONE_OFFSET = BYTE_OFFSET + 256
from .lexicon.phonemes import PHONE_INDEX, PHONE_SET  # noqa: E402

# Text is fed to the model as bytes (letters of any language) and, for
# English words, as phonemes (sounds) from the dictionary.
VOCAB_SIZE = PHONE_OFFSET + len(PHONE_SET)

WH_WORDS = {"who", "what", "when", "where", "why", "how", "which", "whose", "whom"}


def encode_text(s: str) -> list[int]:
    return [b + BYTE_OFFSET for b in s.encode("utf-8")]


def decode_tokens(ids: list[int]) -> str:
    out, buf = [], bytearray()
    for i in ids:
        if i >= PHONE_OFFSET:
            if buf:
                out.append(buf.decode("utf-8", "replace")); buf = bytearray()
            out.append("/" + PHONE_SET[i - PHONE_OFFSET] + "/")
        elif i >= BYTE_OFFSET:
            buf.append(i - BYTE_OFFSET)
        else:
            if buf:
                out.append(buf.decode("utf-8", "replace")); buf = bytearray()
            if i != PAD:
                out.append(f"[{SPECIALS[i - 1]}]")
    if buf:
        out.append(buf.decode("utf-8", "replace"))
    return "".join(out)


# ----------------------------------------------------------------- normalization
_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
         "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
         "sixteen", "seventeen", "eighteen", "nineteen"]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
         "eighty", "ninety"]
_SCALES = [(10 ** 12, "trillion"), (10 ** 9, "billion"), (10 ** 6, "million"),
           (1000, "thousand"), (100, "hundred")]
_ABBREV = {"mr.": "mister", "mrs.": "missus", "dr.": "doctor", "st.": "saint",
           "lt.": "lieutenant", "capt.": "captain", "sgt.": "sergeant",
           "vs.": "versus", "etc.": "et cetera", "hp": "H P", "xp": "X P"}


def number_to_words(n: int) -> str:
    if n < 0:
        return "minus " + number_to_words(-n)
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ("" if n % 10 == 0 else "-" + _ONES[n % 10])
    for value, name in _SCALES:
        if n >= value:
            head, rest = divmod(n, value)
            words = number_to_words(head) + " " + name
            return words + ("" if rest == 0 else " " + number_to_words(rest))
    return str(n)


def _ordinal(n: int) -> str:
    w = number_to_words(n)
    irregular = {"one": "first", "two": "second", "three": "third", "five": "fifth",
                 "eight": "eighth", "nine": "ninth", "twelve": "twelfth"}
    last = re.split(r"[ -]", w)[-1]
    if last in irregular:
        return w[: -len(last)] + irregular[last]
    if last.endswith("y"):
        return w[:-1] + "ieth"
    return w + "th"


def normalize(text: str) -> str:
    """Spell out numbers, currency, percents and common abbreviations."""
    t = text.replace("’", "'").replace("“", '"').replace("”", '"')
    t = t.replace("—", " -- ").replace("…", "...")
    for k, v in _ABBREV.items():
        t = re.sub(rf"(?i)\b{re.escape(k)}(?=\s|$)", v, t)
    t = re.sub(r"\$(\d+)\.(\d{2})\b", lambda m: f"{number_to_words(int(m[1]))} dollars "
               f"and {number_to_words(int(m[2]))} cents", t)
    t = re.sub(r"\$(\d+)", lambda m: number_to_words(int(m[1])) + " dollars", t)
    t = re.sub(r"(\d+)%", lambda m: number_to_words(int(m[1])) + " percent", t)
    t = re.sub(r"\b(\d+)(st|nd|rd|th)\b", lambda m: _ordinal(int(m[1])), t)
    t = re.sub(r"\b(\d+)\.(\d+)\b", lambda m: number_to_words(int(m[1])) + " point " +
               " ".join(_ONES[int(d)] for d in m[2]), t)
    t = re.sub(r"\b\d{1,15}\b", lambda m: number_to_words(int(m[0].replace(",", ""))), t)
    return re.sub(r"[ \t]+", " ", t).strip()


# --------------------------------------------------------------------- parsing
@dataclass
class SpanStyle:
    emotion: str
    intensity: float = 0.8


@dataclass
class Chunk:
    """One piece of speech the model generates in a single pass."""
    tokens: list[int]
    plain: str                                   # readable text, no markup
    spans: list[tuple[int, int, SpanStyle]] = field(default_factory=list)
    end_punct: str = "."

    @property
    def is_question(self) -> bool:
        return self.end_punct == "?"


_TAG = re.compile(r"\[(/?)([a-zA-Z_]+)(?::([a-z]+))?(?:\s+([0-9.]+))?\]")


def _pieces(text: str):
    """Yield ('char', c, style, emph) and ('special', name, style, emph) pieces."""
    style_stack: list[SpanStyle] = []
    emph = False
    i = 0
    while i < len(text):
        m = _TAG.match(text, i)
        if m:
            closing, name, arg, num = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
            cur = style_stack[-1] if style_stack else None
            if name == "breath":
                yield ("special", "breath", cur, emph)
            elif name == "pause":
                yield ("special", {"short": "pause_s", "long": "pause_l"}.get(arg, "pause_m"), cur, emph)
            elif name in ("laugh", "sigh"):
                yield ("special", name, cur, emph)
            elif name in EMOTIONS or name == "warm":
                emo = "tender" if name == "warm" else name
                if closing:
                    if style_stack:
                        style_stack.pop()
                else:
                    style_stack.append(SpanStyle(emo, float(num) if num else 0.8))
            # unknown tags are dropped silently so a typo never breaks a line
            i = m.end()
            continue
        c = text[i]
        if c == "*":
            emph = not emph
            yield ("special", "emph_open" if emph else "emph_close", None, emph)
            i += 1
            continue
        if text.startswith("...", i):
            yield ("char", "...", style_stack[-1] if style_stack else None, emph)
            yield ("special", "pause_m", None, emph)
            i += 3
            continue
        if text.startswith("--", i):
            yield ("special", "pause_s", None, emph)
            i += 2
            continue
        yield ("char", c, style_stack[-1] if style_stack else None, emph)
        i += 1


def parse_script(text: str, max_chars: int = 220, auto_expressions: bool = True,
                 seed: int = 0) -> list[Chunk]:
    """Turn a line of game dialogue into model-ready chunks.

    Splits at sentence ends (and at commas if a sentence is too long), keeps
    style spans attached to the right tokens, and (optionally) runs the prosody
    planner to add breaths and question intonation.
    """
    text = normalize(text)
    sentences: list[list] = [[]]
    for p in _pieces(text):
        sentences[-1].append(p)
        if p[0] == "char" and p[1] in ".!?" and not (p[1] == "." and _is_abbrev(sentences[-1])):
            sentences.append([])
    sentences = [s for s in sentences if any(p[0] == "char" and p[1].strip() for p in s)]

    # split over-long sentences at commas / semicolons
    split: list[list] = []
    for s in sentences:
        cur: list = []
        for p in s:
            cur.append(p)
            if p[0] == "char" and p[1] in ",;:" and sum(q[0] == "char" for q in cur) > max_chars * 0.6:
                split.append(cur); cur = []
        if cur:
            split.append(cur)

    # pack sentences into chunks up to max_chars
    chunks_p: list[list] = []
    for s in split:
        n = sum(len(p[1]) for p in s if p[0] == "char")
        if chunks_p and sum(len(p[1]) for p in chunks_p[-1] if p[0] == "char") + n <= max_chars:
            chunks_p[-1].extend(s)
        else:
            chunks_p.append(list(s))

    rng = random.Random(seed)
    chunks = [_build_chunk(c) for c in chunks_p]
    if auto_expressions:
        plan_expressions(chunks, rng)
    return chunks


def _is_abbrev(pieces) -> bool:
    word = "".join(p[1] for p in pieces[-6:] if p[0] == "char").split(" ")[-1].lower()
    return word in {"e.g.", "i.e.", "a.m.", "p.m."}


def _build_chunk(pieces) -> Chunk:
    tokens: list[int] = []
    plain: list[str] = []
    spans: list[tuple[int, int, SpanStyle]] = []
    open_style, open_start = None, 0
    for kind, val, style, _ in pieces:
        if style is not open_style:
            if open_style is not None:
                spans.append((open_start, len(tokens), open_style))
            open_style, open_start = style, len(tokens)
        if kind == "special":
            tokens.append(SPECIAL_ID[val])
        else:
            if not tokens and not val.strip():
                continue  # strip leading space
            tokens.extend(encode_text(val)); plain.append(val)
    if open_style is not None:
        spans.append((open_start, len(tokens), open_style))
    text = "".join(plain).strip()
    end = next((c for c in reversed(text) if c in ".!?"), ".")
    return Chunk(tokens=tokens, plain=text, spans=spans, end_punct=end)


# --------------------------------------------------------------- prosody planner
def plan_expressions(chunks: list[Chunk], rng: random.Random) -> None:
    """Add the small human touches a fixed-cadence TTS lacks:

    * Yes/no questions get a rising tune on the last word; wh-questions fall.
    * A breath before a chunk that follows a long one (people run out of air).
    * A breath before the next sentence after an exclamation.
    Explicit markup from the writer always wins: if a chunk already has a
    breath or intonation marker, the planner leaves it alone.
    """
    prev_words = 0
    for ch in chunks:
        words = ch.plain.split()
        has_breath = SPECIAL_ID["breath"] in ch.tokens
        has_tune = SPECIAL_ID["rise"] in ch.tokens or SPECIAL_ID["fall"] in ch.tokens
        if ch.is_question and not has_tune and words:
            marker = SPECIAL_ID["fall"] if words[0].lower().strip(",") in WH_WORDS else SPECIAL_ID["rise"]
            _insert_before_last_word(ch, marker)
        if not has_breath and prev_words >= 14 and rng.random() < 0.7:
            ch.tokens.insert(0, SPECIAL_ID["breath"])
            ch.spans = [(a + 1, b + 1, s) for a, b, s in ch.spans]
        prev_words = len(words)


def _insert_before_last_word(ch: Chunk, marker: int) -> None:
    space = BYTE_OFFSET + ord(" ")
    idx = max((i for i, t in enumerate(ch.tokens) if t == space), default=-1) + 1
    ch.tokens.insert(idx, marker)
    ch.spans = [(a + (a >= idx), b + (b > idx), s) for a, b, s in ch.spans]


def script_tokens(text: str, pronouncer=None, keep_letters: float = 0.0, rng=None) -> list[int]:
    """Whole text as one token sequence (markup kept, no auto expressions).
    Used for training targets and for editing."""
    out: list[int] = []
    for c in parse_script(text, max_chars=10 ** 6, auto_expressions=False):
        if pronouncer is not None:
            c = phonemize_chunk(c, pronouncer, keep_letters, rng)
        out += (encode_text(" ") if out else []) + c.tokens
    return out


_WORD_BYTES = re.compile(rb"(?<![A-Za-z'\x80-\xff])[A-Za-z][A-Za-z']*(?![A-Za-z'\x80-\xff])")


def phonemize_chunk(ch: Chunk, pronouncer, keep_letters: float = 0.0, rng=None) -> Chunk:
    """Replace English words with their sounds. Words in other alphabets,
    markup and punctuation stay as they are. keep_letters: chance a word stays
    spelled out (used in training so the model can read both)."""
    toks = ch.tokens
    runs, i = [], 0
    while i < len(toks):                    # runs of byte tokens
        if BYTE_OFFSET <= toks[i] < PHONE_OFFSET:
            j = i
            while j < len(toks) and BYTE_OFFSET <= toks[j] < PHONE_OFFSET:
                j += 1
            runs.append((i, j)); i = j
        else:
            i += 1
    words = []                              # (start, end, text) in token positions
    for a, b in runs:
        raw = bytes(t - BYTE_OFFSET for t in toks[a:b])
        for m in _WORD_BYTES.finditer(raw):
            words.append((a + m.start(), a + m.end(), m.group().decode("ascii")))
    if not words:
        return ch
    new, newpos, k = [], [0] * (len(toks) + 1), 0
    i = 0
    for idx, (a, b, w) in enumerate(words):
        while i < a:
            newpos[i] = len(new); new.append(toks[i]); i += 1
        prev = words[idx - 1][2] if idx else None
        nxt = words[idx + 1][2] if idx + 1 < len(words) else None
        arp = None if (rng is not None and rng.random() < keep_letters) else pronouncer.word(w, prev, nxt)
        phones = [PHONE_OFFSET + PHONE_INDEX[p] for p in (arp or "").split() if p in PHONE_INDEX]
        for t in range(a, b):
            newpos[t] = len(new)
        new.extend(phones if phones else toks[a:b])
        i = b
    while i < len(toks):
        newpos[i] = len(new); new.append(toks[i]); i += 1
    newpos[len(toks)] = len(new)
    spans = [(newpos[a], newpos[b], st) for a, b, st in ch.spans]
    return Chunk(tokens=new, plain=ch.plain, spans=spans, end_punct=ch.end_punct)


def words_of(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z']+", text.lower())
