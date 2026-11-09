"""Keeps Vox's own model training on Kaggle's free GPU, one step per run.

Run by .github/workflows/vox-gpu-train.yml every few hours. Each run looks at
where things stand and does the next thing:

  1. The engine's code is a private Kaggle dataset (vox-engine-code), updated
     when the code changes.
  2. The training data is prepared once by a CPU notebook (vox-data, which
     runs kaggle/prepare_data.py; CPU time doesn't use the GPU quota).
  3. A GPU notebook (vox-train, kaggle/train_gpu.py) trains for a session.
     When one finishes, its checkpoint goes into a private dataset (vox-ckpt)
     for the next session to resume from, and the slim model is left in
     --outbox for the workflow to hand to the Oracle server, where Vox tries
     it and switches to it once it's clearer than the base voices.
  4. Then the next session starts, as long as this week's GPU hours stay under
     --budget (Kaggle gives about 30 a week; the default uses 24).

Needs KAGGLE_API_TOKEN and KAGGLE_USERNAME in the environment. Everything it
makes on Kaggle is private. It never deletes anything.

  python kaggle/orchestrate.py --repo-root . --outbox out [--budget 24] [--dry-run]
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import shlex
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

KAGGLE = shlex.split(os.environ.get("KAGGLE_CLI", "kaggle"))
HERE = Path(__file__).resolve().parent


class Kaggle:
    def __init__(self, user: str, work: Path, dry: bool = False, log=print):
        self.user, self.work, self.dry, self.log = user, Path(work), dry, log

    def run(self, *args, check: bool = True, write: bool = False) -> str:
        cmd = [*KAGGLE, *args]
        if write and self.dry:
            self.log("(dry run) would run: " + " ".join(cmd))
            return ""
        r = subprocess.run(cmd, capture_output=True, text=True)
        out = (r.stdout or "") + (r.stderr or "")
        if check and r.returncode != 0:
            raise RuntimeError(f"{' '.join(args[:2])} failed: {out.strip()[-500:]}")
        return out if r.returncode == 0 else f"__error__ {out}"

    def ref(self, slug: str) -> str:
        return f"{self.user}/{slug}"

    # ------------------------------------------------------------- notebooks
    def kernel_status(self, slug: str) -> str:
        """complete | running | queued | error | cancelled | missing"""
        out = self.run("kernels", "status", self.ref(slug), check=False).lower()
        if out.startswith("__error__"):
            return "missing" if ("404" in out or "not found" in out) else "unknown"
        for s in ("complete", "running", "queued", "error", "cancel"):
            if s in out:
                return "cancelled" if s == "cancel" else s
        return "unknown"

    def last_run(self, slug: str) -> datetime | None:
        out = self.run("kernels", "list", "--mine", "--csv", "--page-size", "100", check=False)
        if out.startswith("__error__"):
            return None
        for row in csv.DictReader(io.StringIO(out)):
            if row.get("ref", "").lower() == self.ref(slug).lower() and row.get("lastRunTime"):
                try:
                    return datetime.fromisoformat(row["lastRunTime"].replace("Z", "+00:00")).replace(tzinfo=timezone.utc)
                except ValueError:
                    return None
        return None

    def push_kernel(self, slug: str, code: Path, code_file: str, gpu: bool, datasets=(), kernels=()) -> None:
        d = self.work / f"push-{slug}"            # never inside the repo
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        shutil.copy2(code, d / code_file)
        meta = {"id": self.ref(slug), "title": slug, "code_file": code_file, "language": "python",
                "kernel_type": "script", "is_private": True, "enable_gpu": gpu, "enable_internet": True,
                "dataset_sources": [self.ref(x) for x in datasets], "kernel_sources": [self.ref(x) for x in kernels],
                "competition_sources": [], "model_sources": []}
        (d / "kernel-metadata.json").write_text(json.dumps(meta, indent=1))
        self.run("kernels", "push", "-p", str(d), write=True)

    def output(self, slug: str, dest: Path) -> Path:
        shutil.rmtree(dest, ignore_errors=True)
        dest.mkdir(parents=True)
        self.run("kernels", "output", self.ref(slug), "-p", str(dest), "-o")
        return dest

    # -------------------------------------------------------------- datasets
    def dataset_files(self, slug: str) -> list[str] | None:
        out = self.run("datasets", "files", self.ref(slug), "--csv", check=False)
        if out.startswith("__error__"):
            return None
        return [r.get("name", "") for r in csv.DictReader(io.StringIO(out))]

    def publish_dataset(self, slug: str, folder: Path, message: str, exists: bool) -> None:
        (folder / "dataset-metadata.json").write_text(json.dumps(
            {"title": slug, "id": self.ref(slug), "licenses": [{"name": "other"}]}, indent=1))
        if exists:
            self.run("datasets", "version", "-p", str(folder), "-m", message, "--dir-mode", "zip", write=True)
        else:
            self.run("datasets", "create", "-p", str(folder), "--dir-mode", "zip", write=True)

    def wait_dataset(self, slug: str, minutes: int = 15) -> bool:
        if self.dry:
            return True
        for _ in range(minutes * 4):
            if "ready" in self.run("datasets", "status", self.ref(slug), check=False).lower():
                return True
            time.sleep(15)
        return False


def code_hash(root: Path) -> str:
    h = hashlib.sha256()
    eng = root / "vox-engine"
    for p in sorted([*(eng / "vox").rglob("*.py"), *(eng / "kaggle").glob("*.py"), eng / "requirements.txt"]):
        if "__pycache__" in p.parts:
            continue
        h.update(str(p.relative_to(eng)).encode())
        h.update(p.read_bytes())
    return h.hexdigest()[:12]


def stage_code(root: Path, work: Path, digest: str) -> Path:
    d = work / "code"
    shutil.rmtree(d, ignore_errors=True)
    eng = d / "vox-engine"
    shutil.copytree(root / "vox-engine" / "vox", eng / "vox",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "static"))
    shutil.copytree(root / "vox-engine" / "kaggle", eng / "kaggle", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy2(root / "vox-engine" / "requirements.txt", eng / "requirements.txt")
    (d / f"code-{digest}.txt").write_text(digest)
    return d


def week_hours(progress: dict, now: datetime) -> float:
    since = now - timedelta(days=7)
    total = 0.0
    for s in progress.get("sessions", []):
        try:
            at = datetime.fromisoformat(s["at"].replace("Z", "+00:00"))
        except Exception:
            continue
        if at >= since:
            total += float(s.get("hours") or 0)
    return total


def step(args) -> dict:
    root, work, outbox = Path(args.repo_root).resolve(), Path(args.work).resolve(), Path(args.outbox).resolve()
    work.mkdir(parents=True, exist_ok=True)
    outbox.mkdir(parents=True, exist_ok=True)
    notes: list[str] = []
    say = lambda m: (notes.append(m), print(m))  # noqa: E731
    k = Kaggle(args.user, work, args.dry_run, say)
    report = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "notes": notes}

    # 0. Kaggle's command line works (a broken install would otherwise look like
    # "nothing exists yet" and try to create everything)
    probe = k.run("--version", check=False)
    if probe.startswith("__error__"):
        raise RuntimeError("Kaggle's command line doesn't run: " + probe[-400:])

    # 1. the code
    digest = code_hash(root)
    files = k.dataset_files("vox-engine-code")
    if files is None or f"code-{digest}.txt" not in files:
        say(f"Publishing the engine's code ({digest}).")
        k.publish_dataset("vox-engine-code", stage_code(root, work, digest), f"code {digest}", exists=files is not None)
        if not k.wait_dataset("vox-engine-code"):
            say("Kaggle is still processing the code; the next run carries on.")
            return {**report, "state": "code"}

    # 2. the data
    data = k.kernel_status("vox-data")
    report["data"] = data
    if data in ("missing", "error", "cancelled"):
        say("Preparing the training data on Kaggle (LJSpeech, VCTK, LibriTTS-R; a few hours on a CPU)." if data == "missing"
            else f"Preparing the training data again (the last try ended: {data}).")
        k.push_kernel("vox-data", HERE / "prepare_data.py", "prepare_data.py", gpu=False)
        return {**report, "state": "data"}
    if data != "complete":
        say(f"The training data is still being prepared ({data}).")
        return {**report, "state": "data"}

    # 3. the last training session
    train = k.kernel_status("vox-train")
    report["train"] = train
    ckpt_files = k.dataset_files("vox-ckpt")
    progress: dict = {"sessions": []}
    if train in ("running", "queued"):
        say(f"A training session is {train} on Kaggle's GPU.")
        return {**report, "state": "training"}
    if train == "complete":
        out = k.output("vox-train", work / "out")
        try:
            progress = json.loads((out / "progress.json").read_text())
        except Exception:
            progress = {"sessions": []}
        stepn = progress.get("step")
        marker = f"step-{stepn}.txt"
        if stepn is not None and (out / "vox.pt").exists() and (ckpt_files is None or marker not in ckpt_files):
            say(f"Session finished at step {stepn} ({progress.get('gpu_hours')} GPU hours in all). Saving it.")
            ck = work / "ckpt"
            shutil.rmtree(ck, ignore_errors=True)
            ck.mkdir()
            shutil.move(str(out / "vox.pt"), ck / "vox.pt")
            shutil.copy2(out / "progress.json", ck / "progress.json")
            (ck / marker).write_text(str(stepn))
            k.publish_dataset("vox-ckpt", ck, f"step {stepn}", exists=ckpt_files is not None)
            ckpt_files = (ckpt_files or []) + [marker]
            if (out / "vox-serve.pt").exists():
                shutil.copy2(out / "vox-serve.pt", outbox / f"vox-step{stepn}.pt")
                shutil.copy2(out / "progress.json", outbox / "progress.json")
                report["delivered"] = f"vox-step{stepn}.pt"
            if not k.wait_dataset("vox-ckpt"):
                say("Kaggle is still processing the checkpoint; the next session starts on the next run.")
                return {**report, "state": "saving", "progress": _brief(progress)}
        elif stepn is not None:
            say(f"The last session (step {stepn}) is already saved.")
    elif train in ("error", "cancelled"):
        last = k.last_run("vox-train")
        if last and datetime.now(timezone.utc) - last < timedelta(hours=6):
            say(f"The last session ended: {train}. Trying again later.")
            return {**report, "state": "waiting"}
        say(f"The last session ended: {train}. Starting again from the last saved checkpoint.")

    # 4. the next session, within this week's budget
    used = week_hours(progress, datetime.now(timezone.utc))
    report["week_hours"] = round(used, 1)
    hours = min(args.session_hours, args.budget - used)
    if hours < 1:
        say(f"This week's GPU budget is used ({used:.1f} of {args.budget} hours); the next session starts when it frees up.")
        return {**report, "state": "budget", "progress": _brief(progress)}
    datasets = ["vox-engine-code"] + (["vox-ckpt"] if ckpt_files is not None else [])
    src = (HERE / "train_gpu.py").read_text()
    staged = work / "train_gpu.py"
    staged.write_text(f"import os\nos.environ.setdefault('VOX_HOURS', '{hours:.2f}')\n" + src)
    say(f"Starting a {hours:.1f}-hour training session on Kaggle's GPU"
        + (f" (resuming from step {progress.get('step')})." if ckpt_files is not None else " (a new model)."))
    k.push_kernel("vox-train", staged, "train_gpu.py", gpu=True, datasets=datasets, kernels=["vox-data"])
    return {**report, "state": "started", "session_hours": round(hours, 2), "progress": _brief(progress)}


def _brief(p: dict) -> dict:
    return {k: p.get(k) for k in ("step", "gpu_hours", "preset")} | {"sessions": len(p.get("sessions", []))}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo-root", default=".")
    ap.add_argument("--work", default="kaggle-work")
    ap.add_argument("--outbox", default="kaggle-out")
    ap.add_argument("--user", default=os.environ.get("KAGGLE_USERNAME", ""))
    ap.add_argument("--budget", type=float, default=float(os.environ.get("VOX_GPU_BUDGET", "24")))
    ap.add_argument("--session-hours", type=float, default=8.0)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    if not a.user:
        print("Set KAGGLE_USERNAME (your Kaggle username).")
        return 2
    report = step(a)
    Path(a.outbox, "report.json").write_text(json.dumps(report, indent=1))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write("### Vox training on Kaggle\n\n" + "\n".join(f"- {n}" for n in report["notes"]) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
