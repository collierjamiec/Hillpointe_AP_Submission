# Hillpointe AP Submission / Penny

Jamie's submission for the Hillpointe AP technical screen. "Penny" is the AP automation workflow in `04_Workflow/`:
it reads vendor invoice PDFs, applies the AP Coding Rules, and writes a Sage Intacct import CSV, an Entrata handoff,
an exception log, required approvers and a review workbook. Motto: AI reads, code decides, people approve.

Penny was built outside Claude Code. `04_Workflow/README.md` is the full reference (checks in order, duplicate logic,
where each rule lives, assumptions). Read it before changing behavior.

## Layout

- `00_START_HERE.md`, `01_`–`05_` folders: the submitted package. Treat `02_Batch01_Deliverables` and
  `03_Rerun_Evidence` as submitted outputs; don't regenerate or edit them unless asked.
- `04_Workflow/ap_workflow/`: the code. `extract.py` (PDF → fields), `rules.py` (all decisions, ~800 lines),
  `outputs.py` (files + Intacct pre-flight), `register.py` (processed-invoice register), `cli.py` (commands),
  `llm_extract.py` (optional Claude extraction, never run live).
- `04_Workflow/config/rules.json`: thresholds, routes, keywords. Prefer rule changes here over code.
- `04_Workflow/state/`: the register (`processed_register.csv`, `run_log.csv`). Runs read and write it.
- `04_Workflow/runs/<run-id>/`: run outputs.

## Running

The input package lives at `~/Downloads/Hillpointe_AP_Technical_Screen` (not next to this folder), so pass it:

```bash
cd 04_Workflow
export HILLPOINTE_PACKAGE=~/Downloads/Hillpointe_AP_Technical_Screen
./penny test                                   # 33 checks, uses temp dirs, safe
./penny run 1 -n --package "$HILLPOINTE_PACKAGE"   # dry run, saves nothing
```

`./penny run`, `demo` and `reset` change `state/` and `runs/`; use `-n` for a dry run unless real output is wanted.
`.venv` was created by `./penny install`. System Python is 3.9, so reportlab is capped below 5.

## Conventions

- Money is `Decimal`, never float.
- Every decision change should come with a test in `tests/test_workflow.py`; `tests/expected_decisions.json` holds the
  expected outcome per sample document.
- Git repo on `main`, pushed to public GitHub repo `collierjamiec/Hillpointe_AP_Submission` (remote `origin`). Commit only when Jamie asks.
