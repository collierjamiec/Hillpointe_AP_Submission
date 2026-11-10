"""Regression and edge-case tests. Run:  python -m unittest discover -s tests -v
(set HILLPOINTE_PACKAGE to the package folder if it is not next to the workflow folder)."""
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.environ["PENNY_NO_UPDATE_CHECK"] = "1"         # tests never reach out to GitHub; VersionTests turn it back on with a fake fetch
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from ap_workflow import cli                      # noqa: E402
from ap_workflow.rules import allocate_tax       # noqa: E402
from ap_workflow.util import norm_invoice_no     # noqa: E402
import synthetic as syn                          # noqa: E402

try:
    PKG = cli.find_package(os.environ.get("HILLPOINTE_PACKAGE"))
except SystemExit:          # no assessment package on this machine: run the tests that do not need it, skip the rest
    PKG = None
needs_package = unittest.skipIf(PKG is None, "assessment package not found (set HILLPOINTE_PACKAGE)")
EXPECTED = json.loads((ROOT / "tests" / "expected_decisions.json").read_text())


def outcome(d):
    return {"decision": d.status, "codes": set(d.codes), "total": str(d.amount), "lines": len(d.lines) or len(d.entrata_rows)}


class UnitTests(unittest.TestCase):
    def test_invoice_number_normalization(self):
        self.assertEqual(norm_invoice_no("INV-20417"), norm_invoice_no("20417"))
        self.assertEqual(norm_invoice_no("inv 020417"), norm_invoice_no("20417"))
        self.assertNotEqual(norm_invoice_no("55102"), norm_invoice_no("55103"))
        self.assertEqual(norm_invoice_no("GCP-0303"), norm_invoice_no("GCP0303"))

    def test_tax_allocation_rounding_goes_to_largest_line(self):
        out = allocate_tax([Decimal("100.00"), Decimal("100.00"), Decimal("100.00")], Decimal("10.00"))
        self.assertEqual(sum(out), Decimal("10.00"))
        out = allocate_tax([Decimal("5200"), Decimal("1345")], Decimal("523.60"))
        self.assertEqual(out, [Decimal("416.00"), Decimal("107.60")])


@needs_package
class AssessmentBatches(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.state, cls.out = cls.tmp / "state", cls.tmp / "runs"
        b1, b2 = PKG / "01_Invoice_Batch_01", PKG / "07_Invoice_Batch_02_Rerun"
        cls.r1, e1 = cli.run(PKG, b1, "t1", cls.state, cls.out, quiet=True)
        cls.r2, e2 = cli.run(PKG, b1, "t2", cls.state, cls.out, quiet=True)
        cls.r3, e3 = cli.run(PKG, b2, "t3", cls.state, cls.out, quiet=True)
        cls.r4, e4 = cli.run(PKG, b2, "t4", cls.state, cls.out, quiet=True)
        cls.errs = e1 + e2 + e3 + e4

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _check(self, decisions, key):
        for d in decisions:
            exp = EXPECTED[key][d.supdoc_id]
            got = outcome(d)
            self.assertEqual(got["decision"], exp["decision"], d.file)
            if "codes" in exp:
                self.assertEqual(got["codes"], set(exp["codes"]), d.file)
            if "total" in exp:
                self.assertEqual(Decimal(got["total"]), Decimal(exp["total"]), d.file)
                self.assertEqual(got["lines"], exp["lines"], d.file)

    def test_batch01_matches_answer_key(self):
        self._check(self.r1, "batch01")

    def test_batch02_matches_answer_key(self):
        self._check(self.r3, "batch02")

    def test_preflight_clean(self):
        self.assertEqual(self.errs, [])

    def test_rerun_batch01_enters_nothing(self):
        self.assertTrue(all(d.status in ("SKIP_ALREADY_ENTERED", "HOLD", "DUP") for d in self.r2))
        self.assertEqual([d for d in self.r2 if d.lines or d.entrata_rows and d.status.startswith("ENTER")], [])
        csv_rows = (self.out / "t2" / "intacct_bill_import.csv").read_text().strip().splitlines()
        self.assertEqual(len(csv_rows), 1)   # header only

    def test_batch02_rerun_enters_nothing(self):
        csv_rows = (self.out / "t4" / "intacct_bill_import.csv").read_text().strip().splitlines()
        self.assertEqual(len(csv_rows), 1)

    def test_nothing_entered_twice_across_all_runs(self):
        seen = {}
        for run in ("t1", "t2", "t3", "t4"):
            for line in (self.out / run / "intacct_bill_import.csv").read_text().splitlines()[1:]:
                f = line.split(",")
                key = (f[2], f[0])
                seen.setdefault(key, set()).add(run)
        self.assertTrue(all(len(v) == 1 for v in seen.values()), seen)


@needs_package
class EdgeCases(unittest.TestCase):
    def run_docs(self, builders):
        tmp = Path(tempfile.mkdtemp())
        try:
            b = tmp / "batch"; b.mkdir()
            for name, fn in builders:
                fn(b / f"{name}.pdf")
            decs, errs = cli.run(PKG, b, "edge", tmp / "state", tmp / "out", quiet=True)
            self.assertEqual(errs, [], errs)
            return {d.supdoc_id: d for d in decs}
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def one(self, fn):
        return self.run_docs([("X1", fn)])["X1"]

    def test_wrong_hillpointe_entity_is_informational_not_hold(self):
        d = self.one(lambda p: syn.make_invoice(p, bill_to="Hillpointe Property Management, LLC"))
        self.assertEqual(d.status, "ENTER_INTACCT")
        self.assertTrue(any("posted to HPC" in i for i in d.info))

    def test_non_legal_entity_bill_to_is_hold(self):
        d = self.one(lambda p: syn.make_invoice(p, bill_to="Hillpointe Homes, LLC"))
        self.assertEqual((d.status, d.codes), ("HOLD", ["OTHER"]))

    def test_inactive_vendor_name_maps_to_surviving_record(self):
        d = self.one(lambda p: syn.make_invoice(p, vendor="Ridgeway Equipment Rentals", addr="2280 Augusta Rd | Lexington, SC 29072",
                                                phone="(803) 555-0177", remit_addr="2280 Augusta Rd, Lexington, SC 29072", ref="PO2410315-014",
                                                number="RER-90001", lines=(("Telehandler weekly rental", 1, "EA", 1000.0),)))
        self.assertEqual((d.status, d.vendor_id), ("ENTER_INTACCT", "V1002"))
        self.assertEqual(d.confidence, "Medium")

    def test_duplicate_with_different_number_format(self):
        d = self.one(lambda p: syn.make_invoice(p, vendor="Ridgeway Equipment Rental Inc", addr="2280 Augusta Rd | Lexington, SC 29072",
                                                phone="(803) 555-0177", remit_addr="2280 Augusta Rd, Lexington, SC 29072", ref="PO2410315-014",
                                                number="inv 0020417", date="09/12/2026", lines=(("Telehandler", 1, "EA", 3000.0),), tax=240.0, tax_label="SC sales tax 6% + 2%"))
        self.assertEqual(d.status, "DUP")

    def test_same_number_from_a_different_vendor_is_not_a_duplicate(self):
        d = self.one(lambda p: syn.make_invoice(p, number="55102", lines=(("Framing lumber", 1, "LS", 1000.0),)))
        self.assertEqual(d.status, "ENTER_INTACCT")

    def test_po_tolerance_boundary(self):
        mk = lambda amt: (lambda p: syn.make_invoice(p, vendor="Coastal Site Services LLC", addr="1190 Louisville Rd | Savannah, GA 31415",
                                                     phone="(912) 555-0122", remit_addr="1190 Louisville Rd, Savannah, GA 31415", number="CSS-90001",
                                                     ref="PO241088-009", ship="Pointe Grand Kingsland East", terms="Net 15",
                                                     lines=(("Fence rental", 1, "LS", amt),)))
        ok = self.one(mk(6300.0))      # remaining 5,820 so over by 480: inside the $500 tolerance
        self.assertEqual(ok.status, "ENTER_INTACCT")
        bad = self.one(mk(6400.0))     # over by 580
        self.assertEqual((bad.status, bad.codes), ("HOLD", ["OVERPO"]))

    def test_pay_app_ok_and_vp_approver(self):
        d = self.one(lambda p: syn.make_pay_app(p, number="GCP-0303B", sc="SC2410315-03", app_no=3, period=("09/01/2026", "09/30/2026"), date="09/30/2026",
                                                completed=352500.0, prev_certs=183600.0, rows=(("Building 2 slab", 74250.0), ("Building 3 slab", 74250.0))))
        self.assertEqual(d.status, "ENTER_INTACCT")
        self.assertEqual(str(d.amount), "133650.00")
        self.assertTrue(any("VP Construction" in a for a in d.approvers))

    def test_lien_waiver_amount_mismatch_is_hold(self):
        d = self.one(lambda p: syn.make_pay_app(p, number="GCP-0303B", sc="SC2410315-03", app_no=3, period=("09/01/2026", "09/30/2026"), date="09/30/2026",
                                                completed=352500.0, prev_certs=183600.0, waiver_amount=100000.0,
                                                rows=(("Building 2 slab", 74250.0), ("Building 3 slab", 74250.0))))
        self.assertEqual((d.status, d.codes), ("HOLD", ["LIEN"]))

    def test_pay_app_previous_certificates_must_match_history(self):
        d = self.one(lambda p: syn.make_pay_app(p, number="GCP-0303C", sc="SC2410315-03", app_no=3, period=("09/01/2026", "09/30/2026"), date="09/30/2026",
                                                completed=352500.0, prev_certs=170000.0, rows=(("Building 2 slab", 74250.0), ("Building 3 slab", 74250.0))))
        self.assertEqual(d.status, "HOLD")
        self.assertIn("OTHER", d.codes)

    def test_service_fee_mismatch_is_hold(self):
        d = self.one(lambda p: syn.make_invoice(p, vendor="Magnolia Pool Services LLC", addr="210 Prince Ave | Athens, GA 30601", phone="(706) 555-0119",
                                                remit_addr="210 Prince Ave, Athens, GA 30601", bill_to="Pointe Grand Athens", c_o="Hillpointe Property Management, LLC",
                                                number="MPS-9001", ref="SA-PGATH-2026", ship="Pointe Grand Athens, Athens, GA",
                                                lines=(("Pool and spa maintenance, November 2026", 1, "LS", 1500.0),)))
        self.assertEqual((d.status, d.codes), ("HOLD", ["OTHER"]))

    def test_standalone_lien_waiver_is_other(self):
        d = self.one(lambda p: syn.make_waiver_only(p))
        self.assertEqual((d.status, d.codes), ("HOLD", ["OTHER"]))

    def test_cfo_approver_over_25k(self):
        d = self.one(lambda p: syn.make_invoice(p, vendor="LedgerLoop Software Inc", addr="88 Market St, Suite 400 | Austin, TX 78701", phone="(512) 555-0109",
                                                remit_addr="88 Market St, Suite 400, Austin, TX 78701", bill_to="Hillpointe Corporate Management, LLC",
                                                number="LL-9001", ref="Order Form OF-2024-0332", ship="",
                                                lines=(("LedgerLoop Platform subscription, November 2026 (per seat)", 1, "LS", 30000.0),)))
        self.assertEqual(d.status, "ENTER_INTACCT")
        self.assertTrue(any("CFO" in a for a in d.approvers))
        self.assertEqual(sum(l["AMOUNT"] for l in d.lines), Decimal("30000.00"))

    def test_unknown_po_number_is_nopo(self):
        d = self.one(lambda p: syn.make_invoice(p, ref="PO2410315-099"))
        self.assertEqual((d.status, d.codes), ("HOLD", ["NOPO"]))

    def test_credit_memo_for_unknown_original_is_hold(self):
        d = self.one(lambda p: syn.make_invoice(p, number="CM-9", credit=True, notes=("Credit applies to original invoice PBS-000001 dated 09/09/2026.",),
                                                lines=(("Return of material", 1, "LS", 500.0),)))
        self.assertEqual(d.status, "HOLD")

    def test_remit_address_change_alone_is_bankchg(self):
        d = self.one(lambda p: syn.make_invoice(p, remit_addr="PO Box 1234, Columbia, SC 29290", addr="PO Box 1234 | Columbia, SC 29290"))
        self.assertEqual((d.status, d.codes), ("HOLD", ["BANKCHG"]))

    def test_revised_invoice_for_an_entered_bill_is_not_entered_twice(self):
        orig = lambda p: syn.make_invoice(p, number="PBS-900002")
        rev = lambda p: syn.make_invoice(p, number="PBS-900003", title="REVISED INVOICE", notes=("Replaces original invoice PBS-900002.",))
        r = self.run_docs([("A_orig", orig), ("B_rev", rev)])
        self.assertEqual(r["A_orig"].status, "ENTER_INTACCT")
        self.assertEqual(r["B_rev"].status, "DUP")

    def test_closed_period_bill_posts_to_first_open_period(self):
        d = self.one(lambda p: syn.make_invoice(p, date="09/20/2026"))
        self.assertEqual(d.status, "ENTER_INTACCT")
        self.assertEqual(str(d.lines[0]["GL_POSTING_DATE"]), "2026-10-01")
        self.assertEqual(str(d.lines[0]["DUE_DATE"]), "2026-10-20")   # 09/20 + Net 30, not based on the posting date


@needs_package
class RuleChangeTests(unittest.TestCase):
    """The live session asks for a small rule change. These prove a one-line config edit changes behaviour, with no code edits."""

    def run_with(self, edit, batch_name="01_Invoice_Batch_01"):
        tmp = Path(tempfile.mkdtemp())
        old = cli.CFG_PATH
        try:
            cfg = json.loads((ROOT / "config" / "rules.json").read_text())
            edit(cfg)
            (tmp / "rules.json").write_text(json.dumps(cfg))
            cli.CFG_PATH = tmp / "rules.json"
            decs, errs = cli.run(PKG, PKG / batch_name, "rc", tmp / "state", tmp / "out", quiet=True)
            self.assertEqual(errs, [])
            return {d.supdoc_id: d for d in decs}
        finally:
            cli.CFG_PATH = old
            shutil.rmtree(tmp, ignore_errors=True)

    def test_raising_po_tolerance_releases_the_overpo_hold(self):
        r = self.run_with(lambda c: c["thresholds"].update(overpo_tolerance=2000.0))
        self.assertEqual(r["APINBOX_0001"].status, "ENTER_INTACCT")     # over by 1,392.07

    def test_vp_threshold_change_changes_approvers(self):
        r = self.run_with(lambda c: c["thresholds"].update(vp_construction_gross_over=150000.0))
        self.assertFalse(any("VP Construction" in a for a in r["APINBOX_0003"].approvers))

    def test_cfo_label_follows_the_configured_amount(self):
        r = self.run_with(lambda c: c["thresholds"].update(cfo_bill_over=4000.0))
        self.assertIn("CFO (bill over $4,000)", r["APINBOX_0002"].approvers)

    def test_route_change_shows_in_exception_log(self):
        tmp = Path(tempfile.mkdtemp())
        old = cli.CFG_PATH
        try:
            cfg = json.loads((ROOT / "config" / "rules.json").read_text())
            cfg["routes"]["DUP"] = "AP Supervisor"
            (tmp / "rules.json").write_text(json.dumps(cfg))
            cli.CFG_PATH = tmp / "rules.json"
            cli.run(PKG, PKG / "01_Invoice_Batch_01", "rc", tmp / "state", tmp / "out", quiet=True)
            self.assertIn("AP Supervisor", (tmp / "out" / "rc" / "exception_log.csv").read_text())
        finally:
            cli.CFG_PATH = old
            shutil.rmtree(tmp, ignore_errors=True)

    def test_coi_grace_days_holds_more_documents(self):
        r = self.run_with(lambda c: c["thresholds"].update(coi_grace_days=400))
        self.assertIn("COI", r["APINBOX_0005"].codes)   # Coastal COI 12/31/2026 is inside 400 days of 10/01/2026


class LlmPathTests(unittest.TestCase):
    """The LLM extractor needs an API key, so here we test what can be tested offline."""

    def test_hybrid_without_key_falls_back_to_rules_and_says_so(self):
        from ap_workflow import llm_extract
        cfg = json.loads((ROOT / "config" / "rules.json").read_text())
        tmp = Path(tempfile.mkdtemp())
        try:
            syn.make_invoice(tmp / "x.pdf", lines=(("Framing lumber", 1, "LS", 1000.0),), tax=1.0)   # tax rate does not tie, so validation fails
            old = os.environ.pop("ANTHROPIC_API_KEY", None)
            doc = llm_extract.extract(tmp / "x.pdf", cfg, "hybrid")
            if old:
                os.environ["ANTHROPIC_API_KEY"] = old
            self.assertEqual(doc["extraction"]["method"], "rules")
            self.assertTrue(any("ANTHROPIC_API_KEY" in w for w in doc["extraction"]["warnings"]))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_merge_overrides_fields_and_rebuilds_refs(self):
        from ap_workflow import llm_extract
        base = {"customer_ref": "", "refs_customer_ref": {"po": [], "subcontract": [], "service_agreement": [], "order_form": []}, "kind": "invoice", "lines": []}
        out = llm_extract.merge(dict(base), {"customer_ref": "PO2410315-008", "invoice_no": "X1", "kind": "invoice", "lines": []})
        self.assertEqual(out["refs_customer_ref"]["po"], ["PO2410315-008"])
        self.assertEqual(out["invoice_no"], "X1")

    def test_credit_memo_amounts_forced_negative(self):
        from ap_workflow import llm_extract
        out = llm_extract.merge({"refs_customer_ref": {}, "kind": "credit_memo"}, {"kind": "credit_memo", "lines": [{"desc": "x", "amount": "100.00"}]})
        self.assertEqual(out["lines"][0]["amount"], "-100.00")


class UnreadableFiles(unittest.TestCase):
    """A corrupt, empty, locked or scanned file must never crash a run. It is held, named, and given a reason a
    person can act on, and every other file in the batch is still processed."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.cfg = json.loads((ROOT / "config" / "rules.json").read_text())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def make_bad(self, folder):
        folder.mkdir(parents=True, exist_ok=True)
        for name, (build, _) in syn.BAD_FILES.items():
            build(folder / f"{name}.pdf")

    def test_each_bad_file_gets_a_plain_reason(self):
        from ap_workflow.llm_extract import extract
        self.make_bad(self.tmp)
        for name, (_, words) in syn.BAD_FILES.items():
            for mode in ("rules", "hybrid"):
                with self.subTest(file=name, mode=mode):
                    doc = extract(self.tmp / f"{name}.pdf", self.cfg, mode)
                    self.assertEqual(doc["kind"], "unreadable")
                    self.assertEqual(doc["file"], f"{name}.pdf")
                    self.assertIn(words, doc["unreadable_reason"])

    def test_unexpected_parser_error_is_caught_too(self):
        from unittest import mock
        from ap_workflow import llm_extract
        syn.make_invoice(self.tmp / "x.pdf")
        with mock.patch.object(llm_extract, "extract_with_rules", side_effect=ValueError("bad layout")):
            doc = llm_extract.extract(self.tmp / "x.pdf", self.cfg, "rules")
        self.assertEqual(doc["kind"], "unreadable")
        self.assertIn("bad layout", doc["unreadable_reason"])

    def test_run_of_only_bad_files_finishes_without_reference_data(self):
        """The whole pipeline (decisions, exception log, workbook, register) runs on bad files without crashing.
        No reference data is needed because an unreadable file is held before any lookup."""
        from unittest import mock
        import csv
        batch = self.tmp / "batch"
        self.make_bad(batch)
        with mock.patch.object(cli, "load_package", return_value=(None, None, None)):
            decs, errs = cli.run(self.tmp, batch, "bad", self.tmp / "state", self.tmp / "out", quiet=True)
        self.assertEqual(errs, [])
        self.assertEqual(len(decs), len(syn.BAD_FILES))
        for d in decs:
            self.assertEqual((d.status, d.codes), ("HOLD", ["OTHER"]), d.file)
            self.assertIn("Could not read this file", d.reasons[0])
        out = self.tmp / "out" / "bad"
        with open(out / "exception_log.csv", encoding="utf-8") as f:
            logged = {r["File"]: r for r in csv.DictReader(f)}
        self.assertEqual(set(logged), {f"{n}.pdf" for n in syn.BAD_FILES})
        self.assertIn("password protected", logged["password.pdf"]["Reason"])
        self.assertEqual(logged["password.pdf"]["Recommended Route"], "AP Manager")
        self.assertTrue((out / "review_workbook.xlsx").exists())
        self.assertEqual(cli.Register(self.tmp / "state").rows, {})   # nothing to key on, so nothing in the register
        info = json.loads((out / "run_info.json").read_text())
        self.assertEqual((info["run_id"], info["batch"]), ("bad", "batch"))
        self.assertTrue(info["started_at"])

    def test_bill_in_an_unknown_layout_is_held_with_an_honest_reason(self):
        """A real bill Penny cannot read must not be called 'not a bill'. A lien waiver on its own still is."""
        from unittest import mock
        batch = self.tmp / "batch"; batch.mkdir()
        syn.make_statement(batch / "statement.pdf")
        syn.make_waiver_only(batch / "waiver.pdf")
        with mock.patch.object(cli, "load_package", return_value=(None, None, None)):
            decs, errs = cli.run(self.tmp, batch, "layout", self.tmp / "state", self.tmp / "out", quiet=True)
        by = {d.file: d for d in decs}
        st, wv = by["statement.pdf"], by["waiver.pdf"]
        self.assertEqual((st.status, st.codes, st.doc["kind"]), ("HOLD", ["OTHER"], "unrecognized"))
        self.assertIn("looks like a bill for $940.00 that references PO2410315-008", st.reasons[0])
        self.assertNotIn("lien waiver", st.reasons[0])
        self.assertEqual(st.confidence, "Low")
        self.assertEqual(wv.doc["kind"], "other")
        self.assertIn("Not a bill", wv.reasons[0])

    @needs_package
    def test_good_invoices_still_entered_when_batch_has_bad_files(self):
        batch = self.tmp / "batch"
        self.make_bad(batch)
        syn.make_invoice(batch / "good.pdf")
        decs, errs = cli.run(PKG, batch, "mixed", self.tmp / "state", self.tmp / "out", quiet=True)
        self.assertEqual(errs, [])
        by_file = {d.file: d for d in decs}
        self.assertEqual(by_file["good.pdf"].status, "ENTER_INTACCT")
        self.assertTrue(all(by_file[f"{n}.pdf"].status == "HOLD" for n in syn.BAD_FILES))
        rerun, _ = cli.run(PKG, batch, "mixed2", self.tmp / "state", self.tmp / "out", quiet=True)
        self.assertTrue(all(d.status == "HOLD" for d in rerun if d.file != "good.pdf"))   # re-read every run, never skipped


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
