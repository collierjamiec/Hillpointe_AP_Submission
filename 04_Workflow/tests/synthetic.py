"""Builds synthetic vendor PDFs in the same layout as the assessment invoices, for edge-case testing.
Used only by tests. All data is fictional."""
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


def _money(x, paren=False):
    s = f"${abs(x):,.2f}"
    return f"({s})" if (x < 0 or paren) else s


def make_invoice(path, vendor="Pinecrest Building Supply Co", addr="PO Box 9183 | Columbia, SC 29290", phone="(803) 555-0190",
                 remit_addr="PO Box 9183, Columbia, SC 29290", bill_to="Hillpointe Construction, LLC", c_o="", number="PBS-900001",
                 date="10/12/2026", terms="Net 30", ref="PO2410315-008", ship="Pointe Grand Columbia",
                 lines=(("Framing lumber", 1, "LS", 1000.00),), tax_label="", tax=0.0, credit=False, notes=(), stamp=None, title=None):
    c = canvas.Canvas(str(path), pagesize=letter)
    y = 760
    title = title or ("CREDIT MEMO" if credit else "INVOICE")
    c.setFont("Helvetica-Bold", 14); c.drawString(48, y, vendor); c.drawRightString(560, y, title)
    c.setFont("Helvetica", 8); c.drawString(48, y - 14, f"{addr} | {phone}")
    c.setFont("Helvetica-Bold", 9); c.drawString(48, 700, "BILL TO")
    c.setFont("Helvetica", 9)
    c.drawString(432, 700, "Credit Memo No." if credit else "Invoice No."); c.drawString(540, 700, number)
    c.drawString(48, 688, bill_to); c.drawString(432, 688, "Date"); c.drawString(540, 688, date)
    c.drawString(48, 676, c_o and f"c/o {c_o}" or "Attn: Accounts Payable"); c.drawString(432, 676, "Terms"); c.drawString(540, 676, terms)
    c.drawString(48, 664, "631 W Morse Blvd, Suite 200"); c.drawString(432, 664, "Customer Ref"); c.drawString(540, 664, ref)
    c.drawString(48, 652, "Winter Park, FL 32789")
    c.setFont("Helvetica-Bold", 9); c.drawString(48, 630, "PROJECT / SHIP TO")
    c.setFont("Helvetica", 9); c.drawString(48, 618, ship)
    c.setFont("Helvetica-Bold", 8); y = 590
    for x, t in ((48, "Description"), (350, "Qty"), (390, "Unit"), (450, "Rate"), (520, "Amount")):
        c.drawString(x, y, t)
    c.setFont("Helvetica", 8)
    sub = 0
    for d, q, u, r in lines:
        y -= 16
        amt = round(q * r, 2) if not credit else -round(q * r, 2)
        sub += amt
        c.drawString(48, y, d); c.drawString(350, y, f"{q:,}"); c.drawString(390, y, u)
        c.drawRightString(480, y, _money(-r if credit else r, credit)); c.drawRightString(560, y, _money(amt))
    y -= 22
    c.drawString(400, y, "Subtotal"); c.drawRightString(560, y, _money(sub))
    if tax:
        y -= 14; t = -abs(tax) if credit else tax
        c.drawString(330, y, tax_label or "Sales tax"); c.drawRightString(560, y, _money(t))
        sub += t
    y -= 14
    c.setFont("Helvetica-Bold", 9); c.drawString(400, y, "TOTAL CREDIT" if credit else "TOTAL DUE"); c.drawRightString(560, y, _money(sub))
    c.setFont("Helvetica", 8)
    for n in notes:
        y -= 14; c.drawString(48, y, n)
    y -= 24
    c.drawString(48, y, f"REMIT TO: {vendor}, {remit_addr}")
    if stamp:
        c.saveState(); c.translate(250, 400); c.rotate(30); c.setFont("Helvetica-Bold", 40); c.drawString(0, 0, stamp); c.restoreState()
    c.save()
    return round(sub, 2)


def make_pay_app(path, vendor="Gulfline Concrete Partners LLC", addr_lines=("PO Box 4410", "West Columbia, SC 29171"), phone="(803) 555-0141",
                 number="GCP-0304", date="10/31/2026", sc="SC2410315-03", app_no=4, period=("10/01/2026", "10/31/2026"),
                 original=612000.0, net_co=0.0, completed=500000.0, prev_certs=317250.0, rows=(("Building 4 slab on grade", 100000.0),),
                 waiver="ok", waiver_amount=None, bill_to="Hillpointe Construction, LLC", ship="Pointe Grand Columbia, Columbia, SC",
                 retain_pct=0.10, retainage_to_date=None, prev_gross=None):
    gross = sum(r for _, r in rows)
    ret = round(gross * retain_pct, 2)
    ret_to_date = retainage_to_date if retainage_to_date is not None else round(completed * 0.10, 2)
    earned = completed - ret_to_date
    due = earned - prev_certs
    c = canvas.Canvas(str(path), pagesize=letter)
    c.setFont("Helvetica-Bold", 12); c.drawString(48, 760, vendor)
    c.setFont("Helvetica", 9)
    c.drawString(48, 748, addr_lines[0]); c.drawString(48, 736, addr_lines[1])
    c.setFont("Helvetica-Bold", 12); c.drawString(380, 740, "APPLICATION FOR PAYMENT")
    c.setFont("Helvetica", 9); c.drawString(48, 724, phone)
    c.drawString(48, 700, "BILL TO"); c.drawString(432, 700, "Invoice No."); c.drawString(540, 700, number)
    c.drawString(48, 688, bill_to); c.drawString(432, 688, "Date"); c.drawString(540, 688, date)
    c.drawString(48, 676, "Attn: Accounts Payable"); c.drawString(432, 676, "Terms"); c.drawString(540, 676, "Net 30")
    c.drawString(48, 664, "631 W Morse Blvd, Suite 200"); c.drawString(432, 664, "Customer Ref"); c.drawString(540, 664, f"Subcontract {sc}")
    c.drawString(48, 652, "Winter Park, FL 32789")
    c.drawString(48, 630, "PROJECT / SHIP TO"); c.drawString(48, 618, ship)
    c.drawString(48, 600, f"Application No. {app_no} Period: {period[0]} to {period[1]}")
    y = 580
    summary = [("1. Original contract sum", original), ("2. Net change by change orders", net_co), ("3. Contract sum to date (1+2)", original + net_co),
               ("4. Total completed and stored to date", completed), ("5. Retainage 10% of completed work", ret_to_date),
               ("6. Total earned less retainage (4 minus 5)", earned), ("7. Less previous certificates for payment", prev_certs),
               ("8. CURRENT PAYMENT DUE", due)]
    for t, v in summary:
        c.drawString(48, y, t); c.drawRightString(560, y, _money(v)); y -= 14
    y -= 8
    c.drawString(48, y, "CONTINUATION SHEET: WORK COMPLETED THIS PERIOD"); y -= 14
    c.drawString(48, y, "Description of work"); c.drawString(400, y, "This period"); c.drawString(500, y, "Retainage"); y -= 14
    for d, v in rows:
        c.drawString(48, y, d); c.drawRightString(470, y, _money(v)); c.drawRightString(560, y, _money(round(v * retain_pct, 2))); y -= 14
    c.drawString(48, y, "Total this period"); c.drawRightString(470, y, _money(gross)); c.drawRightString(560, y, _money(ret)); y -= 20
    if waiver == "ok":
        c.drawString(48, y, "Conditional waiver and release on progress payment attached."); y -= 14
    elif waiver == "later":
        c.drawString(48, y, "Conditional lien waiver to follow under separate cover."); y -= 14
    c.drawString(48, y, f"Contractor signature: ______________________ Date: {date}")
    c.showPage()
    if waiver == "ok":
        c.setFont("Helvetica-Bold", 12); c.drawString(48, 740, "CONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT")
        c.setFont("Helvetica", 9)
        c.drawString(48, 710, "Project: Pointe Grand Columbia, Columbia, SC"); c.drawString(48, 698, "Owner / Contractor: Hillpointe Construction, LLC")
        c.drawString(48, 686, f"Claimant: {vendor}")
        c.drawString(48, 674, f"Through date: {period[1]} Amount of progress payment: {_money(waiver_amount if waiver_amount is not None else due)}")
        c.drawString(48, 640, "Signature: ______________________ Title: Controller Date: " + date)
        c.showPage()
    c.save()
    return due


def make_waiver_only(path):
    c = canvas.Canvas(str(path), pagesize=letter)
    c.setFont("Helvetica-Bold", 12); c.drawString(48, 740, "CONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT")
    c.setFont("Helvetica", 9)
    c.drawString(48, 710, "Project: Pointe Grand Columbia, Columbia, SC"); c.drawString(48, 698, "Owner / Contractor: Hillpointe Construction, LLC")
    c.drawString(48, 686, "Claimant: Tri County Drywall Inc")
    c.drawString(48, 674, "Through date: 09/30/2026 Amount of progress payment: $57,600.00")
    c.drawString(48, 640, "Signature: ______________________ Title: Controller Date: 10/02/2026")
    c.save()


# ---- files that are not usable invoices (corrupt, wrong type, locked, scanned) ------------------------------
# name -> (builder, words the plain-language reason must contain)
def _good_bytes():
    import io
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    c.drawString(48, 740, "INVOICE  Invoice No. 1  Date 10/01/2026")
    c.showPage(); c.save()
    return buf.getvalue()


def _image_only(path):
    c = canvas.Canvas(str(path), pagesize=letter)
    c.rect(48, 400, 500, 300, fill=1)          # shapes only, no text layer: stands in for a scanned page
    c.showPage(); c.save()


def _locked(path):
    c = canvas.Canvas(str(path), pagesize=letter, encrypt="secret")
    c.drawString(48, 740, "INVOICE  Invoice No. 1")
    c.showPage(); c.save()


BAD_FILES = {
    "empty": (lambda p: p.write_bytes(b""), "empty"),
    "not_a_pdf": (lambda p: p.write_text("Thanks for your business! (a note saved with the wrong file name)"), "not a PDF"),
    "truncated": (lambda p: p.write_bytes(_good_bytes()[:400]), "damaged"),
    "garbled": (lambda p: p.write_bytes(b"%PDF-1.4\n" + bytes(range(256)) * 20), "damaged"),
    "password": (_locked, "password protected"),
    "scanned": (_image_only, "scanned image"),
}


def make_statement(path):
    """A real bill in a layout Penny does not know: no 'Invoice No.' label, just 'AMOUNT DUE'."""
    c = canvas.Canvas(str(path), pagesize=letter)
    c.setFont("Helvetica-Bold", 14); c.drawString(48, 740, "Pinecrest Building Supply Co")
    c.setFont("Helvetica", 9); c.drawString(48, 726, "PO Box 9183, Columbia, SC 29290 | (803) 555-0190")
    c.setFont("Helvetica-Bold", 16); c.drawString(48, 700, "Statement of Charges")
    c.setFont("Helvetica", 9)
    c.drawString(48, 680, "Document #: PBS-910005    Prepared for: Hillpointe Construction, LLC")
    c.drawString(48, 668, "Issued: October 28, 2026    Your PO: PO2410315-008")
    c.drawString(48, 640, "2x4x8 framing lumber, kiln dried   $4.00   150   $600.00")
    c.drawString(48, 628, "2x6x10 framing lumber, treated     $8.50    40   $340.00")
    c.setFont("Helvetica-Bold", 10); c.drawString(300, 600, "AMOUNT DUE: $940.00")
    c.save()
