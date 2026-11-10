# Penny: AP invoice automation

**AI reads. Code decides. People approve.**

Penny reads vendor invoices, applies a company's accounts payable rules, and tells the AP team exactly what to enter,
what to hold, and why. It writes a ready-to-upload Sage Intacct import file, an Entrata handoff, an exception log with
a route for every hold, and the required approvers. It also keeps a register, so running a batch again never enters a
bill twice.

Penny began as my answer to the Hillpointe AP technical screen. I have kept building it since, to show how I think
about a real product.

| | What it is | Start here |
|---|---|---|
| **The assessment (v1.0)** | The package as submitted in October 2026 | [`00_START_HERE.md`](00_START_HERE.md) |
| **Built after submission (v1.1+)** | Safer handling of bad files, and a web view in the browser | [`SCOPE.md`](SCOPE.md) |
| **How it works** | Every check, rule and assumption | [`04_Workflow/README.md`](04_Workflow/README.md) |

## Try it

```bash
cd 04_Workflow
./penny install                                         # once
./penny demo --package /path/to/Hillpointe_AP_Technical_Screen
./penny web-export --package /path/to/Hillpointe_AP_Technical_Screen
./penny web                                             # opens the web view in your browser
```

## Original scope versus what I added

* **Asked for:** an Intacct import file, an Entrata handoff, an exception log, required approvers, rerun proof, a
  one-page summary and an AI usage log.
* **Added in the submission:** an answer key written before the code, 33 tests with synthetic edge cases, a decision
  trail for every document, an Intacct pre-flight check, all rules in one settings file, and the simple `./penny`
  commands.
* **Added after submission:** bad files are held with a clear reason instead of crashing a run (v1.1), and a polished,
  role-aware web view (v1.2).

The full story, version by version, is in [`SCOPE.md`](SCOPE.md).

---

Built by Jamie Collier with Claude Code. Example data comes from the Hillpointe AP technical screen.
