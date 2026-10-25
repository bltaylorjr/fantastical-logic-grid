"""Builds the how-to-play video from video/out/scenes.json (written by capture.cjs).

Voice: Kokoro-82M, American male voice am_michael (the game's own narrator),
run locally through kokoro-onnx. Captions: one sentence per cue, as WebVTT for
the game's player and SRT for video sites, plus a copy with burned-in captions.

  pip install -r video/requirements.txt
  python3 video/build.py            # writes video/out/
  python3 video/build.py --install  # also updates web/media and the transcript

Free tools only: Kokoro (Apache-2.0), ffmpeg, Atkinson Hyperlegible (OFL).
"""
import html, json, os, re, subprocess, sys, textwrap, urllib.request, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'out')
KDIR = os.environ.get('KOKORO_DIR', os.path.join(HERE, '.kokoro'))
KURL = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/'
VOICE = os.environ.get('VOICE', 'am_michael')
SPEED = float(os.environ.get('SPEED', '0.94'))  # a touch slower than normal, for clear words
SR = 24000
FADE, LEAD, GAP, TAIL = 0.4, 0.4, 0.3, 0.55
INSTALL = '--install' in sys.argv


def kokoro():
    os.makedirs(KDIR, exist_ok=True)
    for f in ('kokoro-v1.0.onnx', 'voices-v1.0.bin'):
        p = os.path.join(KDIR, f)
        if not os.path.exists(p):
            print(f'downloading {f}')
            urllib.request.urlretrieve(KURL + f, p + '.part')
            os.replace(p + '.part', p)
    from kokoro_onnx import Kokoro
    return Kokoro(os.path.join(KDIR, 'kokoro-v1.0.onnx'), os.path.join(KDIR, 'voices-v1.0.bin'))


def fonts():
    # libass needs TTF/OTF; the game ships WOFF2.
    d = os.path.join(OUT, 'fonts')
    os.makedirs(d, exist_ok=True)
    from fontTools.ttLib import TTFont
    for w in ('400', '700'):
        dst = os.path.join(d, f'Atkinson-{w}.ttf')
        if not os.path.exists(dst):
            f = TTFont(os.path.join(ROOT, 'web', 'fonts', f'atkinson-{w}.woff2'))
            f.flavor = None
            f.save(dst)
    return d


def split(cap):
    """Long sentences become two cues, split at the natural break nearest the middle."""
    if len(cap) <= 88:
        return [cap]
    mid = len(cap) // 2
    cands = [m.end() for m in re.finditer(r'[,:;.!?] ', cap)]
    if not cands:
        return [cap]
    k = min(cands, key=lambda c: abs(c - mid))
    return split(cap[:k].strip()) + split(cap[k:].strip())


def ts(x, sep):
    h, m, s = int(x // 3600), int(x % 3600 // 60), x % 60
    return f'{h:02d}:{m:02d}:{int(s):02d}{sep}{int(round((s - int(s)) * 1000)):03d}'


def main():
    data = json.load(open(os.path.join(OUT, 'scenes.json')))
    scenes = data['scenes']
    tts = kokoro()
    adir = os.path.join(OUT, 'audio')
    os.makedirs(adir, exist_ok=True)

    track, cues, beats, t = [], [], [], 0.0
    for si, sc in enumerate(scenes):
        start = t
        cur = t + LEAD
        for li, s in enumerate(sc['sentences']):
            cap, spoken = (s if isinstance(s, list) else (s, s))
            # Kokoro reads X and O well, so it says the caption itself. The
            # spelled-out variant is only for voices that need it.
            samples, sr = tts.create(cap, voice=VOICE, speed=SPEED, lang='en-us')
            assert sr == SR
            a = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
            d = len(a) / SR
            track.append((cur, a))
            cues.append((cur, cur + d, cap))
            cur += d + GAP
        end = max(cur - GAP + TAIL, start + 2.5)
        beats.append((sc['shot'], end - start))
        t = end
    total = t

    audio = np.zeros(int((total + 1) * SR), dtype=np.float32)
    for st, a in track:
        i = int(st * SR)
        audio[i:i + len(a)] += a.astype(np.float32) / 32768
    voice = os.path.join(OUT, 'voice.wav')
    with wave.open(voice, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(audio[: int(total * SR)], -1, 1) * 32767).astype(np.int16).tobytes())

    final = []
    for a, b, cap in cues:
        parts = split(cap)
        n = sum(len(p) for p in parts)
        x = a
        for p in parts:
            d = (b - a) * len(p) / n
            final.append((x, x + d, p))
            x += d
    final = [(a, min(b + 0.15, final[i + 1][0] - 0.02) if i + 1 < len(final) else b + 0.15, c) for i, (a, b, c) in enumerate(final)]
    wrap = lambda c: '\n'.join(textwrap.wrap(c, 46))
    with open(os.path.join(OUT, 'captions.vtt'), 'w') as f:
        f.write('WEBVTT\n\n')
        for i, (a, b, c) in enumerate(final, 1):
            f.write(f'{i}\n{ts(a, ".")} --> {ts(b, ".")}\n{wrap(c)}\n\n')
    with open(os.path.join(OUT, 'captions.srt'), 'w') as f:
        for i, (a, b, c) in enumerate(final, 1):
            f.write(f'{i}\n{ts(a, ",")} --> {ts(b, ",")}\n{wrap(c)}\n\n')
    ats = lambda x: f'{int(x // 3600)}:{int(x % 3600 // 60):02d}:{x % 60:05.2f}'
    with open(os.path.join(OUT, 'captions.ass'), 'w') as f:
        f.write('[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n\n[V4+ Styles]\n'
                'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
                'Style: Cap,Atkinson Hyperlegible,50,&H00FFFFFF,&H00FFFFFF,&H08101010,&H08101010,0,0,0,0,100,100,0,0,3,14,0,2,160,160,48,1\n\n'
                '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n')
        for a, b, c in final:
            f.write(f'Dialogue: 0,{ats(a)},{ats(b)},Cap,,0,0,0,,' + r'\N'.join(textwrap.wrap(c, 46)) + '\n')

    inputs, filt = [], []
    for i, (shot, d) in enumerate(beats):
        inputs += ['-loop', '1', '-framerate', '30', '-t', f'{d + FADE:.3f}', '-i', os.path.join(OUT, shot)]
        filt.append(f'[{i}:v]scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p[v{i}]')
    prev, off = 'v0', 0.0
    for i in range(1, len(beats)):
        off += beats[i - 1][1]
        filt.append(f'[{prev}][v{i}]xfade=transition=fade:duration={FADE}:offset={off:.3f}[x{i}]')
        prev = f'x{i}'
    filt.append(f'[{prev}]trim=0:{total:.3f},setpts=PTS-STARTPTS,split[clean][b2]')
    filt.append(f"[b2]subtitles={os.path.join(OUT, 'captions.ass')}:fontsdir={fonts()}[cap]")
    n = len(beats)
    enc = ['-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart']
    subprocess.run(['ffmpeg', '-y', '-v', 'error', *inputs, '-i', voice, '-filter_complex',
                    ';'.join(filt) + f';[{n}:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,asplit[a1][a2]',
                    '-map', '[clean]', '-map', '[a1]', '-crf', '26', *enc, os.path.join(OUT, 'intro.mp4'),
                    '-map', '[cap]', '-map', '[a2]', '-crf', '22', *enc, os.path.join(OUT, 'intro-captioned.mp4')], check=True)

    # Transcript, a paragraph per few scenes, for the game's video window.
    paras, cur = [], []
    for i, sc in enumerate(scenes):
        cur += [(s[0] if isinstance(s, list) else s) for s in sc['sentences']]
        if len(cur) >= 6 or i == len(scenes) - 1:
            paras.append(' '.join(cur)); cur = []
    with open(os.path.join(OUT, 'transcript.txt'), 'w') as f:
        f.write('\n\n'.join(paras) + '\n')
    minutes = max(1, round(total / 60))
    print(f'{total:.1f} s ({minutes} min), {len(scenes)} scenes, {len(final)} captions')

    if INSTALL:
        media = os.path.join(ROOT, 'web', 'media')
        os.makedirs(media, exist_ok=True)
        os.replace(os.path.join(OUT, 'intro.mp4'), os.path.join(media, 'intro.mp4'))
        with open(os.path.join(OUT, 'captions.vtt')) as src, open(os.path.join(media, 'intro.en.vtt'), 'w') as dst:
            dst.write(src.read())
        ip = os.path.join(ROOT, 'web', 'index.html')
        page = open(ip).read()
        body = '\n'.join(f'      <p>{html.escape(p)}</p>' for p in paras)
        page = re.sub(r'(<details class="transcript">\s*<summary>[^<]*</summary>\n)(.*?)(\n\s*</details>)',
                      lambda m: m.group(1) + body + m.group(3), page, count=1, flags=re.S)
        article = 'An' if minutes in (8, 11, 18) else 'A'
        page = re.sub(r'An? \d+-minute narrated video', f'{article} {minutes}-minute narrated video', page)
        page = re.sub(r'\d+ minutes, narrated, with captions', f'{minutes} minutes, narrated, with captions', page)
        open(ip, 'w').write(page)
        print('updated web/media/intro.mp4, web/media/intro.en.vtt and the transcript in web/index.html')


if __name__ == '__main__':
    main()
