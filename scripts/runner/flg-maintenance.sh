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
