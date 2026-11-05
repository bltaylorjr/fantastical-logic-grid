"""VoxModel bundles every trained network into one checkpoint file."""
from __future__ import annotations

from pathlib import Path

import torch
import torch.nn as nn

from ..audio import MelSpectrogram
from ..config import VoxConfig
from .dit import DurationPredictor, VoxDiT
from .style import EmotionClassifier, SpeakerEncoder, StyleConditioner
from .vocoder import GriffinLim, VoxVocoder


class VoxModel(nn.Module):
    def __init__(self, cfg: VoxConfig):
        super().__init__()
        self.cfg = cfg
        m, a = cfg.model, cfg.audio
        self.mel = MelSpectrogram(a)
        self.dit = VoxDiT(m, a.n_mels)
        self.duration = DurationPredictor(m)
        self.speaker = SpeakerEncoder(m, a.n_mels)
        self.style = StyleConditioner(m)
        self.emotion_clf = EmotionClassifier(a.n_mels)
        self.vocoder = VoxVocoder(m, a)
        self.griffin_lim = GriffinLim(a)
        self.vocoder_trained = False

    def param_count(self) -> dict[str, float]:
        parts = {"generator": self.dit, "duration": self.duration, "speaker": self.speaker,
                 "style": self.style, "emotion": self.emotion_clf, "vocoder": self.vocoder}
        return {k: sum(p.numel() for p in v.parameters()) / 1e6 for k, v in parts.items()}

    @torch.no_grad()
    def mel_to_wav(self, mel_bct: torch.Tensor) -> torch.Tensor:
        voc = self.vocoder if self.vocoder_trained else self.griffin_lim
        return voc(mel_bct)

    def save(self, path: str | Path, extra: dict | None = None) -> None:
        torch.save({"config": self.cfg, "state": self.state_dict(),
                    "vocoder_trained": self.vocoder_trained, **(extra or {})}, str(path))

    @classmethod
    def load(cls, path: str | Path, device: str = "cpu") -> "VoxModel":
        ck = torch.load(str(path), map_location=device, weights_only=False)
        model = cls(ck["config"])
        state = ck["state"]
        own = model.state_dict()
        for k, v in state.items():      # older checkpoints had a smaller vocabulary: extend it
            if k in own and v.dim() == 2 and own[k].dim() == 2 and v.shape[0] < own[k].shape[0] and v.shape[1] == own[k].shape[1]:
                grown = own[k].clone()
                grown[: v.shape[0]] = v
                state[k] = grown
        model.load_state_dict(state)
        model.vocoder_trained = ck.get("vocoder_trained", False)
        model.extras = {k: v for k, v in ck.items() if k not in ("config", "state", "vocoder_trained")}
        return model.to(device).eval()
