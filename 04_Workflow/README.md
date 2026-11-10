# Hillpointe AP Automation Workflow

> This README describes Penny as it works today. Sections marked **(added after submission)** were not part of the
> October 2026 assessment. See [`../SCOPE.md`](../SCOPE.md) for the full version history.

A small, rerunnable system that reads vendor documents from the AP inbox, applies the AP Coding Rules, and produces:

* a Sage Intacct bill import file (CSV and Excel) in the template format
* the Entrata handoff list
* an exception log with a reason, a route and a confidence level for every document that is not entered
* the required approvers for every bill that is entered
* a record of everything processed, so nothing is ever entered twice

The idea in one line: **AI reads, code decides, people approve.** Reading a PDF is the messy part, so that is where AI
helps. Every business decision (hold, route, code, approve) is made by plain, testable code that follows the policy
document, so the same invoice always gets the same answer and every answer can be explained.

---

## Run it with Penny

Penny is the short name for this workflow. Open a terminal in this folder and type:

```bash
./penny install                               # once: sets up a private environment with pdfplumber, openpyxl and reportlab
./penny setup                                 # (added after submission, v2.1) the setup wizard in your browser; or double-click "Install Penny"
./penny start                                 # (added after submission, v2.1) start Penny the way the wizard was told to; or double-click "Start Penny"
./penny demo                                  # resets, then runs Batch 01, rerun, Batch 02, rerun (about 6 seconds)
./penny run 1                                 # run Batch 01 and save it
./penny run ~/Desktop/new_invoices            # run any folder of PDFs
./penny run 2 -n                              # -n means dry run: show every decision, save nothing
./penny explain 6                             # every check for document 0006 in the latest run
./penny status                                # what the register remembers
./penny test                                  # run the 121 automated checks
python tests/browser/run.py                   # (added after submission, v1.8) the browser suites; needs Node and Playwright
./penny reset                                 # forget everything and start fresh
./penny web-export --package <package>        # (added after submission) package saved runs and PDFs for the web view
./penny web --package <package>               # (added after submission) open the web app; New batch uploads and runs invoices
./penny --version                             # (added after submission, v1.6) which Penny this is
./penny update                                # (added after submission, v1.6) see what is new and update; --check only looks, --skip waits
./penny release 1.7.0 --summary "..."         # (added after submission, v1.6, maintainer) publish a version; add --required to make it the minimum
./penny users invite --email you@co.com --name "You" --role admin   # (added after submission, v1.7) turn on real accounts
./penny users list                            # (added after submission, v1.7) who has an account
./penny email test --to you@co.com            # (added after submission, v1.7) send one test email; `email status` shows the settings
```

`./penny install` needs Python 3.9 or newer and an internet connection, and it touches nothing outside this folder. It ends with a check that says "Penny is ready". On Windows type `penny` instead of `./penny`. If `./penny` says permission denied, type `bash penny run 1`.
The package folder (`Hillpointe_AP_Technical_Screen`) is found automatically when it sits next to this folder or inside it,
or add `--package <path>`. Each run prints a small block per document: status, invoice and amount, the plain reason, and who to send it to.

If you prefer pip, `python3 -m pip install -r requirements.txt` works too. The long form still works: `python3 -m ap_workflow run --package <package> --batch <folder> --run-id <name>`.

`./run_demo.sh` does the same as `./penny demo`.

Add `-n` (dry run) to see every decision without touching the register.

Python 3.9 or newer. No API key is needed for the default mode.

---

## The web view (`web/`) (added after submission, v1.2)

A browser view of everything Penny decided, for people who would rather not use the terminal. Phase 1 is view only.

* **Dashboard:** where every dollar landed, why invoices are on hold, results by run, and the rerun proof.
* **Runs:** each batch with its results. **Invoices:** every document, filterable by result, reason, vendor and bill date.
* **Invoice detail:** the PDF beside what Penny read, every check in order, the coding and approvers, and its history across runs.
* **Rules:** every setting in `config/rules.json`, in plain language.
* **Sign-in and roles (v1.3):** Viewer, AP Clerk, Approver and Admin, each a demo account on the sign-in screen. Clerks
  resolve, reject and reassign holds; Approvers approve or send back bills; Admins also change rules with an impact
  preview and undo. Every action needs a reason and goes to the audit trail. In this static site the actions are saved
  in the visitor's browser only; the help center explains the security habits and what a server would add.
* **Help center (v1.3):** a searchable knowledge base for the web app, the terminal, the rules and every exception code.
* **New batch (v1.4):** upload PDFs into `inbox/<YYYY-MM-DD>_<name>/` and preview (AP Clerk, Admin) or run for real
  (Admin). Needs the local server (`./penny web --package <package>`, see `ap_workflow/webserver.py`). Every step is
  added to the audit log (since v2.0 in `state/penny.db`) and shown in the audit trail.
* **Blockers, recheck and manual entry (v1.5):** each reason for a hold is tracked with an owner, target date, notes
  and fingerprinted files; Recheck and "Test on saved invoices" run Penny's engine on saved readings against a copy of
  the register (`ap_workflow/replay.py`); an unreadable file can be keyed by hand beside a screenshot, with a second
  person re-keying the invoice number and total above `thresholds.manual_entry_check_over` (`ap_workflow/manual.py`).
  A batch folder with `<file>.keyed.json` next to `<file>.pdf` uses the keyed record for that exact file.
* **Setup wizard (v2.1.0):** `Install Penny.command` / `.bat` install Penny and open a five-screen wizard in the
  browser (`web/setup.html`, `web/assets/penny-setup.js`, `ap_workflow/setup.py`): a check of this computer, the
  invoice package, who signs in (creating the first Admin), settings (time zone, watched folder, network and
  certificate), and a summary. Choices go to `state/setup.json`; `./penny start` and `Start Penny` use them.
  `/api/setup` only answers when Penny was started with `./penny setup` and the request carries that run's key.
* **Security review (v2.0.1):** fixed a way around sign-in that had existed since 1.7 (the check and the file server
  read the address differently, so `/%64ata/...` was served to anyone). `PennyHandler.plain_path()` now normalizes
  the address once for both, and `open_to_all()` is an allow-list. Also: HEAD requests, a Host check on
  this-computer-only servers (DNS rebinding), field checks on every action (`actions.check_shape`), moved browser
  history never counting as a sign-off, a proxy-aware lockout, and errors that keep their details in the terminal.
* **Penny for a team (v2.0.0):** with real accounts the server is the single source of truth. `ap_workflow/store.py`
  keeps the audit log and accounts in `state/penny.db` (SQLite; triggers refuse UPDATE and DELETE on the log).
  `ap_workflow/actions.py` checks every web action on the server (role, conflicts, second-person rules) and writes
  rule changes to `config/rules.json`. Browsers hold `GET /api/events?wait=25` open to see teammates' work live
  (`web/assets/penny-team.js`). `./penny web --host 0.0.0.0 --https` opens it to a network and is refused without
  real accounts and https; `./penny cert` makes a certificate; `./penny migrate` moves the files from before 2.0.
  The register and run folders stay files on purpose.
* **Made for phones (v1.9.1):** under 640 pixels wide, page tables (`table.data`) are laid out as cards by
  `web/assets/penny.css`, filters fold behind one button, dialogs rise from the bottom, and controls are 44 pixels
  tall. `tests/browser/phone.spec.js` checks it on an emulated iPhone.
* **Finishing the single-user roadmap (v1.9.0):** source highlighting on the PDF ("Show on page" beside each value
  Penny read), export history for the two import files (created, downloaded, imported, confirmed by a second person;
  each file carries a SHA-256 from `ap_workflow/webexport.py`), the watched inbox folder (`./penny web --watch`, see
  `ap_workflow/watcher.py`; previews only, never a real run), paging for long lists, and an accessibility pass with
  an automated WCAG 2.2 AA check of every screen (`tests/browser/accessibility.spec.js`).
* **Foundation (v1.8.0):** browser suites in `tests/browser/` (see its `run.py`), Python tests split into
  `tests/test_engine.py`, `test_web.py` and `test_platform.py`, the web app split into `web/assets/penny-*.js`
  (load order in `web/index.html`), a content security policy, and bundled fonts.
* **People, email and appearance (v1.7.0):** Admins invite people, set roles, turn accounts off and send resets
  (`ap_workflow/accounts.py`; real accounts once `./penny users invite` creates the first Admin). Exports and approval
  requests are emailed with the file attached (`ap_workflow/mailer.py`; set `PENNY_SMTP_HOST`, `PENNY_SMTP_PORT`,
  `PENNY_SMTP_USER`, `PENNY_SMTP_PASSWORD`, and optionally `PENNY_SMTP_FROM` and `PENNY_PUBLIC_URL`; without them
  emails are saved to `state/outbox/`). Only users and `email.allowed_domains` may be emailed. Everyone can choose
  themes and comfort settings; Admins set the company look (`display.theme`).
* **Versions and updates (v1.6.0):** `VERSION` and `releases.json` are the single source of truth (`ap_workflow/version.py`).
  The footer shows the version and opens What's new; "Check for updates" in the account menu checks on demand. A required release pauses real runs and changes until
  `./penny update` (reading, dry runs, previews and rechecks keep working); an optional one can be skipped.
* **Suggested fixes and Insights (v1.4):** one-click resolutions learned from past resolutions plus a playbook, and an
  Admin page of usage signals. Both run in the browser and never change Penny's decisions.

`./penny web-export` reads `runs/` and writes `web/data/penny-data.json` (and copies the PDFs into `web/data/pdfs/` when
given `--package`). The web view only displays saved results; it never makes a decision, so it cannot disagree with the
terminal. A held bill shows as **Replaced** once a later run enters a revised version under the same register key.

The site is plain HTML, CSS and JavaScript with no build step, so any static host works. `.github/workflows/pages.yml`
publishes `04_Workflow/web` to GitHub Pages whenever it changes on `main` (turn Pages on under Settings, Pages, Source:
GitHub Actions).

## What you get from each run (`runs/<run-id>/`)

| File | What it is |
|---|---|
| `intacct_bill_import.csv` | The upload file. UTF-8, one row per bill line, only documents that should be entered. |
| `entrata_handoff.csv` | One row per Entrata GL for stabilized communities. |
| `exception_log.csv` | One row per document not entered: file, vendor, invoice, amount, code(s), reason, route, confidence. |
| `approvals_for_entered_bills.csv` | Required approvers for each entered bill, plus notes that are informational and not holds. |
| `review_workbook.xlsx` | The same content as tabs, with a Bill_Total_Check tab that uses formulas to prove every bill ties to the amount owed. |
| `run_report.md` | Counts, every decision, and the pre-flight result. |
| `decisions.json` | Full detail per document, including the decision trail. |
| `extracted/*.json` | What was read from each PDF. This is the audit record of the AI/parsing step. |

---

## How a document moves through the system

```
PDF  ->  1. EXTRACT  ->  2. VALIDATE  ->  3. DECIDE  ->  4. PRE-FLIGHT  ->  5. WRITE + REMEMBER
         read only        numbers tie?     policy rules     Intacct rules      files + register
```

1. **Extract** (`extract.py`). Reads the PDF into structured fields: vendor, invoice number, dates, bill-to, references,
   lines, tax, total, pay application math, lien waiver, change orders. Watermarks like REPRINT are pulled out as
   "stamps" so they cannot garble the text.
2. **Validate**. Lines must add to the subtotal. Subtotal plus tax must equal the total. Pay application lines 1 to 8
   must agree. A document that fails is held for a person instead of being guessed at.
3. **Decide** (`rules.py`). Runs the checks below and collects **every** hold code that applies, not just the first.
4. **Pre-flight** (`outputs.py`). Checks the import file the way Intacct would (required fields, open period, due date,
   account rules, bill totals) because Intacct rejects the whole file if one row fails. If pre-flight fails, nothing is saved.
5. **Write and remember**. Writes the files and saves the register.

### The checks, in order

| # | Check | If it fails |
|---|---|---|
| 0 | (added after submission, v1.1) File can be read (not empty, a real PDF, not password protected or damaged, has a text layer) | OTHER, with the file name and the exact problem. The rest of the batch carries on |
| 1 | Document is a bill, pay app or credit | OTHER (a standalone lien waiver is not a bill). (Added after submission, v1.3.) A bill in a layout Penny cannot read is held with what Penny saw, Low confidence |
| 2 | Arithmetic ties | OTHER |
| 3 | Vendor is in the master and Active (inactive merged names map to the surviving ID, with Medium confidence) | NEWVEND |
| 4 | Bill-to is a Hillpointe legal entity | OTHER. A wrong Hillpointe entity is only a note when the PO identifies the project |
| 5 | Payment instructions unchanged (language, remit address, phone) | BANKCHG to Treasury |
| 6 | Not a duplicate (ERP history, earlier runs, revised invoices) | DUP |
| 7 | Category: construction, stabilized community or corporate | |
| 8 | PO or subcontract exists, matches vendor and project, is open | NOPO |
| 9 | Insurance certificate valid on the bill date | COI |
| 10 | PO balance, within $500 tolerance (credits count) | OVERPO |
| 11 | Pay app: only executed change orders, previous certificates agree to history, retainage is 10%, lien waiver matches | UNAPPCO, LIEN, OTHER |
| 12 | Stabilized: invoice equals the service agreement monthly fee, GL by description | OTHER |
| 13 | Code the lines: cost code and type from the PO line, tax and delivery follow their line, retainage line, allocation table | |
| 14 | Dates and terms from the vendor master, posting date moved out of closed periods | |
| 15 | Approvers by category and dollar threshold | |

---

## Duplicate logic and the record of processed invoices

* **Key:** `VENDOR_ID | cleaned invoice number | Bill or Adjustment`. Cleaning removes case, dashes, spaces, a leading
  INV label and leading zeros, so `INV-20417`, `inv 020417` and `20417` match.
* **Where the record lives:** `state/processed_register.csv` (one row per bill key, with status ENTERED, HELD or
  SUPERSEDED, source file, file hash and run) and `state/run_log.csv` (append-only audit trail). Plain CSV, so it can be
  opened in Excel, diffed in git and copied to another computer.
* **Same inbox file again:** skipped. That is what a rerun looks like.
* **Different file, same invoice** (resend, reprint, past due reminder): DUP, route to the AP Manager.
* **Held documents are not duplicates.** A corrected or revised version is checked again from scratch.
* **Same vendor and amount, different number:** not a duplicate. Recurring bills repeat.
* **Credits are processed first** so PO balances are right when invoices are tested.

To start completely fresh, delete the two files in `state/` (the demo does this for you).

---

## Where each rule lives (for a rule change)

Most changes are one line in `config/rules.json`. Nothing needs to be edited in code.

| If the rule change is about... | Edit |
|---|---|
| The $500 PO overage tolerance | `thresholds.overpo_tolerance` |
| Retainage percent | `thresholds.retainage_pct` |
| VP Construction, Regional PM or CFO dollar triggers | `thresholds.vp_construction_gross_over`, `regional_pm_invoice_over`, `cfo_bill_over` |
| COI must be valid some days past the bill date | `thresholds.coi_grace_days` |
| Which hold goes to which team | `routes` |
| Order the primary code is shown in | `code_priority` |
| Payment-change wording that triggers BANKCHG | `payment_change_phrases` |
| Which stamps are mentioned on duplicates | `duplicate_stamps` |
| What counts as one-time versus subscription | `corporate.one_time_keywords`, `subscription_keywords` |
| Entrata GL by description | `entrata_gl_keywords` |
| Construction entity, department or retainage account | `construction` |
| Terms days | `terms_days` |
| The company time zone for times in the web app and batch folder dates (added after submission) | `display.time_zone` |
| The total above which a manual entry needs a second person (added after submission) | `thresholds.manual_entry_check_over` |
| Who Penny may email, and how many at once (added after submission) | `email.allowed_domains`, `email.max_recipients` |
| The company look: colors and corners (added after submission; set it on the Appearance page) | `display.theme` |
| Open and closed periods, allocation percentages, vendors, projects, POs | The master data and the PDFs in the package. They are read fresh every run. |

Logic that needs a code change is small and has one home: duplicate rules in `_duplicates`, pay application rules in
`_pay_app`, PO rules in `_po_invoice`, dates in `_dates_and_header`, approvers in `_approvers`.

---

## Assumptions I made (and where to change them)

1. **Bill lines are grouped by PO line.** Each invoice line is coded to its PO line, tax is allocated in proportion and
   rounded (difference on the largest line), then lines with the same coding are combined. Delivery follows the line it
   relates to. Example: Ridgeway RER-77310 becomes a telehandler line (5,616.00) and a scissor lift line (1,452.60).
2. **Allocated software lines use the vendor's Owner Dept (IT) on every entity line.** The brief does not say to use each
   entity's own department.
3. **Credit memos are coded like the original bill** found in the ERP history, and the due date equals the bill date.
4. **Entrata Post Month is the invoice month.** The package has no Entrata period table.
5. **COI is checked for every vendor that has a date,** not only subcontractors, and the check is skipped for credit memos.
6. **A held document is not entered at all,** not even partly.
7. **Stabilized invoices with no service agreement on file** are passed to Entrata with a note and Medium confidence,
   because the fee check cannot be done. With an agreement, the fee must match.
8. **A corporate invoice for a vendor with no Owner Dept** is held (OTHER) rather than guessing a department.
9. **Lien waiver signatures.** Every signature line in the sample PDFs is blank. The workflow checks the waiver exists,
   the amount, the claimant and the through date, and adds a note asking a person to confirm the signed original.
10. **Confidence** is High when every rule was clear, Medium when a rule needed an interpretation (inactive vendor
    mapped to the surviving record, a possible duplicate under another number, no agreement to check a fee).

---

## Using AI at run time (optional)

The default mode (`--extractor rules`) is deterministic and needs no internet, which is why the live demo cannot fail
on a network problem. For documents that look different from the samples:

```bash
./.venv/bin/python -m pip install anthropic     # Windows: .venv\Scripts\python -m pip install anthropic
export ANTHROPIC_API_KEY=...
./penny run <folder> --extractor hybrid    # rules first, Claude only if the numbers do not tie
./penny run <folder> --extractor llm          # Claude reads everything and the rules parser cross-checks it
```

The prompt is in `prompts/extraction_prompt.md`. Claude only returns JSON. Every number it returns is re-checked by the
same validation, and every decision is still made by `rules.py`.

**Honest status:** the LLM path was written and unit tested offline (fallback, merge, credit sign), but it was **not run
against the live API** while this was built because no API key was available in the build environment. The rules path is
what produced every result in this package.

## Known limits

* The rules parser expects the layouts in the sample package. A very different layout will fail validation and go to a
  person, which is the safe outcome. `--extractor hybrid` is the answer for that. (Added after submission, v1.3.) Penny
  now says so plainly: "This looks like a bill for $X that references PO..., but it is not in a layout Penny can read."
* Scanned images (no text layer) would need OCR first. Today they are held with a clear reason instead of being guessed at.
* (Added after submission, v1.1.) A file Penny cannot read (empty, not really a PDF, password protected, damaged) never stops a run. It is held under
  OTHER and routed to the AP Manager with the reason, in the terminal summary, the exception log and the workbook. It is
  not written to the register (there is no vendor or invoice number to key on), so a fixed copy is read fresh next run.
* Only the first PO or subcontract in the Customer Ref box is used.
* The workflow never talks to Intacct or Entrata. It produces files for a person to upload.
