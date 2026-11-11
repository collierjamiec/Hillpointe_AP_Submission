# Change log

Every version of Penny, newest first: what changed, why it started, and what was tested.

This is the short, complete record. For the full detail of each version, see [`SCOPE.md`](SCOPE.md). For the reason
behind each choice, see [`DECISIONS.md`](DECISIONS.md). For what is not done, see [`PRODUCTION.md`](PRODUCTION.md).

**How to read it.** Each version has:

* **Where it started:** the question or problem that led to it, often in my own words from the build sessions,
  lightly cleaned up.
* **Added, Changed, Fixed, Security:** what is different.
* **Tested:** how many automated checks passed when it shipped.

Version 1.0 is the assessment as I submitted it. Everything after it is my own work beyond the assignment. A version
marked **Required** makes older copies read-only until they update.

| Version | Date | In one line |
|---|---|---|
| [2.1.3](#213-a-menu-that-scrolls) | Nov 2026 | The left menu scrolls, so Help center is never cut off |
| [2.1.2](#212-what-production-would-take) | Nov 2026 | An honest list of what production would take, and this change log |
| [2.1.1](#211-decisions-and-why) | Nov 2026 | The reason for each decision, written into every page |
| [2.1.0](#210-setup-wizard) | Nov 2026 | A setup wizard, started with a double-click |
| [2.0.1](#201-security-review) | Nov 2026 | **Required.** A security review, and a fix for a way around sign-in |
| [2.0.0](#200-penny-for-a-real-team) | Nov 2026 | **Required.** One server for a whole team, with live updates and https |
| [1.9.1](#191-made-for-phones) | Nov 2026 | A layout made for phones |
| [1.9.0](#190-finishing-the-single-user-roadmap) | Nov 2026 | Source highlighting, export history, watched folder, paging, accessibility |
| [1.8.0](#180-a-stronger-foundation) | Nov 2026 | No new features: tests, security headers and readable code |
| [1.7.0](#170-people-email-and-appearance) | Nov 2026 | Real accounts, email, and appearance settings |
| [1.6.0](#160-versions-and-updates) | Nov 2026 | The version on every screen, and required or optional updates |
| [1.5](#15-blockers-recheck-and-manual-entry) | Nov 2026 | Blockers, recheck, a rule simulator, manual entry, an urgent queue |
| [1.4](#14-new-batches-suggested-fixes-and-insights) | Nov 2026 | New batches from the browser, suggested fixes, usage insights |
| [1.3](#13-roles-actions-and-a-redesigned-workspace) | Nov 2026 | Sign-in with roles, real actions, an audit trail, a help center |
| [1.2](#12-the-web-view) | Nov 2026 | A view-only web app |
| [1.1](#11-unreadable-files) | Nov 2026 | A bad file no longer stops a run |
| [1.0](#10-the-submitted-assessment) | Oct 2026 | The assessment, as submitted |

Also on this page: [Penny by the numbers](#penny-by-the-numbers) and [Ideas, and where each one went](#ideas-and-where-each-one-went).

---

## 2.1.3: a menu that scrolls

*November 2026. Optional.*

**Where it started.** "The left hand menu cuts off help center because it's too far down, needs to scroll."

**Fixed**

* The left menu now scrolls by itself when the window is too short to show all of it. Before, the last links
  (Help center, and for an Admin, Users and Insights) could sit below the bottom of the screen with no way to
  reach them. This showed up on small laptop screens, zoomed-in browsers and phones held sideways.
* On phones the menu now uses the height of the visible screen, so the browser's own bars no longer hide its
  last link.

**Tested:** 122 code checks and 18 browser suites. The phone suite has 6 new checks: in a short desktop window and
on a phone held sideways, the menu scrolls, Help center can be brought into view, and it opens.

**Not done:** checked on an emulated phone and a resized desktop window, not on a real device.

---

## 2.1.2: what production would take

*November 2026. Optional. No change to how Penny works. Pull request #15.*

**Where it started.** "I need to get this to a place where I can call it a good portfolio, but not necessarily
production ready. There are things I cannot do in this project that would need to be done for production. I do need
to make sure they make it into the documentation as things that I have thought about." I also said I want Penny to
accept Microsoft identities one day, and Google identities as well.

**Added**

* [`PRODUCTION.md`](PRODUCTION.md): eight areas, each with where Penny stands today, what production needs, and why
  it is not done here.
* Sign-in with Microsoft, then Google, named as the next thing I intend to build. It is a plan in this version, not
  a feature.
* The order I would work in if a company wanted to run Penny for real.
* A help center article, "Is Penny ready for production?", and two new answers in the FAQ.
* This change log.

**Changed**

* The README now says plainly, near the top, that Penny is a portfolio project and not production software.
* "Single sign-on" in the roadmap and decision log now names Microsoft and Google.

**Tested:** 122 code checks (1 new, which keeps this change log complete) and 18 browser suites. The help center suite checks the new article.

---

## 2.1.1: decisions and why

*November 2026. Optional. No change to how Penny works. Pull request #14.*

**Where it started.** "I want to make sure that the reasons for my decisions are made known throughout all of the
documentation that people will be able to see in this demonstration."

**Added**

* [`DECISIONS.md`](DECISIONS.md): 42 decisions in eight groups, each with what I weighed and why, plus what I chose
  not to build.
* A help center article, "Decisions and why".
* A "Why it works this way" note on 25 feature help articles.
* A "Why I built this" line under every version in `SCOPE.md`.
* A "Decisions I made" section on the README.

**Changed**

* Docs that had fallen behind were brought up to date: the version table in `SCOPE.md` (it stopped at 1.8.0), the
  help article "Where Penny came from", an FAQ answer that was only true for the demo, and the README's install steps.

**Fixed**

* Links inside help notes and table cells are now underlined, so they never depend on color alone. The
  accessibility suite caught this in the new notes.

**Tested:** 121 code checks and 18 browser suites.

---

## 2.1.0: setup wizard

*November 2026. Optional. Pull request #13.*

**Where it started.** "Before we merge I want a new install GUI wizard." Setting Penny up for a team took six
commands in the right order.

**Added**

* **Install Penny** files for Mac and Windows. A double-click installs Penny and opens the wizard.
* **A five-screen wizard in the browser:** a check of this computer, the invoice package, who signs in (creating the
  first Admin with a real password), settings (time zone, watched folder, network and certificate), and a summary.
* **Start Penny** files, and `./penny start`, which start Penny the way the wizard was told to.
* `./penny setup` to open the wizard from a terminal.
* A help center article, "The setup wizard".

**Security**

* The wizard is closed unless Penny itself opens it with a one-time key, because it can create an Admin. It only
  works from the computer Penny is on, and it will not create a second "first" Admin.
* A computer name typed for a certificate must be a plain name, so nothing typed there can run as a command.

**Tested:** 121 code checks (7 new) and 18 browser suites (1 new, which walks the whole wizard and checks every
screen for accessibility and on a phone).

**Not done:** the double-click files have not been run on a real Mac or Windows computer.

---

## 2.0.1: security review

*November 2026. **Required.** Pull request #12.*

**Where it started.** Version 2.0 opened Penny to a network. Before building anything else, I had the code reviewed
for ways around its own checks. It found a real one.

**Security**

* **Fixed a way around sign-in.** With real accounts on, someone who was not signed in could download invoices,
  PDFs and import files by spelling the address another way, such as `/%64ata/` for `/data/`. This was in every
  version since 1.7.0. Before 2.0 it could only be reached from the same computer. The public demo site was never
  affected, because it has no server and no private data.
* Asking only for a file's size no longer skips the sign-in check.
* Penny on one computer now answers only to that computer's own address, so a web page elsewhere cannot reach it
  through your browser.
* Every field of an action is checked before it is saved, so one browser cannot break a page for the whole team.
* Work moved in from a browser no longer counts as an approval, an import or a second check. It is history only.
* Behind a proxy, the wrong-password limit follows the real computer, so one person cannot lock everyone out.
* Unexpected errors keep their details in the terminal. The browser gets a reference to quote.
* A stalled connection is closed after a minute, and folders are never listed.

**Changed**

* The help center's security article lists each finding, what it allowed and what happens now.

**Tested:** 114 code checks (6 new, one per finding) and 17 browser suites. One test asks for 18 spellings of
private addresses while signed out. None is served.

**Not done:** a review by someone outside the project. This one was my own, with an AI assistant.

---

## 2.0.0: Penny for a real team

*November 2026. **Required.** Pull request #11.*

**Where it started.** Even with real accounts, what people did in Penny was saved in each person's own browser. A
team could not share it. This was the goal the roadmap had been building toward since 1.8.0.

**Added**

* **One server holds the truth.** Every action is sent to the server, checked there and saved there.
* **Checks on the server:** who you are comes from your sign-in, your role must allow the action, nobody got there
  first, a second person where one is needed, and the row count for "Mark as imported" must match the real file.
* **A database** (`state/penny.db`). The audit trail lives there, and the database itself refuses to change or
  delete an entry.
* **Live updates.** A teammate's work shows up without a reload. If you are typing, Penny waits and offers to show
  the changes.
* **Over the network with https:** `./penny web --host 0.0.0.0 --https`, and `./penny cert` to make a certificate.
* **A lockout by computer:** 20 wrong passwords from one address lock that address for five minutes.
* **A one-time move** of the older audit log and account files into the database, and a way for an Admin to move a
  browser's earlier work in.
* Two help articles: "Working as a team" and "Running Penny for your team".

**Changed**

* Rule changes made on the Rules page are now the rules Penny runs with. They are written to the rules file, and
  the old file is kept.
* Penny refuses to open to a network without real accounts and encryption.
* **A plan I changed:** the register stays a plain file. My roadmap said it would move into the database.

**Tested:** 108 code checks (11 new) and 17 browser suites (1 new, with three people signed in at once). One test
has eight requests resolve the same hold at the same moment. Exactly one is saved.

**Not done:** one Penny on one computer only, and a restart signs everyone out.

---

## 1.9.1: made for phones

*November 2026. Optional. Pull request #10.*

**Where it started.** I asked, "Is the mobile experience optimized for mobile?" The honest answer was no. Pages fit
the screen, but tables scrolled sideways on eight screens and hid the amount, and the filters filled the first screen.

**Changed**

* Lists are cards on a phone, with the vendor and amount side by side.
* Sorting moves to a row of buttons above the cards.
* Filters on Invoices fold away behind one button.
* Buttons and fields are at least 44 pixels tall on touch screens, and tapping a field no longer zooms the page.
* Dialogs rise from the bottom of the screen.

**Added**

* A help center article, "Using Penny on a phone".

**Fixed**

* A list that was redrawn was labeled for screen readers one moment late. The automatic checks on GitHub caught it.

**Tested:** 97 code checks and 16 browser suites (1 new, on an emulated iPhone).

**Not done:** a try on real phones and tablets.

---

## 1.9.0: finishing the single-user roadmap

*November 2026. Optional. Pull request #9.*

**Where it started.** The five items left on the roadmap before anything was shared. I said, "Go, do the most,
consider every angle."

**Added**

* **Source highlighting.** "Show on page" beside each value draws a box on the PDF where Penny read it. If a value
  is not on the page as text, Penny says so.
* **Export history.** The Intacct and Entrata files show Created, Downloaded, Imported and Confirmed. A row count
  that does not match is refused, and a second person confirms.
* **A watched folder.** Drop PDFs into a folder and Penny previews them. It never runs a batch for real, and never
  deletes a file.
* **Paging.** Long lists show 25, 50 or 100 rows. Totals still cover the whole list.
* **An accessibility check** of every screen against WCAG 2.2 AA, in light and dark, on desktop and phone.
* Four help articles.

**Fixed** (all found by the new accessibility check)

* Links inside sentences were told apart by color alone.
* "Skip to content" sent people to a "not found" page.
* On a phone, the account button had no name for screen readers.
* Wide tables could not be scrolled from the keyboard.
* The Appearance page faded some text below the contrast minimum.

**Tested:** 97 code checks (6 new) and 15 browser suites (5 new). One loads 5,000 invoices and times every page.

**Not done:** a session with a person who uses a screen reader every day.

---

## 1.8.0: a stronger foundation

*November 2026. Optional. Pull request #8.*

**Where it started.** "Identify any opportunities to enhance and improve, and let's make a plan to get us to
version 2.0. Review code for comment gaps, optimization opportunities." I chose to fix the foundation first.

**Added**

* [`ROADMAP.md`](ROADMAP.md): the plan to 2.0, kept current as work lands.
* **Browser tests in the project.** Ten suites, run on every pull request. Before this they only ran in a build
  session, so GitHub never saw them.
* **A content security policy** and safer response headers.
* A short description on every function: 246 of 246.

**Changed**

* One 4,451-line file became 13 files by area, still with no build step.
* The font is bundled, so nothing is loaded from another site.
* The server no longer re-reads every PDF and the whole audit log on each page load.

**Tested:** 91 code checks and 10 browser suites.

---

## 1.7.0: people, email and appearance

*November 2026. Optional. Pull request #6.*

**Where it started.** "Next version needs user management for admins. When new users are invited via email they get
notified and linked to activate and create a password. I also want options for invoices needing approval, or any
exports, to email to appropriate recipients. I also want more appearance setting options for all users."

**Added**

* **Real accounts.** Invitations with a one-time link, password resets, roles, and turning an account on or off.
* **Email.** Send any export or an approval request, with the file attached. Penny only emails its own users and
  the company's allowed domains.
* **An Outbox.** Every email, who sent it, and whether it was sent or only saved.
* **Appearance.** Seven preset themes, a custom color, text size, density and reduced motion. An Admin sets a
  company look, and each person can still choose their own.
* `./penny email test`, after I asked whether people could try live email with a free test inbox.

**Security**

* Passwords are stored only as scrambled fingerprints. Links work once and expire. With accounts on, the server
  ignores anything the browser says about who it is.

**Tested:** 85 code checks (12 new). Browser runs in both modes: 35 checks for people and email, 16 for appearance.

---

## 1.6.0: versions and updates

*November 2026. Optional. Pull request #5.*

**Where it started.** "I want to be sure we indicate the version we're using at the bottom of the screen. I would
also like an update module, so that when I update the repo to a new version I can choose whether it's a required
update for users, or if they can skip until another version."

**Added**

* The version on every screen, and a What's new page.
* **Required and optional updates.** A required update makes Penny read-only with a warning banner. An optional one
  can be skipped until the next.
* **Check for updates** in the account menu, showing this version beside the newest.
* `./penny update`, `./penny --version` and `./penny release`.
* Every run records which version of Penny made its decisions.

**Changed**

* Versions now have three parts, such as 1.6.0.

**Tested:** 73 code checks (8 new) and a browser run of 27 checks.

---

## 1.5: blockers, recheck and manual entry

*November 2026. Pull request #4.*

**Where it started.** I asked whether there were changes we had discussed and not yet built. There were six, and
this version built them.

**Added**

* **Blockers.** Each reason for a hold is tracked by itself, with an owner, a target date, notes and files.
* **Recheck.** See what Penny would decide now, without changing anything.
* **A rule simulator.** Test a rule change against every saved invoice before saving it.
* **Manual entry.** Key an unreadable invoice by hand. Over a set amount, a second person keys it again.
* **Most urgent first** in My work.
* **Automatic tests** on every pull request.

**Tested:** 65 code checks (16 new) and a browser run of 36 checks.

---

## 1.4: new batches, suggested fixes and insights

*November 2026. Pull request #3.*

**Where it started.** New invoices still needed the terminal. I wanted the whole weekly job to happen in the browser.

**Added**

* **New batch.** Name it, drag in the PDFs, then preview or run. An AP Clerk can preview. Only an Admin runs for real.
* **Suggested fixes** that learn from how holds were resolved. A person still chooses each one.
* **Usage insights** for Admins, counted by role and never by person.
* **Every rule editable** by an Admin, with a preview, a reason and undo.
* **A company time zone**, after I asked for it to be a setting people with permission can change.

**Changed**

* Exports are described in plain words.

**Fixed**

* The back of the coin read "ENTERED ONCE". Penny does not enter anything, so it now reads "NEVER BILLED TWICE".

**Tested:** 49 code checks (8 new).

---

## 1.3: roles, actions and a redesigned workspace

*November 2026. Pull request #2.*

**Where it started.** Two things. Seeing a hold is not the same as being able to deal with it. And my own test
invoice was held for the wrong reason.

**Added**

* Sign-in with four roles: Viewer, AP Clerk, Approver and Admin.
* Real actions by role, each needing a short reason.
* An audit trail where nothing is edited or deleted.
* A rules editor that shows what a change would affect before saving.
* A help center with 31 articles.
* My name on every screen.

**Changed**

* **Honest labels.** "Entered in Intacct" became "Ready for Intacct import". Penny writes files. It does not post
  or pay.
* A redesigned interface, with every text color measured for contrast.

**Fixed**

* A real $940 bill in a layout Penny had not seen was held with the reason "not a bill". It now says what Penny
  saw and what to do.

**Tested:** 41 code checks and a browser run as all four roles.

---

## 1.2: the web view

*November 2026. Pull request #2.*

**Where it started.** Most AP teams will never open a terminal.

**Added**

* A web app showing everything Penny decided: a dashboard, runs, invoices, and each invoice's PDF beside its checks.
* It was view only at first, on purpose, so I could get the picture right before letting anyone change anything.
* Six extra test invoices I wrote to push Penny beyond the sample package.

**Tested:** 40 code checks (3 new).

---

## 1.1: unreadable files

*November 2026. Pull request #1.*

**Where it started.** A damaged, empty, locked or scanned PDF stopped the whole run with a technical error.

**Fixed**

* Penny now holds just that one file, names it, and says what is wrong in plain words. Every other file in the
  batch is processed as normal.

**Tested:** 37 code checks (4 new).

---

## 1.0: the submitted assessment

*October 2026. Unchanged in folders `01` to `05`.*

**What was asked for:** an Intacct import file, an Entrata handoff, an exception log, the required approvers, proof
that a rerun is safe, a one-page summary and a log of how AI was used.

**What I added beyond that:** an answer key written before any code, a pass or fail trail for every document, a
check of the import file before it is written, every business rule in one file, and the name Penny with short commands.

**Tested:** 33 code checks, including 17 edge cases built from made-up invoices.

---

## Penny by the numbers

| Version | Code checks | Browser suites | Help articles |
|---|---|---|---|
| 1.0 | 33 | | |
| 1.1 | 37 | | |
| 1.2 | 40 | | |
| 1.3 | 41 | 1 run | 31 |
| 1.4 | 49 | | 34 |
| 1.5 | 65 | | 37 |
| 1.6.0 | 73 | | |
| 1.7.0 | 85 | | |
| 1.8.0 | 91 | 10 | |
| 1.9.0 | 97 | 15 | |
| 1.9.1 | 97 | 16 | |
| 2.0.0 | 108 | 17 | |
| 2.0.1 | 114 | 17 | |
| 2.1.0 | 121 | 18 | |
| 2.1.1 | 121 | 18 | 50 |
| 2.1.2 | 122 | 18 | 51 |
| 2.1.3 | 122 | 18 | 51 |

A blank means I did not record that number at the time. Before 1.8.0 the browser tests ran in build sessions and
were not yet kept in the project.

---

## Ideas, and where each one went

A lot of ideas came up along the way. This table keeps track of them, including the ones that are not built.

| The idea | Where it went |
|---|---|
| A full audit trail for every action and decision | Recorded during the assessment as a next phase. Built in 1.3, and made permanent in a database in 2.0.0. |
| Handle invoice layouts Penny has never seen | Recorded during the assessment. Partly built: an honest hold reason (1.3), manual entry (1.5), and an optional AI reader that is still untested against the live service. |
| Short, friendly commands and a name | Built into the submission. |
| A web app, so nobody needs a terminal | Built in 1.2 and every version since. |
| Roles, so each person can do only their own job | Built in 1.3. |
| Upload and run invoices from the browser | Built in 1.4. |
| Fixes that learn from past resolutions | Built in 1.4, always chosen by a person. |
| A company time zone people with permission can change | Built in 1.4. |
| Track each reason for a hold by itself | Built in 1.5. |
| Test a rule change before saving it | Built in 1.5. |
| The version at the bottom of every screen | Built in 1.6.0. |
| Updates I can mark as required or skippable | Built in 1.6.0. |
| A "Check for updates" choice in settings | Built in 1.6.0. |
| Invite people by email, with a link to set a password | Built in 1.7.0. |
| Email exports and approval requests to the right people | Built in 1.7.0. |
| Themes and custom colors for everyone | Built in 1.7.0. |
| Let people try live email with a free test inbox | Built in 1.7.0 as `./penny email test`, with help on using a test inbox. |
| A plan to 2.0, kept up to date | Built in 1.8.0 as `ROADMAP.md`. |
| Show where on the PDF each value came from | Built in 1.9.0. |
| Know whether an import file was already imported | Built in 1.9.0. |
| Pick up invoices from a shared folder | Built in 1.9.0, previews only. |
| A phone experience designed for a phone | Built in 1.9.1. |
| One shared server, so a team sees the same work | Built in 2.0.0. |
| The register in the database | **Dropped.** It stays a plain file an auditor can open. |
| A security review once Penny could be reached over a network | Done in 2.0.1 by me, with an AI assistant. An outside review is still to come. |
| An install wizard | Built in 2.1.0. |
| Make the reasons for my decisions known everywhere | Built in 2.1.1. |
| Say clearly that this is a portfolio project, with what production would take | Built in 2.1.2. |
| A complete change log | Built in 2.1.2. This page. |
| A left menu that scrolls when the window is short | Fixed in 2.1.3. |
| Sign in with Microsoft | **Planned next.** Needs a Microsoft tenant to build and test against. |
| Sign in with Google | **Planned, after Microsoft.** |
| A portfolio front door: screenshots, a case study, a guided tour | **Proposed, not started.** |
| Sign-ins that survive a restart | **Not built.** A small, known gap. |
| An outside security test | **Needs someone else.** |
| A session with a person who uses a screen reader | **Needs that person.** |
| A try on real phones, and the installer on a real Mac and Windows computer | **Needs the devices.** I can do part of this myself. |
| Direct connections to Sage Intacct and Entrata | **Not built.** I have no access to those systems. |
| Penny posting or paying | **Not built, on purpose.** |
