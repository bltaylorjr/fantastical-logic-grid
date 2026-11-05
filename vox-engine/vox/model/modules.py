"""Building blocks shared by the generator, vocoder and encoders."""
from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F


class RotaryEmbedding(nn.Module):
    """Rotary position embeddings: lets attention reason about relative timing,
    which matters for rhythm and pacing."""

    def __init__(self, head_dim: int, base: float = 10000.0):
        super().__init__()
        inv = 1.0 / (base ** (torch.arange(0, head_dim, 2).float() / head_dim))
        self.register_buffer("inv_freq", inv, persistent=False)

    def forward(self, n: int, device) -> tuple[torch.Tensor, torch.Tensor]:
        t = torch.arange(n, device=device).float()
        freqs = torch.outer(t, self.inv_freq)
        emb = torch.cat([freqs, freqs], dim=-1)
        return emb.cos()[None, None], emb.sin()[None, None]


def apply_rotary(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    x1, x2 = x.chunk(2, dim=-1)
    rot = torch.cat([-x2, x1], dim=-1)
    return x * cos + rot * sin


class Attention(nn.Module):
    def __init__(self, dim: int, heads: int, dropout: float = 0.0):
        super().__init__()
        self.heads = heads
        self.qkv = nn.Linear(dim, dim * 3)
        self.out = nn.Linear(dim, dim)
        self.q_norm = nn.RMSNorm(dim // heads)   # QK-norm keeps long sequences stable
        self.k_norm = nn.RMSNorm(dim // heads)
        self.dropout = dropout

    def forward(self, x, rope, mask=None):
        b, n, d = x.shape
        q, k, v = self.qkv(x).view(b, n, 3, self.heads, d // self.heads).permute(2, 0, 3, 1, 4)
        q, k = self.q_norm(q), self.k_norm(k)
        q, k = apply_rotary(q, *rope), apply_rotary(k, *rope)
        attn_mask = None if mask is None else mask[:, None, None, :]
        y = F.scaled_dot_product_attention(q, k, v, attn_mask=attn_mask,
                                           dropout_p=self.dropout if self.training else 0.0)
        return self.out(y.transpose(1, 2).reshape(b, n, d))


class FeedForward(nn.Module):
    def __init__(self, dim: int, mult: int = 2, dropout: float = 0.0):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(dim, dim * mult), nn.GELU(approximate="tanh"),
                                 nn.Dropout(dropout), nn.Linear(dim * mult, dim))

    def forward(self, x):
        return self.net(x)


class DiTBlock(nn.Module):
    """Transformer block with adaptive LayerNorm-Zero (Peebles & Xie 2023).

    The conditioning vector (diffusion time + voice + emotion + prosody) shifts,
    scales and gates every sub-layer, which is how style reaches every frame.
    """

    def __init__(self, dim: int, heads: int, ff_mult: int, dropout: float):
        super().__init__()
        self.norm1 = nn.LayerNorm(dim, elementwise_affine=False, eps=1e-6)
        self.attn = Attention(dim, heads, dropout)
        self.norm2 = nn.LayerNorm(dim, elementwise_affine=False, eps=1e-6)
        self.ff = FeedForward(dim, ff_mult, dropout)
        self.ada = nn.Sequential(nn.SiLU(), nn.Linear(dim, dim * 6))
        nn.init.zeros_(self.ada[1].weight); nn.init.zeros_(self.ada[1].bias)

    def forward(self, x, c, rope, mask=None):
        s1, sc1, g1, s2, sc2, g2 = self.ada(c)[:, None].chunk(6, dim=-1)
        x = x + g1 * self.attn(self.norm1(x) * (1 + sc1) + s1, rope, mask)
        x = x + g2 * self.ff(self.norm2(x) * (1 + sc2) + s2)
        return x


class ConvNeXtBlock(nn.Module):
    """1-D ConvNeXt V2 block, used in the text encoder and the vocoder."""

    def __init__(self, dim: int, intermediate: int, kernel: int = 7, dilation: int = 1):
        super().__init__()
        pad = (kernel - 1) * dilation // 2
        self.dw = nn.Conv1d(dim, dim, kernel, padding=pad, groups=dim, dilation=dilation)
        self.norm = nn.LayerNorm(dim, eps=1e-6)
        self.pw1 = nn.Linear(dim, intermediate)
        self.grn_g = nn.Parameter(torch.zeros(1, 1, intermediate))
        self.grn_b = nn.Parameter(torch.zeros(1, 1, intermediate))
        self.pw2 = nn.Linear(intermediate, dim)

    def forward(self, x):            # x: (B, T, C)
        r = x
        x = self.dw(x.transpose(1, 2)).transpose(1, 2)
        x = F.gelu(self.pw1(self.norm(x)))
        gx = torch.norm(x, p=2, dim=1, keepdim=True)
        nx = gx / (gx.mean(dim=-1, keepdim=True) + 1e-6)
        x = self.grn_g * (x * nx) + self.grn_b + x
        return r + self.pw2(x)


class TimestepEmbedding(nn.Module):
    def __init__(self, dim: int, freq_dim: int = 256):
        super().__init__()
        self.freq_dim = freq_dim
        self.mlp = nn.Sequential(nn.Linear(freq_dim, dim), nn.SiLU(), nn.Linear(dim, dim))

    def forward(self, t: torch.Tensor) -> torch.Tensor:
        half = self.freq_dim // 2
        freqs = torch.exp(-math.log(10000) * torch.arange(half, device=t.device) / half)
        args = t[:, None].float() * 1000 * freqs[None]
        return self.mlp(torch.cat([args.cos(), args.sin()], dim=-1))


class AttentiveStatsPool(nn.Module):
    """Summarise a variable-length sequence into one vector (mean + std weighted
    by learned attention). Used for speaker and emotion embeddings."""

    def __init__(self, dim: int, hidden: int = 128):
        super().__init__()
        self.att = nn.Sequential(nn.Conv1d(dim, hidden, 1), nn.Tanh(), nn.Conv1d(hidden, dim, 1))

    def forward(self, x, mask=None):     # x: (B, C, T), mask: (B, T) True=valid
        w = self.att(x)
        if mask is not None:
            w = w.masked_fill(~mask[:, None], -1e4)
        w = torch.softmax(w, dim=-1)
        mu = (x * w).sum(-1)
        sd = torch.sqrt(((x ** 2) * w).sum(-1) - mu ** 2 + 1e-5)
        return torch.cat([mu, sd], dim=-1)


def lengths_to_mask(lengths: torch.Tensor, max_len: int | None = None) -> torch.Tensor:
    max_len = max_len or int(lengths.max())
    return torch.arange(max_len, device=lengths.device)[None] < lengths[:, None]
