"""Decide saved readings again without touching the register. (Added after submission, v1.5.)

Penny saves what it read from every document in runs/<run-id>/extracted/*.json. Replaying those readings through
the same Engine, run by run in the original order, rebuilds every saved decision exactly (a test proves it). That
makes two safe previews possible:

  recheck    one document again: a corrected PDF, a manual entry, or the same reading under today's rules and
             reference data. It is decided against a copy of the register, and nothing is saved.
  simulate   every saved run again under draft rules, beside the same replay under the current rules, so the only
             difference shown is the rules change.

Both are previews. The register, the run folders and the import files are never written here.
"""
import copy
import hashlib
import json
from pathlib import Path

from .register import Register
from .rules import Engine
from .webexport import _run_info, _run_sort_key


class ScratchRegister(Register):
    """A register that lives only in memory. It starts as a copy and can never be saved."""

    def __init__(self, rows=None):
        """Start from a copy of the given rows, with no files behind it."""
        self.dir = self.path = self.log_path = None
        self.rows = copy.deepcopy(rows or {})

    def save(self):
        """Refuse: a preview must never change the real register."""
        raise RuntimeError("A preview never saves the register.")

    def append_log(self, rows):
        """Refuse: a preview must never write the run log."""
        raise RuntimeError("A preview never writes the run log.")


def fingerprint(obj) -> str:
    """A short, stable fingerprint of JSON-like data, for 'which rules were used'."""
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:12]


def data_fingerprint(package) -> str:
    """A short fingerprint of the reference data Penny reads (master data, ERP history, POs and subcontracts)."""
    h = hashlib.sha256()
    root = Path(package)
    for sub in ("02_Reference_Data", "06_ERP_History", "03_Purchase_Orders_and_Subcontracts"):
        for p in sorted((root / sub).rglob("*")) if (root / sub).exists() else []:
            if p.is_file():
                h.update(p.relative_to(root).as_posix().encode())
                h.update(p.read_bytes())
    return h.hexdigest()[:12]


def saved_runs(runs_dir):
    """Every saved run that has its readings, oldest first, the same order the web view shows."""
    found = [(p.parent, _run_info(p.parent)) for p in Path(runs_dir).glob("*/decisions.json")]
    found.sort(key=lambda x: _run_sort_key(*x))
    runs = []
    for run_dir, info in found:
        ext = run_dir / "extracted"
        docs = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(ext.glob("*.json"))] if ext.is_dir() else []
        saved = {d["file"]: d for d in json.loads((run_dir / "decisions.json").read_text(encoding="utf-8"))}
        if docs and len(docs) == len(saved):
            runs.append({"id": run_dir.name, "dry_run": bool(info.get("dry_run")), "docs": docs, "saved": saved})
    return runs


def replay(ref, cfg, runs):
    """Decide every saved run again, in order, on a scratch register. Dry runs leave the scratch register as they
    found it, exactly as they did for real. Returns {run_id: [Decision, ...]}."""
    master, history, contracts = ref
    reg, out = ScratchRegister(), {}
    for run in runs:
        before = copy.deepcopy(reg.rows) if run["dry_run"] else None
        out[run["id"]] = Engine(master, history, contracts, reg, cfg, run["id"]).process_batch(copy.deepcopy(run["docs"]))
        if before is not None:
            reg.rows = before
    return out


def brief(dec) -> dict:
    """The parts of a decision a person compares: outcome, reasons, approvers, coding."""
    d = dec.as_dict() if hasattr(dec, "as_dict") else dec
    return {"file": d["file"], "decision": d["decision"], "codes": d.get("codes", []), "reasons": d.get("reasons", []),
            "info": d.get("info", []), "approvers": d.get("approvers", []), "confidence": d.get("confidence", ""),
            "vendor_name": d.get("vendor_name", ""), "bill_no": d.get("bill_no", ""), "amount": str(d.get("amount", "")),
            "category": d.get("category", ""), "system": d.get("system", ""),
            "lines": [{k: str(v) for k, v in (l.items() if isinstance(l, dict) else [])} for l in d.get("lines", [])][:20]}


def _same(a, b):
    """Whether two decisions agree on what a person would notice: outcome, codes and approvers."""
    return (a["decision"], a["codes"], a["approvers"]) == (b["decision"], b["codes"], b["approvers"])


def simulate(ref, cfg_now, cfg_draft, runs):
    """What the draft rules would change, document by document, compared with the current rules on the same readings."""
    now, draft = replay(ref, cfg_now, runs), replay(ref, cfg_draft, runs)
    changes, total, drift = [], 0, 0
    for run in runs:
        for a, b in zip(now[run["id"]], draft[run["id"]]):
            total += 1
            ba, bb = brief(a), brief(b)
            saved = run["saved"].get(a.file)
            if saved and not _same(ba, brief(saved)):
                drift += 1
            if not _same(ba, bb):
                changes.append({"run_id": run["id"], "doc_id": Path(a.file).stem, "before": ba, "after": bb})
    return {"runs": len(runs), "documents": total, "changes": changes, "differs_from_saved": drift,
            "rules_now": fingerprint(cfg_now), "rules_draft": fingerprint(cfg_draft)}


def recheck(ref, cfg, register_rows, doc, run_id="RECHECK"):
    """Decide one document as Penny's next run would, against a copy of the register. Nothing is saved."""
    master, history, contracts = ref
    dec = Engine(master, history, contracts, ScratchRegister(register_rows), cfg, run_id).decide(copy.deepcopy(doc))
    return {**brief(dec), "trail": dec.as_dict().get("trail", [])}
