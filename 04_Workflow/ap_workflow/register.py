"""The processed-invoice register: the workflow's memory between runs.

Where it lives:   state/processed_register.csv   (one row per bill/credit key)
                  state/run_log.csv              (append-only audit trail, one row per document per run)

Duplicate key:    VENDOR_ID | normalized invoice number | doc type (Bill/Adjustment)

Status values:    ENTERED  the bill was written to an import file. A second document with the same key is a DUP.
                  HELD     the document was held. It is NOT a duplicate if it comes back: a corrected or revised
                           version is evaluated again from scratch and may now be entered.

Plain CSV on purpose: a reviewer can open it in Excel, diff it in git, and copy it to another machine.
"""
import csv
from pathlib import Path

from .util import norm_invoice_no

COLS = ["key", "status", "system", "vendor_id", "bill_no", "doc_type", "bill_date", "amount", "gross_amount", "reference_no",
        "project_id", "source_file", "file_sha256", "first_run", "last_run", "codes", "note"]
LOG_COLS = ["run_id", "source_file", "file_sha256", "decision", "codes", "vendor_id", "bill_no", "amount", "detail"]


def make_key(vendor_id, bill_no, doc_type):
    """The duplicate key: vendor ID, normalized invoice number, and Bill or Adjustment."""
    return f"{vendor_id}|{norm_invoice_no(bill_no)}|{doc_type}"


class Register:
    """The register of every invoice Penny has processed, so nothing is entered twice."""

    def __init__(self, state_dir: Path):
        """Load the register from state_dir (an empty one if this is the first run)."""
        self.dir = Path(state_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path = self.dir / "processed_register.csv"
        self.log_path = self.dir / "run_log.csv"
        self.rows = {}
        if self.path.exists():
            with open(self.path, newline="", encoding="utf-8") as f:
                for r in csv.DictReader(f):
                    self.rows[r["key"]] = r

    def get(self, key):
        """The register row for a key, or None."""
        return self.rows.get(key)

    def entered(self):
        """Every row whose bill was written to an import file."""
        return [r for r in self.rows.values() if r["status"] == "ENTERED"]

    def upsert(self, key, **kw):
        """Add or update a row. The first run that saw the key is kept."""
        r = self.rows.get(key, {c: "" for c in COLS})
        r["key"] = key
        for k, v in kw.items():
            r[k] = "" if v is None else str(v)
        if not r.get("first_run"):
            r["first_run"] = kw.get("last_run", "")
        self.rows[key] = r

    def save(self):
        """Write the register CSV, sorted by key so it diffs cleanly."""
        with open(self.path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=COLS)
            w.writeheader()
            for k in sorted(self.rows):
                w.writerow({c: self.rows[k].get(c, "") for c in COLS})

    def append_log(self, rows):
        """Append one line per document to the run log. It is never rewritten."""
        new = not self.log_path.exists()
        with open(self.log_path, "a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=LOG_COLS)
            if new:
                w.writeheader()
            for r in rows:
                w.writerow({c: r.get(c, "") for c in LOG_COLS})
