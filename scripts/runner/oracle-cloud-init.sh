#!/bin/bash
# The Oracle Cloud server for The Fantastical Logic Grid (Always Free Ampere
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
REPO_URL="https://github.com/bltaylorjr/fantastical-logic-grid"
RUNNERS=3   # 4 Arm cores and 24 GB run three test jobs at once comfortably

exec > >(tee -a /var/log/flg-setup.log) 2>&1
echo "=== FLG setup $(date -u +%FT%TZ) ==="
step() { echo; echo "--- $*"; }
# Keep a copy of this script so it can be run again later (see the top).
mkdir -p /opt/flg && chmod 700 /opt/flg
if [ "$(readlink -f "$0")" != /opt/flg/setup.sh ] && [ -f "$0" ]; then cp "$0" /opt/flg/setup.sh; chmod 700 /opt/flg/setup.sh; fi

step "System packages, Docker, automatic security updates, swap"
export DEBIAN_FRONTEND=noninteractive
command -v docker >/dev/null || { apt-get update; apt-get install -y docker.io; }
dpkg -s unattended-upgrades >/dev/null 2>&1 || apt-get install -y unattended-upgrades
systemctl enable --now docker
# Security updates install themselves (and reboot at 4 am UTC if needed).
echo 'Unattended-Upgrade::Automatic-Reboot "true"; Unattended-Upgrade::Automatic-Reboot-Time "04:00";' > /etc/apt/apt.conf.d/52flg-reboot
# Swap keeps a big build from running out of memory.
if [ ! -f /swapfile ]; then fallocate -l 8G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi
# A private network inside this server: the puzzle server sits at a fixed
# address (172.30.0.10) that only the tunnel container uses.
docker network inspect flg >/dev/null 2>&1 || docker network create --subnet 172.30.0.0/24 flg

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
if [ ! -s /opt/flg/puzzle.env ]; then echo "FLG_PUZZLE_KEY=$(openssl rand -hex 32)" > /opt/flg/puzzle.env; fi
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
