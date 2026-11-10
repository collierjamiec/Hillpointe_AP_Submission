"""Command line entry point.

  python -m ap_workflow run  --package <package folder> --batch <folder of PDFs> --run-id <name>
  python -m ap_workflow demo --package <package folder>          (resets state, runs Batch 01, rerun, Batch 02)
  python -m ap_workflow status                                   (shows the register)
  python -m ap_workflow explain APINBOX_0003 --run-id run1_batch01   (every check that ran, pass or fail)
"""
import argparse
import json
import os
import re
import shutil
import sys
import textwrap
from datetime import datetime
from collections import Counter
from pathlib import Path

from .extract import validate_extraction
from .llm_extract import extract
from .outputs import (INTACCT_COLS, ENTRATA_COLS, EXC_COLS, intacct_rows, entrata_rows, fmt_intacct, validate_intacct,
                      write_csv, write_workbook, write_run_report, exception_rows, entered_rows)
from .reference import load_package
from .register import Register
from .rules import Engine, HOLD, DUP, SKIP, ENTER_INTACCT, ENTER_ENTRATA
from .util import sha256_file

ROOT = Path(__file__).resolve().parent.parent
CFG_PATH = ROOT / "config" / "rules.json"


def find_package(arg):
    cands = [arg] if arg else []
    cands += [ROOT / "Hillpointe_AP_Technical_Screen", ROOT.parent / "Hillpointe_AP_Technical_Screen", Path.cwd() / "Hillpointe_AP_Technical_Screen"]
    for c in cands:
        if c and (Path(c) / "02_Reference_Data").exists():
            return Path(c)
    sys.exit("Package folder not found. Pass --package <path to Hillpointe_AP_Technical_Screen>.")


BATCH_SHORTCUTS = {"1": "01_Invoice_Batch_01", "2": "07_Invoice_Batch_02_Rerun"}


def resolve_batch(package, arg):
    """Accept a folder path, or the shortcuts 1 and 2 for the two assessment batches."""
    if arg in BATCH_SHORTCUTS:
        return Path(package) / BATCH_SHORTCUTS[arg]
    return Path(arg)


def latest_run(out_dir):
    runs = [p for p in Path(out_dir).glob("*/decisions.json")]
    if not runs:
        sys.exit("No runs yet. Run one first, for example: python3 ap.py run 1")
    return max(runs, key=lambda p: p.stat().st_mtime).parent.name


BATCH_SHORTCUTS = {"1": "01_Invoice_Batch_01", "2": "07_Invoice_Batch_02_Rerun"}


def resolve_batch(package, arg):
    """Accept a folder path, or the shortcuts 1 and 2 for the two assessment batches."""
    if arg in BATCH_SHORTCUTS:
        return Path(package) / BATCH_SHORTCUTS[arg]
    return Path(arg)


def latest_run(out_dir):
    runs = list(Path(out_dir).glob("*/decisions.json"))
    if not runs:
        sys.exit("No runs yet. Try:  ./penny run 1")
    return max(runs, key=lambda p: p.stat().st_mtime).parent.name


def check(state_dir):
    """Confirm Penny is ready: Python, libraries, assessment package, register."""
    import openpyxl
    import pdfplumber
    print(f"  OK  Python {sys.version.split()[0]}")
    print(f"  OK  pdfplumber {getattr(pdfplumber, '__version__', '')} and openpyxl {openpyxl.__version__}")
    try:
        pkg = find_package(None)
        print(f"  OK  Assessment package found: {pkg.name}")
    except SystemExit:
        print("  --  Assessment package not found yet. That is fine: add --package <path> when you run, or put the folder next to this one.")
    print(f"  OK  Register holds {len(Register(state_dir).rows)} entries")
    print("\nPenny is ready. Try:  ./penny run 1")


def run_tests(package):
    """Run the automated checks with the same Python Penny is using."""
    import subprocess
    env = dict(os.environ)
    if package:
        env["HILLPOINTE_PACKAGE"] = str(package)
    sys.exit(subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests"], cwd=ROOT, env=env).returncode)


def reset(state_dir, out_dir):
    """Start fresh: forget what was entered and clear old run folders."""
    for f in ("processed_register.csv", "run_log.csv"):
        (Path(state_dir) / f).unlink(missing_ok=True)
    if Path(out_dir).exists():
        shutil.rmtree(out_dir)
    print("Register and old runs cleared. The next run starts fresh.")


def run(package, batch, run_id, state_dir, out_dir, extractor="rules", dry_run=False, quiet=False):
    cfg = json.loads(CFG_PATH.read_text(encoding="utf-8"))
    master, history, contracts = load_package(package)
    reg = Register(state_dir)
    engine = Engine(master, history, contracts, reg, cfg, run_id)

    pdfs = sorted(Path(batch).glob("*.pdf")) if Path(batch).is_dir() else [Path(batch)]
    out = Path(out_dir) / run_id
    (out / "extracted").mkdir(parents=True, exist_ok=True)
    try:
        batch_dir = Path(batch).resolve().relative_to(ROOT.resolve()).as_posix()    # never an absolute path from this computer
    except ValueError:
        batch_dir = ""
    (out / "run_info.json").write_text(json.dumps({"run_id": run_id, "batch": Path(batch).name, "batch_dir": batch_dir, "extractor": extractor, "dry_run": dry_run,
                                                   "started_at": datetime.now().astimezone().isoformat(timespec="seconds")}, indent=2), encoding="utf-8")
    docs = []
    for p in pdfs:
        d = extract(p, cfg, extractor)
        (out / "extracted" / f"{p.stem}.json").write_text(json.dumps({k: v for k, v in d.items() if k != "raw_text"}, indent=2, default=str), encoding="utf-8")
        docs.append(d)

    decisions = engine.process_batch(docs)
    priority, routes = cfg["code_priority"], cfg["routes"]

    irows = intacct_rows(decisions)
    errs = validate_intacct(irows, master, cfg)
    counts = Counter(d.status for d in decisions)
    counts = dict(sorted(counts.items()))

    write_csv(out / "intacct_bill_import.csv", INTACCT_COLS, [fmt_intacct(r) for r in irows])
    write_csv(out / "entrata_handoff.csv", ENTRATA_COLS, [{**r, "Invoice Date": r["Invoice Date"].strftime("%m/%d/%Y"), "Due Date": r["Due Date"].strftime("%m/%d/%Y"),
                                                         "Amount": f"{r['Amount']:.2f}"} for r in entrata_rows(decisions)])
    write_csv(out / "exception_log.csv", EXC_COLS, [{**r, "Amount": f"{r['Amount']:.2f}"} for r in exception_rows(decisions, priority, routes)])
    er = entered_rows(decisions)
    if er:
        write_csv(out / "approvals_for_entered_bills.csv", list(er[0].keys()), [{**r, "Bill Total": f"{r['Bill Total']:.2f}"} for r in er])
    write_workbook(out / "review_workbook.xlsx", decisions, master, priority, routes, run_id)
    (out / "decisions.json").write_text(json.dumps([d.as_dict() for d in decisions], indent=2), encoding="utf-8")

    state_info = (f"Register: `{Path(state_dir).name}/processed_register.csv`. Entered keys now on file: {len(reg.entered())}. "
                  f"{'DRY RUN: register was not saved.' if dry_run else 'Register saved.'}")
    write_run_report(out / "run_report.md", run_id, Path(batch).name, decisions, errs, counts, state_info)

    log = [{"run_id": run_id, "source_file": d.file, "file_sha256": d.doc["sha256"], "decision": d.status, "codes": ";".join(d.codes),
            "vendor_id": d.vendor_id, "bill_no": d.bill_no, "amount": d.amount,
            "detail": (" ".join(d.reasons) or " ".join(d.info))[:300]} for d in decisions]
    if errs:
        (out / "PREFLIGHT_FAILED.txt").write_text("\n".join(errs), encoding="utf-8")
    elif not dry_run:
        reg.save()
        reg.append_log(log)
    if not quiet:
        summarize(run_id, decisions, counts, errs, irows, routes, priority)
    return decisions, errs


def _style(text, code):
    """Color only when printing to a real terminal (and NO_COLOR is not set)."""
    if sys.stdout.isatty() and not os.environ.get("NO_COLOR"):
        return f"\033[{code}m{text}\033[0m"
    return text


def _wrap(label, text, width):
    """Label in a fixed left column, text wrapped underneath itself."""
    return textwrap.fill(text, width=width, initial_indent="    " + f"{label:<10}", subsequent_indent=" " * 14)


def short_why(d):
    """Plain-language reason lines: (code, text) for holds and duplicates."""
    out = []
    for r in d.reasons:
        code, _, text = r[1:].partition("] ")
        first = re.split(r"(?<=[a-z\)])\.\s", text, maxsplit=1)[0].rstrip(".")
        out.append((code, textwrap.shorten(first, width=480, placeholder=" ...")))
    return out


def summarize(run_id, decisions, counts, errs, irows, routes=None, priority=None):
    routes, priority = routes or {}, priority or []
    width = min(shutil.get_terminal_size((100, 20)).columns, 100) - 2
    rule = "-" * width
    print(f"\n{_style('PENNY', '1')}  run: {run_id}")
    print(rule)
    badge = {ENTER_INTACCT: ("ENTER Intacct", "32"), ENTER_ENTRATA: ("ENTER Entrata", "32"), HOLD: ("HOLD", "31"),
             DUP: ("DUPLICATE", "33"), SKIP: ("SKIP", "2")}
    for d in decisions:
        label, color = badge[d.status]
        vendor = d.vendor_name or d.doc.get("vendor_name_raw") or ("(could not read file)" if d.doc.get("kind") == "unreadable" else "")
        print(f"\n{_style(f'{label:<13}', color + ';1')}  {d.file}   {vendor}")
        if d.doc.get("kind") != "unreadable":
            print(_wrap("Invoice:", f"{d.bill_no}   ${d.amount:,.2f}", width))
        if d.status == SKIP:
            print(_wrap("Why:", "This exact file was already entered in an earlier run, so nothing is done. That is what makes a rerun safe.", width))
        elif d.status in (ENTER_INTACCT, ENTER_ENTRATA):
            note = f" {len(d.info)} note{'s' if len(d.info) > 1 else ''} for a person to review (see the approvals file)." if d.info else ""
            print(_wrap("Why:", "All checks passed." + note, width))
        else:
            for code, text in short_why(d):
                print(_wrap(code, text, width))
            primary = next((c for c in priority if c in d.codes), d.codes[0] if d.codes else "OTHER")
            if routes.get(primary):
                print(_wrap("Send to:", routes[primary], width))
    print("\n" + rule)
    e = counts.get(ENTER_INTACCT, 0)
    print(_style("SUMMARY", "1") + f"   {e} to Intacct   {counts.get(ENTER_ENTRATA, 0)} to Entrata   "
          f"{counts.get(HOLD, 0)} held   {counts.get(DUP, 0)} duplicates   {counts.get(SKIP, 0)} skipped")
    print(f"          Intacct import rows written: {len(irows)}   Pre-flight check: {'PASS' if not errs else 'FAIL (' + str(len(errs)) + ' errors)'}")
    unreadable = [d for d in decisions if d.doc.get("kind") == "unreadable"]
    if unreadable:
        print(_style(f"          {len(unreadable)} file{'s' if len(unreadable) > 1 else ''} could not be read and {'were' if len(unreadable) > 1 else 'was'} held. "
                     "The rest of the batch was processed normally:", "31"))
        for d in unreadable:
            print(textwrap.fill(d.doc["unreadable_reason"], width=width, initial_indent=f"      {d.file}: ", subsequent_indent=" " * 8))
    for err in errs:
        print("    !", err)
    print()


def demo(package, state_dir, out_dir):
    state_dir, out_dir = Path(state_dir), Path(out_dir)
    for p in (state_dir / "processed_register.csv", state_dir / "run_log.csv"):
        if p.exists():
            p.unlink()
    if out_dir.exists():
        shutil.rmtree(out_dir)
    b1, b2 = package / "01_Invoice_Batch_01", package / "07_Invoice_Batch_02_Rerun"
    run(package, b1, "run1_batch01", state_dir, out_dir)
    run(package, b1, "run2_batch01_RERUN", state_dir, out_dir)
    run(package, b2, "run3_batch02", state_dir, out_dir)
    # one more proof: run batch 02 again
    run(package, b2, "run4_batch02_RERUN", state_dir, out_dir)
    from . import evidence
    evidence.build(out_dir, state_dir)
    print(f"\nEvidence written to {out_dir / 'RERUN_EVIDENCE.md'}")


def explain(out_dir, run_id, doc_id):
    run_id = run_id or latest_run(out_dir)
    if doc_id.isdigit():
        doc_id = doc_id.zfill(4)
    path = Path(out_dir) / run_id / "decisions.json"
    if not path.exists():
        sys.exit(f"No decisions.json for run {run_id} in {out_dir}")
    for d in json.loads(path.read_text()):
        if doc_id.lower() in d["file"].lower():
            print(f"\n{d['file']}  {d['vendor_name']}  {d['bill_no']}  ${d['amount']}  ->  {d['decision']}  {', '.join(d['codes'])}  (confidence {d['confidence']})")
            for t in d["trail"]:
                print("  " + t)
            for i in d["info"]:
                print("  NOTE  " + i)
            if d["approvers"]:
                print("  APPROVERS: " + "; ".join(d["approvers"]))


def web_export(package, out_dir, web_dir):
    from . import webexport
    r = webexport.build(out_dir, CFG_PATH, Path(web_dir) / "data", package, root=ROOT, batch_log=ROOT / "state" / "batch_log.jsonl")
    print(f"Packaged {r['runs']} runs, {r['documents']} invoices and {r['results']} results for the web view.")
    print(f"  Data: {r['path']}")
    if package:
        print(f"  Invoice PDFs copied from the package: {r['pdfs_copied']}")
    missing = r["pdfs_missing"]
    if missing:
        print(f"  {len(missing)} PDF{'s' if len(missing) > 1 else ''} not found, so {'those pages show' if len(missing) > 1 else 'that page shows'} "
              f"everything except the original: {', '.join(missing)}")
        print(f"  To add them, copy the files into {Path(web_dir) / 'data' / 'pdfs'} and run ./penny web-export again.")
    else:
        print("  Every invoice has its PDF.")
    print("Next:  ./penny web")


def serve_web(web_dir, port, package=None, state_dir=None, out_dir=None, open_browser=True):
    """Serve the web app on this computer, with the batch upload and run API (see webserver.py)."""
    from .webserver import BatchService, serve
    web_dir = Path(web_dir)
    if not (web_dir / "data" / "penny-data.json").exists():
        sys.exit("No web data yet. Run this first:  ./penny web-export --package <package folder>")
    service = BatchService(ROOT, package, state_dir or ROOT / "state", out_dir or ROOT / "runs", web_dir, CFG_PATH)
    serve(service, web_dir, port, open_browser)


def status(state_dir):
    reg = Register(state_dir)
    print(f"{len(reg.rows)} keys in {reg.path}")
    for k, r in sorted(reg.rows.items()):
        print(f"  {r['status']:<10} {k:<42} {r['source_file']:<18} {r['amount']:>12} first run {r['first_run']}")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="penny", description="Penny: reads vendor invoices, applies the AP rules, and tells you what to enter and what to hold.",
                                 epilog="First time:  ./penny install   |   Examples:  ./penny run 1   |   ./penny run ~/Desktop/new_invoices -n   |   ./penny explain 6   |   ./penny status   |   ./penny test   |   ./penny reset   |   ./penny demo")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("batch", nargs="?", help="folder of PDFs, or 1 or 2 for the assessment batches")
    r.add_argument("--batch", dest="batch_opt"); r.add_argument("--package"); r.add_argument("--run-id", "-r", help="name for this run (default: batch name plus the time)")
    r.add_argument("--state", default=str(ROOT / "state")); r.add_argument("--out", default=str(ROOT / "runs"))
    r.add_argument("--extractor", choices=["rules", "llm", "hybrid"], default="rules")
    r.add_argument("--dry-run", "-n", action="store_true", help="evaluate everything but do not touch the register")
    d = sub.add_parser("demo")
    d.add_argument("--package"); d.add_argument("--state", default=str(ROOT / "state")); d.add_argument("--out", default=str(ROOT / "runs"))
    e = sub.add_parser("explain")
    e.add_argument("doc", help="file name or just the number, like 6"); e.add_argument("--run-id", "-r", help="default: the most recent run"); e.add_argument("--out", default=str(ROOT / "runs"))
    c = sub.add_parser("check", help="confirm Penny is ready to run")
    c.add_argument("--state", default=str(ROOT / "state"))
    t = sub.add_parser("test", help="run the 49 automated checks")
    t.add_argument("--package")
    z = sub.add_parser("reset", help="clear the register and old runs")
    z.add_argument("--state", default=str(ROOT / "state")); z.add_argument("--out", default=str(ROOT / "runs"))
    w = sub.add_parser("web-export", help="package finished runs (and invoice PDFs) for the web view")
    w.add_argument("--package", help="assessment package folder, to include the invoice PDFs"); w.add_argument("--out", default=str(ROOT / "runs"))
    w.add_argument("--web", default=str(ROOT / "web"))
    v = sub.add_parser("web", help="open the web app in your browser (add --package to run new batches from it)")
    v.add_argument("--web", default=str(ROOT / "web")); v.add_argument("--port", type=int, default=8765)
    v.add_argument("--package"); v.add_argument("--state", default=str(ROOT / "state")); v.add_argument("--out", default=str(ROOT / "runs"))
    s = sub.add_parser("status")
    s.add_argument("--state", default=str(ROOT / "state"))
    a = ap.parse_args(argv)
    if a.cmd == "run":
        pkg = find_package(a.package)
        batch_arg = a.batch_opt or a.batch
        if not batch_arg:
            sys.exit("Which folder? Example: python3 ap.py run 1   or   python3 ap.py run path/to/pdfs")
        batch = resolve_batch(pkg, batch_arg)
        if not batch.exists():
            sys.exit(f"Folder not found: {batch}")
        run_id = a.run_id or f"{batch.stem}_{datetime.now().strftime('%H%M%S')}"
        run(pkg, batch, run_id, a.state, a.out, a.extractor, a.dry_run)
    elif a.cmd == "demo":
        demo(find_package(a.package), a.state, a.out)
    elif a.cmd == "explain":
        explain(a.out, a.run_id, a.doc)
    elif a.cmd == "check":
        check(a.state)
    elif a.cmd == "test":
        run_tests(a.package)
    elif a.cmd == "reset":
        reset(a.state, a.out)
    elif a.cmd == "web-export":
        pkg_arg = a.package or os.environ.get("HILLPOINTE_PACKAGE")
        web_export(find_package(pkg_arg) if pkg_arg else None, a.out, a.web)
    elif a.cmd == "web":
        pkg_arg = a.package or os.environ.get("HILLPOINTE_PACKAGE")
        serve_web(a.web, a.port, find_package(pkg_arg) if pkg_arg else None, a.state, a.out)
    elif a.cmd == "status":
        status(a.state)


if __name__ == "__main__":
    main()
