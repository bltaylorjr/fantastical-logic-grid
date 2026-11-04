#!/usr/bin/env python3
"""Build the Crossword game's word and clue list: engine/src/crossword-words.js.

Every answer and every clue comes from a dictionary, never made up:

  * Answers are WordNet 3.0 words and phrases (Princeton University; free to
    use, copy and sell with its notice kept: see engine/src/crossword-words.js).
  * How common a word is (its fill score) comes from wordfreq's English counts
    (Robyn Speer; data CC BY-SA 4.0). Only a 0-100 score per answer is kept.
  * Clues are WordNet's own data for that exact answer:
      def   its definition, shortened ("Strong emotion")
      syn   another word with the same meaning ("Ire")
      kind  what it is a kind of ("Kind of tree")
      fitb  a WordNet phrase it completes ("___ cream")
      some  for plurals: "Some trees"
    A clue is dropped if it gives the answer away (shares a word or a word root
    with it), is too long, or comes from a sense marked offensive or slang.
  * Verb forms (AMENDED, AMENDING, AMENDS) and noun plurals come from
    LemmInflect (MIT) and inflect (MIT), and their clues are the same dictionary
    clues put in the same form, as crossword clues must be: "Make better" ->
    "Made better", "Small rodent" -> "Small rodents".
  * Words on the LDNOOBW list (CC BY 4.0) and senses WordNet marks offensive,
    vulgar, derogatory or slang are left out entirely.

Run:  NLTK_ALLOW_PROXIED_URLOPEN=1 python3 scripts/crossword/build-lexicon.py <bad-words.txt>
"""
import json, re, sys
from collections import defaultdict

import nltk
nltk.download('wordnet', quiet=True)
from nltk.corpus import wordnet as wn
from wordfreq import zipf_frequency
import inflect
from lemminflect import getInflection

ENG = inflect.engine()
OUT = 'engine/src/crossword-words.js'
MIN_LEN, MAX_LEN = 3, 21
BAD_SENSE = re.compile(r'\b(offensive|derogatory|vulgar|obscene|slang|disparaging|slur|taboo|profane|street names?|sex|sexual|sexually|erotic|genitals?|genitalia|intercourse|copulat\w*|prostitut\w*|pornograph\w*|narcotic|orgasm|masturbat\w*|lewd|obscenity)\b', re.I)
# Glosses that are notes, not definitions.
NOT_A_DEF = re.compile(r'^(sometimes|formerly|often|usually) (placed|included|classified|considered|treated)|^(used|also|see|of|any|one|either|each)\b', re.I)
# "Kind of ..." only names something concrete; these are too vague to be a clue.
VAGUE = set('''man woman person people object thing entity whole unit act event state group part matter abstraction
attribute relation measure content communication cognition channel way form kind type quality property condition
situation activity action change statement message idea concept structure instrumentality device container
artifact being organism someone somebody worker expert adult material substance feeling time period point
location region area place instrument implement system process work show individual commodity product article'''.split())
KIND_LEX = {'noun.animal', 'noun.plant', 'noun.food', 'noun.artifact', 'noun.substance', 'noun.body'}
# Extra words a family puzzle never uses, on top of the LDNOOBW list.
EXTRA_BAD = set('''
nazi hitler rape raped rapist incest pedophile molest suicide genocide holocaust lynch lynching slave slavery
eroticism erotica psychosexual heroin cocaine meth crack opium nigger nigga negro coon spic chink gook kike wetback faggot fag dyke tranny retard
retarded cripple midget whore slut bitch bastard damn hell crap piss tit tits boob boobs butt ass arse
'''.split())

bad = set(EXTRA_BAD)
if len(sys.argv) > 1:
    for line in open(sys.argv[1], encoding='utf-8'):
        w = line.strip().lower()
        if w:
            bad.add(w)

def letters(s):
    return re.sub(r'[^A-Za-z]', '', s).upper()

def tokens(s):
    return [t for t in re.split(r'[^a-z]+', s.lower()) if t]

def is_bad(phrase):
    p = phrase.lower().replace('_', ' ')
    if p in bad:
        return True
    return any(t in bad for t in tokens(p))

def common_prefix(a, b):
    n = 0
    while n < len(a) and n < len(b) and a[n] == b[n]:
        n += 1
    return n

def same_root(a, b):
    """True when two words share a root: one inside the other, or the same start."""
    if a == b:
        return True
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    if len(short) >= 3 and short in long_:
        return True
    p = common_prefix(a, b)
    if p >= 4 or (p >= 3 and min(len(a), len(b)) <= 6):
        return True
    return False

def gives_away(clue, answer_tokens, answer_letters):
    ct = tokens(clue)
    for c in ct:
        for a in answer_tokens:
            if same_root(c, a):
                return True
    joined = ''.join(ct).upper()
    if len(answer_letters) >= 4 and answer_letters in joined:
        return True
    return False

ARTICLE = re.compile(r'^(a|an|the)\s+', re.I)
UNKIND = re.compile(r'\b(unattractive|contemptible|despicable|reprehensible|stupid|ugly|spiteful|obnoxious|worthless)\b', re.I)
# Where a long definition can be cut and stay true: what comes before is the
# general idea ("feline mammal usually having thick soft fur" -> "Feline mammal").
CUT = re.compile(r'\s(?:that|which|who|whose|usually|typically|often|having|containing|including|esp|especially)\s|,|:|\s\(')
DANGLING = set('or and of in at to for by as with from on a an the that which who into than'.split())

def tidy(d):
    d = re.sub(r'\([^)]*\)', '', d)
    d = re.sub(r'\s+', ' ', d).strip(' ,.:')
    d = re.sub(r'^of or (relating|pertaining) to', 'Relating to', d, flags=re.I)
    d = re.sub(r'^relating to or (characteristic|characterized) of', 'Relating to', d, flags=re.I)
    d = ARTICLE.sub('', d)
    d = re.sub(r'^to\s+', '', d, flags=re.I)
    d = ARTICLE.sub('', d)
    return d

def clean_defs(gloss):
    """Ways to say a WordNet definition as a clue, best first. Every one is true."""
    g = gloss.split(';')[0]
    if UNKIND.search(g):
        return []
    m = re.match(r'^(?:any|one|either|each) of (?:numerous|several|various|many|a number of|the|two|three)?\s*(.*)$', g.strip(), re.I)
    if m:
        # "any of numerous small rodents typically ..." -> "Small rodent"
        rest = re.split(r'\b(?:that|which|who|typically|usually|having|with|of|in|found|esp|especially|native|from|resembling|related|similar)\b|,', m.group(1))[0].split()
        if len(rest) < 2 or len(rest) > 5:
            return []
        sing = ENG.singular_noun(rest[-1])
        if not sing:
            return []
        g = ' '.join(rest[:-1] + [sing])
    out = []
    full = tidy(g)
    cut = tidy(CUT.split(' ' + g.strip(), 1)[0])
    for d in (full, cut):
        if not d or '"' in d or '`' in d or NOT_A_DEF.search(d):
            continue
        n = len(d.split())
        if n > 12 or len(d) > 80 or (d is not full and n < 2):
            continue
        last = d.split()[-1].lower()
        if last in DANGLING or (d is not full and last.endswith('ed') and len(d.split()) <= 3):
            continue
        d = d[0].upper() + d[1:]
        if d not in out:
            out.append(d)
    return out

def s_not_main(syn, word):
    """True when this sense is not among the word's own main meanings."""
    return syn not in wn.synsets(word)[:3]

def zipf(phrase):
    return zipf_frequency(phrase.replace('_', ' ').replace('-', ' '), 'en')

def nice(word):
    w = word.replace('_', ' ')
    return w[0].upper() + w[1:]

# ---------- collect answers ----------

entries = {}  # LETTERS -> dict
def entry(ans):
    e = entries.get(ans)
    if not e:
        e = entries[ans] = {'z': -1, 'phrase': '', 'clues': {}, 'proper': True}
    return e

def add_clue(e, text, kind, level):
    key = text.lower()
    old = e['clues'].get(key)
    if old is None or level < old[1]:
        e['clues'][key] = (text, level, kind)

# Phrases each single word appears in, for fill-in-the-blank clues.
phrase_of = defaultdict(list)
for name in wn.all_lemma_names():
    if '_' not in name:
        continue
    parts = name.split('_')
    if len(parts) not in (2, 3) or any(not p.isalpha() or not p.islower() for p in parts):
        continue
    # Only a phrase used in its everyday sense (WordNet writes names with capitals).
    if not any(l.name() == name for syn in wn.synsets(name)[:1] for l in syn.lemmas()):
        continue
    z = zipf(name)
    if z < 3.0 or is_bad(name):
        continue
    for i, p in enumerate(parts):
        if len(p) >= 3:
            phrase_of[p.lower()].append((z, parts, i))

seen_lemmas = 0
for name in wn.all_lemma_names():
    raw = name.replace('_', ' ')
    ans = letters(raw)
    if not (MIN_LEN <= len(ans) <= MAX_LEN):
        continue
    if re.search(r'[0-9]', name) or is_bad(name):
        continue
    if not re.fullmatch(r"[A-Za-z][A-Za-z '\-_.]*", name):
        continue
    z = zipf(name)
    multi = '_' in name or '-' in name
    if z < (2.0 if multi else 2.0):
        continue
    parts = re.split(r'[_\- ]+', name)
    # Long phrases and "in a ... way" adverbs make poor answers unless very well known.
    if multi and (len(parts) > 3 or (len(parts) == 3 and z < 3.0) or re.match(r'^in_an?_', name.lower())):
        continue
    synsets = wn.synsets(name)
    if not synsets:
        continue
    seen_lemmas += 1
    synsets = synsets
    ans_tokens = tokens(raw)
    if multi:
        # wordfreq guesses a phrase's frequency from its words, which flatters
        # rare pairings ("drain basket"). Phrases start lower, and get back some
        # of it when WordNet's tagged texts actually use them.
        used = sum(l.count() for syn in synsets for l in syn.lemmas() if l.name().lower() == name.lower())
        z = z - 1.2 + (0.9 if used > 0 else 0)
    e = entry(ans)
    e['z'] = max(e['z'], z)
    if multi and not e['phrase']:
        e['phrase'] = raw.lower()
    good_senses = 0
    for rank, s in enumerate(synsets[:6]):
        d = s.definition()
        if BAD_SENSE.search(d) or s.lexname() in ('noun.Tops',):
            if rank == 0:
                break  # the main sense is offensive or slang: skip the word
            continue
        # The lemma as WordNet writes it in this sense (capitals mean a name).
        lem = next((l for l in s.lemmas() if l.name().lower() == name.lower()), None)
        if lem is None:
            continue
        proper = lem.name()[0].isupper()
        if not proper:
            e['proper'] = False
        good_senses += 1
        base = 0 if rank == 0 else 1 if rank <= 2 else 2
        # def: the definition
        for cd in clean_defs(d):
            if not gives_away(cd, ans_tokens, ans):
                add_clue(e, cd, 'def', base)
                break
        # syn: another word for it in the same sense
        for other in s.lemmas():
            on = other.name()
            if on.lower() == name.lower() or is_bad(on):
                continue
            ot = on.replace('_', ' ')
            if len(ot.split()) > 3 or not re.fullmatch(r"[A-Za-z][A-Za-z '\-]*", ot):
                continue
            oz = zipf(on)
            if oz < 3.0 or len(letters(on)) < 3 or gives_away(ot, ans_tokens, ans):
                continue
            # Only a word whose own main meanings include this one: "Ire", not "Ira".
            if s not in wn.synsets(on)[:3]:
                continue
            add_clue(e, nice(on) if not on[0].isupper() else ot, 'syn', base + (0 if oz >= 4 else 1))
        # kind: what it is a kind of (nouns)
        if s.pos() == 'n' and not proper and s.lexname() in KIND_LEX:
            for h in s.hypernyms()[:1]:
                hn = next((l.name() for l in h.lemmas() if zipf(l.name()) >= 4.0 and '_' not in l.name() and l.name().lower() not in VAGUE), None)
                if hn and not is_bad(hn) and not gives_away(hn, ans_tokens, ans):
                    add_clue(e, f'Kind of {hn.replace("_", " ")}', 'kind', base + 1)
    if good_senses == 0 or not e['clues']:
        del entries[ans]
        continue
    # fitb: a common phrase this word completes
    if not multi:
        for (pz, parts, i) in sorted(phrase_of.get(name.lower(), []), reverse=True)[:3]:
            if parts[i].lower() != name.lower():
                continue
            others = [p for j, p in enumerate(parts) if j != i]
            if any(gives_away(o, ans_tokens, ans) for o in others):
                continue
            shown = ' '.join('___' if j == i else p.lower() for j, p in enumerate(parts))
            add_clue(e, shown[0].upper() + shown[1:] if shown[0] != '_' else shown, 'fitb', 1 if pz >= 3.8 else 2)

# ---------- verb forms ----------
PREP = re.compile(r'^(of|for|in|on|with|that|which|who|used|from|by|made|to|at|as|into|without|having|containing)$', re.I)

def inflect_first(text, tag):
    """Put a clue's leading verb in the given form; None if it does not lead with a plain verb."""
    words = text.split()
    fw = words[0].lower()
    if not re.fullmatch(r'[a-z]+', fw) or not wn.synsets(fw, 'v') or wn.morphy(fw, 'v') != fw:
        return None
    if fw == 'be':
        form = {'VBD': 'was', 'VBG': 'being', 'VBZ': 'is'}[tag]
    else:
        forms = getInflection(fw, tag)
        if len(forms) != 1:
            return None
        form = forms[0]
    out = ' '.join([form] + words[1:])
    return out[0].upper() + out[1:]

verb_added = 0
for name in wn.all_lemma_names('v'):
    if not name.isalpha() or not name.islower() or is_bad(name):
        continue
    if zipf(name) < 2.4:
        continue
    vs = [syn for syn in wn.synsets(name, 'v')[:3] if not BAD_SENSE.search(syn.definition())]
    if not vs:
        continue
    for tag in ('VBD', 'VBG', 'VBZ'):
        forms = getInflection(name, tag)
        if len(forms) != 1:
            continue
        form = forms[0]
        F = letters(form)
        if not (MIN_LEN <= len(F) <= MAX_LEN) or F == letters(name) or is_bad(form):
            continue
        fz = zipf(form)
        if fz < 2.0:
            continue
        clues = {}
        toks = [form, name]
        for rank, syn in enumerate(vs):
            base = 0 if rank == 0 else 1
            for cd in clean_defs(syn.definition()):
                c = inflect_first(cd, tag)
                if c and not gives_away(c, toks, F):
                    clues.setdefault(c.lower(), (c, base, 'def'))
                    break
            for other in syn.lemmas():
                on = other.name()
                if on.lower() == name or is_bad(on) or zipf(on) < 3.0 or s_not_main(syn, on):
                    continue
                c = inflect_first(on.replace('_', ' '), tag)
                if c and len(c.split()) <= 3 and not gives_away(c, toks, F):
                    clues.setdefault(c.lower(), (c, base + 1, 'syn'))
        if not clues:
            continue
        e = entries.get(F)
        if e is None:
            e = entries[F] = {'z': fz, 'phrase': '', 'clues': {}, 'proper': False}
        e['proper'] = False
        e['z'] = max(e['z'], fz)
        for k, v in clues.items():
            e['clues'].setdefault(k, v)
        verb_added += 1

# ---------- plurals ----------
def pluralize_def(text):
    """'Small rodent' -> 'Small rodents', 'Division of an ocean' -> 'Divisions of an ocean'."""
    words = text.split()
    # "In ancient Greece ..." or "man who is ...": the plural would not read right.
    if PREP.match(words[0]) or re.search(r'\b(is|has|was|does|its|his|her)\b', text, re.I):
        return None
    head = len(words) - 1
    for i, w in enumerate(words):
        if i > 0 and PREP.match(w):
            head = i - 1
            break
    h = words[head]
    if not re.fullmatch(r'[A-Za-z]+', h) or h.lower().endswith('s') or not wn.synsets(h.lower(), 'n'):
        return None
    if wn.synsets(h.lower(), 'a') and head == len(words) - 1 and len(words) > 1 and not wn.synsets(h.lower(), 'n'):
        return None
    hp = ENG.plural_noun(h.lower())
    if not hp:
        return None
    if h[0].isupper():
        hp = hp[0].upper() + hp[1:]
    out = ' '.join(words[:head] + [hp] + words[head + 1:])
    return out[0].upper() + out[1:]

plural_added = 0
for name in wn.all_lemma_names('n'):
    if '_' in name or '-' in name or not name.isalpha() or not name.islower():
        continue
    if is_bad(name):
        continue
    sing = letters(name)
    if sing not in entries:
        continue
    pl = ENG.plural_noun(name)
    if not pl or not pl.isalpha() or pl == name:
        continue
    PL = letters(pl)
    if not (MIN_LEN <= len(PL) <= MAX_LEN):
        continue
    if PL in entries and not entries[PL]['proper']:
        continue
    pz = zipf(pl)
    if pz < 2.0:
        continue
    s = wn.synsets(name, 'n')
    if not s or BAD_SENSE.search(s[0].definition()):
        continue
    e = {'z': pz, 'phrase': '', 'clues': {}, 'proper': False}
    ans_tokens = [pl]
    for rank, syn in enumerate(s[:2]):
        if BAD_SENSE.search(syn.definition()):
            continue
        base = 0 if rank == 0 else 1
        for h in syn.hypernyms()[:1]:
            hn = next((l.name() for l in h.lemmas() if '_' not in l.name() and zipf(l.name()) >= 3.6), None)
            if hn and hn.lower() not in VAGUE and syn.lexname() in KIND_LEX:
                hp = ENG.plural_noun(hn)
                if hp and zipf(hp) >= 3.0 and not gives_away(hp, ans_tokens, PL):
                    add_clue(e, f'Some {hp}', 'some', base + 1)
        for cd in clean_defs(syn.definition()):
            pc = pluralize_def(cd)
            if pc and not gives_away(pc, ans_tokens, PL):
                add_clue(e, pc, 'def', base)
                break
        for other in syn.lemmas():
            on = other.name()
            if on == name or '_' in on or not on.isalpha() or not on.islower() or is_bad(on):
                continue
            op = ENG.plural_noun(on)
            if not op or zipf(op) < 3.0 or gives_away(op, ans_tokens, PL):
                continue
            add_clue(e, nice(op), 'syn', base)
    if e['clues']:
        if PL in entries:  # a name spelled like this plural (GROVES): keep both
            old = entries[PL]
            old['proper'] = False
            old['z'] = max(old['z'], pz)
            for k, v in e['clues'].items():
                old['clues'].setdefault(k, v)
        else:
            entries[PL] = e
        plural_added += 1

# ---------- score and write ----------
# The game's own check (engine/src/crossword.js clueGivesAway): no clue word
# may share a root with any word of its answer, including words of the other
# dictionary entries spelled the same way. Kept in step with the JavaScript.
def js_same_root(a, b):
    if a == b:
        return True
    s_, l_ = (a, b) if len(a) <= len(b) else (b, a)
    if len(s_) >= 4 and s_ in l_:
        return True
    p = common_prefix(a, b)
    return p >= 5 or (p >= 4 and len(s_) <= 5)

def js_tokens(ans, phrase):
    return [t for t in re.split(r'[^A-Z]+', phrase.upper()) if len(t) >= 3] if phrase else [ans]

def js_gives_away(clue, ans, phrase):
    toks = [t for t in re.split(r'[^A-Z]+', clue.upper()) if t]
    return any(len(t) >= 3 and js_same_root(t, a) for t in toks for a in js_tokens(ans, phrase))

rows = []
for ans, e in entries.items():
    e['clues'] = {k: v for k, v in e['clues'].items() if not js_gives_away(v[0], ans, e['phrase']) and not gives_away(v[0], tokens(e['phrase']) if e['phrase'] else [ans.lower()], ans)}
    clues = sorted(e['clues'].values(), key=lambda c: (c[1], {'def': 0, 'syn': 1, 'fitb': 2, 'kind': 3, 'some': 4}[c[2]]))
    if not clues:
        continue
    # Keep a spread of levels: up to 3 easy, 2 medium, 2 hard.
    keep, per = [], defaultdict(int)
    for c in clues:
        lv = min(c[1], 2)
        if per[lv] >= (3 if lv == 0 else 2):
            continue
        per[lv] += 1
        keep.append((c[0], lv, c[2]))
    z = e['z']
    # 0-100 fill score: common words high, rare words low, lively phrases get a lift.
    score = max(1, min(100, round((z - 1.8) / (5.5 - 1.8) * 90)))
    rows.append((ans, score, e['phrase'], 1 if e['proper'] else 0, keep))

rows.sort()
def esc(s):
    return s.replace('\\', '').replace('\t', ' ').replace('|', '/').replace('~', '-').replace('\n', ' ')
lines = []
for ans, score, phrase, proper, keep in rows:
    cl = '|'.join(f'{esc(t)}~{lv}{k[0]}' for t, lv, k in keep)
    lines.append(f'{ans}\t{score}\t{esc(phrase)}\t{proper}\t{cl}')
body = '\n'.join(lines)
header = '''// The Crossword game's answers and clues: built by scripts/crossword/build-lexicon.py.
// Do not edit by hand; change the script and run it again.
//
// One answer per line: ANSWER, fill score 0-100, the phrase it spells (if it
// is more than one word), 1 if it is a name, then clues "text~<level><kind>"
// joined by "|". Level 0 easy, 1 medium, 2 hard. Kind d definition, s same
// meaning, k kind of, f fill in the blank, s(ome) plural group.
//
// Sources and notices (keep these with the data):
//   WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved.
//   THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY
//   MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. Permission to
//   use, copy, modify and distribute WordNet for any purpose and without fee
//   or royalty is granted, provided this notice is kept.
//   Word frequencies: wordfreq by Robyn Speer, data licensed CC BY-SA 4.0
//   (https://github.com/rspeer/wordfreq); only a rounded score is used here.
//   Words left out: List of Dirty, Naughty, Obscene and Otherwise Bad Words
//   by Shutterstock (LDNOOBW), CC BY 4.0.
'''
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(header)
    f.write('export const WORDS = ' + json.dumps(body) + ';\n')
print(f'lemmas looked at {seen_lemmas}, answers {len(rows)}, plurals {plural_added}, verb forms {verb_added}')
by_len = defaultdict(int)
for r in rows:
    by_len[len(r[0])] += 1
print(dict(sorted(by_len.items())))
