# Promo video

The advertisement for The Fantastical Logic Grid, made to post on social media
and video sites. It is separate from the game: nothing in this folder ships
inside the web app, the desktop app or the admin dashboard.

## The finished videos

| File | What it is |
| --- | --- |
| `the-fantastical-logic-grid-promo-16x9.mp4` | About 90 seconds, 1920 x 1080. For YouTube, Facebook, the website, X. |
| `the-fantastical-logic-grid-promo-16x9-captioned.mp4` | The same with captions burned in, for feeds that autoplay with the sound off. |
| `the-fantastical-logic-grid-promo-9x16-captioned.mp4` | About 30 seconds, 1080 x 1920, captions burned in. For TikTok, Instagram Reels and YouTube Shorts. |
| `*.srt` | Captions to upload alongside the clean videos. |
| `*-thumbnail.png` | A still from the end card, for the post's thumbnail. |

## How it is made

Everything is free and runs on your own computer or a cloud machine.

| File | Job |
| --- | --- |
| `tools/capture.cjs` | Films the real game with Playwright: themes, difficulty, a story being written, the cast, solving with the game's own hints, the solve, a race against three other players and the scoreboard (run against the real Worker in Miniflare), printing, saving, looks and the install window. Each clip is saved as full HD frames with timestamps, plus where the pointer was and when it clicked. |
| `tools/build.py` | The editor. Voices the script with Kokoro (`am_michael`, the game's own narrator), times every scene to the voice and cuts on the beat, frames the footage in a browser window on the brand background with a headline beside it, adds the title, logo and end card, mixes the voice over the music and effects (the music dips under the voice), then writes both cuts with ffmpeg, plus captions and a thumbnail. The script for both cuts is at the top of the file. |
| `tools/sound.py` | The music and sound effects, composed and synthesised from scratch in code (an upbeat 120 BPM track in D major, whooshes, a riser, an impact, chimes and clicks). Because they are made here, there is nothing to license and no attribution to give. |

### Rebuild it

```
npm ci && npm --prefix server ci && npm run build
pip install -r video/requirements.txt scipy pillow   # plus ffmpeg on your PATH
node media/promo/tools/capture.cjs                   # about 6 minutes
python3 media/promo/tools/build.py                   # both cuts; or: build.py wide / build.py tall
```

The results land in `media/promo/out/`; copy the ones you want up into this
folder. The Kokoro voice model (about 350 MB, Apache-2.0) downloads into
`media/promo/.kokoro` the first time (set `KOKORO_DIR` to reuse the one in
`video/.kokoro`).

### Changing it

- Words or order: edit `WIDE` or `TALL` at the top of `tools/build.py`. Each
  scene has the lines the narrator says, a kicker and headline shown beside
  the footage, and the clip ranges to show. A line can be
  `['Caption text', 'Spoken text']` when the voice needs a different spelling
  (for example `MENSA` is spoken as `Mensa` and the website as "the logic grid
  dot com").
- New feature to show: film it in `tools/capture.cjs` with `film('name', ...)`
  and add a scene that uses it.
- `VOICE` and `SPEED` are environment variables for `build.py`.
