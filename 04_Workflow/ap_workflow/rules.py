"""Step 2: the decision engine. Deterministic. Implements AP_Coding_Rules_and_Approval_Matrix.docx.

Input : one extracted document (see extract.py) plus reference data and the processed-invoice register.
Output: a Decision: ENTER_INTACCT, ENTER_ENTRATA, HOLD, DUP or SKIP_ALREADY_ENTERED, with every reason,
        exception code, route, approver and confidence the AP team needs.

Principles
  * Never guess. When a rule cannot be satisfied the document is held with a code and a route.
  * Collect every applicable hold code instead of stopping at the first one, so the person who fixes the
    document gets the full list in one pass.
  * Every threshold, route and keyword list is read from config/rules.json.
"""
import re
from datetime import date
from decimal import Decimal

from .extract import validate_extraction
from .register import make_key
from .util import (D, q, as_date, add_days, norm_name, norm_addr, norm_invoice_no, short_name, digits)

ENTER_INTACCT, ENTER_ENTRATA, HOLD, DUP, SKIP = "ENTER_INTACCT", "ENTER_ENTRATA", "HOLD", "DUP", "SKIP_ALREADY_ENTERED"
CONSTRUCTION_VENDOR_TYPES = ("Subcontractor", "Supplier: Material", "Supplier: Equipment", "Service: Site")


class Decision:
    def __init__(self, doc):
        self.doc = doc
        self.file = doc["file"]
        self.supdoc_id = doc["supdoc_id"]
        self.status = None
        self.codes, self.reasons, self.info = [], [], []
        self.trail = []          # every check that ran, pass or fail, in order (for explain)
        self.confidence, self.confidence_basis = "High", []
        self.vendor_id = self.vendor_name = ""
        self.bill_no = doc.get("invoice_no", "")
        self.doc_type = "Adjustment" if doc.get("kind") == "credit_memo" else "Bill"
        self.bill_date = as_date(doc.get("date"))
        self.amount = D(doc.get("total") or 0)
        self.category = ""
        self.system = ""
        self.project_id = ""
        self.reference_no = ""
        self.header = {}
        self.lines = []          # Intacct bill lines
        self.entrata_rows = []   # Entrata handoff rows
        self.approvers = []
        self.supersedes = ""
        self.gross = D(0)

    # --- helpers
    def hold(self, code, reason):
        if code not in self.codes:
            self.codes.append(code)
        self.reasons.append(f"[{code}] {reason}")
        self.trail.append(f"FAIL  [{code}] {reason}")

    def ok(self, text):
        self.trail.append("PASS  " + text)

    def downgrade(self, level, why):
        order = {"High": 3, "Medium": 2, "Low": 1}
        if order[level] < order[self.confidence]:
            self.confidence = level
        self.confidence_basis.append(why)

    def primary_code(self, priority):
        for c in priority:
            if c in self.codes:
                return c
        return self.codes[0] if self.codes else ""

    def as_dict(self):
        return {
            "file": self.file, "decision": self.status, "codes": self.codes, "reasons": self.reasons,
            "info": self.info, "trail": self.trail, "confidence": self.confidence, "confidence_basis": self.confidence_basis,
            "vendor_id": self.vendor_id, "vendor_name": self.vendor_name, "bill_no": self.bill_no,
            "doc_type": self.doc_type, "bill_date": str(self.bill_date or ""), "amount": str(self.amount),
            "category": self.category, "system": self.system, "project_id": self.project_id,
            "reference_no": self.reference_no, "approvers": self.approvers, "supersedes": self.supersedes,
            "lines": [{k: (str(v) if isinstance(v, (Decimal, date)) else v) for k, v in l.items()} for l in self.lines],
            "entrata_rows": [{k: (str(v) if isinstance(v, (Decimal, date)) else v) for k, v in r.items()} for r in self.entrata_rows],
        }


def allocate_tax(amounts, tax):
    """Split `tax` across lines in proportion to their amounts, rounded to the cent. Any rounding difference
    lands on the largest line (policy section 4)."""
    amounts = [D(a) for a in amounts]
    tax = D(tax)
    if tax == 0 or sum(amounts) == 0:
        return [D(0)] * len(amounts)
    base = sum(amounts)
    shares = [q(tax * a / base) for a in amounts]
    diff = tax - sum(shares)
    if diff != 0:
        idx = max(range(len(amounts)), key=lambda i: abs(amounts[i]))
        shares[idx] += diff
    return shares


class Engine:
    def __init__(self, master, history, contracts, register, cfg, run_id):
        self.m, self.h, self.c, self.reg, self.cfg, self.run_id = master, history, contracts, register, cfg, run_id
        t = cfg["thresholds"]
        self.tol_overpo = D(t["overpo_tolerance"])
        self.retain_pct = D(t["retainage_pct"])
        self.retain_tol = D(t["retainage_tolerance"])
        self.arith_tol = D(t["arithmetic_tolerance"])

    # ================================================================================== batch loop
    def process_batch(self, docs):
        """Credit memos first so they reduce PO balances before invoices are tested, then file-name order."""
        order = sorted(docs, key=lambda d: (0 if d["kind"] == "credit_memo" else 1, d["file"]))
        out = []
        for doc in order:
            dec = self.decide(doc)
            self.commit(dec)
            out.append(dec)
        return sorted(out, key=lambda d: d.file)

    # ================================================================================== decision
    def decide(self, doc):
        dec = Decision(doc)
        if doc["kind"] == "other":
            dec.hold("OTHER", "Not a bill, pay application or credit memo (for example a standalone lien waiver). Not entered.")
            dec.status = HOLD
            return self._finish(dec)

        problems = validate_extraction(doc, self.arith_tol)
        if problems:
            dec.hold("OTHER", "The numbers on the document do not tie out, so it was not entered: " + "; ".join(problems))
            dec.downgrade("Medium", "extraction or arithmetic check failed")
        else:
            dec.ok("Arithmetic on the document ties out (lines add to subtotal, subtotal plus tax equals total" + (", pay application lines 1 to 8 agree)" if doc["kind"] == "pay_app" else ")"))

        vendor = self._vendor(doc, dec)
        if vendor is None:
            dec.hold("NEWVEND", f"Vendor '{doc['vendor_name_raw']}' is not in the vendor master. Do not create or guess a vendor ID.")
        else:
            dec.vendor_id, dec.vendor_name = vendor["VENDOR_ID"], vendor["Vendor Name"]
            dec.ok(f"Vendor matched to {vendor['VENDOR_ID']} {vendor['Vendor Name']} (Active)")

        bill_to_entity = self._bill_to(doc, dec)

        if vendor is not None:
            self._payment_instructions(doc, vendor, dec)
            early = self._duplicates(doc, vendor, dec)
            if early:
                return self._finish(dec)

        cat = self._classify(doc, vendor, dec)
        dec.category = cat
        dec.ok(f"Category: {cat} ({'Customer Ref ' + doc['customer_ref'] if doc['customer_ref'] else 'no Customer Ref; classified from ship-to and vendor type'})")

        if cat == "construction":
            self._construction(doc, vendor, dec, bill_to_entity)
        elif cat == "stabilized":
            self._stabilized(doc, vendor, dec, bill_to_entity)
        elif cat == "corporate":
            self._corporate(doc, vendor, dec, bill_to_entity)

        if vendor is not None and not dec.codes:
            self._dates_and_header(doc, vendor, dec)
            self._approvers(doc, dec)
            self._soft_duplicate_note(doc, vendor, dec)

        dec.status = HOLD if dec.codes else (ENTER_ENTRATA if cat == "stabilized" else ENTER_INTACCT)
        if dec.status == HOLD:
            dec.lines, dec.entrata_rows, dec.approvers = [], [], []   # a held document is not entered at all, not even in part
        return self._finish(dec)

    def _finish(self, dec):
        if dec.status is None:
            dec.status = HOLD if dec.codes else ENTER_INTACCT
        return dec

    # ================================================================================== vendor
    def _vendor(self, doc, dec):
        names = [doc.get("vendor_name_raw", ""), doc.get("remit_to", {}).get("name", "")]
        vendors = self.m.vendors.values()
        for nm in names:
            n = norm_name(nm)
            if not n:
                continue
            act = [v for v in vendors if v["Status"] == "Active" and norm_name(v["Vendor Name"]) == n]
            if act:
                return act[0]
        for nm in names:
            n = norm_name(nm)
            ina = [v for v in vendors if v["Status"] != "Active" and norm_name(v["Vendor Name"]) == n]
            if ina:
                mm = re.search(r"Merged into (V\d{4})", str(ina[0].get("Notes") or ""))
                if mm and mm.group(1) in self.m.vendors and self.m.vendors[mm.group(1)]["Status"] == "Active":
                    dec.info.append(f"Vendor name matched inactive record {ina[0]['VENDOR_ID']}; used the surviving active record {mm.group(1)}.")
                    dec.downgrade("Medium", "vendor matched through an inactive merged record")
                    return self.m.vendors[mm.group(1)]
        return None

    # ================================================================================== bill-to
    def _bill_to(self, doc, dec):
        name, c_o = doc["bill_to"]["name"], doc["bill_to"]["c_o"]
        ent = self.m.legal_entity_for(name) or (self.m.legal_entity_for(c_o) if c_o else None)
        if ent is None:
            dec.hold("OTHER", f"Addressed to '{name}', which is not a Hillpointe legal entity. Return to the vendor for a corrected bill-to.")
        else:
            dec.ok(f"Bill-to '{name}' is a Hillpointe legal entity ({ent})")
        return ent

    # ================================================================================== bank / remit
    def _payment_instructions(self, doc, vendor, dec):
        problems = []
        if doc["payment_change_hits"]:
            problems.append("the document asks us to change payment instructions (" + ", ".join(doc["payment_change_hits"][:4]) + ")")
        cand = doc["remit_to"]["address"] or doc["vendor_address_header"]
        if cand and norm_addr(cand) != norm_addr(vendor["Remit Address"]):
            problems.append(f"remit address '{cand}' differs from the vendor master '{vendor['Remit Address']}'")
        ph = doc["vendor_phone"]
        if ph and digits(ph)[-10:] != digits(vendor["Phone of Record"])[-10:]:
            problems.append(f"phone {ph} differs from the phone of record {vendor['Phone of Record']}")
        if not problems:
            dec.ok("No payment-change language; remit address and phone agree with the vendor master")
        if problems:
            dec.hold("BANKCHG", "Possible payment-instruction change: " + "; ".join(problems) +
                     f". Treasury should verify by calling {vendor['Phone of Record']} (phone on file). Never use contact details printed on the invoice.")

    # ================================================================================== duplicates
    def _duplicates(self, doc, vendor, dec):
        """Returns True when the document is a duplicate or already entered, which ends processing."""
        vid, no = vendor["VENDOR_ID"], doc["invoice_no"]
        key = make_key(vid, no, dec.doc_type)
        hist = self.h.find_invoice(vid, norm_invoice_no(no), norm_invoice_no)
        reg = self.reg.get(key)

        # Same inbox file presented again (a rerun of the same batch): nothing to do. A different file with the same
        # content (a resend, a reprint, a past-due reminder) is NOT a rerun, it is a duplicate document.
        if reg and reg["status"] == "ENTERED" and reg["source_file"] == doc["file"] and reg["file_sha256"] == doc["sha256"]:
            dec.status = SKIP
            dec.info.append(f"Same inbox file already entered in run {reg['first_run']}. No action.")
            return True

        # revised invoice: replaces an earlier version
        rep = doc.get("replaces_invoice")
        if doc.get("revised") and rep:
            rep_key = make_key(vid, rep, "Bill")
            rep_hist = self.h.find_invoice(vid, norm_invoice_no(rep), norm_invoice_no)
            rep_reg = self.reg.get(rep_key)
            if rep_hist or (rep_reg and rep_reg["status"] == "ENTERED"):
                where = (f"ERP history {rep_hist[0]['Record']}" if rep_hist else f"a prior run ({rep_reg['source_file']})")
                dec.status = DUP
                dec.hold("DUP", f"Revised invoice replaces {rep}, which is already entered ({where}). Only one version may be entered. "
                                "AP Manager decides whether to void and re-enter or reject the revision.")
                return True
            if rep_reg and rep_reg["status"] == "HELD" and rep_key != key:
                dec.supersedes = rep_key
            if rep_reg and rep_reg["status"] == "HELD":
                dec.info.append(f"Revised invoice replaces {rep}, which was held in run {rep_reg['first_run']} ({rep_reg['source_file']}) and never entered. "
                                "This version is evaluated on its own merits; the held original is closed out.")
                dec.supersedes = rep_key
        if hist:
            dec.status = DUP
            dec.hold("DUP", f"Already entered in {hist[0]['System']} as {hist[0]['Record']} (invoice '{hist[0]['Bill / Invoice No']}', "
                            f"{hist[0]['Bill Date']}, ${hist[0]['Bill Total']:,.2f}). Same vendor, same invoice number after normalizing format.")
            return True
        if reg and reg["status"] == "ENTERED":
            dec.status = DUP
            stamps = f" The document carries a '{', '.join(doc['stamps'])}' stamp." if doc["stamps"] else ""
            same = " The PDF content is identical to the earlier file." if reg["file_sha256"] == doc["sha256"] else ""
            dec.hold("DUP", f"Already entered in run {reg['first_run']} from {reg['source_file']} (same vendor, same invoice number, "
                            f"${D(reg['amount']):,.2f}).{stamps}{same} This is a different inbox file for the same invoice.")
            return True
        dec.ok(f"Not a duplicate: key {key} is not in ERP history ({len(self.h.rows)} bills) or the register ({len(self.reg.entered())} entered)")
        return False

    def _soft_duplicate_note(self, doc, vendor, dec):
        for r in self.h.rows:
            if (r["VENDOR_ID"] == vendor["VENDOR_ID"] and r["Bill Total"] == dec.amount and r["Bill Date"] == dec.bill_date):
                dec.info.append(f"Possible duplicate to review: same vendor, date and amount as {r['Record']} ({r['Bill / Invoice No']}).")
                dec.downgrade("Medium", "same vendor/date/amount as an existing bill under a different number")

    # ================================================================================== classify
    def _classify(self, doc, vendor, dec):
        r = doc["refs_customer_ref"]
        ship_projects = self.m.project_by_text(doc.get("ship_to", "") + " " + doc["bill_to"]["name"])
        if r["po"] or r["subcontract"]:
            return "construction"
        if r["service_agreement"]:
            return "stabilized"
        if r["order_form"] and vendor and not (ship_projects):
            return "corporate"
        if ship_projects:
            st = self.m.projects[ship_projects[0]]["Status"]
            return "stabilized" if st == "Stabilized Operations" else "construction"
        if vendor:
            if vendor["Vendor Type"] in CONSTRUCTION_VENDOR_TYPES:
                return "construction"
            if vendor["Vendor Type"].startswith("Service: Property"):
                return "stabilized"
            return "corporate"
        # unknown vendor and no reference
        return "construction" if re.search(r"jobsite|construction", doc.get("ship_to", ""), flags=re.I) else "corporate"

    # ================================================================================== construction
    def _find_contract(self, doc, vendor, dec):
        r = doc["refs_customer_ref"]
        want_sc = doc["kind"] == "pay_app"
        refs = (r["subcontract"] + r["po"]) if want_sc else (r["po"] + r["subcontract"])
        ship_projects = self.m.project_by_text(doc.get("ship_to", ""))
        if not refs:
            msg = "No PO or subcontract is referenced on the document, so the project and coding cannot be confirmed."
            if ship_projects:
                msg += f" The ship-to names {self.m.projects[ship_projects[0]]['Project Name']} ({self.m.projects[ship_projects[0]]['Status']})."
            hint = self._likely_po(doc, vendor, ship_projects)
            dec.hold("NOPO", msg + (f" Likely match for the project manager to confirm: {hint}. Not coded to it." if hint else ""))
            if ship_projects:
                dec.project_id = ship_projects[0]
            return None
        ref = refs[0]
        contract = self.c.pos.get(ref) or self.c.subcontracts.get(ref)
        if contract is None:
            dec.hold("NOPO", f"{ref} is referenced but no matching PO or subcontract is in the package. Project cannot be confirmed.")
            return None
        if vendor and contract["vendor_id"] != vendor["VENDOR_ID"]:
            dec.hold("OTHER", f"{ref} belongs to vendor {contract['vendor_id']}, not {vendor['VENDOR_ID']}.")
        if ref in self.c.pos and str(self.c.pos[ref]["status"]).lower() != "open":
            dec.hold("OTHER", f"{ref} status is {self.c.pos[ref]['status']}, not Open.")
        proj = self.m.projects.get(contract["project_id"])
        if proj is None or proj["Status"] != "Active Construction":
            dec.hold("OTHER", f"{ref} is on project {contract['project_id']} which is not an Active Construction project.")
            return None
        if ship_projects and contract["project_id"] not in ship_projects:
            dec.hold("NOPO", f"Ship-to project on the document ({self.m.projects[ship_projects[0]]['Project Name']}) does not match the project on {ref} ({proj['Project Name']}). Project cannot be confirmed.")
        dec.project_id = contract["project_id"]
        dec.reference_no = ref
        if not dec.codes:
            dec.ok(f"{ref} found; vendor matches; project {contract['project_id']} {proj['Project Name']} is Active Construction")
        return contract

    def _likely_po(self, doc, vendor, ship_projects):
        if not vendor:
            return ""
        cands = [p for p in self.c.pos.values() if p["vendor_id"] == vendor["VENDOR_ID"]]
        scored = []
        rates = {l.get("rate") for l in doc.get("lines", [])}
        for p in cands:
            s = 0
            for ln in p["lines"]:
                for rt in rates:
                    if rt and f"${D(rt):,.2f}" in ln["pricing"]:
                        s += 2
            if p["project_id"] in ship_projects:
                s += 1
            scored.append((s, p))
        scored.sort(key=lambda x: -x[0])
        if not scored:
            return ""
        top = scored[0]
        if top[0] > 0:
            why = []
            if any(f"${D(rt):,.2f}" in ln["pricing"] for ln in top[1]["lines"] for rt in rates if rt):
                why.append("unit rate matches the PO price")
            return f"{top[1]['number']} ({', '.join(why) or 'project matches'})"
        return "candidates for this vendor: " + ", ".join(p["number"] for _, p in scored)

    def billed_to_date(self, ref, exclude_key=None):
        tot = sum((r["Bill Total"] for r in self.h.for_reference(ref)), D(0))
        for r in self.reg.entered():
            if r["reference_no"] == ref and r["key"] != exclude_key:
                tot += D(r["amount"])
        return tot

    def _construction(self, doc, vendor, dec, bill_to_entity):
        dec.system = "Sage Intacct"
        contract = self._find_contract(doc, vendor, dec)
        proj = self.m.projects.get(dec.project_id) if dec.project_id else None
        if proj and bill_to_entity and bill_to_entity != self.cfg["construction"]["posting_entity"]:
            dec.info.append(f"Addressed to {doc['bill_to']['name']} ({bill_to_entity}). The PO or subcontract identifies the project, so the bill is posted to HPC. Informational, not a hold.")
        if vendor:
            self._coi(doc, vendor, dec)
        if contract is None:
            return
        if doc["kind"] == "pay_app":
            self._pay_app(doc, vendor, dec, contract)
        else:
            self._po_invoice(doc, vendor, dec, contract)

    def _coi(self, doc, vendor, dec):
        if doc["kind"] == "credit_memo":
            return
        coi = vendor.get("COI_date")
        grace = int(self.cfg["thresholds"].get("coi_grace_days", 0))
        need = add_days(dec.bill_date, grace)
        if coi and coi >= need:
            dec.ok(f"Insurance certificate valid through {coi:%m/%d/%Y} (bill date {dec.bill_date:%m/%d/%Y})")
        if coi and coi < need:
            dec.hold("COI", f"Vendor insurance certificate expires {coi:%m/%d/%Y}, before the bill date {dec.bill_date:%m/%d/%Y}"
                            f"{f' plus {grace} grace days' if grace else ''}. Policy requires it to be on or after that date.")

    # ------------------------------------------------------------------ PO invoices and credit memos
    def _po_invoice(self, doc, vendor, dec, contract):
        cfg = self.cfg["construction"]
        if "lines" not in contract:   # a subcontract was referenced on a plain invoice
            dec.hold("OTHER", f"{contract['number']} is a subcontract but the document is not a pay application.")
            return
        po = contract
        # PO balance
        billed = self.billed_to_date(po["number"])
        total = D(doc["total"])
        if doc["kind"] == "invoice":
            over = billed + total - po["total"]
            if over > self.tol_overpo:
                dec.hold("OVERPO", f"Invoice ${total:,.2f} would put billed to date at ${billed + total:,.2f} against PO {po['number']} of ${po['total']:,.2f} "
                                   f"(over by ${over:,.2f}, more than the ${self.tol_overpo:,.0f} tolerance). Billed to date ${billed:,.2f} includes bills in history and credits entered. Needs a PO change order.")
            elif over > 0:
                dec.info.append(f"Over the PO amount by ${over:,.2f}, within the ${self.tol_overpo:,.0f} tolerance.")
                dec.ok(f"PO balance: billed ${billed:,.2f} + ${total:,.2f} = ${billed + total:,.2f} vs PO ${po['total']:,.2f}, over by ${over:,.2f} (within tolerance)")
            else:
                dec.ok(f"PO balance: billed ${billed:,.2f} + ${total:,.2f} = ${billed + total:,.2f} vs PO ${po['total']:,.2f}, remaining ${po['total'] - billed - total:,.2f}")
        # map invoice lines to PO lines
        items = doc["lines"]
        mapping = []
        for it in items:
            pl = self._map_po_line(it["desc"], po)
            if pl is None:
                dec.hold("OTHER", f"Cannot tell which PO line '{it['desc'][:50]}' belongs to on {po['number']}.")
                dec.downgrade("Medium", "ambiguous PO line mapping")
                return
            mapping.append(pl)
        for pl in {p["line"]: p for p in mapping}.values():
            allowed = self.m.cost_codes.get(pl["cost_code"], {}).get("allowed", set())
            if pl["cost_type"] not in allowed:
                dec.hold("OTHER", f"PO line {pl['line']} uses cost type {pl['cost_type']} which is not allowed for cost code {pl['cost_code']}.")
                return
        amounts = [D(i["amount"]) for i in items]
        tax = D(doc.get("tax_total") or 0)
        shares = allocate_tax(amounts, tax)
        groups = {}
        for it, pl, a, s in zip(items, mapping, amounts, shares):
            g = groups.setdefault(pl["line"], {"pl": pl, "amount": D(0), "tax": D(0), "descs": []})
            g["amount"] += a
            g["tax"] += s
            g["descs"].append(it["desc"])
        # coding for credit memos follows the original bill
        orig_coding = None
        if doc["kind"] == "credit_memo":
            orig = doc.get("credit_original_invoice")
            hist = self.h.find_invoice(vendor["VENDOR_ID"], norm_invoice_no(orig), norm_invoice_no) if orig else []
            reg = self.reg.get(make_key(vendor["VENDOR_ID"], orig, "Bill")) if orig else None
            if hist:
                h0 = hist[0]
                orig_coding = {"project": str(h0["PROJECT_ID"]), "task": str(h0["TASK_ID"]).zfill(5), "ct": str(h0["COST_TYPE_ID"])}
            elif reg and reg["status"] == "ENTERED":
                orig_coding = None
            else:
                dec.hold("OTHER", f"Credit memo refers to original invoice {orig or '(none)'} which is not in the ERP history or prior runs. Cannot code it the same way as the original.")
                return
        n = 0
        for lnno, g in sorted(groups.items()):
            pl = g["pl"]
            task, ct, project = pl["cost_code"], pl["cost_type"], dec.project_id
            if orig_coding and len(groups) == 1:
                if (orig_coding["task"], orig_coding["ct"]) != (task, ct):
                    dec.info.append(f"Credit coded like the original bill ({orig_coding['task']}/{orig_coding['ct']}), which differs from the PO line.")
                task, ct, project = orig_coding["task"], orig_coding["ct"], orig_coding["project"]
            n += 1
            memo = self._memo(g["descs"], bool(tax))
            dec.lines.append({"LINE_NO": n, "ACCT_NO": self.m.cost_types[ct], "LOCATION_ID": cfg["posting_entity"],
                              "DEPARTMENT_ID": cfg["department"], "PROJECT_ID": project, "TASK_ID": task,
                              "COST_TYPE_ID": ct, "LINE_MEMO": memo, "AMOUNT": q(g["amount"] + g["tax"])})
        if tax and len(items) > 1 and not dec.codes:
            dec.info.append("Sales tax shown as one total was allocated to lines in proportion to the taxable amounts, rounded to the cent, rounding difference on the largest line.")
        dec.gross = total

    def _map_po_line(self, desc, po):
        if len(po["lines"]) == 1:
            return po["lines"][0]
        stop = {"with", "from", "that", "this", "incl", "week", "rate", "unit", "and", "the", "for"}
        toks = lambda s: {w.rstrip("s") for w in re.findall(r"[a-z]{4,}", s.lower()) if w not in stop - {"delivery"}}
        dt = toks(desc)
        scores = [(len(dt & toks(l["desc"])), l) for l in po["lines"]]
        scores.sort(key=lambda x: -x[0])
        if scores[0][0] == 0 or (len(scores) > 1 and scores[0][0] == scores[1][0]):
            return None
        return scores[0][1]

    # ------------------------------------------------------------------ subcontractor pay applications
    def _pay_app(self, doc, vendor, dec, sc):
        cfg = self.cfg["construction"]
        if "cos" not in sc:
            dec.hold("OTHER", f"{sc['number']} is a PO but the document is a pay application.")
            return
        pa = doc["pay_app"]
        g = lambda k: D(pa[k])
        # change orders
        pending = [c for c in pa["change_orders_billed"] if c not in sc["cos"] or not sc["cos"][c]["executed"]]
        executed_total = sum((c["amount"] for c in sc["cos"].values() if c["executed"]), D(0))
        if pending:
            detail = ", ".join(f"{c} ({sc['cos'][c]['status']})" if c in sc["cos"] else f"{c} (not in the change order log)" for c in pending)
            dec.hold("UNAPPCO", f"Bills change order(s) that are not executed: {detail}. Hold the entire application and return it to the subcontractor for a revised application.")
        elif abs(g("net_change_cos") - executed_total) > self.arith_tol:
            dec.hold("OTHER", f"Line 2 net change by change orders ${g('net_change_cos'):,.2f} does not match the executed change order log ${executed_total:,.2f}.")
        if pending:
            dec.info.append(f"Line 2 net change by change orders is ${g('net_change_cos'):,.2f} but executed change orders total only ${executed_total:,.2f}.")
        if not pending and abs(g("net_change_cos") - executed_total) <= self.arith_tol:
            dec.ok(f"Change orders: only executed change orders billed; line 2 (${g('net_change_cos'):,.2f}) equals executed COs")
        if g("original_contract") != sc["original_contract"]:
            dec.hold("OTHER", f"Original contract sum on the application (${g('original_contract'):,.2f}) differs from the subcontract (${sc['original_contract']:,.2f}).")
        # previous certificates and completed-to-date must agree with bill history
        prev_hist = self.h.for_reference(sc["number"])
        prev_reg = [r for r in self.reg.entered() if r["reference_no"] == sc["number"] and r["key"] != make_key(vendor["VENDOR_ID"], doc["invoice_no"], "Bill")]
        prev_net = sum((r["Bill Total"] for r in prev_hist), D(0)) + sum((D(r["amount"]) for r in prev_reg), D(0))
        prev_gross = sum((r["Gross Amount"] for r in prev_hist), D(0)) + sum((D(r["gross_amount"] or 0) for r in prev_reg), D(0))
        if abs(prev_net - g("previous_certificates")) > self.arith_tol:
            dec.hold("OTHER", f"Previous certificates on the application (${g('previous_certificates'):,.2f}) do not agree to the bill history (${prev_net:,.2f}).")
        if abs(prev_gross + g("this_period_gross") - g("completed_to_date")) > self.arith_tol:
            dec.hold("OTHER", f"Completed to date ${g('completed_to_date'):,.2f} does not equal prior gross billed ${prev_gross:,.2f} plus this period ${g('this_period_gross'):,.2f}.")
        if abs(prev_net - g("previous_certificates")) <= self.arith_tol and abs(prev_gross + g("this_period_gross") - g("completed_to_date")) <= self.arith_tol:
            dec.ok(f"Previous certificates ${prev_net:,.2f} agree to bill history; completed to date ${g('completed_to_date'):,.2f} = prior gross ${prev_gross:,.2f} + this period ${g('this_period_gross'):,.2f}")
        exp_ret = q(g("this_period_gross") * self.retain_pct)
        if abs(exp_ret - g("this_period_retainage")) > self.retain_tol:
            dec.hold("OTHER", f"Retainage this period ${g('this_period_retainage'):,.2f} is not {self.retain_pct:.0%} of ${g('this_period_gross'):,.2f} (expected ${exp_ret:,.2f}).")
        if g("contract_to_date") + self.tol_overpo < g("completed_to_date"):
            dec.hold("OVERPO", f"Completed to date ${g('completed_to_date'):,.2f} exceeds contract sum to date ${g('contract_to_date'):,.2f}.")
        # lien waiver
        if vendor and vendor["lien_required"]:
            w = doc["lien_waiver"]
            if not w.get("attached"):
                why = "the application says it will follow under separate cover" if w.get("promised_later") else "none is attached"
                dec.hold("LIEN", f"Vendor requires a conditional lien waiver for the current payment and {why}.")
            else:
                if w.get("amount") is None or abs(D(w["amount"]) - g("current_due")) > self.arith_tol:
                    dec.hold("LIEN", f"Lien waiver amount ${D(w['amount'] or 0):,.2f} does not match the current payment due ${g('current_due'):,.2f}.")
                if norm_name(w.get("claimant", "")) != norm_name(vendor["Vendor Name"]):
                    dec.hold("LIEN", f"Lien waiver claimant '{w.get('claimant')}' is not the vendor '{vendor['Vendor Name']}'.")
                if w.get("through_date") and as_date(w["through_date"]) < as_date(pa["period_end"]):
                    dec.hold("LIEN", f"Lien waiver through date {w['through_date']} is before the end of the billing period {pa['period_end']}.")
                if w.get("signature_line_blank"):
                    dec.info.append("Lien waiver signature line appears blank in the PDF text. A person should confirm the signed original (cannot be verified from this file).")
        if vendor and vendor["lien_required"] and not any(c == "LIEN" for c in dec.codes):
            dec.ok(f"Conditional lien waiver attached for ${D(doc['lien_waiver']['amount']):,.2f} through {doc['lien_waiver']['through_date']}, matches current payment due")
        if dec.codes:
            return
        # build bill: gross work, then retainage as a negative line to 20500 with the same dimensions
        ct, task = sc["cost_type"], sc["cost_code"]
        gross, ret = g("this_period_gross"), g("this_period_retainage")
        dec.lines.append({"LINE_NO": 1, "ACCT_NO": self.m.cost_types[ct], "LOCATION_ID": cfg["posting_entity"], "DEPARTMENT_ID": cfg["department"],
                          "PROJECT_ID": dec.project_id, "TASK_ID": task, "COST_TYPE_ID": ct,
                          "LINE_MEMO": self._trim(f"Pay App {pa['app_no']} " + "; ".join(r["desc"] for r in pa["continuation"])), "AMOUNT": q(gross)})
        dec.lines.append({"LINE_NO": 2, "ACCT_NO": cfg["retainage_acct"], "LOCATION_ID": cfg["posting_entity"], "DEPARTMENT_ID": cfg["department"],
                          "PROJECT_ID": dec.project_id, "TASK_ID": task, "COST_TYPE_ID": ct,
                          "LINE_MEMO": f"Retainage {self.retain_pct:.0%} Pay App {pa['app_no']}", "AMOUNT": -q(ret)})
        dec.gross = gross
        dec.header["app_no"] = pa["app_no"]

    # ================================================================================== stabilized (Entrata)
    def _stabilized(self, doc, vendor, dec, bill_to_entity):
        dec.system = "Entrata"
        r = doc["refs_customer_ref"]
        sa = self.c.agreements.get(r["service_agreement"][0]) if r["service_agreement"] else None
        ship_projects = self.m.project_by_text(doc.get("ship_to", "") + " " + doc["bill_to"]["name"])
        pid = sa["project_id"] if sa else (ship_projects[0] if ship_projects else "")
        if r["service_agreement"] and sa is None:
            dec.hold("OTHER", f"{r['service_agreement'][0]} is referenced but no matching service agreement is in the package, so the monthly fee cannot be checked.")
        if not pid:
            dec.hold("NOPO", "Stabilized community cannot be identified from the agreement or ship-to.")
            return
        proj = self.m.projects[pid]
        dec.project_id = pid
        if proj["Status"] != "Stabilized Operations":
            dec.hold("OTHER", f"Project {pid} is not a Stabilized Operations project.")
            return
        if ship_projects and pid not in ship_projects:
            dec.hold("OTHER", f"Ship-to project does not match the project on {sa['number'] if sa else 'the agreement'}.")
        if sa:
            dec.reference_no = sa["number"]
            if vendor and sa["vendor_id"] != vendor["VENDOR_ID"]:
                dec.hold("OTHER", f"{sa['number']} is with vendor {sa['vendor_id']}, not {vendor['VENDOR_ID']}.")
            total = D(doc["total"])
            if total != sa["monthly_fee"]:
                dec.hold("OTHER", f"Invoice total ${total:,.2f} does not match the monthly fee ${sa['monthly_fee']:,.2f} in {sa['number']}.")
            else:
                dec.ok(f"{sa['number']} found; vendor and property match; invoice ${total:,.2f} equals the monthly fee")
        else:
            dec.info.append("No service agreement on file for this vendor and property. Monthly fee not validated.")
            dec.downgrade("Medium", "no service agreement to validate the fee")
        if vendor:
            self._coi(doc, vendor, dec)
        if dec.codes or vendor is None:
            return
        # Entrata GL by description keyword. One row per GL.
        rows = {}
        for it in doc["lines"]:
            gl = None
            for pat, acct in self.cfg["entrata_gl_keywords"]:
                if re.search(pat, it["desc"], flags=re.I):
                    gl = acct
                    break
            if gl is None or gl not in self.m.gl_entrata:
                dec.hold("OTHER", f"No Entrata GL rule for '{it['desc'][:50]}'. Property Accounting to choose the GL.")
                return
            rows.setdefault(gl, {"amount": D(0), "descs": []})
            rows[gl]["amount"] += D(it["amount"])
            rows[gl]["descs"].append(it["desc"])
        tax = D(doc.get("tax_total") or 0)
        if tax:
            allocs = allocate_tax([v["amount"] for v in rows.values()], tax)
            for v, a in zip(rows.values(), allocs):
                v["amount"] += a
        dec.header["entrata_rows"] = rows
        dec.gross = D(doc["total"])
        if bill_to_entity and bill_to_entity not in (proj["Owner Entity"], "HPM"):
            dec.info.append(f"Addressed to {doc['bill_to']['name']}; the owner entity for the property is {proj['Owner Entity']}.")

    # ================================================================================== corporate
    def _corporate(self, doc, vendor, dec, bill_to_entity):
        dec.system = "Sage Intacct"
        cc = self.cfg["corporate"]
        if vendor is None:
            return
        self._coi(doc, vendor, dec)
        dept = vendor.get("Owner Dept")
        if not dept or dept not in self.m.departments:
            dec.hold("OTHER", "Corporate expense with no Owner Dept on the vendor master and no requesting department on the document. A person must confirm the department.")
            return
        notes = str(vendor.get("Notes") or "")
        shared = "allocate" in notes.lower() and "allocation_table" in notes.lower().replace(" ", "_")
        items = doc["lines"]
        amounts = [D(i["amount"]) for i in items]
        tax = D(doc.get("tax_total") or 0)
        shares = allocate_tax(amounts, tax)
        n = 0
        default_gl = str(vendor.get("Default GL") or "").strip()

        def add(acct, loc, amt, memo):
            nonlocal n
            n += 1
            dec.lines.append({"LINE_NO": n, "ACCT_NO": acct, "LOCATION_ID": loc, "DEPARTMENT_ID": dept, "PROJECT_ID": "", "TASK_ID": "",
                              "COST_TYPE_ID": "", "LINE_MEMO": self._trim(memo), "AMOUNT": q(amt)})

        for it, a, s in zip(items, amounts, shares):
            amt = a + s
            low = it["desc"].lower()
            is_one_time = any(k in low for k in cc["one_time_keywords"])
            is_sub = any(k in low for k in cc["subscription_keywords"])
            if shared:
                if is_one_time:
                    add(cc["one_time_acct"], cc["one_time_entity"], amt, f"{it['desc']} (one time, 100% {cc['one_time_entity']})")
                elif is_sub and default_gl:
                    alloc = self.m.allocation
                    if abs(sum(alloc.values()) - 1) > D("0.0001"):
                        dec.hold("OTHER", "Allocation table does not add to 100%.")
                        return
                    parts = {e: q(amt * p) for e, p in alloc.items()}
                    parts["HCM"] = amt - sum(v for e, v in parts.items() if e != "HCM")      # rounding goes to HCM
                    for e in ["HCM"] + [e for e in alloc if e != "HCM"]:
                        add(default_gl, e, parts[e], f"{it['desc']} ({alloc[e]:.0%} {e})")
                else:
                    dec.hold("OTHER", f"Cannot tell whether '{it['desc'][:50]}' is a subscription (allocated) or a one-time service.")
                    return
            else:
                acct = default_gl
                if not acct:
                    for pat, g in cc["gl_keywords"]:
                        if re.search(pat, low):
                            acct = g
                            break
                if not acct or acct not in self.m.gl_intacct:
                    dec.hold("OTHER", f"No GL account rule for '{it['desc'][:50]}'. A person must choose the account.")
                    return
                add(acct, cc["default_entity"], amt, it["desc"])
        dec.reference_no = (doc["refs_customer_ref"]["order_form"] or [""])[0]
        dec.gross = D(doc["total"])
        if shared:
            dec.info.append("Subscription split by the Allocation_Table (rounding to HCM). One-time services posted 100% to HCM on 65010.")

    # ================================================================================== header
    def _dates_and_header(self, doc, vendor, dec):
        terms = str(vendor["Terms"]).strip()
        days = self.cfg["terms_days"].get(terms)
        if days is None:
            dec.hold("OTHER", f"Vendor master terms '{terms}' are not one of the supported terms.")
            return
        bd = dec.bill_date
        posting = bd if self.m.period_status(bd) == "Open" else self.m.first_open_period_start()
        if posting != bd:
            dec.info.append(f"Bill date {bd:%m/%d/%Y} is in a {self.m.period_status(bd).lower()} period; GL posting date moved to {posting:%m/%d/%Y}.")
        due = bd if dec.doc_type == "Adjustment" else add_days(bd, days)
        printed = (doc.get("terms_printed") or "").strip()
        if printed and printed.lower() not in (terms.lower(), "n/a"):
            dec.info.append(f"Invoice prints terms '{printed}'; used vendor master '{terms}' as policy requires.")
        short = short_name(vendor["Vendor Name"])
        project = self.m.projects.get(dec.project_id, {}).get("Project Name", "")
        if dec.category == "construction" and doc["kind"] == "pay_app":
            desc = f"{short} Pay App {doc['pay_app']['app_no']} {project}"
        elif doc["kind"] == "credit_memo":
            desc = f"{short} credit memo {dec.bill_no} re invoice {doc.get('credit_original_invoice')}"
        elif dec.category == "construction":
            desc = f"{short} {dec.bill_no} {project}"
        else:
            desc = f"{short} {dec.bill_no} {(doc['lines'][0]['desc'] if doc['lines'] else '')}"
        dec.ok(f"Terms from vendor master: {terms}; bill date {bd:%m/%d/%Y}, GL posting date {posting:%m/%d/%Y}, due date {due:%m/%d/%Y}")
        dec.header.update({"BILL_NO": dec.bill_no, "DOC_TYPE": dec.doc_type, "VENDOR_ID": vendor["VENDOR_ID"], "BILL_DATE": bd,
                           "GL_POSTING_DATE": posting, "DUE_DATE": due, "TERM_NAME": terms, "REFERENCE_NO": dec.reference_no,
                           "DESCRIPTION": self._trim(desc), "SUPDOC_ID": dec.supdoc_id})
        if dec.category == "stabilized":
            proj = self.m.projects[dec.project_id]
            rp = D(self.cfg["thresholds"]["regional_pm_invoice_over"])
            appr = [proj["Approver"]] + ([f"Regional Property Manager (invoice over ${rp:,.0f})"] if D(doc["total"]) > rp else [])
            rows = dec.header.get("entrata_rows", {})
            for gl, v in rows.items():
                dec.entrata_rows.append({
                    "Property": proj["Project Name"], "Owner Entity": proj["Owner Entity"], "PROJECT_ID": dec.project_id,
                    "VENDOR_ID": vendor["VENDOR_ID"], "Vendor Name": vendor["Vendor Name"], "Invoice No": dec.bill_no,
                    "Invoice Date": bd, "Post Month": bd.strftime("%m/%Y"), "Due Date": due, "Entrata GL": gl,
                    "Description": self._trim("; ".join(v["descs"])), "Amount": q(v["amount"]), "Approver": "; ".join(appr),
                    "SUPDOC_ID": dec.supdoc_id})
            s = sum((r["Amount"] for r in dec.entrata_rows), D(0))
            if s != D(doc["total"]):
                dec.hold("OTHER", f"Entrata rows add to ${s:,.2f} but the invoice total is ${D(doc['total']):,.2f}.")
            return
        # Intacct: stamp header fields on every line and verify the bill total
        for l in dec.lines:
            for k in ("BILL_NO", "DOC_TYPE", "VENDOR_ID", "BILL_DATE", "GL_POSTING_DATE", "DUE_DATE", "TERM_NAME", "REFERENCE_NO", "DESCRIPTION", "SUPDOC_ID"):
                l[k] = dec.header[k]
        total = sum((l["AMOUNT"] for l in dec.lines), D(0))
        expect = D(doc["total"])
        if abs(total - expect) > self.arith_tol:
            dec.hold("OTHER", f"Bill lines add to ${total:,.2f} but the amount owed on the document is ${expect:,.2f}.")

    def _approvers(self, doc, dec):
        if dec.status in (HOLD,) or dec.codes:
            return
        th = self.cfg["thresholds"]
        if dec.doc_type == "Adjustment":
            dec.approvers = ["AP Manager review"]
        elif dec.category == "construction":
            p = self.m.projects[dec.project_id]
            dec.approvers = [p["Approver"]]
            if dec.gross > D(th["vp_construction_gross_over"]):
                dec.approvers.append(f"VP Construction (gross work billed over ${D(th['vp_construction_gross_over']):,.0f})")
        elif dec.category == "stabilized":
            p = self.m.projects[dec.project_id]
            dec.approvers = [p["Approver"]]
            if D(doc["total"]) > D(th["regional_pm_invoice_over"]):
                dec.approvers.append(f"Regional Property Manager (invoice over ${D(th['regional_pm_invoice_over']):,.0f})")
        else:
            dept = dec.lines[0]["DEPARTMENT_ID"] if dec.lines else ""
            dec.approvers = [f"Department head, {self.m.departments[dept]['Department']} ({dept})"]
            if dec.amount > D(th["cfo_bill_over"]):
                dec.approvers.append(f"CFO (bill over ${D(th['cfo_bill_over']):,.0f})")
        dec.ok("Required approvers: " + "; ".join(dec.approvers))

    # ================================================================================== misc
    @staticmethod
    def _trim(s, n=80):
        s = " ".join(str(s).split())
        return s[:n].rstrip()

    def _memo(self, descs, has_tax):
        base = "; ".join(re.sub(r"\s*\(.*?\)", "", d).strip() for d in descs)
        return self._trim(base + (" (incl. tax)" if has_tax else "") if len(base) < 64 else base)

    # ================================================================================== commit to register
    def commit(self, dec):
        d = dec.doc
        vid = dec.vendor_id or "UNKNOWN:" + norm_name(d.get("vendor_name_raw", ""))
        key = make_key(vid, dec.bill_no, dec.doc_type)
        common = dict(system="Entrata" if dec.system == "Entrata" else "Sage Intacct", vendor_id=vid, bill_no=dec.bill_no,
                      doc_type=dec.doc_type, bill_date=dec.bill_date, amount=dec.amount, reference_no=dec.reference_no,
                      project_id=dec.project_id, source_file=dec.file, file_sha256=d["sha256"], last_run=self.run_id,
                      codes=";".join(dec.codes))
        if dec.status in (ENTER_INTACCT, ENTER_ENTRATA):
            prev = self.reg.get(key)
            note = ""
            if prev and prev["status"] == "HELD":
                note = f"previously held in run {prev['first_run']} as {prev['source_file']} ({prev['codes']}); this version entered"
            elif dec.supersedes:
                note = f"replaces held {dec.supersedes}"
            self.reg.upsert(key, status="ENTERED", gross_amount=dec.gross if dec.category == "construction" and d["kind"] == "pay_app" else dec.amount,
                            first_run=self.run_id, note=note, **common)
            if dec.supersedes and dec.supersedes != key and self.reg.get(dec.supersedes):
                self.reg.upsert(dec.supersedes, status="SUPERSEDED", note=f"replaced by {dec.file}")
        elif dec.status == HOLD:
            self.reg.upsert(key, status="HELD", first_run=(self.reg.get(key) or {}).get("first_run") or self.run_id, note="; ".join(dec.reasons)[:300], **common)
        elif dec.status in (DUP, SKIP):
            row = self.reg.get(key)
            if row and dec.status == SKIP:
                row["last_run"] = self.run_id
