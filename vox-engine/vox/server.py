"""Local game server. Any game engine that can make an HTTP request can use it.

    vox serve --ckpt runs/v1/vox.pt            # http://127.0.0.1:5150

It listens on your own machine only (127.0.0.1) unless you pass --host 0.0.0.0.

Public endpoints (games and the Voice Studio)
  GET    /                          Voice Studio: audition and edit lines in a browser
  GET    /v1/health                 status, device, model size
  GET    /v1/voices                 voice list
  GET    /v1/emotions               emotion names
  GET    /v1/autotune/presets       auto-tune presets, keys and scales
  POST   /v1/speak                  JSON -> WAV (headers carry timing for lip-sync)
  WS     /v1/stream                 JSON in -> PCM16 chunks out, lowest latency
  POST   /v1/edit                   edit a previous take (replace words, restyle, undo...)
  POST   /v1/voices/design          invent a new voice from a description
  POST   /v1/autotune               auto-tune any uploaded recording
  POST   /v1/bake                   pre-generate many lines to files (ship them with the game)

Admin endpoints (need the header X-Vox-Admin-Token; the token is printed when
the server starts and kept in learning/admin_token.txt)
  GET    /v1/admin/check
  GET    /v1/admin/learning                    learning status, quality trend, rounds
  PUT    /v1/admin/learning/settings
  POST   /v1/admin/learning/refine             start a refinement round now
  GET    /v1/admin/takes                       recent takes with scores
  GET    /v1/admin/takes/{id}/audio
  POST   /v1/admin/takes/{id}/feedback         {"rating": 1 | -1 | 0, "note": ""}
  POST   /v1/admin/ab                          make two takes of a line to compare
  POST   /v1/admin/compare                     {"winner": id, "loser": id}
  GET    /v1/admin/models                      model versions
  POST   /v1/admin/models/{version}/promote    switch to a version (roll forward/back)
  POST   /v1/admin/models/rollback
  GET    /v1/admin/lexicon   PUT /v1/admin/lexicon   DELETE /v1/admin/lexicon/{word}
  PATCH  /v1/admin/voices/{name}               auto-tune default, description, reset tuning
  POST   /v1/admin/voices/{name}/optimize      auto-optimize generation settings
  POST   /v1/admin/voices/{name}/undo-refine   put back the voice before the last refinement
  DELETE /v1/admin/voices/{name}
  POST   /v1/voices/clone                      clone a voice (multipart; consent required)
  POST   /v1/admin/voices/from-samples         a new voice blended from 3+ speakers (keywords, links, files)
  GET    /v1/admin/dictionary   POST /v1/admin/dictionary/install
  GET    /v1/admin/jobs/{id}                   progress of a background job

Online (vox serve --public / --tunnel): only allowed websites may call it,
heavy requests are limited per visitor, and design, bake and auto-tune
uploads need the admin token too.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import threading
import time
import uuid
from collections import OrderedDict
from pathlib import Path

import numpy as np
from fastapi import (Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile, WebSocket,
                     WebSocketDisconnect)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from .audio import load_audio, to_wav_bytes
from .autotune import NOTE_NAMES, SCALES, autotune, describe_presets, settings_from
from .config import EMOTIONS
from .engine import SpeechResult, VoxEngine
from .voices import ConsentRecord


class SpeakRequest(BaseModel):
    text: str = Field(..., max_length=5000)
    voice: str = "narrator"
    emotion: str | dict[str, float] | None = None
    intensity: float = 1.0
    rate: float = 0.0
    pitch: float = 0.0
    pitch_range: float = 0.0
    energy: float = 0.0
    style_prompt: str | None = None
    seed: int | None = None
    auto_expressions: bool = True
    autotune: str | dict | None = None
    translate_to: str | None = None   # e.g. "es": translate, then speak
    language: str | None = None       # language the text is already in (default English)
    enunciate: float = 0.0            # 0..1 clearer, more deliberate speech
    age: float | None = Field(None, ge=1, le=90)     # 1 = first words .. 90
    sex: str | None = None
    dialect: str | None = None        # see GET /v1/voices/options
    accent: float | None = Field(None, ge=0, le=1)
    speaking_style: str | None = None  # conversational, storytelling, formal, playful, ...
    fluency: float | None = Field(None, ge=0, le=1)
    simplify: bool | None = None      # say it the way a child of that age would
    processes: dict[str, float] | None = None
    delivery: str | None = None       # whisper .. scream, laughing, crying, singing, ...
    sing: dict | None = None          # {"notes": "C4 D4 E4"} or {"key": "G", "scale": "major"}
    format: str = "wav"            # "wav" or "pcm16"



class DiscoverStart(BaseModel):
    voices: int = Field(20, ge=1, le=10000)
    words_per_voice: int = Field(3, ge=1, le=8)
    speakers: int = Field(5, ge=3, le=12)
    items_per_word: int = Field(3, ge=1, le=8)


class CharacterRequest(BaseModel):
    group: str
    name: str | None = None
    age: float | None = Field(None, ge=1, le=90)
    dialect: str | None = None
    accent: float | None = Field(None, ge=0, le=1)
    speaking_style: str | None = None
    fluency: float | None = Field(None, ge=0, le=1)
    simplify: bool | None = None
    processes: dict[str, float] | None = None
    delivery: str | None = None
    seed: int | None = None


class StartersRequest(BaseModel):
    dialect: str | None = None
    accent: float | None = Field(None, ge=0, le=1)


class DialectRequest(BaseModel):
    label: str = Field(..., max_length=80)
    region: str = Field("", max_length=120)
    rules: list[str] = []
    prosody: dict[str, float] = {}


class DesignRequest(BaseModel):
    description: str = ""
    name: str | None = None
    seed: int | None = None
    attributes: dict[str, float] | None = None
    diversity: float = 1.0


class EditOp(BaseModel):
    op: str                         # replace | restyle | regenerate | insert_pause | insert_breath | speed | undo | redo
    old: str | None = None
    new: str | None = None
    phrase: str | None = None
    start: float | None = None
    end: float | None = None
    ms: int = 300
    factor: float = 1.0
    style: dict = {}


class EditRequest(BaseModel):
    take: str
    ops: list[EditOp]


class BakeLine(SpeakRequest):
    id: str


class BakeRequest(BaseModel):
    lines: list[BakeLine]
    out_dir: str | None = None


class FeedbackRequest(BaseModel):
    rating: int
    note: str = ""


class CompareRequest(BaseModel):
    winner: str
    loser: str


class ABRequest(BaseModel):
    text: str = Field(..., max_length=1000)
    voice: str = "narrator"
    emotion: str | None = None
    autotune: str | dict | None = None


class TranslateRequest(BaseModel):
    text: str = Field(..., max_length=5000)
    to: str
    source: str = Field("en", alias="from")


class WordRequest(BaseModel):
    word: str
    say_as: str


class VoicePatch(BaseModel):
    description: str | None = None
    autotune: dict | str | None = None
    clear_autotune: bool = False
    reset_tuning: bool = False


DEFAULT_ONLINE_ORIGINS = ["https://thelogicgrid.com", "https://www.thelogicgrid.com",
                          "https://flg-api.btay74.workers.dev"]
RATE_LIMITED = ("/v1/speak", "/v1/stream", "/v1/edit", "/v1/translate", "/v1/autotune", "/v1/dictionary")


def create_app(engine: VoxEngine, learning=None, admin_token: str | None = None,
               bake_dir: str | Path = "baked", max_takes: int = 64, public: bool = False,
               allowed_origins: list[str] | None = None, rate_per_minute: int = 30,
               dictionary=None) -> FastAPI:
    """public=True when reachable from the internet: only allowed_origins may
    call it from a browser, heavy requests are rate-limited per visitor, and
    designing voices, baking files and auto-tuning uploads need the admin token."""
    app = FastAPI(title="Vox Voice Engine", version="1.2")
    origins = allowed_origins or (DEFAULT_ONLINE_ORIGINS if public else ["*"])
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"],
                       expose_headers=["X-Vox-Take", "X-Vox-Take-Id", "X-Vox-Seed", "X-Vox-Duration",
                                       "X-Vox-Segments", "X-Vox-Sample-Rate", "X-Vox-Quality"])

    @app.middleware("http")
    async def private_network(request: Request, call_next):
        # Chrome asks before a public website (like the admin dashboard) may
        # call a server on this computer; this header says yes.
        resp = await call_next(request)
        if request.headers.get("access-control-request-private-network"):
            resp.headers["Access-Control-Allow-Private-Network"] = "true"
        return resp

    buckets: dict[str, list[float]] = {}

    @app.middleware("http")
    async def rate_limit(request: Request, call_next):
        if public and request.url.path.startswith(RATE_LIMITED) and request.method != "OPTIONS":
            tok = request.headers.get("x-vox-admin-token")
            if not (admin_token and tok and secrets.compare_digest(tok, admin_token)):
                who = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")
                now = time.time()
                b = buckets.setdefault(who, [float(rate_per_minute), now])
                b[0] = min(float(rate_per_minute), b[0] + (now - b[1]) * rate_per_minute / 60.0)
                b[1] = now
                if b[0] < 1:
                    return JSONResponse({"detail": "Too many requests. Please wait a moment."}, status_code=429,
                                        headers={"Retry-After": "10"})
                b[0] -= 1
                if len(buckets) > 10000:
                    buckets.clear()
        return await call_next(request)

    lock = learning.lock if learning is not None else threading.Lock()
    jobs: dict[str, dict] = {}

    def run_job(kind: str, fn) -> str:
        jid = uuid.uuid4().hex[:10]
        jobs[jid] = {"id": jid, "kind": kind, "progress": 0.0, "message": "Starting…", "done": False}

        def progress(msg, p=None):
            jobs[jid].update(message=msg, **({"progress": round(float(p), 3)} if p is not None else {}))

        def work():
            try:
                jobs[jid]["result"] = fn(progress)
                jobs[jid].update(done=True, progress=1.0)
            except Exception as e:   # shown to the admin, never crashes the server
                jobs[jid].update(done=True, failed=True, message=str(e)[:500])
        threading.Thread(target=work, daemon=True).start()
        return jid
    sessions: OrderedDict[str, object] = OrderedDict()   # take -> edit session
    latest: dict[str, str] = {}                           # take -> newest logged take id

    def require_admin(x_vox_admin_token: str | None = Header(default=None)):
        if not admin_token:
            raise HTTPException(403, "Admin features are off: start the server with an admin token.")
        if not x_vox_admin_token or not secrets.compare_digest(x_vox_admin_token, admin_token):
            raise HTTPException(401, "Wrong or missing admin token.")

    def admin_if_public(x_vox_admin_token: str | None = Header(default=None)):
        if public:
            require_admin(x_vox_admin_token)

    from .lexicon.dictionary import Dictionary
    dic = dictionary or (engine.pronouncer.dictionary if engine._pronouncer is not None and
                         engine._pronouncer.dictionary is not None else Dictionary())

    def need_learning():
        if learning is None:
            raise HTTPException(404, "Learning is off for this server.")
        return learning

    def remember(result: SpeechResult, source: str, session_id: str | None = None) -> tuple[str, str, float | None]:
        parent = latest.get(session_id) if session_id else None
        if learning is not None:
            log_id = learning.log_take(result, source=source, parent=parent)
            quality = learning.take(log_id)["quality"]
        else:
            log_id, quality = uuid.uuid4().hex[:12], None
        sid = session_id or log_id
        if session_id is None:
            sessions[sid] = engine.edit(result)
            while len(sessions) > max_takes:
                old, _ = sessions.popitem(last=False)
                latest.pop(old, None)
        latest[sid] = log_id
        return sid, log_id, quality

    def audio_response(res: SpeechResult, take: str, log_id: str, quality, fmt: str) -> Response:
        if fmt == "pcm16":
            body, mt = (np.clip(res.wav, -1, 1) * 32767).astype("<i2").tobytes(), "application/octet-stream"
        else:
            body, mt = res.wav_bytes(), "audio/wav"
        h = {"X-Vox-Take": take, "X-Vox-Take-Id": log_id, "X-Vox-Seed": str(res.seed),
             "X-Vox-Duration": f"{res.duration:.3f}", "X-Vox-Sample-Rate": str(res.sample_rate),
             "X-Vox-Segments": json.dumps(res.segments)}
        if quality is not None:
            h["X-Vox-Quality"] = f"{quality:.1f}"
        return Response(body, media_type=mt, headers=h)

    def speak_kwargs(req: SpeakRequest) -> dict:
        d = req.model_dump(exclude={"format", "id"})
        d["register"] = d.pop("speaking_style", None)
        return d

    static = Path(__file__).parent / "static"

    # ================================================================ public
    @app.get("/", include_in_schema=False)
    def studio():
        return FileResponse(static / "studio.html")

    @app.get("/static/{name}", include_in_schema=False)
    def static_file(name: str):
        f = static / name
        if not f.is_file() or f.parent != static:
            raise HTTPException(404)
        return FileResponse(f, media_type="text/javascript" if name.endswith(".js") else None)

    # Pairing: the admin app's Voice engine page, open in a browser on this same
    # computer, gets the admin token without anyone copying it. Only for a
    # request made on this computer (to 127.0.0.1 or localhost, not through the
    # Cloudflare tunnel) from the admin app's own address. Browsers set Origin
    # themselves, so another website can't ask for it.
    PAIR_ORIGINS = {"https://flg-api.btay74.workers.dev"}

    @app.get("/v1/pair")
    def pair(request: Request):
        host = (request.headers.get("host") or "").split(":")[0]
        client = request.client.host if request.client else ""
        tunneled = any(h in request.headers for h in ("cf-connecting-ip", "cf-ray", "x-forwarded-for"))
        if (not admin_token or request.headers.get("origin") not in PAIR_ORIGINS or tunneled
                or host not in ("127.0.0.1", "localhost") or client not in ("127.0.0.1", "::1")):
            raise HTTPException(403, "Pairing works only from the admin app on this computer.")
        return {"token": admin_token}

    @app.get("/v1/health")
    def health():
        return {"status": "ok", "release": os.environ.get("VOX_RELEASE"), "device": engine.device, "vocoder_trained": engine.model.vocoder_trained,
                "params_millions": {k: round(v, 1) for k, v in engine.model.param_count().items()},
                "sample_rate": engine.sr, "learning": learning is not None, "public": public,
                "dictionary": dic.installed, "text_mode": getattr(engine.cfg.model, "text_mode", "bytes"),
                "translation": engine.translator.backend if engine.translator else "m2m100 (loads on first use)",
                "version": learning.store.get("current") if learning is not None else None}

    # ---------------------------------------------------------- languages
    @app.get("/v1/languages")
    def languages():
        from .translate import BACKENDS, Translator
        t = engine.translator or Translator("m2m100")
        return {"backend": t.backend, "license": BACKENDS[t.backend]["license"], "languages": t.languages()}

    @app.post("/v1/translate")
    def translate(req: TranslateRequest):
        try:
            if engine.translator is None:
                engine.use_translator()
            return {"text": engine.translator.translate(req.text, req.to, req.source), "to": req.to}
        except ValueError as e:
            raise HTTPException(400, str(e))
        except RuntimeError as e:
            raise HTTPException(503, str(e))

    # --------------------------------------------------------- dictionary
    @app.get("/v1/dictionary")
    def dictionary_search(prefix: str = ""):
        return {"installed": dic.installed, "words": dic.search(prefix[:40]) if prefix else []}

    @app.get("/v1/dictionary/{word}")
    def dictionary_word(word: str):
        if len(word) > 60:
            raise HTTPException(400, "That's too long for one word.")
        fixes = learning.lexicon() if learning is not None else {}
        info = dic.lookup(word, engine.pronouncer.g2p, {k.lower(): v for k, v in fixes.items()})
        info["installed"] = dic.installed
        say = fixes.get(word) or fixes.get(word.lower())
        if say:
            info["your_fix"] = say
        return info

    @app.get("/v1/emotions")
    def emotions():
        return EMOTIONS

    @app.get("/v1/autotune/presets")
    def autotune_presets():
        return {"presets": describe_presets(), "keys": NOTE_NAMES, "scales": list(SCALES)}

    @app.get("/v1/voices/options")
    def voice_options():
        """Ages, child sound patterns, speaking styles, dialects and deliveries."""
        from . import delivery as dl, development as dev
        from .dialects import describe as dialects
        return {**dev.describe(), "dialects": dialects(engine.voices.root), **dl.describe()}

    @app.get("/v1/voices")
    def voices():
        out = []
        for n in engine.voices.names():
            v = engine.voices.load(n)
            out.append({"name": v.name, "origin": v.origin, "description": v.description,
                        "default_emotion": v.default_emotion, "autotune": v.autotune,
                        "tuned": bool(v.infer), "refined": len(v.history), "sources": v.sources,
                        "profile": v.profile})
        return out

    @app.post("/v1/speak")
    def speak(req: SpeakRequest):
        try:
            with lock:
                res = engine.speak(**speak_kwargs(req))
        except KeyError as e:
            raise HTTPException(404, str(e))
        except ValueError as e:
            raise HTTPException(400, str(e))
        sid, log_id, q = remember(res, "speak")
        return audio_response(res, sid, log_id, q, req.format)

    @app.websocket("/v1/stream")
    async def stream(ws: WebSocket):
        await ws.accept()
        try:
            while True:
                req = SpeakRequest(**(await ws.receive_json()))
                kw = speak_kwargs(req)
                text, voice, seed = kw.pop("text"), kw.pop("voice"), kw.pop("seed")
                await ws.send_json({"event": "start", "sample_rate": engine.sr, "format": "pcm16"})
                for chunk in engine.speak_stream(text, voice=voice, seed=seed, **kw):
                    await ws.send_bytes((chunk * 32767).astype("<i2").tobytes())
                await ws.send_json({"event": "end"})
        except WebSocketDisconnect:
            return
        except (KeyError, ValueError) as e:
            await ws.send_json({"event": "error", "message": str(e)})
            await ws.close()

    @app.post("/v1/edit")
    def edit(req: EditRequest):
        sess = sessions.get(req.take)
        if sess is None:
            raise HTTPException(404, "Unknown or expired take id. Call /v1/speak again.")
        try:
            with lock:
                for o in req.ops:
                    if o.op == "replace":
                        sess.replace(o.old, o.new, **o.style)
                    elif o.op == "restyle":
                        sess.restyle(o.phrase, **o.style)
                    elif o.op == "regenerate":
                        sess.regenerate(o.start, o.end, **o.style)
                    elif o.op == "insert_pause":
                        sess.insert_pause(o.phrase, o.ms)
                    elif o.op == "insert_breath":
                        sess.insert_breath(o.phrase)
                    elif o.op == "speed":
                        sess.change_speed(o.factor)
                    elif o.op == "undo":
                        sess.undo()
                    elif o.op == "redo":
                        sess.redo()
                    else:
                        raise ValueError(f"Unknown edit op '{o.op}'")
                res = sess.render()
        except ValueError as e:
            raise HTTPException(400, str(e))
        _, log_id, q = remember(res, "edit", req.take)
        return audio_response(res, req.take, log_id, q, "wav")

    @app.post("/v1/voices/design", dependencies=[Depends(admin_if_public)])
    def design(req: DesignRequest):
        v = engine.design_voice(req.description, seed=req.seed, name=req.name,
                                attributes=req.attributes, diversity=req.diversity)
        return {"name": v.name, "seed": v.seed, "default_emotion": v.default_emotion,
                "default_prosody": v.default_prosody}

    @app.post("/v1/autotune", dependencies=[Depends(admin_if_public)])
    async def autotune_upload(audio: UploadFile = File(...), settings: str = Form("pop")):
        """Auto-tune any recording. settings: a preset name or JSON options."""
        try:
            spec = json.loads(settings) if settings.strip().startswith("{") else settings
            settings_from(spec)
            wav = load_audio(await audio.read(), engine.sr)
        except ValueError as e:
            raise HTTPException(400, str(e))
        except Exception:
            raise HTTPException(400, "Could not read that audio file (use WAV, FLAC or OGG).")
        if len(wav) > engine.sr * 600:
            raise HTTPException(400, "Recordings up to 10 minutes, please.")
        return Response(to_wav_bytes(autotune(wav, engine.sr, spec), engine.sr), media_type="audio/wav")

    @app.post("/v1/bake", dependencies=[Depends(admin_if_public)])
    def bake(req: BakeRequest):
        out = Path(req.out_dir or bake_dir)
        out.mkdir(parents=True, exist_ok=True)
        manifest = []
        for line in req.lines:
            kw = speak_kwargs(line)
            if kw["seed"] is None:   # stable seed per line id: re-baking gives identical audio
                kw["seed"] = int(hashlib.sha1(line.id.encode()).hexdigest()[:8], 16) % (2 ** 31)
            with lock:
                res = engine.speak(**kw)
            safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in line.id)
            res.save(out / f"{safe}.wav")
            manifest.append({"id": line.id, "file": f"{safe}.wav", "duration": round(res.duration, 3),
                             "text": line.text, "voice": line.voice, "seed": res.seed,
                             "segments": res.segments})
        (out / "lines.json").write_text(json.dumps(manifest, indent=2))
        return {"out_dir": str(out.resolve()), "lines": manifest}

    # ================================================================= admin
    admin = [Depends(require_admin)]

    @app.post("/v1/voices/clone", dependencies=admin)
    async def clone(audio: UploadFile = File(...), name: str = Form(...), transcript: str = Form(...),
                    speaker_name: str = Form(...), granted_by: str = Form(...),
                    consent_statement: str = Form(...), description: str = Form("")):
        data = await audio.read()
        consent = ConsentRecord(speaker_name, granted_by, consent_statement)
        try:
            with lock:
                v = engine.clone_voice(name, data, transcript, consent, description)
        except PermissionError as e:
            raise HTTPException(403, str(e))
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"name": v.name, "origin": v.origin}

    @app.get("/v1/admin/jobs/{jid}", dependencies=admin)
    def admin_job(jid: str):
        if jid not in jobs:
            raise HTTPException(404, "Unknown job.")
        return jobs[jid]

    @app.get("/v1/admin/dictionary", dependencies=admin)
    def admin_dictionary():
        from .lexicon.g2p import DEFAULT_PATH
        import torch as _t
        g2p_info = None
        if DEFAULT_PATH.exists():
            g2p_info = _t.load(str(DEFAULT_PATH), map_location="cpu", weights_only=False).get("accuracy")
        return {**dic.stats(), "path": str(dic.path), "guesser": g2p_info,
                "running": [j for j in jobs.values() if j["kind"] == "dictionary" and not j["done"]]}

    @app.post("/v1/admin/dictionary/install", dependencies=admin)
    def admin_dictionary_install():
        if any(j["kind"] == "dictionary" and not j["done"] for j in jobs.values()):
            raise HTTPException(409, "The dictionary is already being installed.")

        def work(progress):
            stats = dic.install(progress=lambda p, m: progress(m, p), g2p=engine.pronouncer.g2p)
            engine._pronouncer = None           # pick up the new dictionary on the next line
            return stats
        return {"job": run_job("dictionary", work)}

    @app.post("/v1/admin/voices/from-samples", dependencies=admin)
    async def admin_from_samples(name: str = Form(...), keywords: str = Form(""), urls: str = Form(""),
                                 license: str = Form(""), attribution: str = Form(""), speakers: int = Form(5),
                                 description: str = Form(""), seed: int | None = Form(None),
                                 files: list[UploadFile] | None = File(None)):
        try:
            engine.voices.path(name)
        except ValueError as e:
            raise HTTPException(400, str(e))
        if name in engine.voices.names():
            raise HTTPException(400, f"There is already a voice named '{name}'.")
        kws = [k.strip() for k in re.split(r"[,\n]", keywords) if k.strip()][:8]
        url_list = [{"url": u.strip(), "license": license, "attribution": attribution}
                    for u in urls.splitlines() if u.strip().startswith(("http://", "https://"))][:20]
        uploads = []
        for f in files or []:
            data = await f.read()
            if data:
                uploads.append({"name": f.filename or "upload.wav", "data": data, "license": license,
                                "attribution": attribution or (f.filename or "")})
        if (url_list or uploads) and not license.strip():
            raise HTTPException(400, "Say what license your links or files have (for example cc0, cc-by-4.0, "
                                     "public-domain, own-recording or consented).")
        if not (kws or url_list or uploads):
            raise HTTPException(400, "Give keywords to search for, or links or files to sample.")
        from .sampling import create_voice_from_samples

        def work(progress):
            with lock:
                v, rep = create_voice_from_samples(engine, name, kws, url_list, uploads, speakers, seed,
                                                   description, progress=progress)
            return {"name": v.name, **rep.__dict__}
        return {"job": run_job("samples", work)}

    # ---- Discover voices: every dictionary word as search keywords (discover.py)
    from .discover import Discovery
    discovery = Discovery(engine, learning.root if learning is not None else "learning", lock, dic)


    @app.get("/v1/admin/discover", dependencies=admin)
    def discover_status():
        return discovery.status()

    @app.post("/v1/admin/discover/start", dependencies=admin)
    def discover_start(req: DiscoverStart):
        try:
            discovery.start(req.voices, req.words_per_voice, req.speakers, req.items_per_word)
        except (RuntimeError, ValueError) as e:
            raise HTTPException(409 if isinstance(e, RuntimeError) else 400, str(e))
        return discovery.status()

    @app.post("/v1/admin/discover/stop", dependencies=admin)
    def discover_stop():
        discovery.stop()
        return discovery.status()

    @app.post("/v1/admin/discover/reset", dependencies=admin)
    def discover_reset():
        try:
            discovery.reset()
        except RuntimeError as e:
            raise HTTPException(409, str(e))
        return discovery.status()

    # ---- Character voices: age, development, dialect and delivery

    def _check_profile(p: dict):
        from . import delivery as dl, development as dev
        from .dialects import all_dialects
        if p.get("dialect") and p["dialect"] not in all_dialects(engine.voices.root):
            raise HTTPException(400, f"Unknown dialect '{p['dialect']}'.")
        if p.get("register") and p["register"] not in dev.REGISTERS:
            raise HTTPException(400, f"Unknown speaking style '{p['register']}'.")
        if p.get("delivery") and p["delivery"] not in dl.DELIVERIES:
            raise HTTPException(400, f"Unknown delivery '{p['delivery']}'.")
        bad = [k for k in (p.get("processes") or {}) if k not in dev.PROCESSES]
        if bad:
            raise HTTPException(400, f"Unknown sound pattern: {', '.join(bad)}.")

    @app.post("/v1/admin/voices/character", dependencies=admin)
    def make_character(req: CharacterRequest):
        p = req.model_dump(exclude={"group", "name", "seed"})
        p["register"] = p.pop("speaking_style", None)
        _check_profile(p)
        if req.name and req.name in engine.voices.names():
            raise HTTPException(400, f"There is already a voice named '{req.name}'.")
        try:
            with lock:
                v = engine.character_voice(req.group, req.name, req.seed, **p)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"name": v.name, "profile": v.profile, "description": v.description}


    @app.post("/v1/admin/voices/starters", dependencies=admin)
    def make_starters(req: StartersRequest):
        """The six starting voices in one go (skips names that already exist)."""
        from .development import AGE_GROUPS
        _check_profile(req.model_dump())
        made = []
        suffix = f"_{req.dialect}" if req.dialect else ""
        with lock:
            for g in AGE_GROUPS:
                name = f"{g}{suffix}"[:64]
                if name in engine.voices.names():
                    continue
                engine.character_voice(g, name, dialect=req.dialect, accent=req.accent)
                made.append(name)
        return {"made": made}

    @app.put("/v1/admin/voices/{name}/profile", dependencies=admin)
    def set_profile(name: str, changes: dict):
        try:
            v = engine.voices.load(name)
        except (KeyError, ValueError) as e:
            raise HTTPException(404, str(e))
        prof = dict(v.profile or {})
        for k, val in changes.items():
            if k in engine.PROFILE_KEYS:
                if val is None or val == "":
                    prof.pop(k, None)
                else:
                    prof[k] = val
        if prof.get("age") is not None and not 1 <= float(prof["age"]) <= 90:
            raise HTTPException(400, "Age goes from 1 (first words) to 90.")
        _check_profile(prof)
        v.profile = prof or None
        engine.voices.save(v)
        return {"name": name, "profile": v.profile}


    @app.put("/v1/admin/dialects/{did}", dependencies=admin)
    def save_dialect(did: str, req: DialectRequest):
        """Your own regional or local dialect, built from the same rules."""
        from .dialects import DIALECTS, RULES
        if not re.fullmatch(r"[a-z0-9_]{2,40}", did) or did in DIALECTS:
            raise HTTPException(400, "Use a new id of 2-40 lowercase letters, numbers or _.")
        bad = [r for r in req.rules if r not in RULES]
        if bad:
            raise HTTPException(400, f"Unknown rule: {', '.join(bad)}.")
        pros = {k: max(-1.0, min(1.0, float(v))) for k, v in req.prosody.items() if k in ("rate", "pitch_range")}
        d = engine.voices.root / "dialects"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{did}.json").write_text(json.dumps({"label": req.label, "region": req.region, "rules": req.rules,
                                                   "prosody": pros}, indent=2))
        return {"id": did}

    @app.delete("/v1/admin/dialects/{did}", dependencies=admin)
    def delete_dialect(did: str):
        f = engine.voices.root / "dialects" / f"{did}.json"
        if not re.fullmatch(r"[a-z0-9_]{2,40}", did) or not f.exists():
            raise HTTPException(404, "No such dialect of yours.")
        f.unlink()
        return {"ok": True}

    # ---- Automatic training (autotrain.py): gathers, learns, trains, checks, on a schedule
    from .autotrain import AutoTrainer
    autotrain = AutoTrainer(engine, Path(engine.voices.root).parent, lock, dic, learning)
    autotrain.start_scheduler()

    @app.get("/v1/admin/autotrain", dependencies=admin)
    def autotrain_status():
        return autotrain.status()

    @app.put("/v1/admin/autotrain/settings", dependencies=admin)
    def autotrain_settings(changes: dict):
        try:
            return autotrain.update_settings(changes)
        except (ValueError, TypeError) as e:
            raise HTTPException(400, str(e))

    @app.post("/v1/admin/autotrain/run/{phase}", dependencies=admin)
    def autotrain_run(phase: str):
        try:
            autotrain.run(phase)
        except RuntimeError as e:
            raise HTTPException(409, str(e))
        except ValueError as e:
            raise HTTPException(400, str(e))
        return autotrain.status()

    @app.post("/v1/admin/autotrain/stop", dependencies=admin)
    def autotrain_stop():
        autotrain.stop()
        return autotrain.status()

    @app.post("/v1/admin/autotrain/rollback", dependencies=admin)
    def autotrain_rollback():
        if not autotrain.rollback():
            raise HTTPException(409, "There's no earlier model to go back to.")
        return autotrain.status()

    @app.post("/v1/admin/whisper/install", dependencies=admin)
    def whisper_install():
        """Install Whisper (faster-whisper, free) into the Python Vox runs on and
        download its small model, then switch clear-words scoring on."""
        if any(j["kind"] == "whisper" and not j["done"] for j in jobs.values()):
            raise HTTPException(409, "Whisper is already being installed.")

        def work(progress):
            import subprocess
            import sys
            progress("Installing Whisper (free; a few minutes)", 0.1)
            r = subprocess.run([sys.executable, "-m", "pip", "install", "faster-whisper"],
                               capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError("pip couldn't install faster-whisper: " + (r.stderr or r.stdout)[-400:])
            progress("Downloading Whisper's small model", 0.6)
            import importlib
            importlib.invalidate_caches()
            from faster_whisper import WhisperModel
            WhisperModel("base", compute_type="int8")
            if learning is not None:                 # pick it up without a restart
                learning.scorer._asr = None
                learning.scorer.use_whisper = True
            return {"ok": True}
        return {"job": run_job("whisper", work)}

    @app.get("/v1/admin/check", dependencies=admin)
    def admin_check():
        return {"ok": True, "learning": learning is not None}

    @app.get("/v1/admin/learning", dependencies=admin)
    def learning_status():
        L = need_learning()
        st = L.status()
        st["word_issues"] = L.word_issues()
        return st

    @app.put("/v1/admin/learning/settings", dependencies=admin)
    def learning_settings(changes: dict):
        try:
            s = need_learning().update_settings(changes)
        except (ValueError, TypeError) as e:
            raise HTTPException(400, str(e))
        return s.__dict__

    @app.post("/v1/admin/learning/refine", dependencies=admin)
    def learning_refine():
        if not need_learning().refine(reason="manual"):
            raise HTTPException(409, "Another learning job is running. Try again when it finishes.")
        return {"started": True}

    @app.get("/v1/admin/takes", dependencies=admin)
    def admin_takes(limit: int = 50, rated: str | None = None, voice: str | None = None):
        return need_learning().recent_takes(min(max(limit, 1), 500), rated, voice)

    @app.get("/v1/admin/takes/{tid}/audio", dependencies=admin)
    def admin_take_audio(tid: str):
        try:
            wav = need_learning().take_audio(tid)
        except (KeyError, FileNotFoundError):
            raise HTTPException(404, "That take is gone (old unrated takes are cleared after a while).")
        return Response(to_wav_bytes(wav, engine.sr), media_type="audio/wav")

    @app.post("/v1/admin/takes/{tid}/feedback", dependencies=admin)
    def admin_feedback(tid: str, req: FeedbackRequest):
        try:
            need_learning().feedback(tid, req.rating, req.note)
        except KeyError as e:
            raise HTTPException(404, str(e))
        return {"ok": True}

    @app.post("/v1/admin/ab", dependencies=admin)
    def admin_ab(req: ABRequest):
        style = {k: v for k, v in {"emotion": req.emotion, "autotune": req.autotune}.items() if v}
        try:
            a, b = need_learning().make_ab_pair(req.text, req.voice, style)
        except KeyError as e:
            raise HTTPException(404, str(e))
        return {"a": a, "b": b}

    @app.post("/v1/admin/compare", dependencies=admin)
    def admin_compare(req: CompareRequest):
        try:
            need_learning().compare(req.winner, req.loser)
        except KeyError as e:
            raise HTTPException(404, str(e))
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"ok": True}

    @app.get("/v1/admin/models", dependencies=admin)
    def admin_models():
        return need_learning().versions()

    @app.post("/v1/admin/models/{version}/promote", dependencies=admin)
    def admin_promote(version: str):
        try:
            need_learning().promote(version)
        except KeyError as e:
            raise HTTPException(404, str(e))
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"current": version}

    @app.post("/v1/admin/models/rollback", dependencies=admin)
    def admin_rollback():
        try:
            return {"current": need_learning().rollback()}
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.get("/v1/admin/lexicon", dependencies=admin)
    def admin_lexicon():
        L = need_learning()
        return {"words": L.lexicon(), "issues": L.word_issues()}

    @app.put("/v1/admin/lexicon", dependencies=admin)
    def admin_lexicon_put(req: WordRequest):
        try:
            need_learning().set_word(req.word, req.say_as)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"ok": True}

    @app.delete("/v1/admin/lexicon/{word}", dependencies=admin)
    def admin_lexicon_delete(word: str):
        need_learning().delete_word(word)
        return {"ok": True}

    @app.patch("/v1/admin/voices/{name}", dependencies=admin)
    def admin_voice_patch(name: str, req: VoicePatch):
        try:
            v = engine.voices.load(name)
        except (KeyError, ValueError) as e:
            raise HTTPException(404, str(e))
        if req.description is not None:
            v.description = req.description[:200]
        if req.clear_autotune:
            v.autotune = None
        elif req.autotune is not None:
            spec = {"preset": req.autotune} if isinstance(req.autotune, str) else dict(req.autotune)
            try:
                settings_from(spec)
            except (ValueError, TypeError) as e:
                raise HTTPException(400, str(e))
            v.autotune = spec
        if req.reset_tuning:
            v.infer = None
        engine.voices.save(v)
        return {"name": v.name, "autotune": v.autotune, "infer": v.infer}

    @app.post("/v1/admin/voices/{name}/optimize", dependencies=admin)
    def admin_optimize(name: str):
        try:
            started = need_learning().optimize_voice(name)
        except KeyError as e:
            raise HTTPException(404, str(e))
        if not started:
            raise HTTPException(409, "Another learning job is running. Try again when it finishes.")
        return {"started": True}

    @app.post("/v1/admin/voices/{name}/undo-refine", dependencies=admin)
    def admin_undo_refine(name: str):
        try:
            v = engine.voices.load(name)
        except (KeyError, ValueError) as e:
            raise HTTPException(404, str(e))
        if not v.history:
            raise HTTPException(400, "This voice has not been refined.")
        v.speaker_emb = v.history.pop()
        engine.voices.save(v)
        return {"name": name, "refinements_left": len(v.history)}

    @app.delete("/v1/admin/voices/{name}", dependencies=admin)
    def delete_voice(name: str):
        if name == "narrator":
            raise HTTPException(400, "The narrator is the default voice and can't be deleted.")
        engine.voices.delete(name)
        return {"deleted": name}

    return app


def admin_token_for(root: str | Path) -> str:
    """Read or create the admin token (kept in <root>/admin_token.txt)."""
    p = Path(root) / "admin_token.txt"
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists():
        p.write_text(secrets.token_urlsafe(24))
        try:
            p.chmod(0o600)
        except OSError:
            pass
    return p.read_text().strip()


def serve(ckpt: str, host: str = "127.0.0.1", port: int = 5150, voices_dir: str = "voices",
          cache_dir: str = "cache", device: str | None = None, learning_dir: str | None = "learning",
          public: bool = False, allowed_origins: list[str] | None = None, tunnel: bool = False,
          tunnel_name: str | None = None, translation: str = "m2m100", rate_per_minute: int = 30) -> None:
    import uvicorn
    engine = VoxEngine(ckpt, voices_dir=voices_dir, cache_dir=cache_dir, device=device)
    engine.use_translator(translation, Path(cache_dir) / "translations.db" if cache_dir else None)
    learning, token = None, None
    if learning_dir:
        from .learning import LearningSystem
        learning = LearningSystem(engine, learning_dir)
        token = admin_token_for(learning_dir)
        print(f"\n  Vox admin token: {token}\n  (paste it into the admin app's Voice engine page; "
              f"also saved in {Path(learning_dir) / 'admin_token.txt'})\n")
    if (public or tunnel or tunnel_name) and not token:
        raise SystemExit("Going online needs learning on (it holds the admin token). Remove --no-learning.")
    proc = None
    if tunnel or tunnel_name:
        from .tunnel import start_named_tunnel, start_quick_tunnel
        public = True
        if tunnel_name:
            proc = start_named_tunnel(tunnel_name, port)
            print(f"  Online through your Cloudflare tunnel '{tunnel_name}'.")
        else:
            proc, url = start_quick_tunnel(port)
            print(f"  Online at {url}  (this address changes each time; paste it into the admin page)")
    if public:
        print(f"  Public mode: browsers may call it only from {', '.join(allowed_origins or DEFAULT_ONLINE_ORIGINS)}; "
              f"{rate_per_minute} requests a minute per visitor.")
    try:
        uvicorn.run(create_app(engine, learning, token, public=public, allowed_origins=allowed_origins,
                               rate_per_minute=rate_per_minute), host=host, port=port)
    finally:
        if proc is not None:
            proc.terminate()
