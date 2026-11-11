# Decisions and why

This page lists the decisions I made while building Penny, and the reason for each one. A feature list tells you what
a product does. This tells you how I think.

**How decisions were made.** I made every decision on this page. I built Penny with an AI assistant (Claude Code),
which wrote the code and tests and often laid out options with a recommendation. I chose, I reviewed every change, and
I own the result. That is the same rule Penny itself follows: **AI reads, code decides, people approve.**

Each entry says what I decided, what I weighed, and why. Where a decision has a cost, I say that too.

| Jump to | |
|---|---|
| [What I believe](#what-i-believe) | The principles behind everything else |
| [The assessment](#the-assessment-version-10) | Version 1.0, as submitted |
| [People and trust](#people-and-trust) | Roles, second checks, the audit trail |
| [Honesty in the product](#honesty-in-the-product) | Labels, limits and saying "not found" |
| [The web app](#the-web-app) | How it looks, reads and behaves |
| [Accounts, email and updates](#accounts-email-and-updates) | Sign-in, mail and versions |
| [Running for a team](#running-for-a-team) | The database, the network and security |
| [How I worked](#how-i-worked) | Order of work, testing and scope |
| [What I chose not to build](#what-i-chose-not-to-build) | And why not, or why not yet |

---

## What I believe

### AI reads. Code decides. People approve.

* **Decision:** An AI model may read a document. It never decides what happens to a bill. Rules in code decide, and
  a person approves anything that matters.
* **What I weighed:** Letting a model make the call is faster to build and looks impressive in a demo.
* **Why:** In accounts payable, a wrong answer is money leaving the company. A rule in code gives the same answer
  every time and can be tested. A model cannot promise that. People stay responsible for the decisions only people
  should make: confirming a signed lien waiver, calling Treasury about a bank change, approving a bill.

### The right answer comes before the code

* **Decision:** I worked out the expected result for all 20 sample documents from the policy before any code was
  written, and saved it as the answer key.
* **Why:** So the code could never grade its own work. If the system and the answer key disagree, one of them is
  wrong, and I have to find out which.

### No AI and no network when Penny runs

* **Decision:** In its normal mode, Penny uses no AI and no internet connection while it reads and decides.
* **What I weighed:** An AI reader handles layouts the rules have never seen.
* **Why:** The same document should always get the same answer, and a run should never fail because a connection
  dropped. The AI reader exists as an option, and it is off by default.

### Business rules live in one file a person can read

* **Decision:** Every threshold, route and keyword is in one settings file, not scattered through the code.
* **Why:** A rule like the $500 PO tolerance is a business decision, not a programming one. The AP team should be
  able to change it in one line, see what the change would do, and undo it.

### A held bill is not entered at all

* **Decision:** If a document fails a check, none of it goes into the import file. Not even the lines that look fine.
* **Why:** A partly entered bill is harder to find and fix than one that is clearly waiting. Holding the whole
  document keeps the picture simple: it is in, or it is waiting on a person.

### Call it a portfolio project, not production software

* **Decision:** I describe Penny as a portfolio project. I do not call it production ready, and I keep a full list
  of what production would take in [`PRODUCTION.md`](PRODUCTION.md).
* **What I weighed:** "Production ready" sounds better, and much of Penny is built to that standard.
* **Why:** There are things production needs that I cannot do inside this project: a company's real systems and
  data, an identity provider, an outside auditor, real people and devices to test with. I do not need to do all of
  them here. I do need to show that I have thought about them, and to be exact about where Penny stops.

### Say what is not done

* **Decision:** Every release lists its limits in plain words, in the same place as its features.
* **What I weighed:** A list of limits can make a project look less finished.
* **Why:** A reviewer will find the gaps anyway. I would rather they hear them from me, with the reason. It also
  keeps me honest about the difference between "tested" and "tried by a real person".

---

## The assessment (version 1.0)

### Build a system, not a one-time file

* **Decision:** I built a process that can be run again and again, not a hand-made answer for one batch.
* **Why:** The brief said a thoughtful system beats a perfect hand-built file. A real AP team gets a new inbox every
  week. The value is in the fifth run, not the first.

### Prove a rerun is safe

* **Decision:** Penny keeps a register of what it has processed, and I included evidence that running a batch again
  enters nothing twice.
* **Why:** Paying a bill twice is the most common and most costly mistake in accounts payable. I wanted that to be
  something Penny proves, not something I promise.

### Keep the package to what was asked

* **Decision:** The summary is one page, as requested. I left a roadmap out of the submitted package.
* **What I weighed:** I had more ideas and wanted to show them.
* **Why:** Answering the brief exactly is part of the test. I saved the next phases for the live conversation.

### Do not pay to prove an optional feature

* **Decision:** I did not buy API access to run the optional AI reader for a take-home. It is written, tested
  offline, and described exactly that way.
* **Why:** The honest label costs nothing. Claiming it was proven live when it was not would cost my credibility.

### Name it, and make it easy to run

* **Decision:** I named the workflow Penny and gave it short commands like `./penny run 1`.
* **Why:** The first commands were long and easy to get wrong. If the AP team cannot install and run it in minutes,
  it does not matter how good the rules are.

### List my assumptions so the team can overrule them

* **Decision:** Where the brief was silent, I made a choice and wrote it down in the workflow README.
* **Why:** I do not know Hillpointe's books better than their AP team does. A listed assumption can be corrected. A
  hidden one becomes a surprise.

---

## People and trust

### Each role can do only its own job

* **Decision:** Four roles: Viewer, AP Clerk, Approver and Admin. An AP Clerk can preview a batch. Only an Admin can
  run one for real.
* **Why:** This is separation of duties. The person who prepares the work should not be the only person who can
  make it final.

### Some steps need a second person

* **Decision:** A different person must confirm an import, and a different person must re-key a manual entry over a
  set amount.
* **What I weighed:** It slows down a small team.
* **Why:** One person checking their own work finds fewer mistakes, and it is how fraud happens. The limit for
  manual entries is a setting, so a team can match it to their own policy.

### The audit trail can only grow

* **Decision:** Nothing in the audit trail is ever edited or deleted. An undo is a new entry that points at the one
  it undoes. In 2.0 the database itself refuses changes.
* **Why:** An audit trail that can be changed is not evidence. I wanted the answer to "who did this, and when" to be
  something nobody can quietly rewrite, including an Admin and including me.

### Every action needs a short reason

* **Decision:** Resolving a hold, sending a bill back, or changing a rule asks for a sentence saying why.
* **Why:** The next person, or an auditor a year later, needs to know why. It takes ten seconds now and saves an
  hour then.

### See what a rule change does before saving it

* **Decision:** The rules editor shows which invoices on file a change would affect before it is saved, and every
  change can be undone.
* **Why:** A rule change is powerful. Raising a tolerance by $1,000 might release ten held bills. The person making
  the change should see that first.

### Suggested fixes are offered, never applied by themselves

* **Decision:** Penny learns from how holds were resolved and suggests the same fix next time. A person still
  chooses it, and can undo it.
* **Why:** A suggestion saves time. An automatic fix would move the decision from a person to the software, which
  breaks the first rule on this page.

### The watched folder only previews

* **Decision:** Penny can pick up PDFs dropped into a folder, but it only ever runs a preview. It never runs a batch
  for real by itself, and it never deletes a file.
* **Why:** Nothing should be entered just because a file appeared in a folder. A scanner, an email rule or a mistake
  could put it there.

---

## Honesty in the product

### Labels say what really happened

* **Decision:** "Entered in Intacct" became "Ready for Intacct import". Penny writes files. It does not post or pay.
* **Why:** A label that overstates is how a team ends up believing a bill was paid when it was not. I checked every
  status in the app for this.

### Confidence is a word, not a percentage

* **Decision:** Penny says High, Medium or Low. It never shows "94% confident".
* **Why:** A percentage looks precise, and Penny has no honest way to produce one. A made-up number invites trust
  it has not earned.

### When Penny cannot find something, it says so

* **Decision:** If a value is not on the PDF as text, the highlight says "not found". An unfamiliar layout gets a
  reason that says what Penny saw, not a wrong guess.
* **Why:** My own test invoice was held with the reason "not a bill", which was wrong. It was a real bill in a
  layout Penny did not know. A safe hold with a wrong reason sends a person looking in the wrong place.

### The demo says it is a demo

* **Decision:** The public site states that its accounts and passwords are public and that it protects nothing.
* **What I weighed:** It makes the demo sound less impressive.
* **Why:** It still follows real security habits, so a reviewer can see them. But it would be dishonest to imply a
  static website keeps secrets.

### Import history is what people told Penny

* **Decision:** The export history records who downloaded, imported and confirmed a file. It says plainly that Penny
  did not do the import itself.
* **Why:** "Import recorded" must never be read as "approved" or "paid". Penny knows what a person told it, and
  that is all it should claim.

---

## The web app

### Most AP teams will never open a terminal

* **Decision:** I built a web app on top of the same engine the commands use.
* **Why:** The people who do this work every day should not need a command line. Using one engine for both means
  the web app and the terminal can never disagree.

### Plain language everywhere

* **Decision:** Hold reasons, help articles and error messages are written for someone new to the job.
* **Why:** "OVERPO" means nothing to a new AP clerk. "Goes over the purchase order balance" does. The short code
  stays visible for people who want it.

### Built for everyone

* **Decision:** Keyboard use, screen reader labels, color contrast, reduced motion and phone layouts are part of
  the work, checked on every change.
* **What I weighed:** It adds time to every feature.
* **Why:** A tool that some people on the team cannot use is not finished. I also say what is still unproven: no
  person who uses a screen reader every day has tried it yet.

### A status never depends on color alone

* **Decision:** Every status has a word and an icon as well as a color.
* **Why:** About one in twelve men cannot tell red from green reliably. Money decisions should not depend on that.

### Made for phones, not just squeezed onto them

* **Decision:** After 1.9.0 I checked every screen on a phone and rebuilt the lists as cards.
* **Why:** The pages fit, but the amount was hidden off screen and the filters filled the first screen. Fitting is
  not the same as working.

### My name on every screen

* **Decision:** "Designed and built by Jamie Collier" is on every page, including sign-in.
* **Why:** This is my work and I stand behind it. If something is wrong, people should know who to ask.

---

## Accounts, email and updates

### Real accounts live on the server, with the usual protections

* **Decision:** Passwords are stored only as scrambled fingerprints, links work once and expire, and sessions end
  when idle.
* **Why:** Even a small internal tool holds vendor and payment information. These habits are cheap to build in at
  the start and painful to add later.

### Real email, and an honest stand-in when there is none

* **Decision:** Penny sends real email when a mail account is set up. When it is not, messages go to an Outbox with
  working links, and the app says they were saved, not sent.
* **Why:** I wanted invitations and resets to work on day one, before anyone configures mail. And I did not want
  the app to say "sent" when nothing left the building.

### Attach the file, and only to people who should have it

* **Decision:** Emailing an export attaches the file itself. Penny only emails its own users and the company's
  allowed domains.
* **What I weighed:** A link is safer than an attachment, but the person receiving it may not have an account.
* **Why:** Approvers and Property Accounting need the file in front of them. The domain limit keeps financial files
  from going to a mistyped outside address.

### A company look, and a personal one

* **Decision:** An Admin sets the company's colors. Each person can still choose their own, plus text size and
  motion.
* **Why:** A company wants its tool to look like its own. A person with low vision needs larger text no matter what
  the company picked.

### The version is on every screen

* **Decision:** The version shows at the bottom of every page, with a What's new page.
* **Why:** When someone reports a problem, the first question is always "which version?". Now the answer is on
  their screen.

### A required update makes Penny read-only, not locked

* **Decision:** When a required version is out, older copies can still open everything. Only changes and real runs
  pause, with a warning banner that says why.
* **What I weighed:** Blocking the app completely is simpler and forces the update.
* **Why:** People still need to look things up during a close. Stopping changes protects the data. Locking people
  out of reading only punishes them.

### Optional updates can be skipped

* **Decision:** Only I, as the maintainer, mark a release as required. Everything else can be skipped until the
  next one.
* **Why:** Not every release matters to every team. Forcing a color-theme update on someone in the middle of month
  end teaches them to resent updates.

---

## Running for a team

### Foundation before features

* **Decision:** Version 1.8.0 added no features. It moved the browser tests into the project, added security
  headers, split one 4,451-line file into thirteen smaller ones, and described every function.
* **What I weighed:** A release with nothing new to show.
* **Why:** The next two releases were the biggest yet. I did not want to build a shared server on top of tests that
  only ran on my own machine.

### One server holds the truth

* **Decision:** In 2.0, everything people do is saved and checked on the server. Before, it was saved in each
  person's browser.
* **Why:** A team cannot share work that lives in separate browsers. And a check that runs in the browser is a
  suggestion. A check on the server is a rule.

### SQLite for the database

* **Decision:** One database file, built into Python, with nothing to install.
* **What I weighed:** A larger database server handles more people and more computers.
* **Why:** Penny is for an AP team, not thousands of users. A file with no setup means the team can run it without
  an IT project, and back it up by copying a folder.

### The register stays a plain file

* **Decision:** The record of processed invoices stays a CSV file. It did not move into the database, even though
  my own roadmap said it would.
* **Why:** The engine also runs from the terminal with no server. The submitted evidence compares those files. And
  a CSV is what an auditor opens. I changed the plan and said so in the roadmap.

### No network without real accounts and encryption

* **Decision:** Penny refuses to open to other computers unless people sign in with real accounts and the
  connection is encrypted.
* **What I weighed:** A flag to skip the check would make testing easier.
* **Why:** Without both, passwords and invoices would cross the network in the clear. The safe setup should be the
  only setup that works.

### Live updates never interrupt typing

* **Decision:** A teammate's work appears on your screen by itself. If you are in the middle of typing, Penny waits
  and offers to show the changes.
* **Why:** Losing a half-written note to a screen refresh is the kind of small thing that makes people stop
  trusting a tool.

### Review security before building anything else

* **Decision:** As soon as 2.0 opened Penny to a network, I stopped adding features and had the code reviewed for
  ways around its own checks.
* **Why:** The review found a real one: invoices could be downloaded without signing in. It had been there since
  1.7. I fixed it, made the fix a required update, and wrote down exactly what was wrong.

### Publish the security findings

* **Decision:** The help center lists each problem the review found, what it allowed and how it was fixed.
* **What I weighed:** Hiding it would look better.
* **Why:** Anyone running an older copy needs to know to update. And how a team handles a security problem tells
  you more about them than a claim that they never have any.

### Work moved in from a browser does not count as a sign-off

* **Decision:** Earlier work can be moved into the team's audit trail, but moved approvals and confirmations are
  history only.
* **What I weighed:** A bill approved before the move has to be approved again.
* **Why:** That work was never checked by the server. Letting it count would let one person bring in a made-up
  approval under someone else's name.

### Fix first, then feature

* **Decision:** When the security fix and the setup wizard were both in progress, I merged the fix by itself first.
* **Why:** A fix for a sign-in problem should not wait for a new feature to be finished.

### Setup should not need a manual

* **Decision:** A setup wizard in the browser, started by a double-click.
* **Why:** Setting Penny up for a team took six commands in the right order. That is fine for me and a barrier for
  an AP manager. The wizard is closed unless Penny opens it, because it can create an Admin.

---

## How I worked

### Keep the assignment and the extra work apart

* **Decision:** The submitted package stays untouched in its folders. Everything after is listed by version in
  [`SCOPE.md`](SCOPE.md) and marked "added after submission".
* **Why:** Anyone reviewing this should be able to see exactly what was asked for, what I handed in, and what I
  chose to build afterward.

### One version, one pull request

* **Decision:** Each release is its own reviewed change, with its own notes.
* **Why:** The history stays readable. Anyone can see what changed, when, and why.

### A change is proven by a test

* **Decision:** Each fix comes with a test that fails on the old code and passes on the new code.
* **Why:** "It works now" is a feeling. A test that failed and now passes is proof, and it stops the same problem
  from coming back.

### Test like a person uses it

* **Decision:** Alongside the code tests, automated browsers sign in as each role and use the real app, including
  three people at once and on a phone.
* **Why:** Code tests prove the rules. They do not prove a person can find the button.

### Keep a change log, and make the project enforce it

* **Decision:** [`CHANGELOG.md`](CHANGELOG.md) records every version: where the idea started, what changed and what
  was tested. A test fails if a release is ever missing from it.
* **Why:** We did a lot and had a lot of ideas after the first scope. I did not want that history to live only in
  my memory. A rule that depends on remembering gets forgotten, so the project checks it for me.

### Keep a roadmap, and keep it current

* **Decision:** [`ROADMAP.md`](ROADMAP.md) is updated in the same change as the work, including when I changed my
  mind.
* **Why:** A plan nobody updates is worse than no plan. I also wanted the things I added and the things I dropped
  to be visible, with the reason.

---

## What I chose not to build

| Not built | Why not, or why not yet |
|---|---|
| **Sign in with Microsoft or Google (yet)** | I intend to build this next: Microsoft work accounts first, then Google. It needs a Microsoft tenant and a Google Cloud project to build and test against. Building it against a pretend one would prove nothing. Penny's own accounts stay until then. |
| **Penny posting or paying** | On purpose. Penny prepares files and a person uploads them. Software that can move money needs controls this project does not claim to have. |
| **A percentage for confidence** | There is no honest way to calculate one. |
| **Automatic fixes** | A person chooses every fix. |
| **A flag to skip the security rules** | The safe setup should be the only one that works. |
| **The register in the database** | It stays a file an auditor can open. See above. |
| **A paid API run for the assessment** | Not worth the cost to prove an optional feature. It is described as untested against the live service. |
| **Several servers sharing one database** | Penny is one copy on one computer. That fits an AP team and keeps setup simple. |

## What production would take

Penny is a portfolio project. The full list of what a real company would need before relying on it, with where
Penny stands on each item and why it is not done here, is in [`PRODUCTION.md`](PRODUCTION.md).

## What still needs a person

These are not built because software cannot do them. I list them so nobody assumes they were done.

* **An outside security review.** The review so far was my own, with an AI assistant.
* **A session with someone who uses a screen reader every day.**
* **A try on real phones, tablets, and a real Mac and Windows computer** for the installer.
