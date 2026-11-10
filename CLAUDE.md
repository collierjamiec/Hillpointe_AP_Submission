# Hillpointe AP Submission / Penny

Jamie's submission for the Hillpointe AP technical screen. "Penny" is the AP automation workflow in `04_Workflow/`:
it reads vendor invoice PDFs, applies the AP Coding Rules, and writes a Sage Intacct import CSV, an Entrata handoff,
an exception log, required approvers and a review workbook. Motto: AI reads, code decides, people approve.

Penny was built outside Claude Code. `04_Workflow/README.md` is the full reference (checks in order, duplicate logic,
where each rule lives, assumptions). Read it before changing behavior.

## Layout

- `README.md` (GitHub landing page) and `SCOPE.md` (original assignment vs. everything added after submission, by version).
  Any new feature gets a version entry in `SCOPE.md` and an "(added after submission)" mark in the docs it touches.
- `00_START_HERE.md`, `01_`–`05_` folders: the submitted package. Treat `02_Batch01_Deliverables` and
  `03_Rerun_Evidence` as submitted outputs; don't regenerate or edit them unless asked.
- `04_Workflow/ap_workflow/`: the code. `extract.py` (PDF → fields), `rules.py` (all decisions, ~800 lines),
  `outputs.py` (files + Intacct pre-flight), `register.py` (processed-invoice register), `cli.py` (commands),
  `llm_extract.py` (optional Claude extraction, never run live), `webexport.py` (runs → `web/data/penny-data.json`),
  `webserver.py` (local server behind `./penny web`: batch upload/run, recheck, simulate and manual-entry API,
  permissions, `state/batch_log.jsonl`), `replay.py` (re-decide saved readings on a scratch register: recheck and the
  rule simulator), `manual.py` (manual entry → the reader's record shape; `<file>.keyed.json` in a batch folder),
  `version.py` (VERSION + releases.json, update check, required-update gate, `./penny release`),
  `accounts.py` (real accounts once `state/users.json` exists: PBKDF2 hashes, hashed one-time links, HttpOnly session
  cookie, Admin guards), `mailer.py` (SMTP from `PENNY_SMTP_*` env vars, else saved to `state/outbox/`).
- `state/users.json`, `state/tokens.json` and `state/outbox/` hold personal data and are git-ignored. Never commit them.
  With accounts on, the server ignores any user the browser sends and acts as the session's user.
- `04_Workflow/VERSION` and `04_Workflow/releases.json`: the current version (three parts) and every release. A new
  release is made with `./penny release <x.y.z> --summary "..."` (never by hand), which also updates
  `web/data/releases.json` and `APP_VERSION` in `web/assets/penny-core.js`; a test checks all four agree.
- `04_Workflow/inbox/<YYYY-MM-DD>_<name>/`: batches uploaded through the web app (git-ignored).
- `04_Workflow/web/`: the browser app (plain HTML/CSS/JS, no build step). `assets/penny-*.js` (13 files by area, loaded in order by `index.html`, sharing top-level names; `penny-core.js` first, `penny-app.js` last; no inline scripts, the page has a content security policy),
  `assets/penny-auth.js` (demo sign-in, PBKDF2 hashes), `assets/penny-help.js` (help center articles), `assets/penny.css`
  (design tokens at the top). It never re-decides an invoice: human actions are events in a browser-only audit log.
  Labels must stay honest: ENTER_INTACCT is "Ready for Intacct import", never "entered" or "paid".
- `04_Workflow/config/rules.json`: thresholds, routes, keywords. Prefer rule changes here over code.
- `04_Workflow/state/`: the register (`processed_register.csv`, `run_log.csv`). Runs read and write it.
- `04_Workflow/runs/<run-id>/`: run outputs.

## Running

The input package lives at `~/Downloads/Hillpointe_AP_Technical_Screen` (not next to this folder), so pass it:

```bash
cd 04_Workflow
export HILLPOINTE_PACKAGE=~/Downloads/Hillpointe_AP_Technical_Screen
./penny test                                   # 91 checks, uses temp dirs, safe
./penny run 1 -n --package "$HILLPOINTE_PACKAGE"   # dry run, saves nothing
```

`./penny run`, `demo` and `reset` change `state/` and `runs/`; use `-n` for a dry run unless real output is wanted.
`.venv` was created by `./penny install`. System Python is 3.9, so reportlab is capped below 5.

## Conventions

- Money is `Decimal`, never float.
- Every decision change should come with a test in `tests/test_engine.py` (web and server tests go in `test_web.py`,
  accounts, email, versions and security in `test_platform.py`; shared setup is `tests/common.py`). Browser suites live in
  `tests/browser/` and run with `python tests/browser/run.py`; add to them when the web app changes.
- Every function gets a one-line description. `ROADMAP.md` is the plan to 2.0: update its status column in the same
  change as the work.
- For decisions: `tests/expected_decisions.json` holds the
  expected outcome per sample document.
- `.github/workflows/tests.yml` runs the package-free tests on every pull request; keep them passing without the package.
- Git repo on `main`, pushed to public GitHub repo `collierjamiec/Hillpointe_AP_Submission` (remote `origin`). Commit only when Jamie asks.
