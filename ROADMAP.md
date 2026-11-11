# Roadmap to Penny 2.0

This was the plan from version 1.7.0 to 2.0.0, which is now finished. It is kept up to date as work lands: each item is marked
**Done**, **In progress** or **Planned**. What has already shipped, version by version, is in [`SCOPE.md`](SCOPE.md). Why I made each choice, including the
plans I changed, is in [`DECISIONS.md`](DECISIONS.md).

**The goal of 2.0:** Penny for a real team. Today, even with real accounts, what people do in Penny (resolving holds,
approvals, notes, blockers, rule changes) is saved in each person's own browser. In 2.0 the server becomes the single
source of truth, so a team shares one picture.

Last updated: November 2026, when 2.3.0 was finished.

---

## 1.8.0: a stronger foundation (Done)

No new features. This release makes the next two safe to build.

| Item | Why | Status |
|---|---|---|
| Browser tests live in the repository and run on every pull request | They only existed in a build session before, so GitHub never ran them | Done |
| Speed: remember file fingerprints, read only the new part of the audit log, rebuild only the run that changed | The server re-read every PDF and the whole log on each page load | Done |
| Security: a content security policy and safer response headers, fonts bundled instead of loaded from Google, a bounded sign-in tracker | Standard browser protections; no third-party requests; no unbounded memory | Done |
| Split `penny.js` (4,451 lines) into files by area, still with no build step | Easier to read, review and change | Done |
| Split the two longest functions (the request handler and the PDF reader) and the single test file | Same reason | Done |
| A short description on every function, starting with `rules.py`, `webserver.py` and `accounts.py` | Many functions had none | Done: 246 of 246 |

## 1.9.0: finish the single-user roadmap (Done)

| Item | What it adds | Status |
|---|---|---|
| Source highlighting | Show where on the PDF each value came from: the total, the PO, the invoice number. | Done |
| Export history | Track each import file from created, to downloaded, to imported, to confirmed, so nobody imports a file twice. | Done |
| Watched inbox folder | Pick up new invoices from a shared folder automatically, then preview them. | Done: previews only, never a real run |
| Accessibility pass | A full check with a screen reader and keyboard only, with fixes. | Done for the automated and keyboard checks (WCAG 2.2 AA on every screen, with fixes). **Still open:** a session with a person who uses a screen reader every day. It needs a person, so it is carried into 2.0. |
| Long lists | Paging and faster drawing, so thousands of invoices stay quick. | Done: tested with 5,000 invoices |

## 1.9.1: made for phones (Done)

Not on the original plan. It was added when a review of 1.9.0 showed the phone layout fit the screen but was not
designed for it.

| Item | What it adds | Status |
|---|---|---|
| Tables as cards | Lists show each row as a card on a phone, with the amount always in view and no sideways scrolling | Done |
| Thumb-sized controls | Buttons and fields at least 44 pixels tall on touch screens; fields that do not zoom the page | Done |
| Filters, dialogs, menu | Filters fold behind one button, dialogs rise from the bottom, the search hint fits | Done |
| A phone test suite | Every main screen checked on an emulated iPhone on every pull request | Done |
| Real devices | A try on a range of real phones and tablets | **Still open:** an emulator is not a hand. Carried into 2.0. |

## 2.0.0: Penny for a real team (Done)

| Item | What it adds | Status |
|---|---|---|
| The server is the source of truth | Every action and rule change is saved on the server and checked there. Rule changes made in the web app are the rules Penny runs with. | Done |
| A real database: SQLite | One file, no setup, built into Python. The audit log only allows new entries. | Done: the database refuses changes and deletions with triggers |
| Live updates | Teammates see each other's work as it happens, and two people cannot resolve the same hold at once. | Done |
| Run over the network with https | The whole team can reach Penny, with session cookies marked Secure. | Done: refused without real accounts and https |
| A one-time move of existing data | The register, runs, accounts and browser history are carried over. | Done for the audit log, accounts and browser history. **Changed:** the register and run folders stay as files on purpose (see below). |
| Required update | 2.0.0 is marked required, so every copy moves together. | Done |
| The public demo stays | A browser-only showcase with example data, as it is today. | Done |
| Export history moves to the server | Carried from 1.9.0. | Done: it is part of the team's audit log |
| Sign-in lockouts by network address | Was listed for after 2.0. Moved up, because opening Penny to a network makes it matter. | Done |

**One decision changed along the way.** The plan said the register would move into the database. It stays a file
(`state/processed_register.csv`). The engine also runs from the terminal with no server, the submitted evidence
compares those files, and a CSV is what an auditor opens. The server takes a lock around every run, so two runs
cannot write it at once.

## 2.0.1: security review (Done)

Not on the original plan. 2.0 opened Penny to a network, so the code was reviewed for ways around its own checks
before anything else was built.

| Item | Status |
|---|---|
| A way around sign-in: the check and the file server read the address differently, so invoices could be downloaded without signing in. In every version since 1.7. | Fixed, with a test of 18 spellings |
| File size requests, folder listings, stalled connections, error details | Fixed |
| Penny on one computer answered to any name (DNS rebinding) | Fixed |
| Actions with the wrong kind of value could break teammates' pages | Fixed: every field is checked |
| Moved browser history could stand in for a real approval or confirmation | Fixed: history only |
| Wrong-password lockout behind a proxy locked everyone out | Fixed |
| A review by someone outside the project | **Still open.** This review was done by the project's own author. |

## 2.1.0: setup wizard (Done)

Not on the original plan. Setting Penny up for a team took six terminal commands in the right order. Now it is a
double-click and five screens.

| Item | Status |
|---|---|
| Double-click installers for Mac and Windows that install Penny and open the wizard | Done. **Not yet tried on a real Mac or Windows computer.** |
| A wizard in the browser: this computer, the invoice package, who signs in, settings, summary | Done |
| The first Admin is created in the wizard, with a real password | Done |
| The network choice makes a certificate and keeps the two rules (real accounts, https) | Done |
| `./penny start` and a Start Penny file that use what the wizard saved | Done |
| The wizard is closed unless Penny opens it with a one-time key | Done |

## 2.1.2: what production would take (Done)

Penny is a portfolio project. This release writes down, in one place, what stands between it and production.

| Item | Status |
|---|---|
| [`PRODUCTION.md`](PRODUCTION.md): eight areas, with where Penny stands today, what production needs, and why it is not done here | Done |
| Sign-in with Microsoft and Google named as the next thing to build | Done (the plan, not the feature) |
| The same list, shorter, in the help center of the live demo | Done |
| [`CHANGELOG.md`](CHANGELOG.md): every version, with a test that fails if a release is ever missing from it | Done |

## 2.1.3: a menu that scrolls (Done)

| Item | Status |
|---|---|
| The left menu scrolls when the window is short, so Help center can always be reached | Done |
| Checks for a short desktop window and a phone held sideways | Done |

## 2.2.0: a front door (Done)

| Item | Status |
|---|---|
| A guided tour in the web app: nine stops on the real pages | Done |
| [`GETTING_STARTED.md`](GETTING_STARTED.md) for people who download the project | Done |
| [`CASE_STUDY.md`](CASE_STUDY.md) | Done |
| Screenshots of the real app, and a README that leads with them | Done |

## 2.3.0: my profile (Done)

| Item | Status |
|---|---|
| A profile each person manages: name, title, about line, backup person and photo | Done |
| Change your password while signed in | Done |
| My activity, private to each person | Done |
| Import profile details from Microsoft or Google | Done (the import; it runs once that sign-in is built) |
| Marked a required update, with `./penny require` to do it safely | Done |

## After 2.0 (intended, not scheduled)

The full list of what a real company would need is in [`PRODUCTION.md`](PRODUCTION.md). These are the items I intend
to do or arrange myself.


| Item | Note |
|---|---|
| **Sign in with Microsoft, then Google** | Sign in with a Microsoft work account (Microsoft Entra ID), and after that a Google Workspace account, instead of a Penny password. Both use the same open standard (OpenID Connect), so one piece of work covers both. This is the next thing I intend to build. It needs a Microsoft tenant and a Google Cloud project to build and test against, which I have to set up myself. Penny's own accounts stay for teams that use neither, and one local Admin stays as a way in if the company's sign-in is down. |
| The installers on real computers | Carried from 2.1.0: the double-click files are tried on a real Mac and a real Windows computer. Needs those computers. |
| Real phones and tablets | Carried from 1.9.1: the phone layout is tried on real devices, and what is found is fixed. Needs a person with the devices. |
| Screen reader session | Carried from 1.9.0: a person who uses a screen reader every day tries the main tasks, and what they find is fixed. Needs that person. |
| An outside security review | 2.0 opens Penny to a network. The 2.0.1 review by the author found a real way around sign-in, which is the best argument for a second pair of eyes. Nobody outside the project has tried to break it yet. |
| Sign-ins that survive a restart | Sessions are kept in memory, so restarting Penny signs everyone out. |
| Paging by the database | Lists are still paged in the browser, which loads the whole audit log at sign-in. Fine for thousands of entries; a very long history should be paged by the server. |
| Argon2id password hashing | A stronger hash than today's PBKDF2, moved to on next sign-in. |
| More than one server | 2.0 is one Penny on one computer. Running several copies against one database is not supported. |

---

## How this file is kept current

Each release updates the status column here in the same pull request as the work, and moves finished items into
`SCOPE.md` with the detail of what was built.
