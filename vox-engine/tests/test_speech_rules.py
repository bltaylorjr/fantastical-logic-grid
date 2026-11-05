from vox.lexicon.dictionary import Pronouncer
from vox.lexicon.profile import ProfilePronouncer
from vox.lexicon.phonemes import PHONE_INDEX
from vox.development import process_strengths, voice_targets, add_disfluencies, simplify_for_age, default_fluency
from vox.dialects import DIALECTS
base = Pronouncer(None, None)
def say(w, nxt=None, **prof): return ProfilePronouncer(base, prof, 7).word(w, None, nxt)
words = ["rabbit", "cat", "spoon", "banana", "bottle", "sun", "this", "thumb", "bird", "car", "chair", "leg", "dog", "brother", "tree", "fish"]
print("General American:", {w: base.word(w) for w in ["rabbit", "cat", "spoon", "banana"]})
for age in (1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 8):
    on = {k: round(v, 2) for k, v in process_strengths(age).items() if v}
    print(f"age {age}: patterns {len(on)}", {w: say(w, age=age) for w in ["rabbit", "cat", "spoon", "banana", "this", "thumb", "bird"]})
print("adult character who glides R:", say("rabbit", age=30, processes={"gliding": 1}), say("red", age=30, processes={"gliding": 1}))
bad = []
for d in DIALECTS:
    for w in words + ["water", "far", "bath", "time", "pen", "house", "right", "very", "zero", "hand", "day", "ship", "thinking"]:
        out = say(w, nxt="away", dialect=d)
        if out and not all(p in PHONE_INDEX for p in out.split()): bad.append((d, w, out))
assert not bad, bad
show = ["car", "bath", "this", "thinking", "time", "pen", "house", "very", "hot", "day", "fish", "bird"]
for d in ["general_american", "southern_us", "appalachian", "british_rp", "london", "scottish", "irish", "australian", "new_zealand", "indian", "nigerian", "jamaican", "canadian", "filipino"]:
    print(f"{d:18}", " ".join(f"{w}={say(w, dialect=d).replace(' ', '')}" for w in show))
print("linking R (RP): 'far away' ->", say("far", nxt="away", dialect="british_rp"), "| 'far now' ->", say("far", nxt="now", dialect="british_rp"))
print("half accent:", [say(w, dialect="london", accent=0.5) for w in ["think", "thing", "three", "thought"]])
for age, sex in [(1, "male"), (4, "female"), (10, "male"), (14, "male"), (16, "male"), (15, "female"), (32, "male"), (32, "female"), (72, "male")]:
    t = voice_targets(age, sex); print(f"{sex} {age}: f0 {t['f0']:.0f} Hz, formants x{t['formant']:.2f}, rate {t['rate']:+.2f}")
print("fluency defaults:", {a: round(default_fluency(a), 2) for a in (2, 4, 8, 30)})
print("3-year-old hesitations:", add_disfluencies("I want the big red ball. Can we go now?", default_fluency(3), 3, seed=4))
print("stammer level 0.3 adult:", add_disfluencies("Please tell me where the station is.", 0.3, 30, seed=2))
for a in (1.2, 2, 3, 4):
    print(f"simplify age {a}:", simplify_for_age("I went to the park and the dog ran after the ball. The mice were in the house.", a, 1))
assert add_disfluencies("Hello [laugh] there.", 1.0, 30) == "Hello [laugh] there."
assert "[laugh]" in add_disfluencies("Hello [laugh] there friend.", 0.0, 30, 3)
assert say("day", dialect="australian") == "D AY1", say("day", dialect="australian")
print("RULES OK")
