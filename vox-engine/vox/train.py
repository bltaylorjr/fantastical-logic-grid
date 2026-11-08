"""Training: the speech generator, the vocoder, and the emotion classifier.

Typical order (each step resumes from the previous checkpoint):
    vox train         --data data/manifest.jsonl --out runs/v1 --preset small
    vox train-emotion --data data/manifest.jsonl --ckpt runs/v1/vox.pt
    vox pseudo-label  --data data/manifest.jsonl --ckpt runs/v1/vox.pt
    vox train         --data data/manifest.pseudo.jsonl --resume runs/v1/vox.pt
    vox train-vocoder --data data/manifest.jsonl --ckpt runs/v1/vox.pt
Training saves regularly and can be stopped and resumed at any time, which
is how you fit it into free GPU quotas (Kaggle gives ~30 GPU hours a week).
"""
from __future__ import annotations

import copy
import json
import math
import random
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset, Sampler

from .audio import MelSpectrogram, load_audio
from .config import EMOTIONS, VoxConfig
from .model import VoxModel
from .model.vocoder import Discriminators, disc_loss, feature_matching_loss, gen_adv_loss
from .text import PAD, script_tokens
from .voices import SpeakerSpace

SILENCE = float(np.log(1e-5))


# ======================================================================== data
def read_manifests(paths) -> list[dict]:
    rows = []
    for p in ([paths] if isinstance(paths, (str, Path)) else paths):
        p = Path(p)
        for line in p.read_text().splitlines():
            if line.strip():
                r = json.loads(line)
                r["wav_path"] = str((p.parent / r["wav"]).resolve())
                rows.append(r)
    return rows


def text_tokens(text: str) -> list[int]:
    return script_tokens(text)


class ClipDataset(Dataset):
    def __init__(self, manifests, cfg: VoxConfig, ref_secs: float = 3.0, synthetic_weight: float = 1.0):
        self.cfg = cfg
        self.rows = [r for r in read_manifests(manifests)
                     if synthetic_weight > 0 or r.get("emotion_source") != "synthetic"]
        self.mel = MelSpectrogram(cfg.audio)
        spk = sorted({r["speaker"] for r in self.rows})
        self.spk_index = {s: i for i, s in enumerate(spk)}
        self.by_spk = defaultdict(list)
        for i, r in enumerate(self.rows):
            self.by_spk[r["speaker"]].append(i)
            r["tokens"] = text_tokens(r["text"])          # letters only: a size estimate for batching
            r["frames"] = int(r["secs"] * cfg.audio.sample_rate / cfg.audio.hop_length) + 1
        self.ref_frames = int(ref_secs * cfg.audio.sample_rate / cfg.audio.hop_length)
        self.pronouncer = None
        if getattr(cfg.model, "text_mode", "bytes") != "bytes":
            from .lexicon.dictionary import Pronouncer
            self.pronouncer = Pronouncer.default()

    def __len__(self):
        return len(self.rows)

    def _mel(self, path):
        wav = torch.from_numpy(load_audio(path, self.cfg.audio.sample_rate))
        with torch.no_grad():
            return self.mel(wav)[0].T          # (T, n_mels)

    def __getitem__(self, i):
        r = self.rows[i]
        mel = self._mel(r["wav_path"])
        others = [j for j in self.by_spk[r["speaker"]] if j != i]
        ref = self._mel(self.rows[random.choice(others)]["wav_path"]) if others else mel
        if ref.shape[0] > self.ref_frames:
            s = random.randint(0, ref.shape[0] - self.ref_frames)
            ref = ref[s: s + self.ref_frames]
        emo = EMOTIONS.index(r["emotion"]) if r.get("emotion") in EMOTIONS else -1
        toks = r["tokens"]
        lang = (r.get("language") or "en").lower()
        if self.pronouncer is not None and lang.startswith("en"):
            # each time: some words as sounds, some spelled out, so it learns both
            toks = script_tokens(r["text"], self.pronouncer, self.cfg.model.keep_letters, random)
        return {"mel": mel, "ref": ref, "tokens": torch.tensor(toks[: mel.shape[0]]),
                "speaker": self.spk_index[r["speaker"]], "emotion": emo,
                "prosody": torch.tensor(r.get("prosody") or [0.0] * 4, dtype=torch.float32)}


class FrameBatchSampler(Sampler):
    """Groups clips of similar length so batches hold ~batch_frames frames
    with little padding waste."""

    def __init__(self, ds: ClipDataset, batch_frames: int, seed: int = 0):
        self.ds, self.batch_frames, self.seed, self.epoch = ds, batch_frames, seed, 0

    def _batches(self):
        rng = random.Random(self.seed + self.epoch)
        order = sorted(range(len(self.ds)), key=lambda i: self.ds.rows[i]["frames"] + rng.random())
        batches, cur, longest = [], [], 0
        for i in order:
            f = self.ds.rows[i]["frames"]
            if cur and max(longest, f) * (len(cur) + 1) > self.batch_frames:
                batches.append(cur); cur, longest = [], 0
            cur.append(i); longest = max(longest, f)
        if cur:
            batches.append(cur)
        rng.shuffle(batches)
        return batches

    def __iter__(self):
        self.epoch += 1
        return iter(self._batches())

    def __len__(self):
        return len(self._batches())


def collate(items):
    B = len(items)
    T = max(x["mel"].shape[0] for x in items)
    R = max(x["ref"].shape[0] for x in items)
    L = max(len(x["tokens"]) for x in items)
    n_mels = items[0]["mel"].shape[1]
    mel = torch.full((B, T, n_mels), SILENCE)
    ref = torch.full((B, n_mels, R), SILENCE)
    ref_mask = torch.zeros(B, R, dtype=torch.bool)
    tok_frames = torch.full((B, T), PAD, dtype=torch.long)   # text padded to mel length
    tok = torch.full((B, max(L, 1)), PAD, dtype=torch.long)  # text alone (duration model)
    for i, x in enumerate(items):
        n, r, k = x["mel"].shape[0], x["ref"].shape[0], len(x["tokens"])
        mel[i, :n] = x["mel"]; ref[i, :, :r] = x["ref"].T; ref_mask[i, :r] = True
        tok_frames[i, :k] = x["tokens"]; tok[i, :k] = x["tokens"]
    return {"mel": mel, "lens": torch.tensor([x["mel"].shape[0] for x in items]),
            "ref": ref, "ref_mask": ref_mask, "tok_frames": tok_frames, "tok": tok,
            "tok_lens": torch.tensor([max(len(x["tokens"]), 1) for x in items]),
            "speaker": torch.tensor([x["speaker"] for x in items]),
            "emotion": torch.tensor([x["emotion"] for x in items]),
            "prosody": torch.stack([x["prosody"] for x in items])}


# =================================================================== generator
GEN_PARTS = ("dit", "duration", "speaker", "style")


def _gen_params(model):
    return [p for n in GEN_PARTS for p in getattr(model, n).parameters()]


def train(manifests, out_dir: str | Path, cfg: VoxConfig | None = None, resume: str | None = None,
          max_steps: int | None = None, device: str | None = None, deadline: float | None = None) -> Path:
    """deadline: a time (time.time()) to save and stop by, for GPU sessions with
    a time limit (kaggle/train_gpu.py)."""
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    if resume:
        model = VoxModel.load(resume, device); cfg = model.cfg
        state = getattr(model, "extras", {}).get("train_state", {})
    else:
        cfg = cfg or VoxConfig(); model = VoxModel(cfg).to(device); state = {}
    tc, mc = cfg.train, cfg.model
    torch.manual_seed(tc.seed); random.seed(tc.seed)
    cfg.save(out / "config.json")

    ds = ClipDataset(manifests, cfg)
    if len(ds.spk_index) > mc.max_speakers:
        print(f"note: {len(ds.spk_index)} speakers > max_speakers {mc.max_speakers}; IDs will share classes")
    dl = DataLoader(ds, batch_sampler=FrameBatchSampler(ds, tc.batch_frames, tc.seed),
                    collate_fn=collate, num_workers=tc.num_workers if device == "cuda" else 0,
                    persistent_workers=device == "cuda" and tc.num_workers > 0)
    model.train()
    params = _gen_params(model)
    opt = torch.optim.AdamW(params, lr=tc.lr, betas=(0.9, 0.98), weight_decay=0.01)
    if "opt" in state:
        opt.load_state_dict(state["opt"])
    step = state.get("step", 0)
    total = max_steps if max_steps is not None else tc.max_steps
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / tc.warmup_steps)
                                              * (0.5 * (1 + math.cos(math.pi * min(s / total, 1.0)))) * 0.95 + 0.05)
    import warnings
    with warnings.catch_warnings():          # fast-forward the schedule when resuming
        warnings.simplefilter("ignore")
        for _ in range(step):
            sched.step()
    ema = {n: copy.deepcopy(getattr(model, n)).eval().requires_grad_(False) for n in GEN_PARTS}
    use_amp = device == "cuda" and tc.mixed_precision
    # bfloat16 where the GPU has it (A100 and newer); float16 with loss scaling
    # on older free GPUs (T4, P100), which have no bfloat16.
    amp_dtype = torch.bfloat16 if (use_amp and torch.cuda.is_bf16_supported()) else torch.float16
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp and amp_dtype == torch.float16)
    log = open(out / "log.jsonl", "a")
    t0 = time.time()

    while step < total:
        for batch in dl:
            batch = {k: v.to(device) for k, v in batch.items()}
            B = batch["mel"].shape[0]
            with torch.autocast("cuda", dtype=amp_dtype, enabled=use_amp):
                emb = model.speaker(batch["ref"], batch["ref_mask"])
                spk_loss = model.speaker.id_loss(emb.float(), batch["speaker"] % mc.max_speakers)
                emo = batch["emotion"]
                emo_w = torch.zeros(B, len(EMOTIONS), device=device)
                known = emo >= 0
                emo_w[known] = F.one_hot(emo[known], len(EMOTIONS)).float()
                drop_style = torch.rand(B, device=device) < mc.p_drop_style
                drop_text = torch.rand(B, device=device) < mc.p_drop_text
                drop_audio = torch.rand(B, device=device) < mc.p_drop_audio
                style = model.style(emb, emo_w, batch["prosody"], drop_style)
                fm = model.dit.flow_matching_loss(batch["mel"], batch["lens"], batch["tok_frames"],
                                                  style, drop_text, drop_audio)
                dur = model.duration.loss(batch["tok"], batch["tok_lens"],
                                          model.style(emb.detach(), emo_w, batch["prosody"]), batch["lens"])
                loss = fm + 0.1 * dur + 0.02 * spk_loss
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            gn = torch.nn.utils.clip_grad_norm_(params, tc.grad_clip)
            scaler.step(opt); scaler.update(); sched.step(); step += 1
            decay = min(tc.ema_decay, (1 + step) / (10 + step))
            with torch.no_grad():
                for n in GEN_PARTS:
                    for pe, pm in zip(ema[n].parameters(), getattr(model, n).parameters()):
                        pe.lerp_(pm, 1 - decay)
            if step % tc.log_every == 0 or step == 1:
                rec = {"step": step, "loss": loss.item(), "flow": fm.item(), "dur": dur.item(),
                       "spk": spk_loss.item(), "grad": gn.item(), "lr": sched.get_last_lr()[0],
                       "secs": round(time.time() - t0, 1)}
                print(json.dumps(rec)); log.write(json.dumps(rec) + "\n"); log.flush()
            late = deadline is not None and time.time() >= deadline
            if step % tc.save_every == 0 or step >= total or late:
                _save_with_ema(model, ema, opt, step, ds, out / "vox.pt", device)
            if step >= total or late:
                break
        if deadline is not None and time.time() >= deadline:
            break
    log.close()
    return out / "vox.pt"


def _save_with_ema(model, ema, opt, step, ds, path, device):
    live = {n: copy.deepcopy(getattr(model, n).state_dict()) for n in GEN_PARTS}
    for n in GEN_PARTS:
        getattr(model, n).load_state_dict(ema[n].state_dict())
    model.eval()
    space = compute_speaker_space(model, ds, device)
    model.save(path, {"train_state": {"step": step, "opt": opt.state_dict()},
                      "speaker_space": space.__dict__ if space else None})
    for n in GEN_PARTS:
        getattr(model, n).load_state_dict(live[n])
    model.train()
    print(f"saved {path} (step {step})")


@torch.no_grad()
def compute_speaker_space(model, ds: ClipDataset, device, max_per_speaker: int = 8,
                          max_speakers: int = 2000) -> SpeakerSpace | None:
    """Average embedding + measured voice attributes per speaker -> the space
    that voice design samples new voices from."""
    embs, attrs = [], defaultdict(list)
    for spk, idxs in list(ds.by_spk.items())[:max_speakers]:
        pick = idxs[:max_per_speaker]
        e = torch.stack([model.speaker(ds._mel(ds.rows[i]["wav_path"]).T[None].to(device))[0] for i in pick])
        embs.append(F.normalize(e.mean(0), dim=-1).cpu().numpy())
        rows = [ds.rows[i] for i in pick]
        f0 = [r.get("f0_median_hz", 0) for r in rows if r.get("f0_median_hz", 0) > 0]
        attrs["pitch"].append(float(np.median(f0)) if f0 else 150.0)
        for a in ("brightness", "roughness", "breathiness"):
            attrs[a].append(float(np.mean([r.get(a, 0.0) for r in rows])))
    if len(embs) < 2:
        return None
    pitch = np.array(attrs["pitch"])
    attrs["pitch"] = list(12 * np.log2(pitch / np.median(pitch)))
    return SpeakerSpace.fit(np.stack(embs), {k: np.array(v) for k, v in attrs.items()})


# ===================================================================== emotion
def train_emotion_classifier(ckpt: str, manifests, steps: int = 3000, device: str | None = None,
                             crop_secs: float = 3.0, batch: int = 32) -> None:
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    model = VoxModel.load(ckpt, device)
    ds = ClipDataset(manifests, model.cfg)
    labeled = [i for i, r in enumerate(ds.rows) if r.get("emotion_source") == "label"]
    if not labeled:
        print("No clips with real emotion labels; add a labeled source (e.g. CREMA-D) first.")
        return
    clf = model.emotion_clf.train()
    opt = torch.optim.AdamW(clf.parameters(), lr=3e-4)
    n = int(crop_secs * model.cfg.audio.sample_rate / model.cfg.audio.hop_length)
    for step in range(1, steps + 1):
        mels, ys = [], []
        for i in random.choices(labeled, k=batch):
            m = ds._mel(ds.rows[i]["wav_path"])
            s = random.randint(0, max(0, m.shape[0] - n))
            m = m[s: s + n]
            mels.append(F.pad(m.T, (0, n - m.shape[0]), value=SILENCE))
            ys.append(EMOTIONS.index(ds.rows[i]["emotion"]))
        logits = clf(torch.stack(mels).to(device))
        loss = F.cross_entropy(logits, torch.tensor(ys, device=device), label_smoothing=0.1)
        opt.zero_grad(); loss.backward(); opt.step()
        if step % 100 == 0 or step == 1:
            acc = (logits.argmax(-1).cpu() == torch.tensor(ys)).float().mean()
            print(json.dumps({"step": step, "loss": float(loss), "acc": float(acc)}))
    model.eval().save(ckpt, model.extras)


@torch.no_grad()
def pseudo_label_emotions(ckpt: str, manifest: str, out_manifest: str | None = None,
                          threshold: float = 0.7, device: str | None = None) -> str:
    """Label unlabeled clips with the emotion classifier, keeping only
    confident predictions. Writes <manifest>.pseudo.jsonl."""
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    model = VoxModel.load(ckpt, device)
    p = Path(manifest)
    out = Path(out_manifest or p.with_suffix(".pseudo.jsonl"))
    mel = MelSpectrogram(model.cfg.audio).to(device)
    n_new = 0
    with open(out, "w") as f:
        for line in p.read_text().splitlines():
            r = json.loads(line)
            if r.get("emotion_source") in (None, "none"):
                wav = torch.from_numpy(load_audio(p.parent / r["wav"], model.cfg.audio.sample_rate)).to(device)
                prob = torch.softmax(model.emotion_clf(mel(wav)), -1)[0]
                if float(prob.max()) >= threshold:
                    r["emotion"], r["emotion_source"] = EMOTIONS[int(prob.argmax())], "pseudo"
                    n_new += 1
            f.write(json.dumps(r) + "\n")
    print(f"pseudo-labeled {n_new} clips -> {out}")
    return str(out)


# ===================================================================== vocoder
def train_vocoder(ckpt: str, manifests, steps: int = 200_000, segment_secs: float = 1.0,
                  batch: int = 16, adv_start: int = 2000, device: str | None = None,
                  save_every: int = 5000, deadline: float | None = None) -> None:
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    model = VoxModel.load(ckpt, device)
    cfg = model.cfg
    rows = read_manifests(manifests)
    seg = int(segment_secs * cfg.audio.sample_rate)
    seg -= seg % cfg.audio.hop_length
    voc, disc, mel = model.vocoder.train(), Discriminators().to(device), model.mel
    opt_g = torch.optim.AdamW(voc.parameters(), lr=5e-4, betas=(0.8, 0.9))
    opt_d = torch.optim.AdamW(disc.parameters(), lr=2e-4, betas=(0.8, 0.9))
    cache: dict[str, np.ndarray] = {}

    def crop():
        r = random.choice(rows)
        w = cache.get(r["wav_path"])
        if w is None:
            w = load_audio(r["wav_path"], cfg.audio.sample_rate)
            if len(cache) < 2000:
                cache[r["wav_path"]] = w
        if len(w) < seg:
            w = np.pad(w, (0, seg - len(w)))
        s = random.randint(0, len(w) - seg)
        return torch.from_numpy(w[s: s + seg])

    for step in range(1, steps + 1):
        real = torch.stack([crop() for _ in range(batch)]).to(device)
        m_real = mel(real)
        fake = voc(m_real)[:, : real.shape[1]]
        mel_loss = F.l1_loss(mel(fake), m_real)
        if step >= adv_start:
            d_loss = disc_loss(disc(real), disc(fake.detach()))
            opt_d.zero_grad(); d_loss.backward(); opt_d.step()
            ro, fo = disc(real), disc(fake)
            g_loss = 45 * mel_loss + gen_adv_loss(fo) + 2 * feature_matching_loss(ro, fo)
        else:
            d_loss = torch.tensor(0.0); g_loss = 45 * mel_loss
        opt_g.zero_grad(); g_loss.backward()
        torch.nn.utils.clip_grad_norm_(voc.parameters(), 100.0)
        opt_g.step()
        if step % 100 == 0 or step == 1:
            print(json.dumps({"step": step, "mel_l1": float(mel_loss), "d": float(d_loss), "g": float(g_loss)}))
        late = deadline is not None and time.time() >= deadline
        if step % save_every == 0 or step == steps or late:
            model.vocoder_trained = True
            model.eval().save(ckpt, model.extras); voc.train()
        if late:
            break
