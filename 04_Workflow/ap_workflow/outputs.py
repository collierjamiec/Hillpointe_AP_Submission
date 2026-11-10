"""Step 3: write the import file, the Entrata handoff, the exception log and the run report.
Also runs a pre-flight check on the Intacct file, because Intacct rejects the WHOLE file if any row fails."""
import csv
import json
import re
from collections import OrderedDict
from decimal import Decimal
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .rules import ENTER_INTACCT, ENTER_ENTRATA, HOLD, DUP, SKIP
from .util import D, q, us, as_date, add_days

INTACCT_COLS = ["BILL_NO", "DOC_TYPE", "VENDOR_ID", "BILL_DATE", "GL_POSTING_DATE", "DUE_DATE", "TERM_NAME", "REFERENCE_NO",
                "DESCRIPTION", "LINE_NO", "ACCT_NO", "LOCATION_ID", "DEPARTMENT_ID", "PROJECT_ID", "TASK_ID", "COST_TYPE_ID",
                "LINE_MEMO", "AMOUNT", "SUPDOC_ID"]
ENTRATA_COLS = ["Property", "Owner Entity", "PROJECT_ID", "VENDOR_ID", "Vendor Name", "Invoice No", "Invoice Date", "Post Month",
                "Due Date", "Entrata GL", "Description", "Amount", "Approver", "SUPDOC_ID"]
EXC_COLS = ["File", "Vendor", "Invoice No", "Amount", "Exception Code(s)", "Primary Code", "Reason", "Recommended Route",
            "Confidence", "Decision", "Informational Notes"]


def intacct_rows(decisions):
    """One row per bill line for every document decided ENTER_INTACCT, in file order."""
    rows = []
    for d in decisions:
        if d.status == ENTER_INTACCT:
            for l in d.lines:
                r = {c: l.get(c, "") for c in INTACCT_COLS}
                rows.append(r)
    return rows


def entrata_rows(decisions):
    """One row per GL line for every document decided ENTER_ENTRATA."""
    rows = []
    for d in decisions:
        if d.status == ENTER_ENTRATA:
            rows.extend(d.entrata_rows)
    return rows


def fmt_intacct(r):
    """A bill line as text for the CSV: dates as MM/DD/YYYY and amounts with two decimals."""
    out = dict(r)
    for k in ("BILL_DATE", "GL_POSTING_DATE", "DUE_DATE"):
        out[k] = us(r[k])
    out["AMOUNT"] = f"{q(r['AMOUNT']):.2f}"
    return out


def validate_intacct(rows, master, cfg):
    """Pre-flight: the same kinds of checks Intacct performs. Returns a list of error strings."""
    errs = []
    req = ["BILL_NO", "DOC_TYPE", "VENDOR_ID", "BILL_DATE", "GL_POSTING_DATE", "DUE_DATE", "TERM_NAME", "DESCRIPTION", "LINE_NO",
           "ACCT_NO", "LOCATION_ID", "DEPARTMENT_ID", "LINE_MEMO", "AMOUNT", "SUPDOC_ID"]
    bills = OrderedDict()
    for i, r in enumerate(rows, start=2):
        tag = f"row {i} ({r.get('BILL_NO')} line {r.get('LINE_NO')})"
        for c in req:
            if r.get(c) in ("", None):
                errs.append(f"{tag}: {c} is required")
        bills.setdefault((r["VENDOR_ID"], r["BILL_NO"]), []).append(r)
        if r["DOC_TYPE"] not in ("Bill", "Adjustment"):
            errs.append(f"{tag}: DOC_TYPE must be Bill or Adjustment")
        v = master.vendors.get(r["VENDOR_ID"])
        if not v or v["Status"] != "Active":
            errs.append(f"{tag}: vendor {r['VENDOR_ID']} is not an Active vendor")
        elif v["Terms"] != r["TERM_NAME"]:
            errs.append(f"{tag}: TERM_NAME {r['TERM_NAME']} differs from vendor master {v['Terms']}")
        if master.period_status(r["GL_POSTING_DATE"]) != "Open":
            errs.append(f"{tag}: GL_POSTING_DATE {us(r['GL_POSTING_DATE'])} is not in an open period")
        days = cfg["terms_days"].get(r["TERM_NAME"])
        exp_due = r["BILL_DATE"] if r["DOC_TYPE"] == "Adjustment" else (add_days(r["BILL_DATE"], days) if days is not None else None)
        if exp_due and r["DUE_DATE"] != exp_due:
            errs.append(f"{tag}: DUE_DATE {us(r['DUE_DATE'])} should be {us(exp_due)}")
        if len(str(r["DESCRIPTION"])) > 80 or len(str(r["LINE_MEMO"])) > 80:
            errs.append(f"{tag}: DESCRIPTION or LINE_MEMO is longer than 80 characters")
        acct = str(r["ACCT_NO"])
        if acct == "20000" or acct.startswith("25"):
            errs.append(f"{tag}: ACCT_NO {acct} is system controlled and can never be coded")
        if acct not in master.gl_intacct:
            errs.append(f"{tag}: ACCT_NO {acct} is not in GL_Intacct")
        if r["LOCATION_ID"] not in master.entities:
            errs.append(f"{tag}: LOCATION_ID {r['LOCATION_ID']} is not an entity")
        if r["DEPARTMENT_ID"] not in master.departments:
            errs.append(f"{tag}: DEPARTMENT_ID {r['DEPARTMENT_ID']} is not a department")
        if r["PROJECT_ID"]:
            if str(r["PROJECT_ID"]) not in master.projects:
                errs.append(f"{tag}: PROJECT_ID {r['PROJECT_ID']} unknown")
            if not (r["TASK_ID"] and r["COST_TYPE_ID"] and r["REFERENCE_NO"]):
                errs.append(f"{tag}: job cost line needs TASK_ID, COST_TYPE_ID and REFERENCE_NO")
            if r["TASK_ID"] and r["COST_TYPE_ID"] not in master.cost_codes.get(str(r["TASK_ID"]), {}).get("allowed", set()):
                errs.append(f"{tag}: cost type {r['COST_TYPE_ID']} not allowed for cost code {r['TASK_ID']}")
            if acct != cfg["construction"]["retainage_acct"] and master.cost_types.get(r["COST_TYPE_ID"]) != acct:
                errs.append(f"{tag}: ACCT_NO {acct} does not match cost type {r['COST_TYPE_ID']}")
        else:
            if r["TASK_ID"] or r["COST_TYPE_ID"]:
                errs.append(f"{tag}: corporate line must not have TASK_ID or COST_TYPE_ID")
        if q(r["AMOUNT"]) != r["AMOUNT"]:
            errs.append(f"{tag}: AMOUNT must have 2 decimals")
    for (vid, no), lines in bills.items():
        nums = [l["LINE_NO"] for l in lines]
        if nums != list(range(1, len(lines) + 1)):
            errs.append(f"bill {no}: LINE_NO must run 1..n")
        for h in ("DOC_TYPE", "BILL_DATE", "GL_POSTING_DATE", "DUE_DATE", "TERM_NAME", "REFERENCE_NO", "DESCRIPTION", "SUPDOC_ID"):
            if len({str(l[h]) for l in lines}) > 1:
                errs.append(f"bill {no}: header field {h} differs between lines")
        total = sum((l["AMOUNT"] for l in lines), D(0))
        if lines[0]["DOC_TYPE"] == "Adjustment" and total >= 0:
            errs.append(f"bill {no}: Adjustment must total a negative amount")
        if lines[0]["DOC_TYPE"] == "Bill" and total <= 0:
            errs.append(f"bill {no}: Bill must total a positive amount")
    keys = [k for k in bills]
    if len(keys) != len(set(keys)):
        errs.append("the same vendor and bill number appears twice in the file")
    return errs


# ------------------------------------------------------------------------------------------------ files
def write_csv(path, cols, rows):
    """Write rows to a CSV file with exactly these columns."""
    with open(path, "w", newline="", encoding="utf-8") as f:   # UTF-8, as the field guide requires
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})


def exception_rows(decisions, priority, routes):
    """One row per held or duplicate document: the reason, the main code and the team it goes to."""
    rows = []
    for d in decisions:
        if d.status in (HOLD, DUP):
            routes_txt = []
            for c in sorted(d.codes, key=lambda c: priority.index(c) if c in priority else 99):
                r = routes.get(c, "")
                if r and r not in routes_txt:
                    routes_txt.append(r)
            rows.append({"File": d.file, "Vendor": d.vendor_name or d.doc.get("vendor_name_raw", ""), "Invoice No": d.bill_no,
                         "Amount": d.amount, "Exception Code(s)": "; ".join(sorted(d.codes, key=lambda c: priority.index(c) if c in priority else 99)),
                         "Primary Code": d.primary_code(priority), "Reason": " ".join(d.reasons),
                         "Recommended Route": "; ".join(routes_txt), "Confidence": d.confidence + (f" ({'; '.join(d.confidence_basis)})" if d.confidence_basis else ""),
                         "Decision": d.status, "Informational Notes": " ".join(d.info)})
    return rows


def entered_rows(decisions):
    """One row per entered bill with the approvers it needs and any notes for a person."""
    rows = []
    for d in decisions:
        if d.status in (ENTER_INTACCT, ENTER_ENTRATA):
            rows.append({"File": d.file, "Vendor": d.vendor_name, "Vendor ID": d.vendor_id, "Bill No": d.bill_no, "Doc Type": d.doc_type,
                         "System": "Entrata handoff" if d.status == ENTER_ENTRATA else "Sage Intacct", "Bill Total": d.amount,
                         "Lines": len(d.lines) or len(d.entrata_rows), "Project": d.project_id, "Reference": d.reference_no,
                         "Required Approvers": "; ".join(d.approvers), "Confidence": d.confidence,
                         "Informational Notes (not holds)": " ".join(d.info)})
    return rows


def skipped_rows(decisions):
    """One row per file skipped because the same file was already entered."""
    return [{"File": d.file, "Vendor": d.vendor_name, "Bill No": d.bill_no, "Amount": d.amount, "Result": d.status,
             "Why": " ".join(d.info)} for d in decisions if d.status == SKIP]


HDR_FILL = PatternFill("solid", fgColor="1F3864")
HDR_FONT = Font(bold=True, color="FFFFFF")


def _sheet(wb, title, cols, rows, widths=None, money=()):
    """Add one formatted sheet to the workbook."""
    ws = wb.create_sheet(title)
    ws.append(cols)
    for c in ws[1]:
        c.fill, c.font = HDR_FILL, HDR_FONT
        c.alignment = Alignment(vertical="center", wrap_text=True)
    for r in rows:
        ws.append([_xl(r.get(c, "")) for c in cols])
    ws.freeze_panes = "A2"
    for i, c in enumerate(cols, start=1):
        w = (widths or {}).get(c, min(max(len(str(c)) + 2, *(len(str(_xl(r.get(c, "")))) + 2 for r in rows)) if rows else 12, 48))
        ws.column_dimensions[get_column_letter(i)].width = w
        if c in money:
            for cell in ws[get_column_letter(i)][1:]:
                cell.number_format = "#,##0.00;(#,##0.00)"
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    return ws


def _xl(v):
    """A value Excel can store (money as a number, dates as dates, everything else as text)."""
    if isinstance(v, Decimal):
        return float(v)
    if hasattr(v, "isoformat") and not isinstance(v, str):
        return v.strftime("%m/%d/%Y")
    return v


def write_workbook(path, decisions, master, priority, routes, run_id):
    """The review workbook: every output as a tab, plus a sheet that re-adds each bill total with formulas."""
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    irows = intacct_rows(decisions)
    xl_rows = [fmt_intacct(r) for r in irows]
    ws = _sheet(wb, "Import_Template", INTACCT_COLS, xl_rows, money=("AMOUNT",))
    for row in ws.iter_rows(min_row=2, min_col=18, max_col=18):
        for cell in row:
            cell.value = float(cell.value)
    for col in ("K", "N", "O"):          # keep account, project and cost code as text so leading zeros survive
        for cell in ws[col][1:]:
            cell.number_format = "@"
    # bill total check sheet (formulas, so a reviewer can see them tie to the import rows)
    bills = OrderedDict()
    for d in decisions:
        if d.status == ENTER_INTACCT:
            bills[d.bill_no] = d
    wc = wb.create_sheet("Bill_Total_Check")
    wc.append(["BILL_NO", "Total of import lines", "Amount owed per document", "Difference"])
    for c in wc[1]:
        c.fill, c.font = HDR_FILL, HDR_FONT
    for i, (no, d) in enumerate(bills.items(), start=2):
        wc.append([no, f"=ROUND(SUMIFS(Import_Template!$R:$R,Import_Template!$A:$A,A{i}),2)", float(d.amount), f"=ROUND(B{i}-C{i},2)"])
        for col in "BCD":
            wc[f"{col}{i}"].number_format = "#,##0.00;(#,##0.00)"
    for col, w in zip("ABCD", (20, 22, 26, 14)):
        wc.column_dimensions[col].width = w
    _sheet(wb, "Entrata_Handoff", ENTRATA_COLS, [{k: v for k, v in r.items()} for r in entrata_rows(decisions)], money=("Amount",))
    _sheet(wb, "Exception_Log", EXC_COLS, exception_rows(decisions, priority, routes),
           widths={"Reason": 70, "Informational Notes": 50, "Recommended Route": 34, "Confidence": 26, "Exception Code(s)": 18}, money=("Amount",))
    _sheet(wb, "Entered_and_Approvers", list(entered_rows(decisions)[0].keys()) if entered_rows(decisions) else ["File"], entered_rows(decisions),
           widths={"Required Approvers": 48, "Informational Notes (not holds)": 70}, money=("Bill Total",))
    sk = skipped_rows(decisions)
    if sk:
        _sheet(wb, "Already_Entered_Skipped", list(sk[0].keys()), sk, widths={"Why": 60})
    wb.save(path)


def write_run_report(path, run_id, batch, decisions, errs, counts, state_info):
    """The one-page run summary (run_report.md): counts, every decision, pre-flight and the register."""
    L = [f"# Run report: {run_id}", "", f"Batch folder: `{batch}`", f"Documents read: {len(decisions)}", ""]
    L += ["| Result | Count |", "|---|---|"] + [f"| {k} | {v} |" for k, v in counts.items()] + [""]
    L += ["## Decisions", "", "| File | Vendor | Invoice | Amount | Result | Codes | Confidence |", "|---|---|---|---|---|---|---|"]
    for d in decisions:
        keyed = " (keyed by hand)" if (d.doc.get("extraction") or {}).get("method") == "manual" else ""
        L.append(f"| {d.file}{keyed} | {d.vendor_name or d.doc.get('vendor_name_raw','')} | {d.bill_no} | {d.amount:,.2f} | {d.status} | {', '.join(d.codes)} | {d.confidence} |")
    L += ["", "## Import file pre-flight", "", "PASS: no validation errors." if not errs else "FAIL:\n" + "\n".join(f"- {e}" for e in errs), ""]
    L += ["## Register", "", state_info, ""]
    path.write_text("\n".join(L), encoding="utf-8")
