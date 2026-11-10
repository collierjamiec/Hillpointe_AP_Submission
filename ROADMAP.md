# Roadmap to Penny 2.0

This is the plan from version 1.7.0 to 2.0.0. It is kept up to date as work lands: each item is marked
**Done**, **In progress** or **Planned**. What has already shipped, version by version, is in [`SCOPE.md`](SCOPE.md).

**The goal of 2.0:** Penny for a real team. Today, even with real accounts, what people do in Penny (resolving holds,
approvals, notes, blockers, rule changes) is saved in each person's own browser. In 2.0 the server becomes the single
source of truth, so a team shares one picture.

Last updated: November 2026, when 1.9.0 was finished.

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

## 2.0.0: Penny for a real team (Planned)

| Item | What it adds |
|---|---|
| The server is the source of truth | Every action and rule change is saved on the server and checked there. Rule changes made in the web app are the rules Penny runs with. |
| A real database: SQLite | One file, no setup, built into Python. The audit log only allows new entries. |
| Live updates | Teammates see each other's work as it happens, and two people cannot resolve the same hold at once. |
| Run over the network with https | The whole team can reach Penny, with session cookies marked Secure. |
| A one-time move of existing data | The register, runs, accounts and browser history are carried over. |
| Required update | 2.0.0 is marked required, so every copy moves together. |
| The public demo stays | A browser-only showcase with example data, as it is today. |
| Screen reader session | Carried from 1.9.0: a person who uses a screen reader every day tries the main tasks, and what they find is fixed. |
| Export history and paging move to the server | In 1.9.0 the import history is saved in each browser and lists are paged in the browser. With the server as the source of truth, both are shared by the team and paged by the database. |

## After 2.0 (intended, not scheduled)

| Item | Note |
|---|---|
| **Single sign-on** | Sign in with the company's identity provider (OpenID Connect or SAML) instead of a Penny password. We intend to add this in 2.1. It is not in 2.0 because it needs a real identity provider to build and test against. Until then, Penny's own accounts stay: invitations, password rules, lockouts and resets. |
| Argon2id password hashing | A stronger hash than today's PBKDF2, moved to on next sign-in. |
| Sign-in lockouts by network address | Today a lockout is per email, so someone who knows an email can keep that person locked out. Once Penny runs over a network (2.0), lock by address as well. |

---

## How this file is kept current

Each release updates the status column here in the same pull request as the work, and moves finished items into
`SCOPE.md` with the detail of what was built.
