# Fix the Oracle build runners, then connect the private puzzle server

Your Oracle server exists, but no runners showed up on GitHub. The most likely
reason: the runner token lasts only one hour, and the server spends its first
15 to 30 minutes building before it uses the token (longer if the first try
failed and the same token was pasted again). The setup script has been updated
so it can simply be run again with a fresh token, and it now also sets up the
private puzzle server, so the puzzle maker no longer has to be sent to
players' browsers. Full plan: docs/PUZZLE-SERVER.md.

Everything here is free (Oracle Always Free and Cloudflare's free plan).

Do part A in one sitting: the token from A1 must be used within an hour.

## A. Fix the build runners (about 30 minutes, mostly waiting)

1. Get a fresh runner token: open
   https://github.com/bltaylorjr/fantastical-logic-grid/settings/actions/runners/new,
   choose **Linux** and **ARM64**, and copy the long code after `--token`
   (it starts with A).
2. Find the server's address: Oracle Cloud > menu > **Compute** > **Instances** >
   **flg-build**. Copy the **Public IP address**.
3. Open **PowerShell** on your computer. Find the private key file you saved
   when you created the server (its name starts with `ssh-key-` and ends in
   `.key`). If Windows later says the key is "unprotected", run this once,
   with your file's real path:
   `icacls "C:\Users\btay7\Downloads\ssh-key-XXXX.key" /inheritance:r /grant:r "$($env:USERNAME):R"`
4. Connect (use your key path and the IP from step 2):
   `ssh -i "C:\Users\btay7\Downloads\ssh-key-XXXX.key" ubuntu@PUBLIC_IP`
   Type **yes** if it asks about the fingerprint.
5. See what went wrong the first time (so it can be fixed for good), and
   copy the last lines for me if anything looks like an error:
   `sudo tail -n 25 /var/log/cloud-init-output.log`
6. Download the updated script and run it, pasting your token from step 1
   in place of `PASTE_TOKEN`:
   `curl -fsSL https://raw.githubusercontent.com/bltaylorjr/fantastical-logic-grid/private-puzzle-server/scripts/runner/oracle-cloud-init.sh -o setup.sh && sudo RUNNER_TOKEN=PASTE_TOKEN bash setup.sh`
   It prints its progress and ends with a summary. A few minutes or up to 25 minutes.
7. Refresh https://github.com/bltaylorjr/fantastical-logic-grid/settings/actions/runners.
   **oracle-1**, **oracle-2** and **oracle-3** should say **Idle**. If not, run
   `sudo docker logs --tail 20 flg-runner-1` and send me what it says.

Keep the PowerShell window open for part B.

## B. Connect the puzzle server to the game (about 15 minutes)

1. Open https://dash.cloudflare.com > **Workers & Pages** > **VPC** (Workers VPC) >
   **Tunnels** > **Create**. Name: **flg-puzzles**. Click **Save tunnel**.
2. Choose **Docker** as the environment. Cloudflare shows a command with
   `--token` in it. Copy only the long code after `--token` (it starts with ey).
   Don't run Cloudflare's command; the next step does it.
3. In PowerShell (still connected to the server), with your code in place of `PASTE_TUNNEL_TOKEN`:
   `sudo TUNNEL_TOKEN=PASTE_TUNNEL_TOKEN bash /opt/flg/setup.sh`
   Back in Cloudflare, the tunnel should turn **Healthy** within a minute.
4. In Cloudflare: **VPC** > **VPC Services** > **Create**. Name **flg-puzzles**,
   tunnel **flg-puzzles**, type **HTTP**, IPv4 address **172.30.0.10**,
   HTTP port **8080**. Save, then copy the **Service ID**. It is not a secret; send it to me.
5. The puzzle server's key: in PowerShell run `sudo cat /opt/flg/puzzle.env`
   and copy everything after `FLG_PUZZLE_KEY=`. Don't paste it anywhere except step 6.
6. Open https://dash.cloudflare.com/?to=/:account/workers/services/view/flg-api/production/settings >
   **Variables and Secrets** > **Add**. Type **Secret**, name **PUZZLE_KEY**,
   value: paste the key. Click **Deploy**.
7. Open https://github.com/bltaylorjr/fantastical-logic-grid/settings/variables/actions
   and add the variable **FLG_PUZZLE_DEPLOY** with value **1**. (If **FLG_RUNNER** isn't
   there yet, add it too, with the value `["self-hosted","flg"]`.)
8. Type `exit` to close the connection.

## C. Tell me

Say "runners and puzzle server done" in the project thread with the Service ID
from B4 (and anything from A5 or A7 that looked wrong). I will then add the
connection to the Worker, check that puzzles come back from the server, and
send you a preview before the website stops shipping the generator. Nothing
changes for players until you approve that last step.
