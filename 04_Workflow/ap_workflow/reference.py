"""Step 0: load every reference source from the assessment package into plain Python objects.

Nothing here decides anything. If a PO, subcontract or agreement is added to the package folder it is picked up
automatically on the next run (they are parsed from the PDFs, not typed in)."""
import re
from pathlib import Path

import openpyxl

from .pdfio import read_pdf
from .util import D, as_date, parse_money, norm_name

MONEY = r"\$[\d,]+\.\d{2}"


# ----------------------------------------------------------------------------------------------- master
def _rows(ws):
    """A worksheet as a list of dicts keyed by its header row."""
    rows = [r for r in ws.iter_rows(values_only=True)]
    hdr = [str(h).strip() if h is not None else "" for h in rows[0]]
    out = []
    for r in rows[1:]:
        if r[0] is None or str(r[0]).startswith("="):
            continue
        out.append({hdr[i]: r[i] for i in range(len(hdr)) if hdr[i]})
    return out


class Master:
    """The company's master data: entities, projects, GL accounts, cost codes, vendors and periods."""

    def __init__(self, path: Path):
        """Read the master data workbook: entities, projects, departments, GL accounts, cost codes and types, vendors,
        the allocation table and accounting periods."""
        wb = openpyxl.load_workbook(path, data_only=False)
        self.entities = {r["ENTITY_ID"]: r for r in _rows(wb["Entities"])}
        self.projects = {str(r["PROJECT_ID"]): r for r in _rows(wb["Projects"])}
        self.departments = {r["DEPARTMENT_ID"]: r for r in _rows(wb["Departments"])}
        self.gl_intacct = {str(r["ACCT_NO"]): r for r in _rows(wb["GL_Intacct"])}
        self.gl_entrata = {str(r["Entrata GL"]): r for r in _rows(wb["GL_Entrata"])}
        self.cost_codes = {}
        for r in _rows(wb["Cost_Codes"]):
            allowed = {t.strip() for t in str(r["Allowed Cost Types"]).split(",")}
            self.cost_codes[str(r["COST_CODE"])] = {"desc": r["Description"], "allowed": allowed}
        self.cost_types = {r["COST_TYPE_ID"]: str(r["COGS Account"]) for r in _rows(wb["Cost_Types"])}
        self.vendors = {}
        for r in _rows(wb["Vendors"]):
            r["VENDOR_ID"] = str(r["VENDOR_ID"])
            r["Bank Acct Last 4"] = str(r.get("Bank Acct Last 4") or "").zfill(4)
            r["COI_date"] = as_date(r["COI Expiration"]) if r.get("COI Expiration") not in (None, "", "N/A") else None
            r["lien_required"] = str(r.get("Lien Waiver Required")).upper() == "Y"
            self.vendors[r["VENDOR_ID"]] = r
        self.allocation = {}
        for r in _rows(wb["Allocation_Table"]):
            if r["ENTITY_ID"] in self.entities:
                self.allocation[r["ENTITY_ID"]] = D(r["Allocation %"])
        self.periods = {}
        for r in _rows(wb["Periods"]):
            self.periods[str(r["Period"])] = str(r["Status"])
        self._legal = {norm_name(e["Legal Name"]): eid for eid, e in self.entities.items()}

    # --- lookups
    def legal_entity_for(self, name: str):
        """The entity code for a legal name (or approved alias), or None."""
        return self._legal.get(norm_name(name))

    def period_status(self, d):
        """Whether the accounting period containing this date is Open or Closed."""
        return self.periods.get(d.strftime("%B %Y"), "Unknown")

    def first_open_period_start(self):
        """First day of the earliest period whose status is Open ('current open period')."""
        from datetime import datetime
        opens = sorted(datetime.strptime(p, "%B %Y").date() for p, s in self.periods.items() if s.lower() == "open")
        return opens[0] if opens else None

    def project_by_text(self, text: str):
        """Project IDs whose name appears in a piece of text, such as a ship-to line."""
        t = norm_name(text)
        hits = [pid for pid, p in self.projects.items() if norm_name(p["Project Name"]) in t]
        return hits


# ----------------------------------------------------------------------------------------------- history
class History:
    """The bills already entered before Penny ran, used to catch duplicates."""

    def __init__(self, path: Path):
        """Read the bills already entered in the ERP before Penny ran."""
        wb = openpyxl.load_workbook(path, data_only=True)
        self.rows = []
        for r in _rows(wb["Bill_History"]):
            rec = str(r.get("Record") or "")
            if not re.match(r"^(AP|EN)-\d+", rec):
                continue
            r["VENDOR_ID"] = str(r["VENDOR_ID"])
            r["Bill Date"] = as_date(r["Bill Date"])
            for k in ("Gross Amount", "Retainage", "Bill Total"):
                r[k] = D(r.get(k) or 0)
            self.rows.append(r)

    def find_invoice(self, vendor_id, invoice_key, normalizer):
        """Earlier bills from this vendor with the same invoice number after normalizing its format."""
        return [r for r in self.rows if r["VENDOR_ID"] == vendor_id and normalizer(str(r["Bill / Invoice No"])) == invoice_key]

    def for_reference(self, ref):
        """Earlier bills entered against a PO or subcontract number."""
        return [r for r in self.rows if str(r.get("Reference") or "").strip() == ref]


# ----------------------------------------------------------------------------------------------- PO / SC / SA
def _vendor_id(text):
    """The vendor ID (like V1001) found in a block of text, or ''."""
    m = re.search(r"\((V\d{4})\)", text)
    return m.group(1) if m else ""


def parse_po(text: str) -> dict:
    """Read a purchase order's text: number, vendor, project, status, total, and each line with its cost code and price."""
    po = {"number": _g(r"PO Number\s+(\S+)", text), "vendor_id": _vendor_id(text),
          "project_id": _g(r"Project\s+(\d{6,7})", text), "status": _g(r"Status\s+(\w+)", text),
          "date": _g(r"PO Date\s+(\S+)", text), "lines": [], "total": None}
    pl = re.search(rf"PO Total\s+({MONEY})", text)
    po["total"] = parse_money(pl.group(1)) if pl else None
    row_re = re.compile(rf"^(?P<ln>\d+)\s+(?P<desc>.*?)\s+(?P<code>\d{{5}})\s+(?P<ct>[SMEO])\s+(?P<pricing>.*?)\s+(?P<amt>{MONEY})\s*$")
    lines = text.splitlines()
    for i, l in enumerate(lines):
        m = row_re.match(l.strip())
        if m:
            cont = []
            for nxt in lines[i + 1:i + 3]:
                if re.match(r"^(\d+\s|PO Total|Terms)", nxt.strip()):
                    break
                cont.append(nxt.strip())
            po["lines"].append({"line": int(m.group("ln")), "desc": (m.group("desc") + " " + " ".join(cont)).strip(),
                                "cost_code": m.group("code"), "cost_type": m.group("ct"),
                                "pricing": m.group("pricing"), "amount": parse_money(m.group("amt"))})
    return po


def parse_subcontract(text: str) -> dict:
    """Read a subcontract's text: number, vendor, project, contract sums, cost code, and the change order log."""
    sc = {"number": _g(r"Subcontract No\.\s+(\S+)", text), "vendor_id": _vendor_id(text),
          "project_id": _g(r"Project\s+(\d{6,7})", text),
          "original_contract": parse_money(_g(rf"Original Contract\s+({MONEY})", text) or "0"),
          "revised_contract": parse_money(_g(rf"Revised contract \(executed COs only\)\s+({MONEY})", text) or "0"),
          "cos": {}}
    cc = re.search(r"Cost Code / Type\s+(\d{5})\s*/\s*([SMEO])", text)
    sc["cost_code"], sc["cost_type"] = (cc.group(1), cc.group(2)) if cc else ("", "")
    for m in re.finditer(rf"^(CO\d+)\s+(.*?)\s+(Executed|Pending[^$\d]*?|Approved|Rejected|Draft)\s+(\d{{4}}-\d{{2}}-\d{{2}})\s+({MONEY})", text, flags=re.M):
        status = m.group(3).strip()
        executed = status.lower().startswith("executed")
        sc["cos"][m.group(1)] = {"desc": m.group(2), "status": status, "executed": executed,
                                 "amount": parse_money(m.group(5))}
    return sc


def parse_service_agreement(text: str) -> dict:
    """Read a service agreement's text: number, vendor, property, the monthly fee and what it is made of."""
    sa = {"number": _g(r"Agreement No\.\s+(\S+)", text), "vendor_id": _vendor_id(text),
          "project_id": _g(r"Property\s+(\d{6,7})", text),
          "monthly_fee": parse_money(_g(rf"Monthly Fee\s+({MONEY})", text) or "0"),
          "term": _g(r"Term\s+(.+)", text), "scope": _g(r"Scope\s+(.+)", text)}
    sa["components"] = [(m.group(1).strip(), parse_money("$" + m.group(2))) for m in
                        re.finditer(r"([A-Za-z ]+?)\s*\(\$([\d,]+)\)", sa["scope"])]
    return sa


def _g(pat, text):
    """The first capture group of a pattern in text, or ''."""
    m = re.search(pat, text)
    return m.group(1).strip() if m else ""


class Contracts:
    """The purchase orders, subcontracts and service agreements that invoices are checked against."""

    def __init__(self, folder: Path):
        """Read every PO, subcontract and service agreement PDF in the folder."""
        self.pos, self.subcontracts, self.agreements, self.unparsed = {}, {}, {}, []
        for p in sorted(folder.glob("*.pdf")):
            text = read_pdf(p)["text"]
            if "PURCHASE ORDER" in text:
                d = parse_po(text); self.pos[d["number"]] = d
            elif "SUBCONTRACT EXCERPT" in text:
                d = parse_subcontract(text); self.subcontracts[d["number"]] = d
            elif "SERVICE AGREEMENT" in text:
                d = parse_service_agreement(text); self.agreements[d["number"]] = d
            else:
                self.unparsed.append(p.name)


def load_package(package_dir: Path):
    """Load the three kinds of reference data from the package folder: master data, ERP history and contracts."""
    m = Master(package_dir / "02_Reference_Data" / "Hillpointe_Master_Data.xlsx")
    h = History(package_dir / "06_ERP_History" / "Previously_Entered_Bills.xlsx")
    c = Contracts(package_dir / "03_Purchase_Orders_and_Subcontracts")
    return m, h, c
