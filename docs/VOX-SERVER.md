# Vox on the Oracle server

Bobby asked on 2026-11-05 to keep Vox, the voice engine, on the Oracle server
once it's running, so the admin app can use it on any device (Windows, Mac,
phone, any browser) with nothing to download. Until then, the Windows admin app
runs Vox on the computer (desktop-admin/README.md), and nothing changes.

```
admin dashboard (any device) ──HTTPS, signed in──▶ Worker flg-api ──Cloudflare Tunnel (Workers VPC)──▶ Oracle VM
  Voice engine page            /admin/v1/vox/v1/...   admins only, adds VOX_KEY         container flg-vox
                                                                                         172.30.0.11:5150
```

- **Private.** Vox listens only on the server's private `flg` network. The
  Worker reaches it through the same tunnel as the puzzle server, for signed-in
  admins only, and adds the key `VOX_KEY` (Vox's admin token) itself. The key
  never reaches a browser.
- **Whisper included.** The container installs `vox-engine/requirements.txt`
  (CPU PyTorch, faster-whisper and the rest) into `/opt/flg-vox/data/venv` and
  downloads Whisper's small model. It does this again only when the list changes.
- **Data stays put.** Voices, models, learning and the cache live in
  `/opt/flg-vox/data`; releases only replace the code.
- **Updates on their own.** `.github/workflows/vox-server.yml` deploys every
  change to `vox-engine/` on main: it copies the release next to the puzzle
  server's, switches `current`, and the container restarts on it within
  15 seconds. If the admin app can reach Vox but the new release doesn't answer
  within 10 minutes, the previous release is put back.
- **The page switches by itself.** When `GET /admin/v1/vox-server` says ready,
  the Voice engine page uses the server on every device. In the Windows app it
  stops the computer's own Vox, turns off starting it with the app, and offers
  "Use Vox on this computer instead" (and back).

| Part | Where |
| --- | --- |
| `vox-engine/deploy/run.sh` | What the container runs: install, Whisper, practice model, `vox serve`, restart on a new release |
| `scripts/runner/oracle-cloud-init.sh` (step "Vox voice engine") | Folders, the key in `/opt/flg/vox.env`, the small base image, the `flg-vox` container |
| `server/src/vox.js` | The Worker's pass-through (`/admin/v1/vox/...`), `vox-server` status, public `vox-health` (release only) |
| `.github/workflows/vox-server.yml` | Deploys and checks each release; off until `FLG_VOX_DEPLOY` is 1 |

## Turning it on (once the Oracle server is running)

Do this after the server is up and the puzzle-server steps in
`docs/owner-tasks/2026-11-01-oracle-runners-and-puzzle-server.md` are done
(the tunnel **flg-puzzles** must be healthy). About 15 minutes.

1. Connect to the server, as in those steps, and run the setup again so it adds Vox:
   `sudo bash /opt/flg/setup.sh`
   (Get the updated script first if the server was set up before this change:
   `curl -fsSL https://raw.githubusercontent.com/bltaylorjr/fantastical-logic-grid/main/scripts/runner/oracle-cloud-init.sh | sudo tee /opt/flg/setup.sh >/dev/null`.
   The repository is private, so if that fails, ask Claude for the file.)
2. In Cloudflare: **Workers & Pages** > **VPC** > **VPC Services** > **Create**.
   Name **flg-vox**, tunnel **flg-puzzles**, type **HTTP**, IPv4 address
   **172.30.0.11**, HTTP port **5150**. Save, and send Claude the **Service ID**
   (it isn't a secret). Claude adds it to `server/wrangler.toml`.
3. Vox's key: on the server run `sudo cat /opt/flg/vox.env` and copy everything
   after `VOX_KEY=`. In Cloudflare open the Worker **flg-api** > **Settings** >
   **Variables and Secrets** > **Add**: type **Secret**, name **VOX_KEY**, paste
   the key, **Deploy**.
4. In GitHub, add the repository variable **FLG_VOX_DEPLOY** with the value **1**
   (Settings > Secrets and variables > Actions > Variables). Then run
   **Actions** > **Deploy Vox to the server** > **Run workflow** once. The first
   start installs PyTorch and Whisper (about 10 minutes).
5. Open the admin dashboard's **Voice engine** page on any device. It says
   **Connected to Vox on the server**.

To bring your voices over from the Windows computer, copy the `voices` and
`learning` folders from the app's Vox data folder (Voice engine > More > Open
Vox's data folder) to `/opt/flg-vox/data` on the server. Claude can do this for you.

## Checking on it

- Container: `sudo docker logs --tail 40 flg-vox`
- From anywhere: `https://flg-api.btay74.workers.dev/admin/v1/vox-health`
  answers `{"ok":true,"release":"…"}`
- Memory: the container is capped at 6 GB, next to the puzzle server (6 GB)
  and the runners (5 GB each), with 8 GB of swap. Training a large model there
  is slow; for training, use a computer with a graphics card or Kaggle (Vox's README).
