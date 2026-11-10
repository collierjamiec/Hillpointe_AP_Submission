"""Package finished runs for Penny's web view.

  ./penny web-export --package <package folder>

Reads every runs/<run-id>/decisions.json and extracted/*.json, plus config/rules.json, and writes one file the
browser reads: web/data/penny-data.json. With --package, the invoice PDFs are copied into web/data/pdfs/ so the
web view can show each invoice beside what Penny read from it.

The web view only displays what Penny already decided. It never makes a decision of its own, so the terminal and
the browser can never disagree.
"""
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from .register import make_key
from .util import norm_name

RUN_ORDER = re.compile(r"^run(\d+)_")


def _run_sort_key(run_dir):
    m = RUN_ORDER.match(run_dir.name)
    return (int(m.group(1)) if m else 10**6, run_dir.name)


def _run_info(run_dir):
    """Batch folder and start time. Newer runs write run_info.json; older ones only have run_report.md."""
    info_path = run_dir / "run_info.json"
    if info_path.exists():
        return json.loads(info_path.read_text(encoding="utf-8"))
    info = {"batch": "", "started_at": ""}
    report = run_dir / "run_report.md"
    if report.exists():
        m = re.search(r"Batch folder: `([^`]*)`", report.read_text(encoding="utf-8"))
        if m:
            info["batch"] = m.group(1)
    return info


def _label(run_id, batch):
    """'run3_batch02' -> 'Batch 02', 'run2_batch01_RERUN' -> 'Batch 01 rerun'. Custom names are kept as they are."""
    m = re.match(r"^run\d+_batch(\d+)(_RERUN)?$", run_id, re.I)
    if m:
        return f"Batch {m.group(1)}" + (" rerun" if m.group(2) else "")
    return run_id.replace("_", " ")


def build(runs_dir, cfg_path, out_dir, package=None):
    runs_dir, out_dir = Path(runs_dir), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf_dir = out_dir / "pdfs"
    runs, results, documents = [], [], {}
    copied = missing = 0

    run_dirs = sorted((p.parent for p in runs_dir.glob("*/decisions.json")), key=_run_sort_key)
    for order, run_dir in enumerate(run_dirs, start=1):
        info = _run_info(run_dir)
        run_id = run_dir.name
        decisions = json.loads((run_dir / "decisions.json").read_text(encoding="utf-8"))
        runs.append({"id": run_id, "order": order, "label": info.get("label") or _label(run_id, info.get("batch", "")),
                     "batch": info.get("batch", ""), "started_at": info.get("started_at", ""),
                     "dry_run": bool(info.get("dry_run", False)), "rerun": "RERUN" in run_id.upper(),
                     "preflight_failed": (run_dir / "PREFLIGHT_FAILED.txt").exists(), "documents": len(decisions)})
        for d in decisions:
            doc_id = Path(d["file"]).stem
            vid = d.get("vendor_id") or "UNKNOWN:" + norm_name(d.get("vendor_name", ""))
            results.append({"run_id": run_id, "doc_id": doc_id, "key": make_key(vid, d.get("bill_no", ""), d.get("doc_type", "Bill")), **d})
            if doc_id in documents:
                continue
            ext_path = run_dir / "extracted" / f"{doc_id}.json"
            extracted = json.loads(ext_path.read_text(encoding="utf-8")) if ext_path.exists() else {}
            pdf = None
            if package and info.get("batch"):
                src = Path(package) / info["batch"] / d["file"]
                if src.exists():
                    pdf_dir.mkdir(exist_ok=True)
                    shutil.copy2(src, pdf_dir / d["file"])
                    pdf, copied = f"data/pdfs/{d['file']}", copied + 1
                else:
                    missing += 1
            elif (pdf_dir / d["file"]).exists():          # copied by an earlier export
                pdf = f"data/pdfs/{d['file']}"
            documents[doc_id] = {"id": doc_id, "file": d["file"], "pdf": pdf, "extracted": extracted}

    cfg = json.loads(Path(cfg_path).read_text(encoding="utf-8"))
    data = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "runs": runs,
            "results": results, "documents": documents, "rules": cfg}
    (out_dir / "penny-data.json").write_text(json.dumps(data, indent=1, default=str), encoding="utf-8")
    return {"runs": len(runs), "documents": len(documents), "results": len(results), "pdfs_copied": copied,
            "pdfs_missing": missing, "path": out_dir / "penny-data.json"}
