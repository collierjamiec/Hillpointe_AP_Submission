"""The watched inbox folder. (Added after submission, v1.9.)

Drop invoice PDFs into one folder (inbox/_incoming by default) and Penny picks them up by itself: it moves them into a
new dated batch, records who and what, and runs a preview. A person still decides everything after that.

  ./penny web --package <folder> --watch            # watch inbox/_incoming
  ./penny web --package <folder> --watch ~/Scans    # or any folder you choose
  or set "watch": {"enabled": true} in config/rules.json

What it will and will not do
  * It only ever runs a PREVIEW (a dry run). The register is never changed, so nothing can be entered because a file
    appeared in a folder. An Admin runs the batch for real from New batch, as always.
  * A file is taken only when it has stopped changing (its size is the same on two looks and it was last written a few
    seconds ago), so a scan or download that is still being written is left alone.
  * Only real PDFs are taken: the name ends in .pdf, the content starts with %PDF, and it is 25 MB or less. Anything
    else stays where it is, and the reason is shown on the New batch page. Penny never deletes a file from the folder.
  * Links (shortcuts to files elsewhere), hidden files and sub-folders are ignored, so the watcher cannot be pointed
    at files outside the folder.
  * While a required update is waiting, pickups pause like every other change.

Every pickup is written to the audit log as watch.picked_up with each file's name, size and SHA-256, followed by the
usual batch and preview entries.
"""
import shutil
import threading
import time
from pathlib import Path

WATCHER = {"id": "watched-folder", "name": "Watched folder", "role": "clerk"}   # who the audit log names; it can only preview
PARTIAL = (".crdownload", ".part", ".partial", ".tmp", ".download")
SETTLE_SECONDS = 5
DEFAULT_FOLDER = "inbox/_incoming"


class Watcher:
    """Watches the inbox folder for finished PDFs and turns them into batches for a preview."""

    def __init__(self, service, folder=None, every=15, clock=time.time):
        """Watch `folder` for `service`. `every` is the seconds between looks; `clock` can be replaced in tests."""
        self.service = service
        self.folder = Path(folder) if folder and Path(folder).is_absolute() else service.root / (folder or DEFAULT_FOLDER)
        self.every = max(5, int(every or 15))
        self.clock = clock
        self.sizes = {}             # name -> size at the last look, to tell when a file has stopped growing
        self.ignored = {}           # name -> why it was not taken
        self.last_scan = None
        self.last_pickup = None
        self.error = ""
        self._stop = threading.Event()

    # ------------------------------------------------------------------ one look
    def _check(self, path):
        """'' when the file can be taken, 'wait' when it may still be changing, else the reason it is left alone."""
        name = path.name
        if path.is_symlink():
            return "It is a link to a file somewhere else, so Penny leaves it alone."
        if name.lower().endswith(PARTIAL):
            return "wait"
        if not name.lower().endswith(".pdf"):
            return "It is not a PDF. Only .pdf invoices are picked up."
        st = path.stat()
        from .webserver import MAX_FILE
        if st.st_size > MAX_FILE:
            return "It is larger than 25 MB."
        seen = self.sizes.get(name)
        self.sizes[name] = st.st_size
        if seen != st.st_size or self.clock() - st.st_mtime < SETTLE_SECONDS:
            return "wait"
        with open(path, "rb") as f:
            if not f.read(1024).lstrip().startswith(b"%PDF"):
                return "Its name ends in .pdf but it is not really a PDF."
        return ""

    def scan(self):
        """Look once. Takes every PDF that is ready into one new batch and previews it. Returns the pickup event, or
        None when nothing was ready. Never raises: a problem is kept in `error` and shown on the New batch page."""
        self.last_scan = self.service.now().isoformat(timespec="seconds")
        self.error = ""
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            ready, ignored = [], {}
            for path in sorted(self.folder.iterdir()):
                if path.name.startswith(".") or (path.is_dir() and not path.is_symlink()):
                    continue
                why = self._check(path)
                if why == "":
                    ready.append(path)
                elif why != "wait":
                    ignored[path.name] = why
            self.ignored = ignored
            self.sizes = {n: s for n, s in self.sizes.items() if (self.folder / n).exists()}
            if not ready:
                return None
            return self._pick_up(ready)
        except Exception as e:                        # the watcher must never take the server down
            self.error = f"{type(e).__name__}: {e}"[:300]
            return None

    def _pick_up(self, ready):
        """Move the ready files into a new batch, record it, and run a preview when the engine is available."""
        from .webserver import BatchError, safe_filename
        svc = self.service
        try:
            made = svc.create("watched folder", WATCHER)
        except BatchError as e:                       # for example: a required update is waiting
            self.error = str(e)
            return None
        dest = svc.inbox / made["batch"]
        taken = []
        for path in ready:
            name, n = safe_filename(path.name), 2
            while (dest / name).exists():
                name, n = f"{Path(safe_filename(path.name)).stem}-{n}.pdf", n + 1
            shutil.move(str(path), str(dest / name))
            self.sizes.pop(path.name, None)
            taken.append(name)
        up = svc.finish_upload(made["batch"], WATCHER)
        event = svc.log({"event": "watch.picked_up", "batch": made["batch"], "folder": made["folder"], "by": WATCHER,
                         "from": self.display(), "files": up["files"], "count": len(taken)})
        self.last_pickup = {"batch": made["batch"], "at": event["at"], "count": len(taken), "preview": ""}
        if svc.package:
            try:
                ran = svc.run(made["batch"], WATCHER, dry_run=True)
                self.last_pickup["preview"] = ran["run_id"]
            except BatchError as e:
                self.error = f"The files were picked up, but the preview did not run: {e}"
        return event

    # ------------------------------------------------------------------ running and reporting
    def display(self):
        """The folder as shown to people: relative to Penny's folder when it is inside it."""
        try:
            return self.folder.resolve().relative_to(self.service.root.resolve()).as_posix()
        except ValueError:
            return str(self.folder)

    def status(self):
        """What the New batch page shows about the watched folder."""
        return {"enabled": True, "folder": self.display(), "every_seconds": self.every, "last_scan": self.last_scan,
                "last_pickup": self.last_pickup, "error": self.error,
                "ignored": [{"name": n, "why": w} for n, w in sorted(self.ignored.items())][:20]}

    def start(self):
        """Look every `every` seconds on a background thread until stop() is called."""
        def loop():
            """Look again every few seconds until told to stop."""
            while not self._stop.wait(self.every):
                self.scan()
        self.scan()
        threading.Thread(target=loop, daemon=True, name="penny-watcher").start()

    def stop(self):
        """Stop looking (the current look, if any, finishes first)."""
        self._stop.set()
