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
| **Live demo** | The web app with the example invoices, in your browser. Pick a demo role to sign in. | [collierjamiec.github.io/Hillpointe_AP_Submission](https://collierjamiec.github.io/Hillpointe_AP_Submission/) |
| **The assessment (v1.0)** | The package as submitted in October 2026 | [`00_START_HERE.md`](00_START_HERE.md) |
| **Built after submission (v1.1 to 1.9.0)** | A full web app: roles, new batches, blockers, manual entry, user accounts, email, appearance settings, updates, source highlighting, export history and a watched folder | [`SCOPE.md`](SCOPE.md) |
| **Current version: 1.9.0** | What changed in each release, and whether it is required | [Releases](https://github.com/collierjamiec/Hillpointe_AP_Submission/releases) |
| **Where it is going** | The plan to 2.0: a shared server for a real team | [`ROADMAP.md`](ROADMAP.md) |
| **How it works** | Every check, rule and assumption | [`04_Workflow/README.md`](04_Workflow/README.md) |

## Try it

```bash
cd 04_Workflow
./penny install                                         # once
./penny demo --package /path/to/Hillpointe_AP_Technical_Screen
./penny web-export --package /path/to/Hillpointe_AP_Technical_Screen
./penny web --package /path/to/Hillpointe_AP_Technical_Screen   # opens the web app; New batch can run invoices
```

In the web view, pick any of the four demo roles on the sign-in screen. Everything you do stays in your browser.

For a team on one computer, turn on real accounts and email (all optional):

```bash
./penny users invite --email you@company.com --name "Your Name" --role admin   # the first Admin; then invite others in the web app
./penny email test --to you@company.com          # after setting PENNY_SMTP_* (see Help > Emailing exports)
./penny update                                    # take a new version when one is out
```

## Original scope versus what I added

* **Asked for:** an Intacct import file, an Entrata handoff, an exception log, required approvers, rerun proof, a
  one-page summary and an AI usage log.
* **Added in the submission:** an answer key written before the code, 33 tests with synthetic edge cases, a decision
  trail for every document, an Intacct pre-flight check, all rules in one settings file, and the simple `./penny`
  commands.
* **Added after submission:** bad files are held with a clear reason instead of crashing a run (v1.1), a web view
  (v1.2), and then sign-in with four roles, real actions, an audit trail, a rules editor with an impact preview, a
  redesigned interface, a help center, and an honest reason for bills in unfamiliar layouts (v1.3), then uploading
  and running new batches from the browser, suggested fixes that learn, and usage insights (v1.4), then blockers
  with owners and evidence, recheck previews, a rule simulator, manual entry with a second-person check, and a
  most-urgent-first queue (v1.5), the version on every screen with required or optional updates (v1.6.0), and user
  management, emailed exports and approvals, and appearance settings (v1.7.0), and a foundation release with browser
  tests on every pull request, a content security policy and a description on every function (v1.8.0), and then
  highlighting on the PDF of where each value came from, a history for each import file so nothing is imported
  twice, a watched inbox folder, paging for long lists and an accessibility pass (v1.9.0).

The full story, version by version, is in [`SCOPE.md`](SCOPE.md).

---

Built by Jamie Collier with Claude Code. Example data comes from the Hillpointe AP technical screen.
