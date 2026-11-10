"""Manual entry for a file Penny could not read. (Added after submission, v1.5.)

When Penny cannot read a file but a person can open it in another tool, the person keys the invoice from that view.
This module turns what they keyed into the same record the PDF reader produces, so Penny runs every normal check on
it (vendor, bill-to, duplicates, PO, coding, dates, approvers). Nothing is decided here.

What keeps it auditable:
  * The original file stays the source document. The keyed record carries the original's name and SHA-256, so a
    rerun of the same file is still recognized, and the register points back to the real file.
  * Evidence (a screenshot or a re-saved PDF) is listed by name, size and SHA-256.
  * Who keyed it, why, and (above the dollar limit in Rules) who checked it by keying the invoice number and total
    again without seeing the first entry. The checker must be a different person.
  * extraction.method is "manual", so every report and screen can say "Manually entered".

Pay applications are not keyed here: their ten tied-out lines and continuation sheet need the vendor's real PDF.

On disk, a manual entry is a file named <original stem>.keyed.json in a batch folder, next to the original. A run
uses it in place of reading that PDF.
"""
import re
from datetime import datetime

from .extract import PO_RE, SC_RE, SA_RE, OF_RE, validate_extraction
from .util import D, q

KINDS = ("invoice", "credit_memo")
MONEY_RE = re.compile(r"^-?\d{1,9}(\.\d{1,2})?$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")


class KeyedError(ValueError):
    """What is wrong with a manual entry, in words the person who keyed it can fix."""


def _money(label, v, problems, allow_blank=False):
    """An amount typed by a person as a Decimal rounded to cents, or None after recording the problem."""
    s = str(v if v is not None else "").replace(",", "").replace("$", "").strip()
    if not s and allow_blank:
        return None
    if not MONEY_RE.match(s):
        problems.append(f"{label} must be an amount like 1234.56")
        return None
    return q(D(s))


def _text(entry, key, limit=120):
    """A typed field with whitespace collapsed and cut to a safe length."""
    return re.sub(r"\s+", " ", str(entry.get(key) or "")).strip()[:limit]


def _refs(text):
    """The PO, subcontract, service agreement and order form numbers found in a piece of text."""
    return {"po": PO_RE.findall(text), "subcontract": SC_RE.findall(text), "service_agreement": SA_RE.findall(text),
            "order_form": OF_RE.findall(text)}


def keyed_doc(entry: dict, original: dict, cfg: dict) -> dict:
    """Build a reading from a manual entry. `original` is what Penny saved for the unreadable file (file, sha256).
    Raises KeyedError listing every problem at once."""
    problems = []
    kind = entry.get("kind") or "invoice"
    if kind not in KINDS:
        problems.append("Only invoices and credit memos can be keyed by hand. A pay application needs the vendor's PDF.")
    vendor = _text(entry, "vendor_name")
    invoice_no = _text(entry, "invoice_no", 40)
    if not vendor:
        problems.append("Vendor name is required")
    if not invoice_no:
        problems.append("Invoice number is required")
    try:
        bill_date = datetime.strptime(str(entry.get("date") or ""), "%Y-%m-%d").date().isoformat()
    except ValueError:
        bill_date = ""
        problems.append("Invoice date must be a real date")
    lines = []
    for i, l in enumerate(entry.get("lines") or [], start=1):
        desc = re.sub(r"\s+", " ", str(l.get("desc") or "")).strip()[:120]
        amt = _money(f"Line {i} amount", l.get("amount"), problems)
        if not desc:
            problems.append(f"Line {i} needs a description")
        qty = str(l.get("qty") or "1").strip() or "1"
        rate = str(l.get("rate") or "").strip()
        if amt is not None:
            if kind == "credit_memo" and amt > 0:
                amt = -amt
            lines.append({"desc": desc, "qty": qty, "unit": str(l.get("unit") or "").strip()[:8], "rate": rate or str(abs(amt)), "amount": str(amt)})
    if not lines:
        problems.append("Add at least one line item")
    subtotal = _money("Subtotal", entry.get("subtotal"), problems)
    tax = _money("Tax", entry.get("tax_total") or "0", problems)
    total = _money("Total", entry.get("total"), problems)
    if kind == "credit_memo":
        subtotal, tax, total = [(-abs(x) if x is not None else None) for x in (subtotal, tax, total)]
    for ev in entry.get("evidence") or []:
        if not SHA_RE.match(str(ev.get("sha256", ""))):
            problems.append(f"Evidence {ev.get('name', '')!r} needs its SHA-256 fingerprint")
    keyed_by = entry.get("keyed_by") or {}
    if not keyed_by.get("id"):
        problems.append("Who keyed it is required")
    reason = _text(entry, "reason", 300)
    if len(reason) < 10:
        problems.append("Say why this was keyed by hand (at least 10 characters)")
    limit = D((cfg.get("thresholds") or {}).get("manual_entry_check_over", 0))
    checked_by = entry.get("checked_by") or {}
    if total is not None and abs(total) > limit:
        if not checked_by.get("id"):
            problems.append(f"Over ${limit:,.2f}, a second person must key the invoice number and total again")
        elif checked_by.get("id") == keyed_by.get("id"):
            problems.append("The second check must be done by a different person")
    if problems:
        raise KeyedError("; ".join(problems))

    customer_ref = _text(entry, "customer_ref", 60)
    other_refs = _text(entry, "other_refs", 200)
    low = " ".join([vendor, other_refs, " ".join(l["desc"] for l in lines)]).lower()
    doc = {
        "file": original["file"], "supdoc_id": original["file"].rsplit(".", 1)[0], "sha256": original.get("sha256", ""),
        "pages": 0, "stamps": [], "raw_text": "",
        "extraction": {"method": "manual", "warnings": [],
                       "keyed_by": keyed_by, "checked_by": checked_by or None, "reason": reason,
                       "evidence": [{k: ev.get(k) for k in ("name", "type", "bytes", "sha256")} for ev in entry.get("evidence") or []],
                       "keyed_at": entry.get("keyed_at") or ""},
        "kind": kind, "invoice_no": invoice_no, "date": bill_date, "terms_printed": _text(entry, "terms", 30),
        "customer_ref": customer_ref, "refs": _refs(f"{customer_ref} {other_refs}"), "refs_customer_ref": _refs(customer_ref),
        "bill_to": {"name": _text(entry, "bill_to"), "c_o": _text(entry, "bill_to_co")}, "ship_to": _text(entry, "ship_to"),
        "vendor_name_raw": vendor, "vendor_phone": "", "vendor_email": "", "vendor_address_header": _text(entry, "remit_address", 200),
        "remit_to": {"name": vendor, "address": _text(entry, "remit_address", 200)},
        "emails_on_doc": [], "phones_on_doc": [],
        # A person reports payment-change wording; Penny also scans what was keyed for the configured phrases.
        "payment_change_hits": (["keyed: the document mentions new payment instructions"] if entry.get("payment_change") else [])
                               + sorted({p for p in cfg.get("payment_change_phrases", []) if p in low}),
        "revised": False, "replaces_invoice": "", "credit_original_invoice": _text(entry, "credit_original_invoice", 40) if kind == "credit_memo" else "",
        "new_client_note": False, "lines": lines, "subtotal": str(subtotal), "tax_total": str(tax), "tax_label": "", "tax_rate": "",
        "total": str(total), "lien_waiver": {"attached": bool(entry.get("lien_waiver_attached")), "promised_later": False},
    }
    problems = validate_extraction(doc)
    if problems:
        raise KeyedError("The keyed numbers do not tie out: " + "; ".join(problems))
    return doc
