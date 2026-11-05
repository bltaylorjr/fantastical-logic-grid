"""Words spelled alike but said differently depending on use:
"I will *record* a new *record*", "I *read* it yesterday, now I *read* it again".
The surrounding words decide which pronunciation is used."""
from __future__ import annotations

DETERMINERS = {"the", "a", "an", "my", "your", "his", "her", "our", "their", "its", "this", "that", "these",
               "those", "no", "every", "each", "some", "any", "of", "another", "which", "whose"}
VERB_CUES = {"to", "will", "would", "can", "could", "should", "must", "may", "might", "shall", "i", "you", "we",
             "they", "he", "she", "it", "don't", "didn't", "doesn't", "won't", "can't", "not", "please", "let's",
             "never", "always", "often", "cannot", "and", "or"}
BE_CUES = {"am", "is", "are", "was", "were", "be", "been", "feel", "felt", "seem", "seems", "quite", "very", "so",
           "too", "i'm", "you're", "we're", "they're", "he's", "she's", "it's"}
PAST_CUES = {"have", "has", "had", "was", "were", "been", "i've", "you've", "we've", "they've", "already",
             "i'd", "you'd", "he'd", "she'd", "we'd", "they'd", "just"}
PAST_AFTER = {"yesterday", "last", "earlier", "before", "ago"}

# word: (default pronunciation, alternative pronunciation, rule that picks the alternative)
TABLE = {
    "record": ("R EH1 K ER0 D", "R IH0 K AO1 R D", "verb"),
    "present": ("P R EH1 Z AH0 N T", "P R IY0 Z EH1 N T", "verb"),
    "object": ("AA1 B JH EH0 K T", "AH0 B JH EH1 K T", "verb"),
    "permit": ("P ER1 M IH2 T", "P ER0 M IH1 T", "verb"),
    "project": ("P R AA1 JH EH0 K T", "P R AH0 JH EH1 K T", "verb"),
    "produce": ("P R OW1 D UW0 S", "P R AH0 D UW1 S", "verb"),
    "refuse": ("R IH0 F Y UW1 Z", "R EH1 F Y UW2 Z", "determiner"),
    "subject": ("S AH1 B JH IH0 K T", "S AH0 B JH EH1 K T", "verb"),
    "conduct": ("K AA1 N D AH0 K T", "K AH0 N D AH1 K T", "verb"),
    "contract": ("K AA1 N T R AE2 K T", "K AH0 N T R AE1 K T", "verb"),
    "convict": ("K AA1 N V IH0 K T", "K AH0 N V IH1 K T", "verb"),
    "increase": ("IH1 N K R IY2 S", "IH0 N K R IY1 S", "verb"),
    "decrease": ("D IY1 K R IY2 S", "D IH0 K R IY1 S", "verb"),
    "insult": ("IH1 N S AH0 L T", "IH0 N S AH1 L T", "verb"),
    "rebel": ("R EH1 B AH0 L", "R IH0 B EH1 L", "verb"),
    "progress": ("P R AA1 G R EH2 S", "P R AH0 G R EH1 S", "verb"),
    "desert": ("D EH1 Z ER0 T", "D IH0 Z ER1 T", "verb"),
    "console": ("K AA1 N S OW0 L", "K AH0 N S OW1 L", "verb"),
    "entrance": ("EH1 N T R AH0 N S", "IH0 N T R AE1 N S", "verb"),
    "excuse": ("IH0 K S K Y UW1 S", "IH0 K S K Y UW1 Z", "verb"),
    "abuse": ("AH0 B Y UW1 S", "AH0 B Y UW1 Z", "verb"),
    "use": ("Y UW1 Z", "Y UW1 S", "determiner"),
    "house": ("HH AW1 S", "HH AW1 Z", "verb"),
    "content": ("K AA1 N T EH0 N T", "K AH0 N T EH1 N T", "be"),
    "separate": ("S EH1 P ER0 EY2 T", "S EH1 P ER0 AH0 T", "be_or_det"),
    "estimate": ("EH1 S T AH0 M AH0 T", "EH1 S T AH0 M EY2 T", "verb"),
    "moderate": ("M AA1 D ER0 AH0 T", "M AA1 D ER0 EY2 T", "verb"),
    "graduate": ("G R AE1 JH UW0 AH0 T", "G R AE1 JH UW0 EY2 T", "verb"),
    "alternate": ("AO1 L T ER0 N AH0 T", "AO1 L T ER0 N EY2 T", "verb"),
    "associate": ("AH0 S OW1 S IY0 AH0 T", "AH0 S OW1 S IY0 EY2 T", "verb"),
    "invalid": ("IH0 N V AE1 L IH0 D", "IH1 N V AH0 L IH0 D", "determiner"),
    "read": ("R IY1 D", "R EH1 D", "past"),
    "close": ("K L OW1 S", "K L OW1 Z", "close"),
    "live": ("L IH1 V", "L AY1 V", "live"),
    "lead": ("L IY1 D", "L EH1 D", "lead"),
    "wind": ("W IH1 N D", "W AY1 N D", "verb_strict"),
    "tear": ("T IH1 R", "T EH1 R", "tear"),
    "bow": ("B AW1", "B OW1", "bow"),
    "bass": ("B EY1 S", "B AE1 S", "bass"),
    "wound": ("W UW1 N D", "W AW1 N D", "wound"),
    "dove": ("D AH1 V", "D OW1 V", "dove"),
    "minute": ("M IH1 N AH0 T", "M AY0 N UW1 T", "be"),
    "row": ("R OW1", "R AW1", "never"),
    "sow": ("S OW1", "S AW1", "never"),
    "does": ("D AH1 Z", "D OW1 Z", "never"),
}

LABELS = {"verb": ("as a noun", "as a verb"), "determiner": ("as a verb", "as a noun"),
          "be": ("as a noun", "describing something"), "be_or_det": ("as a verb", "describing something"),
          "past": ("present tense", "past tense"), "close": ("near", "to shut"), "live": ("to live", "happening now"),
          "lead": ("to guide", "the metal"), "verb_strict": ("moving air", "to turn"), "tear": ("from crying", "to rip"),
          "bow": ("bending forward, front of a ship", "weapon or ribbon"), "bass": ("low sound", "the fish"),
          "wound": ("an injury", "turned (past of wind)"), "dove": ("the bird", "past of dive"),
          "never": ("usual", "other meaning")}


def choose(word: str, prev: str | None, nxt: str | None) -> str | None:
    w = word.lower()
    if w not in TABLE:
        return None
    default, alt, rule = TABLE[w]
    p, n = (prev or "").lower(), (nxt or "").lower()
    pick_alt = {
        "verb": p in VERB_CUES and p not in DETERMINERS,
        "verb_strict": p in {"to", "will", "would", "can", "could", "should", "must", "please", "don't"},
        "determiner": p in DETERMINERS,
        "be": p in BE_CUES,
        "be_or_det": p in BE_CUES or p in DETERMINERS or n in {"rooms", "ways", "parts", "pieces", "from"},
        "past": p in PAST_CUES or n in PAST_AFTER,
        "close": (n in {"the", "a", "an", "your", "my", "it", "this", "that", "up", "down", "off", "them", "his", "her"}
                  or p in {"to", "please", "will", "would", "can", "could", "should", "must", "don't", "i", "we", "they"}),
        "live": n in {"music", "show", "broadcast", "performance", "wire", "bait", "stream", "audience", "action", "fire",
                      "ammunition", "concert", "event", "feed", "coverage", "version", "recording"} or p in {"go", "went", "is", "are", "was", "be"},
        "lead": n in {"pipe", "pipes", "paint", "pencil", "poisoning", "weight", "weights", "bullet", "bullets", "shot", "balloon"}
                or p in {"of", "with"} and n not in {"us", "them", "you", "the", "me", "him", "her"},
        "tear": n in {"up", "apart", "down", "off", "open", "through", "into", "it", "the", "out"} or p in {"to", "will", "would", "don't"},
        "bow": p in DETERMINERS and n != "of" or n in {"and", "arrow", "arrows", "tie", "string", "strings"},
        "bass": n in {"fishing", "boat", "boats", "lake", "pond"} or p in {"caught", "sea", "largemouth", "smallmouth", "striped"},
        "wound": p in {"had", "was", "have", "were", "been", "got", "has", "i", "he", "she", "they", "we"} and
                 n in {"up", "around", "down", "the", "it", "through", "its", "his", "her", "my"},
        "dove": p in {"he", "she", "they", "i", "we", "it", "then", "and", "who"} or n in {"into", "in", "under", "off", "for", "down"},
        "never": False,
    }[rule]
    return alt if pick_alt else default


def variants(word: str) -> list[dict]:
    w = word.lower()
    if w not in TABLE:
        return []
    default, alt, rule = TABLE[w]
    a, b = LABELS.get(rule, ("usual", "other"))
    return [{"arpabet": default, "usage": a}, {"arpabet": alt, "usage": b}]
