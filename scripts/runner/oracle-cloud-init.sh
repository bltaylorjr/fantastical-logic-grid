#!/bin/bash
# The Oracle Cloud server for The Logic Grid (Always Free Ampere
# A1 Arm VM, Ubuntu 24.04). It does two jobs:
#   1. GitHub Actions build runners (docs/PRIVATE-REPO.md): three containers
#      named oracle-1..3, labels self-hosted + flg, reached through the
#      repository variable FLG_RUNNER = ["self-hosted","flg"].
#   2. The private puzzle server (docs/PUZZLE-SERVER.md): the puzzle generator
#      runs only here, reached only by the game's Cloudflare Worker through a
#      Cloudflare Tunnel. No port on this server is open to the internet.
#
# First time: paste this whole file into "Show advanced options > Management >
# Initialization script" when creating the VM, after replacing
# PASTE_RUNNER_TOKEN_HERE below with the runner token from GitHub.
#
# Any time later (a new token, the tunnel, a fix), over SSH:
#   sudo RUNNER_TOKEN=AAAA... TUNNEL_TOKEN=eyJ... bash /opt/flg/setup.sh
# Either token may be left out; what is already set up keeps running.
# Everything it does is written to /var/log/flg-setup.log.
set -euo pipefail
RUNNER_TOKEN="${RUNNER_TOKEN:-PASTE_RUNNER_TOKEN_HERE}"
TUNNEL_TOKEN="${TUNNEL_TOKEN:-}"
# The shared key the Worker sends (Cloudflare secret PUZZLE_KEY). Given when
# the server is created (oracle-create-server.sh); otherwise one is made here.
PUZZLE_KEY="${PUZZLE_KEY:-}"
REPO_URL="https://github.com/bltaylorjr/fantastical-logic-grid"
# Runners by size: 3 at 4+ cores, 2 on the Always Free 2 cores and 12 GB,
# 1 on a 1-core server (the last-resort size when Oracle was sold out).
CORES=$(nproc)
RUNNERS=${RUNNERS:-$([ "$CORES" -ge 4 ] && echo 3 || { [ "$CORES" -ge 2 ] && echo 2 || echo 1; })}

exec > >(tee -a /var/log/flg-setup.log) 2>&1
echo "=== FLG setup $(date -u +%FT%TZ) ==="
step() { echo; echo "--- $*"; }
# Keep a copy of this script so it can be run again later (see the top).
mkdir -p /opt/flg && chmod 700 /opt/flg
if [ "$(readlink -f "$0")" != /opt/flg/setup.sh ] && [ -f "$0" ]; then cp "$0" /opt/flg/setup.sh; chmod 700 /opt/flg/setup.sh; fi

step "System packages, Docker, automatic security updates, swap"
export DEBIAN_FRONTEND=noninteractive
command -v docker >/dev/null || { apt-get update; apt-get install -y docker.io; }
command -v jq >/dev/null || apt-get install -y jq
dpkg -s unattended-upgrades >/dev/null 2>&1 || apt-get install -y unattended-upgrades
systemctl enable --now docker
# Security updates install themselves (and reboot at 4 am UTC if needed).
echo 'Unattended-Upgrade::Automatic-Reboot "true"; Unattended-Upgrade::Automatic-Reboot-Time "04:00";' > /etc/apt/apt.conf.d/52flg-reboot
# Swap keeps a big build from running out of memory.
if [ ! -f /swapfile ]; then fallocate -l 8G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi
# A private network inside this server: the puzzle server sits at a fixed
# address (172.30.0.10) that only the tunnel container uses.
docker network inspect flg >/dev/null 2>&1 || docker network create --subnet 172.30.0.0/24 flg

step "Keep containers away from the server's startup settings"
# The startup settings (Oracle's metadata address 169.254.169.254) can hold the
# tunnel token and the puzzle key. Build jobs run in containers, so containers
# may not reach that address; the server itself still can. Re-applied at boot.
# The same address is also Oracle's DNS server, so DNS (port 53) stays open:
# without it containers can't look up any website and image builds fail.
cat > /etc/systemd/system/flg-metadata-guard.service <<'UNIT'
[Unit]
Description=Block containers from the instance metadata address
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'iptables -C DOCKER-USER -d 169.254.169.254 -j DROP 2>/dev/null || iptables -I DOCKER-USER -d 169.254.169.254 -j DROP; for p in udp tcp; do iptables -C DOCKER-USER -d 169.254.169.254 -p $$p --dport 53 -j RETURN 2>/dev/null || iptables -I DOCKER-USER -d 169.254.169.254 -p $$p --dport 53 -j RETURN; done'
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable flg-metadata-guard.service
systemctl restart flg-metadata-guard.service   # picks up rule changes on a re-run

step "Build runner image"
mkdir -p /opt/flg-runner && cd /opt/flg-runner
cat > Dockerfile <<'EOF'
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y curl git jq zip unzip xz-utils sudo ca-certificates gnupg build-essential \
      python3 python3-pip python3-venv ffmpeg rsync openssh-client lftp \
 && rm -rf /var/lib/apt/lists/*
# Node.js 22 straight from nodejs.org.
RUN arch=$(dpkg --print-architecture | sed 's/amd64/x64/') \
 && v=$(curl -fsSL https://nodejs.org/dist/index.json | jq -r '[.[] | select(.version | startswith("v22."))][0].version') \
 && curl -fsSL "https://nodejs.org/dist/$v/node-$v-linux-$arch.tar.xz" | tar xJ -C /usr/local --strip-components=1 \
 && node --version
# GitHub's command-line tool (the workflows use it for releases and issues).
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*
# Jobs run as "runner", who may use sudo (GitHub's own machines allow the same).
RUN useradd -m -s /bin/bash runner && echo 'runner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/runner
# The test browser (Playwright's Chromium) and its system libraries, ready in advance.
RUN npx --yes playwright@1.63.0 install-deps chromium && rm -rf /var/lib/apt/lists/*
USER runner
WORKDIR /home/runner
RUN npx --yes playwright@1.63.0 install chromium \
 && chrome=$(find /home/runner/.cache/ms-playwright -maxdepth 3 -path '*/chromium-[0-9]*/*' -name chrome -type f | head -1) \
 && test -n "$chrome" && ln -s "$chrome" /home/runner/chrome
# Lighthouse finds the browser here.
ENV CHROME_PATH=/home/runner/chrome
RUN v=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed 's/^v//') \
 && arch=$(dpkg --print-architecture | sed 's/amd64/x64/') \
 && mkdir actions-runner && curl -fsSL "https://github.com/actions/runner/releases/download/v$v/actions-runner-linux-$arch-$v.tar.gz" | tar xz -C actions-runner \
 && sudo ./actions-runner/bin/installdependencies.sh
COPY --chown=runner start.sh /home/runner/start.sh
CMD ["/home/runner/start.sh"]
EOF
cat > start.sh <<'EOF'
#!/bin/bash
# Registers once (the registration lives in the container), then runs jobs.
set -e
cd /home/runner/actions-runner
if [ ! -f .runner ]; then
  if ! ./config.sh --unattended --url "$REPO_URL" --token "$RUNNER_TOKEN" --name "$RUNNER_NAME" --labels flg --replace; then
    echo "REGISTRATION FAILED for $RUNNER_NAME. The runner token has probably expired (it lasts one hour)."
    echo "Get a new one and run: sudo RUNNER_TOKEN=... bash /opt/flg/setup.sh"
    sleep 600; exit 1
  fi
fi
exec ./run.sh
EOF
chmod +x start.sh
docker build -t flg-runner .

step "Shared folder for puzzle server releases"
# Deploys (.github/workflows/puzzle-server.yml) run on these runners and write
# each release here; the puzzle server reads it. The key is kept elsewhere.
RUNNER_UID=$(docker run --rm flg-runner id -u)
mkdir -p /opt/flg-puzzles/releases
chown -R "$RUNNER_UID:$RUNNER_UID" /opt/flg-puzzles
chmod 755 /opt/flg-puzzles

step "Build runners"
registered=0
for i in $(seq 1 "$RUNNERS"); do
  if docker ps -a --format '{{.Names}}' | grep -qx "flg-runner-$i"; then
    # A container that registered keeps its registration; leave it running
    # unless a new token was given (then it is rebuilt from the new image).
    if [ "$RUNNER_TOKEN" = PASTE_RUNNER_TOKEN_HERE ] && docker exec "flg-runner-$i" test -f /home/runner/actions-runner/.runner 2>/dev/null; then registered=$((registered+1)); continue; fi
  fi
  if [ "$RUNNER_TOKEN" = PASTE_RUNNER_TOKEN_HERE ]; then echo "No runner token given, so oracle-$i was not (re)created."; continue; fi
  docker rm -f "flg-runner-$i" 2>/dev/null || true
  docker run -d --name "flg-runner-$i" --restart always --shm-size 1g --cpu-shares 512 --memory 5g \
    -v /opt/flg-puzzles:/flg-puzzles \
    -e REPO_URL="$REPO_URL" -e RUNNER_TOKEN="$RUNNER_TOKEN" -e RUNNER_NAME="oracle-$i" flg-runner
  registered=$((registered+1))
done

step "Puzzle server"
# The shared key the Worker sends with every request (Cloudflare secret
# PUZZLE_KEY). Made once and kept; readable by root only.
if [ -n "$PUZZLE_KEY" ]; then echo "FLG_PUZZLE_KEY=$PUZZLE_KEY" > /opt/flg/puzzle.env
elif [ ! -s /opt/flg/puzzle.env ]; then echo "FLG_PUZZLE_KEY=$(openssl rand -hex 32)" > /opt/flg/puzzle.env; fi
chmod 600 /opt/flg/puzzle.env
docker rm -f flg-puzzles 2>/dev/null || true
# Puzzle requests get priority over build jobs when the server is busy
# (cpu-shares 2048 against 512 for each runner). Until the first release is
# deployed it waits and tries again every 30 seconds.
docker run -d --name flg-puzzles --restart always --network flg --ip 172.30.0.10 \
  --cpu-shares 2048 --memory 6g --read-only --tmpfs /tmp --user 1000:1000 \
  --env-file /opt/flg/puzzle.env -e THREADS=2 -e RELEASE_FILE=/srv/flg/current \
  -v /opt/flg-puzzles:/srv/flg:ro node:22-bookworm-slim \
  sh -c 'r=$(cat /srv/flg/current 2>/dev/null || true); if [ -z "$r" ] || [ ! -f "/srv/flg/releases/$r/puzzle-server/server.mjs" ]; then echo "No puzzle server release yet; waiting."; sleep 30; exit 1; fi; RELEASE=$r ENGINE_DIR=/srv/flg/releases/$r/engine/src exec node /srv/flg/releases/$r/puzzle-server/server.mjs'

step "Vox voice engine"
# Vox (docs/VOX-SERVER.md) at 172.30.0.11:5150 on the private flg network.
# Releases come from the deploy workflow into the shared folder the runners
# already have (/opt/flg-puzzles/vox, so the runners need no changes); Vox's
# voices, models, learning and Python packages stay in /opt/flg-vox/data.
mkdir -p /opt/flg-puzzles/vox/releases /opt/flg-vox/data
chown -R "$RUNNER_UID:$RUNNER_UID" /opt/flg-puzzles/vox
chown -R 1000:1000 /opt/flg-vox/data
if [ ! -s /opt/flg/vox.env ]; then echo "VOX_KEY=$(openssl rand -hex 32)" > /opt/flg/vox.env; fi
chmod 600 /opt/flg/vox.env
mkdir -p /opt/flg-vox/image && cat > /opt/flg-vox/image/Dockerfile <<'EOF'
FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 ca-certificates \
 && rm -rf /var/lib/apt/lists/* && useradd -u 1000 -m vox
USER vox
EOF
docker build -q -t flg-vox-base /opt/flg-vox/image
docker rm -f flg-vox 2>/dev/null || true
docker run -d --name flg-vox --restart always --network flg --ip 172.30.0.11 \
  --cpus 1 --cpu-shares 256 --memory 5g --read-only --tmpfs /tmp --user 1000:1000 \
  --env-file /opt/flg/vox.env -v /opt/flg-puzzles/vox:/srv/vox:ro -v /opt/flg-vox/data:/data flg-vox-base \
  sh -c 'r=$(cat /srv/vox/current 2>/dev/null || true); if [ -z "$r" ] || [ ! -f "/srv/vox/releases/$r/vox-engine/deploy/run.sh" ]; then echo "No Vox release yet; waiting."; sleep 60; exit 1; fi; exec sh "/srv/vox/releases/$r/vox-engine/deploy/run.sh" "$r"'

step "Daily cleanup and repair"
# docs/SERVER-MAINTENANCE.md. The same script is in the repository as
# scripts/runner/flg-maintenance.sh (a test checks the two match).
cat > /opt/flg/maintenance.sh <<'MAINT'
#!/bin/bash
# Daily cleanup and repair for the Oracle server (docs/SERVER-MAINTENANCE.md).
# Written by oracle-cloud-init.sh (step "Daily cleanup and repair", which holds
# the copy that is installed; keep the two the same) as /opt/flg/maintenance.sh and run every
# day at 3:30 a.m. server time by flg-maintenance.timer (before the 4 a.m.
# automatic security-update reboot). Safe to run any time:
#   sudo bash /opt/flg/maintenance.sh
# Plain shell, no AI. Everything it does is logged to /var/log/flg-maintenance.log,
# and a short summary goes to /opt/flg-puzzles/maintenance.json.
set -uo pipefail
exec > >(tee -a /var/log/flg-maintenance.log) 2>&1
echo "=== FLG maintenance $(date -u +%FT%TZ) ==="
START_USED=$(df --output=used -B1 / | tail -1)
REPAIRS=()
note() { echo "  $*"; }
repair() { echo "  REPAIR: $*"; REPAIRS+=("$*"); }

# ------------------------------------------------------------------ repair
echo "--- Checking the services"
systemctl is-active --quiet docker || { systemctl restart docker; repair "restarted Docker"; sleep 10; }
docker network inspect flg >/dev/null 2>&1 || { docker network create --subnet 172.30.0.0/24 flg; repair "re-created the private network flg"; }
systemctl is-active --quiet flg-metadata-guard.service || { systemctl restart flg-metadata-guard.service; repair "re-applied the metadata block"; }
swapon --show | grep -q /swapfile || { [ -f /swapfile ] && swapon /swapfile && repair "turned swap back on"; }
for c in $(docker ps -a --format '{{.Names}}' | grep -E '^flg-'); do
  state=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null)
  restarts=$(docker inspect -f '{{.RestartCount}}' "$c" 2>/dev/null)
  if [ "$state" = exited ] || [ "$state" = dead ] || [ "$state" = created ]; then
    docker start "$c" >/dev/null && repair "started $c (it was $state)"
  fi
  [ "${restarts:-0}" -gt 20 ] && note "$c has restarted $restarts times; see: sudo docker logs --tail 50 $c"
done
# Health from inside the server (the containers' private addresses).
check() { curl -fsS -m 10 "$1" >/dev/null 2>&1; }
PKEY=$(sed -n 's/^FLG_PUZZLE_KEY=//p' /opt/flg/puzzle.env 2>/dev/null)
pcheck() { curl -fsS -m 10 -H "X-FLG-Key: $PKEY" http://172.30.0.10:8080/v1/health >/dev/null 2>&1; }
if docker ps --format '{{.Names}}' | grep -qx flg-puzzles && [ -s /opt/flg-puzzles/current ]; then
  pcheck || { sleep 30; pcheck || { docker restart flg-puzzles >/dev/null; repair "restarted the puzzle server (not answering)"; }; }
fi
if docker ps --format '{{.Names}}' | grep -qx flg-vox && [ -s /opt/flg-puzzles/vox/current ]; then
  # Vox's first start can take 15 minutes (installs); only act if it has been up longer.
  up=$(( $(date +%s) - $(date -d "$(docker inspect -f '{{.State.StartedAt}}' flg-vox)" +%s) ))
  if [ "$up" -gt 1800 ] && ! check http://172.30.0.11:5150/v1/health; then
    sleep 60; check http://172.30.0.11:5150/v1/health || { docker restart flg-vox >/dev/null; repair "restarted Vox (not answering)"; }
  fi
fi

# ------------------------------------------------------------------ cleanup
echo "--- Cleaning up"
busy() { docker exec "$1" pgrep -f Runner.Worker >/dev/null 2>&1; }
for r in $(docker ps --format '{{.Names}}' | grep -E '^flg-runner-'); do
  if busy "$r"; then note "$r is running a job; its files are left for tomorrow"; continue; fi
  # Old job folders, caches and logs inside the build runners (a new job re-creates what it needs).
  docker exec "$r" sh -c 'cd /home/runner/actions-runner && rm -rf _work/_temp/* 2>/dev/null;
    find _work -mindepth 1 -maxdepth 1 -type d ! -name _tool ! -name _actions -mtime +2 -exec rm -rf {} + 2>/dev/null;
    find _diag -type f -mtime +7 -delete 2>/dev/null;
    rm -rf /home/runner/.npm/_cacache 2>/dev/null; find /tmp -mindepth 1 -mtime +1 -delete 2>/dev/null; true'
done
docker image prune -f >/dev/null                         # unused image layers
docker builder prune -af --filter until=72h >/dev/null 2>&1
# Puzzle server and Vox releases: the newest three and the one to roll back to.
for V in /opt/flg-puzzles /opt/flg-puzzles/vox; do
  [ -d "$V/releases" ] || continue
  keep_cur=$(cat "$V/current" 2>/dev/null || true); keep_prev=$(cat "$V/previous" 2>/dev/null || true)
  ls -1dt "$V"/releases/*/ 2>/dev/null | tail -n +4 | while read -r d; do
    b=$(basename "$d"); [ "$b" = "$keep_cur" ] || [ "$b" = "$keep_prev" ] || { rm -rf "$d"; echo "  removed old release $d"; }
  done
  find "$V/releases" -maxdepth 1 -name '*.tmp' -mtime +1 -exec rm -rf {} + 2>/dev/null
done
# Vox: its own budget (old rendered lines, extra model files, noisiest clips first).
if docker ps --format '{{.Names}}' | grep -qx flg-vox && [ -x /opt/flg-vox/data/venv/bin/python ]; then
  rel=$(cat /opt/flg-puzzles/vox/current 2>/dev/null || true)
  [ -n "$rel" ] && docker exec -w /data -e PYTHONPATH="/srv/vox/releases/$rel/vox-engine" flg-vox \
    /data/venv/bin/python -m vox.autotrain --cleanup --root /data | sed 's/^/  Vox: /'
  find /opt/flg-vox/data/hf -type d -name '.locks' -prune -o -type f -name '*.incomplete' -mtime +1 -print -delete 2>/dev/null
fi
journalctl --vacuum-size=200M --vacuum-time=14d >/dev/null 2>&1
apt-get -qq clean; apt-get -qq -y autoremove >/dev/null 2>&1
for f in /var/log/flg-setup.log /var/log/flg-maintenance.log; do
  [ -f "$f" ] && [ "$(stat -c %s "$f")" -gt 20000000 ] && { tail -c 5000000 "$f" > "$f.tmp" && mv "$f.tmp" "$f"; }
done
find /var/log -name '*.gz' -mtime +30 -delete 2>/dev/null
fstrim -a >/dev/null 2>&1 || true

# ------------------------------------------------------------------ space check
USED_PCT=$(df --output=pcent / | tail -1 | tr -dc 0-9)
if [ "$USED_PCT" -ge 85 ]; then
  note "Disk is ${USED_PCT}% full: also clearing unused images and stopped helper containers"
  docker image prune -af --filter until=168h >/dev/null 2>&1
  USED_PCT=$(df --output=pcent / | tail -1 | tr -dc 0-9)
  [ "$USED_PCT" -ge 90 ] && note "STILL ${USED_PCT}% full. Lower Vox's storage budget on the Voice engine page, or ask Claude."
fi
END_USED=$(df --output=used -B1 / | tail -1)
FREED=$(( (START_USED - END_USED) / 1048576 ))
MEM=$(free -m | awk '/Mem:/ {printf "%d of %d MB in use", $3, $2}')
LOAD=$(cut -d' ' -f1-3 /proc/loadavg)
echo "--- Done: freed ${FREED} MB; disk ${USED_PCT}% used; memory ${MEM}; load ${LOAD}"
printf '{"at":"%s","freed_mb":%d,"disk_pct":%d,"memory":"%s","load":"%s","repairs":%s}\n' \
  "$(date -u +%FT%TZ)" "$FREED" "$USED_PCT" "$MEM" "$LOAD" \
  "$(printf '%s\n' "${REPAIRS[@]:-}" | jq -R . | jq -sc 'map(select(length>0))' 2>/dev/null || echo '[]')" \
  > /opt/flg-puzzles/maintenance.json.tmp && mv /opt/flg-puzzles/maintenance.json.tmp /opt/flg-puzzles/maintenance.json
chmod 644 /opt/flg-puzzles/maintenance.json
# Vox shows it on the admin app's Voice engine page (it can read only its own folder).
[ -d /opt/flg-puzzles/vox ] && cp /opt/flg-puzzles/maintenance.json /opt/flg-puzzles/vox/maintenance.json
MAINT
chmod 700 /opt/flg/maintenance.sh
cat > /etc/systemd/system/flg-maintenance.service <<'UNIT'
[Unit]
Description=FLG daily cleanup and repair
After=docker.service
[Service]
Type=oneshot
Nice=10
IOSchedulingClass=idle
ExecStart=/bin/bash /opt/flg/maintenance.sh
UNIT
cat > /etc/systemd/system/flg-maintenance.timer <<'UNIT'
[Unit]
Description=FLG daily cleanup and repair at 3:30
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
RandomizedDelaySec=300
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now flg-maintenance.timer

step "Free-tier guard"
# docs/SERVER-MAINTENANCE.md. The same script is in the repository as
# scripts/runner/flg-usage.sh (a test checks the two match).
cat > /opt/flg/usage.sh <<'USAGE'
#!/bin/bash
# Free-tier guard for the Oracle server (docs/SERVER-MAINTENANCE.md).
# Written by oracle-cloud-init.sh (step "Free-tier guard", which holds the copy
# that is installed; keep the two the same) as /opt/flg/usage.sh and run every
# 15 minutes by flg-usage.timer. Plain shell, no AI.
#
# Oracle bills this server by its size and hours, not by how busy it is, so
# what can go over the free allowance is: the server's size (2 cores, 12 GB),
# outbound data (10 TB a month) and storage (the fixed 100 GB disk; filling it
# costs nothing but breaks things). This measures each one against the month,
# at the pace that makes the allowance last all month, and sets a level that
# slows, then pauses, only non-essential work: Vox's gathering, training and
# crawls. The games, Vox serving voices, the tunnel and builds always run.
#   level 0  normal
#   level 1  careful   (on pace for 70% of an allowance, or disk 75% full)
#   level 2  throttled (85%, or disk 85%): no downloads for Vox; Vox gets half a core
#   level 3  essential only (95%, or 90% already used, or disk 92%): Vox only serves
set -uo pipefail
STATE=/opt/flg/usage
OUT=/opt/flg-puzzles/usage.json
mkdir -p "$STATE"
OUTBOUND_LIMIT=$((10 * 1000 * 1000 * 1000 * 1000))      # 10 TB a month
FREE_OCPUS=2; FREE_MEM_GB=12

# --- Outbound data: the interface's counter, added up per day (survives reboots).
IF=$(ip route show default 2>/dev/null | awk '{print $5; exit}')
TX=$(cat "/sys/class/net/${IF:-ens3}/statistics/tx_bytes" 2>/dev/null || echo 0)
LAST=$(cat "$STATE/tx_last" 2>/dev/null || echo 0)
DELTA=$(( TX >= LAST ? TX - LAST : TX ))                # counter reset after a reboot
echo "$TX" > "$STATE/tx_last"
TODAY=$(date -u +%F); MONTH=$(date -u +%Y-%m)
DAYFILE="$STATE/tx-$TODAY"
echo $(( $(cat "$DAYFILE" 2>/dev/null || echo 0) + DELTA )) > "$DAYFILE"
find "$STATE" -name 'tx-*' -mtime +40 -delete 2>/dev/null
USED=0; for f in "$STATE"/tx-"$MONTH"-*; do [ -f "$f" ] && USED=$(( USED + $(cat "$f") )); done
DAY=$(date -u +%-d); DAYS=$(date -u -d "$(date -u +%Y-%m-01) +1 month -1 day" +%-d)
SECS_IN=$(( ( DAY - 1 ) * 86400 + $(date -u +%-H) * 3600 + $(date -u +%-M) * 60 + 60 ))
SECS_ALL=$(( DAYS * 86400 ))
# Where this month ends up at today's pace, as a share of the allowance (per
# mille). Floating point: terabytes times seconds overflow the shell's integers.
PROJ=$(awk -v u="$USED" -v a="$SECS_ALL" -v i="$SECS_IN" -v l="$OUTBOUND_LIMIT" 'BEGIN{printf "%d", u * a / i * 1000 / l}')
NOW_PM=$(awk -v u="$USED" -v l="$OUTBOUND_LIMIT" 'BEGIN{printf "%d", u * 1000 / l}')

# --- Storage
DISK=$(df --output=pcent / | tail -1 | tr -dc 0-9)
VOXGB=$(du -sb /opt/flg-vox/data 2>/dev/null | awk '{printf "%.1f", $1/1e9}')

# --- The server's size, from Oracle's own instance details (this host only).
SHAPE=$(curl -fsS -m 5 -H "Authorization: Bearer Oracle" http://169.254.169.254/opc/v2/instance/ 2>/dev/null)
OCPUS=$(echo "$SHAPE" | jq -r '.shapeConfig.ocpus // empty' 2>/dev/null)
MEMGB=$(echo "$SHAPE" | jq -r '.shapeConfig.memoryInGBs // empty' 2>/dev/null)
SIZE_OK=true
if [ -n "$OCPUS" ] && { [ "${OCPUS%.*}" -gt "$FREE_OCPUS" ] || [ "${MEMGB%.*}" -gt "$FREE_MEM_GB" ]; }; then SIZE_OK=false; fi

# --- Level
LEVEL=0; WHY="All within the free allowance."
lvl() { if [ "$1" -gt "$LEVEL" ]; then LEVEL=$1; WHY=$2; fi; }
[ "$PROJ" -ge 700 ] && lvl 1 "Outbound data is on pace for $((PROJ / 10))% of this month's free 10 TB."
[ "$PROJ" -ge 850 ] && lvl 2 "Outbound data is on pace for $((PROJ / 10))% of this month's free 10 TB."
[ "$PROJ" -ge 950 ] && lvl 3 "Outbound data is on pace for $((PROJ / 10))% of this month's free 10 TB."
[ "$NOW_PM" -ge 900 ] && lvl 3 "$((NOW_PM / 10))% of this month's free outbound data is already used."
[ "${DISK:-0}" -ge 75 ] && lvl 1 "The disk is ${DISK}% full."
[ "${DISK:-0}" -ge 85 ] && lvl 2 "The disk is ${DISK}% full."
[ "${DISK:-0}" -ge 92 ] && lvl 3 "The disk is ${DISK}% full."
$SIZE_OK || lvl 1 "The server is ${OCPUS} cores / ${MEMGB} GB, bigger than the free 2 cores / 12 GB: Oracle charges for the difference. Resize it in the Oracle console."

# --- Act: only Vox's non-essential work changes; everything else always runs.
if docker ps --format '{{.Names}}' | grep -qx flg-vox; then
  case $LEVEL in 0|1) CPUS=1;; 2) CPUS=0.5;; *) CPUS=0.25;; esac
  CUR=$(docker inspect -f '{{.HostConfig.NanoCpus}}' flg-vox 2>/dev/null)
  WANT=$(awk -v c="$CPUS" 'BEGIN{printf "%d", c*1e9}')
  [ "$CUR" != "$WANT" ] && docker update --cpus "$CPUS" flg-vox >/dev/null 2>&1
fi
PREV=$(jq -r '.level // 0' "$OUT" 2>/dev/null || echo 0)
[ "$PREV" != "$LEVEL" ] && echo "$(date -u +%FT%TZ) level $PREV -> $LEVEL: $WHY" >> /var/log/flg-usage.log

MEM=$(free -m | awk '/Mem:/ {print $3"/"$2}')
jq -n --argjson level "$LEVEL" --arg why "$WHY" --arg at "$(date -u +%FT%TZ)" \
  --argjson used "$USED" --argjson limit "$OUTBOUND_LIMIT" --argjson proj "$PROJ" \
  --argjson disk "${DISK:-0}" --arg vox_gb "${VOXGB:-0}" --arg ocpus "${OCPUS:-?}" --arg mem_gb "${MEMGB:-?}" \
  --argjson size_ok "$SIZE_OK" --arg mem "$MEM" --arg load "$(cut -d' ' -f1-3 /proc/loadavg)" \
  '{at:$at, level:$level, reason:$why, outbound:{used:$used, limit:$limit, on_pace_percent:($proj/10)},
    disk_percent:$disk, vox_data_gb:($vox_gb|tonumber), size:{ocpus:$ocpus, memory_gb:$mem_gb, free:$size_ok},
    memory_mb:$mem, load:$load}' > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
chmod 644 "$OUT"
# Vox reads its own folder only: the level tells it what to pause.
[ -d /opt/flg-puzzles/vox ] && cp "$OUT" /opt/flg-puzzles/vox/usage.json
USAGE
chmod 700 /opt/flg/usage.sh
cat > /etc/systemd/system/flg-usage.service <<'UNIT'
[Unit]
Description=FLG free-tier guard
After=docker.service
[Service]
Type=oneshot
Nice=10
ExecStart=/bin/bash /opt/flg/usage.sh
UNIT
cat > /etc/systemd/system/flg-usage.timer <<'UNIT'
[Unit]
Description=FLG free-tier guard every 15 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now flg-usage.timer

step "Cloudflare Tunnel"
if [ -n "$TUNNEL_TOKEN" ]; then echo "TUNNEL_TOKEN=$TUNNEL_TOKEN" > /opt/flg/tunnel.env; chmod 600 /opt/flg/tunnel.env; fi
if [ -s /opt/flg/tunnel.env ]; then
  docker rm -f flg-tunnel 2>/dev/null || true
  # Workers VPC needs the QUIC protocol (outbound UDP 7844, open by default).
  docker run -d --name flg-tunnel --restart always --network flg --env-file /opt/flg/tunnel.env \
    cloudflare/cloudflared:latest tunnel --no-autoupdate --protocol quic run
  tunnel="started"
else
  tunnel="not set up yet (no TUNNEL_TOKEN)"
fi

step "Summary"
sleep 20
docker ps -a --format 'table {{.Names}}\t{{.Status}}'
echo
echo "Build runners: $registered of $RUNNERS set up. They should show as Idle at $REPO_URL/settings/actions/runners within a few minutes."
echo "If one is missing:  sudo docker logs --tail 20 flg-runner-1"
echo "Cloudflare Tunnel: $tunnel."
echo "Puzzle server key for the Cloudflare secret PUZZLE_KEY:  sudo cat /opt/flg/puzzle.env"
echo "=== FLG setup finished $(date -u +%FT%TZ) ==="
