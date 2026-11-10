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
| 1.4 | November 2026 | **After submission:** upload and run new batches from the web app, suggested fixes that learn, usage insights, every rule editable, plainer exports, a longer intro with a loading bar. | Pull request #3 |
| 1.5 | November 2026 | **After submission:** blockers with owners, dates and evidence, recheck previews, a rule simulator, manual entry with a second-person check, a most-urgent-first queue, and automatic tests on every pull request. | Pull request #4 |
| 1.6.0 | November 2026 | **After submission:** the version on every screen, a What's new page, and updates that are either required (read-only until updated) or optional (can be skipped). From here on, versions have three parts. | Pull request #5, release [v1.6.0](https://github.com/collierjamiec/Hillpointe_AP_Submission/releases/tag/v1.6.0) |
| 1.7.0 | November 2026 | **After submission:** real user accounts with invitations, password resets, roles and on/off status; emailing exports and approval requests with the file attached; an Outbox; and appearance settings with preset themes, custom colors and a company default. | Pull request #6, release [v1.7.0](https://github.com/collierjamiec/Hillpointe_AP_Submission/releases/tag/v1.7.0) |

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
* **Help center:** 31 searchable articles covering getting started, the web app, the terminal, how Penny decides,
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

## Version 1.4: new batches, suggested fixes and insights (November 2026, after submission)

### Upload and run new batches from the web app

* **New batch page:** name the batch (quick picks like weekly-ap and month-end), drag in the PDFs, then preview or run.
  Every file is checked before upload: a real PDF by content, 25 MB or less, not added twice, and flagged if Penny has
  already read the same file (matched by SHA-256 fingerprint).
* **Folder naming:** `inbox/<YYYY-MM-DD>_<short-name>`, for example `inbox/2026-11-10_weekly-ap`. Dates first so
  folders sort in order; `-2`, `-3` are added if a name is reused the same day.
* **Permissions:** AP Clerks and Admins upload and run previews (a dry run that leaves the register alone). Only Admins
  run for real. That is a separation-of-duties control.
* **Audit:** every step is appended to `state/batch_log.jsonl` on the Penny computer and shown in the audit trail marked
  "On disk": who created the batch, who uploaded which files (name, size, SHA-256), who ran it, when, the folder, the
  run ID, preview or real, the result counts, the pre-flight result, and failures.
* **Where it runs:** reading invoices needs Penny's Python engine, so `./penny web --package <folder>` now starts a small
  local server (`ap_workflow/webserver.py`). It listens only on this computer, refuses write requests from other sites
  (custom header and origin check), and only writes inside the batch folder. Uploaded invoices are left out of git.
  The public demo lets visitors try every step and explains that running needs Penny on a computer; nothing is
  uploaded and no results are invented.

### Suggested fixes that learn

* A held invoice shows up to three ready-made resolutions with one-click Apply and an Undo button.
* Suggestions rank how people resolved the same reason before (same vendor counts more; fixes that were later reopened
  count less), plus a built-in playbook before any history exists. For a missing PO it uses the likely PO match
  Penny already found.
* Guardrail: a payment-instruction change is never cleared in one click; Treasury's phone confirmation is required.
* Suggestions only speed up a person's action. Penny's decisions stay in tested code, and a cleared invoice is still
  checked from scratch on the next run.

### Usage insights

An Admin-only Insights page: sessions, actions, suggestion acceptance, time to resolve a hold, screens used, searches
and help searches with no results, errors, and plain-language signals for improving Penny. Events carry a time and a
role, never note text, passwords or personal details. They stay in the browser and can be turned off, cleared or
downloaded, in a shape a server could collect later.

### Everything else

* **Every rule is editable for Admins:** thresholds, routes, code priority (reorder), payment terms, word lists,
  keyword-to-GL rules, posting codes and the AI reader switch, with validation, a preview, a reason, and undo.
* **Company time zone:** Admins pick it on the Rules page (Eastern by default), with the same preview, reason and undo
  as any rule. Every time in the web app shows in that zone with its short name, such as EST, so people in different
  cities read the same clock. New batch folders and the on-disk batch log use it too (`display.time_zone` in
  `rules.json`). Saved times never change, and no invoice decision depends on it.
* **Audit trail order:** times from the browser and from the Penny computer are put on one clock before sorting, and
  steps logged in the same second show in the order they happened.
* **Exports in plain words:** "Intacct bill import file", "Invoices needing review", "Approvals needed", "Run summary"
  (viewable on the page), each with what is inside and who uses it, and readable download names.
* **Help center:** a clear "Back to Help center" link, a working breadcrumb, and three new articles (34 in all).
* **Intro:** easier-to-read lettering on the coin, a loading bar that tracks real loading, and a few seconds longer.
* **Honesty fix on the coin:** the back read "ENTERED ONCE"; it now reads "NEVER BILLED TWICE".

### Testing

* 49 Python tests. 19 run without the assessment package, including the batch server: naming, permissions, file
  checks, path tricks, the audit log, the company time zone, refusing requests from other sites, and a full preview run.
* Browser runs as each role: the rules editor (add, remove, reorder, validate, save, undo, time zone from a laptop set
  to another zone), suggested fixes (apply,
  undo, learning from a new resolution, the bank-change guardrail, one-click from My work), Insights, and a batch
  uploaded and previewed through a real local server, plus the public demo's behavior.

---

## Version 1.5: blockers, recheck and manual entry (November 2026, after submission)

### Blockers: each reason for a hold, tracked on its own

* Every reason a held invoice is waiting on is a blocker with a status (Open, Waiting for evidence, Ready for
  recheck, Cleared), an owner (starting from the route in Rules), a target date, notes, attached files and the person
  who verified it. The invoice shows progress, like "1 of 2 blockers cleared".
* Attached files are checked by content (PNG, JPEG or PDF, up to 10 MB) and fingerprinted with SHA-256. The audit
  trail names exactly which file was used. Clearing a payment-change blocker still needs Treasury's phone confirmation.
* Blockers organize the people work. Penny's decision never changes; a cleared invoice is checked from scratch on its
  next run.

### Recheck previews and a rule simulator

* **Recheck** decides one held invoice again, the way the next run would: the same reading under today's rules and
  reference data, a corrected PDF from the vendor, or a manual entry. The preview shows before and after, and the
  document fingerprint, rules fingerprint, reference-data fingerprint and register size it used.
* **Test on saved invoices** (Rules page, Admin) decides every saved invoice twice, with the current rules and with
  the draft, on the same readings and reference data, and lists each invoice that would change.
* Both use Penny's real engine through a new module, `ap_workflow/replay.py`. It works on a copy of the register that
  cannot be saved. A test proves that replaying the saved readings rebuilds all 47 saved decisions exactly.
* Every recheck is logged on disk (`recheck.preview`) with the fingerprints it used. The public demo explains that
  these need Penny on a computer instead of inventing a result.

### Manual entry for files Penny cannot read

* For a scanned picture or a bill in an unfamiliar layout, a person keys the invoice beside a screenshot or re-saved
  PDF, with a reason. The form checks that the lines add to the subtotal and the subtotal plus tax equals the total as
  you type.
* **Second-person check over a limit (maker-checker):** above "Manual entry second check" in Rules ($2,500 by
  default), a different AP Clerk or Admin keys the invoice number and total again without seeing the first entry. A
  mismatch is recorded and the entry waits. Under the limit, one person and a reason are enough. If the limit is
  missing, every entry gets a second check.
* Penny runs every normal check on the keyed record (`ap_workflow/manual.py` builds the same shape the PDF reader
  produces). Saving writes `inbox/<date>_manual-<file>/` with the original file, `<file>.keyed.json` and an
  `evidence/` folder, logged as `manual.saved`. An Admin runs it from the new "Batches waiting to run" list.
* A run uses a keyed record only for the exact file it was keyed from (same SHA-256). The invoice is marked "Keyed by
  hand" everywhere, and the run report says "(keyed by hand)". Pay applications cannot be keyed by hand.

### Everything else

* **Most urgent first:** My work orders holds by overdue blockers, then bills past or near their due date (bill date
  plus terms), then the oldest holds, and each row says why. "By team" is still one click away.
* **Automatic tests:** a GitHub check runs the tests that do not need the assessment package, on Python 3.9 and 3.12,
  and checks the web app's scripts, on every pull request (`.github/workflows/tests.yml`).
* **Help center:** three new articles (37 in all): blockers, recheck and testing rule changes, and manual entry.

### Testing

* 65 Python tests; 31 run without the assessment package. New ones cover the keyed record (shape, every problem
  listed at once, tie-out, maker-checker, credit memos, payment-change words), a run using a keyed record only for
  its own file, replaying all saved decisions exactly, the simulator, and the server's recheck, simulate and
  manual-entry endpoints (permissions, evidence checked by content, nothing half-saved).
* A browser run with the real package, as each role: update and clear a blocker with a file, the urgent queue, a
  recheck preview, manual entry under and over the limit (including a wrong second check), Penny checking the keyed
  invoice, saving it, an Admin running it for real, the rule simulator, the audit trail, phone width, and a Viewer
  seeing no new buttons. All 36 checks passed with no page errors.

---

## Version 1.6.0: versions and updates (November 2026, after submission)

### The version on every screen

* One source of truth: `04_Workflow/VERSION` (now `1.6.0`, three parts: major, minor, small fixes) and
  `04_Workflow/releases.json` (every release, newest first, with its date, summary, notes and whether it is required).
* The footer of every screen and the sign-in screen show "Penny v1.6.0". It opens a **What's new** page that lists
  every version back to 1.0.0, marks the one you are on, and says which are required.
* `./penny --version` prints the same. Every run records the Penny version that made its decisions, and the run page
  shows it, so an auditor can tell later.
* A test fails if `VERSION`, `releases.json`, the web app's copy and the version inside the web app ever disagree.

### Updates: required or optional, for everyone

* **Website visitors:** the page checks the published release list when it opens, when you come back to the tab and
  every 30 minutes. An **optional** update shows a calm banner with What's new, Update now (reloads with fresh files;
  everything done in the browser is kept) and Skip this version (lasts until the next one). A **required** update
  shows a warning banner that cannot be dismissed, and Penny becomes read-only: every page can be read, but changes
  are refused with a reason until the update.
* **Penny on a computer:** the terminal and the local web app check GitHub's `releases.json` at most once a day
  (short timeout, cached in `state/update_check.json`, nothing sent about the person, `PENNY_NO_UPDATE_CHECK=1` turns
  it off, and a failed check never blocks). An optional update prints a one-line notice; `./penny update --skip`
  waits for the next one. A **required** update pauses real runs and changes (creating batches, uploading, running
  for real, saving manual entries) with a reason; reading results, help, dry runs, previews and rechecks keep
  working. The web app shows the same warning banner with "How to update".
* **Check for updates:** in the account menu (every role) and on What's new. It checks right away (on a computer,
  the server asks GitHub instead of using the day's cached answer) and shows this version beside the newest one,
  whether the update is required or optional, the oldest version allowed, what changed, and when it checked. From
  there: Update now (website), the terminal steps (computer), Skip this version (optional only) or Check again.
* `./penny update` shows what is new, refuses to start if Penny's own files were changed on this computer (your
  register, runs, batches and web data never count and are never touched), updates from GitHub `main`, then runs the
  readiness check. `./penny update --check` only shows what is new.
* **Publishing:** `./penny release 1.7.0 --summary "..." --note "..." [--required]` writes VERSION, both copies of
  `releases.json` and the web app's version in one step, and refuses a version that is not newer. When it reaches
  `main`, `.github/workflows/release.yml` tags it and creates a GitHub release with its notes. A required release
  becomes the minimum: anything older must update.
* Versions before 1.6.0 had no update checks, so none of them is marked required.

### Testing

* 73 Python tests; 39 run without the assessment package. New ones cover version parsing (compared as numbers),
  every place the version lives agreeing, optional, skipped and required states (a skip lasts until the next version;
  a required one cannot be skipped), the daily cached check, an offline check that never blocks, writing a release
  and refusing mistakes, the server pausing only real runs and changes, the terminal refusing a real run, and an
  update that ignores the person's own data, and the server's check-now endpoint.
* A browser run of the website and of a local copy, with releases published while the page is open: footer and
  sign-in version, What's new, optional banner with skip remembered and a newer version bringing it back, the
  required warning banner, a change refused and nothing saved, reading still working, Update now, the local
  how-to-update dialog, Check for updates (up to date, optional, and required on a computer), the server refusing a
  new batch, and phone width. All 27 checks passed with no page errors,
  and the earlier browser suites still pass.

---

## Version 1.7.0: people, email and appearance (November 2026, after submission)

### User management (Admin)

* **Users page:** invite someone (name, email, job title, role), edit them, change their role, turn the account off or
  back on, resend an invitation, and send a password reset. Status shows Active, Invited or Turned off, with the last
  sign-in.
* **Invitations and resets:** the email carries a link that works once and expires (72 hours for an invitation, 1 hour
  for a reset). The person checks their name and chooses a password: at least 10 characters, not their name or email,
  not a common password, typed twice, with live hints. "Forgot your password?" on the sign-in page sends a reset and
  never says whether an email has an account.
* **Guards:** nobody can remove their own Admin role or turn off their own account, Penny always keeps one active
  Admin, and changing someone's role or email signs them out so the change applies at once.
* **On a computer, accounts are real** (`ap_workflow/accounts.py`). The first `./penny users invite ... --role admin`
  turns them on. Passwords are salted PBKDF2-SHA256 hashes (200,000 rounds); links are stored only as SHA-256 hashes;
  the session is a random token in an HttpOnly, SameSite=Strict cookie, kept only as a hash and ended after 30 idle
  minutes. Every request then acts as the signed-in person: anything the browser claims about who it is is ignored,
  and invoices, runs and the API need a session. Five wrong passwords lock an email for a minute, doubling after that.
  `users.json`, `tokens.json` and the outbox are git-ignored.
* **In the public demo**, the same page works inside the browser: invited people get a working link in the demo
  Outbox, and can set up an account and sign in. The four public accounts keep their published passwords.
* Every invitation, change, reset, activation and sign-in is in the audit trail.

### Emailing exports and approval requests

* **Email** next to every file on the Exports page, and **Email for approval** on a bill waiting for sign-off.
  Recipients are suggested by role, the file (or the original invoice) is attached, and the email says what it is and
  who uses it, with a link back to Penny.
* Penny only emails its own users and addresses in `email.allowed_domains` (rules.json), at most 10 at a time, and
  refuses anything else with the reason. Viewers cannot send.
* **Real email from a computer** (`ap_workflow/mailer.py`) through the company's mail account, set with environment
  variables so the password is never in a file. Without a mail server, each email is saved and marked "Saved, not
  sent", so an Admin can pass an invitation link on. Once an invitation or reset is really sent, its link is blanked out
  of the saved copy. `./penny email status` shows the settings (never the password) and `./penny email test --to ...`
  sends one test message and says in plain words what to check if it fails. The help center explains trying it
  safely with a free test inbox such as Mailtrap.
* **Outbox page:** every email with who sent it, to whom, when, its attachments (name, size, SHA-256) and whether it
  was Sent, Saved or Failed. Admins see all; others see their own. In the public demo, messages are kept in the browser.

### Appearance for everyone

* **Colors:** follow the company look, or choose your own: seven presets (Penny teal, Harbor blue, Evergreen, Plum,
  Copper, Graphite, High contrast) or any custom color, plus a background (cool gray, warm paper, soft blue) and
  rounded or square corners.
* **Readable by design:** a custom color is checked against WCAG AA. If it is too light (or too dark in dark mode),
  Penny uses the nearest shade that passes and says so. Every preset is generated the same way for light and dark.
* **Comfort, always personal:** light, dark or match the device; four text sizes; comfortable or compact density;
  and reduce motion.
* **Company look (Admin):** saved as the rule `display.theme` with a reason, so it appears in the Rules change history
  and the audit trail and can be undone. Settings are saved to each account (on the server when accounts are on).

### Testing

* 85 Python tests; 51 run without the assessment package. New ones cover invitations (single use, stored only as a
  hash, expiry, Admin only, duplicates), passwords (weak, containing a name, never stored), sign-in (lockout, idle
  timeout, the same message for unknown emails), Admin changes and every guard, forgot password, the mailer (saved
  without a server, links blanked once sent, failures recorded), and the server (data needs a session, an HttpOnly
  SameSite cookie, a Viewer cannot claim to be an Admin, invite and activate end to end, email with attachments, the
  allowed-domain rule, and a path-trick file name refused).
* Browser runs in both modes: the public demo (invite, activate, sign in, roles, turn off, reset, guards, forgot
  password, email exports and approvals, Outbox, audit trail, phone width) and a computer with real accounts (server
  sign-in, invite saved with its link, activation, a new Viewer, a forged Admin request refused, server audit log):
  35 checks. Appearance: 16 checks, including contrast measured in the page. No page errors, and the earlier browser
  suites still pass.

---

## What comes next (planned, not built)

| Next step | What it adds |
|---|---|
| Source highlighting | Show where on the PDF each value came from: the total, the PO, the invoice number. |
| Export history | Track each Intacct file from created, to downloaded, to imported, to confirmed, so nobody imports a file twice. |
| A shared server | Run Penny for a whole team over the network (with https), and keep the sandbox actions (resolves, approvals, notes, rules) on the server as well. Accounts and email already work on one computer (v1.7.0). |
| Single sign-on | Sign in with the company's identity provider instead of demo accounts. |
| Watched inbox folder | Pick up new invoices from an email inbox or shared folder automatically, then preview them. |

These grow out of two ideas I recorded during the assessment: a full audit trail, and a safe way to handle new invoice
types and vendors.

---

## How the work after submission was done

Same method as the assessment: **AI reads, code decides, people approve.** I directed the work and reviewed every
change. Claude Code wrote the code and tests with me in a cloud session. Each change was proven with a test that fails
on the old code and passes on the new code. Every web view screen was checked with automated screenshots, including on
a phone-sized screen.

Each version is its own pull request, so the history stays easy to review.
