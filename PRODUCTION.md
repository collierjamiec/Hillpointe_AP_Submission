# What production would take

**Penny is a portfolio project. It is not production software, and I do not claim it is.**

It works, it is tested, and a small team could try it. But running accounts payable for a real company is a higher
bar than a working demo. This page lists what that bar includes, where Penny stands today, and why I stopped where
I did. I wrote it so that anyone reviewing this project can see that I know the difference.

Some of these I could build with more time. Others I cannot do inside this project at all, because they need
things I do not have: a company's real systems and data, an identity provider, an outside auditor, or real people
and devices to test with. I say which is which.

| Jump to | |
|---|---|
| [Signing in](#1-signing-in) | Microsoft and Google sign-in, and stronger account protection |
| [Security](#2-security) | Outside review, encryption, secrets |
| [Controls and compliance](#3-controls-and-compliance) | What auditors would ask for |
| [Connections to other systems](#4-connections-to-other-systems) | Sage Intacct, Entrata, the vendor list |
| [Accuracy on real invoices](#5-accuracy-on-real-invoices) | Beyond the sample documents |
| [Keeping it running](#6-keeping-it-running) | Backups, monitoring, growth |
| [Testing with real people](#7-testing-with-real-people) | Devices, screen readers, the AP team |
| [The business side](#8-the-business-side) | Support, training, legal |
| [How I would get there](#how-i-would-get-there) | The order I would do it in |

**How to read the tables.** "Today" is what Penny does now. "Production needs" is the bar. "Why not here" is the
honest reason it is not done in this project.

---

## 1. Signing in

Today people sign in with an email and a password that Penny checks itself. That is fine for a demo and a small
team. A real company wants people to use the account they already have.

| | Today | Production needs | Why not here |
|---|---|---|---|
| **Sign in with Microsoft** | Not built. | Sign in with a Microsoft work account (Microsoft Entra ID), so nobody has a separate Penny password. | **Intended next.** It needs a Microsoft tenant and an app registration to build and test against, which I have to set up myself. |
| **Sign in with Google** | Not built. | Sign in with a Google Workspace account, for companies that use Google. | **Intended, after Microsoft.** It needs a Google Cloud project and a Workspace domain to test against. |
| **Profile details from the company account** | Each person fills in their own profile. The code that imports a name, title, about line and photo from Microsoft or Google is written and tested with sample data. | The import runs at sign-in, against the real services. | Waits on Microsoft and Google sign-in. |
| **Two-step sign-in** | Not built. | A second step, such as a code from a phone. | Comes with Microsoft and Google sign-in, where the company already manages it. |
| **Roles from the company directory** | An Admin sets each person's role in Penny. | Roles follow the groups a person belongs to in the company directory. | Needs a real directory with groups. |
| **Leaving the company** | An Admin turns the account off in Penny. | The account turns off by itself when the person is removed from the company directory. | Needs a real directory. |
| **Stronger password storage** | Passwords are scrambled with PBKDF2, a sound and standard method. | Argon2id, a newer method that is harder to attack. | Could be built. Low priority once Microsoft and Google sign-in exist, because then Penny holds no passwords. |
| **Changing your own password** | Built in 2.3.0: it asks for the current password and signs out your other devices. | The same. | Done. |
| **Staying signed in through a restart** | Restarting Penny signs everyone out. | Sign-ins survive a restart. | Could be built. A small, known gap. |

**How Microsoft and Google sign-in would work in Penny.** Both use the same open standard (OpenID Connect), so one
piece of work covers both. Penny would send a person to Microsoft or Google to sign in, receive proof of who they
are, and match them to a role. One local Admin account would stay as a way in if the company's sign-in is down.
Penny's own accounts would remain for teams that use neither.

---

## 2. Security

Penny has real security habits, and a review of version 2.0 found and fixed a way around sign-in. That review was
my own, done with an AI assistant. It is not a substitute for the items below.

| | Today | Production needs | Why not here |
|---|---|---|---|
| **An outside security test** | Reviewed by me, with an AI assistant. One serious problem found and fixed. | A test by security professionals who did not write the code. | It costs money and needs an outside firm. |
| **A second engineer reading the code** | I directed the work and reviewed every change. An AI assistant wrote the code. | Review by another experienced engineer, especially for code an AI wrote. | This is a solo project. |
| **Encryption of stored data** | The database and invoice files sit on disk as normal files. | Encrypted storage, so a stolen disk or backup reveals nothing. | Usually handled by the company's servers or cloud, not by the app. |
| **Where secrets are kept** | The mail password is read from the computer's settings and never saved in a file. | A managed secrets store, with access logged and passwords changed on a schedule. | Needs company infrastructure. |
| **A tamper-evident audit trail** | The database refuses to change or delete an audit entry. | Proof that nobody with direct access to the server changed it: each entry sealed to the one before, and a copy kept somewhere the server cannot reach. | Could be built. The current rule stops the app and its users, not someone with the server's own password. |
| **Checking the building blocks** | Penny uses very few outside libraries, and bundles its fonts. | Automatic checks for known flaws in every library, on every change. | Could be added. |
| **Limits on heavy use** | Wrong passwords are limited by email and by computer. | Limits on every kind of request, and protection against a flood of traffic. | Usually handled in front of the app by the company's network. |
| **A way to report a security problem** | None. | A published address and a promise about how reports are handled. | A business decision for whoever runs it. |

---

## 3. Controls and compliance

Accounts payable is audited. Penny was designed with that in mind, but design is not the same as a passed audit.

| | Today | Production needs | Why not here |
|---|---|---|---|
| **An audit of the controls** | Roles, second-person checks and an audit trail that only grows. Each is tested. | An auditor's review that the controls work and were followed over time (for example SOC 2, or the company's own financial controls). | Needs an auditor and months of real use. |
| **Regular access reviews** | An Admin can see who has which role. | A scheduled review of who has access, with sign-off, and a record that it happened. | A process a company runs, with a report Penny could add. |
| **How long records are kept** | Nothing is ever deleted. | A written rule for how long invoices and audit records are kept, and a safe way to remove them after. | The right number of years is the company's legal decision. |
| **Privacy** | Penny keeps names, work emails and vendor details. Nothing is sent to anyone else. | A written record of what personal information is held, why, and for how long. | Depends on the company and where it operates. |
| **Controlled changes to Penny itself** | Every change is a reviewed pull request with tests, and required updates stop older copies from making changes. | A formal process: who may approve a change, a test environment that mirrors the real one, and a way to roll back. | Needs a team and a second environment. |

---

## 4. Connections to other systems

This is the largest gap, and it is on purpose.

| | Today | Production needs | Why not here |
|---|---|---|---|
| **Sage Intacct** | Penny writes an import file in Intacct's format. A person uploads it. | A direct, tested connection, or a decision to keep the file with a person in the loop. | I have no access to an Intacct system to build or test against. |
| **Entrata** | Penny writes a handoff list for Property Accounting. | The same choice as Intacct. | No access to Entrata. |
| **Posting and paying** | **Never.** Penny prepares. People post and pay. | If a company wanted this, it would need payment controls far beyond this project. | A deliberate limit. See [`DECISIONS.md`](DECISIONS.md). |
| **The vendor list, purchase orders and bill history** | Read from files in the invoice package. | Kept current from the company's real systems, so Penny never decides from an old list. | Needs those systems. |
| **Accounting periods** | Penny assumes the invoice month. | The company's real open and closed periods. | The sample package had no period table. |

---

## 5. Accuracy on real invoices

| | Today | Production needs | Why not here |
|---|---|---|---|
| **How many invoices it has seen** | 20 sample documents, 6 I wrote to test edge cases, and 17 more built by the tests. | Thousands of real invoices from the company's real vendors, with the results checked by the AP team. | I do not have a company's real invoices, and should not. |
| **Scanned invoices** | Held for a person, with a clear reason. | Reading the text from a scan (OCR), with a check on how well it read. | Could be built. It needs testing on real scans to be trusted. |
| **Layouts Penny has not seen** | Held with an honest reason. An optional AI reader exists and is off. | The AI reader tested against the live service on real documents, with its error rate measured. | I chose not to pay for the service to prove an optional feature. It has only been tested offline. |
| **Measuring accuracy over time** | Usage insights count actions by role. | A regular sample of Penny's decisions checked by a person, with the error rate tracked. | Needs real use over time. |
| **Other currencies and tax rules** | US dollars and the tax shown on the sample invoices. | Whatever the company really deals with. | Unknown without a real company. |

---

## 6. Keeping it running

| | Today | Production needs | Why not here |
|---|---|---|---|
| **Backups** | The help center says to back up one folder. | Automatic backups, kept somewhere else, and a practiced restore. A backup nobody has restored is a hope. | Needs company infrastructure. |
| **Knowing when something is wrong** | Errors print in the window Penny runs in. | Monitoring that alerts a person when Penny is down, slow or failing. | Needs infrastructure and someone on call. |
| **If the computer fails** | Penny is one copy on one computer. | A second copy ready to take over, and a written plan for a disaster. | A deliberate limit for a team-sized tool. |
| **Growing** | Tested with 5,000 invoices. The browser loads the whole audit trail at sign-in. | Lists paged by the server, and a database built for many people at once. | Could be built. It would mean moving off the small, no-setup database I chose on purpose. |
| **Updating without downtime** | Penny is stopped, updated and started. | Updates with no interruption, and a tested way back. | Needs more than one copy. |
| **Changes to the database's shape** | The first 2.0 start moves older files in. | A versioned, tested path for every future change to stored data. | Could be built as the need arises. |

---

## 7. Testing with real people

Automated tests are strong on rules and weak on people. Penny has 128 code tests and 20 browser suites. None of
them is a person.

| | Today | Production needs | Why not here |
|---|---|---|---|
| **People who do the job** | Designed from the brief and my own experience. | Sessions with AP clerks, approvers and managers doing their real work, and changes from what is learned. | Needs access to a real AP team. |
| **Screen reader users** | An automated check of every screen against WCAG 2.2 AA, plus keyboard tests. | A person who uses a screen reader every day completing the main tasks. | Needs that person. |
| **Real phones and tablets** | Checked on an emulated iPhone. | A range of real devices. | Needs the devices. |
| **The installer** | The commands it runs are tested. | Double-clicked on real Mac and Windows computers, and signed so the computer does not warn about it. | Signing needs paid developer accounts. I can do the first part myself. |
| **Older and other browsers** | Tested in one modern browser engine. | A stated list of supported browsers, each tested. | Could be added. |

---

## 8. The business side

| | Today | Production needs | Why not here |
|---|---|---|---|
| **Support** | Me. | Someone to call, hours they answer, and a promise about how fast. | A business, not a project. |
| **Training** | A help center with about 50 articles, a guided tour, a getting started guide and a setup wizard. | Training for each role, and a plan for moving a team from how they work today. | Depends on the team. |
| **A written accessibility statement** | The help center says what was checked and what was not. | A formal report against the standard, which buyers often require. | Follows from testing with real people. |
| **Legal terms** | None. | A license, terms of use, and an agreement about the data Penny holds. | Needs a lawyer. |

---

## How I would get there

If a company wanted to run Penny for real, this is the order I would work in, and why.

1. **An outside security test and a second engineer's review.** Before anything else, because everything after
   builds on trust in the code.
2. **Sign in with Microsoft, then Google.** It removes the passwords Penny holds and puts access under the
   company's own control.
3. **A pilot on real invoices, beside the current process.** Penny runs in preview only while the AP team keeps
   working the way they do now. Compare the two. This is where accuracy gets measured and where the people who do
   the job shape it.
4. **Backups, monitoring and a restore drill.** Before Penny is relied on, not after the first bad day.
5. **Connections to Intacct and Entrata,** only once the pilot shows the files are right.
6. **An audit of the controls,** once there are months of real use to audit.

Nothing on this page changes what Penny is today: a working, tested example of how I think about a product that
handles other people's money.
