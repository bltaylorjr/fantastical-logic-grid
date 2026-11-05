"""Run Vox in the background with no command window, from a desktop shortcut.

    pythonw -m vox.background          start Vox (trained model if there is one,
                                       else practice.pt) and open the admin app
    pythonw -m vox.background --stop  stop it
    python -m vox.background --shortcuts   put Vox and Stop Vox on the desktop

pythonw is Python's own launcher for programs without a window, so no script
host or hidden command window is involved (antivirus programs rightly distrust
those). Everything Vox prints goes to vox-log.txt in the Vox folder, and its
process id to learning/vox.pid so --stop (and the admin app) can end it.
"""
from __future__ import annotations

import os
import signal
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

ADMIN_URL = "https://flg-api.btay74.workers.dev/admin/#voice-engine"
PORT = 5150
ROOT = Path(__file__).resolve().parent.parent
PID = ROOT / "learning" / "vox.pid"


def _up() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=0.5):
            return True
    except OSError:
        return False


def _open_admin_when_ready():
    for _ in range(360):                       # up to 3 minutes for a first start
        if _up():
            webbrowser.open(ADMIN_URL)
            return
        time.sleep(0.5)


def start() -> None:
    os.chdir(ROOT)
    if _up():                                  # already running: just open the page
        webbrowser.open(ADMIN_URL)
        return
    log = open(ROOT / "vox-log.txt", "w", buffering=1, encoding="utf-8", errors="replace")
    sys.stdout = sys.stderr = log              # pythonw has no console to print to
    PID.parent.mkdir(parents=True, exist_ok=True)
    PID.write_text(str(os.getpid()))
    model = "runs/v1/vox.pt" if (ROOT / "runs" / "v1" / "vox.pt").exists() else "practice.pt"
    if not (ROOT / model).exists():
        from .cli import main
        main(["init", "--preset", "tiny", "--out", "practice.pt"])
    threading.Thread(target=_open_admin_when_ready, daemon=True).start()
    try:
        from .cli import main
        main(["serve", "--ckpt", model])
    finally:
        try:
            PID.unlink()
        except OSError:
            pass


def stop() -> bool:
    try:
        pid = int(PID.read_text().strip())
    except (OSError, ValueError):
        return False
    try:
        os.kill(pid, signal.SIGTERM)           # on Windows this ends the process
    except OSError:
        pass
    try:
        PID.unlink()
    except OSError:
        pass
    return True


def shortcuts() -> str:
    """Desktop shortcuts that run pythonw directly: double-click Vox to start
    it, Stop Vox to stop it."""
    import subprocess
    exe = Path(sys.executable)
    pyw = exe.with_name("pythonw.exe") if exe.with_name("pythonw.exe").exists() else exe
    q = lambda v: "'" + str(v).replace("'", "''") + "'"           # noqa: E731  PowerShell single quotes
    ps = (
        "$s = New-Object -ComObject WScript.Shell; $d = [Environment]::GetFolderPath('Desktop'); "
        "foreach ($x in @(@('Vox', '-m vox.background', 'Start Vox and open the Voice engine page', 'SndVol.exe,0'), "
        "@('Stop Vox', '-m vox.background --stop', 'Stop Vox', 'imageres.dll,100'))) { "
        "$l = $s.CreateShortcut((Join-Path $d ($x[0] + '.lnk'))); "
        f"$l.TargetPath = {q(pyw)}; $l.Arguments = $x[1]; $l.WorkingDirectory = {q(ROOT)}; "
        "$l.Description = $x[2]; $l.IconLocation = (Join-Path $env:SystemRoot ('System32\\' + $x[3])); $l.Save() }; "
        "Remove-Item -ErrorAction SilentlyContinue (Join-Path $d 'Start Vox.cmd')"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True)
    return str(pyw)


if __name__ == "__main__":
    if "--stop" in sys.argv:
        stop()
    elif "--shortcuts" in sys.argv:
        print("Shortcuts made for", shortcuts())
    else:
        start()
