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

## Free-tier guard (every 15 minutes)

`/opt/flg/usage.sh` (the copy in this repo is `scripts/runner/flg-usage.sh`;
setup writes it, and CI checks the two match) watches the three things that
could cost money on Oracle's Always Free tier, across the calendar month:

| What | Free amount | How it's measured |
| --- | --- | --- |
| Outbound data | 10 TB a month | the network card's sent bytes, added up per day, projected to month end |
| Disk | 200 GB of block storage | how full `/` is |
| Server size | 2 cores and 12 GB, running all month | the instance's own metadata |

Using the processor harder doesn't cost anything (Oracle bills a shape by the
hour, not by how busy it is), so the guard never slows the games, voice serving,
the tunnel or builds. It only slows Vox's non-essential work:

| Level | When | What Vox does |
| --- | --- | --- |
| 0 Normal | everything under the levels below | everything, on 1 core |
| 1 Careful | outbound on pace for 70%, disk 75%, or a bigger-than-free size | gathers for half as long with twice the pauses |
| 2 Throttled | outbound on pace for 85%, or disk 85% | no downloads or word crawl; trains on what it has; 0.5 core |
| 3 Essential only | outbound on pace for 95% or 90% already used, or disk 92% | serves voices only; no gathering, training or accuracy checks; 0.25 core |

Everything resumes by itself when the level drops (a new month resets the
outbound count). If the guard stops reporting for 3 hours, Vox treats it as
level 1.

It writes `/opt/flg-puzzles/usage.json` (copied into Vox's folder, which is how
Vox reads it) and logs each level change to `/var/log/flg-usage.log`. The
admin dashboard shows it on **Voice engine → Learning → Automatic training**,
and **Alerts** (with push and email, if you set them up) warns at level 2 or
higher and whenever the server is bigger than the free size.

Run it by hand: `sudo /opt/flg/usage.sh && cat /opt/flg-puzzles/usage.json`.
