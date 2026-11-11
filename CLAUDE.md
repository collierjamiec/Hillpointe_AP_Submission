# Hillpointe AP Submission / Penny

Jamie's submission for the Hillpointe AP technical screen. "Penny" is the AP automation workflow in `04_Workflow/`:
it reads vendor invoice PDFs, applies the AP Coding Rules, and writes a Sage Intacct import CSV, an Entrata handoff,
an exception log, required approvers and a review workbook. Motto: AI reads, code decides, people approve.

Penny was built outside Claude Code. `04_Workflow/README.md` is the full reference (checks in order, duplicate logic,
where each rule lives, assumptions). Read it before changing behavior.

## Layout

- `README.md` (GitHub landing page; leads with screenshots from `docs/screenshots/`), `GETTING_STARTED.md` (for
  people who download the project; keep its steps true by running them on a fresh clone), `CASE_STUDY.md` (the
  short story of the project), `SCOPE.md` (original assignment vs. everything added after submission, by version)
  `DECISIONS.md` (every major decision, what Jamie weighed, and why; all credited as Jamie's decisions) and
  `PRODUCTION.md` (Penny is a portfolio project, not production software: what production would take, where Penny
  stands on each item, and why it is not done here; sign-in with Microsoft then Google is the intended next build).
  Never describe Penny as production ready. When a feature closes a gap listed in `PRODUCTION.md`, update that row.
- `CHANGELOG.md`: every version, newest first. **Every release adds a section here** (where it started, in Jamie's
  words when there are any; Added / Changed / Fixed / Security; Tested; Not done), a row in the table at the top, a
  row in "Penny by the numbers", and any new ideas in "Ideas, and where each one went". A required release says
  `**Required.**`. `test_every_release_is_in_the_change_log` fails until this is done. A new
  feature also gets a "Why I built this" line in `SCOPE.md`, an entry in `DECISIONS.md` when it involved a real choice,
  and a "Why it works this way" note on its help article. Only write reasons Jamie has stated or confirmed.
  Any new feature gets a version entry in `SCOPE.md` and an "(added after submission)" mark in the docs it touches.
- `00_START_HERE.md`, `01_`–`05_` folders: the submitted package. Treat `02_Batch01_Deliverables` and
  `03_Rerun_Evidence` as submitted outputs; don't regenerate or edit them unless asked.
- `04_Workflow/ap_workflow/`: the code. `extract.py` (PDF → fields), `rules.py` (all decisions, ~800 lines),
  `outputs.py` (files + Intacct pre-flight), `register.py` (processed-invoice register), `cli.py` (commands),
  `llm_extract.py` (optional Claude extraction, never run live), `webexport.py` (runs → `web/data/penny-data.json`),
  `webserver.py` (local server behind `./penny web`: batch upload/run, recheck, simulate and manual-entry API,
  permissions, the audit log; `--host`/`--https` for a team), `store.py` (v2.0: `state/penny.db`, SQLite; an `events`
  table that triggers make append-only, plus accounts), `actions.py` (v2.0: every web action checked on the server:
  role, conflicts, second-person rules; rule changes written to `config/rules.json`), `replay.py` (re-decide saved readings on a scratch register: recheck and the
  rule simulator), `manual.py` (manual entry → the reader's record shape; `<file>.keyed.json` in a batch folder),
  `version.py` (VERSION + releases.json, update check, required-update gate, `./penny release`),
  `accounts.py` (real accounts once someone is invited; stored in the database since v2.0: PBKDF2 hashes, hashed one-time links, HttpOnly session
  cookie, Admin guards), `mailer.py` (SMTP from `PENNY_SMTP_*` env vars, else saved to `state/outbox/`),
  `watcher.py` (the watched inbox folder behind `./penny web --watch`: picks up finished PDFs, previews only),
  `setup.py` (v2.1: the setup wizard behind `./penny setup`; `web/setup.html` + `assets/penny-setup.js`; every
  `/api/setup` request needs that run's one-time key; choices saved to `state/setup.json` and used by `./penny start`).
- `Install Penny.command` / `.bat` and `Start Penny.command` / `.bat` in `04_Workflow/`: double-click launchers that
  run `ap.py install` + `./penny setup`, and `./penny start`. Keep the `.command` files executable.
- `state/penny.db*`, `state/*.moved`, `state/tls/` and `state/outbox/` hold personal data or private keys and are
  git-ignored. Never commit them. The register (`processed_register.csv`, `run_log.csv`) stays a file on purpose.
- Team mode (v2.0): with real accounts the server is the source of truth. The browser sends each action to
  `POST /api/events` and keeps nothing in localStorage; `web/assets/penny-team.js` handles sending, rollback and live
  updates. The public demo and demo-account mode still use the browser sandbox. `ROLE_CAN` and `NEEDS` in
  `actions.py` must match `ROLES` and `EVENT_NEEDS` in `penny-core.js`; a test checks it.
  With accounts on, the server ignores any user the browser sends and acts as the session's user.
- Serving files safely (v2.0.1): `PennyHandler.plain_path()` decodes and normalizes the address before any check,
  and `open_to_all()` is a short allow-list of what is served without a session. Never test `self.path` or the raw
  URL for "is this private"; add to the allow-list on purpose. HEAD goes through the same gate.
- `04_Workflow/VERSION` and `04_Workflow/releases.json`: the current version (three parts) and every release. A new
  release is made with `./penny release <x.y.z> --summary "..."` (never by hand; `./penny require <x.y.z>` marks one
  that is already out as required, and its `CHANGELOG.md` section must then say `**Required.**`), which also updates
  `web/data/releases.json` and `APP_VERSION` in `web/assets/penny-core.js`; a test checks all four agree.
- `04_Workflow/inbox/<YYYY-MM-DD>_<name>/`: batches uploaded through the web app (git-ignored).
- `04_Workflow/web/`: the browser app (plain HTML/CSS/JS, no build step). `assets/penny-*.js` (16 files by area, loaded in order by `index.html`, sharing top-level names; `penny-core.js` first, `penny-app.js` last; no inline scripts, the page has a content security policy),
  `assets/penny-tour.js` (v2.2: the guided tour; it only moves between pages and must never record an action; when a
  page it stops on changes, update its stops and `tests/browser/tour.spec.js`),
  `assets/penny-profile.js` (v2.3: My profile. A person changes their own name, title, about line, backup person and
  photo through `/api/me/profile`, and their password through `/api/me/password`. The username (sign-in email) and
  user id are never changeable, and role and status stay with an Admin. `accounts.import_profile()` fills a profile
  from Microsoft or Google details without overwriting hand-made changes; nothing calls it until that sign-in is
  built. Personal activity numbers are private to each person: never show them to anyone else),
  `assets/penny-auth.js` (demo sign-in, PBKDF2 hashes), `assets/penny-help.js` (help center articles), `assets/penny.css`
  (design tokens at the top). It never re-decides an invoice: human actions are events in an audit log (in the browser for the demo, on the server in team mode).
  Labels must stay honest: ENTER_INTACCT is "Ready for Intacct import", never "entered" or "paid".
- `04_Workflow/config/rules.json`: thresholds, routes, keywords. Prefer rule changes here over code.
- `04_Workflow/state/`: the register (`processed_register.csv`, `run_log.csv`). Runs read and write it.
- `04_Workflow/runs/<run-id>/`: run outputs.

## Running

The input package lives at `~/Downloads/Hillpointe_AP_Technical_Screen` (not next to this folder), so pass it:

```bash
cd 04_Workflow
export HILLPOINTE_PACKAGE=~/Downloads/Hillpointe_AP_Technical_Screen
./penny test                                   # 128 checks, uses temp dirs, safe
./penny run 1 -n --package "$HILLPOINTE_PACKAGE"   # dry run, saves nothing
```

`./penny run`, `demo` and `reset` change `state/` and `runs/`; use `-n` for a dry run unless real output is wanted.
`.venv` was created by `./penny install`. System Python is 3.9, so reportlab is capped below 5.

## Conventions

- Money is `Decimal`, never float.
- Every decision change should come with a test in `tests/test_engine.py` (web and server tests go in `test_web.py`,
  accounts, email, versions and security in `test_platform.py`; shared setup is `tests/common.py`). Browser suites live in
  `tests/browser/` and run with `python tests/browser/run.py`; add to them when the web app changes. When a screen
  shown in the README changes, retake the screenshots: start `python tests/browser/lab.py`, then
  `node tests/browser/screenshots.js`.
- Every function gets a one-line description, in Python (a docstring) and in the web app (a comment on the line above).
  `DescriptionTests` in `test_platform.py` fails without one, and when a file's `Sections:` header misses a section. `ROADMAP.md` was the plan to 2.0 (finished) and now lists what is
  intended next: update it in the same change as the work.
- For decisions: `tests/expected_decisions.json` holds the
  expected outcome per sample document.
- `.github/workflows/tests.yml` runs the package-free tests on every pull request; keep them passing without the package.
- Git repo on `main`, pushed to public GitHub repo `collierjamiec/Hillpointe_AP_Submission` (remote `origin`). Commit only when Jamie asks.
