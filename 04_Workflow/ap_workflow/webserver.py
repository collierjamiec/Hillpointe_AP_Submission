"""Penny's local web server: the web view plus a small API to upload and run new invoice batches.

  ./penny web --package <package folder>

Why a local server: the public site is static, so it cannot run Penny's Python engine. On your own computer this
server can. By default it only listens on 127.0.0.1 (this computer), and it is the only part of the web app that
changes files.

For a team (added in v2.0, see store.py and actions.py)
  With real accounts, this server is the single source of truth. Every action a person takes in the web app is sent
  to POST /api/events, checked (who they are, what their role may do, what teammates already did) and saved in the
  database, state/penny.db. GET /api/events?after=N&wait=S holds the answer until something new is saved, which is
  how every open browser sees a teammate's work at once. Rule changes are written to config/rules.json.
  ./penny web --host 0.0.0.0 --https opens it to the network; that is refused without real accounts and https.

Batch folders
  inbox/<YYYY-MM-DD>_<short-name>/      for example inbox/2026-11-10_weekly-ap/
  Names are lowercase letters, numbers and dashes. If a name is taken that day, -2, -3 ... is added.

Permissions (from the signed-in demo account; a production server would authenticate the person itself)
  AP Clerk and Admin   create a batch, upload invoices, run a preview (dry run: the register is not changed),
                       recheck a held invoice, save a manual entry (v1.5)
  Admin only           run for real (the register is updated, so those bills can never be entered twice),
                       test draft rules against every saved run (v1.5)

Accounts and email (added in v1.7, see accounts.py and mailer.py)
  When there are people in the database (before 2.0: state/users.json), sign-in is real: the server checks passwords and keeps the session in an
  HttpOnly cookie, every request acts as the signed-in person (anything the browser says about who it is is
  ignored), and invoices, runs and the API need a session. Admins invite people, edit them, set roles and status,
  and send password resets. Invitations, resets, approval requests and exports go out through mailer.py.
  With nobody invited yet, the four public demo accounts work as before.

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
  Every step is added to the audit log in the database, which refuses changes and deletions: who created the batch, who uploaded which files
  (name, size, SHA-256), who ran it, when, the folder, the run ID, preview or real, the result counts and pre-flight.

Safety
  Files must be real PDFs (checked by content), at most 25 MB, with safe names inside the batch folder only.
  Write requests must carry the header X-Penny: 1, which other web pages cannot send, so a malicious page cannot
  upload or run anything through your browser.
"""
import base64
import hashlib
import os
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
    "email": ({"clerk", "approver", "admin"}, "Only an AP Clerk, Approver or Admin can email from Penny."),
}
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; "
       "connect-src 'self'; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; "
       "form-action 'self'; frame-ancestors 'self'")
EVIDENCE_TYPES = {b"\x89PNG\r\n\x1a\n": "png", b"\xff\xd8\xff": "jpg", b"%PDF": "pdf"}
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
BATCH_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_[a-z0-9]+(?:-[a-z0-9]+)*$")


class BatchError(Exception):
    """A request Penny refuses, with a reason a person can act on. `status` is the HTTP status to send."""

    def __init__(self, message, status=400):
        """Keep the message and the HTTP status to answer with."""
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
    """Refuse (403) unless the person's role may do this. Returns who they are, for the audit log."""
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
    """Everything the web server does for one Penny: batches, runs, rechecks, email, accounts and the audit log."""

    def __init__(self, root, package, state_dir, runs_dir, web_dir, cfg_path):
        """One Penny on one computer: where batches, state, runs and the web app live, and which rules file to use."""
        self.root, self.package = Path(root), (Path(package) if package else None)
        self.inbox = self.root / "inbox"
        self.state_dir, self.runs_dir, self.web_dir, self.cfg_path = Path(state_dir), Path(runs_dir), Path(web_dir), Path(cfg_path)
        self.lock = threading.Lock()
        self._ref = None                                   # reference data, loaded once on first use
        self.watcher = None                                # the watched inbox folder, when it is turned on (see watcher.py)
        self._sha = {}                                     # path -> (mtime, size, sha256): a file is hashed once until it changes
        self._log = {"seq": 0, "events": []}               # the server's own log read so far; only newer entries are read again
        self._runs = (None, [])                            # (file stamp, runs) from the web data, for export_file
        self.setup_key = None                              # set by ./penny setup: the one-time key the setup wizard must send (see setup.py)
        self._log_lock = threading.Lock()                  # its own lock: a run holds self.lock while it reads the log
        from .accounts import Accounts
        from .mailer import Outbox
        from .store import Store
        self.store = Store(self.state_dir)                 # state/penny.db: the audit log and accounts (v2.0)
        self.moved = self.store.migrate()                  # the one-time move of files from before 2.0
        self.accounts = Accounts(self.state_dir, log=self.log, store=self.store)
        self.outbox = Outbox(self.state_dir)

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
        """The current time in the company time zone."""
        z = self.zone()
        return datetime.now(z) if z else datetime.now().astimezone()

    def today(self):
        """Today's date in the company time zone, as YYYY-MM-DD."""
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
        """Append one event to the audit log in the database, stamped with the time. The database refuses to
        change or remove an entry afterwards."""
        event = {"at": self.now().isoformat(timespec="seconds"), **event}
        self.store.append(event, "server", subject=str(event.get("doc_id") or event.get("batch") or ""))
        return event

    def read_log(self):
        """Everything the server itself recorded, oldest first. The log only grows, so only entries newer than
        the last call are read from the database."""
        with self._log_lock:
            if self.store.last() > self._log["seq"]:
                new = self.store.events(after=self._log["seq"])
                mine = [{k: v for k, v in e.items() if k not in ("seq", "origin")} for e in new if e["origin"] == "server"]
                self._log = {"seq": new[-1]["seq"] if new else self._log["seq"], "events": self._log["events"] + mine}
            return list(self._log["events"])

    def fingerprint(self, path):
        """(bytes, SHA-256) of a file, remembered until its size or modified time changes."""
        st = path.stat()
        hit = self._sha.get(str(path))
        if not hit or hit[:2] != (st.st_mtime_ns, st.st_size):
            hit = (st.st_mtime_ns, st.st_size, hashlib.sha256(path.read_bytes()).hexdigest())
            self._sha[str(path)] = hit
        return st.st_size, hit[2]

    # ---------------------------------------------------------------- batches
    def folder(self, batch):
        """The folder of a batch in inbox/, or a 404 when the name is not valid or does not exist."""
        if not BATCH_RE.match(str(batch or "")):
            raise BatchError("That batch name is not valid.", 404)
        path = self.inbox / batch
        if not path.is_dir():
            raise BatchError(f"There is no batch called {batch}.", 404)
        return path

    def update_info(self, force=False):
        """Where this copy stands against the newest release (see version.check)."""
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
        """Make a new batch folder inbox/<date>_<name>, adding -2, -3 when the name is taken that day."""
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
        """Save one uploaded invoice into a batch after checking it is really a PDF, not too large, safely named
        and not already there."""
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
        """The PDFs in a batch with their size and SHA-256 (evidence and manual entries are not invoices)."""
        folder = self.folder(batch)
        out = []
        for p in sorted(folder.glob("*.pdf")):
            size, sha = self.fingerprint(p)
            out.append({"name": p.name, "bytes": size, "sha256": sha})
        return out

    def finish_upload(self, batch, user, event_id=""):
        """Record who uploaded which files, with fingerprints, once the upload is complete."""
        who = check_user(user, "upload")
        files = self.files(batch)
        if not files:
            raise BatchError("This batch has no invoices yet. Add at least one PDF.")
        return self.log({"event": "batch.uploaded", "id": event_id, "batch": batch, "folder": f"inbox/{batch}", "by": who,
                         "files": files, "count": len(files), "bytes": sum(f["bytes"] for f in files)})

    def next_run_id(self, batch, dry_run):
        """The next run name: run<N>_<batch>, with _PREVIEW for a dry run."""
        nums = [int(m.group(1)) for p in self.runs_dir.glob("run*_*") if (m := re.match(r"^run(\d+)_", p.name))]
        return f"run{max(nums, default=0) + 1}_{batch}" + ("_PREVIEW" if dry_run else "")

    def run(self, batch, user, dry_run=True, event_id=""):
        """Run Penny on a batch: a preview (dry run) for Clerks and Admins, for real for Admins only. The run, its
        counts and any failure are logged, and the web data is refreshed."""
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
            webexport.build(self.runs_dir, self.cfg_path, self.web_dir / "data", self.package, root=self.root, batch_log=self.read_log())
        return event

    def list(self):
        """Every batch in inbox/, newest first, with its files, manual entries, evidence and log events."""
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

    # ---------------------------------------------------------------- email (v1.7)
    FILE_LABELS = {"intacct_bill_import.csv": "Intacct bill import file", "entrata_handoff.csv": "Entrata handoff list",
                   "exception_log.csv": "Invoices needing review", "approvals_for_entered_bills.csv": "Approvals needed",
                   "review_workbook.xlsx": "Review workbook", "run_report.md": "Run summary"}
    FILE_WHAT = {"intacct_bill_import.csv": "Bills that passed every check, in Sage Intacct's import format. A person uploads it to Intacct after review; Penny does not.",
                 "entrata_handoff.csv": "Apartment community bills, one row per GL account, for Property Accounting to post in Entrata.",
                 "exception_log.csv": "Every invoice Penny held or stopped, with the reason, the team it goes to, and Penny's confidence.",
                 "approvals_for_entered_bills.csv": "Who must sign off on each bill in the import file. It lists who is required; it does not record approvals.",
                 "review_workbook.xlsx": "All of the run's files as tabs in one Excel workbook, with a sheet that checks every bill total.",
                 "run_report.md": "One page with the counts, every decision, and the result of the Intacct pre-flight check."}

    def recipients(self, to, cfg):
        """Every address must be a Penny user or in an allowed domain (rules.json email.allowed_domains)."""
        email_cfg = cfg.get("email") or {}
        allowed = {d.lower() for d in email_cfg.get("allowed_domains", [])}
        people = {u["email"] for u in self.accounts.list() if u["status"] == "active"}
        out = []
        for t in to if isinstance(to, list) else [to]:
            from .mailer import ADDRESS_RE
            e = str(t or "").strip().lower()
            if not e:
                continue
            if not ADDRESS_RE.match(e):
                raise BatchError(f"“{t}” is not a valid email address.")
            if e not in people and e.split("@")[1] not in allowed:
                raise BatchError(f"{e} is outside the email domains Penny may send to ({', '.join(sorted(allowed)) or 'none set'}). "
                                 "An Admin can add the domain under email.allowed_domains in rules.json.", 403)
            if e not in out:
                out.append(e)
        if not out:
            raise BatchError("Add at least one recipient.")
        limit = int(email_cfg.get("max_recipients", 10))
        if len(out) > limit:
            raise BatchError(f"Send to at most {limit} people at a time.")
        return out

    def email(self, user, kind, to, note="", run_id="", doc_id="", file="", base=""):
        """Email an export file or an approval request, with the file attached."""
        who = check_user(user, "email")
        cfg, _ = self.cfg()
        to = self.recipients(to, cfg)
        note = re.sub(r"[ \t]+", " ", str(note or "")).strip()[:1000]
        rd = self.run_dir(run_id)
        from .webexport import _run_info, _label
        info = _run_info(rd)
        label = info.get("label") or _label(rd.name, info.get("batch", ""), False)
        sign = f"\n\nSent from Penny by {who['name']}. Penny prepares these files; people review, approve and post them."
        if kind == "export":
            if file not in self.FILE_LABELS or not (rd / file).is_file():
                raise BatchError("That file is not part of this run.", 404)
            title = self.FILE_LABELS[file]
            subject = f"{title}: {label}"
            text = (f"{who['name']} shared the {title.lower()} from Penny's run “{label}”.\n\n" + (f"Note: {note}\n\n" if note else "")
                    + f"What it is: {self.FILE_WHAT[file]}\nAttached: {file}\n" + (f"Open the run in Penny: {base}/#/runs/{rd.name}" if base else "") + sign)
            attachments = [(file, (rd / file).read_bytes())]
        elif kind == "approval":
            _, d = self.saved(run_id, doc_id)
            if not str(d.get("decision", "")).startswith("ENTER_"):
                raise BatchError("Only a bill that is ready to import needs approval.", 409)
            vendor, bill, amount = d.get("vendor_name") or "", d.get("bill_no") or "", d.get("amount") or "0"
            steps = d.get("approvers") or sorted({r.get("Approver") for r in d.get("entrata_rows") or [] if r.get("Approver")})
            subject = f"Approval needed: {vendor} {bill} (${float(amount):,.2f})"
            text = (f"{who['name']} asked you to review a bill in Penny.\n\n" + (f"Note: {note}\n\n" if note else "")
                    + f"Vendor: {vendor}\nInvoice: {bill}\nAmount: ${float(amount):,.2f}\nBill date: {d.get('bill_date') or ''}\n"
                    + "Approvals needed:\n" + "".join(f"  - {s}\n" for s in steps) + "\n"
                    + (f"Review and approve it in Penny: {base}/#/invoices/{doc_id}\n" if base else "")
                    + "The original invoice is attached. This bill is ready for import; it is not posted or paid yet." + sign)
            pdf = self.web_dir / "data" / "pdfs" / d["file"]
            attachments = [(d["file"], pdf.read_bytes())] if pdf.is_file() else []
        else:
            raise BatchError("Choose what to send.")
        entry = self.outbox.send(to, subject, text, who, kind, attachments)
        self.log({"event": "email.sent" if entry["status"] == "sent" else "email.saved" if entry["status"] == "saved" else "email.failed",
                  "by": who, "kind": kind, "to": to, "subject": subject, "run_id": rd.name, "doc": doc_id or None, "file": file or None,
                  "attachments": entry["attachments"], "outbox_id": entry["id"], "error": entry["error"]})
        return entry

    def account_email(self, purpose, user, token, hours, by_name, base):
        """Send an invitation or a reset link. The link is blanked out of the saved copy once it is really sent."""
        link = f"{base}/#/{'activate' if purpose == 'invite' else 'reset'}?token={token}"
        from .accounts import ROLE_NAMES
        if purpose == "invite":
            subject = "You're invited to Penny"
            text = (f"Hi {user['name'].split()[0]},\n\n{by_name} invited you to Penny, the accounts payable workspace, as {ROLE_NAMES[user['role']]}.\n\n"
                    f"Set up your account and choose a password:\n{link}\n\nThis link works once and expires in {hours} hours. "
                    "If you did not expect this email, you can ignore it.\n\nPenny AP")
        else:
            subject = "Reset your Penny password"
            asked = f"{by_name} sent you a link" if by_name else "Someone (most likely you) asked on the sign-in page for a link"
            text = (f"Hi {user['name'].split()[0]},\n\n{asked} to choose a new Penny password:\n{link}\n\n"
                    f"This link works once and expires in {hours} hour{'s' if hours != 1 else ''}. If you did not ask for this, you can ignore it; "
                    "your password stays the same.\n\nPenny AP")
        who = {"id": user["id"] if not by_name else "penny", "name": by_name or user["name"], "role": "system"}
        return self.outbox.send([user["email"]], subject, text, who, purpose, redact=[token])

    # ---------------------------------------------------------------- previews and manual entry (v1.5)
    def ref(self):
        """The reference data (vendor master, ERP history, contracts) and its fingerprint, loaded once."""
        if not self.package:
            raise BatchError("Penny needs the reference data for this. Start the server with: ./penny web --package <package folder>", 503)
        with self.lock:
            if self._ref is None:
                from .reference import load_package
                from .replay import data_fingerprint
                self._ref = (load_package(self.package), data_fingerprint(self.package))
        return self._ref

    def export_file(self, run_id, name):
        """What the server knows about one file a run wrote: its row count and whether the run was a preview.
        None when there is no such file. Used to check "mark as imported" against the real file."""
        path = self.web_dir / "data" / "penny-data.json"
        try:
            st = path.stat()
            if self._runs[0] != (st.st_mtime_ns, st.st_size):
                self._runs = ((st.st_mtime_ns, st.st_size), json.loads(path.read_text(encoding="utf-8")).get("runs", []))
        except (OSError, ValueError):
            return None
        for r in self._runs[1]:
            if r.get("id") == run_id:
                f = next((f for f in r.get("files", []) if f.get("name") == name), None)
                return {"rows": f.get("rows"), "dry_run": bool(r.get("dry_run"))} if f else None
        return None

    def cfg(self, rules=None):
        """The rules to use: the ones the person sees on the Rules page if sent, else config/rules.json."""
        if rules is None:
            return json.loads(self.cfg_path.read_text(encoding="utf-8")), "config/rules.json"
        need = ("thresholds", "routes", "code_priority", "terms_days", "payment_change_phrases")
        if not isinstance(rules, dict) or any(k not in rules for k in need):
            raise BatchError("Those rules are incomplete, so Penny cannot use them.")
        return rules, "the rules shown on the Rules page"

    def run_dir(self, run_id):
        """The folder of a saved run, or a 404."""
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
        """Exactly what a preview used: the document, the rules, the reference data and the register size."""
        from .replay import fingerprint
        return {"document": {"file": doc.get("file", ""), "sha256": doc.get("sha256", ""), "read_by": (doc.get("extraction") or {}).get("method", "")},
                "rules": {"fingerprint": fingerprint(rules), "source": rules_source},
                "data": {"fingerprint": data_fp},
                "register": {"entries": len(reg_rows), "entered": sum(1 for r in reg_rows.values() if r.get("status") == "ENTERED")}}

    def recheck(self, user, run_id, doc_id, source="saved", rules=None, entry=None, pdf=None, pdf_name="", event_id=""):
        """Preview what Penny would decide now for one held document: the saved reading, a corrected PDF, or a
        manual entry. Decided against a copy of the register; only the audit log is written."""
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
        """Replay every saved run under the current rules and under draft rules, and list what would change."""
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
        """Save a manual entry for the next run: a new batch folder with the original file, the keyed record and
        the evidence. Refuses unless the evidence matches and the original is the exact file Penny read."""
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


class PennyHandler(http.server.SimpleHTTPRequestHandler):
    """Serves the web app's files and the JSON API for one BatchService. make_handler fills in `service` and `web_dir`."""
    service = None      # the BatchService this server works for
    web_dir = None      # the folder the web app is served from
    def __init__(self, *a, **k):
        """Serve static files from the web folder."""
        super().__init__(*a, directory=str(self.web_dir), **k)

    def log_message(self, fmt, *args):            # keep the terminal quiet; the batch log is the record
        """Stay quiet in the terminal; the audit log is the record."""
        pass

    def end_headers(self):
        """Every response: no MIME sniffing, no framing by other sites, no referrer, and the same content
        security policy the page declares for itself (so it also covers the API and files)."""
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP)
        if str(getattr(self, "path", "")).startswith("/data/") and self.service.accounts.enabled():
            self.send_header("Cache-Control", "private, no-store")      # invoices are not left in a shared computer's cache
        if getattr(self.server, "secure", False):          # over https: tell the browser to never fall back to http
            self.send_header("Strict-Transport-Security", "max-age=31536000")
        super().end_headers()

    def send_json(self, obj, status=200, cookie=None):
        """Answer with JSON, never cached. `cookie` sets (or, when empty, clears) the session cookie."""
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        if cookie is not None:
            # HttpOnly: page scripts cannot read it. SameSite=Strict: other sites cannot send it.
            # Secure (over https): the browser never sends it over plain http.
            life = "" if cookie else "; Max-Age=0"
            secure = "; Secure" if getattr(self.server, "secure", False) else ""
            self.send_header("Set-Cookie", f"penny_session={cookie}; HttpOnly; SameSite=Strict; Path=/{secure}{life}")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass                                          # the browser went away before the answer arrived

    def guard(self):
        """Refuse a write that did not come from Penny's own page: it must carry the X-Penny header, which other
        sites cannot send, and its Origin must be this server."""
        if self.headers.get("X-Penny") != "1":
            raise BatchError("Request refused.", 403)
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).netloc != self.headers.get("Host"):
            raise BatchError("Request refused: it came from another site.", 403)

    def session_token(self):
        """The session token from the request's cookie, or ''."""
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == "penny_session":
                return v
        return ""

    def me(self):
        """The signed-in person when accounts are on, else None."""
        return self.service.accounts.session_user(self.session_token()) if self.service.accounts.enabled() else None

    def actor(self, claimed):
        """Who is acting. With accounts on, only the session counts; what the browser claims is ignored."""
        if not self.service.accounts.enabled():
            return claimed
        who = self.me()
        if not who:
            raise BatchError("Please sign in again.", 401)
        return {"id": who["id"], "name": who["name"], "role": who["role"]}

    def base_url(self):
        """The address people open Penny at, for links in emails."""
        scheme = "https" if getattr(self.server, "secure", False) else "http"
        return (os.environ.get("PENNY_PUBLIC_URL") or f"{scheme}://{self.headers.get('Host') or '127.0.0.1'}").rstrip("/")

    def status(self):
        """What the web app needs to know about this server: engine, version, update, accounts and email."""
        from .version import current
        info = self.service.update_info()
        return {"mode": "local", "engine": bool(self.service.package), "max_mb": MAX_FILE // (1024 * 1024), "version": current(),
                "update": {k: info[k] for k in ("version", "latest", "minimum", "state", "newer", "note")},
                "watch": self.service.watcher.status() if self.service.watcher else {"enabled": False},
                "accounts": self.service.accounts.enabled(), "team": self.service.accounts.enabled(), "last": self.service.store.last(),
                "secure": bool(getattr(self.server, "secure", False)), "email": __import__("ap_workflow.mailer", fromlist=["describe"]).describe(),
                "inbox": "inbox/", "today": self.service.today(),
                "time_zone": getattr(self.service.zone(), "key", None)}

    timeout = 60        # an idle or stalled connection is closed after a minute, so it cannot hold a thread forever

    def plain_path(self):
        """The address as the file server will read it: percent codes decoded, "." and ".." and doubled slashes
        resolved. The sign-in check must look at this, not at the raw text, or "/%64ata/x" and "/assets/../data/x"
        would slip past a check for "/data/" and still be served. (Found in the v2.0.1 security review.)
        Also rewrites self.path, so the file server and the checks always agree."""
        import posixpath
        url = urlparse(self.path)
        path = unquote(url.path)
        if "\x00" in path or "\\" in path:
            raise BatchError("Not found.", 404)
        clean = posixpath.normpath("/" + path.lstrip("/"))
        if path.endswith("/") and clean != "/":
            clean += "/"
        self.path = clean + (f"?{url.query}" if url.query else "")
        return clean

    def open_to_all(self, path):
        """With accounts on, the only things served without a session: the page itself, its scripts, styles and
        fonts, and the public list of releases. Everything else needs a sign-in. This is a short list of what is
        allowed, not a list of what is private, so a new folder is private until someone decides otherwise."""
        return path in ("/", "/index.html", "/setup.html", "/data/releases.json", "/favicon.ico") or path.startswith("/assets/")

    def host_ok(self):
        """While Penny only listens on this computer, the address in the request must be this computer's. A web
        page elsewhere can point its own name at 127.0.0.1 to reach Penny through your browser (DNS rebinding);
        its requests carry that other name, so they are refused here."""
        if not getattr(self.server, "local_only", False):
            return True
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
        return host in ("127.0.0.1", "localhost", "::1")

    def list_directory(self, path):
        """Never show a folder's contents as a page."""
        self.send_error(404, "Not found")
        return None

    def do_HEAD(self):
        """The same checks as a read: asking only for a file's size must not get past sign-in."""
        try:
            if not self.host_ok():
                raise BatchError("Request refused.", 403)
            path = self.plain_path()
            if self.service.accounts.enabled() and not self.open_to_all(path) and not self.me():
                raise BatchError("Please sign in.", 401)
        except BatchError as e:
            self.send_response(e.status)
            self.send_header("Content-Length", "0")
            return self.end_headers()
        return super().do_HEAD()

    def do_GET(self):
        """Read requests: sign-in state, the data file, people, the outbox, the audit log, then static files.
        With accounts on, everything about invoices and people needs a session."""
        try:
            if not self.host_ok():
                raise BatchError("Request refused: this Penny only answers on this computer's own address.", 403)
            self.plain_path()
            url = urlparse(self.path)                      # now the cleaned address, with its query
        except BatchError as e:
            return self.send_json({"error": str(e)}, e.status)
        try:
            if url.path == "/api/status":
                return self.send_json(self.status())
            if url.path == "/api/setup":
                self.setup_guard()
                from . import setup
                return self.send_json(setup.state(self.service, self.service.root))
            if url.path == "/api/auth/me":
                who = self.me()
                return self.send_json({"user": who, "accounts": self.service.accounts.enabled()}, 200 if who or not self.service.accounts.enabled() else 401)
            if url.path == "/api/auth/token":
                from .accounts import AccountError
                try:
                    t, u = self.service.accounts.check_token((parse_qs(url.query).get("token") or [""])[0])
                except AccountError as e:
                    raise BatchError(str(e), e.status)
                return self.send_json({"purpose": t["purpose"], "email": u["email"], "name": u["name"], "role": u["role"]})
            # With accounts on, everything about invoices, runs and people needs a session. The page itself,
            # its scripts and styles, and the public release list do not.
            if self.service.accounts.enabled() and not self.open_to_all(url.path) and not self.me():
                return self.send_json({"error": "Please sign in.", "signin": True, "server": self.status()}, 401)
            if url.path == "/api/users":
                who = self.actor(None)
                if who["role"] != "admin":
                    raise BatchError("Only an Admin can manage people.", 403)
                return self.send_json({"users": self.service.accounts.list(), "email": __import__("ap_workflow.mailer", fromlist=["describe"]).describe()})
            if url.path == "/api/people":
                # Anyone signed in may see who can be emailed or chosen as a backup: id, name, email, role and title of
                # active people only.
                self.actor(None)
                return self.send_json({"people": [{k: u[k] for k in ("id", "name", "email", "role", "title")} for u in self.service.accounts.list() if u["status"] == "active"]})
            if url.path == "/api/events":
                # The team's audit log since a number. With wait=N the answer is held back until something new
                # arrives (or N seconds pass), which is how every open browser learns of a teammate's work at once.
                if not self.service.accounts.enabled():
                    return self.send_json({"team": False, "events": [], "last": 0})
                self.actor(None)
                q = parse_qs(url.query)
                num = lambda k: int(v) if (v := (q.get(k) or ["0"])[0]).isdigit() else 0
                after, wait = num("after"), min(25, num("wait"))
                if wait and self.service.store.last() <= after:
                    self.service.store.wait(after, wait)
                events = self.service.store.events(after=after)
                return self.send_json({"team": True, "events": events, "last": events[-1]["seq"] if events else after})
            if url.path == "/api/rules":
                self.actor({"role": "viewer"})
                return self.send_json({"rules": self.service.cfg()[0]})
            if url.path == "/api/log":
                self.actor({"role": "viewer"})
                return self.send_json({"log": self.service.read_log()})
            if url.path == "/api/outbox":
                return self.send_json({"emails": self.service.outbox.list(self.actor({"role": "admin", "id": ""}))})
            if url.path == "/data/penny-data.json":
                # The web app learns it is on the local server from the data it already loads, so the public
                # static site never makes a request that fails.
                data = json.loads((Path(self.web_dir) / "data" / "penny-data.json").read_text(encoding="utf-8"))
                data["server"] = self.status()
                data["batch_log"] = self.service.read_log()          # the live audit log, not the copy from the last export
                if self.service.accounts.enabled():
                    data["rules"] = self.service.cfg()[0]            # the rules Penny runs with now, not the copy from the last export
                return self.send_json(data)
            if url.path == "/api/update":
                # "Check for updates" in the web app: ask GitHub now instead of using today's cached answer.
                force = parse_qs(url.query).get("force") == ["1"]
                info = self.service.update_info(force=force)
                return self.send_json({k: info[k] for k in ("version", "latest", "minimum", "state", "newer", "note", "checked")})
            if url.path == "/api/batches":
                return self.send_json({"batches": self.service.list()})
        except BatchError as e:
            return self.send_json({"error": str(e)}, e.status)
        except Exception as e:
            return self.send_json({"error": self.problem(e)}, 500)
        return super().do_GET()

    def setup_guard(self):
        """The setup wizard is closed unless Penny was started with ./penny setup, and then only to a request
        that carries that run's one-time key and comes from this computer. Anything else gets "not found"."""
        import hmac
        key = self.service.setup_key
        sent = self.headers.get("X-Penny-Setup") or ""
        if not key or not hmac.compare_digest(sent.encode(), key.encode()) or self.client_address[0] not in ("127.0.0.1", "::1"):
            raise BatchError("Not found.", 404)

    def setup_routes(self, parts, raw):
        """The setup wizard's steps (see setup.py). Each answers with the wizard's whole view, so the page stays in step."""
        from . import setup
        self.setup_guard()
        body = json.loads(raw or b"{}")
        if not isinstance(body, dict):
            raise BatchError("The request was not understood.", 400)
        try:
            if parts == ["api", "setup", "package"]:
                return self.send_json(setup.check_package(body.get("path")))
            if parts == ["api", "setup", "admin"]:
                who = setup.first_admin(self.service, body.get("name"), body.get("email"), body.get("password"))
                return self.send_json({"user": {"name": who["name"], "email": who["email"]}, "state": setup.state(self.service, self.service.root)})
            if parts == ["api", "setup", "certificate"]:
                setup.make_certificate(self.service.state_dir, [body.get("host") or ""])
                return self.send_json({"state": setup.state(self.service, self.service.root)})
            if parts == ["api", "setup", "finish"]:
                done = setup.finish(self.service, body)
                return self.send_json({**done, "state": setup.state(self.service, self.service.root)})
        except setup.SetupError as e:
            raise BatchError(str(e), 422)
        raise BatchError("Not found.", 404)

    def problem(self, e):
        """What to tell the browser about an unexpected error. With real accounts the details stay in the
        terminal (they can name folders on this computer) and the browser gets a reference to quote."""
        if not self.service.accounts.enabled():
            return f"Penny hit an unexpected problem: {type(e).__name__}: {e}"
        import sys, traceback, uuid
        ref = uuid.uuid4().hex[:8]
        print(f"[{ref}] {self.command} {self.path}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return f"Penny hit an unexpected problem. Tell your Admin this reference: {ref}"

    def addr(self):
        """The computer asking. Behind a proxy on this same computer (--allow-http), every request arrives from
        the proxy, so the address the proxy reports is used instead; otherwise one person could lock everyone out."""
        peer = self.client_address[0]
        if getattr(self.server, "behind_proxy", False) and peer in ("127.0.0.1", "::1"):
            said = (self.headers.get("X-Forwarded-For") or "").split(",")[-1].strip()
            return said[:64] or peer
        return peer

    def account_routes(self, parts, raw):
        """Sign-in, links, people and preferences. Returns a response, or None when the path is not one of these."""
        acc = self.service.accounts
        if parts[:2] != ["api", "auth"] and parts[:2] != ["api", "users"] and parts not in (["api", "me", "prefs"], ["api", "me", "profile"], ["api", "me", "password"]):
            return None
        body = json.loads(raw or b"{}")
        if parts == ["api", "auth", "login"]:
            if not acc.enabled():
                raise BatchError("This copy of Penny uses the demo accounts.", 409)
            token, user = acc.sign_in(body.get("email"), body.get("password"), addr=self.addr())
            return self.send_json({"user": user}, cookie=token)
        if parts == ["api", "auth", "logout"]:
            acc.sign_out(self.session_token())
            return self.send_json({"ok": True}, cookie="")
        if parts in (["api", "auth", "activate"], ["api", "auth", "reset"]):
            user = acc.use_token(body.get("token"), body.get("password"), body.get("name") if parts[2] == "activate" else None)
            return self.send_json({"user": user})
        if parts == ["api", "auth", "forgot"]:
            user, token, hours = acc.forgot(body.get("email"))
            if user:
                self.service.account_email("reset", user, token, hours, None, self.base_url())
            return self.send_json({"ok": True})
        who = self.actor(None)
        if parts == ["api", "me", "prefs"]:
            return self.send_json({"prefs": acc.set_prefs(who, body.get("prefs"))})
        if parts == ["api", "me", "profile"]:           # (v2.3) your own name, title, about line, backup person and photo
            self.service.paused("Changing your profile")
            user, diff = acc.update_profile(who, body.get("changes") or {})
            return self.send_json({"user": user, "changes": diff})
        if parts == ["api", "me", "password"]:          # (v2.3) a new password, while signed in
            return self.send_json({"user": acc.change_password(who, body.get("current"), body.get("password"), keep_session=self.session_token())})
        if parts == ["api", "users"]:
            self.service.paused("Inviting people")
            user, token, hours = acc.invite(who, body.get("email"), body.get("name"), body.get("role"), body.get("title", ""))
            sent = self.service.account_email("invite", user, token, hours, who["name"], self.base_url())
            return self.send_json({"user": user, "email": {k: sent[k] for k in ("status", "error", "id")}}, 201)
        if len(parts) == 4 and parts[3] in ("reset", "resend"):
            user, token, hours = (acc.send_reset if parts[3] == "reset" else acc.resend)(who, parts[2])
            sent = self.service.account_email("reset" if parts[3] == "reset" else "invite", user, token, hours, who["name"], self.base_url())
            return self.send_json({"user": user, "email": {k: sent[k] for k in ("status", "error", "id")}})
        if len(parts) == 3:
            self.service.paused("Changing people")
            user, diff = acc.update(who, parts[2], body.get("changes") or {})
            return self.send_json({"user": user, "changes": diff})
        raise BatchError("Not found.", 404)

    def work_routes(self, parts, url, raw):
        """Email, batches, rechecks, the rule simulator and manual entry. Returns a response, or None when the
        path is not one of these. Each call acts as the signed-in person (see actor)."""
        if parts[:2] == ["api", "setup"]:
            return self.setup_routes(parts, raw)
        if parts == ["api", "events"]:
            # One action from the web app: checked here, then added to the audit log (see actions.py).
            if not self.service.accounts.enabled():
                raise BatchError("This Penny has no real accounts yet, so actions stay in the browser.", 409)
            from . import actions
            try:
                saved = actions.record(self.service, self.actor(None), json.loads(raw or b"{}").get("event"))
            except actions.ActionError as e:
                raise BatchError(str(e), e.status)
            out = {"event": saved}
            if saved["type"].startswith("rules."):
                out["rules"] = self.service.cfg()[0]
            return self.send_json(out)
        if parts == ["api", "events", "import"]:
            from . import actions
            try:
                return self.send_json(actions.bring_in(self.service, self.actor(None), json.loads(raw or b"{}").get("events")))
            except actions.ActionError as e:
                raise BatchError(str(e), e.status)
        if parts == ["api", "watch", "scan"]:
            # "Check now" on the New batch page: look at the watched folder right away instead of waiting.
            check_user(self.actor(json.loads(raw or b"{}").get("user")), "upload")
            if not self.service.watcher:
                raise BatchError("The watched folder is turned off. Start Penny with --watch to turn it on.", 409)
            picked = self.service.watcher.scan()
            return self.send_json({"picked_up": picked, "watch": self.service.watcher.status()})
        if parts == ["api", "email"]:
            body = json.loads(raw or b"{}")
            return self.send_json(self.service.email(self.actor(body.get("user")), body.get("kind"), body.get("to") or [], body.get("note", ""),
                                                body.get("run_id", ""), body.get("doc_id", ""), body.get("file", ""), self.base_url()))
        if parts == ["api", "batches"]:
            body = json.loads(raw or b"{}")
            return self.send_json(self.service.create(body.get("name"), self.actor(body.get("user")), body.get("date"), event_id=str(body.get("event_id", ""))[:40]), 201)
        if len(parts) == 4 and parts[:2] == ["api", "batches"] and parts[3] == "files":
            q = parse_qs(url.query)
            user = self.actor(json.loads(self.headers.get("X-Penny-User") or "{}"))
            return self.send_json(self.service.add_file(parts[2], (q.get("name") or [""])[0], raw, user), 201)
        if len(parts) == 4 and parts[:2] == ["api", "batches"] and parts[3] == "uploaded":
            body = json.loads(raw or b"{}")
            return self.send_json(self.service.finish_upload(parts[2], self.actor(body.get("user")), str(body.get("event_id", ""))[:40]))
        if len(parts) == 4 and parts[:2] == ["api", "batches"] and parts[3] == "run":
            body = json.loads(raw or b"{}")
            return self.send_json(self.service.run(parts[2], self.actor(body.get("user")), bool(body.get("dry_run", True)), str(body.get("event_id", ""))[:40]))
        if parts == ["api", "recheck"] and self.headers.get("Content-Type", "").startswith("application/pdf"):
            q = parse_qs(url.query)
            user = self.actor(json.loads(self.headers.get("X-Penny-User") or "{}"))
            return self.send_json(self.service.recheck(user, (q.get("run") or [""])[0], (q.get("doc") or [""])[0], "file",
                                                  pdf=raw, pdf_name=(q.get("name") or [""])[0], event_id=(q.get("event_id") or [""])[0][:40]))
        if parts == ["api", "recheck"]:
            body = json.loads(raw or b"{}")
            return self.send_json(self.service.recheck(self.actor(body.get("user")), body.get("run_id"), body.get("doc_id"), body.get("source", "saved"),
                                                  rules=body.get("rules"), entry=body.get("entry"), event_id=str(body.get("event_id", ""))[:40]))
        if parts == ["api", "simulate"]:
            body = json.loads(raw or b"{}")
            return self.send_json(self.service.simulate(self.actor(body.get("user")), body.get("rules_now"), body.get("rules_draft")))
        if parts == ["api", "manual"]:
            body = json.loads(raw or b"{}")
            return self.send_json(self.service.save_manual(self.actor(body.get("user")), body.get("run_id"), body.get("doc_id"), body.get("entry"),
                                                      body.get("evidence"), body.get("date"), str(body.get("event_id", ""))[:40]), 201)
        return None

    def do_POST(self):
        """Write requests: sign-in and accounts, email, batches, rechecks, the rule simulator and manual entry."""
        url = urlparse(self.path)
        parts = [p for p in url.path.split("/") if p]
        try:
            if not self.host_ok():
                raise BatchError("Request refused: this Penny only answers on this computer's own address.", 403)
            self.plain_path()
            parts = [p for p in urlparse(self.path).path.split("/") if p]
            length = max(0, int(self.headers.get("Content-Length") or 0)) if (self.headers.get("Content-Length") or "0").strip().isdigit() else 0
            limit = (MAX_EVIDENCE * MAX_EVIDENCE_FILES * 4 // 3 + 1024 * 1024) if parts == ["api", "manual"] else MAX_FILE + 1024
            if parts[:2] == ["api", "events"]:
                limit = 8 * 1024 * 1024 if parts[2:] == ["import"] else 512 * 1024
            if length > limit:
                self.close_connection = True              # do not read an oversized body; answer and hang up
                raise BatchError("That upload is too large.", 413)
            raw = self.rfile.read(length)                 # read what was sent before answering, even when refusing,
            self.guard()                                  # so the browser always receives the reason
            from .accounts import AccountError
            try:
                handled = self.account_routes(parts, raw)
            except AccountError as e:
                raise BatchError(str(e), e.status)
            if handled is not None:
                return handled
            handled = self.work_routes(parts, url, raw)
            if handled is not None:
                return handled
            raise BatchError("Not found.", 404)
        except BatchError as e:
            return self.send_json({"error": str(e)}, e.status)
        except json.JSONDecodeError:
            return self.send_json({"error": "The request was not valid JSON."}, 400)
        except Exception as e:                            # never leave the browser hanging without a reason
            return self.send_json({"error": self.problem(e)}, 500)


def make_handler(service, web_dir):
    """The request handler class for one BatchService: PennyHandler with its service and web folder filled in."""
    return type("Handler", (PennyHandler,), {"service": service, "web_dir": web_dir})

LOOPBACK = ("127.0.0.1", "localhost", "::1")


class QuietServer(http.server.ThreadingHTTPServer):
    """The web server. A connection that drops, or that is not https when https is expected, is not worth a
    stack trace in the terminal; anything else still is."""
    def handle_error(self, request, client_address):
        """Stay quiet about dropped connections; report anything else as usual."""
        import ssl, sys
        if not isinstance(sys.exc_info()[1], (ssl.SSLError, ConnectionError, TimeoutError)):
            super().handle_error(request, client_address)


def network_problem(service, host, cert, key, allow_http):
    """Why Penny will not listen on this address, or '' when it may. Other computers can only reach Penny when
    people sign in with real accounts and the connection is encrypted."""
    if host in LOOPBACK:
        return ""
    if not service.accounts.enabled():
        return ("Penny will not open to other computers until people sign in with real accounts.\n"
                'Create the first Admin:  ./penny users invite --email you@company.com --name "Your Name" --role admin')
    if not (cert and key) and not allow_http:
        return ("Penny will not open to other computers without https, because passwords and invoices would cross the network in the clear.\n"
                "Make a certificate:   ./penny cert --host <this computer's name>\n"
                "Then start with:      ./penny web --host 0.0.0.0 --https\n"
                "(If a proxy in front of Penny already provides https, add --allow-http and set PENNY_PUBLIC_URL to the https address.)")
    return ""


def make_server(service, web_dir, port, host="127.0.0.1", cert=None, key=None):
    """The web server, listening on `host`. With a certificate and key it speaks https (TLS 1.2 or newer)."""
    httpd = QuietServer((host, port), make_handler(service, web_dir))
    httpd.secure = str(os.environ.get("PENNY_PUBLIC_URL", "")).startswith("https://")     # https provided by a proxy in front
    httpd.local_only = host in LOOPBACK                    # see PennyHandler.host_ok
    httpd.behind_proxy = False                             # set by serve() for --allow-http; see PennyHandler.addr
    if cert and key:
        import ssl
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(str(cert), str(key))
        # The handshake happens on the connection's own thread, so one slow client cannot hold up everyone else.
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True, do_handshake_on_connect=False)
        httpd.secure = True
    return httpd


def serve(service, web_dir, port, open_browser=True, host="127.0.0.1", cert=None, key=None, allow_http=False):
    """Run the web app until Ctrl+C. By default only this computer can reach it (127.0.0.1). With --host it is
    open to the network, which needs real accounts and https (see network_problem)."""
    import webbrowser
    problem = network_problem(service, host, cert, key, allow_http)
    if problem:
        raise SystemExit(problem)
    httpd = make_server(service, web_dir, port, host, cert, key)
    httpd.behind_proxy = bool(allow_http)
    if allow_http and host in LOOPBACK and str(os.environ.get("PENNY_PUBLIC_URL", "")).startswith("http"):
        httpd.local_only = False                           # a proxy on this computer forwards the public name
    scheme = "https" if cert and key else "http"
    url = f"{scheme}://{'127.0.0.1' if host in ('0.0.0.0', '::') else host}:{port}/"
    print(f"Penny web app: {url}   (Ctrl+C to stop)")
    if host not in LOOPBACK:
        import socket
        print(f"  Open to the network. Teammates use:  {os.environ.get('PENNY_PUBLIC_URL') or f'{scheme}://{socket.gethostname()}:{port}/'}")
    if service.moved:
        print("  Moved into the database (state/penny.db): " + ", ".join(f"{n} {what}" for what, n in service.moved.items()) + ". The old files were renamed with .moved on the end.")
    print("  Team mode: " + ("on. Everything people do is checked and saved on this computer." if service.accounts.enabled()
                             else "off (no real accounts yet, so the demo accounts are used and actions stay in each browser)."))
    if service.watcher:
        print(f"  Watched folder: {service.watcher.display()} (checked every {service.watcher.every} seconds; previews only)")
        service.watcher.start()
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
