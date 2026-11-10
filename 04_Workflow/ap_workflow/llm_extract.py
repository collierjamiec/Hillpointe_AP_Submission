"""Optional LLM extractor. Off by default.

Needs:  pip install anthropic   and   export ANTHROPIC_API_KEY=...
Modes:  --extractor llm     LLM reads every document; the rules parser also runs and any disagreement on
                            invoice number, date, total or vendor is recorded as a warning (cross-check).
        --extractor hybrid  rules parser first; the LLM is used only for a document whose numbers fail validation.

The LLM output is merged into the same record the rules parser produces, then re-validated by the same code.
"""
import json
import os
import re
from pathlib import Path

from .extract import extract_with_rules, unreadable_doc, UnreadableFile, validate_extraction, PO_RE, SC_RE, SA_RE, OF_RE
from .util import D

ROOT = Path(__file__).resolve().parent.parent


def llm_available():
    """True when an API key and the anthropic package are both present."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return False
    try:
        import anthropic  # noqa: F401
        return True
    except ImportError:
        return False


def _call(cfg, file_name, text):
    """Ask Claude to read the document text and return the fields as JSON."""
    import anthropic
    prompt = (ROOT / cfg["llm"]["prompt_file"]).read_text(encoding="utf-8")
    system = prompt.split("## System prompt", 1)[1].split("## Output schema", 1)[0].strip()
    schema = prompt.split("## Output schema", 1)[1].split("## User message template", 1)[0].strip()
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=cfg["llm"]["model"], max_tokens=cfg["llm"]["max_tokens"], temperature=0,
        system=system + "\n\n## Output schema\n" + schema,
        messages=[{"role": "user", "content": f"FILE: {file_name}\n--- DOCUMENT TEXT START ---\n{text}\n--- DOCUMENT TEXT END ---"}],
    )
    out = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    out = re.sub(r"^```(?:json)?|```$", "", out.strip(), flags=re.M).strip()
    return json.loads(out)


def merge(doc, j):
    """Overlay the fields Claude read onto the rules parser's record, keeping the same shape."""
    for k in ("kind", "vendor_name_raw", "invoice_no", "date", "terms_printed", "customer_ref", "bill_to", "ship_to", "remit_to",
              "vendor_address_header", "vendor_phone", "vendor_email", "revised", "replaces_invoice", "credit_original_invoice",
              "lines", "subtotal", "tax_total", "tax_label", "tax_rate", "total", "pay_app", "lien_waiver"):
        if k in j and j[k] not in (None,):
            doc[k] = j[k]
    ref = doc.get("customer_ref", "")
    doc["refs_customer_ref"] = {"po": PO_RE.findall(ref), "subcontract": SC_RE.findall(ref),
                                "service_agreement": SA_RE.findall(ref), "order_form": OF_RE.findall(ref)}
    if j.get("payment_change_language") and not doc.get("payment_change_hits"):
        doc["payment_change_hits"] = ["llm: payment change language"]
    if doc.get("kind") == "credit_memo":
        for l in doc.get("lines", []):
            if D(l["amount"]) > 0:
                l["amount"] = str(-D(l["amount"]))
    return doc


def extract(path: Path, cfg: dict, mode: str):
    """Read one file. Never raises for a bad file: a file that cannot be read comes back as kind 'unreadable'
    with a plain-language reason, so one corrupt attachment cannot stop the whole batch."""
    try:
        doc = extract_with_rules(path, cfg)
    except UnreadableFile as e:
        return unreadable_doc(path, str(e))
    except Exception as e:   # anything unexpected while reading the layout: hold this file, keep the batch going
        return unreadable_doc(path, f"Penny could not read the invoice details from this file ({type(e).__name__}: {e}).")
    if mode == "rules":
        return doc
    problems = validate_extraction(doc)
    if mode == "hybrid" and not problems:
        return doc
    if not llm_available():
        doc["extraction"]["warnings"].append("LLM extractor requested but ANTHROPIC_API_KEY or the anthropic package is missing; used rules parser only")
        return doc
    try:
        j = _call(cfg, path.name, doc["raw_text"])
    except Exception as e:   # network, JSON, anything: fall back and say so
        doc["extraction"]["warnings"].append(f"LLM extraction failed ({type(e).__name__}: {e}); used rules parser only")
        return doc
    rules_view = {k: doc.get(k) for k in ("invoice_no", "date", "total", "vendor_name_raw")}
    merged = merge(dict(doc), j)
    merged["extraction"] = {"method": mode, "warnings": list(doc["extraction"]["warnings"])}
    for k, v in rules_view.items():
        a, b = str(v or "").strip(), str(merged.get(k) or "").strip()
        if a and b and a != b:
            merged["extraction"]["warnings"].append(f"cross-check: rules parser read {k}={a!r} but the LLM read {b!r}")
    return merged
