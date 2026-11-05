"""Vocoder: turns mel spectrograms into audio.

VoxVocoder follows Vocos (Siuzdenko 2023): instead of upsampling with
transposed convolutions it predicts the STFT magnitude and phase and runs an
inverse FFT. It is fast (real-time on CPU) and avoids metallic artifacts.
Trained adversarially with multi-period and multi-resolution discriminators.

GriffinLim is a no-training fallback so the pipeline works before a vocoder
exists (it sounds robotic; use only for testing).
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from ..audio import MelSpectrogram
from ..config import AudioConfig, ModelConfig
from .modules import ConvNeXtBlock


class VoxVocoder(nn.Module):
    def __init__(self, mcfg: ModelConfig, acfg: AudioConfig):
        super().__init__()
        self.acfg = acfg
        self.inp = nn.Conv1d(acfg.n_mels, mcfg.voc_dim, 7, padding=3)
        self.norm_in = nn.LayerNorm(mcfg.voc_dim, eps=1e-6)
        self.blocks = nn.Sequential(*[ConvNeXtBlock(mcfg.voc_dim, mcfg.voc_intermediate)
                                      for _ in range(mcfg.voc_layers)])
        self.norm_out = nn.LayerNorm(mcfg.voc_dim, eps=1e-6)
        self.head = nn.Linear(mcfg.voc_dim, acfg.n_fft + 2)
        self.register_buffer("window", torch.hann_window(acfg.win_length), persistent=False)

    def forward(self, mel):                     # (B, n_mels, T) -> (B, samples)
        h = self.norm_in(self.inp(mel).transpose(1, 2))
        h = self.norm_out(self.blocks(h))
        mag, phase = self.head(h).transpose(1, 2).chunk(2, dim=1)
        mag = torch.exp(mag).clamp(max=1e2)
        spec = torch.polar(mag, phase)
        return torch.istft(spec, self.acfg.n_fft, self.acfg.hop_length, self.acfg.win_length,
                           self.window, center=True)


class GriffinLim(nn.Module):
    def __init__(self, acfg: AudioConfig, iters: int = 32):
        super().__init__()
        self.acfg, self.iters = acfg, iters
        mel = MelSpectrogram(acfg)
        self.register_buffer("inv_fb", torch.linalg.pinv(mel.fb), persistent=False)
        self.register_buffer("window", torch.hann_window(acfg.win_length), persistent=False)

    @torch.no_grad()
    def forward(self, mel):
        a = self.acfg
        mag = (self.inv_fb @ torch.exp(mel)).clamp(min=1e-5)
        g = torch.Generator(device="cpu").manual_seed(0)       # deterministic output
        angles = torch.exp(2j * torch.pi * torch.rand(mag.shape, generator=g).to(mag.device))
        for _ in range(self.iters):
            wav = torch.istft(mag * angles, a.n_fft, a.hop_length, a.win_length, self.window)
            spec = torch.stft(wav, a.n_fft, a.hop_length, a.win_length, self.window,
                              return_complex=True)
            angles = torch.exp(1j * spec.angle())
        return torch.istft(mag * angles, a.n_fft, a.hop_length, a.win_length, self.window)


# ---------------------------------------------------------------- discriminators
class PeriodDiscriminator(nn.Module):
    def __init__(self, period: int):
        super().__init__()
        self.period = period
        chans = [1, 32, 128, 512, 1024]
        self.convs = nn.ModuleList([nn.utils.parametrizations.weight_norm(
            nn.Conv2d(chans[i], chans[i + 1], (5, 1), (3, 1), padding=(2, 0))) for i in range(4)])
        self.post = nn.utils.parametrizations.weight_norm(nn.Conv2d(1024, 1, (3, 1), padding=(1, 0)))

    def forward(self, x):
        b, t = x.shape
        if t % self.period:
            x = F.pad(x, (0, self.period - t % self.period), mode="reflect")
        x = x.view(b, 1, -1, self.period)
        feats = []
        for c in self.convs:
            x = F.leaky_relu(c(x), 0.1); feats.append(x)
        x = self.post(x); feats.append(x)
        return x.flatten(1), feats


class ResolutionDiscriminator(nn.Module):
    def __init__(self, n_fft: int):
        super().__init__()
        self.n_fft = n_fft
        self.convs = nn.ModuleList([nn.utils.parametrizations.weight_norm(
            nn.Conv2d(1 if i == 0 else 32, 32, (3, 9), (1, 1 if i == 0 else 2), padding=(1, 4)))
            for i in range(4)])
        self.post = nn.utils.parametrizations.weight_norm(nn.Conv2d(32, 1, 3, padding=1))

    def forward(self, x):
        spec = torch.stft(x, self.n_fft, self.n_fft // 4, window=torch.hann_window(self.n_fft, device=x.device),
                          return_complex=True).abs().unsqueeze(1)
        feats = []
        for c in self.convs:
            spec = F.leaky_relu(c(spec), 0.1); feats.append(spec)
        spec = self.post(spec); feats.append(spec)
        return spec.flatten(1), feats


class Discriminators(nn.Module):
    def __init__(self):
        super().__init__()
        self.ds = nn.ModuleList([PeriodDiscriminator(p) for p in (2, 3, 5, 7, 11)] +
                                [ResolutionDiscriminator(n) for n in (512, 1024, 2048)])

    def forward(self, x):
        return [d(x) for d in self.ds]


def disc_loss(real_outs, fake_outs):
    return sum(torch.mean(F.relu(1 - r)) + torch.mean(F.relu(1 + f))
               for (r, _), (f, _) in zip(real_outs, fake_outs))


def gen_adv_loss(fake_outs):
    return sum(torch.mean(F.relu(1 - f)) for f, _ in fake_outs)


def feature_matching_loss(real_outs, fake_outs):
    loss = 0.0
    for (_, rf), (_, ff) in zip(real_outs, fake_outs):
        for r, f in zip(rf, ff):
            loss = loss + torch.mean(torch.abs(r.detach() - f))
    return loss
