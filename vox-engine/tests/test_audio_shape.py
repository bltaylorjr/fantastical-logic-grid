import numpy as np, torch
from vox.audio import track_pitch
from vox import delivery as dl
sr = 24000
def voice(f0, secs=1.2, gaps=()):
    t = np.arange(int(sr * secs)) / sr
    ph = 2 * np.pi * np.cumsum(np.full(len(t), f0)) / sr
    w = sum(np.sin(k * ph) / k for k in range(1, 20)).astype(np.float32) * 0.2
    for a, b in gaps: w[int(a * sr):int(b * sr)] = 0
    return w
def med(w):
    f = track_pitch(w.astype(np.float64), sr, sr // 200, fmin=60, fmax=900); return float(np.median(f[f > 0]))
w = voice(120)
print(f"source {med(w):.0f} Hz -> child target 290 Hz: {med(dl.move_pitch_to(w, sr, 290)):.0f} Hz")
print(f"source {med(w):.0f} Hz -> teen boy 165 Hz: {med(dl.move_pitch_to(w, sr, 165)):.0f} Hz")
# singing: 4 syllables onto C4 E4 G4 C5
w4 = voice(200, 2.0, gaps=[(0.45, 0.55), (0.95, 1.05), (1.45, 1.55)])
out = dl.sing(w4, sr, {"notes": "C4 E4 G4 C5"})
hop = sr // 200; f = track_pitch(out.astype(np.float64), sr, hop, fmin=60, fmax=900)
notes = []
for a, b in [(0.1, 0.4), (0.6, 0.9), (1.1, 1.4), (1.6, 1.9)]:
    seg = f[int(a * sr / hop):int(b * sr / hop)]; seg = seg[seg > 0]
    notes.append(round(69 + 12 * np.log2(np.median(seg) / 440)))
print("sung notes (MIDI):", notes, "(want a C-E-G-C pattern: steps of 4, 3, 5)")
assert [notes[1] - notes[0], notes[2] - notes[1], notes[3] - notes[2]] == [4, 3, 5], notes
print("auto tune melody in G major:", dl.melody({"key": "G", "scale": "major"}, 8, seed=1))
# formant warp: a peak at mel bin 30 moves up for a child (alpha 1.4)
mel = torch.full((5, 100), -11.5); mel[:, 30] = 0.0
moved = dl.warp_formants(mel, 1.4, 0, 12000, -11.5)
print("formant peak bin 30 ->", int(moved[0].argmax()), "(higher = smaller vocal tract)")
assert int(moved[0].argmax()) > 30
for k in ("breathy", "raspy", "tremble"):
    o = dl.touch(w, sr, {k: 0.6}); assert np.isfinite(o).all() and o.shape == w.shape
print("AUDIO OK")
