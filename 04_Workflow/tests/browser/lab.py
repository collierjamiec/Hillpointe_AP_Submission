"""Start the servers the browser suites run against. Everything is copied into a temp folder first, so the real
register, runs, accounts and web data are never touched.

  python tests/browser/lab.py            # start and wait (Ctrl+C to stop)
  python tests/browser/run.py            # start the lab, run every suite, stop the lab

Ports (see lab.js): 8781 public site, 8782 real accounts, 8783 and 8784 for the updates suite, and 8785 with the
assessment package when HILLPOINTE_PACKAGE points at it.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
LAB = Path(os.environ.get("PENNY_LAB_DIR") or Path(tempfile.gettempdir()) / "penny-lab")
ADMIN_PASSWORD = "copper kettle morning"       # the suites sign in with this; it only exists in the temp lab
sys.path.insert(0, str(ROOT))
os.environ.setdefault("PENNY_NO_UPDATE_CHECK", "1")      # the lab never reaches out to GitHub


def static(folder, port):
    return subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", str(folder)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def service(name, package=None, state=False):
    from ap_workflow import webserver
    home = LAB / name
    shutil.copytree(ROOT / "web", home / "web")
    shutil.copytree(ROOT / "runs", home / "runs")
    if state:
        shutil.copytree(ROOT / "state", home / "state", ignore=shutil.ignore_patterns("users.json", "tokens.json", "outbox", "update_*", "batch_log.jsonl"))
    else:
        (home / "state").mkdir(parents=True)
    shutil.copy2(ROOT / "config" / "rules.json", home / "rules.json")
    return webserver.BatchService(home, package, home / "state", home / "runs", home / "web", home / "rules.json")


def serve(svc, port):
    import http.server
    from ap_workflow import webserver
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), webserver.make_handler(svc, svc.web_dir))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    from ap_workflow import version
    if LAB.exists():
        shutil.rmtree(LAB)
    LAB.mkdir(parents=True)
    shutil.copytree(ROOT / "web", LAB / "site")
    shutil.copytree(ROOT / "web", LAB / "updates-site")
    procs = [static(LAB / "site", 8781), static(LAB / "updates-site", 8783)]

    accounts = service("accounts")
    user, token, _ = accounts.accounts.invite(None, "sam@hillpointe.com", "Sam Rivera", "admin", "AP manager", bootstrap=True)
    accounts.accounts.use_token(token, ADMIN_PASSWORD)
    serve(accounts, 8782)
    mine = version.current()
    local = json.loads((ROOT / "releases.json").read_text())["releases"]

    # A copy of Penny that already "knows" the next version is required (the cached answer of an update check).
    behind = service("updates-local")
    major, minor, _ = version.parse(mine)
    required = {"version": f"{major}.{minor + 1}.0", "date": "2099-01-01", "required": True, "summary": "Fixes how tax is split across lines.", "notes": ["Tax splits round to the cent."]}
    answer = {**version.status(mine, [required] + local), "checked": "now", "note": ""}
    behind.update_info = lambda force=False: answer       # a fixed answer, so the suite never depends on the network
    serve(behind, 8784)

    package = os.environ.get("HILLPOINTE_PACKAGE")
    if package and Path(package).is_dir():
        serve(service("full", Path(package), state=True), 8785)
    print("Penny lab ready in", LAB, "(with the assessment package)" if package else "(no assessment package: engine suite skipped)", flush=True)
    import signal
    signal.signal(signal.SIGTERM, lambda *a: (_ for _ in ()).throw(KeyboardInterrupt()))   # run.py stops the lab this way
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs:
            p.terminate()


if __name__ == "__main__":
    main()
