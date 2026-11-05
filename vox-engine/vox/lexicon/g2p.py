"""Letters-to-sounds (G2P): a small transformer, written from scratch and
trained on the CMU Pronouncing Dictionary, that guesses how to say words no
dictionary has: fantasy names, new slang, typos.

    g2p = G2P.load()            # the trained model shipped with Vox
    g2p("Zarathel")             # -> 'Z AE1 R AH0 TH EH2 L'
"""
from __future__ import annotations

import math
import random
import time
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F

from .phonemes import PHONE_SET

LETTERS = list("abcdefghijklmnopqrstuvwxyz'-")
PAD, BOS, EOS = 0, 1, 2
L_INDEX = {c: i + 3 for i, c in enumerate(LETTERS)}
P_INDEX = {p: i + 3 for i, p in enumerate(PHONE_SET)}
P_LIST = ["<pad>", "<s>", "</s>"] + PHONE_SET
DEFAULT_PATH = Path(__file__).parent / "g2p.pt"
MAX_LEN = 32


class G2PModel(nn.Module):
    def __init__(self, dim: int = 192, heads: int = 4, layers: int = 3, ff: int = 512):
        super().__init__()
        self.dim = dim
        self.src_emb = nn.Embedding(len(LETTERS) + 3, dim)
        self.tgt_emb = nn.Embedding(len(P_LIST), dim)
        self.pos = nn.Embedding(MAX_LEN + 2, dim)
        self.tf = nn.Transformer(dim, heads, layers, layers, ff, dropout=0.1, batch_first=True, norm_first=True)
        self.out = nn.Linear(dim, len(P_LIST))
        self.config = {"dim": dim, "heads": heads, "layers": layers, "ff": ff}

    def _emb(self, table, x):
        pos = torch.arange(x.size(1), device=x.device)[None]
        return table(x) * math.sqrt(self.dim) + self.pos(pos)

    def forward(self, src, tgt_in):
        mask = self.tf.generate_square_subsequent_mask(tgt_in.size(1), device=src.device, dtype=torch.bool)
        h = self.tf(self._emb(self.src_emb, src), self._emb(self.tgt_emb, tgt_in), tgt_mask=mask,
                    src_key_padding_mask=src == PAD, tgt_key_padding_mask=tgt_in == PAD,
                    memory_key_padding_mask=src == PAD)
        return self.out(h)

    @torch.no_grad()
    def generate(self, src, max_len: int = MAX_LEN):
        memory = self.tf.encoder(self._emb(self.src_emb, src), src_key_padding_mask=src == PAD)
        ys = torch.full((src.size(0), 1), BOS, dtype=torch.long, device=src.device)
        done = torch.zeros(src.size(0), dtype=torch.bool, device=src.device)
        for _ in range(max_len):
            mask = self.tf.generate_square_subsequent_mask(ys.size(1), device=src.device, dtype=torch.bool)
            h = self.tf.decoder(self._emb(self.tgt_emb, ys), memory, tgt_mask=mask,
                                memory_key_padding_mask=src == PAD)
            nxt = self.out(h[:, -1]).argmax(-1)
            nxt = torch.where(done, torch.full_like(nxt, PAD), nxt)
            ys = torch.cat([ys, nxt[:, None]], 1)
            done |= nxt == EOS
            if done.all():
                break
        return ys[:, 1:]


def encode_word(w: str) -> list[int]:
    return [L_INDEX[c] for c in w.lower() if c in L_INDEX][:MAX_LEN]


def _batch(seqs, bos_eos=False):
    if bos_eos:
        seqs = [[BOS] + s + [EOS] for s in seqs]
    n = max(len(s) for s in seqs)
    return torch.tensor([s + [PAD] * (n - len(s)) for s in seqs])


class G2P:
    def __init__(self, model: G2PModel, device: str = "cpu"):
        self.model = model.to(device).eval()
        self.device = device
        self.cache: dict[str, str] = {}

    @classmethod
    def load(cls, path: str | Path | None = None, device: str = "cpu") -> "G2P | None":
        p = Path(path) if path else DEFAULT_PATH
        if not p.exists():
            return None
        ck = torch.load(str(p), map_location=device, weights_only=False)
        m = G2PModel(**ck["config"])
        m.load_state_dict(ck["state"])
        return cls(m, device)

    def __call__(self, word: str) -> str:
        return self.batch([word])[0]

    def batch(self, words: list[str]) -> list[str]:
        out, todo = {}, []
        for w in words:
            k = w.lower()
            if k in self.cache:
                out[k] = self.cache[k]
            elif encode_word(k):
                todo.append(k)
            else:
                out[k] = ""
        for i in range(0, len(todo), 256):
            chunk = todo[i:i + 256]
            src = _batch([encode_word(w) for w in chunk]).to(self.device)
            for w, seq in zip(chunk, self.model.generate(src).tolist()):
                phones = []
                for t in seq:
                    if t in (EOS, PAD):
                        break
                    if t > 2:
                        phones.append(P_LIST[t])
                self.cache[w] = out[w] = " ".join(phones)
        return [out[w.lower()] for w in words]


def cmu_pairs() -> list[tuple[str, str]]:
    import cmudict
    pairs = []
    for w, prons in cmudict.dict().items():
        if 1 < len(w) <= MAX_LEN and all(c in L_INDEX for c in w):
            pairs.append((w, " ".join(prons[0])))
    return pairs


def train_g2p(out: str | Path = DEFAULT_PATH, minutes: float = 30.0, batch: int = 256, seed: int = 0,
              dim: int = 192, layers: int = 3, log=print) -> dict:
    """Train on CMUdict, hold out 2% to measure accuracy. Stops after `minutes`."""
    rng = random.Random(seed)
    torch.manual_seed(seed)
    pairs = cmu_pairs()
    rng.shuffle(pairs)
    n_test = max(500, len(pairs) // 50)
    test, train = pairs[:n_test], pairs[n_test:]
    model = G2PModel(dim=dim, layers=layers)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, betas=(0.9, 0.98), weight_decay=0.01)
    steps_per_epoch = len(train) // batch
    t0, step, epoch = time.time(), 0, 0
    train.sort(key=lambda p: len(p[0]))
    batches = [train[i:i + batch] for i in range(0, len(train), batch)]
    while time.time() - t0 < minutes * 60:
        epoch += 1
        rng.shuffle(batches)
        model.train()
        for b in batches:
            src = _batch([encode_word(w) for w, _ in b])
            tgt = _batch([[P_INDEX[p] for p in ph.split()] for _, ph in b], bos_eos=True)
            logits = model(src, tgt[:, :-1])
            loss = F.cross_entropy(logits.reshape(-1, logits.size(-1)), tgt[:, 1:].reshape(-1),
                                   ignore_index=PAD, label_smoothing=0.05)
            lr = 1e-3 * min(1.0, (step + 1) / 1000) * max(0.05, 1 - (time.time() - t0) / (minutes * 60))
            for g in opt.param_groups:
                g["lr"] = lr
            opt.zero_grad(); loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); step += 1
            if step % 200 == 0:
                log(f"epoch {epoch} step {step} loss {loss.item():.3f} ({(time.time() - t0) / 60:.1f} min)")
            if time.time() - t0 >= minutes * 60:
                break
    model.eval()
    g = G2P(model)
    sample = test[:2000]
    guesses = g.batch([w for w, _ in sample])
    word_acc = sum(gu == ph for gu, (_, ph) in zip(guesses, sample)) / len(sample)
    nostress = sum(_strip(gu) == _strip(ph) for gu, (_, ph) in zip(guesses, sample)) / len(sample)
    torch.save({"config": model.config, "state": model.state_dict(),
                "accuracy": {"words": word_acc, "words_ignoring_stress": nostress, "tested": len(sample)},
                "trained_on": f"CMUdict ({len(train)} words)"}, str(out))
    result = {"word_accuracy": round(word_acc, 4), "ignoring_stress": round(nostress, 4), "steps": step,
              "epochs": epoch, "minutes": round((time.time() - t0) / 60, 1)}
    log(str(result))
    return result


def _strip(s: str) -> str:
    return " ".join(p.rstrip("012") for p in s.split())
