# Check the Oracle build server (it stopped answering last night)

Since about 11:30 pm Eastern on Sunday, Nov 8, every GitHub job sent to the
Oracle build server has sat in the queue. The server looks offline.

**Nothing is stuck any more.** For now every job runs on GitHub's own
servers instead (free, because the repository is public): tests, publishing
the website, thank-you emails, videos and the weekly improvement. Only the
puzzle-server and voice-server deploys wait for Oracle. You don't need to
change any GitHub setting.

What needs your hands is the server itself. Claude can't sign in to Oracle.
This takes about 5 minutes. Oracle Always Free costs nothing; don't upgrade
anything.

1. Open https://github.com/bltaylorjr/fantastical-logic-grid/settings/actions/runners
   and look at the runners named `flg-...`. If they say **Idle**, the server is
   already back. Skip to step 5.
2. Sign in at https://cloud.oracle.com, then go to the menu > **Compute** >
   **Instances** > **flg-build**.
3. Look at its **State**:
   - **Stopped**: press **Start**.
   - **Running**: press **Reboot** (choose the normal reboot, not "force").
   - **Not listed / terminated**: stop here and reply to this email. Oracle
     sometimes takes back an Always Free server that stays almost idle for 7
     days. We'd then rebuild it with `scripts/runner/oracle-create-server.sh`.
4. Wait about 10 minutes, then refresh the runners page from step 1. The
   `flg-...` runners should say **Idle**.
5. Tell Claude in the project thread "Restore GitHub jobs while build server is
   down" what you saw (for example "it was stopped, I started it, runners are
   idle"). Claude will then move the jobs back to the Oracle server.
