# Hillpointe AP Technical Screen: Submission

Candidate: Jamie Collier  |  Submitted: October 2026

> **Note added November 2026.** Folders `01` to `05` are the package as submitted. I have kept building Penny since
> then. Everything added after submission is listed, version by version, in [`SCOPE.md`](SCOPE.md).

## What is in this package

| Folder | What it holds |
|---|---|
| `01_One_Page_Summary` | Approach, accuracy checks, what still needs a person, time comparison, what I would build next (Word and PDF). |
| `02_Batch01_Deliverables` | The Sage Intacct import file (CSV for upload), the Entrata handoff list, the exception log, the required approvers, and one Excel workbook with all of it as tabs. |
| `03_Rerun_Evidence` | `RERUN_EVIDENCE.md` (start here), plus the full output of all four runs and the processed-invoice register. |
| `04_Workflow` | The code, config, prompts, tests and a README. Anyone on your team can rerun it. |
| `05_AI_Usage_Log` | Tools used, how the work was directed and checked, and problems found and fixed. |

## Results at a glance

| Run | Documents | Entered | Held | Duplicate | Rows in import file |
|---|---|---|---|---|---|
| Batch 01 | 15 | 7 (6 Intacct, 1 Entrata) | 6 | 2 | 11 |
| Batch 01 again | 15 | 0 | 6 | 2 | 0 |
| Batch 02 | 5 | 2 | 0 | 3 | 2 |
| Batch 02 again | 5 | 0 | 0 | 3 | 0 |

## Rerun it yourself

```bash
cd 04_Workflow
./penny install
./penny demo --package /path/to/Hillpointe_AP_Technical_Screen   # or ./run_demo.sh
./penny test                              # 48 checks today (33 at submission)
```

Python 3.9 or newer. No API key and no internet are needed for the default mode. See `04_Workflow/README.md` for how
the decisions work, where every rule lives, and the assumptions I made.

## Assumptions

Listed in `04_Workflow/README.md` under "Assumptions I made". They are all easy to change.

## One thing to know

The optional Claude extraction mode (`--extractor hybrid` or `llm`) is written and tested offline, but I did not run it
against the live API while building, so every result in this package comes from the deterministic rules parser.
