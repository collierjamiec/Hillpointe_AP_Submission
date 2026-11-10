"""The web side of the engine: the web export, the batch server, replaying saved runs, manual entry, and previews.
Run everything with:  ./penny test   (or: python -m unittest discover -s tests -v)"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))      # so one file can also be run on its own
from common import *        # noqa: F401,F403  (paths, PKG, needs_package, EXPECTED, outcome, cli, syn)  # noqa: E402


class WebExportTests(unittest.TestCase):
    """The web view reads one JSON file built from the saved runs. It must carry every run, document and result."""

    OFFICIAL_RUNS = ["run1_batch01", "run2_batch01_RERUN", "run3_batch02", "run4_batch02_RERUN", "run5_edge_tests", "run6_t5_retest"]

    def test_export_of_saved_runs(self):
        """Uses only the official runs saved in the repo, so extra runs made on this computer do not change the result."""
        from ap_workflow import webexport
        missing = [r for r in self.OFFICIAL_RUNS if not (ROOT / "runs" / r / "decisions.json").exists()]
        self.assertEqual(missing, [], "These saved runs are missing from 04_Workflow/runs (./penny reset or demo deletes them). "
                                      "Restore them with:  git restore 04_Workflow/runs")
        tmp = Path(tempfile.mkdtemp())
        try:
            for r in self.OFFICIAL_RUNS:
                shutil.copytree(ROOT / "runs" / r, tmp / "saved_runs" / r)
            r = webexport.build(tmp / "saved_runs", ROOT / "config" / "rules.json", tmp / "web")
            data = json.loads(r["path"].read_text())
            self.assertEqual([x["id"] for x in data["runs"]], ["run1_batch01", "run2_batch01_RERUN", "run3_batch02", "run4_batch02_RERUN", "run5_edge_tests", "run6_t5_retest"])
            self.assertEqual([x["label"] for x in data["runs"]], ["Batch 01", "Batch 01 rerun", "Batch 02", "Batch 02 rerun", "Edge-case tests", "T5 retest after fix"])
            self.assertEqual(len(data["documents"]), 26)
            self.assertEqual(len(data["results"]), 47)
            self.assertEqual(data["documents"]["T5_unfamiliar_layout"]["extracted"]["kind"], "unrecognized")   # newest reading wins
            self.assertIsNone(data["documents"]["APINBOX_0001"]["pdf"])          # no package given, no PDFs copied
            self.assertEqual(data["documents"]["APINBOX_0001"]["extracted"]["invoice_no"], "PBS-604418")
            held = next(x for x in data["results"] if x["doc_id"] == "APINBOX_0012" and x["run_id"] == "run1_batch01")
            revised = next(x for x in data["results"] if x["doc_id"] == "APINBOX_0018" and x["run_id"] == "run3_batch02")
            self.assertEqual(revised["supersedes"], held["key"])                 # lets the web view close out the old hold
            self.assertEqual(data["rules"]["thresholds"]["overpo_tolerance"], 500.0)
            first = {f["name"]: f for f in data["runs"][0]["files"]}
            self.assertEqual(first["intacct_bill_import.csv"]["rows"], 11)            # matches the submitted Batch 01 import file
            import hashlib                                                           # export history names the exact file by its fingerprint
            self.assertEqual(first["intacct_bill_import.csv"]["sha256"],
                             hashlib.sha256((ROOT / "runs" / "run1_batch01" / "intacct_bill_import.csv").read_bytes()).hexdigest())
            self.assertTrue((tmp / "web" / "runs" / "run1_batch01" / "intacct_bill_import.csv").exists())
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_run_names_are_readable(self):
        from ap_workflow.webexport import _label
        self.assertEqual(_label("run2_batch01_RERUN", "01_Invoice_Batch_01", True), "Batch 01 rerun")
        self.assertEqual(_label("01_Invoice_Batch_01_111817", "01_Invoice_Batch_01", False), "Invoice Batch 01")
        self.assertEqual(_label("01_Invoice_Batch_01_120502", "01_Invoice_Batch_01", True), "Invoice Batch 01 rerun")
        self.assertEqual(_label("new-tests_111835", "new-tests", False), "New tests")

    def test_export_copies_pdfs_from_the_package(self):
        from ap_workflow import webexport
        tmp = Path(tempfile.mkdtemp())
        try:
            runs, pkg = tmp / "runs", tmp / "pkg"
            (pkg / "inbox").mkdir(parents=True)
            syn.make_invoice(pkg / "inbox" / "bad.pdf")
            run_dir = runs / "run1_mine"
            (run_dir / "extracted").mkdir(parents=True)
            (run_dir / "run_info.json").write_text(json.dumps({"batch": "inbox", "started_at": "2026-11-10T09:00:00-05:00"}))
            (run_dir / "decisions.json").write_text(json.dumps([{"file": "bad.pdf", "decision": "HOLD", "vendor_id": "", "vendor_name": "",
                                                                 "bill_no": "", "doc_type": "Bill", "codes": ["OTHER"]}]))
            r = webexport.build(runs, ROOT / "config" / "rules.json", tmp / "web", package=pkg)
            data = json.loads(r["path"].read_text())
            self.assertEqual(r["pdfs_copied"], 1)
            self.assertEqual(data["documents"]["bad"]["pdf"], "data/pdfs/bad.pdf")
            self.assertTrue((tmp / "web" / "pdfs" / "bad.pdf").exists())
            self.assertEqual(data["runs"][0]["started_at"], "2026-11-10T09:00:00-05:00")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class BatchServerTests(unittest.TestCase):
    """Uploading and running new batches from the web app (ap_workflow/webserver.py)."""
    CLERK = {"id": "avery", "name": "Avery Chen", "role": "clerk"}
    ADMIN = {"id": "sam", "name": "Sam Rivera", "role": "admin"}
    VIEWER = {"id": "riley", "name": "Riley Brooks", "role": "viewer"}

    def setUp(self):
        from ap_workflow import webserver
        self.ws = webserver
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "web" / "data").mkdir(parents=True)
        self.svc = webserver.BatchService(self.tmp, None, self.tmp / "state", self.tmp / "runs", self.tmp / "web", ROOT / "config" / "rules.json")
        syn.make_invoice(self.tmp / "inv.pdf")
        self.pdf = (self.tmp / "inv.pdf").read_bytes()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_batch_names_are_dated_readable_and_unique(self):
        self.assertEqual(self.ws.slugify("Weekly AP run #3"), "weekly-ap-run-3")
        day = self.svc.today()
        a = self.svc.create("Weekly AP", self.CLERK, date=day)
        b = self.svc.create("weekly ap", self.CLERK, date=day)
        self.assertEqual((a["batch"], b["batch"]), (f"{day}_weekly-ap", f"{day}_weekly-ap-2"))
        self.assertEqual(a["folder"], f"inbox/{day}_weekly-ap")
        with self.assertRaises(self.ws.BatchError):
            self.svc.create("!!", self.CLERK)

    def test_company_time_zone_dates_folders_and_the_log(self):
        """(added after submission) display.time_zone in rules.json sets folder dates and log times."""
        from datetime import datetime, timedelta, timezone
        cfg = json.loads((ROOT / "config" / "rules.json").read_text())
        cfg["display"]["time_zone"] = "Pacific/Kiritimati"            # UTC+14, so its date often differs from UTC
        (self.tmp / "rules.json").write_text(json.dumps(cfg))
        svc = self.ws.BatchService(self.tmp, None, self.tmp / "state", self.tmp / "runs", self.tmp / "web", self.tmp / "rules.json")
        self.assertEqual(svc.zone().key, "Pacific/Kiritimati")
        self.assertTrue(svc.now().isoformat().endswith("+14:00"))
        self.assertEqual(svc.today(), datetime.now(timezone(timedelta(hours=14))).strftime("%Y-%m-%d"))
        made = svc.create("tz check", self.CLERK)
        self.assertTrue(made["batch"].startswith(svc.today() + "_"))
        self.assertTrue(svc.read_log()[-1]["at"].endswith("+14:00"))
        # A date from the browser is used only when it is real and within a day of now.
        utc = datetime.now(timezone.utc).date()
        self.assertEqual(svc.pick_day((utc + timedelta(days=1)).isoformat()), (utc + timedelta(days=1)).isoformat())
        for bad in ("2001-01-01", "2026-13-40", "../etc", None):
            self.assertEqual(svc.pick_day(bad), svc.today())
        # A missing or unknown zone falls back to this computer's own clock instead of failing.
        cfg["display"]["time_zone"] = "Not/A_Zone"
        (self.tmp / "rules.json").write_text(json.dumps(cfg))
        self.assertIsNone(svc.zone())
        self.assertEqual(svc.today(), datetime.now().strftime("%Y-%m-%d"))

    def test_permissions(self):
        for who in (self.VIEWER, {"role": "approver"}, None):
            with self.assertRaises(self.ws.BatchError) as e:
                self.svc.create("x batch", who)
            self.assertEqual(e.exception.status, 403)
        batch = self.svc.create("perm test", self.CLERK)["batch"]
        self.svc.add_file(batch, "a.pdf", self.pdf, self.CLERK)
        with self.assertRaises(self.ws.BatchError) as e:
            self.svc.run(batch, self.CLERK, dry_run=False)          # a clerk may preview, never run for real
        self.assertEqual(e.exception.status, 403)
        with self.assertRaises(self.ws.BatchError) as e:
            self.svc.run(batch, self.ADMIN, dry_run=False)          # no package on this server, so nothing can run
        self.assertEqual(e.exception.status, 503)

    def test_files_are_checked(self):
        batch = self.svc.create("files", self.CLERK)["batch"]
        info = self.svc.add_file(batch, "../../evil/inv 1.pdf", self.pdf, self.CLERK)
        self.assertEqual(info["name"], "inv_1.pdf")                  # path parts stripped, stays in the batch folder
        self.assertTrue((self.tmp / "inbox" / batch / "inv_1.pdf").exists())
        for name, data, words in [("notes.txt", self.pdf, "not a PDF file name"), ("fake.pdf", b"hello", "not really a PDF"),
                                  ("inv_1.pdf", self.pdf, "already in this batch")]:
            with self.assertRaises(self.ws.BatchError) as e:
                self.svc.add_file(batch, name, data, self.CLERK)
            self.assertIn(words, str(e.exception))
        with self.assertRaises(self.ws.BatchError):
            self.svc.folder("../../etc")

    def test_upload_is_logged_with_fingerprints(self):
        batch = self.svc.create("logged", self.CLERK, event_id="e1")["batch"]
        self.svc.add_file(batch, "a.pdf", self.pdf, self.CLERK)
        self.svc.finish_upload(batch, self.CLERK, event_id="e2")
        log = self.svc.read_log()
        self.assertEqual([e["event"] for e in log], ["batch.created", "batch.uploaded"])
        up = log[1]
        self.assertEqual((up["by"]["name"], up["count"], up["folder"]), ("Avery Chen", 1, f"inbox/{batch}"))
        self.assertEqual(up["files"][0]["sha256"], hashlib.sha256(self.pdf).hexdigest())

    def test_http_api_refuses_requests_from_other_pages(self):
        import threading, urllib.request, urllib.error, http.server
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), self.ws.make_handler(self.svc, self.tmp / "web"))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{httpd.server_address[1]}"
        try:
            def post(path, body, headers):
                req = urllib.request.Request(base + path, data=body, headers=headers, method="POST")
                try:
                    with urllib.request.urlopen(req) as r:
                        return r.status, json.loads(r.read())
                except urllib.error.HTTPError as e:
                    return e.code, json.loads(e.read())
            body = json.dumps({"name": "api test", "user": self.CLERK}).encode()
            self.assertEqual(post("/api/batches", body, {"Content-Type": "application/json"})[0], 403)          # no X-Penny header
            self.assertEqual(post("/api/batches", body, {"X-Penny": "1", "Origin": "https://evil.example"})[0], 403)
            code, made = post("/api/batches", body, {"X-Penny": "1"})
            self.assertEqual(code, 201)
            code, f = post(f"/api/batches/{made['batch']}/files?name=a.pdf", self.pdf, {"X-Penny": "1", "X-Penny-User": json.dumps(self.CLERK)})
            self.assertEqual((code, f["name"]), (201, "a.pdf"))
            with urllib.request.urlopen(base + "/api/status") as r:
                self.assertEqual(json.loads(r.read())["engine"], False)
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_preview_run_end_to_end_without_reference_data(self):
        """A statement in an unknown layout is decided before any lookup, so the full run path works without the package."""
        from unittest import mock
        svc = self.ws.BatchService(self.tmp, self.tmp, self.tmp / "state", self.tmp / "runs", self.tmp / "web", ROOT / "config" / "rules.json")
        batch = svc.create("Statements", self.CLERK, date="2026-11-11")["batch"]
        syn.make_statement(self.tmp / "st.pdf")
        svc.add_file(batch, "statement.pdf", (self.tmp / "st.pdf").read_bytes(), self.CLERK)
        svc.finish_upload(batch, self.CLERK)
        with mock.patch.object(cli, "load_package", return_value=(None, None, None)):
            ev = svc.run(batch, self.CLERK, dry_run=True, event_id="r1")
        self.assertEqual((ev["run_id"], ev["documents"], ev["counts"]), ("run1_2026-11-11_statements_PREVIEW", 1, {"HOLD": 1}))
        info = json.loads((self.tmp / "runs" / ev["run_id"] / "run_info.json").read_text())
        self.assertEqual((info["ran_by"]["role"], info["batch_dir"], info["dry_run"]), ("clerk", f"inbox/{batch}", True))
        self.assertEqual(info["penny_version"], (ROOT / "VERSION").read_text().strip())   # every run says which Penny decided it
        data = json.loads((self.tmp / "web" / "data" / "penny-data.json").read_text())
        self.assertEqual(data["runs"][0]["label"], "Statements (2026-11-11) preview")
        self.assertEqual(data["documents"]["statement"]["pdf"], "data/pdfs/statement.pdf")
        self.assertEqual(data["batch_log"][-1]["id"], "r1")

    @needs_package
    def test_preview_run_writes_a_run_and_refreshes_the_web_data(self):
        svc = self.ws.BatchService(self.tmp, PKG, self.tmp / "state", self.tmp / "runs", self.tmp / "web", ROOT / "config" / "rules.json")
        batch = svc.create("preview test", self.CLERK, date="2026-11-10")["batch"]
        svc.add_file(batch, "inv.pdf", self.pdf, self.CLERK)
        svc.finish_upload(batch, self.CLERK)
        ev = svc.run(batch, self.CLERK, dry_run=True)
        self.assertEqual(ev["run_id"], "run1_2026-11-10_preview-test_PREVIEW")
        self.assertTrue(ev["dry_run"])
        self.assertEqual(ev["by"]["name"], "Avery Chen")
        self.assertFalse((self.tmp / "state" / "processed_register.csv").exists())   # a preview never saves the register
        data = json.loads((self.tmp / "web" / "data" / "penny-data.json").read_text())
        self.assertEqual(data["runs"][-1]["batch_dir"], f"inbox/{batch}")
        self.assertEqual(data["documents"]["inv"]["pdf"], "data/pdfs/inv.pdf")
        self.assertEqual([e["event"] for e in data["batch_log"]], ["batch.created", "batch.uploaded", "batch.run"])


AVERY = {"id": "avery", "name": "Avery Chen", "role": "clerk"}


def sample_entry(**kw):
    """A statement Penny cannot read (synthetic.make_statement), keyed by hand."""
    e = {"vendor_name": "Pinecrest Building Supply Co", "invoice_no": "PBS-910005", "date": "2026-10-28", "terms": "Net 30",
         "customer_ref": "PO2410315-008", "bill_to": "Hillpointe Construction, LLC", "ship_to": "Pointe Grand Columbia, Bldg 4",
         "lines": [{"desc": "2x4x8 framing lumber, kiln dried", "qty": "150", "rate": "4.00", "amount": "600.00"},
                   {"desc": "2x6x10 framing lumber, treated", "qty": "40", "rate": "8.50", "amount": "340.00"}],
         "subtotal": "940.00", "tax_total": "0", "total": "940.00", "reason": "Statement layout Penny cannot read; keyed from the PDF.",
         "keyed_by": AVERY, "evidence": [{"name": "shot.png", "type": "png", "bytes": 10, "sha256": "cd" * 32}]}
    e.update(kw)
    return e


class ManualEntryTests(unittest.TestCase):
    """(added after submission, v1.5) A person keys an unreadable invoice; Penny checks the keyed record like any other."""

    def setUp(self):
        self.cfg = json.loads((ROOT / "config" / "rules.json").read_text())
        self.original = {"file": "statement.pdf", "sha256": "ab" * 32}
        self.sam = {"id": "sam", "name": "Sam Rivera", "role": "admin"}
        self.avery = AVERY
        self.entry = sample_entry

    def test_keyed_record_has_the_readers_shape_and_names_its_source(self):
        from ap_workflow.manual import keyed_doc
        doc = keyed_doc(self.entry(), self.original, self.cfg)
        self.assertEqual((doc["file"], doc["sha256"], doc["kind"]), ("statement.pdf", "ab" * 32, "invoice"))
        self.assertEqual(doc["extraction"]["method"], "manual")
        self.assertEqual(doc["refs_customer_ref"]["po"], ["PO2410315-008"])
        self.assertEqual(doc["extraction"]["evidence"][0]["sha256"], "cd" * 32)
        self.assertEqual(doc["total"], "940.00")

    def test_every_problem_is_listed_at_once(self):
        from ap_workflow.manual import keyed_doc, KeyedError
        with self.assertRaises(KeyedError) as e:
            keyed_doc(self.entry(vendor_name="", invoice_no="", date="2026-02-30", total="abc", reason="x", lines=[]), self.original, self.cfg)
        for words in ("Vendor name", "Invoice number", "real date", "Total must be", "why", "at least one line"):
            self.assertIn(words, str(e.exception))

    def test_keyed_numbers_must_tie_out(self):
        from ap_workflow.manual import keyed_doc, KeyedError
        with self.assertRaises(KeyedError) as e:
            keyed_doc(self.entry(total="950.00"), self.original, self.cfg)
        self.assertIn("do not tie out", str(e.exception))

    def test_over_the_limit_a_different_person_must_check(self):
        from ap_workflow.manual import keyed_doc, KeyedError
        big = dict(lines=[{"desc": "Lumber package", "qty": "1", "rate": "9000.00", "amount": "9000.00"}], subtotal="9000.00", total="9000.00")
        with self.assertRaises(KeyedError) as e:
            keyed_doc(self.entry(**big), self.original, self.cfg)
        self.assertIn("second person", str(e.exception))
        with self.assertRaises(KeyedError) as e:
            keyed_doc(self.entry(**big, checked_by=self.avery), self.original, self.cfg)
        self.assertIn("different person", str(e.exception))
        doc = keyed_doc(self.entry(**big, checked_by=self.sam), self.original, self.cfg)
        self.assertEqual(doc["extraction"]["checked_by"]["id"], "sam")
        self.assertIsNotNone(keyed_doc(self.entry(), self.original, self.cfg))       # $940 is under the $2,500 limit

    def test_credit_memo_amounts_are_negative_and_pay_apps_are_refused(self):
        from ap_workflow.manual import keyed_doc, KeyedError
        doc = keyed_doc(self.entry(kind="credit_memo"), self.original, self.cfg)
        self.assertEqual((doc["total"], doc["lines"][0]["amount"]), ("-940.00", "-600.00"))
        with self.assertRaises(KeyedError):
            keyed_doc(self.entry(kind="pay_app"), self.original, self.cfg)

    def test_payment_change_wording_still_goes_to_treasury(self):
        from ap_workflow.manual import keyed_doc
        doc = keyed_doc(self.entry(payment_change=True), self.original, self.cfg)
        self.assertTrue(doc["payment_change_hits"])

    def test_a_run_uses_the_entry_only_for_the_file_it_was_keyed_from(self):
        from ap_workflow.manual import keyed_doc
        tmp = Path(tempfile.mkdtemp())
        try:
            syn.make_statement(tmp / "statement.pdf")
            sha = hashlib.sha256((tmp / "statement.pdf").read_bytes()).hexdigest()
            good = keyed_doc(self.entry(), {"file": "statement.pdf", "sha256": sha}, self.cfg)
            (tmp / "statement.keyed.json").write_text(json.dumps(good))
            self.assertEqual(cli.read_keyed(tmp / "statement.keyed.json", tmp / "statement.pdf")["extraction"]["method"], "manual")
            (tmp / "statement.keyed.json").write_text(json.dumps({**good, "sha256": "00" * 32}))
            bad = cli.read_keyed(tmp / "statement.keyed.json", tmp / "statement.pdf")
            self.assertEqual(bad["kind"], "unreadable")
            self.assertIn("not keyed from this file", bad["unreadable_reason"])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    @needs_package
    def test_penny_checks_a_keyed_invoice_like_any_other(self):
        from ap_workflow.manual import keyed_doc
        tmp = Path(tempfile.mkdtemp())
        try:
            batch = tmp / "batch"
            batch.mkdir()
            syn.make_statement(batch / "statement.pdf")
            sha = hashlib.sha256((batch / "statement.pdf").read_bytes()).hexdigest()
            (batch / "statement.keyed.json").write_text(json.dumps(keyed_doc(self.entry(), {"file": "statement.pdf", "sha256": sha}, self.cfg)))
            decs, _ = cli.run(PKG, batch, "manual_test", tmp / "state", tmp / "runs", dry_run=True, quiet=True)
            d = decs[0]
            self.assertTrue(d.vendor_id)                                            # matched to the vendor master
            self.assertFalse(any("not in an invoice layout" in r for r in d.reasons))   # decided on the keyed data
            self.assertIn("PO2410315-008", " ".join(d.trail))
            self.assertIn("(keyed by hand)", (tmp / "runs" / "manual_test" / "run_report.md").read_text())
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class ReplayTests(unittest.TestCase):
    """(added after submission, v1.5) Recheck and the rule simulator decide saved readings again, and never save."""

    def test_scratch_register_cannot_be_saved(self):
        from ap_workflow.replay import ScratchRegister
        reg = ScratchRegister({"k": {"status": "ENTERED"}})
        reg.upsert("k2", status="HELD")
        with self.assertRaises(RuntimeError):
            reg.save()
        with self.assertRaises(RuntimeError):
            reg.append_log([])

    @needs_package
    def test_replaying_saved_readings_rebuilds_every_saved_decision(self):
        from ap_workflow.reference import load_package
        from ap_workflow.replay import saved_runs, simulate
        cfg = json.loads((ROOT / "config" / "rules.json").read_text())
        runs = [r for r in saved_runs(ROOT / "runs") if r["id"] in WebExportTests.OFFICIAL_RUNS]
        self.assertEqual(len(runs), len(WebExportTests.OFFICIAL_RUNS))
        out = simulate(load_package(PKG), cfg, cfg, runs)
        self.assertEqual((out["documents"], out["differs_from_saved"], out["changes"]), (47, 0, []))

    @needs_package
    def test_simulator_shows_what_a_higher_tolerance_would_release(self):
        from ap_workflow.reference import load_package
        from ap_workflow.replay import saved_runs, simulate
        cfg = json.loads((ROOT / "config" / "rules.json").read_text())
        draft = json.loads(json.dumps(cfg))
        draft["thresholds"]["overpo_tolerance"] = 1000000
        runs = [r for r in saved_runs(ROOT / "runs") if r["id"] in WebExportTests.OFFICIAL_RUNS]
        out = simulate(load_package(PKG), cfg, draft, runs)
        first = next(c for c in out["changes"] if c["doc_id"] == "APINBOX_0001" and c["run_id"] == "run1_batch01")
        self.assertEqual(first["before"]["codes"], ["OVERPO"])
        self.assertNotIn("OVERPO", first["after"]["codes"])
        self.assertNotEqual(out["rules_now"], out["rules_draft"])


class PreviewServerTests(unittest.TestCase):
    """(added after submission, v1.5) The server's recheck, simulate and manual-entry endpoints."""
    CLERK = {"id": "avery", "name": "Avery Chen", "role": "clerk"}
    ADMIN = {"id": "sam", "name": "Sam Rivera", "role": "admin"}
    APPROVER = {"id": "jordan", "name": "Jordan Patel", "role": "approver"}

    def setUp(self):
        from ap_workflow import webserver
        self.ws = webserver
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "web" / "data").mkdir(parents=True)
        # One saved run with one unreadable-layout bill, uploaded to inbox/ the way the web app does it.
        src = self.tmp / "inbox" / "2026-11-10_statements"
        src.mkdir(parents=True)
        syn.make_statement(src / "statement.pdf")
        self.sha = hashlib.sha256((src / "statement.pdf").read_bytes()).hexdigest()
        run = self.tmp / "runs" / "run1_2026-11-10_statements"
        (run / "extracted").mkdir(parents=True)
        (run / "extracted" / "statement.json").write_text(json.dumps({"file": "statement.pdf", "supdoc_id": "statement", "sha256": self.sha, "kind": "unrecognized"}))
        (run / "decisions.json").write_text(json.dumps([{"file": "statement.pdf", "decision": "HOLD", "codes": ["OTHER"], "reasons": ["[OTHER] unknown layout"]}]))
        (run / "run_info.json").write_text(json.dumps({"run_id": run.name, "batch": "2026-11-10_statements", "batch_dir": "inbox/2026-11-10_statements"}))
        self.run_id = run.name
        self.svc = webserver.BatchService(self.tmp, None, self.tmp / "state", self.tmp / "runs", self.tmp / "web", ROOT / "config" / "rules.json")
        import base64
        self.png = b"\x89PNG\r\n\x1a\n" + b"screenshot" * 20
        self.evidence = [{"name": "statement screenshot.png", "data": base64.b64encode(self.png).decode()}]
        self.entry = sample_entry(evidence=[{"name": "statement screenshot.png", "sha256": hashlib.sha256(self.png).hexdigest()}])

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_permissions(self):
        for need, who in (("recheck", self.APPROVER), ("manual", self.APPROVER), ("simulate", self.CLERK), ("recheck", None)):
            with self.subTest(need=need):
                with self.assertRaises(self.ws.BatchError) as e:
                    self.ws.check_user(who, need)
                self.assertEqual(e.exception.status, 403)
        with self.assertRaises(self.ws.BatchError) as e:
            self.svc.simulate(self.ADMIN, None, None)       # allowed, but there is no reference data on this server
        self.assertEqual(e.exception.status, 503)

    def test_evidence_type_is_read_from_content(self):
        self.assertEqual(self.ws.evidence_kind(self.png), "png")
        self.assertEqual(self.ws.evidence_kind(b"\xff\xd8\xff\xe0data"), "jpg")
        self.assertEqual(self.ws.evidence_kind(b"%PDF-1.4 ..."), "pdf")
        self.assertIsNone(self.ws.evidence_kind(b"<html>not an image</html>"))

    def test_manual_entry_is_saved_beside_the_original_with_its_evidence(self):
        ev = self.svc.save_manual(self.CLERK, self.run_id, "statement", self.entry, self.evidence, event_id="m1")
        folder = self.tmp / ev["folder"]
        self.assertTrue(ev["batch"].endswith("_manual-statement"))
        self.assertEqual(hashlib.sha256((folder / "statement.pdf").read_bytes()).hexdigest(), self.sha)
        keyed = json.loads((folder / "statement.keyed.json").read_text())
        self.assertEqual((keyed["sha256"], keyed["extraction"]["method"], keyed["invoice_no"]), (self.sha, "manual", "PBS-910005"))
        self.assertEqual((folder / "evidence" / "statement_screenshot.png").read_bytes(), self.png)
        self.assertEqual([f["name"] for f in self.svc.files(ev["batch"])], ["statement.pdf"])      # evidence is never read as an invoice
        log = self.svc.read_log()
        self.assertEqual([e["event"] for e in log], ["batch.created", "manual.saved"])
        self.assertEqual((log[1]["doc"], log[1]["keyed_by"]["id"], log[1]["evidence"][0]["sha256"]),
                         ("statement", "avery", hashlib.sha256(self.png).hexdigest()))
        listed = next(b for b in self.svc.list() if b["batch"] == ev["batch"])
        self.assertEqual((listed["keyed"], listed["evidence"]), (["statement.keyed.json"], ["statement_screenshot.png"]))

    def test_manual_entry_refusals(self):
        import base64
        cases = {
            "no evidence": dict(evidence=[]),
            "evidence swapped": dict(evidence=[{"name": "x.png", "data": base64.b64encode(self.png + b"x").decode()}]),
            "not an image": dict(evidence=[{"name": "x.png", "data": base64.b64encode(b"<html>").decode()}]),
            "bad entry": dict(entry={**self.entry, "total": "1.00"}),
        }
        for name, kw in cases.items():
            with self.subTest(name):
                args = {"entry": self.entry, "evidence": self.evidence, **kw}
                with self.assertRaises(self.ws.BatchError):
                    self.svc.save_manual(self.CLERK, self.run_id, "statement", args["entry"], args["evidence"])
        (self.tmp / "inbox" / "2026-11-10_statements" / "statement.pdf").write_bytes(b"%PDF-1.4 changed")
        with self.assertRaises(self.ws.BatchError) as e:
            self.svc.save_manual(self.CLERK, self.run_id, "statement", self.entry, self.evidence)
        self.assertIn("not the file Penny read", str(e.exception))
        self.assertFalse([p for p in (self.tmp / "inbox").iterdir() if "manual" in p.name])   # nothing half-saved

    @needs_package
    def test_recheck_previews_without_saving(self):
        svc = self.ws.BatchService(self.tmp, PKG, self.tmp / "state", self.tmp / "runs", self.tmp / "web", ROOT / "config" / "rules.json")
        same = svc.recheck(self.CLERK, self.run_id, "statement", "saved", event_id="r1")
        self.assertEqual((same["before"]["decision"], same["after"]["decision"]), ("HOLD", "HOLD"))
        keyed = svc.recheck(self.CLERK, self.run_id, "statement", "keyed", entry=self.entry)
        self.assertTrue(keyed["after"]["vendor_name"])
        self.assertEqual(keyed["versions"]["document"]["read_by"], "manual")
        self.assertEqual(len(keyed["versions"]["rules"]["fingerprint"]), 12)
        pdf = (self.tmp / "inbox" / "2026-11-10_statements" / "statement.pdf").read_bytes()
        again = svc.recheck(self.CLERK, self.run_id, "statement", "file", pdf=pdf, pdf_name="statement.pdf")
        self.assertEqual(again["versions"]["document"]["sha256"], self.sha)
        self.assertFalse((self.tmp / "state" / "processed_register.csv").exists())
        self.assertEqual([e["event"] for e in svc.read_log()], ["recheck.preview"] * 3)


if __name__ == "__main__":
    unittest.main()
