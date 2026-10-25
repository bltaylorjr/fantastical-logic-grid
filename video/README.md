# How-to-play video

The narrated how-to-play video in `web/media/intro.mp4` is made from the real
game, so it can be rebuilt whenever the game changes. That happens on its own:
`.github/workflows/video.yml` re-records it after each change to the game lands
on `main` and opens a pull request with the new video, captions and transcript.

## What is in here

| File | Job |
| --- | --- |
| `capture.cjs` | Drives the game in Playwright and saves a picture per scene, with the narration for each one, in `out/scenes.json`. The walkthrough narration comes from the game's own hints, so it always matches the puzzle on screen. Accounts, races and the scoreboard run against the real Worker in Miniflare (same set-up as `scripts/e2e-compete.cjs`). |
| `build.py` | Voices the narration with Kokoro (voice `am_michael`, the game's narrator), times the captions (WebVTT and SRT), and makes `out/intro.mp4` plus `out/intro-captioned.mp4` with ffmpeg. `--install` copies the video and captions into `web/media` and refreshes the transcript and running time in `web/index.html`. |
| `card.html` | The title cards between parts. |

## Run it yourself

```
npm ci && npm --prefix server ci && npm run build
npx playwright install chromium
pip install -r video/requirements.txt     # plus ffmpeg on your PATH
node video/capture.cjs
python3 video/build.py --install
```

The Kokoro model (about 350 MB, Apache-2.0) downloads into `video/.kokoro` the
first time. Everything is free and runs on your own computer or on GitHub's
free runners.

## Changing the video

- New feature? Add a scene in `capture.cjs`: move the game to the right place,
  then call `scene('name', ['First sentence.', 'Second sentence.'])`. Keep each
  sentence short; each one becomes a caption.
- A word the voice says oddly can be given as `['Caption text.', 'Spoken text.']`.
- `SPEED` (default 0.94) and `VOICE` (default `am_michael`) are environment
  variables for `build.py`.
