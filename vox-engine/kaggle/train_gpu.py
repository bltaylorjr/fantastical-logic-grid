"""One training session of Vox's own model on Kaggle's free GPU.

Picks up where the last session stopped (the vox-ckpt dataset), trains the
speech model and then the vocoder on the prepared data (the vox-data notebook's
output) until the session's time is nearly up, and leaves:

  /kaggle/working/vox.pt          everything, to resume from next time
  /kaggle/working/vox-serve.pt    the model alone (no optimizer), for the server
  /kaggle/working/progress.json   steps, hours, recent loss, sessions so far

kaggle/orchestrate.py (run by .github/workflows/vox-gpu-train.yml) pushes this
notebook, collects what it leaves, and starts the next session.

Settings (environment, all optional):
  VOX_HOURS      hours to train this session (default 8; Kaggle stops at 12)
  VOX_PRESET     model size when starting from scratch (default small, ~60M)
  VOX_VOCODER    share of the session for the vocoder (default 0.2)
"""
from __future__ import annotations

import glob
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

T0 = time.time()
HOURS = float(os.environ.get("VOX_HOURS", "8"))
PRESET = os.environ.get("VOX_PRESET", "small")
VOC_SHARE = float(os.environ.get("VOX_VOCODER", "0.2"))
WORK = Path(os.environ.get("VOX_WORK", "/kaggle/working"))
INPUT = Path(os.environ.get("VOX_INPUT", "/kaggle/input"))


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def find(pattern: str) -> list[str]:
    return sorted(glob.glob(str(INPUT / "**" / pattern), recursive=True))


def setup() -> None:
    """The engine's code (the vox-engine-code dataset) and the few packages
    Kaggle's image doesn't already have."""
    code = next((Path(p).parent for p in find("vox/__init__.py")), None)
    if code is None:
        sys.exit("The engine's code isn't attached (dataset vox-engine-code).")
    sys.path.insert(0, str(code.parent if code.name == "vox" else code))
    need = [m for m in ("cmudict", "soundfile", "yaml") if __import__("importlib").util.find_spec(m) is None]
    if need:
        subprocess.run([sys.executable, "-m", "pip", "install", "-q",
                        *(("pyyaml" if m == "yaml" else m) for m in need)], check=False)


def main() -> None:
    setup()
    import torch
    from vox.config import VoxConfig
    from vox.train import train, train_vocoder

    manifests = [p for p in find("*.jsonl") if Path(p).parent.name == "vox-data" or "/vox-data/" in p]
    if not manifests:
        sys.exit("No training data attached (the vox-data notebook's output).")
    log("Data:", ", ".join(Path(m).name for m in manifests))
    gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none"
    log("GPU:", gpu)

    prev = next(iter(find("vox-ckpt/**/vox.pt") or find("vox.pt")), None)
    progress = {"sessions": []}
    prev_progress = next(iter(find("vox-ckpt/**/progress.json") or find("progress.json")), None)
    if prev_progress:
        try:
            progress = json.loads(Path(prev_progress).read_text())
        except Exception:
            pass
    WORK.mkdir(parents=True, exist_ok=True)
    run = WORK / "run"
    run.mkdir(exist_ok=True)
    ckpt = run / "vox.pt"
    cfg = None
    if prev:
        shutil.copy2(prev, ckpt)
        log("Resuming from", prev)
    else:
        cfg = VoxConfig.preset(PRESET)
        log("Starting a new", PRESET, "model")
    if cfg is not None:
        cfg.train.batch_frames = 20000          # fits a 16 GB T4 or P100 at float16
        cfg.train.save_every = 2000
        cfg.train.num_workers = 4
    end = T0 + HOURS * 3600
    speech_end = end - VOC_SHARE * HOURS * 3600
    train([*manifests], run, cfg=cfg, resume=str(ckpt) if prev else None, deadline=speech_end)
    left = end - time.time()
    if left > 600:
        log(f"Training the vocoder for {left / 60:.0f} minutes")
        # half-second clips: the eight discriminators stay well inside 16 GB
        train_vocoder(str(ckpt), manifests, steps=10 ** 7, segment_secs=0.5, batch=16, save_every=2000, deadline=end - 300)

    # what's left behind: the full checkpoint, a slim copy for the server, progress
    state = torch.load(ckpt, map_location="cpu", weights_only=False)
    step = int((state.get("train_state") or {}).get("step", 0))   # VoxModel.save keeps extras at the top level
    shutil.copy2(ckpt, WORK / "vox.pt")
    slim = {k: v for k, v in state.items() if k != "train_state"}   # no optimizer: a third of the size
    slim["trained_on"] = "kaggle"
    slim["step"] = step
    torch.save(slim, WORK / "vox-serve.pt")
    losses = []
    try:
        for line in (run / "log.jsonl").read_text().splitlines()[-50:]:
            losses.append(json.loads(line)["loss"])
    except Exception:
        pass
    hours = round((time.time() - T0) / 3600, 2)
    progress["sessions"].append({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "hours": hours,
                                 "gpu": gpu, "step": step, "loss": round(sum(losses) / len(losses), 4) if losses else None})
    progress.update(step=step, gpu_hours=round(sum(s["hours"] for s in progress["sessions"]), 1), preset=PRESET)
    (WORK / "progress.json").write_text(json.dumps(progress, indent=1))
    shutil.rmtree(run, ignore_errors=True)            # keep only what's needed in the output
    log(f"Session done: step {step}, {hours} h, {progress['gpu_hours']} GPU hours in all")


if __name__ == "__main__":
    main()
