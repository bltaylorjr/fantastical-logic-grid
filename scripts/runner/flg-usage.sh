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
