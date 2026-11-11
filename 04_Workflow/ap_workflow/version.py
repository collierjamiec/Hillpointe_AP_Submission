"""Penny's version and updates. (Added after submission, v1.6.)

One source of truth
  04_Workflow/VERSION          the version this copy of Penny is, like 1.6.0 (major.minor.patch)
  04_Workflow/releases.json    every release, newest first: version, date, required, summary, notes
  The web app's footer, ./penny --version and every run record read these. A test fails if they disagree.

Required or optional
  When a release is marked required, it becomes the minimum version. A copy older than the minimum must update:
  real runs and changes (creating batches, uploading, saving manual entries) stop until it does, while reading
  results, help, previews and rechecks keep working, so nobody is locked out of their records. A copy that is only
  behind an optional release sees a notice and may skip that version until the next one.

Checking for updates (terminal and local web app)
  Penny downloads the public releases.json from GitHub at most once a day, with a short timeout, and remembers the
  answer in state/update_check.json. It sends nothing about the person. Set PENNY_NO_UPDATE_CHECK=1 to turn it off.
  If the check fails (offline), Penny says so and keeps working: it never blocks on a check it could not make.

Publishing a release
  ./penny release 1.7.0 --summary "..." [--note "..."]... [--required]
  ./penny require 2.3.0        (v2.3) mark a release that is already out as required
  updates VERSION, releases.json, the web app's copy, and the version inside the web app, all at once.
"""
import json
import os
import re
import time
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = ROOT / "VERSION"
RELEASES_FILE = ROOT / "releases.json"
WEB_RELEASES = ROOT / "web" / "data" / "releases.json"
WEB_APP = ROOT / "web" / "assets" / "penny-core.js"       # where APP_VERSION lives
REMOTE_URL = "https://raw.githubusercontent.com/collierjamiec/Hillpointe_AP_Submission/main/04_Workflow/releases.json"
CHECK_EVERY = 24 * 3600
VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
APP_VERSION_RE = re.compile(r'const APP_VERSION = "([^"]*)";')


class VersionError(ValueError):
    """A version or release file Penny cannot use, with a reason a person can fix."""


def parse(v):
    """'1.6.0' -> (1, 6, 0). Three whole numbers, nothing else."""
    m = VERSION_RE.match(str(v or "").strip())
    if not m:
        raise VersionError(f"“{v}” is not a version like 1.6.0 (three whole numbers).")
    return tuple(int(x) for x in m.groups())


def current(root=ROOT):
    """The version this copy of Penny is, from the VERSION file."""
    return (Path(root) / "VERSION").read_text(encoding="utf-8").strip()


def load_releases(path=RELEASES_FILE):
    """Every release in releases.json, newest first. Raises when the file has none or a bad version."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    rel = data.get("releases") if isinstance(data, dict) else None
    if not isinstance(rel, list) or not rel:
        raise VersionError("releases.json has no releases.")
    for r in rel:
        parse(r.get("version"))
    return sorted(rel, key=lambda r: parse(r["version"]), reverse=True)


def minimum(releases):
    """The newest required release: anything older must update."""
    req = [r["version"] for r in releases if r.get("required")]
    return max(req, key=parse) if req else None


def status(version, releases, skipped=None):
    """Where this copy stands against a list of releases.
    state: 'current', 'optional' (newer release, may skip), 'skipped' (the person chose to wait), 'required'."""
    mine = parse(version)
    newer = [r for r in releases if parse(r["version"]) > mine]
    latest = max((r["version"] for r in releases), key=parse)
    floor = minimum(releases)
    if floor and mine < parse(floor):
        state = "required"
    elif not newer:
        state = "current"
    elif skipped and parse(skipped) >= parse(latest):
        state = "skipped"
    else:
        state = "optional"
    return {"version": version, "latest": latest, "minimum": floor, "state": state,
            "newer": sorted(newer, key=lambda r: parse(r["version"]), reverse=True)}


# ------------------------------------------------------------------------------------------- the update check
def _read_json(path, default):
    """A JSON file's contents, or the default when it is missing or damaged."""
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def check(state_dir, root=ROOT, force=False, fetch=None, now=None):
    """Status against the newest published releases. Uses the cached answer when it is less than a day old.
    Never raises for a failed check: it falls back to the releases this copy already knows, and says so."""
    state_dir = Path(state_dir)
    now = now or time.time()
    mine = current(root)
    local = load_releases(Path(root) / "releases.json")
    skipped = _read_json(state_dir / "update_skip.json", {}).get("skip")
    if os.environ.get("PENNY_NO_UPDATE_CHECK") == "1":
        return {**status(mine, local, skipped), "checked": "off", "note": "Update checks are turned off (PENNY_NO_UPDATE_CHECK=1)."}
    cache = _read_json(state_dir / "update_check.json", {})
    remote, note, how = None, "", "now"
    if not force and cache.get("releases") and now - cache.get("at", 0) < CHECK_EVERY:
        remote, how = cache["releases"], "cache"
    else:
        try:
            body = (fetch or _fetch)(REMOTE_URL)
            remote = json.loads(body)["releases"]
            for r in remote:
                parse(r.get("version"))
            state_dir.mkdir(parents=True, exist_ok=True)
            (state_dir / "update_check.json").write_text(json.dumps({"at": now, "releases": remote}), encoding="utf-8")
        except Exception as e:                          # offline, blocked, or a bad file: keep working
            note = f"Could not check for updates ({type(e).__name__}). Penny keeps working with what it knows."
            remote, how = cache.get("releases"), "failed"
    known = {r["version"]: r for r in local}
    for r in remote or []:
        known.setdefault(r["version"], r)
        if r.get("required"):
            known[r["version"]] = {**known[r["version"]], "required": True}
    out = status(mine, list(known.values()), skipped)
    return {**out, "checked": how, "note": note}


def _fetch(url):
    """Download the published release list (at most 512 KB, 3 second timeout)."""
    req = urllib.request.Request(url, headers={"User-Agent": "penny-update-check"})
    with urllib.request.urlopen(req, timeout=3) as r:
        return r.read(512 * 1024).decode("utf-8")


def skip(state_dir, version):
    """Wait on an optional release. A required one cannot be skipped."""
    Path(state_dir).mkdir(parents=True, exist_ok=True)
    (Path(state_dir) / "update_skip.json").write_text(json.dumps({"skip": version}), encoding="utf-8")


def gate(info, action):
    """Raise UpdateRequired for a real run or a change while a required update is waiting."""
    if info and info.get("state") == "required":
        raise UpdateRequired(f"Penny {info['minimum']} is a required update, and this copy is {info['version']}. "
                             f"{action} is paused until you update. Reading results, help and previews still work. "
                             "To update:  ./penny update")


class UpdateRequired(RuntimeError):
    """Raised when a real run or a change is asked for while a required update is waiting."""


# ------------------------------------------------------------------------------------------- publishing a release
def release(version, summary, notes=(), required=False, root=ROOT, today=None):
    """Write a new release everywhere at once. Refuses a version that is not newer than the current one."""
    root = Path(root)
    new = parse(version)
    old = current(root)
    if new <= parse(old):
        raise VersionError(f"{version} is not newer than the current version {old}.")
    summary = re.sub(r"\s+", " ", str(summary or "")).strip()
    if len(summary) < 10:
        raise VersionError("Give the release a one-sentence summary (at least 10 characters).")
    path = root / "releases.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    entry = {"version": version, "date": (today or date.today()).isoformat(), "required": bool(required),
             "summary": summary, "notes": [re.sub(r"\s+", " ", n).strip() for n in notes if n.strip()]}
    data["releases"] = [entry] + data["releases"]
    text = json.dumps(data, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")
    (root / "web" / "data").mkdir(parents=True, exist_ok=True)
    (root / "web" / "data" / "releases.json").write_text(text, encoding="utf-8")
    (root / "VERSION").write_text(version + "\n", encoding="utf-8")
    app = root / "web" / "assets" / "penny-core.js"
    if app.exists():
        js = app.read_text(encoding="utf-8")
        if not APP_VERSION_RE.search(js):
            raise VersionError("Could not find APP_VERSION in the web app.")
        app.write_text(APP_VERSION_RE.sub(f'const APP_VERSION = "{version}";', js, count=1), encoding="utf-8")
    return entry


def require(version, root=ROOT):
    """(v2.3) Mark a release that is already out as required, in both release lists. Older copies must then update
    before real runs or changes, even if they chose to wait on it while it was optional. Refuses a version that was
    never released. Returns the entry, with "already" set when nothing had to change."""
    root = Path(root)
    parse(version)
    path = root / "releases.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    entry = next((r for r in data["releases"] if r["version"] == version), None)
    if not entry:
        raise VersionError(f"{version} is not a released version, so it cannot be made required.")
    already = bool(entry.get("required"))
    entry["required"] = True
    text = json.dumps(data, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")
    (root / "web" / "data").mkdir(parents=True, exist_ok=True)
    (root / "web" / "data" / "releases.json").write_text(text, encoding="utf-8")
    return {**entry, "already": already}


def consistency(root=ROOT):
    """Every place the version lives, so a test can prove they agree."""
    root = Path(root)
    js = (root / "web" / "assets" / "penny-core.js").read_text(encoding="utf-8")
    m = APP_VERSION_RE.search(js)
    return {"VERSION": current(root), "releases.json": load_releases(root / "releases.json")[0]["version"],
            "web releases.json": load_releases(root / "web" / "data" / "releases.json")[0]["version"],
            "web app": m.group(1) if m else None}
