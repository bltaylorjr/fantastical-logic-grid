#!/bin/sh
# Vox on the Oracle server (docs/VOX-SERVER.md). The container flg-vox runs
# this from the live release: /srv/vox/releases/<release>/vox-engine.
#   /srv/vox   releases and "current" (read-only, written by the deploy workflow)
#   /data      Vox's voices, models, learning, cache, and its Python packages
# Vox listens on the server's private network only (172.30.0.11:5150). Nothing
# on the internet reaches it: the admin dashboard's Worker does, through the
# Cloudflare Tunnel, for signed-in admins, adding the key VOX_KEY.
set -eu
REL="$1"
ENGINE="/srv/vox/releases/$REL/vox-engine"
cd /data
export PYTHONPATH="$ENGINE" PYTHONDONTWRITEBYTECODE=1 HF_HOME=/data/hf VOX_RELEASE="$REL" HOME=/data VOX_AUTOTRAIN=1
log() { echo "[vox $(date -u +%H:%M:%S)] $*"; }

# Vox's own Python packages live in /data/venv and are (re)installed only when
# the release's requirements change, so a restart is quick.
[ -x /data/venv/bin/python ] || python3 -m venv /data/venv
PY=/data/venv/bin/python
if ! cmp -s "$ENGINE/requirements.txt" /data/venv/vox-requirements.txt 2>/dev/null; then
  log "Installing what Vox needs (first time: several minutes)"
  $PY -m pip install --upgrade pip >/dev/null
  # CPU PyTorch: the server has no graphics card, and the CPU build is far smaller
  $PY -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r "$ENGINE/requirements.txt"
  cp "$ENGINE/requirements.txt" /data/venv/vox-requirements.txt
fi
if [ ! -f /data/venv/vox-whisper-ready ]; then
  log "Downloading Whisper's small model"
  $PY -c "from faster_whisper import WhisperModel; WhisperModel('base', compute_type='int8')" && touch /data/venv/vox-whisper-ready || log "Whisper's model didn't download; clear-words scoring stays off for now"
fi

# The key the Worker sends is Vox's admin token.
mkdir -p /data/learning
if [ -n "${VOX_KEY:-}" ]; then printf '%s' "$VOX_KEY" > /data/learning/admin_token.txt; fi
MODEL=practice.pt
[ -f runs/v1/vox.pt ] && MODEL=runs/v1/vox.pt
[ -f "$MODEL" ] || { log "Making the practice model"; $PY -m vox.cli init --preset tiny --out practice.pt; }

log "Starting Vox $REL with $MODEL"
$PY -m vox.cli serve --host 0.0.0.0 --port 5150 --ckpt "$MODEL" &
pid=$!
# A new release, or Vox stopping: exit, and Docker starts the container again on what's current.
while kill -0 "$pid" 2>/dev/null; do
  sleep 15
  now=$(cat /srv/vox/current 2>/dev/null || true)
  if [ -n "$now" ] && [ "$now" != "$REL" ]; then
    log "Release $now is live; restarting on it"
    kill "$pid"; wait "$pid" 2>/dev/null || true
    exit 0
  fi
done
wait "$pid"
