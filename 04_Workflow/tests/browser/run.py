"""Run every browser suite against a fresh lab. Exit code 0 only if every suite passes.

  python tests/browser/run.py                     # all suites
  python tests/browser/run.py updates appearance  # only suites whose file name contains one of these words

Needs Node and Playwright (npm install in this folder, then npx playwright install chromium). The engine suite runs
only when HILLPOINTE_PACKAGE points at the assessment package.
"""
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def wait_for(port, seconds=40):
    end = time.time() + seconds
    while time.time() < end:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1).close()
            return True
        except Exception as e:
            if getattr(e, "code", None):          # an HTTP answer (even 401) means the server is up
                return True
            time.sleep(0.3)
    return False


def main(argv):
    has_package = bool(os.environ.get("HILLPOINTE_PACKAGE"))
    suites = sorted(p for p in HERE.glob("*.spec.js") if (has_package or p.name != "engine.spec.js") and (not argv or any(w in p.name for w in argv)))
    lab = subprocess.Popen([sys.executable, str(HERE / "lab.py")])
    failed = []
    try:
        ports = [8781, 8782, 8783, 8784] + ([8785] if has_package else [])
        if not all(wait_for(p) for p in ports):
            sys.exit("The lab servers did not start.")
        for suite in suites:
            print(f"\n=== {suite.name}", flush=True)
            started = time.time()
            r = subprocess.run(["node", suite.name], cwd=HERE, timeout=600)
            print(f"--- {suite.name}: {'passed' if r.returncode == 0 else 'FAILED'} in {time.time() - started:.0f}s", flush=True)
            if r.returncode != 0:
                failed.append(suite.name)
    finally:
        lab.terminate()
    print(f"\n{len(suites) - len(failed)} of {len(suites)} browser suites passed." + (f" Failed: {', '.join(failed)}" if failed else ""))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main(sys.argv[1:])
