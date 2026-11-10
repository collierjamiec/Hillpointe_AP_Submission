"""Regression and edge-case tests. Run:  python -m unittest discover -s tests -v
(set HILLPOINTE_PACKAGE to the package folder if it is not next to the workflow folder)."""
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


if __name__ == "__main__":
    unittest.main()
