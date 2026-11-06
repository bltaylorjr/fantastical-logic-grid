# Daily cleanup and repair on the Oracle server

Bobby asked on 2026-11-05 for everything on the server to stay well within
Oracle's free allowance (2 cores, 12 GB, 200 GB of storage), with a daily
cleanup and repair. `scripts/runner/oracle-cloud-init.sh` installs
`/opt/flg/maintenance.sh` (the same as `scripts/runner/flg-maintenance.sh`; CI
checks they match) and a timer that runs it every day at 3:30 a.m., before the
4 a.m. security-update reboot. Plain shell, no AI.

**Repair**
- Docker, the private network `flg`, the metadata block and swap: restarted or re-created if missing.
- Any `flg-` container that has stopped: started again.
- The puzzle server or Vox not answering (Vox only after its first 30 minutes): restarted.

**Cleanup**
- **Build runners** (skipped while one is running a job): old job folders, temporary files, npm caches and logs older than a week.
- **Docker:** unused image layers and build cache older than 3 days.
- **Releases:** puzzle server and Vox keep the newest three plus the live one and the one to roll back to.
- **Vox** (`python -m vox.autotrain --cleanup`), inside its storage budget (40 GB by default; set it on the Voice engine page): rendered lines older than two weeks, leftover model files, and the noisiest gathered clips first when over budget.
- **System:** the journal is kept to 14 days or 200 MB, the apt cache is cleared, old compressed logs are removed, and the setup and maintenance logs are trimmed past 20 MB.
- **If the disk is over 85% full:** unused images older than a week go too. Over 90%, it says so in the summary.

**Where to look**
- Log: `/var/log/flg-maintenance.log`. Summary: `/opt/flg-puzzles/maintenance.json`, also shown on the admin app's Voice engine page (Learning > Automatic training).
- Run it by hand: `sudo bash /opt/flg/maintenance.sh`.

**Staying inside the free size**

| Container | Cores | Memory cap | Notes |
| --- | --- | --- | --- |
| `flg-puzzles` | shares all (high priority) | 6 GB | serves the games |
| `flg-runner-1`, `-2` | shares all | 5 GB each | builds, mostly idle |
| `flg-vox` | **at most 1**, low priority | 5 GB | serves voices; trains only 1 to 6 a.m. when the server isn't busy |
| `flg-tunnel` | tiny | – | |

The caps add up to more than 12 GB because they're limits, not reservations,
and the jobs rarely overlap (builds by day, Vox training at night); 8 GB of swap
covers the rare overlap. Vox uses one core, so the puzzle server always has the other.
