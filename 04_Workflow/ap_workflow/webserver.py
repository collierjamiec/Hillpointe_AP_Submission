"""Penny's local web server: the web view plus a small API to upload and run new invoice batches.

  ./penny web --package <package folder>

Why a local server: the public site is static, so it cannot run Penny's Python engine. On your own computer this
server can. It only listens on 127.0.0.1 (this computer), and it is the only part of the web app that changes files.

Batch folders
  inbox/<YYYY-MM-DD>_<short-name>/      for example inbox/2026-11-10_weekly-ap/
  Names are lowercase letters, numbers and dashes. If a name is taken that day, -2, -3 ... is added.

Permissions (from the signed-in demo account; a production server would authenticate the person itself)
  AP Clerk and Admin   create a batch, upload invoices, run a preview (dry run: the register is not changed)
  Admin only           run for real (the register is updated, so those bills can never be entered twice)

Audit
  Every step is appended to state/batch_log.jsonl and never rewritten: who created the batch, who uploaded which files
  (name, size, SHA-256), who ran it, when, the folder, the run ID, preview or real, the result counts and pre-flight.

Safety
  Files must be real PDFs (checked by content), at most 25 MB, with safe names inside the batch folder only.
  Write requests must carry the header X-Penny: 1, which other web pages cannot send, so a malicious page cannot
  upload or run anything through your browser.
"""
import hashlib
import http.server
import json
import re
import threading
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

MAX_FILE = 25 * 1024 * 1024
ROLES_UPLOAD = {"clerk", "admin"}
ROLES_RUN_REAL = {"admin"}
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
    allowed = ROLES_RUN_REAL if need == "run_real" else ROLES_UPLOAD
    if role not in allowed:
        what = "run a batch for real" if need == "run_real" else "add invoice batches"
        who = "Only an Admin" if need == "run_real" else "Only an AP Clerk or Admin"
        raise BatchError(f"{who} can {what}.", 403)
    return {"id": str(user.get("id", ""))[:40], "name": str(user.get("name", ""))[:80], "role": role}


class BatchService:
    def __init__(self, root, package, state_dir, runs_dir, web_dir, cfg_path):
        self.root, self.package = Path(root), (Path(package) if package else None)
        self.inbox = self.root / "inbox"
        self.state_dir, self.runs_dir, self.web_dir, self.cfg_path = Path(state_dir), Path(runs_dir), Path(web_dir), Path(cfg_path)
        self.log_path = self.state_dir / "batch_log.jsonl"
        self.lock = threading.Lock()

    # ---------------------------------------------------------------- audit log
    def log(self, event):
        event = {"at": datetime.now().astimezone().isoformat(timespec="seconds"), **event}
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

    def create(self, name, user, date=None, event_id=""):
        who = check_user(user, "upload")
        slug = slugify(name)
        day = date or datetime.now().strftime("%Y-%m-%d")
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
                    out.append({"batch": p.name, "folder": f"inbox/{p.name}", "files": self.files(p.name), "events": events})
        return out


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
            return {"mode": "local", "engine": bool(service.package), "max_mb": MAX_FILE // (1024 * 1024),
                    "inbox": "inbox/", "today": datetime.now().strftime("%Y-%m-%d")}

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
                if length > MAX_FILE + 1024:
                    raise BatchError("That upload is larger than 25 MB.", 413)
                raw = self.rfile.read(length)
                if parts == ["api", "batches"]:
                    body = json.loads(raw or b"{}")
                    return self.send_json(service.create(body.get("name"), body.get("user"), event_id=str(body.get("event_id", ""))[:40]), 201)
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
