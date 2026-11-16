"""How Whisper writes words (vox/heard.py). Run: python tests/test_heard.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vox.heard import HeardFixer  # noqa: E402

f = HeardFixer()

# Every way of writing "humf" is one spelling, and so are the other sounds.
for w in ["hmph", "humph", "humf", "hmf", "hrmph", "harrumph", "hmphhh"]:
    assert f.fix_text(w) == "humph", (w, f.fix_text(w))
assert f.fix_text("Hmph. I told you so.") == "Humph. I told you so."
assert f.fix_text("Hmmmmm, uh huh, mhm!") == "Hmm, uh-huh, uh-huh!"
assert f.fix_text("Well, umm, I uh... ugh!") == "Well, um, I uh... ugh!"
assert f.fix_text("Shhh! Psst, over here.") == "Shh! Psst, over here."

# Ordinary words are left alone ("hum", "err", "'em").
assert f.fix_text("Tell 'em the hum of the bees; to err is human.") == "Tell 'em the hum of the bees; to err is human."

# A line with "humf" and Whisper's "hmph" count as the same words.
assert f.compare_words("Humf, uh-huh.") == f.compare_words("hmph mm hmm")
assert f.compare_words("Hmmmm, okay.") == f.compare_words("hm okay")

# Your own fixes win, keep capitals, and can join two words.
f.load({"hmph": "humf", "hum f": "humf", "aelith": "Aelith"})
assert f.fix_text("Hmph, hum f.") == "Humf, humf.", f.fix_text("Hmph, hum f.")
assert f.fix_text("aelith said hmmm") == "Aelith said hmm"
assert f.compare_words("humf") == f.compare_words("hmph") == ["humph"]
assert f.fix_words([("Hmph", 0.0, 0.4), ("there", 0.4, 0.7)]) == [("Humf", 0.0, 0.4), ("there", 0.4, 0.7)]

print("heard: all checks pass")
