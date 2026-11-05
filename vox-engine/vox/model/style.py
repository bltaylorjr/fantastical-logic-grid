"""Voice identity, emotion and prosody conditioning.

A *style* is one vector that tells the generator who is speaking (speaker
embedding), how they feel (a blend of emotions with intensities), and how they
are delivering it (rate, pitch shift, pitch range, energy). Because the pieces
are separate, you can keep a character's identity fixed while changing mood,
or keep the mood while switching characters.
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from ..config import EMOTIONS, ModelConfig
from .modules import AttentiveStatsPool


class MelEncoder(nn.Module):
    """Small convolutional encoder: mel (B, n_mels, T) -> pooled vector."""

    def __init__(self, n_mels: int, channels: int, out_dim: int):
        super().__init__()
        layers, c_in = [], n_mels
        for dil in (1, 2, 3, 1):
            layers += [nn.Conv1d(c_in, channels, 5, padding=2 * dil, dilation=dil),
                       nn.GELU(), nn.GroupNorm(1, channels)]
            c_in = channels
        self.convs = nn.Sequential(*layers)
        self.pool = AttentiveStatsPool(channels)
        self.proj = nn.Linear(channels * 2, out_dim)

    def forward(self, mel, mask=None):
        return self.proj(self.pool(self.convs(mel), mask))


class SpeakerEncoder(nn.Module):
    """Mel -> unit-length speaker embedding. Used for cloning, voice design and
    for checking that long passages haven't drifted to a different voice."""

    def __init__(self, cfg: ModelConfig, n_mels: int):
        super().__init__()
        self.enc = MelEncoder(n_mels, max(cfg.speaker_dim, 64), cfg.speaker_dim)
        # auxiliary speaker-ID head (training only) keeps the space well organised
        self.cls = nn.Linear(cfg.speaker_dim, cfg.max_speakers, bias=False)

    def forward(self, mel, mask=None):
        return F.normalize(self.enc(mel, mask), dim=-1)

    def id_loss(self, emb, speaker_ids, margin: float = 0.2, scale: float = 30.0):
        """Additive-margin softmax (CosFace)."""
        w = F.normalize(self.cls.weight, dim=-1)
        logits = emb @ w.t()
        logits = logits - margin * F.one_hot(speaker_ids, logits.size(-1))
        return F.cross_entropy(scale * logits, speaker_ids)


class EmotionClassifier(nn.Module):
    """Predicts emotion from audio. Trained on the labeled part of the data and
    then used to pseudo-label the unlabeled part (the hybrid data pipeline)."""

    def __init__(self, n_mels: int, n_emotions: int = len(EMOTIONS), channels: int = 128):
        super().__init__()
        self.enc = MelEncoder(n_mels, channels, channels)
        self.head = nn.Linear(channels, n_emotions)

    def forward(self, mel, mask=None):
        return self.head(F.gelu(self.enc(mel, mask)))


class StyleConditioner(nn.Module):
    """Combines speaker + emotion mix + prosody into one style vector."""

    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.emotion = nn.Embedding(cfg.n_emotions, cfg.style_dim)
        self.speaker_proj = nn.Linear(cfg.speaker_dim, cfg.style_dim)
        self.prosody_proj = nn.Sequential(nn.Linear(cfg.n_prosody, cfg.style_dim), nn.SiLU(),
                                          nn.Linear(cfg.style_dim, cfg.style_dim))
        self.null = nn.Parameter(torch.zeros(cfg.style_dim))   # "no style" for CFG
        self.out = nn.Sequential(nn.SiLU(), nn.Linear(cfg.style_dim, cfg.style_dim))
        # bring rate (z), pitch (semitones), range (log2 ratio), energy (dB) to ~unit scale
        self.register_buffer("prosody_scale", torch.tensor([1.0, 6.0, 1.0, 10.0]), persistent=False)

    def forward(self, speaker_emb, emotion_weights, prosody, drop=None):
        """
        speaker_emb:     (B, speaker_dim)
        emotion_weights: (B, n_emotions)  soft mix; rows need not sum to 1
                         (sum < 1 blends toward neutral = lower intensity)
        prosody:         (B, 4) rate, pitch shift (st), pitch range, energy (dB),
                         all relative to the speaker's own average, 0 = default
        drop:            (B,) bool, True replaces style with the null vector
        """
        neutral = torch.zeros_like(emotion_weights); neutral[:, 0] = 1.0
        w = emotion_weights
        w = w + neutral * (1 - w.sum(-1, keepdim=True)).clamp(min=0)
        p = prosody / self.prosody_scale
        s = self.speaker_proj(speaker_emb) + w @ self.emotion.weight + self.prosody_proj(p)
        s = self.out(s)
        if drop is not None:
            s = torch.where(drop[:, None], self.null.expand_as(s), s)
        return s


def emotion_vector(spec: dict[str, float] | str | None, device=None) -> torch.Tensor:
    """'angry' or {'angry': 0.6, 'sad': 0.3} -> (n_emotions,) weights."""
    v = torch.zeros(len(EMOTIONS), device=device)
    if spec is None:
        v[0] = 1.0
        return v
    if isinstance(spec, str):
        spec = {spec: 1.0}
    for name, w in spec.items():
        name = "tender" if name == "warm" else name
        if name not in EMOTIONS:
            raise ValueError(f"Unknown emotion '{name}'. Choose from: {', '.join(EMOTIONS)}")
        v[EMOTIONS.index(name)] = float(w)
    return v
