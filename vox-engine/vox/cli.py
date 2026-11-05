"""Command line:  vox <command> --help  for details on each."""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path


def _engine(a):
    from .engine import VoxEngine
    return VoxEngine(a.ckpt, voices_dir=a.voices, cache_dir=a.cache, device=a.device)


def _read_script(path: str) -> list[dict]:
    """CSV (id,voice,text,emotion,intensity,style_prompt) or JSON list of the same."""
    p = Path(path)
    if p.suffix.lower() == ".json":
        return json.loads(p.read_text())
    with open(p, newline="", encoding="utf-8") as f:
        return [dict(r) for r in csv.DictReader(f)]


def main(argv=None):
    ap = argparse.ArgumentParser(prog="vox", description="Vox voice engine (free, open-source, local)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, ckpt=True):
        if ckpt:
            p.add_argument("--ckpt", required=True, help="model checkpoint (.pt)")
        p.add_argument("--voices", default="voices", help="voice library folder")
        p.add_argument("--cache", default="cache", help="audio cache folder")
        p.add_argument("--device", default=None, help="cpu or cuda (auto by default)")

    p = sub.add_parser("init", help="create an untrained model to try the tools")
    p.add_argument("--preset", default="tiny", choices=["tiny", "small", "base"])
    p.add_argument("--out", default="vox_untrained.pt")

    p = sub.add_parser("prepare-data", help="run the data pipeline on a sources YAML")
    p.add_argument("--sources", required=True); p.add_argument("--out", default="data")
    p.add_argument("--whisper", default="small", help="Whisper size for transcription (if installed)")

    p = sub.add_parser("coverage", help="find script words the model has never heard")
    p.add_argument("--vocab", required=True); p.add_argument("--script", required=True)

    p = sub.add_parser("train", help="train the speech generator")
    p.add_argument("--data", nargs="+", required=True, help="one or more manifest.jsonl files")
    p.add_argument("--out", default="runs/v1"); p.add_argument("--preset", default="small",
                                                                choices=["tiny", "small", "base"])
    p.add_argument("--resume"); p.add_argument("--steps", type=int)
    p.add_argument("--batch-frames", type=int); p.add_argument("--device")

    p = sub.add_parser("train-emotion", help="train the emotion classifier on labeled clips")
    p.add_argument("--ckpt", required=True); p.add_argument("--data", nargs="+", required=True)
    p.add_argument("--steps", type=int, default=3000)

    p = sub.add_parser("pseudo-label", help="label unlabeled clips' emotions")
    p.add_argument("--ckpt", required=True); p.add_argument("--data", required=True)
    p.add_argument("--threshold", type=float, default=0.7)

    p = sub.add_parser("train-vocoder", help="train the mel-to-audio vocoder")
    p.add_argument("--ckpt", required=True); p.add_argument("--data", nargs="+", required=True)
    p.add_argument("--steps", type=int, default=200000); p.add_argument("--batch", type=int, default=16)

    p = sub.add_parser("augment", help="add filtered synthetic clips for rare emotions")
    common(p); p.add_argument("--data", required=True); p.add_argument("--out", default="data_synth")
    p.add_argument("--use-voices", nargs="+", required=True)

    p = sub.add_parser("speak", help="say a line and save a WAV")
    common(p); p.add_argument("text"); p.add_argument("--voice", default="narrator")
    p.add_argument("--emotion"); p.add_argument("--intensity", type=float, default=1.0)
    p.add_argument("--rate", type=float, default=0.0); p.add_argument("--pitch", type=float, default=0.0)
    p.add_argument("--style", help='plain-words style, e.g. "hushed, slightly fearful"')
    p.add_argument("--seed", type=int); p.add_argument("--out", default="out.wav")
    p.add_argument("--autotune", help="auto-tune preset: subtle, natural, pop, hard, robot, bard, giant, pixie")

    p = sub.add_parser("design-voice", help="invent a new voice from a description")
    common(p); p.add_argument("description"); p.add_argument("--name"); p.add_argument("--seed", type=int)
    p.add_argument("--count", type=int, default=1, help="make several candidates to audition")

    p = sub.add_parser("clone-voice", help="clone a voice from a 3-15 s sample (consent required)")
    common(p); p.add_argument("--name", required=True); p.add_argument("--audio", required=True)
    p.add_argument("--transcript", required=True); p.add_argument("--speaker-name", required=True)
    p.add_argument("--granted-by", required=True); p.add_argument("--consent", required=True,
                                                                  help="what the speaker agreed to")

    p = sub.add_parser("bake", help="pre-generate every line of a dialogue script to WAV files")
    common(p); p.add_argument("--script", required=True); p.add_argument("--out", default="baked")

    p = sub.add_parser("serve", help="run the local game server (with continuous learning)")
    common(p); p.add_argument("--host", default="127.0.0.1"); p.add_argument("--port", type=int, default=5150)
    p.add_argument("--learning-dir", default="learning", help="where takes, feedback and model versions live")
    p.add_argument("--no-learning", action="store_true", help="turn continuous learning off")
    p.add_argument("--public", action="store_true", help="reachable from the internet: safer settings")
    p.add_argument("--allow-origin", action="append", help="website allowed to use it (repeat); default thelogicgrid.com + the admin app")
    p.add_argument("--tunnel", action="store_true", help="go online now with a free Cloudflare quick tunnel")
    p.add_argument("--tunnel-name", help="go online with your own named Cloudflare tunnel (fixed address)")
    p.add_argument("--translation", default="m2m100", choices=["m2m100", "madlad"], help="translation model")
    p.add_argument("--rate", type=int, default=30, help="online: requests a minute per visitor")

    p = sub.add_parser("autotune", help="auto-tune any recording (no model needed)")
    p.add_argument("input"); p.add_argument("output")
    p.add_argument("--preset", default="pop"); p.add_argument("--key"); p.add_argument("--scale")
    p.add_argument("--retune-ms", type=float); p.add_argument("--amount", type=float)
    p.add_argument("--transpose", type=float); p.add_argument("--mix", type=float)

    p = sub.add_parser("dictionary", help="install or look up the American English dictionary")
    p.add_argument("action", choices=["install", "look", "train-guesser"])
    p.add_argument("word", nargs="?")
    p.add_argument("--minutes", type=float, default=40, help="train-guesser: how long to train")

    p = sub.add_parser("translate", help="translate a line (keeps script markup)")
    p.add_argument("text"); p.add_argument("--to", required=True); p.add_argument("--from", dest="src", default="en")
    p.add_argument("--model", default="m2m100", choices=["m2m100", "madlad"])

    p = sub.add_parser("sample-voice", help="make a new voice blended from 3+ speakers found by keywords")
    common(p); p.add_argument("--name", required=True); p.add_argument("--keywords", nargs="+", default=[])
    p.add_argument("--file", action="append", default=[], help="your own recordings to include")
    p.add_argument("--license", default="", help="license of --file recordings (e.g. cc0, own-recording)")
    p.add_argument("--speakers", type=int, default=5)

    p = sub.add_parser("refine", help="run one learning round now and report the result")
    common(p); p.add_argument("--learning-dir", default="learning")

    a = ap.parse_args(argv)

    if a.cmd == "init":
        from .config import VoxConfig
        from .model import VoxModel
        m = VoxModel(VoxConfig.preset(a.preset)); m.save(a.out)
        print(f"wrote {a.out}  ({sum(m.param_count().values()):.1f}M params, untrained)")
    elif a.cmd == "prepare-data":
        from .data.process import build_dataset
        build_dataset(a.sources, a.out, whisper_size=a.whisper)
    elif a.cmd == "coverage":
        from .data.process import coverage_report
        lines = [r["text"] for r in _read_script(a.script)]
        print(json.dumps(coverage_report(a.vocab, lines), indent=2))
    elif a.cmd == "train":
        from .config import VoxConfig
        from .train import train
        cfg = VoxConfig.preset(a.preset)
        if a.batch_frames:
            cfg.train.batch_frames = a.batch_frames
        train(a.data, a.out, cfg, resume=a.resume, max_steps=a.steps, device=a.device)
    elif a.cmd == "train-emotion":
        from .train import train_emotion_classifier
        train_emotion_classifier(a.ckpt, a.data, a.steps)
    elif a.cmd == "pseudo-label":
        from .train import pseudo_label_emotions
        pseudo_label_emotions(a.ckpt, a.data, threshold=a.threshold)
    elif a.cmd == "train-vocoder":
        from .train import train_vocoder
        train_vocoder(a.ckpt, a.data, a.steps, batch=a.batch)
    elif a.cmd == "augment":
        from .data.augment import synthesize_augmentation
        n = synthesize_augmentation(_engine(a), a.data, a.out, a.use_voices)
        print(f"added {n} synthetic clips -> {a.out}/manifest.jsonl")
    elif a.cmd == "speak":
        r = _engine(a).speak(a.text, voice=a.voice, emotion=a.emotion, intensity=a.intensity,
                             rate=a.rate, pitch=a.pitch, style_prompt=a.style, seed=a.seed,
                             autotune=a.autotune)
        r.save(a.out); print(f"{a.out}  {r.duration:.2f}s  seed={r.seed}")
    elif a.cmd == "design-voice":
        eng = _engine(a)
        for i in range(a.count):
            name = a.name if a.count == 1 else (f"{a.name}-{i + 1}" if a.name else None)
            v = eng.design_voice(a.description, seed=None if a.seed is None else a.seed + i, name=name)
            eng.speak("Hello there. This is how I sound when I talk for a while.", voice=v.name,
                      seed=1).save(f"audition_{v.name}.wav")
            print(f"voice '{v.name}' (seed {v.seed}) -> audition_{v.name}.wav")
    elif a.cmd == "clone-voice":
        from .voices import ConsentRecord
        v = _engine(a).clone_voice(a.name, a.audio, a.transcript,
                                   ConsentRecord(a.speaker_name, a.granted_by, a.consent))
        print(f"cloned voice '{v.name}' (consent recorded in {a.voices}/{v.name}/voice.json)")
    elif a.cmd == "bake":
        from fastapi.testclient import TestClient
        from .server import create_app
        rows = _read_script(a.script)
        lines = []
        for r in rows:
            d = {k: v for k, v in r.items() if v not in (None, "")}
            if "intensity" in d:
                d["intensity"] = float(d["intensity"])
            lines.append(d)
        res = TestClient(create_app(_engine(a))).post("/v1/bake", json={"lines": lines, "out_dir": a.out})
        if res.status_code != 200:
            sys.exit(res.text)
        print(f"baked {len(res.json()['lines'])} lines -> {a.out}/ (index: {a.out}/lines.json)")
    elif a.cmd == "serve":
        from .server import serve
        serve(a.ckpt, a.host, a.port, a.voices, a.cache, a.device,
              None if a.no_learning else a.learning_dir, a.public, a.allow_origin, a.tunnel, a.tunnel_name,
              a.translation, a.rate)
    elif a.cmd == "autotune":
        from .audio import load_audio, save_audio
        from .autotune import autotune
        opts = {"preset": a.preset, "key": a.key, "scale": a.scale, "retune_ms": a.retune_ms,
                "amount": a.amount, "transpose": a.transpose, "mix": a.mix}
        wav = load_audio(a.input, 24000)
        save_audio(a.output, autotune(wav, 24000, {k: v for k, v in opts.items() if v is not None}), 24000)
        print(f"wrote {a.output}")
    elif a.cmd == "dictionary":
        from .lexicon.dictionary import Dictionary
        from .lexicon.g2p import G2P, train_g2p
        d = Dictionary()
        if a.action == "install":
            print(json.dumps(d.install(progress=lambda p, m: print(f"  {p:4.0%}  {m}")), indent=2))
        elif a.action == "train-guesser":
            train_g2p(minutes=a.minutes)
        else:
            if not a.word:
                sys.exit("Give a word: vox dictionary look enunciation")
            print(json.dumps(d.lookup(a.word, G2P.load()), indent=2, ensure_ascii=False))
    elif a.cmd == "translate":
        from .translate import Translator
        print(Translator(a.model, Path("cache") / "translations.db").translate(a.text, a.to, a.src))
    elif a.cmd == "sample-voice":
        from .sampling import create_voice_from_samples
        files = [{"path": f, "license": a.license, "attribution": Path(f).name} for f in a.file]
        v, rep = create_voice_from_samples(_engine(a), a.name, a.keywords, None, files, a.speakers,
                                           progress=lambda m, p=None: print(" ", m))
        print(f"voice '{v.name}': blend of {rep.used} speakers, closest match to any one of them {rep.max_similarity}")
    elif a.cmd == "refine":
        from .learning import LearningSystem
        L = LearningSystem(_engine(a), a.learning_dir)
        L.refine(reason="manual", wait=True)
        print(L.status()["rounds"][0]["message"])


if __name__ == "__main__":
    main()
