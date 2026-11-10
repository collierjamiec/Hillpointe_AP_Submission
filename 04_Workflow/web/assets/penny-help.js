/* Penny help center: the knowledge base.
   Each article is plain HTML written for people, at about an 8th to 9th grade reading level.
   Placeholders like {{codes}} are filled in by penny.js from the live data (exception codes, rules, roles,
   shortcuts), so those articles can never drift from what the app actually does. */
window.PENNY_HELP = [
  // ------------------------------------------------------------------ getting started
  { slug: "welcome", section: "Getting started", title: "Welcome to Penny",
    summary: "What Penny is, what it does, and a two-minute tour.",
    html: `
<p>Penny is an accounts payable assistant. It reads vendor invoices, checks each one against your company's AP rules, and tells your team three things: what is ready to import, what needs a person to review, and why.</p>
<div class="help-note"><strong>AI reads. Code decides. People approve.</strong> Reading a PDF is the only fuzzy step, so that is the only place AI may help (and it is off by default). Every decision is made by plain, tested rules that give the same answer every time. People make the final call on anything unusual.</div>
<h2>What Penny does</h2>
<ul>
  <li>Reads each invoice PDF: vendor, invoice number, dates, lines, tax, totals and references like the purchase order.</li>
  <li>Runs up to 15 checks in order, from "do the numbers add up?" to "is this a duplicate?" to "who needs to approve it?".</li>
  <li>Writes a Sage Intacct import file for bills that pass, an Entrata handoff for apartment communities, and an exception log for everything else.</li>
  <li>Remembers what it has processed, so running a batch again never puts a bill in an import file twice.</li>
</ul>
<h2>What Penny does not do</h2>
<ul>
  <li>It does not pay anything, post anything, or connect to Intacct or Entrata. It writes files that a person reviews and uploads.</li>
  <li>It does not guess. If something is missing or does not match, the invoice is held with a reason.</li>
</ul>
<h2>A two-minute tour</h2>
<ol>
  <li>Sign in as <strong>Avery Chen (AP Clerk)</strong>.</li>
  <li>On the <a href="#/">Overview</a>, choose <strong>Start reviewing</strong>.</li>
  <li>Read why the invoice was held, look at the PDF on the right, and choose <strong>Resolve hold</strong>.</li>
  <li>Press <kbd>j</kbd> to move to the next invoice.</li>
  <li>Open the <a href="#/audit">Audit trail</a> to see your action recorded with your name and the time.</li>
</ol>` },

  { slug: "roles-demo", section: "Getting started", title: "Try each role",
    summary: "The four demo accounts and what each one can do.",
    html: `
<p>This site has four demo accounts, one for each role. Sign out from the menu under your name, then sign in as someone else to see how Penny changes.</p>
{{accounts}}
<p>See <a href="#/help/roles">Roles and permissions</a> for the full list of who can do what.</p>` },

  { slug: "shortcuts", section: "Getting started", title: "Keyboard shortcuts",
    summary: "Move through your work without the mouse.",
    html: `
<p>Shortcuts work anywhere except while you are typing in a box. Press <kbd>?</kbd> at any time to see this list.</p>
{{shortcuts}}
<p>A good review rhythm: open the first item in <a href="#/work">My work</a>, read the reason, act, then press <kbd>j</kbd> for the next one.</p>` },

  // ------------------------------------------------------------------ using the web app
  { slug: "overview", section: "Using the web app", title: "Overview and My work",
    summary: "Where to start each day, and how your queue is built.",
    html: `
<p>The <a href="#/">Overview</a> answers four questions: what needs my attention, why, what should I do next, and what happened after people acted.</p>
<h2>The attention list</h2>
<p>The top card is built for your role. AP Clerks and Admins see invoices that need review, largest first. Approvers see bills waiting for their sign-off. Viewers see what is waiting on the AP team. Each line shows the reason in plain words and who acts next.</p>
<h2>The totals</h2>
<ul>
  <li><strong>Needs review:</strong> invoices Penny held that no one has resolved yet.</li>
  <li><strong>Ready to import:</strong> bills Penny wrote to an import file or the Entrata handoff. They are not uploaded, posted or paid yet.</li>
  <li><strong>Duplicates stopped:</strong> bills that were already billed, so they were kept out of every file.</li>
  <li><strong>Resolved by people:</strong> holds cleared or rejected in this demo.</li>
</ul>
<p>Every total is a link to the page that explains it.</p>
<h2>My work</h2>
<p><a href="#/work">My work</a> groups open holds by the team that acts on them, and lists bills waiting for approval. The count in the side menu always shows how many items are waiting on you.</p>` },

  { slug: "review", section: "Using the web app", title: "Reviewing an invoice",
    summary: "How to read an invoice page from top to bottom.",
    html: `
<p>Each invoice page puts the original PDF beside Penny's reasoning, so you never have to take Penny's word for it.</p>
<h2>The header</h2>
<p>The vendor, invoice number, date and amount. Below them are three different kinds of labels:</p>
<ul>
  <li><strong>Status</strong> (filled, with an icon): where the invoice stands, like Needs review or Ready for Intacct import.</li>
  <li><strong>Destination</strong> (dashed outline): which file it went to, if any.</li>
  <li><strong>Confidence</strong> (bars): how sure Penny is. It is Penny's own word (High, Medium or Low), never a made-up percentage.</li>
</ul>
<h2>The callout</h2>
<p>For a held invoice, the colored box says what Penny found, what to do next, and which team it goes to. The short code (like OVERPO) is shown on the right for anyone who needs it.</p>
<h2>The tabs</h2>
<ul>
  <li><strong>Checks:</strong> every check Penny ran, in order, with pass or fail.</li>
  <li><strong>What Penny read:</strong> every field taken from the PDF, including lines, totals, pay application math and lien waivers.</li>
  <li><strong>Coding and approvals:</strong> the import lines Penny wrote and the sign-offs the bill needs.</li>
  <li><strong>History and activity:</strong> what people did, and every run that read this file.</li>
</ul>
<h2>Moving on</h2>
<p>Use <strong>Next</strong> and <strong>Previous</strong> at the top (or <kbd>j</kbd> and <kbd>k</kbd>) to move through the list you came from. <strong>Back</strong> returns you to that list with your filters and scroll position kept.</p>` },

  { slug: "resolve", section: "Using the web app", title: "Resolving a hold",
    summary: "Clear, reject, reassign or reopen a held invoice.",
    html: `
<p>AP Clerks and Admins can act on held invoices. Every action asks for a short note, which is saved to the audit trail with your name and the time.</p>
<h2>Your choices</h2>
<ul>
  <li><strong>Fixed: enter it on the next run.</strong> Use this when the problem is solved, for example a PO change order is approved. The invoice shows as <em>Cleared for next run</em>. Penny still decides: it reads the corrected document from scratch on its next run, and only writes it to an import file if every check passes.</li>
  <li><strong>Reject: return it to the vendor.</strong> Nothing goes into any file. The vendor must send a corrected document.</li>
  <li><strong>Reassign.</strong> Send the hold to a different team, with a note that says why.</li>
  <li><strong>Reopen.</strong> Undo a clear or reject. The earlier decision stays in the audit trail.</li>
</ul>
<div class="help-note">Resolving a hold never changes Penny's own result. The record of what Penny decided, and what a person decided after, are both kept.</div>` },

  { slug: "approve", section: "Using the web app", title: "Approving a bill",
    summary: "Record sign-offs for bills that are ready to import.",
    html: `
<p>Some bills need one or more approvals before they are paid, based on the approval matrix in the rules. Penny lists who is required. A required approver is not the same as a recorded approval, so Penny shows both.</p>
<ol>
  <li>Open a bill marked <em>0 of 2 approvals</em> (or similar), or find it in <a href="#/work?tab=approvals">My work</a>.</li>
  <li>Choose <strong>Review approval</strong>.</li>
  <li>Pick the approval step you are signing for, then <strong>Approve</strong> or <strong>Send back</strong>. Sending back needs a note.</li>
</ol>
<p>The bill shows <em>Approved</em> once every step is approved, or <em>Sent back</em> if any step was sent back.</p>` },

  { slug: "new-batch", section: "Using the web app", title: "Adding a new batch of invoices",
    summary: "Name it, add the PDFs, preview or run. Every step is recorded.",
    html: `
<p>AP Clerks and Admins can add a batch from <a href="#/batch">New batch</a>.</p>
<ol>
  <li><strong>Name the batch.</strong> Type a short name or pick one: weekly-ap, month-end, vendor-resends, corrections. Penny puts today's date in the company time zone in front, so the folder is <code>inbox/2026-11-10_weekly-ap</code>. Dates first means folders sort in order. If the name is already used that day, Penny adds -2, -3 and so on.</li>
  <li><strong>Add the invoices.</strong> Drag PDFs onto the box, or choose them. Penny checks each file before anything is uploaded: it must really be a PDF, 25 MB or less, and not added twice. A file Penny has already read is flagged, because it would be skipped or stopped as a duplicate.</li>
  <li><strong>Preview or run.</strong>
    <ul>
      <li><strong>Preview</strong> (AP Clerk or Admin): Penny reads every invoice and writes the files, but does not update its register. Use it to see what will happen.</li>
      <li><strong>Run for real</strong> (Admin only): Penny updates its register, so those bills can never be written to an import file twice.</li>
    </ul></li>
</ol>
<p>When it finishes you see the results and can open the run, or go straight to what needs review.</p>
<h2>What is recorded</h2>
<p>Every step is written to <code>state/batch_log.jsonl</code> on the Penny computer, and shown in the <a href="#/audit">Audit trail</a> marked "On disk": who created the batch, who uploaded which files (name, size and a SHA-256 fingerprint that proves the exact file), who ran it, when, the folder, the run ID, preview or real, the results and the pre-flight check. A run that fails is recorded too.</p>
<div class="help-note"><strong>Where this works.</strong> Reading invoices needs Penny's engine, so batches run only when the web app is started on your computer with <code>./penny web --package &lt;package folder&gt;</code>. On the public demo site you can try every step, and the last one explains what would happen. Nothing is uploaded from the demo.</div>` },

  { slug: "blockers", section: "Using the web app", title: "Blockers: tracking each reason for a hold",
    summary: "Give every reason its own owner, target date, notes and proof.",
    html: `
<p>A held invoice can be waiting on more than one thing, for example a missing insurance certificate and a missing lien waiver. Each reason is a <strong>blocker</strong>, so each one can be worked and tracked on its own. The invoice shows how far along it is, like <em>1 of 2 blockers cleared</em>.</p>
<h2>What each blocker has</h2>
<ul>
  <li><strong>Status:</strong> Open, Waiting for evidence, Ready for recheck, or Cleared.</li>
  <li><strong>Owner:</strong> the team working it. It starts with the route in Rules.</li>
  <li><strong>Target date:</strong> when it should be done. Past-due blockers move to the top of My work.</li>
  <li><strong>Notes and files:</strong> screenshots or PDFs, up to 10 MB each. Each file is fingerprinted (SHA-256), and the audit trail names exactly which file was used.</li>
  <li><strong>Verified by:</strong> the person who marked it cleared, and when.</li>
</ul>
<h2>Working a blocker</h2>
<ol>
  <li>Open the invoice and find the Blockers card.</li>
  <li>Choose <strong>Update</strong> to change the status, owner or target date, add a note, or attach files.</li>
  <li>When it is fixed, choose <strong>Mark cleared</strong> and write what you checked. A payment change also needs Treasury's phone confirmation.</li>
  <li>When every blocker is cleared, <a href="#/help/recheck">recheck the invoice</a>, then resolve the hold.</li>
</ol>
<div class="help-note">Blockers organize the people work. They never change Penny's decision: a cleared invoice is still checked from scratch on its next run.</div>
<p>In this demo, notes and files stay in your browser. Files are kept in the browser's own storage; if it is cleared, the file name and fingerprint stay on record.</p>` },

  { slug: "recheck", section: "Using the web app", title: "Recheck and testing rule changes",
    summary: "Preview what Penny would decide now, without saving anything.",
    html: `
<p><strong>Recheck</strong> asks Penny to decide one held invoice again, the way its next run would. It is a preview: nothing is saved, no import file is written, and Penny's register does not change.</p>
<h2>What you can recheck</h2>
<ul>
  <li><strong>The same reading, with today's rules and data.</strong> Use this after a rule change, or after the reference data was fixed, for example when the vendor was added to the vendor master.</li>
  <li><strong>A corrected PDF from the vendor.</strong> Penny reads the new file and checks it. The file is not added to a batch.</li>
  <li><strong>A manual entry.</strong> See <a href="#/help/manual-entry">Entering an invoice by hand</a>.</li>
</ul>
<h2>Reading the preview</h2>
<p>You see the saved result beside the new one: the outcome, the reasons, and who must approve. Under them, Penny lists exactly what it used:</p>
<ul>
  <li><strong>Document:</strong> the file name, its fingerprint, and who read it (Penny, or a person for a manual entry).</li>
  <li><strong>Rules:</strong> a short fingerprint of the rules, and whether they are the ones shown on the Rules page.</li>
  <li><strong>Reference data:</strong> a fingerprint of the vendor master, ERP history, POs and subcontracts.</li>
  <li><strong>Register:</strong> how many entries Penny's memory held. Penny used a copy and did not change it.</li>
</ul>
<h2>Testing a rule change (Admin)</h2>
<p>On the <a href="#/rules">Rules</a> page, after you change something, choose <strong>Test on saved invoices</strong>. Penny decides every saved invoice twice, with the current rules and with your draft, using the same readings and reference data. It lists each invoice that would change and how. Nothing is saved until you choose Save changes.</p>
<div class="help-note">Recheck and testing need Penny's engine, so they work when Penny runs on your computer (<code>./penny web --package &lt;package folder&gt;</code>). The public demo explains this instead of inventing a result. Every recheck is recorded in the audit trail with the fingerprints it used.</div>` },

  { slug: "manual-entry", section: "Using the web app", title: "Entering an invoice by hand",
    summary: "When Penny cannot read a file but a person can.",
    html: `
<p>Sometimes Penny cannot read a file: it is a scanned picture, or a bill in a layout Penny does not know. If a person can open it in another program, they can key it by hand in a way an auditor can follow.</p>
<h2>The steps</h2>
<ol>
  <li><strong>Key it beside the evidence.</strong> Open the held invoice and choose <strong>Enter by hand</strong>. Attach a screenshot or a re-saved PDF of what you are reading from. Then type the vendor, invoice number, date, terms, PO, bill-to, lines and totals exactly as the document shows them, and say why it is keyed by hand. Penny checks that the lines add up to the subtotal and that subtotal plus tax equals the total as you type.</li>
  <li><strong>A second person checks it, over the limit.</strong> If the total is over the limit in Rules (Manual entry second check), a different AP Clerk or Admin keys the invoice number and total again from the evidence. They cannot see the first entry. If the two do not match, the entry waits until it is fixed. Under the limit, one person and a reason are enough.</li>
  <li><strong>Check with Penny.</strong> Penny runs every normal check on the keyed invoice: vendor, bill-to, duplicates, PO, coding, dates and approvals. You see the result as a <a href="#/help/recheck">recheck preview</a>.</li>
  <li><strong>Save for the next run.</strong> Penny saves a batch folder like <code>inbox/2026-11-10_manual-t5-unfamiliar-layout</code> with the original file, the keyed record and the evidence. An Admin previews or runs it from <a href="#/batch">New batch</a>, under Batches waiting to run.</li>
</ol>
<h2>What keeps it auditable</h2>
<ul>
  <li>The original file stays the source document. The keyed record carries its fingerprint, so a rerun of the same file is still recognized, and a keyed record never applies to a different file.</li>
  <li>Every evidence file is fingerprinted (SHA-256) and named in the audit trail.</li>
  <li>Who keyed it, why, who checked it, and when are all recorded, and the invoice is marked <strong>Keyed by hand</strong> everywhere it appears.</li>
  <li>Pay applications cannot be keyed by hand. Their tied-out lines and continuation sheet need the vendor's real PDF.</li>
</ul>
<div class="help-note">In this public demo you can key and check entries. Checking with Penny and saving for the next run need Penny on your computer.</div>` },

  { slug: "users", section: "Using the web app", title: "Managing people (Admin)",
    summary: "Invite people, set roles, turn accounts off, and send password resets.",
    html: `
<p>Admins manage everyone who uses Penny on the <a href="#/users">Users</a> page.</p>
<h2>Invite someone</h2>
<ol>
  <li>Choose <strong>Invite someone</strong> and enter their name, email, job title and role. Start with the least access they need.</li>
  <li>Penny emails them a link to set up their account. The link works once and expires in 72 hours.</li>
  <li>They open the link, check their name, and choose a password of at least 10 characters that is not their name or email. A short phrase works well.</li>
</ol>
<p>Until they finish, they show as <strong>Invited</strong>, and you can <strong>Resend invite</strong>. A new link replaces the old one.</p>
<h2>Change someone</h2>
<ul>
  <li><strong>Edit</strong> their name, email, job title or role. Changing a role or email signs them out at once, so the new access applies right away.</li>
  <li><strong>Turn off</strong> an account when someone leaves or changes jobs. They are signed out and cannot sign in. Nothing they did is removed, and you can turn it back on.</li>
  <li><strong>Send password reset</strong> emails a link to choose a new password. It works once and expires in 1 hour. People can also ask for one from the sign-in page with <strong>Forgot your password?</strong></li>
</ul>
<h2>Built-in safety</h2>
<ul>
  <li>Nobody can remove their own Admin role or turn off their own account, and Penny always keeps at least one active Admin.</li>
  <li>Passwords are stored only as salted hashes, never as text. Five wrong passwords lock that email for a minute, and the message never says whether an email has an account.</li>
  <li>Every invitation, change, reset and sign-in is in the <a href="#/audit">audit trail</a>.</li>
</ul>
<div class="help-note">In this public demo, people you invite are kept in your browser, and their emails go to the <a href="#/outbox">Outbox</a> with a working link. The four demo accounts keep their published passwords. On your own computer, accounts are real: run <code>./penny users invite --email you@company.com --name "Your Name" --role admin</code> to create the first Admin, then everyone signs in with their own password.</div>` },

  { slug: "email", section: "Using the web app", title: "Emailing exports and approval requests",
    summary: "Send a file or a bill to the right people, with the file attached.",
    html: `
<ul>
  <li><strong>Exports:</strong> on the <a href="#/exports">Exports</a> page, choose <strong>Email</strong> next to any file. The file is attached, with a short note saying what it is and who uses it.</li>
  <li><strong>Approvals:</strong> on a bill that is waiting for sign-off, choose <strong>Email for approval</strong>. The email lists the approvals needed, links to the bill in Penny, and attaches the original invoice.</li>
</ul>
<p>Penny suggests people by role (Approvers for approvals, AP Clerks for exports), and you can type any address. AP Clerks, Approvers and Admins can send; Viewers cannot.</p>
<h2>Who Penny may email</h2>
<p>Files are attached, so Penny only sends to people who use Penny and to addresses in the company's allowed domains (<code>email.allowed_domains</code> in rules.json). Anything else is refused before it is sent, with the reason.</p>
<h2>The Outbox</h2>
<p>The <a href="#/outbox">Outbox</a> lists every email with who sent it, to whom, when, what was attached (with each file's fingerprint), and whether it was <strong>Sent</strong>, <strong>Saved, not sent</strong>, or <strong>Failed</strong>. Admins see every email; everyone else sees their own.</p>
<h2>Setting up real email (on your computer)</h2>
<p>Penny sends through your company's mail account. Set these before <code>./penny web</code>, for example in your terminal profile. The password stays in your environment, never in a project file.</p>
<pre>export PENNY_SMTP_HOST=smtp.office365.com    # or smtp.gmail.com
export PENNY_SMTP_PORT=587
export PENNY_SMTP_USER=ap-penny@yourcompany.com
export PENNY_SMTP_PASSWORD='an app password'
export PENNY_PUBLIC_URL=http://127.0.0.1:8765   # where people open Penny, for links</pre>
<p>Without a mail server, nothing is sent: each email is saved in the Outbox and marked "Saved, not sent", so an Admin can pass an invitation link on by hand. Once an invitation or reset is really sent, its link is blanked out of the saved copy.</p>
<div class="help-note">In this public demo there is no email at all. Messages go to the Outbox in your browser, and their links work there.</div>` },

  { slug: "appearance", section: "Using the web app", title: "Appearance: themes, colors and comfort",
    summary: "Choose a preset or any color, light or dark, text size and density.",
    html: `
<p>Open <a href="#/appearance">Appearance</a> in the menu. Changes show right away and are saved to your account, so they follow you when you sign in again.</p>
<h2>Colors</h2>
<ul>
  <li><strong>Use the company look:</strong> the colors your Admin chose for everyone. This is the default.</li>
  <li><strong>Choose my own:</strong> pick a preset (Penny teal, Harbor blue, Evergreen, Plum, Copper, Graphite or High contrast) or <strong>Custom</strong> for any color. Only you see it.</li>
  <li>Custom colors are checked for contrast. If a color would make text hard to read, Penny uses a slightly darker shade (or lighter, in dark mode) that meets the WCAG AA standard, and tells you.</li>
  <li>You can also pick a background (cool gray, warm paper or soft blue) and rounded or square corners.</li>
</ul>
<h2>Comfort</h2>
<p>Always your own: light, dark or match your device; text size from Small to Larger; Comfortable or Compact density; and Reduce motion. The sun and moon button at the top switches light and dark too.</p>
<h2>The company look (Admin)</h2>
<p>An Admin chooses their own colors, then <strong>Make my colors the company look</strong>, with a reason. It is saved as the rule <code>display.theme</code>, so it shows in the Rules change history and the audit trail, and can be undone there.</p>` },

  { slug: "updates", section: "Using the web app", title: "Versions and updates",
    summary: "Which version you are on, and what required and optional updates mean.",
    html: `
<p>The version of Penny you are using is at the bottom of every screen, like <strong>Penny v1.6.0</strong>. Select it to see <a href="#/whats-new">What's new</a>: every version, when it came out, and whether it is required.</p>
<h2>Check for updates</h2>
<p>Open the menu with your name at the top right and choose <strong>Check for updates</strong> (it is also on the What's new page). Penny checks right away and shows your version beside the newest one, whether the update is required or optional, and what changed. From there you can update, skip an optional version, or check again.</p>
<h2>When a new version is out</h2>
<ul>
  <li><strong>Optional:</strong> a banner says the new version is ready. Choose <strong>Update now</strong>, read <strong>What's new</strong>, or choose <strong>Skip this version</strong>. Penny reminds you again when a newer version comes out.</li>
  <li><strong>Required:</strong> a warning banner stays at the top. Until you update, Penny is read-only: you can open every invoice, run, report and help article, but changes and real runs are paused. A required update cannot be skipped.</li>
</ul>
<h2>How to update</h2>
<ul>
  <li><strong>On this website:</strong> choose <strong>Update now</strong>. The page reloads with the new version. Everything you did in this browser is kept.</li>
  <li><strong>On your own computer:</strong> in Terminal, run <code>./penny update</code>. It shows what is new, updates from GitHub, and checks that everything works. Your register, runs and batches are never touched. To see what is new without updating, run <code>./penny update --check</code>; to wait on an optional version, run <code>./penny update --skip</code>.</li>
</ul>
<h2>Good to know</h2>
<ul>
  <li>Penny checks for a new version at most once a day. It only downloads the public list of releases and sends nothing about you. Set <code>PENNY_NO_UPDATE_CHECK=1</code> to turn the check off.</li>
  <li>If Penny cannot check (for example, you are offline), it says so and keeps working.</li>
  <li>Every run records which version of Penny made its decisions, so an auditor can tell later.</li>
  <li>Version numbers have three parts: major, minor, and small fixes. For example, 1.6.1 is a small fix to 1.6.0.</li>
</ul>
<div class="help-note">For the maintainer: <code>./penny release 1.7.0 --summary "..." --note "..."</code> publishes a version, and <code>--required</code> makes it the minimum. Merging it to main tags the release on GitHub.</div>` },

  { slug: "suggestions", section: "Using the web app", title: "Suggested fixes",
    summary: "One click to resolve a hold the way it was resolved before.",
    html: `
<p>On a held invoice, AP Clerks and Admins see <strong>Suggested fix</strong>: up to three ready-made resolutions. Choose <strong>Apply</strong> and the hold is resolved with that note in one click. An <strong>Undo</strong> button appears right away.</p>
<h2>Where suggestions come from</h2>
<ul>
  <li><strong>What people did before.</strong> When someone resolves or reassigns a hold, Penny remembers it for that reason. The next invoice held for the same reason gets that fix suggested, with "Learned from 3 past resolutions".</li>
  <li><strong>The same vendor counts more.</strong> A fix used before for this vendor moves to the top.</li>
  <li><strong>Fixes that did not hold count less.</strong> If a resolution was later reopened or undone, Penny trusts it less.</li>
  <li><strong>A built-in playbook</strong> covers each reason before there is any history. For a missing PO it even uses the PO number Penny already spotted as a likely match.</li>
</ul>
<p>The most likely fix also appears in <a href="#/work">My work</a>, so you can clear a queue without opening each invoice.</p>
<div class="help-note"><strong>Guardrail.</strong> A change to payment instructions is how most invoice fraud starts, so it is never cleared in one click. You must confirm that Treasury called the vendor at the number already on file.</div>
<p>Suggestions only make a person's decision faster. Penny's own decision never changes, and a cleared invoice is still checked from scratch on the next run.</p>` },

  { slug: "insights", section: "Using the web app", title: "Usage insights (Admin)",
    summary: "How Penny is used, and signals for improving it.",
    html: `
<p><a href="#/insights">Insights</a> shows how Penny is being used, so it can be improved over time.</p>
<ul>
  <li><strong>Totals:</strong> sessions, screen views, actions taken, how often suggested fixes are accepted, and the typical time from opening a held invoice to resolving it.</li>
  <li><strong>Signals to improve Penny:</strong> plain suggestions built from the numbers, such as a suggested fix people keep undoing, a search that finds nothing, a help topic people look for but cannot find, or the hold reason that comes up most.</li>
  <li><strong>Breakdowns:</strong> screens used, actions by kind and role, fixes applied by reason, searches with no results, help articles read, and errors.</li>
</ul>
<h2>Privacy</h2>
<p>Collected: screens opened, actions taken and how long they took, suggestions shown, applied or undone, searches that found nothing, shortcuts, the intro, and errors. Each event has a time and a role, not a person. Never collected: note text, passwords, or anything that identifies a real person. It stays in this browser, and you can turn it off, clear it or download it.</p>` },

  { slug: "exceptions-page", section: "Using the web app", title: "The Exceptions guide",
    summary: "Every hold reason, explained, with the invoices it applies to.",
    html: `
<p>The <a href="#/exceptions">Exceptions</a> page groups open holds by reason. For each reason it explains why it happens, what to do next, and which team acts. An invoice held for two reasons appears under both.</p>
<p>The full list of reasons is in <a href="#/help/codes">Exception codes</a>.</p>` },

  { slug: "exports", section: "Using the web app", title: "Exports: what each file is",
    summary: "The files each run writes, and what they are not.",
    html: `
<p>Each run writes files for people to review. Download them from <a href="#/exports">Exports</a>.</p>
<table class="mini"><thead><tr><th>Name</th><th>What is inside</th><th>For</th></tr></thead><tbody>
<tr><td><strong>Intacct bill import file</strong><br><code>intacct_bill_import.csv</code></td><td>Bills that passed every check, in Sage Intacct's import format, one row per bill line.</td><td>AP team, to upload to Intacct</td></tr>
<tr><td><strong>Entrata handoff list</strong><br><code>entrata_handoff.csv</code></td><td>Apartment community bills, one row per Entrata GL.</td><td>Property Accounting</td></tr>
<tr><td><strong>Invoices needing review</strong><br><code>exception_log.csv</code></td><td>Every invoice held or stopped, with the reason, the team it goes to and Penny's confidence.</td><td>AP Manager and assigned teams</td></tr>
<tr><td><strong>Approvals needed</strong><br><code>approvals_for_entered_bills.csv</code></td><td>Who must sign off on each bill in the import file. It does not record approvals.</td><td>Approvers</td></tr>
<tr><td><strong>Review workbook</strong><br><code>review_workbook.xlsx</code></td><td>All of the above as tabs in one Excel file, plus a sheet that checks every bill total with formulas.</td><td>Anyone reviewing a run</td></tr>
<tr><td><strong>Run summary</strong><br><code>run_report.md</code></td><td>One page with the counts, every decision and the pre-flight check. Choose View to read it on the page.</td><td>Anyone</td></tr>
</tbody></table>
<p>Downloads are named so you can tell them apart later, for example "Penny - Batch 01 - Intacct bill import file.csv".</p>
<div class="help-note"><strong>Generated is not imported.</strong> A bill in an import file still has to be uploaded and approved before it is paid.</div>` },

  { slug: "runs", section: "Using the web app", title: "Run history",
    summary: "Each batch Penny read, and why reruns are safe.",
    html: `
<p>A run is one pass over a folder of invoices. <a href="#/runs">Run history</a> shows every run with its results.</p>
<ul>
  <li><strong>Rerun:</strong> the same folder read again. Files already processed are skipped, so nothing is written to an import file twice.</li>
  <li><strong>Dry run:</strong> Penny writes the files for review but does not change its register. Use it to preview.</li>
  <li><strong>Pre-flight:</strong> Penny checks the import file the way Intacct would before saving anything. If pre-flight fails, nothing is saved.</li>
</ul>` },

  { slug: "audit", section: "Using the web app", title: "The audit trail",
    summary: "Who did what, when and why.",
    html: `
<p>The <a href="#/audit">Audit trail</a> lists every Penny run and every action a person took, newest first. Filter by person or action, or download it as a CSV file.</p>
<ul>
  <li>Entries are never edited or deleted. An undo is a new entry that points back to the one it undoes.</li>
  <li>Each entry shows the before and after, and the note the person wrote.</li>
  <li>The CSV download protects against spreadsheet formula tricks, so it is safe to open in Excel.</li>
</ul>` },

  { slug: "rules-edit", section: "Using the web app", title: "Changing rules (Admin)",
    summary: "Edit thresholds and routes with a preview, then undo if needed.",
    html: `
<p>Admins can change every rule on the <a href="#/rules">Rules</a> page: dollar thresholds and tolerances, the team for each exception code, the order codes are ranked in, payment terms, the words Penny looks for (payment-change wording, duplicate stamps, approved bill-to names), the keyword-to-GL rules, one-time and subscription words, posting entities and accounts, whether the AI reader is on, and the company time zone.</p>
<ol>
  <li>Change anything. Changed items turn copper. Lists have Add and remove buttons; the code order has up and down arrows.</li>
  <li>If something is not valid (an empty code, the same word twice, a term without days), Penny says what to fix before you can save.</li>
  <li>Read the preview. It lists which invoices on file would change, for example a hold that a higher PO tolerance would release, or a bill that would now need the CFO.</li>
  <li>Choose <strong>Save changes</strong> and write why. The change goes to the audit trail.</li>
  <li>To reverse it, choose <strong>Undo</strong> in Change history.</li>
</ol>
<p><strong>Time zone:</strong> every time in Penny, from the audit trail to run history, is shown in the company time zone, with its short name such as EST. New batch folders are dated by it too. Changing it changes how times read right away; the saved times themselves never change.</p>
<div class="help-note">Saved rules apply to Penny's <strong>next run</strong>. Past decisions stay exactly as Penny made them. Use <strong>Download rules.json</strong> to take the new settings back to the terminal version.</div>` },

  { slug: "search", section: "Using the web app", title: "Search and filters",
    summary: "Find any invoice fast.",
    html: `
<p>Press <kbd>/</kbd> to jump to search. You can search by vendor, invoice number, PO, file name or amount (with or without the dollar sign and commas).</p>
<p>On <a href="#/invoices">Invoices</a>, filter by status, reason, category, vendor and bill date. Click a column title to sort. Filters live in the web address, so you can bookmark or share a filtered list.</p>` },

  // ------------------------------------------------------------------ terminal
  { slug: "install", section: "Using Penny in the terminal", title: "Install and first run",
    summary: "Set Penny up on your computer in about a minute.",
    html: `
<p>Penny runs on Python 3.9 or newer. It sets up its own private environment, so it does not touch anything else on your computer.</p>
<pre><code>cd 04_Workflow
./penny install          # one time: creates .venv and installs the libraries
./penny check            # confirms Python, libraries, package and register
./penny demo --package ~/Downloads/Hillpointe_AP_Technical_Screen</code></pre>
<p>On Windows, type <code>penny</code> instead of <code>./penny</code>. If you see "permission denied", type <code>bash penny install</code>.</p>` },

  { slug: "commands", section: "Using Penny in the terminal", title: "Command reference",
    summary: "Every terminal command and what it does.",
    html: `
<table class="mini"><thead><tr><th>Command</th><th>What it does</th></tr></thead><tbody>
<tr><td><code>./penny run 1</code></td><td>Run Batch 01 and save it. Use <code>2</code> for Batch 02, or give any folder of PDFs.</td></tr>
<tr><td><code>./penny run &lt;folder&gt; -n</code></td><td>Dry run: show every decision and write files, but do not change the register.</td></tr>
<tr><td><code>./penny run &lt;folder&gt; -r my-name</code></td><td>Give the run your own name.</td></tr>
<tr><td><code>./penny explain 6</code></td><td>Print every check for document 0006 in the latest run.</td></tr>
<tr><td><code>./penny status</code></td><td>Show what the register remembers.</td></tr>
<tr><td><code>./penny demo</code></td><td>Start fresh, then run Batch 01, a rerun, Batch 02 and a rerun.</td></tr>
<tr><td><code>./penny test</code></td><td>Run the automated checks.</td></tr>
<tr><td><code>./penny reset</code></td><td>Forget everything and start fresh.</td></tr>
<tr><td><code>./penny web-export --package &lt;folder&gt;</code></td><td>Package the saved runs and invoice PDFs for this web view.</td></tr>
<tr><td><code>./penny web --package &lt;folder&gt;</code></td><td>Open this web app on your computer, with New batch able to upload and run invoices. Without <code>--package</code>, batches can be uploaded but not run.</td></tr>
</tbody></table>
<p>Add <code>--package &lt;folder&gt;</code> when the assessment package is not next to Penny's folder.</p>` },

  { slug: "register", section: "Using Penny in the terminal", title: "Dry runs and the register",
    summary: "How Penny remembers, and how to preview safely.",
    html: `
<p>Penny keeps two plain CSV files in <code>state/</code>:</p>
<ul>
  <li><code>processed_register.csv</code>: one row per bill, with status ENTERED (written to an import file), HELD or SUPERSEDED, the source file and the run.</li>
  <li><code>run_log.csv</code>: an append-only record of every document in every run.</li>
</ul>
<p>They are plain files on purpose: anyone can open them in Excel, compare versions, or copy them to another computer.</p>
<p><code>run</code>, <code>demo</code> and <code>reset</code> change these files. Add <code>-n</code> to any run to preview without changing them.</p>` },

  { slug: "publish", section: "Using Penny in the terminal", title: "Publishing this web view",
    summary: "From terminal runs to a shareable site.",
    html: `
<pre><code>./penny web-export --package ~/Downloads/Hillpointe_AP_Technical_Screen
./penny web               # preview on your computer</code></pre>
<p>The export writes <code>web/data/penny-data.json</code>, copies each invoice PDF, and copies each run's files for the Exports page. If a PDF is missing, the export names it and says where to put it.</p>
<p>The site is plain HTML, CSS and JavaScript with no build step, so any static host works. In this project, GitHub Pages publishes it whenever the web folder changes on the main branch.</p>` },

  // ------------------------------------------------------------------ how Penny decides
  { slug: "pipeline", section: "How Penny decides", title: "From PDF to decision",
    summary: "The five steps every document goes through.",
    html: `
<ol>
  <li><strong>Read.</strong> Pull the fields from the PDF. Watermarks like REPRINT are set aside as "stamps" so they cannot garble the text. A file that cannot be read is held with the exact problem.</li>
  <li><strong>Validate.</strong> Lines must add to the subtotal, and subtotal plus tax must equal the total. Pay application lines must agree. Anything that does not tie is held, never guessed.</li>
  <li><strong>Decide.</strong> Run the checks and collect <em>every</em> reason that applies, not just the first, so the person fixing it sees the whole list at once.</li>
  <li><strong>Pre-flight.</strong> Check the import file the way Intacct would (required fields, open period, due date, accounts, bill totals). If it fails, nothing is saved.</li>
  <li><strong>Write and remember.</strong> Write the files and update the register.</li>
</ol>` },

  { slug: "checks", section: "How Penny decides", title: "The checks, in order",
    summary: "Every check and the code it raises when it fails.",
    html: `
<table class="mini"><thead><tr><th>#</th><th>Check</th><th>If it fails</th></tr></thead><tbody>
<tr><td>0</td><td>The file can be read (not empty, a real PDF, not locked or damaged, has text)</td><td>OTHER</td></tr>
<tr><td>1</td><td>It is a bill, pay application or credit memo in a layout Penny can read</td><td>OTHER</td></tr>
<tr><td>2</td><td>The numbers tie out</td><td>OTHER</td></tr>
<tr><td>3</td><td>The vendor is in the vendor master and active</td><td>NEWVEND</td></tr>
<tr><td>4</td><td>The bill-to is a Hillpointe legal entity</td><td>OTHER</td></tr>
<tr><td>5</td><td>Payment instructions have not changed</td><td>BANKCHG</td></tr>
<tr><td>6</td><td>It is not a duplicate</td><td>DUP</td></tr>
<tr><td>7</td><td>Category: construction, apartment community or corporate</td><td></td></tr>
<tr><td>8</td><td>The PO or subcontract exists, matches and is open</td><td>NOPO</td></tr>
<tr><td>9</td><td>The insurance certificate is valid on the bill date</td><td>COI</td></tr>
<tr><td>10</td><td>The PO balance is not exceeded beyond the tolerance</td><td>OVERPO</td></tr>
<tr><td>11</td><td>Pay applications: approved change orders only, history agrees, retainage is right, lien waiver matches</td><td>UNAPPCO, LIEN, OTHER</td></tr>
<tr><td>12</td><td>Apartment communities: the bill equals the service agreement fee</td><td>OTHER</td></tr>
<tr><td>13</td><td>Code the lines: cost code, tax, delivery, retainage, allocation</td><td></td></tr>
<tr><td>14</td><td>Dates and terms from the vendor master; posting date moved out of closed periods</td><td></td></tr>
<tr><td>15</td><td>Approvers by category and dollar amount</td><td></td></tr>
</tbody></table>
<p>Open any invoice and choose the <strong>Checks</strong> tab to see these checks for that invoice.</p>` },

  { slug: "duplicates", section: "How Penny decides", title: "Duplicate protection",
    summary: "How Penny makes sure nothing is billed twice.",
    html: `
<p>Every bill gets a key: <strong>vendor ID + cleaned invoice number + bill or credit</strong>. Cleaning removes capital letters, dashes, spaces, an "INV" label and leading zeros, so <code>INV-20417</code>, <code>inv 020417</code> and <code>20417</code> all match.</p>
<ul>
  <li><strong>The same file again:</strong> skipped. That is what a rerun looks like.</li>
  <li><strong>A different file for the same bill</strong> (a resend, a reprint, a past-due reminder): stopped as a duplicate and sent to the AP Manager.</li>
  <li><strong>Held bills are not duplicates.</strong> A corrected version is checked again from scratch, and the old hold is closed out.</li>
  <li><strong>Same vendor and amount, different number:</strong> not a duplicate. Monthly bills repeat.</li>
  <li><strong>Credits go first</strong>, so PO balances are right when invoices are checked.</li>
</ul>` },

  { slug: "approvals-matrix", section: "How Penny decides", title: "Approvals and thresholds",
    summary: "Who must approve what, and the amounts that trigger it.",
    html: `
<p>Penny works out the required approvers for every bill that is ready to import, from the bill's category and amount. The dollar triggers live in the rules:</p>
{{thresholds}}
<p>Admins can change these on the <a href="#/rules">Rules</a> page and see which bills would be affected first.</p>` },

  { slug: "confidence", section: "How Penny decides", title: "Confidence levels",
    summary: "What High, Medium and Low mean.",
    html: `
<ul>
  <li><strong>High:</strong> every rule was clear-cut.</li>
  <li><strong>Medium:</strong> a rule needed an interpretation. Examples: an inactive vendor name mapped to its surviving record, a possible duplicate under a different number, or no service agreement on file to check a fee.</li>
  <li><strong>Low:</strong> Penny could not read the document's numbers at all, such as an unreadable file or an unfamiliar layout.</li>
</ul>
<p>Confidence is never turned into a percentage. Penny does not have a basis for one, so it does not invent one.</p>` },

  { slug: "unreadable", section: "How Penny decides", title: "Unreadable files and unfamiliar layouts",
    summary: "What happens when Penny cannot read a document.",
    html: `
<p>One bad file never stops a run. Penny holds just that file, names it, and says what is wrong:</p>
<ul>
  <li>The file is empty, or not really a PDF.</li>
  <li>The PDF is password protected or damaged.</li>
  <li>The PDF has no text, like a scanned picture. It needs OCR or manual entry.</li>
  <li><strong>The document looks like a bill but is in a layout Penny does not know.</strong> Penny says what it saw (for example, an amount due and a PO number) and holds it. It does not guess at the numbers.</li>
</ul>
<p>These are held under OTHER and go to the AP Manager. Unreadable files are not added to the register, so a fixed copy is read fresh on the next run.</p>
<p>If a person can open the file in another program, they can <a href="#/help/manual-entry">enter it by hand</a> beside a screenshot, and Penny checks what they keyed.</p>` },

  { slug: "ai", section: "How Penny decides", title: "The optional AI reader",
    summary: "When AI helps, and how it is kept in check.",
    html: `
<p>By default Penny reads PDFs with a rules-based parser: no AI, no internet, the same answer every time. For layouts it does not know, an optional mode asks Claude to read the document:</p>
<pre><code>./penny run &lt;folder&gt; --extractor hybrid   # rules first, AI only if the numbers do not tie
./penny run &lt;folder&gt; --extractor llm      # AI reads everything; the rules parser cross-checks</code></pre>
<p>The AI only reads. Every number it returns goes through the same validation, and every decision is still made by Penny's rules.</p>
<div class="help-note"><strong>Honest status:</strong> this mode was written and tested offline, but it has not been run against the live AI service. Every result on this site comes from the rules parser.</div>` },

  // ------------------------------------------------------------------ reference
  { slug: "codes", section: "Reference", title: "Exception codes",
    summary: "Every hold reason: what it means, why, and what to do.",
    html: `<p>These are the codes from the AP policy, in priority order. When an invoice has several, the highest one is shown first.</p>{{codes}}` },

  { slug: "rules-ref", section: "Reference", title: "Rules reference",
    summary: "Every setting in rules.json, and where to change it.",
    html: `
<p>Every business rule a person might want to change lives in one file, <code>config/rules.json</code>, not in the code. The values below are the ones in effect right now.</p>
{{thresholds}}
<h2>Other settings</h2>
<table class="mini"><thead><tr><th>Setting</th><th>What it controls</th></tr></thead><tbody>
<tr><td><code>routes</code></td><td>Which team each hold code goes to.</td></tr>
<tr><td><code>code_priority</code></td><td>Which code is shown first when there are several.</td></tr>
<tr><td><code>payment_change_phrases</code></td><td>Wording that raises a bank-change hold.</td></tr>
<tr><td><code>duplicate_stamps</code></td><td>Watermarks mentioned on duplicates, like REPRINT.</td></tr>
<tr><td><code>corporate</code></td><td>One-time versus subscription keywords, and corporate accounts.</td></tr>
<tr><td><code>entrata_gl_keywords</code></td><td>Which Entrata GL a description maps to.</td></tr>
<tr><td><code>construction</code></td><td>Posting entity, department and retainage account.</td></tr>
<tr><td><code>terms_days</code></td><td>Days for each payment term.</td></tr>
<tr><td><code>display.time_zone</code></td><td>The company time zone. Times in the web app and new batch folder dates use it.</td></tr>
</tbody></table>` },

  { slug: "roles", section: "Reference", title: "Roles and permissions",
    summary: "Who can see and do what.",
    html: `{{roles}}
<p>Every action checks the signed-in role twice: once to show the button, and again when the action is saved. On a real server, that second check would happen on the server.</p>` },

  { slug: "glossary", section: "Reference", title: "Glossary",
    summary: "Plain definitions of AP and Penny terms.",
    html: `
<dl class="glossary">
<dt>Accounts payable (AP)</dt><dd>The team and process that pays the company's bills.</dd>
<dt>Approver</dt><dd>A person who must sign off on a bill before it is paid, based on its category and amount.</dd>
<dt>Audit trail</dt><dd>A permanent record of who did what, when and why.</dd>
<dt>Bill-to</dt><dd>The company named on the invoice as the one being billed. It must be a Hillpointe legal entity.</dd>
<dt>Certificate of insurance (COI)</dt><dd>Proof that a vendor has the required insurance. It must be valid on the bill date.</dd>
<dt>Change order</dt><dd>An approved change to a contract's scope or price. Only executed change orders may be billed.</dd>
<dt>Credit memo</dt><dd>A document that reduces what is owed. Penny processes credits first.</dd>
<dt>Dry run</dt><dd>A run that writes files for review but does not change Penny's register.</dd>
<dt>Duplicate</dt><dd>A bill already in the ERP history or an earlier import file under the same vendor and cleaned invoice number.</dd>
<dt>Entrata</dt><dd>The property management system for apartment communities. Penny writes a handoff list for it.</dd>
<dt>ERP history</dt><dd>Bills already entered in the accounting system before Penny ran.</dd>
<dt>Exception</dt><dd>A reason Penny held an invoice for a person.</dd>
<dt>GL account</dt><dd>The general ledger account a cost is recorded to.</dd>
<dt>Hold</dt><dd>An invoice Penny will not put in any file until a person resolves the problem.</dd>
<dt>Import file</dt><dd>The CSV file a person uploads into Sage Intacct. Being in it does not mean posted or paid.</dd>
<dt>Lien waiver</dt><dd>A subcontractor's release of lien rights for work that is paid. Pay applications need a matching one.</dd>
<dt>Pay application</dt><dd>A contractor's request for payment on work completed so far, with retainage held back.</dd>
<dt>Pre-flight</dt><dd>Penny's check of the import file, done the way Intacct would, before anything is saved.</dd>
<dt>Purchase order (PO)</dt><dd>An approved order for goods or services, with a dollar limit.</dd>
<dt>Register</dt><dd>Penny's memory of every bill it has processed, used to stop duplicates.</dd>
<dt>Retainage</dt><dd>A share of each payment held back until the work is finished, set in the rules.</dd>
<dt>Route</dt><dd>The team a hold is sent to, set in the rules.</dd>
<dt>Run</dt><dd>One pass of Penny over a folder of invoices.</dd>
<dt>Sage Intacct</dt><dd>The accounting system for construction and corporate bills.</dd>
<dt>Stabilized community</dt><dd>An apartment community that is built and operating. Its bills go to Entrata.</dd>
<dt>Subcontract</dt><dd>A contract with a trade partner for part of a construction project.</dd>
<dt>Tolerance</dt><dd>How far a bill may go over its PO before it is held.</dd>
<dt>Vendor master</dt><dd>The official list of approved vendors, with their terms, addresses and phone numbers.</dd>
</dl>` },

  { slug: "security", section: "Reference", title: "Security and this demo",
    summary: "What is real, what is demo, and what production would add.",
    html: `
<p>This public site is a demo. It runs entirely in your browser, so it cannot keep secrets from you. It was still built with the habits a real system needs.</p>
<h2>What the demo does</h2>
<ul>
  <li>Passwords are checked against salted PBKDF2 hashes (150,000 rounds) and never stored as text. The comparison takes the same time whether or not it matches.</li>
  <li>Five wrong tries lock an account for one minute, doubling each time.</li>
  <li>Sessions carry a random token, end when the tab closes, and end after 30 minutes without activity.</li>
  <li>Every action checks your role again when it is saved, not only when the button is shown.</li>
  <li>Everything you type is escaped before it is shown, so a note cannot inject code.</li>
  <li>Downloaded CSV files neutralize spreadsheet formulas.</li>
</ul>
<h2>The local server for new batches</h2>
<ul>
  <li>It only accepts connections from your own computer.</li>
  <li>Every write request needs a special header that other websites cannot send, and requests from other sites are refused.</li>
  <li>Uploads must be real PDFs, 25 MB or less, with safe names that can only land inside the batch folder.</li>
  <li>A Clerk can preview; only an Admin can run for real. In this demo the server trusts the signed-in demo account; a production server would check the person itself.</li>
  <li>Every step, including failures, is appended to <code>state/batch_log.jsonl</code> and never rewritten.</li>
  <li>Uploaded invoices stay in <code>inbox/</code> on your computer and are left out of git, so they are not published by accident.</li>
</ul>
<h2>What production would add</h2>
<ul>
  <li>A server that checks every password and every action, with Argon2id hashing.</li>
  <li>Secure, HttpOnly session cookies and protection against cross-site requests.</li>
  <li>The audit trail in a database that only allows new entries.</li>
  <li>Single sign-on with the company's identity provider.</li>
</ul>
<div class="help-note">The demo accounts and passwords are public. Never type a real password into this site.</div>` },

  { slug: "faq", section: "Reference", title: "Frequently asked questions",
    summary: "Quick answers to common questions.",
    html: `
<h2>Does "Ready for Intacct import" mean the bill is paid?</h2>
<p>No. It means Penny wrote it to the import file. A person still uploads that file, the bill is approved, and then it is paid.</p>
<h2>If I clear a hold, is the bill entered right away?</h2>
<p>No. Clearing marks it ready for Penny's next run. Penny reads the corrected document from scratch and only writes it to an import file if every check passes.</p>
<h2>Can I break anything?</h2>
<p>No. Your actions are saved only in your browser. Choose <strong>Reset demo data</strong> from the menu under your name to start over.</p>
<h2>Can I upload new invoices on the public site?</h2>
<p>You can try every step, but nothing is uploaded. Reading invoices needs Penny's engine, which runs on your computer with <code>./penny web --package &lt;folder&gt;</code>.</p>
<h2>Does Penny learn from what I do?</h2>
<p>Yes, in one specific way: how people resolve holds becomes a suggested fix for the next invoice held for the same reason. It never changes how Penny decides; that stays in tested rules.</p>
<h2>Why is an amount shown as "Not read"?</h2>
<p>Penny could not read the numbers from that document, so it does not show a guess.</p>
<h2>Why do some invoices appear in more than one run?</h2>
<p>Runs can read the same folder again. That is how Penny proves a rerun is safe.</p>` },

  // ------------------------------------------------------------------ about
  { slug: "about", section: "About this project", title: "Where Penny came from",
    summary: "The assignment, and what was built beyond it.",
    html: `
<p>Penny began as Jamie Collier's answer to an accounts payable technical screen. The assignment asked for an Intacct import file, an Entrata handoff, an exception log, the required approvers, and proof that a rerun is safe. That version was submitted in October 2026 and is kept exactly as it was handed in.</p>
<p>Everything since then is Jamie's own work beyond the assignment:</p>
<ul>
  <li>Bad or unreadable files are held with a clear reason instead of stopping a run.</li>
  <li>Bills in unfamiliar layouts are described honestly instead of being called "not a bill".</li>
  <li>This web view, with sign-in, roles, real actions, rules editing, an audit trail and this help center.</li>
  <li>Suggested fixes that learn from how holds were resolved, usage insights, and uploading and running new batches from the browser.</li>
</ul>
<p>Each version is documented on its own, so it is always clear what was asked for and what was chosen. <a href="https://github.com/collierjamiec/Hillpointe_AP_Submission/blob/main/SCOPE.md" target="_blank" rel="noopener">Read the full scope and version history on GitHub.</a></p>` },
];
