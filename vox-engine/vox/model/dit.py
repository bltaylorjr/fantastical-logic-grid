"""The speech generator: a Diffusion Transformer trained with conditional
flow matching (Lipman et al. 2023), in the style of F5-TTS / E2-TTS but written
from scratch with richer conditioning.

How it works, in plain terms:
  * The model learns to turn random noise into a mel spectrogram step by step.
  * At every step it sees: the text, any audio it should continue from (a voice
    sample to clone, or the surrounding audio when editing), and a style vector
    (voice + emotion + prosody).
  * Because it is trained to *fill in masked regions*, the same model does
    plain TTS, voice cloning (fill in after a sample), and editing (fill in a
    hole in the middle of existing audio).
  * No forced alignment is needed: the text is just padded to the audio length
    and attention learns which sounds go where, so rhythm comes from data
    rather than a fixed cadence.
"""
from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F

from ..config import ModelConfig
from ..text import PAD, VOCAB_SIZE
from .modules import ConvNeXtBlock, DiTBlock, RotaryEmbedding, TimestepEmbedding

MEL_MEAN, MEL_STD = -5.0, 2.5


def norm_mel(m):
    return (m - MEL_MEAN) / MEL_STD


def denorm_mel(m):
    return m * MEL_STD + MEL_MEAN


class TextEncoder(nn.Module):
    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.embed = nn.Embedding(VOCAB_SIZE, cfg.text_dim)
        self.blocks = nn.Sequential(*[ConvNeXtBlock(cfg.text_dim, cfg.text_dim * 2)
                                      for _ in range(cfg.text_layers)])

    def forward(self, tokens):                 # (B, T) already padded to mel length
        return self.blocks(self.embed(tokens))


class ConvPositionEmbedding(nn.Module):
    def __init__(self, dim: int, kernel: int = 31, groups: int = 16):
        super().__init__()
        groups = math.gcd(groups, dim)
        self.net = nn.Sequential(nn.Conv1d(dim, dim, kernel, padding=kernel // 2, groups=groups), nn.Mish(),
                                 nn.Conv1d(dim, dim, kernel, padding=kernel // 2, groups=groups), nn.Mish())

    def forward(self, x, mask=None):
        if mask is not None:
            x = x.masked_fill(~mask[..., None], 0.0)
        return x + self.net(x.transpose(1, 2)).transpose(1, 2)


class VoxDiT(nn.Module):
    def __init__(self, cfg: ModelConfig, n_mels: int):
        super().__init__()
        self.cfg, self.n_mels = cfg, n_mels
        self.text = TextEncoder(cfg)
        self.in_proj = nn.Linear(n_mels * 2 + cfg.text_dim, cfg.dim)
        self.pos = ConvPositionEmbedding(cfg.dim)
        self.time = TimestepEmbedding(cfg.dim)
        self.style_proj = nn.Linear(cfg.style_dim, cfg.dim)
        self.rope = RotaryEmbedding(cfg.dim // cfg.heads)
        self.blocks = nn.ModuleList([DiTBlock(cfg.dim, cfg.heads, cfg.ff_mult, cfg.dropout)
                                     for _ in range(cfg.depth)])
        self.norm_out = nn.LayerNorm(cfg.dim, elementwise_affine=False, eps=1e-6)
        self.ada_out = nn.Sequential(nn.SiLU(), nn.Linear(cfg.dim, cfg.dim * 2))
        self.out = nn.Linear(cfg.dim, n_mels)
        nn.init.zeros_(self.ada_out[1].weight); nn.init.zeros_(self.ada_out[1].bias)
        nn.init.zeros_(self.out.weight); nn.init.zeros_(self.out.bias)

    def forward(self, x_t, cond, tokens, t, style, mask=None):
        """
        x_t:    (B, T, n_mels) noisy mel at time t
        cond:   (B, T, n_mels) known audio (zeros where the model must generate)
        tokens: (B, T) text tokens, PAD-filled to length T
        t:      (B,) flow time in [0, 1]
        style:  (B, style_dim)
        mask:   (B, T) True on valid (non-padding) frames
        """
        h = self.in_proj(torch.cat([x_t, cond, self.text(tokens)], dim=-1))
        h = self.pos(h, mask)
        c = self.time(t) + self.style_proj(style)
        rope = self.rope(h.size(1), h.device)
        for blk in self.blocks:
            h = blk(h, c, rope, mask)
        shift, scale = self.ada_out(c)[:, None].chunk(2, dim=-1)
        return self.out(self.norm_out(h) * (1 + scale) + shift)

    # ------------------------------------------------------------------ training
    def flow_matching_loss(self, mel, lengths, tokens, style, drop_text, drop_audio):
        """mel (B, T, n_mels) log-mel; returns scalar loss on the generated region."""
        b, T, _ = mel.shape
        x1 = norm_mel(mel)
        valid = torch.arange(T, device=mel.device)[None] < lengths[:, None]
        # mask a random 70-100% span: the model learns to continue/infill speech
        frac = torch.empty(b, device=mel.device).uniform_(0.7, 1.0)
        span = (lengths.float() * frac).long().clamp(min=1)
        start = (torch.rand(b, device=mel.device) * (lengths - span + 1).float()).long()
        idx = torch.arange(T, device=mel.device)[None]
        gen = (idx >= start[:, None]) & (idx < (start + span)[:, None]) & valid

        cond = torch.where(gen[..., None], torch.zeros_like(x1), x1)
        cond = torch.where(drop_audio[:, None, None], torch.zeros_like(cond), cond)
        tokens = torch.where(drop_text[:, None], torch.full_like(tokens, PAD), tokens)

        # logit-normal time sampling focuses training on the hardest middle steps
        t = torch.sigmoid(torch.randn(b, device=mel.device))
        x0 = torch.randn_like(x1)
        x_t = (1 - t[:, None, None]) * x0 + t[:, None, None] * x1
        v = self(x_t, cond, tokens, t, style, valid)
        err = ((v - (x1 - x0)) ** 2).mean(-1)
        return (err * gen).sum() / gen.sum().clamp(min=1)

    # ----------------------------------------------------------------- sampling
    @torch.no_grad()
    def sample(self, cond_mel, gen_mask, tokens, style, null_style, steps=32,
               cfg_text=2.0, cfg_style=1.5, sway=-1.0, seed=None, init_mel=None, t_start=0.0):
        """Generate mel frames where gen_mask is True, keep the rest.

        init_mel/t_start: start part-way along the path from a rough guide
        (SDEdit), which keeps its overall shape, e.g. when re-timing a line.

        Uses compositional classifier-free guidance: one guidance weight pulls
        the output toward the text (clear words, superior prompt alignment) and
        a second pulls toward the requested voice/emotion/prosody.
        """
        b, T, _ = cond_mel.shape
        dev = cond_mel.device
        g = torch.Generator(device="cpu").manual_seed(seed) if seed is not None else None
        x = torch.randn(b, T, self.n_mels, generator=g).to(dev)
        if init_mel is not None:
            x = (1 - t_start) * x + t_start * norm_mel(init_mel)
        known = norm_mel(cond_mel)
        cond = torch.where(gen_mask[..., None], torch.zeros_like(known), known)
        valid = torch.ones(b, T, dtype=torch.bool, device=dev)
        no_text = torch.full_like(tokens, PAD)
        null = null_style.expand(b, -1)

        ts = torch.linspace(0, 1, steps + 1, device=dev)
        ts = ts + sway * (torch.cos(math.pi / 2 * ts) - 1 + ts)   # sway sampling
        ts = t_start + (1 - t_start) * ts
        use_cfg = cfg_text != 1.0 or cfg_style != 1.0
        for i in range(steps):
            t, dt = ts[i], ts[i + 1] - ts[i]
            tt = t.expand(b)
            if use_cfg:
                X = torch.cat([x, x, x]); C = torch.cat([cond, cond, cond])
                K = torch.cat([tokens, tokens, no_text]); S = torch.cat([style, null, null])
                v_full, v_text, v_none = self(X, C, K, tt.repeat(3), S, valid.repeat(3, 1)).chunk(3)
                v = v_none + cfg_text * (v_text - v_none) + cfg_style * (v_full - v_text)
            else:
                v = self(x, cond, tokens, tt, style, valid)
            x = x + dt * v
        out = torch.where(gen_mask[..., None], x, known)
        return denorm_mel(out)


class DurationPredictor(nn.Module):
    """Predicts how many frames a line should take from its text and style.
    Rate controls and emotion (excited speech is faster, sad is slower) flow
    through the style vector."""

    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.embed = nn.Embedding(VOCAB_SIZE, cfg.dur_dim)
        layer = nn.TransformerEncoderLayer(cfg.dur_dim, 4 if cfg.dur_dim % 4 == 0 else 1,
                                           cfg.dur_dim * 2, dropout=0.1, batch_first=True,
                                           norm_first=True)
        self.enc = nn.TransformerEncoder(layer, cfg.dur_layers, enable_nested_tensor=False)
        self.style = nn.Linear(cfg.style_dim, cfg.dur_dim)
        self.head = nn.Sequential(nn.Linear(cfg.dur_dim, cfg.dur_dim), nn.SiLU(), nn.Linear(cfg.dur_dim, 1))

    def forward(self, tokens, token_lens, style):
        """Returns predicted log(frames per token), shape (B,)."""
        mask = torch.arange(tokens.size(1), device=tokens.device)[None] < token_lens[:, None]
        h = self.embed(tokens) + self.style(style)[:, None]
        h = self.enc(h, src_key_padding_mask=~mask)
        pooled = (h * mask[..., None]).sum(1) / token_lens[:, None].clamp(min=1)
        return self.head(pooled).squeeze(-1)

    def loss(self, tokens, token_lens, style, mel_lens):
        target = torch.log(mel_lens.float() / token_lens.float().clamp(min=1))
        return F.l1_loss(self(tokens, token_lens, style), target)
