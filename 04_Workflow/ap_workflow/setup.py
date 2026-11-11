"""The setup wizard: a few screens in the browser that get Penny ready on a computer. (Added after submission, v2.1.)

  Double-click "Install Penny" (or run ./penny install, then ./penny setup).

What the wizard does, one screen each
  1. Checks this computer: Python, the libraries, the folder Penny saves to, the database, the web data.
  2. Finds the invoice package (the folder with the reference data Penny reads invoices against), or lets the
     person skip it and look around with the example data.
  3. Asks who will use Penny. "Just me" keeps the demo accounts. "My team" creates the first Admin with a real
     password, which turns on sign-in for everyone.
  4. Settings: the company time zone, the watched folder, and for a team whether to open Penny to the network
     with https (making a certificate if there is none).
  5. Saves the choices to state/setup.json. From then on ./penny start (or the "Start Penny" file) starts Penny
     the way the wizard was told to.

Safety
  The wizard can create an Admin, so it is closed unless Penny was started with ./penny setup. That command makes a
  one-time key and opens the browser with it; every wizard request must carry the key. The wizard only ever listens
  on this computer. It never shows or stores a password as text, and it refuses to create a first Admin when people
  already exist.
"""
import importlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

FILE = "setup.json"
DEFAULT = {"package": "", "mode": "solo", "host": "127.0.0.1", "https": False, "watch": False, "port": 8765}
HOST_RE = re.compile(r"^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,62})(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}))*$")


class SetupError(Exception):
    """Something the wizard cannot do, said in plain words."""


def load(state_dir):
    """The choices the wizard saved, with defaults for anything missing."""
    try:
        saved = json.loads((Path(state_dir) / FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        saved = {}
    return {**DEFAULT, **{k: saved[k] for k in DEFAULT if k in saved}, "done": saved.get("done", "")}


def save(state_dir, choices):
    """Check the wizard's choices and write state/setup.json in one step. Returns what was saved."""
    out = dict(DEFAULT)
    out["package"] = str(choices.get("package") or "")
    out["mode"] = "team" if choices.get("mode") == "team" else "solo"
    out["https"] = bool(choices.get("https")) and out["mode"] == "team"
    out["host"] = "0.0.0.0" if out["https"] else "127.0.0.1"          # the network only ever with https
    out["watch"] = bool(choices.get("watch"))
    port = choices.get("port", DEFAULT["port"])
    out["port"] = port if isinstance(port, int) and not isinstance(port, bool) and 1024 <= port <= 65535 else DEFAULT["port"]
    out["done"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    path = Path(state_dir) / FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(FILE + ".tmp")
    tmp.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return out


# ------------------------------------------------------------------ step 1: this computer
def system_check(root, state_dir, web_dir):
    """What the first screen shows: each thing Penny needs, whether it is there, and what to do if it is not.
    `need` is True for things Penny cannot work without."""
    rows = []

    def add(name, ok, detail, need=True, fix=""):
        """Add one line to the check: what was looked at, whether it is fine, and how to fix it if not."""
        rows.append({"name": name, "ok": bool(ok), "detail": detail, "need": need, "fix": "" if ok else fix})
    v = sys.version_info
    add("Python", v >= (3, 9), f"Version {v.major}.{v.minor}.{v.micro}", fix="Penny needs Python 3.9 or newer. Get it at python.org/downloads, then run the installer again.")
    for lib, why, need in (("pdfplumber", "reads invoice PDFs", True), ("openpyxl", "writes the review workbook", True), ("reportlab", "only used by Penny's own tests", False)):
        try:
            mod = importlib.import_module(lib)
            add(lib, True, f"Version {getattr(mod, '__version__', None) or getattr(mod, 'Version', '') or 'installed'}: {why}", need)
        except Exception:
            add(lib, False, f"Not installed: {why}", need, "Run the installer again (./penny install). It needs an internet connection.")
    try:
        Path(state_dir).mkdir(parents=True, exist_ok=True)
        probe = Path(state_dir) / ".write-test"
        probe.write_text("ok")
        probe.unlink()
        add("A place to save", True, "Penny can write to its state folder")
    except OSError as e:
        add("A place to save", False, f"Penny cannot write to its state folder ({type(e).__name__})", fix="Move the Penny folder somewhere you can save files, such as Documents.")
    try:
        from .store import Store
        Store(state_dir).last()
        add("Database", True, "state/penny.db opens")
    except Exception as e:
        add("Database", False, f"The database did not open ({type(e).__name__})", fix="Check that nothing else has state/penny.db open, then check again.")
    data = Path(web_dir) / "data" / "penny-data.json"
    add("Example data", data.exists(), "The example runs and invoices are here" if data.exists() else "The web data file is missing", fix="Run ./penny web-export, then check again.")
    add("https tools", bool(shutil.which("openssl")), "openssl is here, so Penny can make a certificate" if shutil.which("openssl") else "openssl is not installed",
        need=False, fix="Only needed to open Penny to a network. Your IT team can also give you a certificate.")
    from .version import current
    return {"rows": rows, "ready": all(r["ok"] for r in rows if r["need"]), "version": current(), "folder": str(root)}


# ------------------------------------------------------------------ step 2: the invoice package
def package_candidates(root):
    """Folders that look like the invoice package, in the places people usually put it."""
    home = Path.home()
    spots = [os.environ.get("HILLPOINTE_PACKAGE"), root / "Hillpointe_AP_Technical_Screen", root.parent / "Hillpointe_AP_Technical_Screen",
             root.parent.parent / "Hillpointe_AP_Technical_Screen", home / "Downloads" / "Hillpointe_AP_Technical_Screen",
             home / "Documents" / "Hillpointe_AP_Technical_Screen", home / "Desktop" / "Hillpointe_AP_Technical_Screen"]
    seen, out = set(), []
    for s in spots:
        if s and (Path(s) / "02_Reference_Data").is_dir() and str(Path(s).resolve()) not in seen:
            seen.add(str(Path(s).resolve()))
            out.append(str(Path(s).resolve()))
    return out


def check_package(path):
    """Look at a folder someone typed and say whether it is the invoice package. Never raises."""
    text = str(path or "").strip().strip('"').strip("'")
    if not text:
        return {"ok": False, "problem": "Type or paste the folder's path first."}
    p = Path(text).expanduser()
    if not p.exists():
        return {"ok": False, "problem": "There is no folder at that path. Check the spelling, or drag the folder onto a Terminal window to see its full path."}
    if not p.is_dir():
        return {"ok": False, "problem": "That is a file. Choose the folder that holds it."}
    ref = p / "02_Reference_Data"
    if not ref.is_dir():
        inside = next((c for c in p.iterdir() if c.is_dir() and (c / "02_Reference_Data").is_dir()), None) if os.access(p, os.R_OK) else None
        if inside:
            return check_package(inside)
        return {"ok": False, "problem": "That folder has no 02_Reference_Data folder inside it, so it is not the invoice package."}
    files = sorted(f.name for f in ref.iterdir() if f.is_file() and not f.name.startswith("."))
    batches = sorted(d.name for d in p.iterdir() if d.is_dir() and any(f.suffix.lower() == ".pdf" for f in d.iterdir() if f.is_file()))
    pdfs = sum(1 for d in batches for f in (p / d).iterdir() if f.suffix.lower() == ".pdf")
    return {"ok": True, "path": str(p.resolve()), "reference_files": files, "batches": batches, "pdfs": pdfs}


# ------------------------------------------------------------------ step 3: who will use Penny
def first_admin(service, name, email, password):
    """Create the first Admin with a password, which turns on real sign-in. Refused once anyone exists."""
    from .accounts import AccountError, password_problem
    if service.accounts.enabled():
        raise SetupError("People are already set up in this Penny. Sign in as an Admin and use the Users page to add more.")
    name, email = str(name or "").strip(), str(email or "").strip()
    if len(name) < 2:
        raise SetupError("Type your name.")
    problem = password_problem(password, email, name)
    if problem:
        raise SetupError(problem)
    try:
        user, token, _ = service.accounts.invite(None, email, name, "admin", "", bootstrap=True)
    except AccountError as e:
        raise SetupError(str(e))
    try:
        done = service.accounts.use_token(token, password)
    except AccountError as e:                                # should not happen after password_problem, but never leave a half-made Admin unexplained
        raise SetupError(f"The account was created but the password was not accepted: {e} Use ./penny users invite to send a new link.")
    service.log({"event": "setup.first_admin", "by": {"id": done["id"], "name": done["name"], "role": "admin"}, "user_id": done["id"]})
    return done


# ------------------------------------------------------------------ step 4: settings
def set_time_zone(service, zone):
    """Save the company time zone to the rules, if it is a real zone and different from what is there."""
    from zoneinfo import ZoneInfo
    try:
        ZoneInfo(str(zone))
    except Exception:
        raise SetupError("That is not a time zone Penny knows.")
    from . import actions
    with service.store.lock:
        rules = json.loads(Path(service.cfg_path).read_text(encoding="utf-8"))
        if (rules.get("display") or {}).get("time_zone") == zone:
            return False
        rules.setdefault("display", {})["time_zone"] = zone
        actions.write_rules(service.cfg_path, rules, service.state_dir, f"before-setup-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}")
    service.log({"event": "setup.time_zone", "by": {"id": "setup", "name": "Setup wizard", "role": "admin"}, "time_zone": zone})
    return True


def certificate_status(state_dir):
    """Whether Penny has a certificate for https, and until when it is good."""
    cert, key = Path(state_dir) / "tls" / "cert.pem", Path(state_dir) / "tls" / "key.pem"
    if not (cert.exists() and key.exists()):
        return {"exists": False}
    until = ""
    try:
        r = subprocess.run(["openssl", "x509", "-in", str(cert), "-noout", "-enddate", "-subject"], capture_output=True, text=True, timeout=10)
        until = next((line.split("=", 1)[1] for line in r.stdout.splitlines() if line.startswith("notAfter=")), "")
    except (OSError, subprocess.SubprocessError):
        pass
    return {"exists": True, "until": until}


def make_certificate(state_dir, hosts):
    """Make a self-signed certificate for https in state/tls/, using openssl. Returns (certificate, key) paths.
    Browsers warn about a self-signed certificate the first time; one from an IT team avoids that."""
    hosts = [h for h in dict.fromkeys(str(h).strip() for h in (hosts or []) if str(h).strip())] or ["localhost"]
    for h in hosts:
        if not (HOST_RE.match(h) or re.fullmatch(r"[0-9a-fA-F:.]{3,45}", h)):
            raise SetupError(f"“{h}” is not a computer name Penny can put on a certificate. Use letters, numbers, dashes and dots.")
    tls = Path(state_dir) / "tls"
    tls.mkdir(parents=True, exist_ok=True)
    alt = ",".join(("IP:" if h.replace(".", "").isdigit() or ":" in h else "DNS:") + h for h in dict.fromkeys(hosts + ["localhost", "127.0.0.1"]))
    cmd = ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "365", "-keyout", str(tls / "key.pem"), "-out", str(tls / "cert.pem"),
           "-subj", f"/CN={hosts[0]}", "-addext", f"subjectAltName={alt}"]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=60)
    except FileNotFoundError:
        raise SetupError("openssl is not installed, so Penny cannot make a certificate. Ask your IT team for one, then start Penny with --cert and --key.")
    except subprocess.CalledProcessError as e:
        raise SetupError("openssl could not make the certificate: " + e.stderr.decode("utf-8", "replace")[-300:])
    except subprocess.TimeoutExpired:
        raise SetupError("Making the certificate took too long. Try again.")
    os.chmod(tls / "key.pem", 0o600)
    return tls / "cert.pem", tls / "key.pem"


# ------------------------------------------------------------------ the wizard's view of everything, and the finish
def state(service, root):
    """Everything the wizard needs to draw itself."""
    from . import mailer
    rules = json.loads(Path(service.cfg_path).read_text(encoding="utf-8"))
    people = service.accounts.list()
    return {"check": system_check(root, service.state_dir, service.web_dir), "choices": load(service.state_dir),
            "candidates": package_candidates(Path(root)), "people": len(people), "admins": [u["name"] for u in people if u["role"] == "admin"],
            "email": mailer.describe(), "time_zone": (rules.get("display") or {}).get("time_zone") or "America/New_York",
            "certificate": certificate_status(service.state_dir), "computer": socket.gethostname(), "openssl": bool(shutil.which("openssl"))}


def finish(service, choices):
    """Save the wizard's choices. Refuses a network without real accounts or without a certificate, the same two
    rules ./penny web enforces. Returns the saved choices and the line to start Penny with."""
    want_https = bool(choices.get("https")) and choices.get("mode") == "team"
    if choices.get("mode") == "team" and not service.accounts.enabled():
        raise SetupError("Create the first Admin before finishing, so your team has someone who can invite the others.")
    if want_https and not certificate_status(service.state_dir)["exists"]:
        raise SetupError("Make a certificate first, so the connection to your team is encrypted.")
    package = ""
    if choices.get("package"):
        found = check_package(choices["package"])
        if not found["ok"]:
            raise SetupError(found["problem"])
        package = found["path"]
        service.package = Path(package)                       # the engine is ready straight away, with no restart
    if choices.get("time_zone"):
        set_time_zone(service, choices["time_zone"])
    saved = save(service.state_dir, {**choices, "package": package, "https": want_https})
    service.log({"event": "setup.finished", "by": {"id": "setup", "name": "Setup wizard", "role": "admin"},
                 "mode": saved["mode"], "engine": bool(package), "network": saved["https"], "watch": saved["watch"]})
    return {"choices": saved, "restart": saved["https"] or saved["watch"], "start": "./penny start"}
