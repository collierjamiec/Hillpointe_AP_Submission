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
* 2 new tests, 39 in all.

**Files:** `04_Workflow/web/`, `04_Workflow/ap_workflow/webexport.py`, `cli.py`, and the tests.

---

## What comes next (planned, not built)

| Phase | What it adds |
|---|---|
| 2 | Run new batches from the browser: upload, name the batch, dry run first. |
| 3 | Act on holds: a work queue for each team, resolve a hold with a required note, approve bills, and a full audit trail of every human action. |
| 4 | Rules admin: edit rules in forms, preview what a change would do to past batches before saving, and undo any change. |

Phases 3 and 4 grow out of two ideas I recorded during the assessment: a full audit trail, and a safe way to handle new
invoice types and vendors.

---

## How the work after submission was done

Same method as the assessment: **AI reads, code decides, people approve.** I directed the work and reviewed every
change. Claude Code wrote the code and tests with me in a cloud session. Each change was proven with a test that fails
on the old code and passes on the new code. Every web view screen was checked with automated screenshots, including on
a phone-sized screen.

Each version is its own pull request, so the history stays easy to review.
