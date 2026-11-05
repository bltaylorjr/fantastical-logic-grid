# Vox: a free generative voice engine for games

Vox turns game dialogue into expressive speech. It is written from scratch, uses only free and
open-source software, runs on your own computer, and has **no fees, no API keys, no accounts and
no royalties**. Code is MIT licensed; voices you train on the included commercial-safe data can
ship in a game you sell.

![Voice Studio](docs/studio.png)

## Read this first: what you get today

This is a complete engine **without trained weights**. The networks start from zero, the way
"from scratch" means. Until you train it on real speech, it outputs noise and buzzing; the test
suite proves that every part works, not that it sounds good yet.

Training costs no money but takes computer time:

| Model preset | Size | Where to train for free | Rough expectation |
|---|---|---|---|
| `tiny` | 0.8M params | any laptop CPU | tests only, not real speech |
| `small` | ~60M params | free Kaggle / Colab GPU, or your own 8 GB+ GPU | clear speech after weeks of free-tier sessions on a few hundred hours of data |
| `base` | ~350M params | your own 24 GB GPU | best quality; plan on weeks of continuous training |

Training saves checkpoints and resumes exactly where it stopped, so it fits in free GPU time limits
(Kaggle currently gives roughly 30 GPU hours a week; check their current quota).

## What it does (your requirements → where they live)

| Requirement | How Vox does it | Code |
|---|---|---|
| Diffusion transformer | 22-layer DiT with adaptive LayerNorm-Zero conditioning, rotary positions, QK-norm, trained with conditional flow matching | `vox/model/dit.py` |
| TTS model | Text (any language, byte-level) + style → mel spectrogram → Vocos-style vocoder → 24 kHz audio | `vox/model/` |
| Prosody and pacing | No fixed cadence: no forced alignment, rhythm is learned from real speech. Duration predictor + controls for pace, pitch, expressiveness, loudness, all relative to each voice's own normal | `dit.py`, `style.py` |
| Emotional micro-expressions | `[breath]`, `*emphasis*`, `[laugh]`, `[sigh]`, pauses; yes/no questions rise and wh-questions fall automatically; `[warm]…[/warm]` re-delivers just those words with a different emotion | `vox/text.py`, `engine.py` |
| Consistency over long passages | Each chunk continues from the previous chunk's audio; fixed speaker identity; a drift guard measures voice similarity and regenerates any chunk that wanders | `engine.py` |
| Voice cloning | 3–15 second sample, **requires a consent record**, stored with the voice | `engine.clone_voice` |
| Diverse voice creation | Invents voices that belong to no real person by sampling the learned speaker space, steerable with pitch / brightness / roughness / breathiness; blend voices | `voices.py` |
| Superior prompt alignment | Two-way classifier-free guidance: one dial for "say exactly these words", one for "in exactly this voice and mood"; plain-words style prompts ("slightly menacing, slow") | `dit.sample`, `voices.parse_style_prompt` |
| Flexible editing | Replace words, re-deliver a phrase, add pauses or breaths, re-time a line, regenerate a time range; undo and redo | `vox/editing.py` |
| Hybrid data pipeline | Real labeled data + pseudo-labeled data + quality-filtered synthetic data, merged into one training set | `vox/data/` |
| Scan online audio and video | Internet Archive, LibriVox, Hugging Face and yt-dlp sources; every item's license is checked and anything not openly licensed is skipped; builds a vocabulary and a coverage report | `vox/data/sources.py` |
| Gets better the more it's used | Every line is saved and scored automatically; your ratings, A/B choices and kept edits become preference pairs; refinement rounds fine-tune a candidate model (self-training + preference learning + replay of original data) and switch to it only if it beats the current one on a fixed test. Every version is kept, with rollback | `vox/learning.py` |
| Auto-tune | Pitch correction from subtle polish to the hard robotic snap, plus vibrato, transpose and one-note robot; keys and scales; per line or per voice | `vox/autotune.py` |
| Auto-optimize | Tries generation settings on test lines for a voice and keeps the best-scoring ones | `learning.optimize_voice` |
| Every American English word | Dictionary installed free on your computer: ~243,000 words and phrases with pronunciation (sounds, IPA, easy respelling, syllables, stress), meanings by part of speech, example sentences and synonyms. The model reads English as sounds, so words are said the dictionary way; words said two ways (read, record, lead, close…) are picked from the words around them; a from-scratch letters-to-sounds model handles anything not listed | `vox/lexicon/` |
| Enunciation | `enunciate` 0–1: slower, clearer, more deliberate speech (word-by-word at the top end) | `engine.py` |
| Other languages | Translate any line into 100 languages (M2M100, MIT license) or 400+ (MADLAD-400, Apache 2.0), free and offline after a one-time download; markup is kept, translations are cached | `vox/translate.py` |
| Voices from samples | Keywords search openly licensed recordings; at least 3 different speakers are blended into a new voice that sounds like none of them (no one over 40%, similarity to each kept under 0.75) | `vox/sampling.py` |
| Online | `vox serve --tunnel` (or your own address) through a free Cloudflare Tunnel; only your websites may call it, requests are rate-limited, admin actions need the token | `vox/tunnel.py`, `server.py` |
| Any game | Local HTTP + WebSocket server, plus ready plugins for Unity, Godot, Unreal and web games; or bake lines to WAV files and ship with no server at all | `vox/server.py`, `clients/` |

## How it fits together

```
 game dialogue ──► text front end ──► chunks ──┐
  "*Halt!* [breath]"  normalize, markup,        │
                      breath/question planner   ▼
                                       ┌──────────────────┐   style vector
 voice (cloned / designed) ──────────► │ Diffusion        │ ◄─ speaker + emotion mix
 previous chunk's audio (continuity) ─►│ Transformer      │    + pace/pitch/energy
                                       │ (flow matching)  │
                                       └────────┬─────────┘
                                                ▼ mel spectrogram
                                         Vocos vocoder ──► 24 kHz audio ──► game
```

## Install

You need Python 3.10 or newer. Everything else is free.

```bash
cd vox-engine
pip install -e .              # the engine
pip install -e ".[data]"      # optional: Whisper transcription, Hugging Face datasets, yt-dlp
python tests/smoke_test.py    # about a minute on a laptop; ends with ALL SMOKE TESTS PASSED
```

For a GPU, install PyTorch's CUDA build first by following pytorch.org's install selector (free).

## Train your own voices

```bash
# 1. Build the dataset (edit examples/sources.yaml first)
vox prepare-data --sources examples/sources.yaml --out data   # or sources.json on Python 3.15

# 2. Train the speech generator (resume any time with --resume runs/v1/vox.pt)
vox train --data data/manifest.jsonl --out runs/v1 --preset small

# 3. Hybrid step: learn emotions from labeled clips, then label the rest
vox train-emotion --ckpt runs/v1/vox.pt --data data/manifest.jsonl
vox pseudo-label  --ckpt runs/v1/vox.pt --data data/manifest.jsonl
vox train --data data/manifest.pseudo.jsonl --out runs/v1 --resume runs/v1/vox.pt

# 4. Train the vocoder (until this is done, audio uses a robotic fallback)
vox train-vocoder --ckpt runs/v1/vox.pt --data data/manifest.jsonl

# 5. Optional: fill gaps in rare emotions with filtered synthetic clips
vox augment --ckpt runs/v1/vox.pt --data data/manifest.pseudo.jsonl --use-voices narrator
```

**Training on a free Kaggle GPU:** create a notebook, turn on the GPU accelerator and internet,
upload this folder as a dataset, then run `pip install /kaggle/input/vox-engine` and the commands
above with `--out /kaggle/working/runs/v1`. Save `vox.pt` as notebook output, and next session
attach it and add `--resume`.

**Commercial-safe free data** (verified licenses):

| Dataset | Hours | Speakers | License |
|---|---|---|---|
| LibriTTS-R | ~585 | 2,456 | CC BY 4.0 |
| Hi-Fi TTS | ~292 | 10 | CC BY 4.0 |
| VCTK | ~44 | 109 | CC BY 4.0 |
| LJSpeech | ~24 | 1 | Public domain |
| CREMA-D (emotion labels) | ~5 | 91 | Open Database License |
| LibriVox, public-domain Internet Archive items | thousands | many | Public domain |
| Your own voice actors | — | — | yours |

CC BY data needs credit: `prepare-data` writes `ATTRIBUTION.md`; put it in your game's credits.
Datasets marked non-commercial (for example, Expresso and RAVDESS) are refused unless you set
`noncommercial: true`.

**Will it pronounce my fantasy names?** Check before you train more:

```bash
vox coverage --vocab data/vocabulary.json --script examples/dialogue.csv
```

It lists every script word the model has never or rarely heard. Record a few sentences with those
words and add them as a `local` source.

## Use it

```bash
vox design-voice --ckpt runs/v1/vox.pt "deep gravelly old guard, stern" --name guard --count 3
vox speak --ckpt runs/v1/vox.pt "Halt! Who goes there?" --voice guard --emotion angry --out halt.wav
vox serve --ckpt runs/v1/vox.pt           # then open http://127.0.0.1:5150 for the Voice Studio
vox bake  --ckpt runs/v1/vox.pt --script examples/dialogue.csv --out baked
```

`design-voice --count 3` writes audition files so you can pick the best candidate. A baked line
always sounds the same (its seed comes from its line ID), so re-baking a script never changes lines
you already approved.

Cloning someone's voice needs their consent, recorded with the voice:

```bash
vox clone-voice --ckpt runs/v1/vox.pt --name ranger --audio sample.wav \
  --transcript "Exact words spoken in the sample." \
  --speaker-name "Jane Doe" --granted-by "Jane Doe" \
  --consent "Jane agreed in writing on 2026-11-02 to her voice being used for NPC dialogue in Project X."
```

### Script markup for writers

| Write | Effect |
|---|---|
| `*word*` | emphasis |
| `[breath]` | audible breath |
| `[pause]`, `[pause:short]`, `[pause:long]` | silence of that length |
| `[laugh]`, `[sigh]` | non-verbal sounds |
| `[warm]…[/warm]`, `[sad 0.5]…[/sad]` | that span delivered with another emotion (any emotion name, optional strength 0–1) |
| `...` and `--` | trailing-off pause and short break |

Emotions: neutral, happy, sad, angry, fearful, surprised, disgusted, calm, excited, tender,
whisper, shout. Mix them: `emotion={"angry": 0.6, "fearful": 0.3}`.

### Python

```python
from vox.engine import VoxEngine
eng = VoxEngine("runs/v1/vox.pt")
take = eng.speak("The treasure is hidden in the old mill.", voice="guide", emotion="calm")
ed = eng.edit(take)
ed.replace("old mill", "abandoned lighthouse")
ed.restyle("hidden", emotion="fearful", intensity=0.7)
ed.undo()
ed.render().save("line.wav")
```

## It keeps getting better

`vox serve` turns continuous learning on (turn it off with `--no-learning`). Here is the loop:

1. **Every line is scored**, from 0 to 100: voice match, clear words (needs Whisper:
   `pip install faster-whisper`), emotion match, liveliness, pacing and clean audio.
2. **You teach it**: rate takes Good or Not good, pick the better of two takes (A/B), and keep edits
   you like. The engine also teaches itself: when its drift guard rejects a take, and when
   auto-optimize compares settings, the better and worse takes become a pair.
3. **Refinement rounds** train a copy of the model on its best lines, on your preference pairs
   (Diffusion-DPO adapted to flow matching), and on a replay of the original training data so it
   doesn't forget. Designed voices drift a little toward the takes you liked; cloned voices never
   change.
4. **It only switches when it's better**: the copy and the current model speak the same fixed
   lines with the same seeds, and the copy must score higher. Every version is kept in
   `learning/models/`, and you can switch to any of them or roll back.
5. Rounds start automatically after enough new ratings or lines (20 and 300 by default, at most
   every 6 hours), or when you press **Refine now**.

**Pronunciation fixes** (`Aelith` → `AY-lith`) apply to every line immediately.

Everything stays on your computer in `learning/`. When the server starts it prints an **admin
token** (also saved in `learning/admin_token.txt`). Admin features (learning, model versions,
cloning, deleting voices) need it, so other websites can't change your engine.

**Admin dashboard:** your Logic Grid admin app has a **Voice engine** page (The Logic Grid >
Voice engine). Open it on the computer running Vox, paste the token, and you get learning
progress, take reviews, A/B choices, auto-tune per voice, pronunciation fixes and version
rollback.

From the command line: `vox refine --ckpt runs/v1/vox.pt` runs one round and prints the result.

## Auto-tune

```bash
vox speak --ckpt vox.pt "Oh, the dragon sleeps..." --voice bard --autotune bard
vox autotune my_recording.wav tuned.wav --preset hard --key A --scale minor   # any recording, no model needed
```

| Preset | Sound |
|---|---|
| `subtle`, `natural` | in tune, still human |
| `pop` | modern pop vocal |
| `hard` | instant snap, the robotic "T-Pain" effect |
| `robot` | one flat note: robots, golems, AIs |
| `bard` | sing-song with vibrato (major key) |
| `giant`, `pixie` | deeper / higher creature voices |

Fine-tune any preset with `key`, `scale` (chromatic, major, minor, pentatonic, minor_pentatonic,
blues, dorian, harmonic_minor, monotone), `retune_ms`, `amount`, `humanize`, `transpose`,
`vibrato_rate`, `vibrato_depth` and `mix`. Games pass it per line (`"autotune": "pop"` or an object)
or rely on the voice's default, which you set in the admin page.

## Every word, said right

```bash
vox dictionary install            # free, about 2 minutes, once
vox dictionary look enunciation   # sounds, IPA, respelling, syllables, meanings, examples
```

The dictionary combines the **CMU Pronouncing Dictionary** (American pronunciations, BSD license)
and **Open English WordNet** (meanings, parts of speech, examples, synonyms; CC BY 4.0, so credit
"Open English WordNet" in your game's credits). No list can hold literally every word; anything
not in it (fantasy names, new slang) gets a pronunciation from Vox's own letters-to-sounds model,
trained from scratch on the CMU dictionary and shipped in `vox/lexicon/g2p.pt`. Retrain it with
`vox dictionary train-guesser`.

The speech model reads English words as **sounds** from the dictionary and other languages from
their letters. During training each word is randomly given as sounds or letters, so it learns
both. Pronunciation fixes can be a respelling (`Aelith` → `AY-lith`) or exact sounds
(`EY1 L IH0 TH`).

**Clear speech:** `"enunciate": 0.5` is slower and crisper; `1.0` adds a small gap between words.

## Other languages

```bash
pip install transformers sentencepiece        # free, once
vox translate "Halt! [breath] Who goes there?" --to es
vox serve --ckpt vox.pt --translation madlad  # 400+ languages (bigger, slower)
```

Games ask for a language per line with `"translate_to": "es"`, and the engine translates, then
speaks. Markup like `[breath]` and `[warm]…[/warm]` stays in place, and every translation is cached.

**To speak a language well, train on recordings in it.** Free, commercial-safe options include
Mozilla Common Voice (CC0, 100+ languages) and Multilingual LibriSpeech (CC BY 4.0, 8 European
languages). Until then, translated lines are read from their spelling and will sound accented.

## New voices from samples (no recording needed)

```bash
vox sample-voice --ckpt vox.pt --name harbor_master --keywords "old sea captain" "harbor radio"
```

Or use the admin page (Voices > New voice from samples). Keywords search Internet Archive items
marked public domain or Creative Commons BY (each item's license is checked again). You can add
your own links or files with their license. Recordings are split into clips and grouped by
speaker, and the same person in two recordings counts once. At least 3 different speakers (5 by
default) are blended, with no one carrying more than 40%. The result must stay below 0.75
similarity to every source speaker, or it is rebalanced or refused. Credits are saved with the
voice. Copying one specific person is cloning, which needs their consent.

## Voices for every age, dialect and delivery

```bash
curl -X POST localhost:5150/v1/admin/voices/starters -H "X-Vox-Admin-Token: …" -d '{"dialect": "appalachian"}'
```

Or use the admin page (Voices > Voices for every age). The six starting voices are
adult, teen and adolescent, male and female. Any voice can be any **age from 1
(first words) to 90**, and age sets:

- **Voice and resonance:** typical speaking pitch and vocal-tract size for the age
  and sex (boys' voices drop from 13 to 16), applied to every line.
- **Articulation and phonology:** the sound patterns young children use, each
  fading at its usual age ("wabbit" until about 6, "tat" for cat until about 3½,
  "poon" for spoon until about 4½, "fum" for thumb until about 7). Keep any of
  them at any age for a character.
- **Fluency:** the normal hesitations of 2-to-5-year-olds, fading with age, or a
  level you set (a character who stammers).
- **Expressive language:** optional, `simplify`: "ball!", "want ball", "I goed park".
- **Pragmatics:** pace, melody and loudness for the age, plus a speaking style
  (conversational, storytelling, formal, playful, shy, confident, comforting,
  excited). Receptive language has nothing to hear, so it isn't a setting.

**Dialects (24):** General American, Southern US, Appalachian, Texan, African
American English, New York City, Boston, Great Lakes, Canadian, Standard British
(RP), London, Northern England, Scottish, Irish, Welsh, Australian, New Zealand,
South African, Indian, Nigerian, Jamaican and Caribbean, Singaporean, Filipino,
Latino English, each with an accent strength. Add your own regional or local
dialect from the same rules: `PUT /v1/admin/dialects/<id>`. Other languages use
`translate_to`.

**Deliveries:** whisper, murmur, soft, normal, projected, calling out, shout, yell,
scream, laughing, crying, breathy, raspy, vocal fry, falsetto and singing (give
notes, `"sing": {"notes": "C4 C4 G4 G4 A4 A4 G4"}`, or a key for a made-up tune).

All of these are rules and signal processing on top of the model, so they work
with any model. How natural they sound depends on training: a model trained on
more ages, accents and singing sounds better at them. Every setting can go on a
voice (`PUT /v1/admin/voices/<name>/profile`) or on a single line (`/v1/speak`
fields `age`, `sex`, `dialect`, `accent`, `speaking_style`, `fluency`, `simplify`,
`processes`, `delivery`, `sing`; the options are listed at `GET /v1/voices/options`).

## Discover voices from every word

The admin page's **Discover voices from every word** goes through the whole
American English dictionary, most-used words first, a few at a time. Each group
of words is searched for openly licensed recordings, and when there are at least
3 different speakers they're blended into a new voice with credits, under the
same rules as "New voice from samples". It picks up where it left off, is polite
to the Internet Archive (one request at a time, pauses, one small file per
recording) and deletes downloads as it goes.

## Put it online

```bash
vox serve --ckpt vox.pt --tunnel            # instant: prints https://<words>.trycloudflare.com
vox serve --ckpt vox.pt --tunnel-name vox   # your own fixed address (one-time setup below)
```

Both use a free **Cloudflare Tunnel**: no open ports, no fixed IP, automatic HTTPS. Install the
free `cloudflared` program first. Online, the engine:
- answers browsers only from `thelogicgrid.com`, `www.thelogicgrid.com` and the admin app
  (change with `--allow-origin`);
- limits each visitor to 30 requests a minute (`--rate`);
- requires the admin token for designing voices, baking files and auto-tuning uploads, as well as
  all the admin features.

**Your own address (voice.thelogicgrid.com), once:** your domain's DNS must be on Cloudflare
(free). Then run `cloudflared tunnel login`, `cloudflared tunnel create vox` and
`cloudflared tunnel route dns vox voice.thelogicgrid.com`. After that, `--tunnel-name vox`
always comes up at that address. Paste the address into the admin page's Voice engine connect
box. The engine is online whenever this computer is on and `vox serve` is running.

## Game engine plugins

All plugins talk to `vox serve` on your own machine, or play baked files with no server.

| Engine | File | Install |
|---|---|---|
| Unity | `clients/unity/VoxClient.cs` | Drop into `Assets/`, add the component. `Speak(...)`, `SpeakStreaming(...)`, `Edit(...)`, `PlayBaked(id)` |
| Godot 4 | `clients/godot/vox_client.gd` | Add as Autoload named `Vox`. `Vox.speak(...)` then `await Vox.line_ready`; `speak_streaming`; `load_baked` |
| Unreal 5 | `clients/unreal/VoxComponent.h/.cpp` | Copy into `Source/<Game>/`, add `"HTTP", "Json"` to Build.cs. Blueprint-callable `Speak`, `ReplaceWords`, `Undo` |
| Web / HTML5 | `clients/web/vox-client.js` | `import { VoxClient } from "./vox-client.js"`. `speak`, `stream`, `edit`, `loadBaked` |

Every spoken line returns per-sentence timings (`X-Vox-Segments`) for subtitles and simple lip-sync.

### Server API

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Voice Studio page |
| GET | `/v1/health`, `/v1/voices`, `/v1/emotions` | status and lists |
| POST | `/v1/speak` | JSON → WAV (or raw PCM16 with `"format": "pcm16"`) |
| WS | `/v1/stream` | send JSON, receive PCM16 chunks as each sentence is ready |
| POST | `/v1/edit` | `{"take": "...", "ops": [{"op": "replace", "old": "...", "new": "..."}, {"op": "undo"}]}` |
| POST | `/v1/voices/design` | invent a voice from a description |
| POST | `/v1/voices/clone` | multipart upload; needs the admin token; refused (403) without a proper consent statement |
| POST | `/v1/bake` | many lines → WAV files + `lines.json` |
| GET / POST | `/v1/autotune/presets`, `/v1/autotune` | presets list; auto-tune an uploaded recording |
| GET / POST | `/v1/languages`, `/v1/translate` | languages; translate a line (markup kept) |
| GET | `/v1/dictionary/{word}`, `/v1/dictionary?prefix=` | pronunciation, meanings, usage; word search |
| (admin) | `/v1/admin/...` | learning, takes, feedback, A/B, versions, lexicon, voice settings; needs `X-Vox-Admin-Token` |

The server listens only on your own computer (127.0.0.1) unless you pass `--host 0.0.0.0`.

## Project layout

```
vox/
  config.py          sizes, presets, emotion list, license policy
  audio.py           mel spectrogram, YIN pitch tracker, loudness, file I/O
  text.py            normalization, markup parser, tokenizer, expression planner
  model/dit.py       diffusion transformer, flow matching, sampler, duration predictor
  model/style.py     speaker encoder, emotion classifier, style conditioner
  model/vocoder.py   Vocos vocoder, discriminators, Griffin-Lim fallback
  engine.py          speaking, streaming, long-form consistency, cloning, voice design
  learning.py        continuous learning: scoring, feedback, refinement rounds, versions
  autotune.py        pitch correction (TD-PSOLA), presets, keys and scales
  lexicon/           dictionary (CMUdict + Open English WordNet), sounds, IPA, heteronyms, letters-to-sounds model
  translate.py       translation (M2M100 / MADLAD-400), markup-safe, cached
  sampling.py        new voices blended from 3+ speakers found by keywords
  tunnel.py          Cloudflare Tunnel for online access
  editing.py         word replacement, restyling, pauses, breaths, re-timing, undo/redo
  voices.py          voice library, consent records, speaker space, style prompts
  data/              sources + license gate, processing pipeline, synthetic augmentation
  train.py           generator, emotion classifier, pseudo-labeling, vocoder training
  server.py, cli.py  game server and command line
  static/            Voice Studio page
clients/             Unity, Godot, Unreal, web plugins
examples/            sources.yaml, dialogue.csv
tests/smoke_test.py  end-to-end test
```

## Honest limitations

- No pretrained weights are included; quality depends entirely on your data and training time.
- Word positions for editing are estimated from the text (the model has no hard alignment); edits
  include a small safety margin. Use `regenerate(start, end)` for exact time ranges.
- The `[warm]…[/warm]` span styling uses the same estimate, so very short spans may bleed slightly.
- Style prompts are keyword-based: they understand words like "gravelly", "slow", "menacing",
  "very" and "slightly", not arbitrary sentences.
- Built-in breath and emphasis labels come from automatic analysis and are better with Whisper
  installed (it gives word timings).
- On an untrained model the quality scores are meaningless. Clear-words scoring (the most useful
  score) needs Whisper installed.
- Learning from its own output can reinforce its own habits; the quality gate, the replay of
  original data, and the "only switch if better" test guard against that. Your ratings matter most.
- The admin page reaches the engine on the same computer (`127.0.0.1`) or online through a tunnel
  (`*.thelogicgrid.com` or `*.trycloudflare.com`), nothing else.
- Translation quality varies by language; machine translation can be wrong, so have important
  lines checked by a speaker of that language.
- Sampled voices depend on a trained speaker model to tell people apart. An untrained or barely
  trained model hears everyone as one speaker, and sampling will (correctly) refuse.
- Only clone voices with the person's real permission. The consent check records consent; it
  cannot verify it.
