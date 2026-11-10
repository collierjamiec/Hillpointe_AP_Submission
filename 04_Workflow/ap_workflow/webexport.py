"""Package finished runs for Penny's web view.

  ./penny web-export --package <package folder>

Reads every runs/<run-id>/decisions.json and extracted/*.json, plus config/rules.json, and writes one file the
browser reads: web/data/penny-data.json. With --package, the invoice PDFs are copied into web/data/pdfs/ so the
web view can show each invoice beside what Penny read from it.

The web view only displays what Penny already decided. It never makes a decision of its own, so the terminal and
the browser can never disagree.
"""
import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from .register import make_key
from .util import norm_name

RUN_ORDER = re.compile(r"^run(\d+)_")

# Files a run writes that a person downloads. What each one is (and is not) is spelled out in the web view.
RUN_FILES = ["intacct_bill_import.csv", "entrata_handoff.csv", "exception_log.csv", "approvals_for_entered_bills.csv",
             "review_workbook.xlsx", "run_report.md"]


def _copy_if_changed(src, dest):
    """Copy a file unless the destination already has the same size and modified time (copy2 keeps the time).
    After a run, only that run's files are new, so the rest of the web data is left alone."""
    try:
        a, b = src.stat(), dest.stat()
        if a.st_size == b.st_size and int(a.st_mtime) == int(b.st_mtime):
            return False
    except OSError:
        pass
    shutil.copy2(src, dest)
    return True


def _copy_run_files(run_dir, out_dir):
    """Copy a run's downloadable files into the web data folder and describe each one."""
    dest = out_dir / "runs" / run_dir.name
    files = []
    for name in RUN_FILES:
        src = run_dir / name
        if not src.exists():
            continue
        dest.mkdir(parents=True, exist_ok=True)
        _copy_if_changed(src, dest / name)
        rows = None
        if name.endswith(".csv"):
            with open(src, encoding="utf-8") as f:
                rows = max(sum(1 for line in f if line.strip()) - 1, 0)
        files.append({"name": name, "path": f"data/runs/{run_dir.name}/{name}", "rows": rows, "bytes": src.stat().st_size,
                      "sha256": hashlib.sha256(src.read_bytes()).hexdigest()})       # so export history can name the exact file
    return files


def _run_sort_key(run_dir, info):
    """Numbered runs (run1_, run2_ ...) first, in number order; any other run by when it started."""
    m = RUN_ORDER.match(run_dir.name)
    return (0, int(m.group(1)), "", run_dir.name) if m else (1, 0, info.get("started_at", ""), run_dir.name)


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


def _label(run_id, batch, seen_before):
    """A short, readable name for a run.
    'run3_batch02' -> 'Batch 02', 'run2_batch01_RERUN' -> 'Batch 01 rerun'.
    Runs named by ./penny run (batch folder plus the time, like '01_Invoice_Batch_01_111817') are named after the
    batch folder: 'Invoice Batch 01', with 'rerun' added when an earlier run read the same folder."""
    m = re.match(r"^run\d+_batch(\d+)(_RERUN)?$", run_id, re.I)
    if m:
        return f"Batch {m.group(1)}" + (" rerun" if m.group(2) else "")
    name = batch or re.sub(r"_\d{6}$", "", run_id)
    name = re.sub(r"^\d+[_ -]+", "", name).replace("_", " ").replace("-", " ").strip()
    name = (name[:1].upper() + name[1:]) if name else run_id
    return name + (" rerun" if seen_before else "")


def build(runs_dir, cfg_path, out_dir, package=None, root=None, batch_log=None):
    """Write web/data/penny-data.json from every saved run, and copy the files and invoice PDFs the web app links to."""
    runs_dir, out_dir = Path(runs_dir), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf_dir = out_dir / "pdfs"
    runs, results, documents = [], [], {}
    copied, missing = 0, []

    found = [(p.parent, _run_info(p.parent)) for p in runs_dir.glob("*/decisions.json")]
    found.sort(key=lambda x: _run_sort_key(*x))
    batches_seen = set()
    for order, (run_dir, info) in enumerate(found, start=1):
        run_id = run_dir.name
        batch = info.get("batch", "")
        seen_before = bool(batch) and batch in batches_seen
        batches_seen.add(batch)
        decisions = json.loads((run_dir / "decisions.json").read_text(encoding="utf-8"))
        runs.append({"id": run_id, "order": order, "label": info.get("label") or _label(run_id, batch, seen_before),
                     "batch": batch, "started_at": info.get("started_at", ""),
                     "dry_run": bool(info.get("dry_run", False)), "rerun": "RERUN" in run_id.upper() or seen_before,
                     "ran_by": info.get("ran_by"), "batch_dir": info.get("batch_dir", ""), "penny_version": info.get("penny_version"),
                     "preflight_failed": (run_dir / "PREFLIGHT_FAILED.txt").exists(), "documents": len(decisions),
                     "files": _copy_run_files(run_dir, out_dir)})
        for d in decisions:
            doc_id = Path(d["file"]).stem
            vid = d.get("vendor_id") or "UNKNOWN:" + norm_name(d.get("vendor_name", ""))
            results.append({"run_id": run_id, "doc_id": doc_id, "key": make_key(vid, d.get("bill_no", ""), d.get("doc_type", "Bill")), **d})
            ext_path = run_dir / "extracted" / f"{doc_id}.json"
            extracted = json.loads(ext_path.read_text(encoding="utf-8")) if ext_path.exists() else {}
            if doc_id in documents:          # read again in a later run: show the newest reading
                if extracted:
                    documents[doc_id]["extracted"] = extracted
                continue
            pdf = None
            src = Path(package) / batch / d["file"] if package and batch else None
            if (not src or not src.exists()) and root and info.get("batch_dir"):
                src = Path(root) / info["batch_dir"] / d["file"]          # a batch uploaded through the web app
            if src and src.exists():
                pdf_dir.mkdir(exist_ok=True)
                _copy_if_changed(src, pdf_dir / d["file"])
                pdf, copied = f"data/pdfs/{d['file']}", copied + 1
            elif (pdf_dir / d["file"]).exists():          # copied earlier, or placed there by hand
                pdf = f"data/pdfs/{d['file']}"
            else:
                missing.append(d["file"])
            documents[doc_id] = {"id": doc_id, "file": d["file"], "pdf": pdf, "extracted": extracted}

    cfg = json.loads(Path(cfg_path).read_text(encoding="utf-8"))
    log = []
    if batch_log and Path(batch_log).exists():
        log = [json.loads(line) for line in Path(batch_log).read_text(encoding="utf-8").splitlines() if line.strip()]
    data = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "runs": runs,
            "results": results, "documents": documents, "rules": cfg, "batch_log": log}
    (out_dir / "penny-data.json").write_text(json.dumps(data, indent=1, default=str), encoding="utf-8")
    return {"runs": len(runs), "documents": len(documents), "results": len(results), "pdfs_copied": copied,
            "pdfs_missing": missing, "path": out_dir / "penny-data.json"}
