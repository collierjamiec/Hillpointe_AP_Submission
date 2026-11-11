# Penny: AP invoice automation

**AI reads. Code decides. People approve.**

Penny reads vendor invoices, applies a company's accounts payable rules, and tells the AP team exactly what to enter,
what to hold, and why. It writes a ready-to-upload Sage Intacct import file, an Entrata handoff, an exception log with
a route for every hold, and the required approvers. It also keeps a register, so running a batch again never enters a
bill twice.

Penny began as my answer to the Hillpointe AP technical screen. I have kept building it since, to show how I think
about a real product.

> **This is a portfolio project, not production software.** It works and it is tested, and I know what stands
> between it and running a real company's accounts payable. That list, with where Penny stands on each item, is in
> [`PRODUCTION.md`](PRODUCTION.md).

| | What it is | Start here |
|---|---|---|
| **Live demo** | The web app with the example invoices, in your browser. Pick a demo role to sign in. | [collierjamiec.github.io/Hillpointe_AP_Submission](https://collierjamiec.github.io/Hillpointe_AP_Submission/) |
| **The assessment (v1.0)** | The package as submitted in October 2026 | [`00_START_HERE.md`](00_START_HERE.md) |
| **Built after submission (v1.1 to 2.1.2)** | A full web app for a team: roles, new batches, blockers, manual entry, user accounts, email, appearance, updates, source highlighting, export history, a watched folder, and one shared server with live updates | [`SCOPE.md`](SCOPE.md) |
| **Current version: 2.1.2** | What changed in each release, and whether it is required | [Releases](https://github.com/collierjamiec/Hillpointe_AP_Submission/releases) |
| **Why I made each choice** | Every major decision, what I weighed, and what I chose not to build | [`DECISIONS.md`](DECISIONS.md) |
| **Change log** | Every version, what changed, where the idea came from, and what was tested | [`CHANGELOG.md`](CHANGELOG.md) |
| **What production would take** | Sign-in with Microsoft and Google, an outside security test, real connections, real invoices, and more | [`PRODUCTION.md`](PRODUCTION.md) |
| **Where it is going** | The plan that led to 2.0, and what is intended next | [`ROADMAP.md`](ROADMAP.md) |
| **How it works** | Every check, rule and assumption | [`04_Workflow/README.md`](04_Workflow/README.md) |

## Decisions I made

I made every decision in this project. An AI assistant wrote the code and often laid out options; I chose, reviewed
every change, and own the result. These six shaped everything else. The full list, with what I weighed each time, is
in [`DECISIONS.md`](DECISIONS.md).

| I decided | Because |
|---|---|
| **AI may read a document. It never decides what happens to a bill.** | In accounts payable a wrong answer is money leaving the company. Rules in code give the same answer every time and can be tested. |
| **Work out the right answer before writing the code.** | So the code could never grade its own work. |
| **Say what really happened, in plain words.** "Ready for Intacct import", never "entered" or "paid". | A label that overstates is how a team comes to believe a bill was paid when it was not. |
| **Some steps need a second person, and the audit trail can only grow.** | One person checking their own work finds fewer mistakes, and a record that can be edited is not evidence. |
| **Fix the foundation and review security before adding more.** | I did not want to build a shared server on tests that ran only on my machine. The security review then found a real problem, which I fixed and published. |
| **List what is not done.** | A reviewer will find the gaps anyway. I would rather they hear them from me, with the reason. |
| **Call it a portfolio project, not production software.** | Some of what production needs I cannot do here: a company's real systems, an outside auditor, real people to test with. Saying so shows I know the difference. |

## Try it

The easy way: open the `04_Workflow` folder and double-click **Install Penny**. It installs Penny and opens a setup
wizard in your browser. After that, double-click **Start Penny**. The same steps by hand:

```bash
cd 04_Workflow
./penny install                                         # once
./penny setup                                           # the setup wizard, in your browser
./penny demo --package /path/to/Hillpointe_AP_Technical_Screen
./penny web-export --package /path/to/Hillpointe_AP_Technical_Screen
./penny web --package /path/to/Hillpointe_AP_Technical_Screen   # opens the web app; New batch can run invoices
```

In the web view, pick any of the four demo roles on the sign-in screen. With the demo roles, everything you do stays
in your browser.

For a team, the setup wizard turns on real accounts, where one server checks and saves everyone's work. By hand:

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
  twice, a watched inbox folder, paging for long lists and an accessibility pass (v1.9.0), and a layout made for
  phones (v1.9.1), and Penny for a real team: one server that checks and saves everyone's work in a database,
  live updates between teammates, and https for use over a network (v2.0.0), followed by a security review that
  found and fixed a way around sign-in (v2.0.1), and a setup wizard that installs Penny and gets it ready from
  a double-click (v2.1.0), the reasons for my decisions written into every page (v2.1.1), and an honest list of what production would
  take (v2.1.2).

The full story, version by version, is in [`SCOPE.md`](SCOPE.md).

---

Built by Jamie Collier with Claude Code. Example data comes from the Hillpointe AP technical screen.
