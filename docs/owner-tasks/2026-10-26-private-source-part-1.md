# Make the source private, part 1: public site repo, token and free build server

You chose to make the game's source code private, with a public site-only
repository for the website and Windows downloads and a free Oracle build
server. These are the steps only you can do. Nothing goes private yet. When
you have finished, say "part 1 done" in the project thread. I will test
everything, then send part 2. Full plan: docs/PRIVATE-REPO.md in the repo.

Do steps 3 and 4 within the same hour, because the runner token in step 3
expires after one hour.

## 1. Create the public site repository (2 minutes, free)

1. Open https://github.com/new
2. Repository name: **thelogicgrid** (exactly this; the Windows app looks for it).
3. Description: The Fantastical Logic Grid website and Windows downloads.
4. Choose **Public**, and tick **Add a README file**.
5. Click **Create repository**.

## 2. Create the token that lets the build publish there (3 minutes, free)

1. Open https://github.com/settings/personal-access-tokens/new
2. Token name: **thelogicgrid publish**. Expiration: the longest offered (put a
   calendar reminder to renew it a week before).
3. Repository access: **Only select repositories** > **bltaylorjr/thelogicgrid**.
4. Permissions > Repository permissions > **Contents: Read and write**. Leave
   everything else as it is.
5. Click **Generate token** and copy it. Don't paste it anywhere except step 6.
6. Open https://github.com/bltaylorjr/fantastical-logic-grid/settings/secrets/actions
   and click **New repository secret**. Name: **SITE_REPO_TOKEN**. Secret: paste
   the token. Click **Add secret**.

## 3. Lock outside pull requests, then get a runner token (2 minutes, free)

While the repository is still public, a stranger's pull request must never run
on your build server without your approval.

1. Open https://github.com/bltaylorjr/fantastical-logic-grid/settings/actions
   and under **Approval for running fork pull request workflows from contributors**
   choose **Require approval for all external contributors**. Click **Save**.
2. Open https://github.com/bltaylorjr/fantastical-logic-grid/settings/actions/runners/new
3. Choose **Linux** and architecture **ARM64**.
4. Under "Configure", find the line with `--token`. Copy only the long code
   after `--token` (it starts with A). Keep this page open.

## 4. Create the free Oracle build server (about 20 minutes)

COSTS: the Always Free tier is free, but Oracle asks for a card to verify who
you are. Choose only resources marked **Always Free-eligible** below, and you
won't be charged.

1. Sign up at https://www.oracle.com/cloud/free/ and pick a home region near
   you (US East, Ashburn is fine). The home region can't be changed later.
2. Once signed in, open the menu > **Compute** > **Instances** > **Create instance**.
3. Name: **flg-build**.
4. Image and shape > **Edit** > Image: **Canonical Ubuntu 24.04**. Shape: **Change
   shape** > **Ampere** > **VM.Standard.A1.Flex**, **4 OCPUs** and **24 GB** memory
   (marked Always Free-eligible).
5. Networking: keep the defaults (a new public subnet).
6. Add SSH keys: choose **Generate a key pair for me** and click **Save private
   key** (keep the file somewhere safe; you won't need it day to day).
7. Boot volume: tick **Specify a custom boot volume size**, enter **100** GB
   (Always Free includes up to 200 GB).
8. Click **Show advanced options** > **Management** > **Paste cloud-init script**.
   Open https://github.com/bltaylorjr/fantastical-logic-grid/blob/main/scripts/runner/oracle-cloud-init.sh,
   click the copy button, and paste it into the box. Then, in the box, replace
   **PASTE_RUNNER_TOKEN_HERE** with the code from step 3 (keep the quote marks).
9. Click **Create**. If Oracle says **"Out of capacity"**, try again later or
   choose another availability domain. Free Arm servers are popular.
10. About 15 minutes after the server starts, refresh the runner page from step 3:
    https://github.com/bltaylorjr/fantastical-logic-grid/settings/actions/runners
    should list **oracle-1**, **oracle-2** and **oracle-3** as **Idle**.

## 5. Tell me

Say "part 1 done" in the project thread, even if something went wrong (tell me
which step). Don't change the repository to private yet. Doing that before the
website and updates have moved would take the site offline.
