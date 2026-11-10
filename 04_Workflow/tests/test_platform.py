"""What runs around the engine: versions and updates, accounts, email, and the speed and security groundwork.
Run everything with:  ./penny test   (or: python -m unittest discover -s tests -v)"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))      # so one file can also be run on its own
from common import *        # noqa: F401,F403  (paths, PKG, needs_package, EXPECTED, outcome, cli, syn)  # noqa: E402


class VersionTests(unittest.TestCase):
    """(added after submission, v1.6) One version everywhere; required updates pause real runs and changes only."""

    def setUp(self):
        from ap_workflow import version
        self.v = version
        self.tmp = Path(tempfile.mkdtemp())
        self.rel = [{"version": "1.6.0", "required": False, "summary": "this one"}, {"version": "1.5.0", "required": False, "summary": "older"}]

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_versions_have_three_whole_numbers(self):
        self.assertEqual(self.v.parse("1.10.2"), (1, 10, 2))
        self.assertGreater(self.v.parse("1.10.0"), self.v.parse("1.9.9"))      # compared as numbers, not text
        for bad in ("1.6", "v1.6.0", "1.6.0-beta", "", None, "1.6.0.1"):
            with self.assertRaises(self.v.VersionError):
                self.v.parse(bad)

    def test_every_place_the_version_lives_agrees(self):
        c = self.v.consistency()
        self.assertEqual(len(set(c.values())), 1, c)
        self.assertEqual(json.loads((ROOT / "releases.json").read_text()), json.loads((ROOT / "web" / "data" / "releases.json").read_text()))

    def test_status_optional_skipped_required(self):
        st = lambda rel, skipped=None: self.v.status("1.6.0", rel, skipped)["state"]
        self.assertEqual(st(self.rel), "current")
        newer = [{"version": "1.7.0", "required": False}] + self.rel
        self.assertEqual(st(newer), "optional")
        self.assertEqual(st(newer, skipped="1.7.0"), "skipped")
        self.assertEqual(st([{"version": "1.8.0", "required": False}] + newer, skipped="1.7.0"), "optional")   # a skip lasts until the next one
        required = [{"version": "1.7.0", "required": True}] + self.rel
        self.assertEqual(st(required, skipped="1.7.0"), "required")                                          # required cannot be skipped
        self.assertEqual(self.v.status("1.7.1", [{"version": "1.8.0"}] + required)["state"], "optional")     # above the minimum: optional again

    def test_check_caches_falls_back_and_can_be_turned_off(self):
        from unittest import mock
        root = self.tmp / "app"
        (root / "web" / "assets").mkdir(parents=True)
        (root / "VERSION").write_text("1.6.0\n")
        (root / "releases.json").write_text(json.dumps({"releases": self.rel}))
        remote = json.dumps({"releases": [{"version": "1.7.0", "required": True, "summary": "fix"}] + self.rel})
        calls = []
        fetch = lambda url: calls.append(url) or remote
        state = self.tmp / "state"
        with mock.patch.dict(os.environ, {"PENNY_NO_UPDATE_CHECK": ""}):
            first = self.v.check(state, root=root, fetch=fetch, now=1000)
            again = self.v.check(state, root=root, fetch=fetch, now=1000 + 3600)
            later = self.v.check(state, root=root, fetch=lambda u: (_ for _ in ()).throw(OSError("offline")), now=1000 + 2 * 86400)
        self.assertEqual((first["state"], first["minimum"], first["checked"]), ("required", "1.7.0", "now"))
        self.assertEqual((again["checked"], len(calls)), ("cache", 1))                 # at most one download a day
        self.assertEqual((later["checked"], later["state"]), ("failed", "required"))   # offline: keeps the last answer, never raises
        self.assertIn("Could not check", later["note"])
        off = self.v.check(state, root=root, fetch=fetch)                              # PENNY_NO_UPDATE_CHECK=1 from the module
        self.assertEqual((off["checked"], len(calls)), ("off", 1))

    def test_release_writes_everywhere_and_refuses_mistakes(self):
        root = self.tmp / "app"
        shutil.copytree(ROOT / "web" / "assets", root / "web" / "assets")
        (root / "web" / "data").mkdir(parents=True)
        for f in ("VERSION", "releases.json"):
            shutil.copy2(ROOT / f, root / f)
        shutil.copy2(ROOT / "releases.json", root / "web" / "data" / "releases.json")
        from datetime import date
        major, minor, _ = self.v.parse(self.v.current(root))
        nxt, later = f"{major}.{minor + 1}.0", f"{major}.{minor + 2}.0"          # always newer than today's version
        entry = self.v.release(nxt, "Fixes a rounding problem in tax splits.", ["Tax splits round to the cent."], required=True, root=root, today=date(2026, 12, 1))
        self.assertEqual(entry, {"version": nxt, "date": "2026-12-01", "required": True, "summary": "Fixes a rounding problem in tax splits.", "notes": ["Tax splits round to the cent."]})
        self.assertEqual(set(self.v.consistency(root).values()), {nxt})
        self.assertEqual(self.v.minimum(self.v.load_releases(root / "releases.json")), nxt)
        for args in ((nxt, "Same version again."), (f"{major}.{minor}.9", "Older than the current one."), (later, "short"), (f"{major}.{minor + 2}", "Not three numbers here.")):
            with self.subTest(args=args):
                with self.assertRaises(self.v.VersionError):
                    self.v.release(*args, root=root)

    def test_required_update_pauses_real_runs_and_changes_only(self):
        from unittest import mock
        from ap_workflow import webserver
        svc = webserver.BatchService(self.tmp, None, self.tmp / "state", self.tmp / "runs", self.tmp / "web", ROOT / "config" / "rules.json")
        required = self.v.status("1.6.0", [{"version": "1.7.0", "required": True}] + self.rel)
        clerk = {"id": "avery", "name": "Avery Chen", "role": "clerk"}
        batch = svc.create("before the update", clerk)["batch"]
        with mock.patch.object(svc, "update_info", return_value=required):
            for call in (lambda: svc.create("after", clerk), lambda: svc.add_file(batch, "a.pdf", b"%PDF-1.4", clerk),
                         lambda: svc.run(batch, {"id": "sam", "name": "Sam Rivera", "role": "admin"}, dry_run=False)):
                with self.assertRaises(webserver.BatchError) as e:
                    call()
                self.assertEqual(e.exception.status, 409)
                self.assertIn("./penny update", str(e.exception))
            self.assertEqual(svc.list()[0]["batch"], batch)                          # reading still works
            with self.assertRaises(webserver.BatchError) as e:
                svc.run(batch, clerk, dry_run=True)                                  # a preview is not paused...
            self.assertNotEqual(e.exception.status, 409)                             # ...it stops only because the batch is empty
        with mock.patch.object(cli, "update_notice", return_value=required):
            with self.assertRaises(SystemExit) as e:
                cli.main(["run", "1"])
        self.assertIn("required update", str(e.exception.code))

    def test_check_for_updates_endpoint(self):
        """The web app's "Check for updates" asks the server, which answers with this version against the newest."""
        import threading, urllib.request, http.server
        from unittest import mock
        from ap_workflow import webserver
        svc = webserver.BatchService(self.tmp, None, self.tmp / "state", self.tmp / "runs", self.tmp / "web", ROOT / "config" / "rules.json")
        optional = self.v.status("1.6.0", [{"version": "1.6.1", "required": False, "summary": "fix"}] + self.rel)
        seen = []
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), webserver.make_handler(svc, self.tmp / "web"))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            with mock.patch.object(svc, "update_info", side_effect=lambda force=False: seen.append(force) or {**optional, "note": "", "checked": "now"}):
                with urllib.request.urlopen(f"http://127.0.0.1:{httpd.server_address[1]}/api/update?force=1") as r:
                    body = json.loads(r.read())
        finally:
            httpd.shutdown()
            httpd.server_close()
        self.assertEqual((body["version"], body["latest"], body["state"], body["checked"]), ("1.6.0", "1.6.1", "optional", "now"))
        self.assertEqual(seen, [True])                                               # asked GitHub now, not the cached answer

    def test_update_ignores_the_persons_own_data(self):
        porcelain = "\n".join([" M 04_Workflow/state/processed_register.csv", "?? 04_Workflow/inbox/2026-11-10_x/", " M 04_Workflow/runs/run9/decisions.json",
                               " M 04_Workflow/web/data/penny-data.json", " M 04_Workflow/ap_workflow/rules.py", "R  04_Workflow/a.py -> 04_Workflow/b.py"])
        self.assertEqual(cli.changed_code_files(porcelain), ["04_Workflow/ap_workflow/rules.py", "04_Workflow/b.py"])


class AccountTests(unittest.TestCase):
    """(added after submission, v1.7) Real accounts for Penny on a computer: invites, passwords, sessions, guards."""
    GOOD = "copper kettle morning"

    def setUp(self):
        from ap_workflow import accounts
        self.a = accounts
        self.tmp = Path(tempfile.mkdtemp())
        self.t = [1_000_000.0]
        self.log = []
        self.acc = accounts.Accounts(self.tmp, log=self.log.append, clock=lambda: self.t[0])
        self.boss, tok, _ = self.acc.invite(None, "Sam@Hillpointe.com", "Sam Rivera", "admin", bootstrap=True)
        self.acc.use_token(tok, self.GOOD)
        self.sam = {"id": self.boss["id"], "name": "Sam Rivera", "role": "admin"}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_invite_link_works_once_and_is_stored_only_as_a_hash(self):
        u, token, hours = self.acc.invite(self.sam, "avery@hillpointe.com", "Avery Chen", "clerk", "AP specialist")
        self.assertEqual((u["status"], u["role"], hours), ("invited", "clerk", 72))
        self.assertNotIn(token, (self.tmp / "tokens.json").read_text())
        with self.assertRaises(self.a.AccountError):
            self.acc.use_token(token, "short")                                 # weak password: link still usable
        with self.assertRaises(self.a.AccountError) as e:
            self.acc.use_token(token, "avery password here")                    # contains the name
        self.assertIn("name", str(e.exception))
        done = self.acc.use_token(token, self.GOOD, name="Avery Chen")
        self.assertEqual(done["status"], "active")
        with self.assertRaises(self.a.AccountError) as e:
            self.acc.use_token(token, self.GOOD)
        self.assertEqual(e.exception.status, 410)
        stored = (self.tmp / "users.json").read_text()
        self.assertNotIn(self.GOOD, stored)
        self.assertNotIn("password", json.dumps(self.acc.list()).replace("has_password", ""))

    def test_links_expire_and_only_admins_invite(self):
        _, token, _ = self.acc.invite(self.sam, "jordan@hillpointe.com", "Jordan Patel", "approver")
        self.t[0] += 73 * 3600
        with self.assertRaises(self.a.AccountError):
            self.acc.check_token(token)
        with self.assertRaises(self.a.AccountError) as e:
            self.acc.invite({"id": "x", "role": "clerk"}, "z@hillpointe.com", "Zed Zee", "admin")
        self.assertEqual(e.exception.status, 403)
        with self.assertRaises(self.a.AccountError) as e:
            self.acc.invite(self.sam, "sam@hillpointe.com", "Sam Again", "viewer")
        self.assertEqual(e.exception.status, 409)

    def test_sign_in_lockout_sessions_and_idle_timeout(self):
        for i in range(4):
            with self.assertRaises(self.a.AccountError) as e:
                self.acc.sign_in("sam@hillpointe.com", "wrong guess")
        self.assertIn("1 try left", str(e.exception))
        with self.assertRaises(self.a.AccountError):
            self.acc.sign_in("sam@hillpointe.com", "wrong guess")
        with self.assertRaises(self.a.AccountError) as e:
            self.acc.sign_in("sam@hillpointe.com", self.GOOD)                   # locked, even with the right password
        self.assertEqual(e.exception.status, 429)
        self.t[0] += 61
        token, me = self.acc.sign_in("SAM@hillpointe.com ", self.GOOD)
        self.assertEqual(self.acc.session_user(token)["id"], me["id"])
        self.t[0] += 31 * 60
        self.assertIsNone(self.acc.session_user(token))                         # 30 idle minutes end the session
        with self.assertRaises(self.a.AccountError) as e:
            self.acc.sign_in("nobody@hillpointe.com", "anything at all")
        self.assertEqual(str(e.exception).split(".")[0], "That email and password do not match")   # same words: no hint who exists

    def test_admin_changes_and_the_guards(self):
        u, tok, _ = self.acc.invite(self.sam, "avery@hillpointe.com", "Avery Chen", "clerk")
        self.acc.use_token(tok, self.GOOD)
        token, _ = self.acc.sign_in("avery@hillpointe.com", self.GOOD)
        _, diff = self.acc.update(self.sam, u["id"], {"role": "approver", "title": "Project manager"})
        self.assertEqual(diff["role"], ["clerk", "approver"])
        self.assertIsNone(self.acc.session_user(token))                         # a role change signs them out at once
        self.acc.update(self.sam, u["id"], {"status": "inactive"})
        with self.assertRaises(self.a.AccountError) as e:
            self.acc.sign_in("avery@hillpointe.com", self.GOOD)
        self.assertEqual(e.exception.status, 403)
        for changes in ({"status": "inactive"}, {"role": "clerk"}):
            with self.assertRaises(self.a.AccountError):
                self.acc.update(self.sam, self.sam["id"], changes)              # not yourself
        self.assertEqual([e["event"] for e in self.log if e["event"] == "user.updated"], ["user.updated", "user.updated"])
        with self.assertRaises(self.a.AccountError):
            self.acc.update({"id": "avery", "role": "clerk"}, self.sam["id"], {"name": "X Y"})

    def test_last_admin_stays_and_forgot_never_reveals_who_exists(self):
        u, tok, _ = self.acc.invite(self.sam, "kim@hillpointe.com", "Kim Lee", "admin")
        self.acc.use_token(tok, self.GOOD)
        kim = {"id": u["id"], "name": "Kim Lee", "role": "admin"}
        self.acc.update(kim, self.sam["id"], {"role": "viewer"})              # another Admin may demote Sam
        with self.assertRaises(self.a.AccountError) as e:
            self.acc.update(kim, u["id"], {"status": "inactive"})              # but not leave Penny with no Admin
        self.assertIn("own", str(e.exception))
        self.assertEqual(self.acc.forgot("nobody@hillpointe.com"), (None, None, 0))
        user, token, hours = self.acc.forgot("kim@hillpointe.com")
        self.assertEqual((user["id"], hours), (u["id"], 1))
        self.acc.use_token(token, "a brand new phrase")
        self.acc.sign_in("kim@hillpointe.com", "a brand new phrase")


class MailerTests(unittest.TestCase):
    """(added after submission, v1.7) Without a mail server nothing is sent: it is saved and listed. Links are blanked
    out of the saved copy once an email has really been sent."""

    def setUp(self):
        from ap_workflow import mailer
        self.m = mailer
        self.tmp = Path(tempfile.mkdtemp())
        self.box = mailer.Outbox(self.tmp)
        self.who = {"id": "sam", "name": "Sam Rivera", "role": "admin"}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_saved_when_no_mail_server(self):
        from unittest import mock
        with mock.patch.dict(os.environ, {"PENNY_SMTP_HOST": ""}):
            e = self.box.send(["Avery@Hillpointe.com"], "Hello", "Body https://x/#/activate?token=SECRET", self.who, "invite", [("a.csv", b"x,y\n")], redact=["SECRET"])
        self.assertEqual((e["status"], e["to"], e["attachments"][0]["name"]), ("saved", ["avery@hillpointe.com"], "a.csv"))
        self.assertIn("SECRET", (self.tmp / "outbox" / e["file"]).read_text())    # not sent: the Admin needs the link
        self.assertEqual(self.box.list()[0]["id"], e["id"])
        self.assertEqual(self.box.list({"id": "avery", "role": "clerk"}), [])      # people see only what they sent
        with self.assertRaises(ValueError):
            self.box.send(["not an address"], "x", "y", self.who, "export")

    def test_sent_copies_hide_the_link_and_failures_are_recorded(self):
        from unittest import mock
        with mock.patch.dict(os.environ, {"PENNY_SMTP_HOST": "smtp.example.com"}):
            with mock.patch.object(self.m.Outbox, "_smtp", return_value=None) as smtp:
                e = self.box.send(["a@hillpointe.com"], "Reset", "Link: https://x/#/reset?token=SECRET", self.who, "reset", redact=["SECRET"])
            self.assertEqual((e["status"], smtp.call_count), ("sent", 1))
            self.assertNotIn("SECRET", (self.tmp / "outbox" / e["file"]).read_text())
            self.assertNotIn("SECRET", e["body"])
            with mock.patch.object(self.m.Outbox, "_smtp", side_effect=OSError("connection refused")):
                f = self.box.send(["a@hillpointe.com"], "x", "y", self.who, "export")
        self.assertEqual(f["status"], "failed")
        self.assertIn("connection refused", f["error"])


class FoundationTests(unittest.TestCase):
    """(added after submission, v1.8) Speed and safety groundwork: caches that never serve stale data, bounded memory,
    and security headers on every response."""

    def setUp(self):
        from ap_workflow import webserver
        self.ws = webserver
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "web" / "data").mkdir(parents=True)
        (self.tmp / "web" / "index.html").write_text("<!doctype html>")
        self.svc = webserver.BatchService(self.tmp, None, self.tmp / "state", self.tmp / "runs", self.tmp / "web", ROOT / "config" / "rules.json")
        self.clerk = {"id": "avery", "name": "Avery Chen", "role": "clerk"}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_a_file_is_fingerprinted_once_until_it_changes(self):
        from unittest import mock
        f = self.tmp / "a.pdf"
        f.write_bytes(b"%PDF-1.4 one")
        with mock.patch.object(self.ws.hashlib, "sha256", wraps=hashlib.sha256) as sha:
            first = self.svc.fingerprint(f)
            self.assertEqual(self.svc.fingerprint(f), first)
            self.assertEqual(sha.call_count, 1)                                   # the second call came from memory
            f.write_bytes(b"%PDF-1.4 two, and longer")
            changed = self.svc.fingerprint(f)
            self.assertEqual(sha.call_count, 2)
        self.assertEqual(changed, (24, hashlib.sha256(b"%PDF-1.4 two, and longer").hexdigest()))
        self.assertNotEqual(first[1], changed[1])

    def test_audit_log_reads_only_what_is_new_and_cannot_be_changed(self):
        self.svc.log({"event": "one"})
        self.assertEqual([e["event"] for e in self.svc.read_log()], ["one"])
        self.svc.log({"event": "two"})
        with unittest.mock.patch.object(self.svc.store, "events", wraps=self.svc.store.events) as read:
            self.assertEqual([e["event"] for e in self.svc.read_log()], ["one", "two"])
            self.assertEqual([e["event"] for e in self.svc.read_log()], ["one", "two"])
        self.assertEqual(read.call_count, 1)                                     # the second look read nothing from the database
        self.assertEqual(read.call_args.kwargs["after"], 1)                      # and the first read only the new entry
        import sqlite3
        db = sqlite3.connect(str(self.svc.store.path))
        for sql in ("UPDATE events SET body = '{}'", "DELETE FROM events"):      # the database itself refuses to rewrite history
            with self.assertRaises(sqlite3.DatabaseError) as e:
                db.execute(sql)
            self.assertIn("only allows new entries", str(e.exception))
        db.close()
        self.assertEqual([e["event"] for e in self.svc.read_log()], ["one", "two"])

    def test_export_copies_only_changed_files(self):
        from ap_workflow import webexport
        src, dest = self.tmp / "src.csv", self.tmp / "dest.csv"
        src.write_text("a,b\n")
        self.assertTrue(webexport._copy_if_changed(src, dest))
        self.assertFalse(webexport._copy_if_changed(src, dest))
        src.write_text("a,b\n1,2\n")
        self.assertTrue(webexport._copy_if_changed(src, dest))
        self.assertEqual(dest.read_text(), "a,b\n1,2\n")

    def test_sign_in_tracker_is_bounded(self):
        from ap_workflow import accounts
        acc = accounts.Accounts(self.tmp / "acc")
        with unittest.mock.patch.object(accounts, "MAX_TRACKED", 50), unittest.mock.patch.object(accounts.hashlib, "pbkdf2_hmac", return_value=b"x"):
            for i in range(200):
                with self.assertRaises(accounts.AccountError):
                    acc.sign_in(f"stranger{i}@example.com", "guess")
        self.assertLessEqual(len(acc.tries), 50)

    def test_every_response_carries_security_headers(self):
        import threading, urllib.request, http.server
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), self.ws.make_handler(self.svc, self.tmp / "web"))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            for path in ("/", "/api/status"):
                with urllib.request.urlopen(f"http://127.0.0.1:{httpd.server_address[1]}{path}") as r:
                    h = r.headers
                    self.assertIn("script-src 'self'", h["Content-Security-Policy"])
                    self.assertNotIn("unsafe-eval", h["Content-Security-Policy"])
                    self.assertEqual((h["X-Content-Type-Options"], h["Referrer-Policy"], h["X-Frame-Options"]), ("nosniff", "no-referrer", "SAMEORIGIN"))
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_the_page_loads_nothing_from_other_sites(self):
        html = (ROOT / "web" / "index.html").read_text()
        css = (ROOT / "web" / "assets" / "penny.css").read_text()
        self.assertNotIn("googleapis", html + css)
        self.assertNotIn("<script>", html)                                        # no inline scripts, so the policy can forbid them
        self.assertIn("Content-Security-Policy", html)
        for font in ("inter-latin-wght-normal.woff2", "inter-latin-ext-wght-normal.woff2", "LICENSE-Inter.txt"):
            self.assertTrue((ROOT / "web" / "assets" / "fonts" / font).exists(), font)


class WatchedFolderTests(unittest.TestCase):
    """(added after submission, v1.9) PDFs dropped into the watched folder are filed and previewed, never run for real."""

    def setUp(self):
        from ap_workflow import webserver, watcher
        self.ws, self.wm = webserver, watcher
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "web" / "data").mkdir(parents=True)
        self.svc = webserver.BatchService(self.tmp, None, self.tmp / "state", self.tmp / "runs", self.tmp / "web", ROOT / "config" / "rules.json")
        self.w = watcher.Watcher(self.svc)
        self.drop = self.tmp / "inbox" / "_incoming"
        self.drop.mkdir(parents=True)
        syn.make_statement(self.tmp / "st.pdf")
        self.pdf = (self.tmp / "st.pdf").read_bytes()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def put(self, name, data, age=60):
        f = self.drop / name
        f.write_bytes(data)
        old = __import__("time").time() - age
        os.utime(f, (old, old))
        return f

    def test_a_file_is_taken_only_once_it_has_stopped_changing(self):
        f = self.put("scan1.pdf", self.pdf)
        self.assertIsNone(self.w.scan())                                    # first look: size not seen before
        f.write_bytes(self.pdf + b"more")                                    # still being written
        self.assertIsNone(self.w.scan())
        self.assertIsNone(self.w.scan())                                    # same size now, but written a moment ago
        old = __import__("time").time() - 60
        os.utime(f, (old, old))
        ev = self.w.scan()
        self.assertEqual((ev["event"], ev["count"], ev["by"]["name"]), ("watch.picked_up", 1, "Watched folder"))
        self.assertFalse(f.exists())                                        # moved, not copied
        batch = self.tmp / ev["folder"]
        self.assertTrue(batch.name.endswith("_watched-folder"))
        self.assertEqual((batch / "scan1.pdf").read_bytes(), self.pdf + b"more")
        self.assertEqual(ev["files"][0]["sha256"], hashlib.sha256(self.pdf + b"more").hexdigest())
        self.assertEqual([e["event"] for e in self.svc.read_log()], ["batch.created", "batch.uploaded", "watch.picked_up"])
        self.assertFalse((self.tmp / "runs").exists())                      # no engine here, so no run at all

    def test_only_real_pdfs_are_taken_and_nothing_is_deleted(self):
        self.put("notes.txt", b"hello")
        self.put("fake.pdf", b"<html>not a pdf</html>")
        self.put("half.pdf.crdownload", self.pdf)
        self.put(".hidden.pdf", self.pdf)
        (self.drop / "sub").mkdir()
        self.put("good.pdf", self.pdf)
        outside = self.tmp / "secret.pdf"
        outside.write_bytes(self.pdf)
        os.symlink(outside, self.drop / "link.pdf")
        self.w.scan()
        ev = self.w.scan()
        self.assertEqual([f["name"] for f in ev["files"]], ["good.pdf"])
        why = {i["name"]: i["why"] for i in self.w.status()["ignored"]}
        self.assertIn("not a PDF", why["notes.txt"])
        self.assertIn("not really a PDF", why["fake.pdf"])
        self.assertIn("link", why["link.pdf"])
        self.assertNotIn("half.pdf.crdownload", why)                        # still downloading: just wait
        for left in ("notes.txt", "fake.pdf", "half.pdf.crdownload", ".hidden.pdf", "link.pdf", "sub"):
            self.assertTrue((self.drop / left).exists() or (self.drop / left).is_symlink(), left)
        self.assertTrue(outside.exists())

    def test_a_second_drop_the_same_day_gets_its_own_batch(self):
        for name in ("a.pdf", "b.pdf"):
            self.put(name, self.pdf + name.encode())
            self.w.scan()
            self.w.scan()
        names = sorted(p.name for p in (self.tmp / "inbox").iterdir() if p.name != "_incoming")
        self.assertEqual(len(names), 2)
        self.assertTrue(names[1].endswith("_watched-folder-2"))
        self.assertEqual([b["batch"] for b in self.svc.list()], sorted(names, reverse=True))   # _incoming is not a batch

    def test_pickups_pause_while_a_required_update_waits(self):
        from unittest import mock
        from ap_workflow import version
        f = self.put("a.pdf", self.pdf)
        self.w.scan()
        required = version.status("1.0.0", [{"version": "9.0.0", "required": True}])
        with mock.patch.object(self.svc, "update_info", return_value=required):
            self.assertIsNone(self.w.scan())
        self.assertIn("required update", self.w.status()["error"])
        self.assertTrue(f.exists())

    def test_check_now_needs_a_role_and_a_watcher(self):
        import threading, urllib.request, urllib.error, http.server
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), self.ws.make_handler(self.svc, self.tmp / "web"))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        def post(user):
            req = urllib.request.Request(f"http://127.0.0.1:{httpd.server_address[1]}/api/watch/scan", data=json.dumps({"user": user}).encode(),
                                         headers={"X-Penny": "1", "Content-Type": "application/json"}, method="POST")
            try:
                with urllib.request.urlopen(req) as r:
                    return r.status, json.loads(r.read())
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read())
        try:
            clerk = {"id": "avery", "name": "Avery Chen", "role": "clerk"}
            self.assertEqual(post({"id": "riley", "name": "Riley", "role": "viewer"})[0], 403)
            self.assertEqual(post(clerk)[0], 409)                           # the watched folder is off
            self.svc.watcher = self.w
            code, body = post(clerk)
            self.assertEqual((code, body["picked_up"], body["watch"]["folder"]), (200, None, "inbox/_incoming"))
        finally:
            httpd.shutdown()
            httpd.server_close()

    @needs_package
    def test_a_pickup_is_previewed_and_the_register_is_untouched(self):
        svc = self.ws.BatchService(self.tmp, PKG, self.tmp / "state", self.tmp / "runs", self.tmp / "web", ROOT / "config" / "rules.json")
        w = self.wm.Watcher(svc)
        self.put("st.pdf", self.pdf)
        w.scan()
        ev = w.scan()
        self.assertEqual(ev["count"], 1)
        self.assertTrue(w.status()["last_pickup"]["preview"].endswith("_PREVIEW"))
        self.assertFalse((self.tmp / "state" / "processed_register.csv").exists())
        self.assertEqual([e["event"] for e in svc.read_log()][-1], "batch.run")
        self.assertTrue(svc.read_log()[-1]["dry_run"])


class EmailTestCommandTests(unittest.TestCase):
    """(added after submission, v1.7) ./penny email test sends one message and says what to fix when it fails."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_status_never_prints_the_password(self):
        import io, contextlib
        from unittest import mock
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"PENNY_SMTP_HOST": "sandbox.smtp.mailtrap.io", "PENNY_SMTP_PASSWORD": "s3cret-app-pw"}), contextlib.redirect_stdout(out):
            cli.email_cmd(self.tmp, "status")
        self.assertIn("sandbox.smtp.mailtrap.io", out.getvalue())
        self.assertNotIn("s3cret-app-pw", out.getvalue())
        self.assertIn("set", out.getvalue())

    def test_test_email_sent_saved_or_explained(self):
        import io, contextlib
        import smtplib
        from unittest import mock
        from ap_workflow import mailer
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"PENNY_SMTP_HOST": ""}), contextlib.redirect_stdout(out):
            cli.email_cmd(self.tmp, "test", "me@hillpointe.com")
        self.assertIn("saved", out.getvalue())
        with mock.patch.dict(os.environ, {"PENNY_SMTP_HOST": "smtp.example.com"}):
            with mock.patch.object(mailer.Outbox, "_smtp", return_value=None), contextlib.redirect_stdout(out):
                cli.email_cmd(self.tmp, "test", "me@hillpointe.com")
            self.assertIn("Sent a test email", out.getvalue())
            with mock.patch.object(mailer.Outbox, "_smtp", side_effect=smtplib.SMTPAuthenticationError(535, b"Username and Password not accepted")):
                with self.assertRaises(SystemExit) as e:
                    cli.email_cmd(self.tmp, "test", "me@hillpointe.com")
        self.assertIn("app password", str(e.exception.code))
        self.assertEqual([r["status"] for r in mailer.Outbox(self.tmp).list()], ["failed", "sent", "saved"])

    def test_plain_explanations(self):
        from ap_workflow.mailer import explain
        self.assertIn("spelling of PENNY_SMTP_HOST", explain("gaierror: [Errno -2] Name or service not known"))
        self.assertIn("PENNY_SMTP_PORT", explain("TimeoutError: timed out"))
        self.assertIn("465", explain("SSLError: wrong version number"))


class AccountServerTests(unittest.TestCase):
    """(added after submission, v1.7) With accounts on, the server decides who is acting, not the browser."""

    def setUp(self):
        import threading, http.server
        from ap_workflow import webserver
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "web" / "data").mkdir(parents=True)
        (self.tmp / "web" / "data" / "penny-data.json").write_text('{"runs": []}')
        (self.tmp / "web" / "data" / "releases.json").write_text('{"releases": []}')
        run = self.tmp / "runs" / "run1_x"
        run.mkdir(parents=True)
        (run / "decisions.json").write_text(json.dumps([{"file": "a.pdf", "decision": "ENTER_INTACCT", "vendor_name": "Pinecrest", "bill_no": "PBS-1",
                                                         "amount": "940.00", "approvers": ["Project Manager"], "codes": []}]))
        (run / "exception_log.csv").write_text("File,Reason\n")
        (run / "extracted").mkdir()
        (run / "extracted" / "a.json").write_text("{}")
        (run / "run_info.json").write_text(json.dumps({"label": "Batch X", "batch": "x"}))
        (self.tmp / "web" / "data" / "pdfs").mkdir()
        (self.tmp / "web" / "data" / "pdfs" / "a.pdf").write_bytes(b"%PDF-1.4 invoice")
        self.svc = webserver.BatchService(self.tmp, None, self.tmp / "state", self.tmp / "runs", self.tmp / "web", ROOT / "config" / "rules.json")
        u, tok, _ = self.svc.accounts.invite(None, "sam@hillpointe.com", "Sam Rivera", "admin", bootstrap=True)
        self.svc.accounts.use_token(tok, AccountTests.GOOD)
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), webserver.make_handler(self.svc, self.tmp / "web"))
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def call(self, path, body=None, cookie=""):
        import urllib.request, urllib.error
        headers = {"X-Penny": "1", "Content-Type": "application/json"}
        if cookie:
            headers["Cookie"] = f"penny_session={cookie}"
        req = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(), headers=headers, method="GET" if body is None else "POST")
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read()), r.headers.get("Set-Cookie") or ""
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read()), e.headers.get("Set-Cookie") or ""

    def login(self, email, pw=AccountTests.GOOD):
        code, body, cookie = self.call("/api/auth/login", {"email": email, "password": pw})
        self.assertEqual(code, 200, body)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        return cookie.split(";")[0].split("=", 1)[1]

    def test_invoices_need_a_session_and_the_browser_cannot_claim_a_role(self):
        self.assertEqual(self.call("/data/penny-data.json")[0], 401)
        self.assertEqual(self.call("/data/releases.json")[0], 200)              # the public release list needs no session
        sam = self.login("sam@hillpointe.com")
        self.assertEqual(self.call("/data/penny-data.json", cookie=sam)[0], 200)
        code, body, _ = self.call("/api/users", {"email": "riley@hillpointe.com", "name": "Riley Brooks", "role": "viewer"}, cookie=sam)
        self.assertEqual((code, body["email"]["status"]), (201, "saved"))      # no mail server here: saved to the outbox
        link = self.svc.outbox.list()[0]["body"].split("token=")[1].split()[0]
        code, info, _ = self.call(f"/api/auth/token?token={link}")
        self.assertEqual((code, info["purpose"], info["email"]), (200, "invite", "riley@hillpointe.com"))
        self.assertEqual(self.call("/api/auth/activate", {"token": link, "password": AccountTests.GOOD})[0], 200)
        riley = self.login("riley@hillpointe.com")
        admin_claim = {"id": "sam", "name": "Sam Rivera", "role": "admin"}
        code, body, _ = self.call("/api/batches", {"name": "sneaky", "user": admin_claim}, cookie=riley)
        self.assertEqual(code, 403)                                               # acted as Riley (Viewer), not the claimed Admin
        self.assertEqual(self.call("/api/users", cookie=riley)[0], 403)
        code, _, cleared = self.call("/api/auth/logout", {}, cookie=riley)
        self.assertIn("Max-Age=0", cleared)
        self.assertEqual(self.call("/data/penny-data.json", cookie=riley)[0], 401)

    def test_email_an_export_or_an_approval_with_the_file_attached(self):
        sam = self.login("sam@hillpointe.com")
        code, e, _ = self.call("/api/email", {"kind": "export", "to": ["ap@hillpointe.com"], "note": "For Monday", "run_id": "run1_x", "file": "exception_log.csv"}, cookie=sam)
        self.assertEqual((code, e["status"], e["attachments"][0]["name"]), (200, "saved", "exception_log.csv"))
        self.assertIn("Invoices needing review", e["subject"])
        code, e, _ = self.call("/api/email", {"kind": "approval", "to": ["pm@hillpointe.com"], "run_id": "run1_x", "doc_id": "a"}, cookie=sam)
        self.assertEqual((code, e["attachments"][0]["name"]), (200, "a.pdf"))
        self.assertIn("Approval needed: Pinecrest PBS-1 ($940.00)", e["subject"])
        self.assertIn("/#/invoices/a", e["body"])
        code, err, _ = self.call("/api/email", {"kind": "export", "to": ["someone@gmail.com"], "run_id": "run1_x", "file": "exception_log.csv"}, cookie=sam)
        self.assertEqual(code, 403)
        self.assertIn("allowed_domains", err["error"])
        code, err, _ = self.call("/api/email", {"kind": "export", "to": ["ap@hillpointe.com"], "run_id": "run1_x", "file": "../../etc/passwd"}, cookie=sam)
        self.assertEqual(code, 404)
        events = [x["event"] for x in self.svc.read_log()]
        self.assertEqual(events.count("email.saved"), 2)


class TeamTests(unittest.TestCase):
    """(added after submission, v2.0) The server is the source of truth: a database that only allows new audit
    entries, actions checked on the server, live updates, rule changes written to the rules file, the one-time
    move of older files, and https."""

    def setUp(self):
        import threading
        from ap_workflow import webserver
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "web" / "data").mkdir(parents=True)
        (self.tmp / "web" / "data" / "penny-data.json").write_text(json.dumps({"runs": [
            {"id": "run1", "dry_run": False, "files": [{"name": "intacct_bill_import.csv", "rows": 11}]},
            {"id": "preview1", "dry_run": True, "files": [{"name": "intacct_bill_import.csv", "rows": 3}]}]}))
        (self.tmp / "web" / "data" / "releases.json").write_text('{"releases": []}')
        (self.tmp / "runs").mkdir()
        shutil.copy2(ROOT / "config" / "rules.json", self.tmp / "rules.json")       # a copy: these tests change rules
        self.svc = webserver.BatchService(self.tmp, None, self.tmp / "state", self.tmp / "runs", self.tmp / "web", self.tmp / "rules.json")
        sam, tok, _ = self.svc.accounts.invite(None, "sam@hillpointe.com", "Sam Rivera", "admin", bootstrap=True)
        self.svc.accounts.use_token(tok, AccountTests.GOOD)
        for email, name, role in (("avery@hillpointe.com", "Avery Chen", "clerk"), ("jordan@hillpointe.com", "Jordan Patel", "approver"), ("riley@hillpointe.com", "Riley Brooks", "viewer")):
            _, tok, _ = self.svc.accounts.invite(sam, email, name, role)
            self.svc.accounts.use_token(tok, AccountTests.GOOD)
        self.httpd = webserver.make_server(self.svc, self.tmp / "web", 0)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.n = 0

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    call = AccountServerTests.call
    login = AccountServerTests.login

    def act(self, cookie, kind, **data):
        """Send one action as the signed-in person. Returns (status, body)."""
        self.n += 1
        code, body, _ = self.call("/api/events", {"event": {"id": f"{self.n:016x}", "type": kind, **data}}, cookie=cookie)
        return code, body

    def test_the_two_role_tables_are_the_same(self):
        """The web app shows or hides buttons from its table; the server enforces its own. They must agree."""
        import re
        from ap_workflow import actions
        js = (ROOT / "web" / "assets" / "penny-core.js").read_text()
        roles = {m.group(1): json.loads(m.group(2)) for m in re.finditer(r'^  (\w+): \{ name: "[^"]+", can: (\[[^\]]*\])', js, re.M)}
        self.assertEqual(roles, actions.ROLE_CAN)
        block = js[js.index("const EVENT_NEEDS = {"):js.index("};", js.index("const EVENT_NEEDS = {"))]
        needs = dict(re.findall(r'"([a-z_.]+)": "(\w+)"', block))
        for kind, need in actions.NEEDS.items():
            if need is not None:
                self.assertEqual(needs.get(kind), need, kind)
        owned = {k for k in needs if k.startswith(actions.SERVER_OWNED)}
        self.assertEqual(set(needs) - owned, {k for k, v in actions.NEEDS.items() if v})    # every other action is checked here

    def test_the_server_decides_who_is_acting_and_what_they_may_do(self):
        avery, riley = self.login("avery@hillpointe.com"), self.login("riley@hillpointe.com")
        self.assertEqual(self.call("/api/events", {"event": {"id": "a" * 16, "type": "note.add", "doc": "INV1", "note": "x"}})[0], 401)   # no session
        code, body = self.act(avery, "hold.resolve", doc="INV1", outcome="cleared", note="ok", user={"id": "x", "name": "Sam Rivera", "role": "admin"}, at="1999-01-01")
        self.assertEqual(code, 200, body)
        e = body["event"]
        self.assertEqual((e["user"]["name"], e["user"]["role"], e["seq"] > 0, e["at"].startswith("1999")), ("Avery Chen", "clerk", True, False))
        self.assertEqual(self.act(riley, "note.add", doc="INV1", note="hi")[0], 403)                 # a Viewer changes nothing
        self.assertEqual(self.act(avery, "bill.approve", doc="INV2", step="Project Manager")[0], 403)
        self.assertEqual(self.act(avery, "rules.update", changes=[{"path": "thresholds.overpo_tolerance", "before": 500.0, "after": 1}])[0], 403)
        code, body = self.act(avery, "batch.run", batch="x")
        self.assertEqual(code, 400)
        self.assertIn("records that itself", body["error"])
        self.assertEqual(self.act(avery, "made.up")[0], 400)
        self.assertEqual(self.act(avery, "note.add", doc="../../etc", note="x")[0], 422)
        self.assertEqual(self.call("/api/events", {"event": {"id": "not hex", "type": "note.add", "doc": "INV1"}}, cookie=avery)[0], 400)
        code, body, _ = self.call("/api/events?after=0", cookie=riley)                                # a Viewer may read
        self.assertEqual((code, body["team"]), (200, True))
        self.assertEqual([x["type"] for x in body["events"] if x["origin"] == "web"], ["hold.resolve"])

    def test_two_people_cannot_both_resolve_the_same_hold(self):
        import threading
        people = [self.login("avery@hillpointe.com"), self.login("sam@hillpointe.com")]
        results, won, gate = [], [], threading.Barrier(8)

        def go(i):
            gate.wait()
            code, body, _ = self.call("/api/events", {"event": {"id": f"{i + 100:016x}", "type": "hold.resolve", "doc": "INV9", "outcome": "cleared"}}, cookie=people[i % 2])
            results.append((code, body.get("error", "")))
            if code == 200:
                won.append(i)
        threads = [threading.Thread(target=go, args=(i,)) for i in range(8)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(sorted(c for c, _ in results), [200] + [409] * 7)
        self.assertTrue(all("already resolved this hold" in m for c, m in results if c == 409))
        avery = people[0]
        self.assertEqual(self.act(avery, "hold.reopen", doc="INV9", note="again")[0], 200)
        self.assertEqual(self.act(avery, "hold.reopen", doc="INV9")[0], 409)
        self.assertEqual(self.act(avery, "hold.resolve", doc="INV9", outcome="maybe")[0], 422)
        code, body, _ = self.call("/api/events", {"event": {"id": f"{won[0] + 100:016x}", "type": "hold.resolve", "doc": "INV9", "outcome": "cleared"}}, cookie=people[won[0] % 2])
        self.assertEqual((code, body["event"].get("repeat")), (200, True))                           # the same action sent twice is stored once

    def test_import_history_and_second_person_rules_are_checked_on_the_server(self):
        avery, sam, jordan = (self.login(f"{n}@hillpointe.com") for n in ("avery", "sam", "jordan"))
        f = {"run": "run1", "file": "intacct_bill_import.csv"}
        self.assertEqual(self.act(avery, "export.imported", **f, ref="IMP-1", rows=10)[0], 422)       # the file has 11 rows
        self.assertEqual(self.act(avery, "export.imported", **f, ref="", rows=11)[0], 422)
        self.assertEqual(self.act(avery, "export.imported", run="preview1", file=f["file"], ref="IMP-1", rows=3)[0], 422)   # a preview
        self.assertEqual(self.act(avery, "export.imported", run="run1", file="nope.csv", ref="IMP-1", rows=1)[0], 422)
        self.assertEqual(self.act(jordan, "export.confirmed", **f)[0], 409)                           # nothing imported yet
        self.assertEqual(self.act(sam, "export.imported", **f, ref="IMP-1", rows=11)[0], 200)
        self.assertEqual(self.act(avery, "export.imported", **f, ref="IMP-2", rows=11)[0], 409)       # already imported
        code, body = self.act(sam, "export.confirmed", **f)
        self.assertEqual(code, 403)
        self.assertIn("different person", body["error"])
        self.assertEqual(self.act(avery, "export.confirmed", **f)[0], 403)                            # a Clerk cannot confirm
        self.assertEqual(self.act(jordan, "export.confirmed", **f)[0], 200)
        self.assertEqual(self.act(jordan, "export.confirmed", **f)[0], 409)
        self.assertEqual(self.act(avery, "manual.keyed", doc="INV3", entry={"total": "10.00"})[0], 200)
        keyed = f"{self.n:016x}"
        code, body = self.act(avery, "manual.check", doc="INV3", entry_id=keyed, match=True)
        self.assertEqual(code, 403)
        self.assertIn("different person", body["error"])
        self.assertEqual(self.act(sam, "manual.check", doc="INV3", entry_id=keyed, match=True)[0], 200)
        self.assertEqual(self.act(sam, "bill.approve", doc="INV4", step="Controller")[0], 200)
        self.assertEqual(self.act(jordan, "bill.approve", doc="INV4", step="Controller")[0], 409)
        self.assertEqual(self.act(jordan, "bill.approve", doc="INV4", step="Project Manager")[0], 200)    # a different sign-off

    def test_rule_changes_are_written_to_the_rules_file_and_stale_ones_are_refused(self):
        sam = self.login("sam@hillpointe.com")
        rules = lambda: json.loads((self.tmp / "rules.json").read_text())
        before = rules()["thresholds"]["overpo_tolerance"]
        code, body = self.act(sam, "rules.update", changes=[{"path": "thresholds.overpo_tolerance", "before": before, "after": 750}], note="agreed")
        self.assertEqual((code, body["rules"]["thresholds"]["overpo_tolerance"]), (200, 750))
        first = f"{self.n:016x}"
        self.assertEqual(rules()["thresholds"]["overpo_tolerance"], 750)                              # the engine's own file
        self.assertEqual(self.svc.cfg()[0]["thresholds"]["overpo_tolerance"], 750)
        kept = list((self.tmp / "state" / "rules_history").glob("*.json"))
        self.assertEqual(json.loads(kept[0].read_text())["thresholds"]["overpo_tolerance"], before)   # the old file is kept
        code, body = self.act(sam, "rules.update", changes=[{"path": "thresholds.overpo_tolerance", "before": before, "after": 900}])
        self.assertEqual(code, 409)
        self.assertIn("changed while you were working", body["error"])
        for bad in ("lots", -5, None if False else [1]):
            self.assertEqual(self.act(sam, "rules.update", changes=[{"path": "thresholds.overpo_tolerance", "before": 750, "after": bad}])[0], 422, bad)
        for path in ("_readme", "thresholds._comment", "", "thresholds..x", 7):
            self.assertEqual(self.act(sam, "rules.update", changes=[{"path": path, "before": None, "after": 1}])[0], 422, path)
        self.assertEqual(self.act(sam, "rules.update", changes=[{"path": "thresholds", "before": rules()["thresholds"], "after": None}])[0], 422)
        self.assertEqual(rules()["thresholds"]["overpo_tolerance"], 750)                              # nothing refused touched the file
        self.assertEqual(self.act(sam, "rules.revert", target=first, note="back")[0], 200)
        self.assertEqual(rules()["thresholds"]["overpo_tolerance"], before)
        self.assertEqual(self.act(sam, "rules.revert", target=first)[0], 409)                         # already undone
        self.assertEqual(self.act(sam, "rules.revert", target="f" * 16)[0], 422)
        self.assertEqual(self.act(sam, "rules.update", changes=[{"path": "display.banner", "after": "Month end closes Friday"}])[0], 200)    # a rule that did not exist yet
        added = f"{self.n:016x}"
        self.assertEqual(rules()["display"]["banner"], "Month end closes Friday")
        self.assertEqual(self.act(sam, "rules.revert", target=added)[0], 200)
        self.assertNotIn("banner", rules()["display"])                                                # undoing it takes it out again
        code, data, _ = self.call("/data/penny-data.json", cookie=sam)
        self.assertEqual(data["rules"]["thresholds"]["overpo_tolerance"], before)                     # browsers start from the live rules

    def test_a_waiting_browser_hears_about_new_work_at_once(self):
        import threading, time
        avery, sam = self.login("avery@hillpointe.com"), self.login("sam@hillpointe.com")
        last = self.call("/api/events?after=0", cookie=sam)[1]["last"]
        heard = {}

        def listen():
            start = time.time()
            heard["body"] = self.call(f"/api/events?after={last}&wait=20", cookie=sam)[1]
            heard["took"] = time.time() - start
        t = threading.Thread(target=listen)
        t.start()
        time.sleep(0.4)
        self.assertEqual(self.act(avery, "note.add", doc="INV1", note="hello team")[0], 200)
        t.join(10)
        self.assertLess(heard["took"], 5)                                                             # answered when the note arrived, not after 20 seconds
        self.assertEqual([(e["type"], e["user"]["name"]) for e in heard["body"]["events"]], [("note.add", "Avery Chen")])
        start = time.time()
        quiet = self.call(f"/api/events?after={heard['body']['last']}&wait=1", cookie=sam)[1]
        self.assertEqual(quiet["events"], [])
        self.assertGreaterEqual(time.time() - start, 0.9)                                             # nothing new: it waits, then answers empty
        self.assertEqual(self.call("/api/events?after=abc&wait=x", cookie=sam)[0], 200)               # nonsense numbers are treated as 0

    def test_an_admin_can_move_a_browsers_earlier_work_in_once(self):
        sam, avery = self.login("sam@hillpointe.com"), self.login("avery@hillpointe.com")
        old = [{"id": "c" * 16, "at": "2026-10-30T15:00:00.000Z", "type": "note.add", "doc": "INV1", "note": "from before", "user": {"id": "avery", "name": "Avery Chen", "role": "clerk"}},
               {"id": "d" * 16, "at": "2026-10-30T16:00:00.000Z", "type": "rules.update", "changes": [{"path": "thresholds.overpo_tolerance", "before": 500, "after": 9999}], "user": {"id": "sam", "name": "Sam Rivera", "role": "admin"}},
               {"type": "note.add"}, "junk"]
        self.assertEqual(self.call("/api/events/import", {"events": old}, cookie=avery)[0], 403)
        code, body, _ = self.call("/api/events/import", {"events": old}, cookie=sam)
        self.assertEqual((code, body), (200, {"added": 2, "skipped": 2}))
        self.assertEqual(self.call("/api/events/import", {"events": old}, cookie=sam)[1], {"added": 0, "skipped": 4})    # moving twice adds nothing
        moved = [e for e in self.svc.store.events() if e["origin"] == "import"]
        self.assertEqual([(e["at"], e["moved_by"]["name"]) for e in moved], [("2026-10-30T15:00:00.000Z", "Sam Rivera"), ("2026-10-30T16:00:00.000Z", "Sam Rivera")])
        self.assertNotEqual(json.loads((self.tmp / "rules.json").read_text())["thresholds"]["overpo_tolerance"], 9999)   # history only
        self.assertEqual([e["event"] for e in self.svc.read_log()][-2:], ["history.moved", "history.moved"])

    def test_older_files_are_moved_into_the_database_once_and_nothing_is_lost(self):
        from ap_workflow import accounts, webserver
        from ap_workflow.store import Store
        old = self.tmp / "old"
        acc = accounts.Accounts(old)                                                                  # Penny before 2.0: plain files
        u, tok, _ = acc.invite(None, "pat@hillpointe.com", "Pat Lee", "admin", bootstrap=True)
        acc.use_token(tok, AccountTests.GOOD)
        (old / "batch_log.jsonl").write_text('{"at": "2026-11-01T09:00:00-05:00", "event": "batch.created", "batch": "b1", "by": {"id": "x", "name": "Pat Lee", "role": "admin"}}\n'
                                             '{"at": "2026-11-01T09:01:00-05:00", "event": "batch.run", "batch": "b1", "by": {"id": "x", "name": "Pat Lee", "role": "admin"}}\n{"half": ')
        svc = webserver.BatchService(self.tmp, None, old, self.tmp / "runs", self.tmp / "web", self.tmp / "rules.json")
        self.assertEqual(svc.moved, {"audit log entries": 2, "people": 1, "invitation and reset links": 1})
        self.assertEqual([(e["event"], e["at"]) for e in svc.read_log()], [("batch.created", "2026-11-01T09:00:00-05:00"), ("batch.run", "2026-11-01T09:01:00-05:00")])
        self.assertIn("Pat Lee", json.dumps(svc.accounts.sign_in("pat@hillpointe.com", AccountTests.GOOD)))     # the same password still works
        for name in ("batch_log.jsonl", "users.json", "tokens.json"):
            self.assertFalse((old / name).exists())
            self.assertTrue((old / (name + ".moved")).exists())                                       # renamed, not deleted
        again = webserver.BatchService(self.tmp, None, old, self.tmp / "runs", self.tmp / "web", self.tmp / "rules.json")
        self.assertEqual((again.moved, len(again.read_log()), len(again.accounts.list())), ({}, 3, 1))  # starting again moves nothing twice (the third entry is Pat signing in)
        store = Store(old)
        self.assertEqual(store.append({"event": "x", "at": "t"}, "server", uid="same")["seq"], store.append({"event": "y", "at": "t"}, "server", uid="same")["seq"])
        self.assertNotIn(AccountTests.GOOD, (old / "penny.db").read_bytes().decode("latin-1"))        # still only a hash

    def test_network_use_needs_real_accounts_and_https(self):
        import ssl, subprocess, threading, urllib.request
        from ap_workflow import webserver
        empty = webserver.BatchService(self.tmp, None, self.tmp / "none", self.tmp / "runs", self.tmp / "web", self.tmp / "rules.json")
        self.assertEqual(webserver.network_problem(empty, "127.0.0.1", None, None, False), "")
        self.assertIn("real accounts", webserver.network_problem(empty, "0.0.0.0", "c", "k", False))
        self.assertIn("without https", webserver.network_problem(self.svc, "0.0.0.0", None, None, False))
        self.assertEqual(webserver.network_problem(self.svc, "0.0.0.0", "c", "k", False), "")
        self.assertEqual(webserver.network_problem(self.svc, "0.0.0.0", None, None, True), "")       # https from a proxy in front
        with self.assertRaises(SystemExit):
            webserver.serve(self.svc, self.tmp / "web", 0, False, host="0.0.0.0")
        plain = self.call("/api/auth/login", {"email": "sam@hillpointe.com", "password": AccountTests.GOOD})[2]
        self.assertNotIn("Secure", plain)                                                             # plain http on this computer: no Secure flag
        cert, key = self.tmp / "cert.pem", self.tmp / "key.pem"
        try:
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", str(key), "-out", str(cert),
                            "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], check=True, capture_output=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("openssl is not available to make a test certificate")
        httpd = webserver.make_server(self.svc, self.tmp / "web", 0, "127.0.0.1", cert, key)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            ctx = ssl.create_default_context(cafile=str(cert))
            req = urllib.request.Request(f"https://127.0.0.1:{httpd.server_address[1]}/api/auth/login", data=json.dumps({"email": "sam@hillpointe.com", "password": AccountTests.GOOD}).encode(),
                                         headers={"X-Penny": "1", "Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, context=ctx) as r:
                cookie, hsts = r.headers.get("Set-Cookie"), r.headers.get("Strict-Transport-Security")
            self.assertIn("; Secure", cookie)
            self.assertIn("HttpOnly", cookie)
            self.assertIn("max-age=", hsts)
            with self.assertRaises(Exception):                                                        # plain http to the https port gets nowhere
                urllib.request.urlopen(f"http://127.0.0.1:{httpd.server_address[1]}/api/status", timeout=3)
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_many_wrong_passwords_from_one_address_lock_that_address(self):
        from ap_workflow import accounts
        t = [1000.0]
        self.svc.accounts.clock = lambda: t[0]
        for i in range(accounts.MAX_TRIES_ADDR):                                    # 20 guesses spread over 20 emails: no single email locks
            with self.assertRaises(accounts.AccountError) as e:
                self.svc.accounts.sign_in(f"guess{i}@hillpointe.com", "wrong", addr="10.0.0.9")
            self.assertEqual(e.exception.status, 401)
        with self.assertRaises(accounts.AccountError) as e:
            self.svc.accounts.sign_in("sam@hillpointe.com", AccountTests.GOOD, addr="10.0.0.9")       # even the right password waits
        self.assertEqual(e.exception.status, 429)
        self.assertIn("from this computer", str(e.exception))
        self.assertTrue(self.svc.accounts.sign_in("sam@hillpointe.com", AccountTests.GOOD, addr="10.0.0.7")[0])   # other computers are not affected
        t[0] += 301
        self.assertTrue(self.svc.accounts.sign_in("sam@hillpointe.com", AccountTests.GOOD, addr="10.0.0.9")[0])   # and it ends after five minutes

    def test_without_real_accounts_actions_stay_in_the_browser(self):
        from ap_workflow import webserver
        demo = webserver.BatchService(self.tmp, None, self.tmp / "demo", self.tmp / "runs", self.tmp / "web", self.tmp / "rules.json")
        import threading
        httpd = webserver.make_server(demo, self.tmp / "web", 0)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        base, self.base = self.base, f"http://127.0.0.1:{httpd.server_address[1]}"
        try:
            self.assertEqual(self.call("/api/events?after=0")[1], {"team": False, "events": [], "last": 0})
            self.assertEqual(self.call("/api/events", {"event": {"id": "a" * 16, "type": "note.add", "doc": "INV1"}})[0], 409)
            self.assertFalse(self.call("/api/status")[1]["team"])
        finally:
            self.base = base
            httpd.shutdown()
            httpd.server_close()


if __name__ == "__main__":
    unittest.main()
