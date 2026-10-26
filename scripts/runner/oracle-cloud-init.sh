#!/bin/bash
# Build server for The Fantastical Logic Grid on Oracle Cloud's Always Free
# tier (Ampere A1 Arm VM, Ubuntu 24.04). Paste this whole file into
# "Show advanced options > Management > Initialization script" when creating
# the VM (docs/PRIVATE-REPO.md). It installs Docker and starts several GitHub
# Actions runners, each in its own container so tests that use fixed ports
# never collide. Jobs reach them through the repository variable
#   FLG_RUNNER = ["self-hosted","flg"]
# Pull requests from forks always stay on GitHub's own machines.
#
# Before pasting, replace PASTE_RUNNER_TOKEN_HERE with the token GitHub shows
# under Settings > Actions > Runners > New self-hosted runner (Linux, ARM64,
# the line that says --token). The token works for one hour; once a runner has
# registered it no longer needs it.
set -euxo pipefail
RUNNER_TOKEN="PASTE_RUNNER_TOKEN_HERE"
REPO_URL="https://github.com/bltaylorjr/fantastical-logic-grid"
RUNNERS=3   # 4 Arm cores and 24 GB run three test jobs at once comfortably

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io unattended-upgrades
systemctl enable --now docker
# Security updates install themselves (and reboot at 4 am UTC if needed).
echo 'Unattended-Upgrade::Automatic-Reboot "true"; Unattended-Upgrade::Automatic-Reboot-Time "04:00";' > /etc/apt/apt.conf.d/52flg-reboot
# Swap keeps a big build from running out of memory.
if [ ! -f /swapfile ]; then fallocate -l 8G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi

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
  ./config.sh --unattended --url "$REPO_URL" --token "$RUNNER_TOKEN" --name "$RUNNER_NAME" --labels flg --replace
fi
exec ./run.sh
EOF
chmod +x start.sh
docker build -t flg-runner .
for i in $(seq 1 "$RUNNERS"); do
  docker rm -f "flg-runner-$i" 2>/dev/null || true
  docker run -d --name "flg-runner-$i" --restart always --shm-size 1g \
    -e REPO_URL="$REPO_URL" -e RUNNER_TOKEN="$RUNNER_TOKEN" -e RUNNER_NAME="oracle-$i" flg-runner
done
echo "FLG runners started: $(docker ps --format '{{.Names}}' | tr '\n' ' ')"
