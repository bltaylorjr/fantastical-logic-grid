"""Put the engine online through a free Cloudflare Tunnel: no open ports, no
fixed IP, automatic HTTPS. Needs the free `cloudflared` program
(https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

Two ways:
  * Quick tunnel (no setup):  vox serve --public --tunnel
      gives a random https://<words>.trycloudflare.com address that changes
      each time it starts. Good for trying it out.
  * Your own address:  vox serve --public --tunnel-name vox
      after a one-time setup that ties a name like voice.thelogicgrid.com to
      this computer (see README, "Put it online"). The address never changes.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import threading
import time

URL_RE = re.compile(r"https://[a-z0-9\-]+\.trycloudflare\.com")


def find_cloudflared() -> str:
    exe = shutil.which("cloudflared")
    if not exe:
        raise RuntimeError("cloudflared is not installed. Get it free from Cloudflare "
                           "(https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), "
                           "then run this again.")
    return exe


def start_quick_tunnel(port: int, timeout: float = 45.0, exe: str | None = None) -> tuple[subprocess.Popen, str]:
    """Start a quick tunnel to 127.0.0.1:port and return (process, public URL)."""
    proc = subprocess.Popen([exe or find_cloudflared(), "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    found: list[str] = []

    def read():
        for line in proc.stdout:
            m = URL_RE.search(line)
            if m and not found:
                found.append(m.group(0))
    threading.Thread(target=read, daemon=True).start()
    t0 = time.time()
    while not found and time.time() - t0 < timeout and proc.poll() is None:
        time.sleep(0.2)
    if not found:
        proc.terminate()
        raise RuntimeError("The tunnel didn't start (no address from cloudflared). Check your internet connection.")
    return proc, found[0]


def start_named_tunnel(name: str, port: int, exe: str | None = None) -> subprocess.Popen:
    """Run a tunnel you created once with `cloudflared tunnel create <name>`."""
    return subprocess.Popen([exe or find_cloudflared(), "tunnel", "--no-autoupdate", "run", "--url",
                             f"http://127.0.0.1:{port}", name])
