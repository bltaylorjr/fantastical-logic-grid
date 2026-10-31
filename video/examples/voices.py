# Voices the talking-face example clips (lines.json) with Kokoro, the game's
# free voice: one WAV per example in video/examples/out/.
import json, os, sys, wave
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from build import kokoro, SR  # noqa: E402

out = os.path.join(HERE, 'out')
os.makedirs(out, exist_ok=True)
tts = kokoro()
for ex in json.load(open(os.path.join(HERE, 'lines.json'))):
    samples, rate = tts.create(ex['line'], voice=ex['voice'], speed=ex['speed'], lang='en-us')
    pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2')
    with wave.open(os.path.join(out, f"{ex['id']}.wav"), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm.tobytes())
    print(ex['id'], f'{len(pcm) / rate:.1f}s')
