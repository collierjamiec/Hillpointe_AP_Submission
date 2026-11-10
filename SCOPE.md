# Scope and versions

Penny started as my answer to the Hillpointe AP technical screen. After I submitted it, I kept building, because I wanted
to show how I think about a real product: who uses it, what can go wrong, and how to make it clear and safe.

This page keeps those two things apart, so anyone reviewing the project can see exactly what the assignment asked for
and what I chose to build on my own.

| Version | When | What it is | Where to look |
|---|---|---|---|
| 1.0 | October 2026 | **The submitted assessment.** Unchanged in folders `01` to `05`. | `00_START_HERE.md` |
| 1.1 | November 2026 | **After submission:** bad or unreadable files no longer stop a run. | Pull request #1 |
| 1.2 | November 2026 | **After submission:** a web view in the browser, phase 1 (view only). | Pull request #2, `04_Workflow/web/` |
| 1.3 | November 2026 | **After submission:** honest handling of unfamiliar layouts, sign-in with roles, real actions, an audit trail, a rules editor, a redesigned interface and a help center. | Pull request #2 |

---

## Version 1.0: the submitted assessment (October 2026)

### What the assignment asked for

A rerunnable process that reads the vendor documents in the AP inbox, applies the AP Coding Rules and Approval Matrix,
and produces the following for the AP team:

* a Sage Intacct bill import file in the template format
* the Entrata handoff list for stabilized communities
* an exception log with a reason and route for every document that is not entered
* the required approvers for every bill that is entered
* proof that running the process again does not enter anything twice
* a one-page summary and a log of how AI was used

All of this is in the submitted package, folders `01` to `05`, as it was handed in.

### What I built into the submission beyond the core deliverables

These were my own choices, made to show a system someone could trust and run, not just a set of files.

| Addition | Why I added it |
|---|---|
| **Answer key first.** The expected result for all 20 documents was worked out from the policy before any code was written (`tests/expected_decisions.json`). | So the code could never grade its own work. |
| **33 automated tests**, including 17 edge cases built from synthetic invoices. | To prove the rules hold up on invoices the package did not include. |
| **A pass or fail trail for every document**, and an `explain` command to print it. | So every decision can be traced back to a rule. |
| **Intacct pre-flight check** before any file is written. | Intacct rejects the whole file if one row fails, so Penny checks first. |
| **All business rules in one settings file** (`config/rules.json`). | So a rule change, like the $500 PO tolerance, is one line and not a code change. |
| **The name Penny and simple commands:** `./penny install`, `run`, `demo`, `explain`, `status`, `test`, `reset`, `check`, and `-n` for a dry run. | So anyone on the AP team could install and run it in minutes. |
| **An optional Claude extractor** (`--extractor hybrid` or `llm`), off by default. | A path for invoice layouts the rules parser has never seen. Written and tested offline only, and described that way. |

> The split above reflects the submitted package and the AI usage log. The original assignment brief is not stored in
> this repository.

---

## Version 1.1: unreadable files (November 2026, after submission)

**The problem.** A corrupt, empty, password protected or scanned PDF crashed the whole run with a technical error.

**What changed.**

* Penny now holds just that one file, names it, and says what is wrong in plain language. Every other file in the batch
  is processed normally.
* Five kinds of problems are recognized: empty, not really a PDF, password protected, damaged, and scanned with no text.
* The held file goes to the AP Manager under the existing `OTHER` code. No new exception code was invented.
* The file shows up in the terminal summary, the exception log and the review workbook.
* 4 new tests. The test suite also now runs the checks that do not need the assessment package, instead of stopping
  when the package is missing.

**Files:** `04_Workflow/ap_workflow/pdfio.py`, `extract.py`, `llm_extract.py`, `rules.py`, `cli.py`, and the tests.

---

## Version 1.2: the web view, phase 1 (November 2026, after submission)

**The idea.** Most AP teams will never open a terminal. The web view shows everything Penny decided in the browser,
while the terminal keeps working exactly as before. Both use the same engine, so they can never disagree.

**What phase 1 includes.**

* **Dashboard:** where every dollar landed, why invoices are on hold, results by run, and proof that nothing was
  entered twice.
* **Runs and invoices:** every batch and every document, with filters by result, reason, vendor and bill date.
* **Invoice detail:** the original PDF beside what Penny read, every check in order, the coding, the approvers, and the
  history across runs.
* **Rules:** every setting from `config/rules.json`, in plain language.
* **Roles:** Viewer, AP Clerk, Approver and Admin. You can switch roles at the top of the page to see what each will be
  able to do. Editing is clearly marked "Phase 2".
* **Built for everyone:** light and dark modes, phone layouts, keyboard navigation and screen reader labels.
* **Accuracy:** a held invoice that was later replaced by a revised copy shows as **Replaced**, matching Penny's own
  register, so the dashboard never overstates what is waiting on a person.
* New commands: `./penny web-export` packages the saved runs, and `./penny web` opens the site. Each new run also
  records when it started.
* Publishing to GitHub Pages (`.github/workflows/pages.yml`), so the site can be shared with a link.
* The original invoice PDFs, drawn with PDF.js (bundled, Apache 2.0 license) so they look the same in every browser,
  including phones that cannot show a PDF inside a page.
* **A fifth run, "Edge-case tests":** six invoices I wrote to test Penny beyond the assessment package (a clean bill,
  over PO but inside tolerance, a duplicate under a new number format, a bank change, an unfamiliar layout, and a
  scanned picture). These are Penny's real decisions from a run on my own computer.
* 3 new tests, 40 in all at the time.

**Files:** `04_Workflow/web/`, `04_Workflow/ap_workflow/webexport.py`, `cli.py`, and the tests.

---

## Version 1.3: roles, actions and a redesigned workspace (November 2026, after submission)

### A fix in Penny itself

My own edge-case test, **T5**, was a real $940 bill in a "Statement of Charges" layout Penny had never seen. Penny held
it, which was safe, but the reason said "Not a bill (for example a standalone lien waiver)", which was wrong.

* Penny now recognizes a document that asks to be paid (amount due, balance due and similar wording plus a dollar
  amount) but is not in a layout it can read. It gets its own type, `unrecognized`.
* The hold reason now says what Penny saw and what to do: *"This looks like a bill for $940.00 that references
  PO2410315-008, but it is not in an invoice layout Penny knows how to read..."* Confidence is Low.
* A lien waiver on its own is still "not a bill". In hybrid mode these documents are exactly the ones handed to the AI
  reader.
* Only T5 changed type out of all 26 PDFs on file. A sixth run, "T5 retest after fix", shows the before and after.
* 1 new test, which fails on the old code and passes on the new code.

### The web app

* **Sign-in with four demo roles:** Viewer, AP Clerk, Approver and Admin. One click signs in as any role.
* **Real actions, by role:** resolve a hold (clear for the next run, or reject to the vendor), reassign, reopen,
  approve or send back each required sign-off, add notes. Every action needs a short reason.
* **Audit trail:** every Penny run and every human action, with before and after, never edited or deleted (undo is a
  new entry). Filter it, or download it as a CSV file that is safe to open in Excel.
* **Rules editor (Admin):** change thresholds and routes, see which invoices on file a change would affect before
  saving, save with a reason, and undo. Saved rules apply to Penny's next run; past decisions never change.
* **Overview as a work queue:** what needs me, why, what to do next, and what people did. Every total links to the
  page that explains it.
* **Exceptions guide:** every hold reason in plain language, with why it happens, what to do next and who acts.
* **Exports:** download the files each run wrote, each labeled honestly (generated is not imported).
* **Review flow:** previous and next record, keyboard shortcuts (press `?`), and the list you came from keeps its
  filters and scroll position.
* **Help center:** 27 searchable articles covering getting started, the web app, the terminal, how Penny decides,
  every exception code and rule, roles, a glossary, security and an FAQ. Articles that list codes, rules, roles or
  shortcuts are built from the live data, so they cannot fall out of date.
* **An intro:** a copper penny tosses, flips and lands, then a welcome fades in and out. It plays once per visit, can
  be skipped, and becomes a simple fade for people who prefer less motion.
* **My name on every screen,** including sign-in.

### Honest labels

Penny writes files; it does not post or pay. The web app now says so everywhere:

| Penny result | Old label | New label |
|---|---|---|
| `ENTER_INTACCT` | Entered in Intacct | Ready for Intacct import |
| `ENTER_ENTRATA` | Sent to Entrata | In Entrata handoff |
| `SKIP_ALREADY_ENTERED` | Already entered | Skipped, already processed |
| A required approver | (shown as a list) | Shown separately from recorded approvals |

Confidence stays Penny's own word (High, Medium, Low) and is never turned into a percentage.

### Design system

A calm financial workspace built on reusable tokens: color by meaning (teal for actions, green for done, amber for
review, red for blocking, slate for history, copper only for the brand), a 4px spacing scale, restrained borders and
shadows, and 160ms motion that respects reduced-motion settings. Status, destination and confidence each look
different, and every status has a text label and an icon, so nothing depends on color alone.

**Contrast check (WCAG 2.2 AA).** Every text color was measured against its background in both themes. Lowest results:
secondary text 4.72:1 (light) and 6.00:1 (dark), teal on its soft background 4.78:1, all status badge pairs 5.6:1 or
higher. Form and button borders use a separate color at 3.25:1 or higher.

### Security habits in the demo

The public site is static, so sign-in runs in the browser and protects nothing; the accounts and passwords are public on
purpose. It still follows the habits a real system needs: salted PBKDF2 password hashes (never plain text), a constant
time comparison, a lockout after five wrong tries, sessions that end when the tab closes or after 30 idle minutes,
permission checks when an action is saved (not only when a button is shown), escaped user text, and CSV downloads that
neutralize spreadsheet formulas. The help center's "Security and this demo" article lists what production would add.

### Testing

* 41 Python tests (10 run without the assessment package; the rest need it and run on Jamie's computer).
* An automated browser run signs in as all four roles and loads every page at desktop and phone width (120 page views,
  no sideways scrolling, no script errors). It then exercises every action, checks that each role is blocked from what
  it should not do, confirms the lockout refuses even the right password while locked, and searches the help center.

---

## What comes next (planned, not built)

| Next step | What it adds |
|---|---|
| A real server | Sign-in, permissions and the audit trail checked and stored on a server, shared by the whole team. |
| Run batches from the browser | Upload a folder, name the batch, dry run first, then run for real. |
| Single sign-on | Sign in with the company's identity provider instead of demo accounts. |

These grow out of two ideas I recorded during the assessment: a full audit trail, and a safe way to handle new invoice
types and vendors.

---

## How the work after submission was done

Same method as the assessment: **AI reads, code decides, people approve.** I directed the work and reviewed every
change. Claude Code wrote the code and tests with me in a cloud session. Each change was proven with a test that fails
on the old code and passes on the new code. Every web view screen was checked with automated screenshots, including on
a phone-sized screen.

Each version is its own pull request, so the history stays easy to review.
