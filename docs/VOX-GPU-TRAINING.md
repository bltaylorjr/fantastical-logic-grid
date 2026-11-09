# Vox's voices: the base voices now, its own model as it learns

## Why Vox made noise

Vox's own speech model starts out knowing nothing. Until it has learned from
many hours of recorded speech, it can only make noise. Teaching it takes a
GPU: on a processor (your PC, or the Oracle server's two cores) it would take
months. Searching the internet for single words doesn't fix that either; those
clips help a model that already speaks, but can't teach one from nothing.

## What speaks now: the base voices

Until Vox's own model is ready, Vox speaks with **Kokoro**, an open speech
model (82 million parameters, Apache 2.0 weights, from huggingface.co/hexgrad/Kokoro-82M)
that runs on an ordinary processor: 54 voices in 8 languages. Vox installs it
by itself the first time it starts (about 30 MB of software and 120 MB of model
files, checked against fixed checksums). Everything that makes a Vox voice
still applies on top, from `vox-engine/vox/base.py`:

- **Age and sex:** the vocal tract sized to the age, then the age's pitch.
  Children start from a woman's voice, the closest in size.
- **Dialect:** espeak's accent pronunciation (US, New York, British, RP,
  Scottish, Lancashire, West Midlands, Caribbean), plus each dialect's tune and pace.
- **Delivery:** whisper to yell, laughing, crying, singing, auto-tune.
- **Text:** a child's words, hesitations, laughs, your pronunciation fixes.
- **Timbre:** each character gets its own, a blend of two base voices chosen
  from the voice's name, so no two sound alike. A voice can name its own in its
  profile: `{"base_voice": "bf_emma"}` or `{"base_voice": {"af_heart": 0.7, "af_bella": 0.3}}`.

The Voice engine page says which model is speaking. `VOX_SOURCE=base` or
`VOX_SOURCE=own` forces one.

## How Vox's own model learns (free, on Kaggle)

The workflow **Train Vox on the free GPU** (`.github/workflows/vox-gpu-train.yml`,
every 4 hours) takes the next step each run (`vox-engine/kaggle/orchestrate.py`):

1. **The engine's code** goes to a private Kaggle dataset, `vox-engine-code`,
   whenever it changes.
2. **The training data** is prepared once, by a CPU notebook (`vox-data`,
   `kaggle/prepare_data.py`). CPU time doesn't count against the GPU hours.

   | Corpus | License | Speech |
   | --- | --- | --- |
   | LJSpeech 1.1 | public domain | ~24 h, one American speaker |
   | VCTK 0.92 | CC BY 4.0 | ~44 h, 110 speakers with UK, Irish, Scottish, Welsh, US, Canadian, Indian and other accents (stored as Vox dialects) |
   | LibriTTS-R train-clean-100 | CC BY 4.0 | ~54 h, 247 speakers |

   Every clip is converted to 24 kHz mono FLAC, with its transcript, speaker,
   license, credit and (for VCTK) accent, age and sex. `CREDITS.md` in the
   output lists what CC BY asks for.
3. **A training session** runs on Kaggle's GPU (`vox-train`, `kaggle/train_gpu.py`)
   for up to 8 hours, resuming where the last one stopped. About 80% of the
   time trains the speech model (the 60-million-parameter "small" size), and
   the rest trains the vocoder. Each session ends by saving:
   - the full checkpoint, to a private dataset (`vox-ckpt`) that the next
     session resumes from;
   - a slim copy (no optimizer state, a third of the size), handed to Vox on
     the Oracle server (`/srv/vox/models/vox-step<N>.pt`; the newest 3 are kept).
4. **The next session** starts as long as this week's GPU hours stay under 24
   (Kaggle gives about 30), so nothing else you run on Kaggle is crowded out.

Every night, Vox on the server tries the newest model. If Whisper hears more
of the test lines from it than from the base voices (by at least 2 points),
Vox switches to it by itself. **Back to the previous model** on the Learning
tab goes back to the base voices if Vox's own model was the first to go live.
Training on the PC's or the server's processor is off, because it's far too slow;
`local_training` in the automatic training settings turns it back on for
fine-tuning a model that already speaks.

**How long:** expect a few weeks of weekly sessions before Vox's own model
speaks clearly enough to beat the base voices. The Learning tab shows the
steps, the GPU hours, each session and the result of each nightly check.

## Turning it on

The setup checklist entry is **Vox training on the free GPU (Kaggle)** under
Connections and setup:

1. Make a free account at kaggle.com (your email or Google account). In
   **Settings**, choose **Phone verification**: Kaggle only allows GPU use after it.
2. In Kaggle **Settings** > **API**, choose **Generate New Token** and copy it.
3. GitHub > the repository > **Settings** > **Secrets and variables** >
   **Actions**: add the secret `KAGGLE_API_TOKEN` (the token) and the variable
   `KAGGLE_USERNAME` (your Kaggle username).
4. Run **Train Vox on the free GPU** once from the Actions tab. It runs every
   4 hours by itself after that. The first run prepares the data (a few hours);
   the first training session starts on the next run.

Until the token is added, the workflow does nothing and the base voices keep speaking.

## Checking on it

- **Actions > Train Vox on the free GPU:** each run's summary says what it did.
- **kaggle.com > Your Work:** the notebooks `vox-data` and `vox-train`, and the
  datasets `vox-engine-code` and `vox-ckpt` (all private).
- **The admin dashboard:** Voice engine > Learning > Automatic training >
  **Vox's own model (free GPU)**. Status (live) also watches the workflow.

The workflow runs on the Oracle build server when it's available (no GitHub
Actions minutes used, and the model goes straight into Vox's folder).
Otherwise it runs on GitHub's runners and keeps the model as a download for 7
days.
