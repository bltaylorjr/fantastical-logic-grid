"""Configuration for the Vox voice engine.

Every size and setting lives here so you can scale the same code from a tiny
test model (runs on a laptop CPU) up to a full-quality model (needs a GPU).
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

# Emotion labels the model understands. Order matters (it's an index table).
EMOTIONS = [
    "neutral", "happy", "sad", "angry", "fearful", "surprised",
    "disgusted", "calm", "excited", "tender", "whisper", "shout",
]

# Licenses the data pipeline accepts by default. All allow commercial use,
# so a game you sell can ship voices trained on this data with no royalties.
COMMERCIAL_SAFE_LICENSES = {
    "public-domain", "cc0", "cc-by-4.0", "cc-by-3.0", "cc-by-sa-4.0",
    "cc-by-sa-3.0", "odbl", "own-recording", "consented",
}
# Non-commercial licenses: only accepted when a project is marked non-commercial.
NONCOMMERCIAL_LICENSES = {"cc-by-nc-4.0", "cc-by-nc-sa-4.0", "cc-by-nc-3.0"}


@dataclass
class AudioConfig:
    sample_rate: int = 24000
    n_fft: int = 1024
    hop_length: int = 256        # 1 frame = 10.7 ms at 24 kHz
    win_length: int = 1024
    n_mels: int = 100
    f_min: float = 0.0
    f_max: float = 12000.0


@dataclass
class ModelConfig:
    # Diffusion transformer (the speech generator)
    dim: int = 1024
    depth: int = 22
    heads: int = 16
    ff_mult: int = 2
    dropout: float = 0.1
    # Text encoder
    text_dim: int = 512
    text_layers: int = 4
    # Style: speaker identity + emotion + prosody controls
    speaker_dim: int = 256
    style_dim: int = 512
    n_emotions: int = len(EMOTIONS)
    n_prosody: int = 4           # rate, pitch shift, pitch range, energy
    max_speakers: int = 4096     # for the auxiliary speaker-ID loss in training
    # "mixed": English words as sounds (from the dictionary) or letters, so the
    # model learns both; "bytes": letters only (any language, no dictionary)
    text_mode: str = "mixed"
    keep_letters: float = 0.5    # in training, chance a word stays spelled out
    # Classifier-free guidance dropout rates used during training
    p_drop_text: float = 0.15
    p_drop_style: float = 0.10
    p_drop_audio: float = 0.30
    # Duration predictor
    dur_dim: int = 256
    dur_layers: int = 4
    # Vocoder (mel -> waveform)
    voc_dim: int = 512
    voc_layers: int = 8
    voc_intermediate: int = 1536

    @classmethod
    def tiny(cls) -> "ModelConfig":
        """A very small model for tests and CPU experiments."""
        return cls(dim=64, depth=2, heads=4, text_dim=32, text_layers=1,
                   speaker_dim=32, style_dim=64, max_speakers=16,
                   dur_dim=32, dur_layers=1, voc_dim=32, voc_layers=1,
                   voc_intermediate=64, dropout=0.0)

    @classmethod
    def small(cls) -> "ModelConfig":
        """~60M params. Trainable on one free cloud GPU (Kaggle / Colab)."""
        return cls(dim=512, depth=12, heads=8, text_dim=256, text_layers=3,
                   style_dim=384, dur_dim=192, voc_dim=384, voc_layers=6,
                   voc_intermediate=1152)

    @classmethod
    def base(cls) -> "ModelConfig":
        """~330M params. Best quality; wants a 24GB+ GPU."""
        return cls()


@dataclass
class TrainConfig:
    batch_frames: int = 38400    # total mel frames per batch (~6.8 min audio)
    lr: float = 7.5e-5
    warmup_steps: int = 20000
    max_steps: int = 1_000_000
    grad_clip: float = 1.0
    ema_decay: float = 0.9999
    log_every: int = 100
    save_every: int = 5000
    num_workers: int = 4
    mixed_precision: bool = True
    seed: int = 1234


@dataclass
class InferenceConfig:
    nfe_steps: int = 32          # ODE steps; fewer = faster, more = cleaner
    sway: float = -1.0           # sway sampling: spends more steps early on
    cfg_text: float = 2.0        # how strongly to follow the text
    cfg_style: float = 1.5       # how strongly to follow emotion/voice settings
    max_chunk_chars: int = 220   # long text is split into chunks this size
    crossfade_ms: int = 40
    drift_threshold: float = 0.75  # min speaker similarity before a retry
    max_retries: int = 2


@dataclass
class VoxConfig:
    audio: AudioConfig = field(default_factory=AudioConfig)
    model: ModelConfig = field(default_factory=ModelConfig)
    train: TrainConfig = field(default_factory=TrainConfig)
    infer: InferenceConfig = field(default_factory=InferenceConfig)
    noncommercial_project: bool = False

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(asdict(self), indent=2))

    @classmethod
    def load(cls, path: str | Path) -> "VoxConfig":
        d = json.loads(Path(path).read_text())
        return cls(audio=AudioConfig(**d["audio"]), model=ModelConfig(**d["model"]),
                   train=TrainConfig(**d["train"]), infer=InferenceConfig(**d["infer"]),
                   noncommercial_project=d.get("noncommercial_project", False))

    @classmethod
    def preset(cls, name: str) -> "VoxConfig":
        model = {"tiny": ModelConfig.tiny, "small": ModelConfig.small,
                 "base": ModelConfig.base}[name]()
        return cls(model=model)
