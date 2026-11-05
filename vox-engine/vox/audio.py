"""Audio utilities written from scratch: mel spectrograms, pitch tracking,
loudness, resampling, file I/O. Only free libraries (numpy, scipy, soundfile, torch).
"""
from __future__ import annotations

import io
import math
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import torch.nn as nn
from scipy.signal import resample_poly

from .config import AudioConfig


# ----------------------------------------------------------------------------- I/O
def load_audio(path: str | Path | bytes, sr: int) -> np.ndarray:
    """Load any wav/flac/ogg file (or raw bytes) as mono float32 at `sr`."""
    src = io.BytesIO(path) if isinstance(path, (bytes, bytearray)) else str(path)
    wav, file_sr = sf.read(src, dtype="float32", always_2d=True)
    wav = wav.mean(axis=1)
    if file_sr != sr:
        wav = resample(wav, file_sr, sr)
    return wav.astype(np.float32)


def resample(wav: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    g = math.gcd(src_sr, dst_sr)
    return resample_poly(wav, dst_sr // g, src_sr // g).astype(np.float32)


def save_audio(path: str | Path, wav: np.ndarray, sr: int) -> None:
    sf.write(str(path), np.clip(wav, -1, 1), sr, subtype="PCM_16")


def to_wav_bytes(wav: np.ndarray, sr: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.clip(wav, -1, 1), sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


# ------------------------------------------------------------------------ loudness
def rms_db(wav: np.ndarray) -> float:
    return 20 * math.log10(float(np.sqrt(np.mean(wav ** 2))) + 1e-9)


def normalize_loudness(wav: np.ndarray, target_db: float = -20.0) -> np.ndarray:
    gain = 10 ** ((target_db - rms_db(wav)) / 20)
    out = wav * gain
    peak = np.abs(out).max() + 1e-9
    return out / peak * 0.98 if peak > 0.98 else out


# ---------------------------------------------------------------- mel spectrogram
def _hz_to_mel(f):
    return 2595.0 * np.log10(1.0 + np.asarray(f) / 700.0)


def _mel_to_hz(m):
    return 700.0 * (10 ** (np.asarray(m) / 2595.0) - 1.0)


def mel_filterbank(cfg: AudioConfig) -> np.ndarray:
    """Triangular mel filters, shape (n_mels, n_fft//2+1), area-normalized."""
    n_freqs = cfg.n_fft // 2 + 1
    fft_freqs = np.linspace(0, cfg.sample_rate / 2, n_freqs)
    mel_pts = np.linspace(_hz_to_mel(cfg.f_min), _hz_to_mel(cfg.f_max), cfg.n_mels + 2)
    hz_pts = _mel_to_hz(mel_pts)
    fb = np.zeros((cfg.n_mels, n_freqs), dtype=np.float32)
    for i in range(cfg.n_mels):
        lo, mid, hi = hz_pts[i], hz_pts[i + 1], hz_pts[i + 2]
        up = (fft_freqs - lo) / max(mid - lo, 1e-9)
        down = (hi - fft_freqs) / max(hi - mid, 1e-9)
        fb[i] = np.maximum(0, np.minimum(up, down))
        fb[i] *= 2.0 / max(hi - lo, 1e-9)   # Slaney-style normalization
    return fb


class MelSpectrogram(nn.Module):
    """Waveform (B, N) -> log-mel (B, n_mels, T)."""

    def __init__(self, cfg: AudioConfig):
        super().__init__()
        self.cfg = cfg
        self.register_buffer("window", torch.hann_window(cfg.win_length), persistent=False)
        self.register_buffer("fb", torch.from_numpy(mel_filterbank(cfg)), persistent=False)

    def forward(self, wav: torch.Tensor) -> torch.Tensor:
        if wav.dim() == 1:
            wav = wav.unsqueeze(0)
        spec = torch.stft(wav, self.cfg.n_fft, self.cfg.hop_length, self.cfg.win_length,
                          self.window, center=True, return_complex=True)
        mag = spec.abs()
        mel = torch.matmul(self.fb, mag)
        return torch.log(torch.clamp(mel, min=1e-5))


def num_frames(n_samples: int, cfg: AudioConfig) -> int:
    return n_samples // cfg.hop_length + 1


# --------------------------------------------------------------- pitch & energy
def track_pitch(wav: np.ndarray, sr: int, hop: int, fmin: float = 60.0,
                fmax: float = 600.0, threshold: float = 0.15) -> np.ndarray:
    """YIN pitch tracker (de Cheveigné & Kawahara 2002). Returns f0 per frame in Hz,
    0 where unvoiced. Vectorised with numpy, good enough for data labeling."""
    frame = int(sr / fmin) * 2
    tau_min, tau_max = int(sr / fmax), int(sr / fmin)
    pad = np.pad(wav, (frame // 2, frame // 2 + frame))
    n = 1 + len(wav) // hop
    f0 = np.zeros(n, dtype=np.float32)
    for i in range(n):
        x = pad[i * hop: i * hop + frame]
        if len(x) < frame or np.sqrt(np.mean(x ** 2)) < 1e-3:
            continue
        w = frame // 2
        # difference function via autocorrelation identity
        x0 = x[:w]
        energy = np.cumsum(np.concatenate([[0.0], x ** 2]))
        e0 = energy[w]
        taus = np.arange(tau_max + 1)
        e_tau = energy[taus + w] - energy[taus]
        corr = np.correlate(x[: w + tau_max], x0, mode="valid")[: tau_max + 1]
        d = e0 + e_tau - 2 * corr
        d[0] = 0
        cmnd = d[1:] * np.arange(1, tau_max + 1) / (np.cumsum(d[1:]) + 1e-9)
        cmnd = np.concatenate([[1.0], cmnd])
        cand = np.where(cmnd[tau_min:tau_max] < threshold)[0]
        if len(cand) == 0:
            continue
        t = cand[0] + tau_min
        while t + 1 < tau_max and cmnd[t + 1] < cmnd[t]:
            t += 1
        # parabolic interpolation for sub-sample accuracy
        if 1 <= t < tau_max:
            a, b, c = cmnd[t - 1], cmnd[t], cmnd[t + 1]
            denom = a - 2 * b + c
            t = t + (0.5 * (a - c) / denom if abs(denom) > 1e-9 else 0)
        f0[i] = sr / t
    return f0


def frame_energy_db(wav: np.ndarray, hop: int, win: int = 1024) -> np.ndarray:
    pad = np.pad(wav, (win // 2, win // 2))
    n = 1 + len(wav) // hop
    out = np.empty(n, dtype=np.float32)
    for i in range(n):
        seg = pad[i * hop: i * hop + win]
        out[i] = 10 * np.log10(np.mean(seg ** 2) + 1e-10)
    return out


def semitones(f0_hz: np.ndarray, ref_hz: float) -> np.ndarray:
    return 12 * np.log2(np.maximum(f0_hz, 1e-6) / ref_hz)
