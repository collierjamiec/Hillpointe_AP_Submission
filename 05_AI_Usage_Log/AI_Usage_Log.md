# AI usage log

## Tools used

| Tool | Used for | When |
|---|---|---|
| Claude Code (model Sonnet 5.5) | Reading the package, working out the expected answer for every document, writing the code and tests, drafting the README and summary, and then revising all of it from my feedback | Oct 20, 2026 |
| Python libraries `pdfplumber`, `openpyxl`, `reportlab`, `python-docx` | Reading PDFs and Excel, writing the output files, generating synthetic test invoices, building the summary | Build time |
| Claude API (optional extractor) | Reading documents that do not match the sample layouts | **Not used for any result in this package.** The code path exists and is tested offline only (see below). |

At run time, in the default mode, the workflow uses **no AI and no network**. That was a deliberate choice so the live session cannot fail on a connection problem and so the same document always gets the same answer.

## How the work was directed

**Where I started.** I started a new thread in Claude and discussed the assessment there. Claude had context on my experience with Hillpointe to date. I shared the recruiter email and the assessment package, and we worked through it together.

**The first build.** Claude Code read the whole package and produced a full first version: it worked out the expected answer for every document before writing code, then built the pipeline, the rules file, the register and the tests. The sections after it cover how I reviewed, tested, questioned and steered the work from there.

### Part 1: How Claude Code built the first version

| Step | Goal | What the AI did | How it was checked |
|---|---|---|---|
| 1 | Understand the package | Unpacked the zip and read the brief, the AP policy, the master data, the history, the template, 20 invoices and 12 contract documents | Read every file, including visual checks of two PDFs that had watermarks and one lien waiver |
| 2 | Know the right answer first | Worked out the expected decision for all 20 documents **by hand from the policy before writing code**, saved as `tests/expected_decisions.json` | The answer key was written first so the code could not grade itself |
| 3 | Build a system, not a one-off file (the brief says a thoughtful system beats a perfect hand built file) | Designed the pipeline: extract, validate, decide, pre-flight, write and remember. Put every threshold, route and keyword in `config/rules.json` | Design reviewed against the brief's four scoring areas |
| 4 | Make it safe to rerun | Built the register (`state/processed_register.csv`), the duplicate key (vendor plus cleaned invoice number), and the held versus entered distinction | Four runs; a script proves no bill appears in two import files |
| 5 | Prepare for unseen invoices | Generated synthetic invoices and pay applications for 17 edge cases (PO tolerance boundary, inactive vendor, wrong lien waiver, CFO threshold, revised invoice, closed period and more) | 33 automated tests, all passing |
| 6 | Make it explainable | Added a pass or fail decision trail for every document and an `explain` command | Printed the trail for three documents and read it against the policy |

### Part 2: How I reviewed it and changed it

This part covers my review and the changes I directed, over several rounds.

| Round | What I did or decided | What changed |
|---|---|---|
| Understand it | Clarified expectations with Claude: what the assessment asked for, what was built, and why | Expectations and scope were confirmed before any further changes |
| Compare to the brief | Asked for the work to be checked against the written instructions and the grading criteria, then asked what should be tightened | A candid list of gaps: the live API path was never run, the parser is tuned to the sample layouts, lien waiver signatures are blank in every sample, and the time estimate is an estimate. All are stated in this log and the README |
| Stress test | Went through every decision with a fine tooth comb, stress testing the system and making it evaluate and reevaluate why it made each call, in case refinement was needed | Each call was traced back to a rule. I settled that the $500 PO tolerance is a business decision, so it stays one editable line in the config, not a number buried in code |
| Keep scope honest | Decided what should and should not go in the package. I kept the summary to the one page they asked for and chose not to add a roadmap section to the README | The package answers the brief and nothing more. I will cover next phases in the live session |
| Think in phases | Described where this should go next: a full audit trail across the system's whole lifetime so the team can see why decisions were made and find improvements, and a way to handle new invoice types and new vendors safely, with verification before anything is entered. I decided not to build these before the deadline | Documented as direction only. The audit trail and the `explain` command that exist today are the first step |
| Rigorous testing and experimentation | Ran the system hands on, repeatedly, and addressed user experience opportunities including filenames, syntax, and output display | Claude Code added a short command name (`./penny`), plain "why" lines, a separate block for each document with who to send it to, one-command setup (`./penny install`), `./penny test` and `./penny reset` |
| Check the paperwork | Asked whether the README and other files matched the changes | Two real problems were found and fixed: scripts that would have failed on a clean machine, and a library missing from the requirements. Both were tested from a clean unzip |
| Cost | Chose not to pay for API access just to prove an optional feature in a take-home | The live Claude extraction path is written and tested offline only, and is described that way |

## Key prompts I used to refine the system

These are my own words, lightly cleaned for typos and filler, with what each one led to.

| My prompt | What it led to |
|---|---|
| "Is there anything that we should tighten up, reconsider, or do better?" | A candid list of gaps: the live API path was never run, the parser is tuned to the sample layouts, lien waiver signatures are blank in every sample, and the time estimate is an estimate. All four are stated in this log and the README |
| "I want to make sure that the exception log is clear and contains that information." (about Treasury verifying a payment change by calling the number on file) | Confirmed the Sterling hold reason says to call the phone number on file and never use contact details printed on the invoice, in both the reason and the route |
| "I want to extend this application so that there is an audit trail for every interaction, every document that is scanned, every decision that is made, and why, and how it points back to the rules. It should help us identify ways to improve the system." | Recorded as the next phase, not built before the deadline. The per document decision trail and the `explain` command are the first step |
| "The system needs to be able to adjust to new invoice types and parse them appropriately, even when it has no reference point for where data sits on the invoice." | Recorded as direction. The optional `hybrid` extractor is the starting point, and it is described as untested against the live API |
| "I want to download the assessment project locally so that I can run it on my computer." | A ready to run copy of the workflow with the assessment data beside it, for hands on testing |
| "The commands are bulky, not user friendly or easy to remember. The summary for why an invoice was held or skipped isn't very verbose, so it is hard to tell at a glance why something was held or skipped." | A plain "why" line for every document, and shorter commands (`run 1`, `explain 6`, `-n` for a dry run) |
| "Can we change the commands to something easier that doesn't have a python command on the command line? Should we give this application a name and reference the app name instead of python3?" | The workflow was named Penny, with a launcher (`./penny`) for Mac and Windows |
| "Can we create an install command that installs the required libraries? That way it's easy to get started with and I could demonstrate it from install through live execution." | `./penny install`, which builds a private environment, installs the libraries and checks that everything works, plus `./penny check`, `./penny test` and `./penny reset` |
| "Does this look like a good user experience to you? I think the table looks too condensed, it's hard to tell where one entry ends and a new one begins." | The run table was redesigned: a separate block per document, a clear status label, the full reason, and who to send it to |
| "Did you also update our README and any other associated files that should reflect our changes?" | An audit that found two real defects, scripts that would have failed on a clean machine and a library missing from the requirements. Both were fixed and tested from a clean unzip |

## Problems the checks caught (and how they were fixed)

Each problem below was found by running and testing the system, then fixed.

1. **Watermarks garbled the text.** REPRINT and PAST DUE stamps were mixed into the invoice text ("SubtotTal", "Rental IRnc"). The first fix did not work because the PDF library reports rotated text as upright. Found by running the extractor on all 20 files and reading the output. Fixed by reading the text matrix. Stamps are now reported separately.
2. **Units with digits.** `4WK` and `2WK` did not match the line item pattern, so two Ridgeway invoices failed their own arithmetic check. The arithmetic validation caught it, which is the reason the validation step exists.
3. **A resend looked like a rerun.** APINBOX_0019 is a byte for byte copy of APINBOX_0003. The first version treated identical content as "same file, skip". Policy says a resend is a duplicate for the AP Manager. Fixed: a skip now needs the same inbox file name and the same content. A different file with the same invoice is a DUP.
4. **A revised invoice flagged itself.** On a rerun, HPA-31877 was called a duplicate of itself. Fixed by checking "same inbox file" first.
5. **Invoice numbers with spaces.** A synthetic `inv 0020417` was read as `inv`, so a duplicate got through. Fixed, and covered by a test.
6. **Register said the wrong run.** A bill held in run 1 and entered in run 3 still said "first run 1". Fixed so the entered run is recorded and the earlier hold is kept in the note.
7. **Noise on held documents.** Informational notes about tax allocation appeared on documents that were not entered. Fixed.

## Prompts

The AI was given the assessment brief, the policy and the data. Two prompts that matter, because they are inside the product:

* **`prompts/extraction_prompt.md`** is the system prompt and JSON schema for the optional Claude extractor. It says "read, never decide": copy values as printed, no guessing, null when missing, and no policy in the prompt. Policy lives in code where it can be tested.
* **The answer key rule.** The working method that shaped everything: work out the correct answer for every document from the policy first, then build the system and test it against that key.

## What I did not delegate

* Deciding what counts as a hold. That comes from the AP policy, not from the model.
* What goes in the package and what does not, how long the summary is, and what I save for the live session.
* Which problems matter. The usability fixes, the next-phase direction and the decision to keep the policy numbers editable all came from my review.
* Signing off on the assumptions. They are listed in the README so the AP team can overrule them.
* Confirming signed lien waivers, calling Treasury, approving bills. The system routes these to people.

## Honest limits

* The live Claude extractor (`--extractor llm` and `hybrid`) was written and tested offline for fallback, merge and credit sign. It was **not run against the API**, because API access was not used while this was built.
* The rules extractor was built against the sample layouts. A very different layout fails validation and goes to a person.
* Time estimates in the summary are estimates, not measurements.
