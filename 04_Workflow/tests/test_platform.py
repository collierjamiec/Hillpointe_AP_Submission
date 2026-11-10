"""What runs around the engine: versions and updates, accounts, email, and the speed and security groundwork.
Run everything with:  ./penny test   (or: python -m unittest discover -s tests -v)"""
from common import *        # noqa: F401,F403  (paths, PKG, needs_package, EXPECTED, outcome, cli, syn)


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

    def test_audit_log_reads_only_what_is_new_and_recovers_if_replaced(self):
        self.svc.log({"event": "one"})
        self.assertEqual([e["event"] for e in self.svc.read_log()], ["one"])
        self.svc.log({"event": "two"})
        with open(self.svc.log_path, "a") as f:
            f.write('{"event": "half-written')                                    # a line still being written is left for next time
        self.assertEqual([e["event"] for e in self.svc.read_log()], ["one", "two"])
        with open(self.svc.log_path, "a") as f:
            f.write('"}\n')
        self.assertEqual([e["event"] for e in self.svc.read_log()], ["one", "two", "half-written"])
        self.svc.log_path.write_text('{"event": "fresh"}\n')                     # replaced by a shorter file: start over
        self.assertEqual([e["event"] for e in self.svc.read_log()], ["fresh"])

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


if __name__ == "__main__":
    unittest.main()
