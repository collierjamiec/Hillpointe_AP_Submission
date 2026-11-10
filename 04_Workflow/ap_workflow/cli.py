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
    """The assessment package folder: the --package argument, HILLPOINTE_PACKAGE, or a folder next to this one."""
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


def saved_log(state_dir):
    """The server's audit log for the web export: from the database (v2.0), else the log file from before 2.0."""
    state_dir = Path(state_dir)
    if (state_dir / "penny.db").exists():
        from .store import Store
        return [{k: v for k, v in e.items() if k not in ("seq", "origin")} for e in Store(state_dir).events(origins=("server",))]
    return state_dir / "batch_log.jsonl"


def latest_run(out_dir):
    """The name of the most recently written run folder."""
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
    """Run Penny on one folder of PDFs: read, decide, write every output file, pre-flight the import file, and
    save the register unless this is a dry run or the pre-flight failed. Returns (decisions, pre-flight errors)."""
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
    from .version import current as penny_version
    (out / "run_info.json").write_text(json.dumps({"run_id": run_id, "batch": Path(batch).name, "batch_dir": batch_dir, "extractor": extractor, "dry_run": dry_run,
                                                   "penny_version": penny_version(),
                                                   "started_at": datetime.now().astimezone().isoformat(timespec="seconds")}, indent=2), encoding="utf-8")
    docs = []
    keyed = {p.name[:-len(".keyed.json")]: p for p in Path(batch).glob("*.keyed.json")} if Path(batch).is_dir() else {}
    for p in pdfs:
        d = read_keyed(keyed[p.stem], p) if p.stem in keyed else extract(p, cfg, extractor)
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


def read_keyed(keyed_path, pdf_path):
    """(added after submission, v1.5) A manual entry saved from the web app, used in place of reading the PDF.
    It must have been keyed from this exact file: if the fingerprints differ, the file is held instead."""
    from .extract import unreadable_doc
    from .util import sha256_file
    try:
        d = json.loads(Path(keyed_path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return unreadable_doc(pdf_path, f"The manual entry {Path(keyed_path).name} could not be read ({e}).")
    if d.get("sha256") != sha256_file(pdf_path) or (d.get("extraction") or {}).get("method") != "manual":
        return unreadable_doc(pdf_path, f"The manual entry {Path(keyed_path).name} was not keyed from this file "
                                        "(the fingerprints differ). Key it again from this file.")
    d["file"] = pdf_path.name
    return d


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
    """Print the run to the terminal: one block per document, then the totals."""
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
    """Start fresh, then run Batch 01, a rerun, Batch 02 and a rerun, and build the rerun evidence."""
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
    """Print every check for one document in a run."""
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
    """Package the saved runs and invoice PDFs for the web app."""
    from . import webexport
    r = webexport.build(out_dir, CFG_PATH, Path(web_dir) / "data", package, root=ROOT, batch_log=saved_log(ROOT / "state"))
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


def make_cert(state_dir, hosts):
    """(added after submission, v2.0) Make a self-signed certificate for https in state/tls/, using openssl.
    Browsers warn about a self-signed certificate the first time; a certificate from your IT team avoids that."""
    from . import setup
    hosts = hosts or ["localhost"]
    try:
        cert, key = setup.make_certificate(state_dir, hosts)
    except setup.SetupError as e:
        sys.exit(str(e))
    print(f"Made a certificate for {', '.join(hosts)}, good for one year:\n  {cert}\n  {key}  (keep this one private)")
    print("Start Penny for your team with:  ./penny web --host 0.0.0.0 --https")


def setup_wizard(web_dir, port, state_dir, out_dir, open_browser=True):
    """(added after submission, v2.1) Open the setup wizard in the browser. It runs on this computer only, and
    only this run's one-time key (in the address the browser is opened with) can use it. See setup.py."""
    import secrets
    import webbrowser
    from .webserver import BatchService, make_server
    web_dir = Path(web_dir)
    if not (web_dir / "setup.html").exists():
        sys.exit("The setup wizard's page is missing (web/setup.html). Update Penny with ./penny update.")
    service = BatchService(ROOT, None, state_dir, out_dir, web_dir, CFG_PATH)
    service.setup_key = secrets.token_urlsafe(24)
    try:
        httpd = make_server(service, web_dir, port)
    except OSError:
        sys.exit(f"Port {port} is in use. If Penny is already running, stop it first (Ctrl+C in its window), or use:  ./penny setup --port 8770")
    url = f"http://127.0.0.1:{httpd.server_address[1]}/setup.html#key={service.setup_key}"
    print("Penny setup wizard\n")
    print(f"  Opening your browser. If it does not open, copy this address into it:\n  {url}\n")
    print("  Leave this window open while you use the wizard. Press Ctrl+C here when you are done.")
    if open_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nSetup closed. Start Penny any time with:  ./penny start")
    finally:
        httpd.server_close()


def start(web_dir, state_dir, out_dir, open_browser=True):
    """(added after submission, v2.1) Start Penny the way the setup wizard was told to: with the invoice package,
    the watched folder and the network choice saved in state/setup.json."""
    from . import setup
    choices = setup.load(state_dir)
    if not choices["done"]:
        print("Penny has not been set up yet, so it starts with the example data on this computer only.\nTo set it up:  ./penny setup\n")
    package = None
    if choices["package"]:
        found = setup.check_package(choices["package"])
        if found["ok"]:
            package = Path(found["path"])
        else:
            print(f"The invoice package saved by setup is no longer at {choices['package']}, so new batches cannot be read.\nTo choose it again:  ./penny setup\n")
    serve_web(web_dir, choices["port"], package, state_dir, out_dir, open_browser, watch="" if choices["watch"] else None,
              host=choices["host"], https=choices["https"])


def serve_web(web_dir, port, package=None, state_dir=None, out_dir=None, open_browser=True, watch=None, host="127.0.0.1", cert=None, key=None,
              https=False, allow_http=False):
    """Serve the web app on this computer, with the batch upload and run API (see webserver.py)."""
    from .webserver import BatchService, serve
    web_dir = Path(web_dir)
    if not (web_dir / "data" / "penny-data.json").exists():
        sys.exit("No web data yet. Run this first:  ./penny web-export --package <package folder>")
    service = BatchService(ROOT, package, state_dir or ROOT / "state", out_dir or ROOT / "runs", web_dir, CFG_PATH)
    cfg = json.loads(CFG_PATH.read_text(encoding="utf-8")).get("watch") or {}
    if watch is not None or cfg.get("enabled"):          # --watch on the command line, or "enabled": true in rules.json
        from .watcher import Watcher
        service.watcher = Watcher(service, watch or cfg.get("folder"), cfg.get("every_seconds", 15))
    if https and not (cert and key):                     # --https: the certificate ./penny cert made
        tls = Path(state_dir or ROOT / "state") / "tls"
        cert, key = tls / "cert.pem", tls / "key.pem"
        if not (cert.exists() and key.exists()):
            sys.exit("No certificate yet. Make one first:  ./penny cert --host <this computer's name>")
    serve(service, web_dir, port, open_browser and host in ("127.0.0.1", "localhost"), host, cert, key, allow_http)


# ------------------------------------------------------------------ versions and updates (added after submission, v1.6)
USER_DATA = ("04_Workflow/state/", "04_Workflow/runs/", "04_Workflow/inbox/", "04_Workflow/web/data/")


def changed_code_files(porcelain):
    """Files a person changed in Penny's own code, from `git status --porcelain`. Their own data (the register, runs,
    uploaded batches and the web data) does not count, because an update never touches it."""
    out = []
    for line in porcelain.splitlines():
        path = line[3:].split(" -> ")[-1].strip('"')
        if line.startswith("??") or not path or path.startswith(USER_DATA):
            continue
        out.append(path)
    return out


def update_notice(state_dir, quiet=False):
    """A one-line notice before a command, and the status (used to pause real runs on a required update)."""
    from .version import check
    info = check(state_dir)
    if quiet:
        return info
    if info["state"] == "required":
        print(_style(f"Update required: Penny {info['minimum']} is out (this is {info['version']}). Real runs are paused until you run ./penny update. "
                     "Reading results, help and dry runs still work.", "33;1"))
    elif info["state"] == "optional":
        print(_style(f"Penny {info['latest']} is ready (this is {info['version']}). See what's new:  ./penny update --check   "
                     f"Update:  ./penny update   Skip it:  ./penny update --skip", "36"))
    return info


def update(state_dir, check_only=False, skip_it=False):
    """Show what is new and, unless only checking or skipping, update this copy from GitHub main."""
    import subprocess
    from .version import check, skip, current
    info = check(state_dir, force=True)
    if info["note"]:
        print(info["note"])
    print(f"This copy: Penny {info['version']}.  Newest: {info['latest']}." + (f"  Minimum allowed: {info['minimum']}." if info["minimum"] else ""))
    for r in info["newer"]:
        tag = "required" if r.get("required") else "optional"
        print(f"\n  {r['version']} ({tag}, {r.get('date', '')})  {r.get('summary', '')}")
        for n in r.get("notes", []):
            print(textwrap.fill(n, width=96, initial_indent="    - ", subsequent_indent="      "))
    if info["state"] == "current":
        print("\nYou are up to date.")
        return
    if skip_it:
        if info["state"] == "required":
            sys.exit(f"\n{info['minimum']} is required, so it cannot be skipped. Run:  ./penny update")
        skip(state_dir, info["latest"])
        print(f"\nSkipped {info['latest']}. Penny will remind you again when a newer version is out.")
        return
    if check_only:
        print("\nUpdate:  ./penny update" + ("" if info["state"] == "required" else "    Skip this version:  ./penny update --skip"))
        return
    repo = ROOT.parent
    if not (repo / ".git").exists():
        sys.exit("\nThis copy of Penny is not a git checkout, so it cannot update itself. Download the newest version from GitHub.")
    git = lambda *a: subprocess.run(["git", *a], cwd=repo, capture_output=True, text=True)
    mine = changed_code_files(git("status", "--porcelain").stdout)
    if mine:
        sys.exit("\nPenny's own files have changes on this computer, so the update was not started:\n  " + "\n  ".join(mine)
                 + "\nSave them somewhere else (or commit them), then run ./penny update again. Your register, runs and batches are never touched.")
    branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    if branch != "main":
        sys.exit(f"\nThis copy is on the branch {branch!r}, not main. Switch to main to take the published update:  git checkout main")
    print("\nUpdating from GitHub...")
    r = git("pull", "--ff-only", "origin", "main")
    if r.returncode != 0:
        sys.exit("The update did not finish, and nothing was changed:\n" + (r.stderr or r.stdout).strip())
    print(f"Updated to Penny {current()}. Checking everything works...\n")
    sys.exit(subprocess.run([sys.executable, str(ROOT / "ap.py"), "check"]).returncode)


def users_cmd(state_dir, action, email=None, name=None, role="viewer", title="", base="http://127.0.0.1:8765"):
    """(added after submission, v1.7) Manage people from the terminal. This is how the first Admin is created."""
    from .accounts import Accounts, AccountError
    from .webserver import BatchService
    svc = BatchService(ROOT, None, state_dir, ROOT / "runs", ROOT / "web", CFG_PATH)
    acc = svc.accounts
    if action == "list":
        people = acc.list()
        if not people:
            print("No accounts yet, so ./penny web uses the four demo accounts. Create the first Admin:\n"
                  '  ./penny users invite --email you@company.com --name "Your Name" --role admin')
        for u in people:
            print(f"  {u['status']:<9} {u['role']:<9} {u['email']:<34} {u['name']}")
        return
    try:
        user, token, hours = acc.invite(None, email, name, role, title, bootstrap=True)
    except AccountError as e:
        sys.exit(str(e))
    sent = svc.account_email("invite", user, token, hours, "The Penny administrator", base)
    print(f"Invited {user['name']} <{user['email']}> as {role}. Accounts are now on: ./penny web asks everyone to sign in.")
    if sent["status"] == "sent":
        print("The invitation was emailed. The link works once and expires in 72 hours.")
    else:
        print(f"Email is not set up ({sent['error'] or 'no PENNY_SMTP_HOST'}), so here is the link to open on this computer once ./penny web is running:")
        print(f"  {base}/#/activate?token={token}")


def email_cmd(state_dir, action, to=None):
    """(added after submission, v1.7) Check the mail settings, or send one test email and say what went wrong."""
    from .mailer import Outbox, settings, configured, explain
    if action == "status":
        print("Email settings (environment variables):")
        for k, v in settings().items():
            print(f"  {k:<20} {v or '(not set)'}")
        print("\nEmail is " + ("set up." if configured() else "not set up, so emails are saved to state/outbox/ instead of sent. See Help > Emailing exports."))
        return
    if not to:
        sys.exit("Example:  ./penny email test --to you@company.com")
    text = ("This is a test from Penny. If you can read it, Penny can send invitations, password resets, exports and "
            "approval requests through this mail account.\n\nPenny AP")
    try:
        entry = Outbox(state_dir).send([to], "Penny email test", text, {"id": "terminal", "name": "Terminal", "role": "admin"}, "test")
    except ValueError as e:
        sys.exit(str(e))
    if entry["status"] == "sent":
        print(f"Sent a test email to {to}. Check that inbox (or your Mailtrap test inbox).")
    elif entry["status"] == "saved":
        print("Email is not set up, so the test was saved to state/outbox/, not sent. Set PENNY_SMTP_HOST and the other "
              "settings (./penny email status shows them), then try again.")
    else:
        sys.exit(f"The test email failed: {entry['error']}\nWhat to check: {explain(entry['error'])}")


def publish_release(version, summary, notes, required):
    """Write a new release everywhere it lives and say what happens next."""
    from .version import release, VersionError
    try:
        entry = release(version, summary, notes, required)
    except VersionError as e:
        sys.exit(str(e))
    print(f"Release {entry['version']} written ({'required' if entry['required'] else 'optional'}): VERSION, releases.json, "
          "web/data/releases.json and the web app's version.")
    print("Next: run ./penny test, commit, and merge to main. GitHub then tags the release, and every copy of Penny "
          + ("must update before real runs or changes." if entry["required"] else "is told it is ready and may skip it."))


def status(state_dir):
    """Print what the register remembers."""
    reg = Register(state_dir)
    print(f"{len(reg.rows)} keys in {reg.path}")
    for k, r in sorted(reg.rows.items()):
        print(f"  {r['status']:<10} {k:<42} {r['source_file']:<18} {r['amount']:>12} first run {r['first_run']}")


def main(argv=None):
    """Read the command line and run the matching command."""
    from .version import current as penny_version
    ap = argparse.ArgumentParser(prog="penny", description="Penny: reads vendor invoices, applies the AP rules, and tells you what to enter and what to hold.",
                                 epilog="First time:  ./penny install   |   Examples:  ./penny run 1   |   ./penny run ~/Desktop/new_invoices -n   |   ./penny explain 6   |   ./penny status   |   ./penny test   |   ./penny reset   |   ./penny demo")
    ap.add_argument("--version", action="version", version=f"Penny {penny_version()}")
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
    t = sub.add_parser("test", help="run the 121 automated checks")
    t.add_argument("--package")
    z = sub.add_parser("reset", help="clear the register and old runs")
    z.add_argument("--state", default=str(ROOT / "state")); z.add_argument("--out", default=str(ROOT / "runs"))
    w = sub.add_parser("web-export", help="package finished runs (and invoice PDFs) for the web view")
    w.add_argument("--package", help="assessment package folder, to include the invoice PDFs"); w.add_argument("--out", default=str(ROOT / "runs"))
    w.add_argument("--web", default=str(ROOT / "web"))
    v = sub.add_parser("web", help="open the web app in your browser (add --package to run new batches from it)")
    v.add_argument("--web", default=str(ROOT / "web")); v.add_argument("--port", type=int, default=8765)
    v.add_argument("--package"); v.add_argument("--state", default=str(ROOT / "state")); v.add_argument("--out", default=str(ROOT / "runs"))
    v.add_argument("--watch", nargs="?", const="", default=None, metavar="FOLDER",
                   help="(added after submission) pick up PDFs dropped into a folder (inbox/_incoming unless you name one) and preview them")
    v.add_argument("--host", default="127.0.0.1", help="(v2.0) the address to listen on. 0.0.0.0 opens Penny to your network; that needs real accounts and https")
    v.add_argument("--https", action="store_true", help="(v2.0) use the certificate made by ./penny cert")
    v.add_argument("--cert", help="(v2.0) a certificate file for https"); v.add_argument("--key", help="(v2.0) its private key file")
    v.add_argument("--allow-http", action="store_true", help="(v2.0) only when a proxy in front of Penny already provides https")
    ce = sub.add_parser("cert", help="(added after submission, v2.0) make a self-signed certificate so Penny can use https")
    ce.add_argument("--host", action="append", help="this computer's name or address, as teammates will type it (repeat for more than one)")
    ce.add_argument("--state", default=str(ROOT / "state"))
    mg = sub.add_parser("migrate", help="(added after submission, v2.0) move the audit log and accounts from before 2.0 into the database")
    mg.add_argument("--state", default=str(ROOT / "state"))
    sw = sub.add_parser("setup", help="(added after submission, v2.1) open the setup wizard in your browser")
    st = sub.add_parser("start", help="(added after submission, v2.1) start Penny the way the setup wizard was told to")
    for x in (sw, st):
        x.add_argument("--web", default=str(ROOT / "web")); x.add_argument("--state", default=str(ROOT / "state")); x.add_argument("--out", default=str(ROOT / "runs"))
        x.add_argument("--no-browser", action="store_true", help="do not open the browser")
    sw.add_argument("--port", type=int, default=8765)
    s = sub.add_parser("status")
    s.add_argument("--state", default=str(ROOT / "state"))
    u = sub.add_parser("update", help="check for a new Penny version and update to it")
    u.add_argument("--check", action="store_true", help="only show what is new"); u.add_argument("--skip", action="store_true", help="skip an optional version until the next one")
    u.add_argument("--state", default=str(ROOT / "state"))
    em = sub.add_parser("email", help="(added after submission) check the mail settings, or send a test email")
    em.add_argument("action", choices=["status", "test"]); em.add_argument("--to"); em.add_argument("--state", default=str(ROOT / "state"))
    us = sub.add_parser("users", help="(added after submission) list people, or invite one; the first invite turns on real accounts")
    us.add_argument("action", choices=["list", "invite"]); us.add_argument("--email"); us.add_argument("--name"); us.add_argument("--title", default="")
    us.add_argument("--role", choices=["viewer", "clerk", "approver", "admin"], default="viewer"); us.add_argument("--state", default=str(ROOT / "state"))
    us.add_argument("--port", type=int, default=8765, help="the port ./penny web uses, for the link")
    rl = sub.add_parser("release", help="(maintainer) publish a new version: VERSION, releases.json and the web app")
    rl.add_argument("version", help="like 1.7.0"); rl.add_argument("--summary", required=True); rl.add_argument("--note", action="append", default=[])
    rl.add_argument("--required", action="store_true", help="older copies must update before real runs or changes")
    a = ap.parse_args(argv)
    if a.cmd in ("run", "demo", "web", "check"):
        info = update_notice(a.state)
        if a.cmd == "demo" or (a.cmd == "run" and not a.dry_run):
            from .version import gate, UpdateRequired
            try:
                gate(info, "Running a batch for real")
            except UpdateRequired as e:
                sys.exit(str(e))
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
    elif a.cmd == "update":
        update(a.state, a.check, a.skip)
    elif a.cmd == "email":
        email_cmd(a.state, a.action, a.to)
    elif a.cmd == "users":
        if a.action == "invite" and not (a.email and a.name):
            sys.exit('Example:  ./penny users invite --email you@company.com --name "Your Name" --role admin')
        users_cmd(a.state, a.action, a.email, a.name, a.role, a.title, f"http://127.0.0.1:{a.port}")
    elif a.cmd == "release":
        publish_release(a.version, a.summary, a.note, a.required)
    elif a.cmd == "reset":
        reset(a.state, a.out)
    elif a.cmd == "web-export":
        pkg_arg = a.package or os.environ.get("HILLPOINTE_PACKAGE")
        web_export(find_package(pkg_arg) if pkg_arg else None, a.out, a.web)
    elif a.cmd == "web":
        pkg_arg = a.package or os.environ.get("HILLPOINTE_PACKAGE")
        serve_web(a.web, a.port, find_package(pkg_arg) if pkg_arg else None, a.state, a.out, watch=a.watch, host=a.host, cert=a.cert, key=a.key,
                  https=a.https, allow_http=a.allow_http)
    elif a.cmd == "setup":
        setup_wizard(a.web, a.port, a.state, a.out, not a.no_browser)
    elif a.cmd == "start":
        start(a.web, a.state, a.out, not a.no_browser)
    elif a.cmd == "cert":
        make_cert(a.state, a.host)
    elif a.cmd == "migrate":
        from .store import Store
        moved = Store(a.state).migrate()
        print("Moved into the database (state/penny.db): " + ", ".join(f"{n} {what}" for what, n in moved.items()) + ". The old files were renamed with .moved on the end."
              if moved else "Nothing to move. The audit log and accounts are already in the database (state/penny.db).")
    elif a.cmd == "status":
        status(a.state)


if __name__ == "__main__":
    main()
