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
        a = self.svc.create("Weekly AP", self.CLERK, date="2026-11-10")
        b = self.svc.create("weekly ap", self.CLERK, date="2026-11-10")
        self.assertEqual((a["batch"], b["batch"]), ("2026-11-10_weekly-ap", "2026-11-10_weekly-ap-2"))
        self.assertEqual(a["folder"], "inbox/2026-11-10_weekly-ap")
        with self.assertRaises(self.ws.BatchError):
            self.svc.create("!!", self.CLERK)

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


if __name__ == "__main__":
    unittest.main()
