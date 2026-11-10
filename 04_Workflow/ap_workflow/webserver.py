"""Penny's local web server: the web view plus a small API to upload and run new invoice batches.

  ./penny web --package <package folder>

Why a local server: the public site is static, so it cannot run Penny's Python engine. On your own computer this
server can. It only listens on 127.0.0.1 (this computer), and it is the only part of the web app that changes files.

Batch folders
  inbox/<YYYY-MM-DD>_<short-name>/      for example inbox/2026-11-10_weekly-ap/
  Names are lowercase letters, numbers and dashes. If a name is taken that day, -2, -3 ... is added.

Permissions (from the signed-in demo account; a production server would authenticate the person itself)
  AP Clerk and Admin   create a batch, upload invoices, run a preview (dry run: the register is not changed),
                       recheck a held invoice, save a manual entry (v1.5)
  Admin only           run for real (the register is updated, so those bills can never be entered twice),
                       test draft rules against every saved run (v1.5)

Updates (added in v1.6, see version.py)
  When a required Penny version is out, creating batches, uploading, running for real and saving manual entries are
  refused with a reason until this copy is updated. Previews, rechecks and everything read-only keep working.
  /api/status carries the version and the update status, so the web app can show its banner.

Previews (added in v1.5, see replay.py)
  POST /api/recheck    decide one invoice again (same reading, a corrected PDF, or a manual entry) against a copy of
                       the register. Logged as recheck.preview. Nothing else is written.
  POST /api/simulate   replay every saved run under draft rules and under the current rules; list what differs.
  POST /api/manual     save a manual entry for the next run: inbox/<date>_manual-<file>/ holds the original file,
                       <file>.keyed.json and evidence/. Logged as manual.saved. A run uses the keyed record in place
                       of reading that PDF.

Audit
  Every step is appended to state/batch_log.jsonl and never rewritten: who created the batch, who uploaded which files
  (name, size, SHA-256), who ran it, when, the folder, the run ID, preview or real, the result counts and pre-flight.

Safety
  Files must be real PDFs (checked by content), at most 25 MB, with safe names inside the batch folder only.
  Write requests must carry the header X-Penny: 1, which other web pages cannot send, so a malicious page cannot
  upload or run anything through your browser.
"""
import base64
import hashlib
import http.server
import json
import re
import shutil
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

MAX_FILE = 25 * 1024 * 1024
MAX_EVIDENCE = 10 * 1024 * 1024
MAX_EVIDENCE_FILES = 5
ROLES_UPLOAD = {"clerk", "admin"}
ROLES_RUN_REAL = {"admin"}
# Who may do what. Each entry: roles allowed, and the sentence shown to anyone else.
NEEDS = {
    "upload": (ROLES_UPLOAD, "Only an AP Clerk or Admin can add invoice batches."),
    "run_real": (ROLES_RUN_REAL, "Only an Admin can run a batch for real."),
    "recheck": ({"clerk", "admin"}, "Only an AP Clerk or Admin can recheck an invoice."),
    "manual": ({"clerk", "admin"}, "Only an AP Clerk or Admin can key an invoice by hand."),
    "simulate": ({"admin"}, "Only an Admin can test rule changes."),
}
EVIDENCE_TYPES = {b"\x89PNG\r\n\x1a\n": "png", b"\xff\xd8\xff": "jpg", b"%PDF": "pdf"}
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
BATCH_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_[a-z0-9]+(?:-[a-z0-9]+)*$")


class BatchError(Exception):
    """A request Penny refuses, with a reason a person can act on. `status` is the HTTP status to send."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def slugify(name):
    """'Weekly AP run #3' -> 'weekly-ap-run-3'. Raises if nothing usable is left."""
    slug = re.sub(r"[^a-z0-9]+", "-", str(name or "").strip().lower()).strip("-")[:40].strip("-")
    if len(slug) < 2:
        raise BatchError("Give the batch a short name of at least 2 letters or numbers, like weekly-ap.")
    return slug


def safe_filename(name):
    """Keep only the file's own name, with safe characters. Must end in .pdf."""
    base = Path(unquote(str(name or ""))).name.strip()
    base = re.sub(r"[^A-Za-z0-9._ -]+", "_", base).replace(" ", "_")
    if not base or base.startswith(".") or not base.lower().endswith(".pdf") or len(base) > 120:
        raise BatchError(f"“{name}” is not a PDF file name. Only .pdf invoices can be added.")
    return base


def check_user(user, need):
    role = (user or {}).get("role")
    allowed, refusal = NEEDS[need]
    if role not in allowed:
        raise BatchError(refusal, 403)
    return {"id": str(user.get("id", ""))[:40], "name": str(user.get("name", ""))[:80], "role": role}


def evidence_kind(data):
    """'png', 'jpg' or 'pdf' by content, or None. A file's name is never trusted for this."""
    head = data[:1024].lstrip()
    return next((k for magic, k in EVIDENCE_TYPES.items() if head.startswith(magic)), None)


class BatchService:
    def __init__(self, root, package, state_dir, runs_dir, web_dir, cfg_path):
        self.root, self.package = Path(root), (Path(package) if package else None)
        self.inbox = self.root / "inbox"
        self.state_dir, self.runs_dir, self.web_dir, self.cfg_path = Path(state_dir), Path(runs_dir), Path(web_dir), Path(cfg_path)
        self.log_path = self.state_dir / "batch_log.jsonl"
        self.lock = threading.Lock()
        self._ref = None                                   # reference data, loaded once on first use

    # ---------------------------------------------------------------- time
    def zone(self):
        """The company time zone from rules.json (display.time_zone), or this computer's own zone if it is missing or unknown."""
        try:
            from zoneinfo import ZoneInfo
            name = json.loads(self.cfg_path.read_text(encoding="utf-8")).get("display", {}).get("time_zone")
            return ZoneInfo(name) if name else None
        except Exception:
            return None

    def now(self):
        z = self.zone()
        return datetime.now(z) if z else datetime.now().astimezone()

    def today(self):
        return self.now().strftime("%Y-%m-%d")

    def pick_day(self, date):
        """Use the date the browser shows (it follows the time zone set in Rules) only if it is a real date within a day of now."""
        if date and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(date)):
            try:
                d = datetime.strptime(date, "%Y-%m-%d").date()
                if abs((d - datetime.now(timezone.utc).date()).days) <= 1:
                    return d.isoformat()
            except ValueError:
                pass
        return self.today()

    # ---------------------------------------------------------------- audit log
    def log(self, event):
        event = {"at": self.now().isoformat(timespec="seconds"), **event}
        self.state_dir.mkdir(parents=True, exist_ok=True)
        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, sort_keys=True) + "\n")
        return event

    def read_log(self):
        if not self.log_path.exists():
            return []
        return [json.loads(line) for line in self.log_path.read_text(encoding="utf-8").splitlines() if line.strip()]

    # ---------------------------------------------------------------- batches
    def folder(self, batch):
        if not BATCH_RE.match(str(batch or "")):
            raise BatchError("That batch name is not valid.", 404)
        path = self.inbox / batch
        if not path.is_dir():
            raise BatchError(f"There is no batch called {batch}.", 404)
        return path

    def update_info(self, force=False):
        from .version import check
        return check(self.state_dir, force=force)

    def paused(self, action):
        """Real runs and changes wait for a required update (409, with how to update)."""
        from .version import gate, UpdateRequired
        try:
            gate(self.update_info(), action)
        except UpdateRequired as e:
            raise BatchError(str(e), 409)

    def create(self, name, user, date=None, event_id=""):
        who = check_user(user, "upload")
        self.paused("Adding a batch")
        slug = slugify(name)
        day = self.pick_day(date)
        with self.lock:
            self.inbox.mkdir(parents=True, exist_ok=True)
            batch, n = f"{day}_{slug}", 2
            while (self.inbox / batch).exists():
                batch, n = f"{day}_{slug}-{n}", n + 1
            (self.inbox / batch).mkdir()
        rel = f"inbox/{batch}"
        self.log({"event": "batch.created", "id": event_id, "batch": batch, "folder": rel, "by": who})
        return {"batch": batch, "folder": rel}

    def add_file(self, batch, filename, data, user):
        check_user(user, "upload")
        self.paused("Uploading invoices")
        folder = self.folder(batch)
        name = safe_filename(filename)
        if len(data) > MAX_FILE:
            raise BatchError(f"{name} is larger than 25 MB.", 413)
        if not data[:1024].lstrip().startswith(b"%PDF"):
            raise BatchError(f"{name} is not really a PDF, even though its name ends in .pdf.")
        target = folder / name
        if target.resolve().parent != folder.resolve():
            raise BatchError("That file name is not allowed.")
        if target.exists():
            raise BatchError(f"{name} is already in this batch.", 409)
        target.write_bytes(data)
        return {"name": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}

    def files(self, batch):
        folder = self.folder(batch)
        out = []
        for p in sorted(folder.glob("*.pdf")):
            data = p.read_bytes()
            out.append({"name": p.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        return out

    def finish_upload(self, batch, user, event_id=""):
        who = check_user(user, "upload")
        files = self.files(batch)
        if not files:
            raise BatchError("This batch has no invoices yet. Add at least one PDF.")
        return self.log({"event": "batch.uploaded", "id": event_id, "batch": batch, "folder": f"inbox/{batch}", "by": who,
                         "files": files, "count": len(files), "bytes": sum(f["bytes"] for f in files)})

    def next_run_id(self, batch, dry_run):
        nums = [int(m.group(1)) for p in self.runs_dir.glob("run*_*") if (m := re.match(r"^run(\d+)_", p.name))]
        return f"run{max(nums, default=0) + 1}_{batch}" + ("_PREVIEW" if dry_run else "")

    def run(self, batch, user, dry_run=True, event_id=""):
        who = check_user(user, "upload" if dry_run else "run_real")
        if not dry_run:
            self.paused("Running a batch for real")
        folder = self.folder(batch)
        if not self.files(batch):
            raise BatchError("This batch has no invoices yet. Add at least one PDF.")
        if not self.package:
            raise BatchError("Penny needs the reference data to run. Start the server with: ./penny web --package <package folder>", 503)
        from . import cli, webexport                      # imported here to avoid a cycle at startup
        with self.lock:
            run_id = self.next_run_id(batch, dry_run)
            started = time.time()
            try:
                decisions, errs = cli.run(self.package, folder, run_id, self.state_dir, self.runs_dir, dry_run=dry_run, quiet=True)
            except Exception as e:                       # the failure is part of the record too
                partial = self.runs_dir / run_id
                if partial.is_dir() and not (partial / "decisions.json").exists():
                    import shutil
                    shutil.rmtree(partial)               # only the half-written folder this run just created
                self.log({"event": "batch.run_failed", "id": event_id, "batch": batch, "folder": f"inbox/{batch}", "by": who,
                          "run_id": run_id, "dry_run": bool(dry_run), "error": f"{type(e).__name__}: {e}"[:300]})
                raise BatchError(f"Penny could not finish this run ({type(e).__name__}: {e}). The invoices are safe in inbox/{batch}; "
                                 "fix the problem and run the batch again.", 500)
            info_path = self.runs_dir / run_id / "run_info.json"
            info = json.loads(info_path.read_text(encoding="utf-8"))
            info.update({"label": f"{batch.split('_', 1)[1].replace('-', ' ').capitalize()} ({batch.split('_')[0]})" + (" preview" if dry_run else ""),
                         "batch_dir": f"inbox/{batch}", "ran_by": who})
            info_path.write_text(json.dumps(info, indent=2), encoding="utf-8")
            counts = {}
            for d in decisions:
                counts[d.status] = counts.get(d.status, 0) + 1
            event = self.log({"event": "batch.run", "id": event_id, "batch": batch, "folder": f"inbox/{batch}", "by": who,
                              "run_id": run_id, "dry_run": bool(dry_run), "documents": len(decisions), "counts": counts,
                              "preflight": "passed" if not errs else f"failed ({len(errs)} errors)", "seconds": round(time.time() - started, 1)})
            webexport.build(self.runs_dir, self.cfg_path, self.web_dir / "data", self.package, root=self.root, batch_log=self.log_path)
        return event

    def list(self):
        log = self.read_log()
        out = []
        if self.inbox.exists():
            for p in sorted(self.inbox.iterdir(), reverse=True):
                if p.is_dir() and BATCH_RE.match(p.name):
                    events = [e for e in log if e.get("batch") == p.name]
                    out.append({"batch": p.name, "folder": f"inbox/{p.name}", "files": self.files(p.name), "events": events,
                                "keyed": sorted(x.name for x in p.glob("*.keyed.json")),
                                "evidence": sorted(x.name for x in (p / "evidence").glob("*")) if (p / "evidence").is_dir() else []})
        return out

    # ---------------------------------------------------------------- previews and manual entry (v1.5)
    def ref(self):
        if not self.package:
            raise BatchError("Penny needs the reference data for this. Start the server with: ./penny web --package <package folder>", 503)
        with self.lock:
            if self._ref is None:
                from .reference import load_package
                from .replay import data_fingerprint
                self._ref = (load_package(self.package), data_fingerprint(self.package))
        return self._ref

    def cfg(self, rules=None):
        """The rules to use: the ones the person sees on the Rules page if sent, else config/rules.json."""
        if rules is None:
            return json.loads(self.cfg_path.read_text(encoding="utf-8")), "config/rules.json"
        need = ("thresholds", "routes", "code_priority", "terms_days", "payment_change_phrases")
        if not isinstance(rules, dict) or any(k not in rules for k in need):
            raise BatchError("Those rules are incomplete, so Penny cannot use them.")
        return rules, "the rules shown on the Rules page"

    def run_dir(self, run_id):
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", str(run_id or "")) or not (self.runs_dir / run_id / "decisions.json").exists():
            raise BatchError("That run is not on this computer.", 404)
        return self.runs_dir / run_id

    def saved(self, run_id, doc_id):
        """What Penny read and decided for one document in one run."""
        rd = self.run_dir(run_id)
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", str(doc_id or "")):
            raise BatchError("That document is not valid.", 404)
        reading = rd / "extracted" / f"{doc_id}.json"
        decision = next((d for d in json.loads((rd / "decisions.json").read_text(encoding="utf-8")) if Path(d["file"]).stem == doc_id), None)
        if not reading.exists() or decision is None:
            raise BatchError("Penny has no saved reading for that document.", 404)
        return json.loads(reading.read_text(encoding="utf-8")), decision

    def original(self, run_id, file):
        """The original file on this computer: the inbox folder it was uploaded to, the package batch folder, or the copy
        published with the web view. Callers check its SHA-256 against what Penny read, so a copy is only used if identical."""
        from .webexport import _run_info
        info = _run_info(self.run_dir(run_id))
        options = []
        if info.get("batch_dir"):
            options.append(self.root / info["batch_dir"] / file)
        if self.package and info.get("batch"):
            options.append(Path(self.package) / info["batch"] / file)
        options.append(self.web_dir / "data" / "pdfs" / file)
        return next((p for p in options if p.is_file()), None)

    def versions(self, doc, rules, rules_source, data_fp, reg_rows):
        from .replay import fingerprint
        return {"document": {"file": doc.get("file", ""), "sha256": doc.get("sha256", ""), "read_by": (doc.get("extraction") or {}).get("method", "")},
                "rules": {"fingerprint": fingerprint(rules), "source": rules_source},
                "data": {"fingerprint": data_fp},
                "register": {"entries": len(reg_rows), "entered": sum(1 for r in reg_rows.values() if r.get("status") == "ENTERED")}}

    def recheck(self, user, run_id, doc_id, source="saved", rules=None, entry=None, pdf=None, pdf_name="", event_id=""):
        who = check_user(user, "recheck")
        (ref, data_fp) = self.ref()
        cfg, rules_source = self.cfg(rules)
        reading, before = self.saved(run_id, doc_id)
        if source == "saved":
            doc = reading
        elif source == "keyed":
            from .manual import keyed_doc, KeyedError
            try:
                doc = keyed_doc(entry or {}, reading, cfg)
            except KeyedError as e:
                raise BatchError(f"Fix the entry first: {e}.")
        elif source == "file":
            if not pdf or not pdf[:1024].lstrip().startswith(b"%PDF"):
                raise BatchError("The corrected file is not a PDF.")
            if len(pdf) > MAX_FILE:
                raise BatchError("The corrected file is larger than 25 MB.", 413)
            from .llm_extract import extract
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / safe_filename(pdf_name or reading["file"])
                path.write_bytes(pdf)
                doc = extract(path, cfg, "rules")
            doc.pop("raw_text", None)
        else:
            raise BatchError("Choose what to recheck: the same reading, a corrected PDF, or a manual entry.")
        from .register import Register
        from .replay import recheck, brief
        reg_rows = Register(self.state_dir).rows
        try:
            after = recheck(ref, cfg, reg_rows, doc)
        except Exception as e:
            raise BatchError(f"Penny could not decide this document ({type(e).__name__}: {e}).", 500)
        result = {"run_id": run_id, "doc_id": doc_id, "source": source, "before": brief(before), "after": after,
                  "versions": self.versions(doc, cfg, rules_source, data_fp, reg_rows)}
        self.log({"event": "recheck.preview", "id": event_id, "doc": doc_id, "run_id": run_id, "source": source, "by": who,
                  "result": after["decision"], "codes": after["codes"], "was": before["decision"],
                  "document_sha256": doc.get("sha256", ""), "rules_fingerprint": result["versions"]["rules"]["fingerprint"],
                  "data_fingerprint": data_fp})
        return result

    def simulate(self, user, rules_now, rules_draft):
        check_user(user, "simulate")
        (ref, data_fp) = self.ref()
        now, _ = self.cfg(rules_now)
        draft, _ = self.cfg(rules_draft)
        from .replay import saved_runs, simulate
        try:
            out = simulate(ref, now, draft, saved_runs(self.runs_dir))
        except Exception as e:
            raise BatchError(f"Penny could not test these rules ({type(e).__name__}: {e}). Check the values and try again.", 400)
        return {**out, "data_fingerprint": data_fp}

    def save_manual(self, user, run_id, doc_id, entry, evidence, date=None, event_id=""):
        who = check_user(user, "manual")
        self.paused("Saving a manual entry")
        cfg, _ = self.cfg()
        reading, before = self.saved(run_id, doc_id)
        if before.get("decision") != "HOLD":
            raise BatchError("Only a held document can be keyed by hand.", 409)
        from .manual import keyed_doc, KeyedError
        files = []
        for ev in (evidence or [])[:MAX_EVIDENCE_FILES + 1]:
            try:
                data = base64.b64decode(str(ev.get("data") or ""), validate=True)
            except ValueError:
                raise BatchError(f"Evidence {ev.get('name', '')!r} did not arrive intact.")
            kind = evidence_kind(data)
            if not kind:
                raise BatchError(f"Evidence {ev.get('name', '')!r} must be a PNG or JPEG screenshot, or a PDF.")
            if len(data) > MAX_EVIDENCE:
                raise BatchError(f"Evidence {ev.get('name', '')!r} is larger than 10 MB.", 413)
            files.append({"name": re.sub(r"[^A-Za-z0-9._-]+", "_", Path(str(ev.get("name") or "evidence")).stem)[:60] + "." + kind,
                          "type": kind, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "data": data})
        if len(files) > MAX_EVIDENCE_FILES:
            raise BatchError(f"Attach at most {MAX_EVIDENCE_FILES} evidence files.")
        if not files:
            raise BatchError("Attach the screenshot or re-saved file you keyed from, so a reviewer can see it.")
        claimed = {e.get("sha256") for e in (entry or {}).get("evidence") or []}
        if claimed != {f["sha256"] for f in files}:
            raise BatchError("The evidence files do not match the ones listed in the entry. Attach them again.")
        src = self.original(run_id, reading["file"])
        if not src:
            raise BatchError(f"The original file {reading['file']} is not on this computer, so the entry cannot be saved with it.", 409)
        sha = hashlib.sha256(src.read_bytes()).hexdigest()
        if reading.get("sha256") and sha != reading["sha256"]:
            raise BatchError(f"{reading['file']} on this computer is not the file Penny read (its fingerprint differs).", 409)
        try:
            doc = keyed_doc(entry or {}, {**reading, "sha256": sha}, cfg)
        except KeyedError as e:
            raise BatchError(f"Fix the entry first: {e}.")
        made = self.create(f"manual {Path(reading['file']).stem}", user, date, event_id=f"{event_id}-folder" if event_id else "")
        folder = self.inbox / made["batch"]
        shutil.copy2(src, folder / reading["file"])
        (folder / "evidence").mkdir()
        for f in files:
            (folder / "evidence" / f["name"]).write_bytes(f["data"])
        (folder / f"{Path(reading['file']).stem}.keyed.json").write_text(json.dumps(doc, indent=2), encoding="utf-8")
        return self.log({"event": "manual.saved", "id": event_id, "doc": doc_id, "run_id": run_id, "batch": made["batch"],
                         "folder": made["folder"], "by": who, "keyed_by": doc["extraction"]["keyed_by"],
                         "checked_by": doc["extraction"]["checked_by"], "reason": doc["extraction"]["reason"],
                         "invoice_no": doc["invoice_no"], "total": doc["total"], "original_sha256": doc["sha256"],
                         "evidence": [{k: f[k] for k in ("name", "type", "bytes", "sha256")} for f in files]})


def make_handler(service, web_dir):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(web_dir), **k)

        def log_message(self, fmt, *args):            # keep the terminal quiet; the batch log is the record
            pass

        def send_json(self, obj, status=200):
            body = json.dumps(obj).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def guard(self):
            if self.headers.get("X-Penny") != "1":
                raise BatchError("Request refused.", 403)
            origin = self.headers.get("Origin")
            if origin and urlparse(origin).netloc != self.headers.get("Host"):
                raise BatchError("Request refused: it came from another site.", 403)

        def status(self):
            from .version import current
            info = service.update_info()
            return {"mode": "local", "engine": bool(service.package), "max_mb": MAX_FILE // (1024 * 1024), "version": current(),
                    "update": {k: info[k] for k in ("version", "latest", "minimum", "state", "newer", "note")},
                    "inbox": "inbox/", "today": service.today(),
                    "time_zone": getattr(service.zone(), "key", None)}

        def do_GET(self):
            url = urlparse(self.path)
            try:
                if url.path == "/api/status":
                    return self.send_json(self.status())
                if url.path == "/data/penny-data.json":
                    # The web app learns it is on the local server from the data it already loads, so the public
                    # static site never makes a request that fails.
                    data = json.loads((Path(web_dir) / "data" / "penny-data.json").read_text(encoding="utf-8"))
                    data["server"] = self.status()
                    return self.send_json(data)
                if url.path == "/api/update":
                    # "Check for updates" in the web app: ask GitHub now instead of using today's cached answer.
                    force = parse_qs(url.query).get("force") == ["1"]
                    info = service.update_info(force=force)
                    return self.send_json({k: info[k] for k in ("version", "latest", "minimum", "state", "newer", "note", "checked")})
                if url.path == "/api/batches":
                    return self.send_json({"batches": service.list()})
            except BatchError as e:
                return self.send_json({"error": str(e)}, e.status)
            return super().do_GET()

        def do_POST(self):
            url = urlparse(self.path)
            parts = [p for p in url.path.split("/") if p]
            try:
                self.guard()
                length = int(self.headers.get("Content-Length") or 0)
                limit = (MAX_EVIDENCE * MAX_EVIDENCE_FILES * 4 // 3 + 1024 * 1024) if parts == ["api", "manual"] else MAX_FILE + 1024
                if length > limit:
                    raise BatchError("That upload is too large.", 413)
                raw = self.rfile.read(length)
                if parts == ["api", "batches"]:
                    body = json.loads(raw or b"{}")
                    return self.send_json(service.create(body.get("name"), body.get("user"), body.get("date"), event_id=str(body.get("event_id", ""))[:40]), 201)
                if len(parts) == 4 and parts[:2] == ["api", "batches"] and parts[3] == "files":
                    q = parse_qs(url.query)
                    user = json.loads(self.headers.get("X-Penny-User") or "{}")
                    return self.send_json(service.add_file(parts[2], (q.get("name") or [""])[0], raw, user), 201)
                if len(parts) == 4 and parts[:2] == ["api", "batches"] and parts[3] == "uploaded":
                    body = json.loads(raw or b"{}")
                    return self.send_json(service.finish_upload(parts[2], body.get("user"), str(body.get("event_id", ""))[:40]))
                if len(parts) == 4 and parts[:2] == ["api", "batches"] and parts[3] == "run":
                    body = json.loads(raw or b"{}")
                    return self.send_json(service.run(parts[2], body.get("user"), bool(body.get("dry_run", True)), str(body.get("event_id", ""))[:40]))
                if parts == ["api", "recheck"] and self.headers.get("Content-Type", "").startswith("application/pdf"):
                    q = parse_qs(url.query)
                    user = json.loads(self.headers.get("X-Penny-User") or "{}")
                    return self.send_json(service.recheck(user, (q.get("run") or [""])[0], (q.get("doc") or [""])[0], "file",
                                                          pdf=raw, pdf_name=(q.get("name") or [""])[0], event_id=(q.get("event_id") or [""])[0][:40]))
                if parts == ["api", "recheck"]:
                    body = json.loads(raw or b"{}")
                    return self.send_json(service.recheck(body.get("user"), body.get("run_id"), body.get("doc_id"), body.get("source", "saved"),
                                                          rules=body.get("rules"), entry=body.get("entry"), event_id=str(body.get("event_id", ""))[:40]))
                if parts == ["api", "simulate"]:
                    body = json.loads(raw or b"{}")
                    return self.send_json(service.simulate(body.get("user"), body.get("rules_now"), body.get("rules_draft")))
                if parts == ["api", "manual"]:
                    body = json.loads(raw or b"{}")
                    return self.send_json(service.save_manual(body.get("user"), body.get("run_id"), body.get("doc_id"), body.get("entry"),
                                                              body.get("evidence"), body.get("date"), str(body.get("event_id", ""))[:40]), 201)
                raise BatchError("Not found.", 404)
            except BatchError as e:
                return self.send_json({"error": str(e)}, e.status)
            except json.JSONDecodeError:
                return self.send_json({"error": "The request was not valid JSON."}, 400)
            except Exception as e:                            # never leave the browser hanging without a reason
                return self.send_json({"error": f"Penny hit an unexpected problem: {type(e).__name__}: {e}"}, 500)

    return Handler


def serve(service, web_dir, port, open_browser=True):
    import webbrowser
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), make_handler(service, web_dir))
    url = f"http://127.0.0.1:{port}/"
    print(f"Penny web app: {url}   (Ctrl+C to stop)")
    print("  New batches: " + ("ready (upload and run from the New batch page)" if service.package
                               else "upload only. To run batches, start with:  ./penny web --package <package folder>"))
    if open_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        httpd.server_close()
