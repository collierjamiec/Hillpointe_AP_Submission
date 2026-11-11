"""Penny's database: one SQLite file, state/penny.db. (Added after submission, v2.0.)

Why SQLite: it is built into Python, it is one file with nothing to install or run, and it lets several people use
Penny at once without two changes overwriting each other.

What is in it
  events   the audit log. Every action a person takes in the web app, every rule change, and everything the server
           itself records (batches, runs, rechecks, sign-ins, emails, the watched folder). Each row has a number
           (seq) that only goes up, which is how browsers ask "what is new since I last looked?".
  docs     small whole documents kept as JSON: the people who can sign in ("users") and their invitation and reset
           links ("tokens"). Password hashes never leave the server.
  meta     the layout version and which one-time moves have been done.

The audit log only allows new entries. That is enforced by the database, not by good manners: two triggers refuse
every UPDATE and DELETE on the events table. An undo is a new entry that points at the one it undoes.

What is not in it: the processed-invoice register (state/processed_register.csv and run_log.csv) and the run
folders. Those belong to the engine, which also runs from the terminal with no server, and the files are what a
person or an auditor opens. The server takes a lock around every run, so two runs cannot write them at once.

The one-time move (see migrate): state/batch_log.jsonl, users.json and tokens.json from before 2.0 are copied into
the database and the old files are renamed with ".moved" on the end. Nothing is deleted.
"""
import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path

LAYOUT = 1
ORIGINS = ("web", "server", "import")     # a person in the web app; the server's own record; moved from a browser


class Store:
    """Penny's database (state/penny.db): the audit log that can only grow, plus accounts and settings."""

    def __init__(self, state_dir):
        """Open (and create if needed) state/penny.db."""
        self.dir = Path(state_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path = self.dir / "penny.db"
        self.lock = threading.RLock()                  # one writer at a time inside this process
        self.news = threading.Condition()              # wakes everyone waiting for a new event
        self._last = 0
        with self._db() as db:
            db.executescript("""
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS events (
                    seq     INTEGER PRIMARY KEY AUTOINCREMENT,
                    uid     TEXT NOT NULL UNIQUE,
                    at      TEXT NOT NULL,
                    type    TEXT NOT NULL,
                    origin  TEXT NOT NULL,
                    subject TEXT NOT NULL DEFAULT '',
                    user_id TEXT NOT NULL DEFAULT '',
                    body    TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS events_subject ON events (subject, seq);
                CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
                    BEGIN SELECT RAISE(ABORT, 'The audit log only allows new entries.'); END;
                CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
                    BEGIN SELECT RAISE(ABORT, 'The audit log only allows new entries.'); END;
                CREATE TABLE IF NOT EXISTS docs (key TEXT PRIMARY KEY, body TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1);
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                INSERT OR IGNORE INTO meta (key, value) VALUES ('layout', '%d');
            """ % LAYOUT)
            self._last = db.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]

    def _open(self):
        """A new connection. The caller closes it."""
        db = sqlite3.connect(str(self.path), timeout=30)
        db.execute("PRAGMA busy_timeout = 30000")
        return db

    @contextmanager
    def _db(self):
        """A connection for one piece of work: `with self._db() as db:` commits (or rolls back on an error), then closes."""
        db = self._open()
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    # ------------------------------------------------------------------ the audit log
    @staticmethod
    def _row(seq, origin, body):
        """One stored event as the dict the rest of Penny uses: its own fields, plus seq and where it came from."""
        return {**json.loads(body), "seq": seq, "origin": origin}

    def append(self, event, origin, subject="", uid=None, check=None):
        """Add one event and return it with its number. `uid` makes a retry safe: the same uid is stored once and
        the first copy is returned. `check(db)` runs inside the same write lock just before the insert, so a rule
        like "this hold is still open" cannot be broken by two people saving at the same moment."""
        assert origin in ORIGINS, origin
        uid = uid or uuid.uuid4().hex
        with self.lock:
            db = self._open()
            try:
                db.execute("BEGIN IMMEDIATE")              # take the write lock before looking, not after
                old = db.execute("SELECT seq, origin, body FROM events WHERE uid = ?", (uid,)).fetchone()
                if old:
                    db.execute("COMMIT")
                    return {**self._row(*old), "repeat": True}
                if check:
                    check(db)
                who = event.get("user") or event.get("by") or {}
                cur = db.execute("INSERT INTO events (uid, at, type, origin, subject, user_id, body) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                 (uid, str(event.get("at", "")), str(event.get("type") or event.get("event") or ""), origin, subject,
                                  str(who.get("id", "")), json.dumps(event, sort_keys=True)))
                seq = cur.lastrowid
                db.execute("COMMIT")
            except BaseException:
                if db.in_transaction:
                    db.execute("ROLLBACK")
                raise
            finally:
                db.close()
            self._last = seq
        with self.news:
            self.news.notify_all()
        return {**event, "seq": seq, "origin": origin}

    def events(self, after=0, origins=None, db=None):
        """Every event with a number above `after`, oldest first. `origins` narrows it to some sources."""
        sql, args = "SELECT seq, origin, body FROM events WHERE seq > ?", [int(after)]
        if origins:
            sql += " AND origin IN (%s)" % ",".join("?" * len(origins))
            args += list(origins)
        own = db is None
        db = db or self._open()
        try:
            return [self._row(*r) for r in db.execute(sql + " ORDER BY seq", args)]
        finally:
            if own:
                db.close()

    def about(self, subject, db=None):
        """Every event about one thing (an invoice, an import file, the rules), oldest first."""
        own = db is None
        db = db or self._open()
        try:
            return [self._row(*r) for r in db.execute("SELECT seq, origin, body FROM events WHERE subject = ? ORDER BY seq", (subject,))]
        finally:
            if own:
                db.close()

    def last(self):
        """The number of the newest event (0 when the log is empty)."""
        return self._last

    def wait(self, after, seconds):
        """Wait up to `seconds` for an event newer than `after`. True when there is one."""
        with self.news:
            return self.news.wait_for(lambda: self._last > after, timeout=seconds)

    # ------------------------------------------------------------------ small documents
    def doc(self, key, default=None):
        """One stored document (parsed JSON), or `default` when there is none."""
        with self._db() as db:
            row = db.execute("SELECT body FROM docs WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def doc_rev(self, key):
        """How many times a document has been saved (0 when it does not exist). Lets a reader reuse a parsed copy."""
        with self._db() as db:
            row = db.execute("SELECT rev FROM docs WHERE key = ?", (key,)).fetchone()
        return row[0] if row else 0

    def set_doc(self, key, value):
        """Save one document, replacing the last copy in a single step (never half written)."""
        with self.lock, self._db() as db:
            db.execute("INSERT INTO docs (key, body) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, rev = rev + 1",
                       (key, json.dumps(value)))

    def meta(self, key, default=""):
        """One setting about the database itself."""
        with self._db() as db:
            row = db.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row[0] if row else default

    def set_meta(self, key, value):
        """Save one setting about the database itself."""
        with self.lock, self._db() as db:
            db.execute("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, str(value)))

    # ------------------------------------------------------------------ the one-time move from before 2.0
    def migrate(self):
        """Copy the files Penny kept before 2.0 into the database: the audit log (batch_log.jsonl), people
        (users.json) and their links (tokens.json). Each file is moved once, then renamed with ".moved" on the end
        so it is never read again and nothing is lost. Safe to call every time Penny starts. Returns what it did."""
        done = {}
        log = self.dir / "batch_log.jsonl"
        if log.exists():
            lines = [line for line in log.read_text(encoding="utf-8").splitlines() if line.strip()]
            n = 0
            for i, line in enumerate(lines):
                try:
                    event = json.loads(line)
                except ValueError:
                    continue                                  # a half-written last line from a crash: leave it behind
                self.append(event, "server", subject=str(event.get("doc_id") or event.get("batch") or ""), uid=f"moved-log-{i}")
                n += 1
            log.rename(log.with_name(log.name + ".moved"))
            done["audit log entries"] = n
        for name, key in (("users.json", "users"), ("tokens.json", "tokens")):
            path = self.dir / name
            if not path.exists():
                continue
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
            except ValueError:
                continue                                      # unreadable: leave the file where it is for a person to look at
            if self.doc(key) is None:
                self.set_doc(key, value)
            path.rename(path.with_name(name + ".moved"))
            done["people" if key == "users" else "invitation and reset links"] = len(value.get("users", [])) if key == "users" else len(value)
        if done:
            self.set_meta("moved_from_files", json.dumps(done))
        return done
