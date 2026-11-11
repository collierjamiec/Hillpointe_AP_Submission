# Getting started with Penny

This guide is for anyone who has downloaded the project and wants to see Penny working on their own computer. It
takes about five minutes. *(Added after submission, in version 2.2.0.)*

**Just want to look?** You do not need to install anything. Open the
[live demo](https://collierjamiec.github.io/Hillpointe_AP_Submission/), pick a demo person, and choose
**Take the tour**.

> Penny is a portfolio project, not production software. Run it to explore it. Do not use it to process a real
> company's invoices. See [`PRODUCTION.md`](PRODUCTION.md) for what that would take.

| Jump to | |
|---|---|
| [What you need](#what-you-need) | One thing: Python |
| [Step 1: Get the project](#step-1-get-the-project) | Download or clone |
| [Step 2: Install Penny](#step-2-install-penny) | A double-click, or two commands |
| [Step 3: Start Penny](#step-3-start-penny) | Opens in your browser |
| [Step 4: Look around](#step-4-look-around) | The tour, and four people to sign in as |
| [What works out of the box](#what-works-out-of-the-box) | And what needs the invoice package |
| [Check that it works](#check-that-it-works) | Run the tests |
| [If something goes wrong](#if-something-goes-wrong) | Common problems and fixes |
| [Where to go next](#where-to-go-next) | The rest of the documentation |

---

## What you need

* **Python 3.9 or newer.** Check with `python3 --version` (on Windows, `py --version`). If you do not have it, get
  it from [python.org/downloads](https://www.python.org/downloads/).
* **A modern browser.** Chrome, Edge, Firefox or Safari.
* **An internet connection for the install,** to download three small Python libraries.

That is all. Penny does not need a database server, an account with anyone, or an AI service.

---

## Step 1: Get the project

**Download:** on the [GitHub page](https://github.com/collierjamiec/Hillpointe_AP_Submission), choose
**Code**, then **Download ZIP**, and unzip it.

**Or clone it:**

```bash
git clone https://github.com/collierjamiec/Hillpointe_AP_Submission.git
```

Everything you run lives in the **`04_Workflow`** folder inside the project.

---

## Step 2: Install Penny

Pick whichever way you like. Both do the same thing.

### The double-click way

1. Open the `04_Workflow` folder.
2. Double-click **Install Penny** (`Install Penny.command` on a Mac, `Install Penny.bat` on Windows).
3. A window shows the install, then the **setup wizard** opens in your browser.

**On a Mac, the first time:** macOS may say the file is from an unidentified developer. Right-click the file, choose
**Open**, then **Open** again. You only do this once.

### The terminal way

```bash
cd Hillpointe_AP_Submission/04_Workflow
./penny install        # once; on Windows type penny in place of ./penny
./penny setup          # the setup wizard, in your browser
```

### What the install does

It makes a private space for Penny's libraries (a `.venv` folder) inside `04_Workflow`. It changes nothing else on
your computer. To remove Penny later, delete the project folder.

### The setup wizard

The wizard has five screens. **To look around, you can skip or accept everything.**

1. **This computer:** checks that Python and the libraries are in place.
2. **Your invoices:** skip this if you do not have the invoice package. Penny still runs with the example data.
   See [What works out of the box](#what-works-out-of-the-box).
3. **Who uses Penny:** choose **Just me** to keep the four demo people. **My team** creates real accounts.
4. **Settings:** the time zone and a few options. The defaults are fine.
5. **All set:** shows what you chose and how to start Penny.

Skipped the wizard? That is fine. Penny starts with the example data either way.

---

## Step 3: Start Penny

Double-click **Start Penny** in `04_Workflow`, or:

```bash
./penny start
```

Penny opens in your browser at `http://127.0.0.1:8765/`. The window you started it from stays open while Penny
runs. To stop Penny, press **Ctrl+C** in that window, or close it.

---

## Step 4: Look around

1. On the sign-in screen, pick one of the four demo people. **Avery Chen (AP Clerk)** is a good first choice.
2. Choose **Take the tour** at the top of the Overview. It walks through nine real pages in about two minutes and
   changes nothing.
3. Then try a real task: choose **Start reviewing**, read why the invoice was held, and resolve the hold. Open the
   **Audit trail** to see your action recorded.
4. Sign out from the menu under your name, and sign in as someone else to see what changes.

| Demo person | Role | What they can do |
|---|---|---|
| Riley Brooks | Viewer | Read everything, change nothing |
| Avery Chen | AP Clerk | Resolve and reassign holds, preview a batch |
| Jordan Patel | Approver | Approve or send back bills |
| Sam Rivera | Admin | Everything, including rules and people |

With the demo people, **everything you do stays in your browser.** To start over, choose **Reset demo data** in the
menu under your name.

The **Help center** in the left menu explains every screen.

---

## What works out of the box

The project includes the results of the example runs and the 20 example invoice PDFs, so the web app is complete
the moment you start it.

| | Works right away | Needs the invoice package |
|---|---|---|
| The whole web app: review, resolve, approve, rules, audit trail, exports, help | Yes | |
| The guided tour | Yes | |
| The example invoices beside each decision, with source highlighting | Yes | |
| The tests that do not read invoices (93 of 128) | Yes | |
| **New batch:** upload PDFs and have Penny read and decide them | | Yes |
| `./penny run`, `./penny demo` and the other commands that read invoices | | Yes |
| The other 35 tests | | Yes |

**What is the invoice package?** The folder of sample documents from the Hillpointe AP technical screen
(`Hillpointe_AP_Technical_Screen`): the invoices, the vendor list, the purchase orders and the AP Coding Rules.
It was given to me for the assessment and is not mine to share, so it is not in this project. If you have it, point
Penny at it in the setup wizard, or pass it on the command line:

```bash
./penny web --package /path/to/Hillpointe_AP_Technical_Screen
./penny demo --package /path/to/Hillpointe_AP_Technical_Screen     # runs Batch 01, a rerun, Batch 02, a rerun
```

---

## Check that it works

```bash
cd 04_Workflow
./penny test
```

You should see `Ran 128 tests` and `OK (skipped=35)`. The 35 skipped tests need the invoice package. With it,
all 128 run.

The browser tests are optional. They need [Node.js](https://nodejs.org/) and download a test browser the first time:

```bash
cd 04_Workflow/tests/browser
npm install
npx playwright install chromium
python3 run.py                 # 20 suites; one needs the invoice package
```

---

## If something goes wrong

| What you see | What to do |
|---|---|
| "Python 3 is not installed" | Install it from [python.org/downloads](https://www.python.org/downloads/), then run the install again. On Windows, tick **Add Python to PATH** in the installer. |
| On a Mac, "cannot be opened because it is from an unidentified developer" | Right-click the file, choose **Open**, then **Open**. |
| On a Mac, double-clicking does nothing, or "permission denied" in a terminal | In a terminal, in `04_Workflow`: `chmod +x penny *.command`, then try again. |
| On Windows, `./penny` is not recognized | Type `penny` in place of `./penny`. For example: `penny start`. |
| The install stops while downloading | Check your internet connection and run it again. It is safe to run twice. |
| "Address already in use", or the page does not open | Another program is using the port, often a copy of Penny that is still running. Close the other window, or start on another port: `./penny web --port 8770`. |
| The browser did not open by itself | Go to `http://127.0.0.1:8765/` yourself. |
| "Package folder not found" | That command reads invoices. Add `--package` with the path to the invoice package, or use the web app, which works without it. |
| New batch says it can upload but not run | Penny was started without the invoice package. See [What works out of the box](#what-works-out-of-the-box). |
| You want a clean slate in the web app | Menu under your name, then **Reset demo data**. |

Still stuck? The [Help center](https://collierjamiec.github.io/Hillpointe_AP_Submission/#/help) has more, and
[`04_Workflow/README.md`](04_Workflow/README.md) is the full reference.

**What I have and have not checked.** I ran these steps on a fresh copy of the project on Linux: install, start and
the tests all worked. The double-click files run the same commands, but they have not yet been double-clicked on a
real Mac or Windows computer.

---

## Where to go next

| If you want to know | Read |
|---|---|
| What Penny is and why it exists | [`README.md`](README.md) |
| The story: the problem, my approach, the hard calls | [`CASE_STUDY.md`](CASE_STUDY.md) |
| Why I made each choice | [`DECISIONS.md`](DECISIONS.md) |
| What changed in each version | [`CHANGELOG.md`](CHANGELOG.md) |
| What production would take | [`PRODUCTION.md`](PRODUCTION.md) |
| Every command, check and rule | [`04_Workflow/README.md`](04_Workflow/README.md) |
| Running Penny for a team, over a network | Help center, "Running Penny for your team" |
