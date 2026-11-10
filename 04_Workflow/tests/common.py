"""Shared setup for the test files: paths, the optional assessment package, and small helpers.
(set HILLPOINTE_PACKAGE to the package folder if it is not next to the workflow folder)."""
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest
import unittest.mock
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
