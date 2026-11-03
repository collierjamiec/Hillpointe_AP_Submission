"""Step 1: turn a vendor PDF into a structured JSON record.

Design rule: extraction only READS. It never decides anything. Every number it returns is checked by
`validate_extraction` (lines add up to the subtotal, subtotal plus tax equals the total, pay application
math ties) and anything that fails goes to a person instead of being guessed.

Two extractors share one output schema:
  * rules  - deterministic regex parser, no network, same answer every run (default)
  * llm    - Claude reads the PDF text using prompts/extraction_prompt.md (see llm_extract.py)
The 'hybrid' mode uses rules first and asks the LLM only when validation fails.
"""
import re
from pathlib import Path

from .pdfio import read_pdf
from .util import D, parse_money, parse_us_date, iso, sha256_file, q

MONEY = r"\(?-?\$[\d,]+\.\d{2}\)?"
PO_RE = re.compile(r"\bPO\d{6,7}-\d{3}\b")
SC_RE = re.compile(r"\bSC\d{6,7}-\d{2}\b")
SA_RE = re.compile(r"\bSA-[A-Z]+-\d{4}\b")
OF_RE = re.compile(r"\bOF-\d{4}-\d{4}\b")
PHONE_RE = re.compile(r"\(\d{3}\)\s*\d{3}-\d{4}")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
TITLES = ("APPLICATION FOR PAYMENT", "REVISED INVOICE", "CREDIT MEMO", "INVOICE")


def _strip_titles(s):
    for t in TITLES:
        s = re.sub(rf"\s*\b{t}\b\s*$", "", s.strip())
    return s.strip()


def _find(pattern, text, flags=0, group=1, default=""):
    m = re.search(pattern, text, flags)
    return m.group(group).strip() if m else default


def extract_with_rules(path: Path, cfg: dict) -> dict:
    pdf = read_pdf(path)
    text = pdf["text"]
    lines = [l.rstrip() for l in text.splitlines()]
    warnings = []

    doc = {
        "file": path.name,
        "supdoc_id": path.stem,
        "sha256": sha256_file(path),
        "pages": pdf["pages"],
        "stamps": sorted(set(pdf["stamps"])),
        "raw_text": text,
        "extraction": {"method": "rules", "warnings": warnings},
    }

    upper = text.upper()
    is_waiver_only = "CONDITIONAL WAIVER AND RELEASE" in upper and not re.search(r"Invoice No\.|Credit Memo No\.", text)
    if "CREDIT MEMO" in upper.split("BILL TO")[0]:
        kind = "credit_memo"
    elif "APPLICATION FOR PAYMENT" in upper:
        kind = "pay_app"
    elif is_waiver_only:
        kind = "other"
    elif re.search(r"Invoice No\.", text):
        kind = "invoice"
    else:
        kind = "other"
    doc["kind"] = kind

    # ---- header -------------------------------------------------------------------------
    doc["invoice_no"] = _find(r"(?m)(?:Invoice No\.|Credit Memo No\.)[ \t]+(.+?)[ \t]*$", text)
    d = _find(r"(?m)\bDate[ \t]+(\d{2}/\d{2}/\d{4})", text)
    doc["date"] = iso(parse_us_date(d)) if d else ""
    doc["terms_printed"] = _find(r"(?m)\bTerms[ \t]+(.+)$", text)
    ref = _find(r"(?m)Customer Ref[ \t]*(.*)$", text)
    doc["customer_ref"] = ref
    full = text
    doc["refs"] = {
        "po": sorted(set(PO_RE.findall(full))),
        "subcontract": sorted(set(SC_RE.findall(full))),
        "service_agreement": sorted(set(SA_RE.findall(full))),
        "order_form": sorted(set(OF_RE.findall(full))),
    }
    # the reference the vendor printed in the Customer Ref box is the one we match on
    doc["refs_customer_ref"] = {
        "po": PO_RE.findall(ref), "subcontract": SC_RE.findall(ref),
        "service_agreement": SA_RE.findall(ref), "order_form": OF_RE.findall(ref),
    }

    # bill to block: the 1-2 lines after 'BILL TO', with right-hand columns removed
    bill_to, c_o = "", ""
    for i, l in enumerate(lines):
        if l.startswith("BILL TO"):
            raw = []
            for nxt in lines[i + 1:i + 4]:
                nxt = re.sub(r"\s+(Date|Terms|Customer Ref)\b.*$", "", nxt).strip()
                if nxt.lower().startswith("attn") or re.match(r"^\d+ ", nxt):
                    break
                raw.append(nxt)
            if raw:
                bill_to = raw[0]
                if len(raw) > 1 and raw[1].lower().startswith("c/o"):
                    c_o = re.sub(r"^c/o\s*", "", raw[1], flags=re.I)
            break
    doc["bill_to"] = {"name": bill_to, "c_o": c_o}

    ship = ""
    for i, l in enumerate(lines):
        if l.startswith("PROJECT / SHIP TO"):
            parts = []
            for nxt in lines[i + 1:i + 3]:
                if re.match(r"^(Description|Application No)", nxt):
                    break
                parts.append(nxt.strip())
            ship = " ".join(parts)
            break
    doc["ship_to"] = ship

    # ---- vendor block / remit ------------------------------------------------------------
    remit_line = _find(r"(?m)^REMIT TO:\s*(.+)$", text)
    remit_name, remit_addr = "", ""
    if remit_line:
        parts = [p.strip() for p in remit_line.split(",", 1)]
        remit_name = parts[0]
        remit_addr = parts[1] if len(parts) > 1 else ""
    header = [l for l in lines[:7]]
    vendor_raw = ""
    for l in header:
        c = _strip_titles(l)
        if c and not c.upper().startswith(("BILL TO",)):
            vendor_raw = c
            break
    if remit_name:
        vendor_raw = remit_name if (not vendor_raw or vendor_raw.upper() in TITLES) else vendor_raw
    doc["vendor_name_raw"] = vendor_raw or remit_name
    head_text = "\n".join(header)
    doc["vendor_phone"] = _find(PHONE_RE.pattern, head_text, group=0)
    doc["vendor_email"] = _find(EMAIL_RE.pattern, head_text, group=0)
    # header address = vendor header lines after the name, joined (used when there is no REMIT TO line)
    hdr_addr = []
    seen_name = False
    for l in header:
        c = _strip_titles(re.sub(r"\s+REVISED INVOICE$", "", l))
        if not seen_name:
            if c and c.upper() not in TITLES:
                seen_name = True
            continue
        if l.startswith("BILL TO") or c.upper() in TITLES:
            break
        c = PHONE_RE.sub("", c).split("|")
        hdr_addr.append(" ".join(x.strip() for x in c if "@" not in x and x.strip()))
    doc["vendor_address_header"] = ", ".join(a for a in hdr_addr if a)
    doc["remit_to"] = {"name": remit_name, "address": remit_addr}
    doc["emails_on_doc"] = sorted(set(EMAIL_RE.findall(text)))
    doc["phones_on_doc"] = sorted(set(PHONE_RE.findall(text)))

    # ---- flags ---------------------------------------------------------------------------
    low = text.lower()
    doc["payment_change_hits"] = sorted({p for p in cfg["payment_change_phrases"] if p in low})
    doc["revised"] = bool(re.search(r"REVISED INVOICE", text)) or "replaces original invoice" in low
    doc["replaces_invoice"] = _find(r"[Rr]eplaces (?:original )?invoice\s+([A-Za-z0-9\-]+)", text)
    doc["credit_original_invoice"] = _find(r"original invoice\s+([A-Za-z0-9\-]+)", text) if kind == "credit_memo" else ""
    doc["new_client_note"] = "new client" in low

    # ---- money ---------------------------------------------------------------------------
    if kind in ("invoice", "credit_memo"):
        _parse_invoice_money(doc, lines, kind, warnings)
    elif kind == "pay_app":
        _parse_pay_app(doc, lines, text, warnings)

    # ---- lien waiver ---------------------------------------------------------------------
    doc["lien_waiver"] = _parse_waiver(text)
    return doc


def _parse_invoice_money(doc, lines, kind, warnings):
    start = next((i for i, l in enumerate(lines) if re.match(r"^Description\s+Qty", l)), None)
    items = []
    subtotal = tax_total = total = None
    tax_label, tax_rate = "", D(0)
    if start is None:
        warnings.append("no line-item table found")
        doc.update(lines=[], subtotal=None, tax_total=None, tax_label="", tax_rate=None, total=None)
        return
    line_re = re.compile(rf"^(?P<desc>.*?)\s+(?P<qty>[\d,]+(?:\.\d+)?)\s+(?P<unit>[A-Z0-9]{{1,4}})\s+(?P<rate>{MONEY})\s+(?P<amt>{MONEY})$")
    for l in lines[start + 1:]:
        s = l.strip()
        if not s:
            continue
        if re.match(r"^Subtotal\b", s):
            subtotal = parse_money(re.search(MONEY, s).group(0))
            continue
        m_total = re.match(rf"^TOTAL (DUE|CREDIT)\s+({MONEY})", s)
        if m_total:
            total = parse_money(m_total.group(2))
            break
        m_tax = re.match(rf"^(?P<label>.*tax.*?)\s+(?P<amt>{MONEY})$", s, flags=re.I)
        if m_tax and subtotal is not None:
            tax_label = m_tax.group("label")
            tax_total = parse_money(m_tax.group("amt"))
            tax_rate = sum((D(p) for p in re.findall(r"(\d+(?:\.\d+)?)%", tax_label)), D(0)) / D(100)
            continue
        m = line_re.match(s)
        if m:
            items.append({"desc": m.group("desc").strip(), "qty": str(D(m.group("qty").replace(",", ""))),
                          "unit": m.group("unit"), "rate": str(parse_money(m.group("rate"))),
                          "amount": str(parse_money(m.group("amt")))})
        elif items and subtotal is None:
            cont = s
            prev = items[-1]["desc"]
            if re.fullmatch(r"[a-z]{1,4}", cont) and re.search(r"[a-z]$", prev):
                items[-1]["desc"] = prev + cont          # word split across two lines ('chemic' + 'als')
            elif re.search(r"\d$", prev) and re.match(r"^\d\)", cont):
                items[-1]["desc"] = prev + cont          # '10/05/202' + '6)'
            else:
                items[-1]["desc"] = prev + " " + cont
    doc["lines"] = items
    doc["subtotal"] = str(subtotal) if subtotal is not None else None
    doc["tax_total"] = str(tax_total) if tax_total is not None else "0.00"
    doc["tax_label"] = tax_label
    doc["tax_rate"] = str(tax_rate) if tax_label else None
    doc["total"] = str(total) if total is not None else None
    if tax_total is None:
        doc["tax_total"] = "0.00"


def _parse_pay_app(doc, lines, text, warnings):
    pa = {}
    m = re.search(r"Application No\.\s*(\d+)\s+Period:\s*(\d{2}/\d{2}/\d{4})\s*to\s*(\d{2}/\d{2}/\d{4})", text)
    if m:
        pa["app_no"] = int(m.group(1))
        pa["period_start"] = iso(parse_us_date(m.group(2)))
        pa["period_end"] = iso(parse_us_date(m.group(3)))
    names = {1: "original_contract", 2: "net_change_cos", 3: "contract_to_date", 4: "completed_to_date",
             5: "retainage_to_date", 6: "earned_less_retainage", 7: "previous_certificates", 8: "current_due"}
    for l in lines:
        mm = re.match(rf"^(\d)\.\s+.*?({MONEY})\s*$", l.strip())
        if mm and int(mm.group(1)) in names and names[int(mm.group(1))] not in pa:
            pa[names[int(mm.group(1))]] = str(parse_money(mm.group(2)))
    items, cos = [], []
    in_cont = False
    total_row = None
    for l in lines:
        s = l.strip()
        if "CONTINUATION SHEET" in s:
            in_cont = True
            continue
        if not in_cont:
            continue
        m_tot = re.match(rf"^Total this period\s+({MONEY})\s+({MONEY})", s)
        if m_tot:
            total_row = (parse_money(m_tot.group(1)), parse_money(m_tot.group(2)))
            continue
        m_row = re.match(rf"^(?P<desc>.*?)\s+(?P<g>{MONEY})\s+(?P<r>{MONEY})$", s)
        if m_row and total_row is None:
            row = {"desc": m_row.group("desc").strip(), "amount": str(parse_money(m_row.group("g"))),
                   "retainage": str(parse_money(m_row.group("r")))}
            mco = re.match(r"^(?:Change Order|CO)\s*#?(\d+)", row["desc"], flags=re.I)
            if mco:
                row["change_order"] = f"CO{mco.group(1)}"
                cos.append(row["change_order"])
            items.append(row)
    pa["this_period_gross"] = str(total_row[0]) if total_row else None
    pa["this_period_retainage"] = str(total_row[1]) if total_row else None
    pa["continuation"] = items
    pa["change_orders_billed"] = sorted(set(cos))
    doc["pay_app"] = pa
    doc["lines"] = []
    doc["total"] = pa.get("current_due")
    doc["subtotal"] = pa.get("this_period_gross")
    doc["tax_total"] = "0.00"
    doc["tax_label"] = ""
    doc["tax_rate"] = None
    if not pa.get("current_due"):
        warnings.append("pay application: current payment due not found")


def _parse_waiver(text):
    w = {"attached": False, "promised_later": False}
    if "CONDITIONAL WAIVER AND RELEASE" in text.upper():
        w["attached"] = True
        w["claimant"] = _find(r"Claimant:\s*(.+)", text)
        w["amount"] = (lambda s: str(parse_money(s)) if s else None)(_find(rf"Amount of progress payment:\s*({MONEY})", text))
        t = _find(r"Through date:\s*(\d{2}/\d{2}/\d{4})", text)
        w["through_date"] = iso(parse_us_date(t)) if t else None
        w["signature_line_blank"] = bool(re.search(r"Signature:\s*_{3,}", text.split("CONDITIONAL WAIVER")[-1]))
    if re.search(r"waiver[^.\n]*(to follow|under separate cover|will follow|forthcoming)", text, flags=re.I):
        w["promised_later"] = True
    return w


def validate_extraction(doc: dict, tol=D("0.01")) -> list:
    """Return a list of problems. Empty list = the numbers on the page tie out."""
    problems = []
    if doc["kind"] == "other":
        return problems
    if not doc.get("invoice_no"):
        problems.append("invoice number not found")
    if not doc.get("date"):
        problems.append("document date not found")
    if doc.get("total") is None:
        problems.append("total not found")
    if doc["kind"] in ("invoice", "credit_memo"):
        if not doc.get("lines"):
            problems.append("no line items found")
        else:
            s = sum((D(l["amount"]) for l in doc["lines"]), D(0))
            if doc.get("subtotal") is not None and abs(s - D(doc["subtotal"])) > tol:
                problems.append(f"line items add to {s} but subtotal is {doc['subtotal']}")
            if doc.get("subtotal") is not None and doc.get("total") is not None:
                t = D(doc["subtotal"]) + D(doc.get("tax_total") or 0)
                if abs(t - D(doc["total"])) > tol:
                    problems.append(f"subtotal + tax = {t} but total is {doc['total']}")
            if doc.get("tax_rate") and doc.get("subtotal") is not None:
                exp = q(D(doc["subtotal"]) * D(doc["tax_rate"]))
                if abs(exp - D(doc["tax_total"])) > tol:
                    problems.append(f"tax {doc['tax_total']} does not equal rate {doc['tax_rate']} x subtotal ({exp})")
    if doc["kind"] == "pay_app":
        pa = doc.get("pay_app", {})
        need = ["original_contract", "net_change_cos", "contract_to_date", "completed_to_date", "retainage_to_date",
                "earned_less_retainage", "previous_certificates", "current_due", "this_period_gross", "this_period_retainage"]
        miss = [k for k in need if pa.get(k) is None]
        if miss:
            problems.append("pay application fields missing: " + ", ".join(miss))
        else:
            g = {k: D(pa[k]) for k in need}
            if abs(g["original_contract"] + g["net_change_cos"] - g["contract_to_date"]) > tol:
                problems.append("line 1 + line 2 does not equal line 3")
            if abs(g["completed_to_date"] - g["retainage_to_date"] - g["earned_less_retainage"]) > tol:
                problems.append("line 4 - line 5 does not equal line 6")
            if abs(g["earned_less_retainage"] - g["previous_certificates"] - g["current_due"]) > tol:
                problems.append("line 6 - line 7 does not equal line 8")
            if abs(g["this_period_gross"] - g["this_period_retainage"] - g["current_due"]) > tol:
                problems.append("this-period work less this-period retainage does not equal current payment due")
            cs = sum((D(r["amount"]) for r in pa.get("continuation", [])), D(0))
            if abs(cs - g["this_period_gross"]) > tol:
                problems.append("continuation sheet rows do not add to the 'Total this period' row")
    return problems
