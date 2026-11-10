/* Penny help center: the knowledge base.
   Each article is plain HTML written for people, at about an 8th to 9th grade reading level.
   Placeholders like {{codes}} are filled in by penny-audit-help.js from the live data (exception codes, rules, roles,
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
<p>As Sam (Admin), you can also invite new people from <a href="#/users">Users</a>. Their invitation lands in the <a href="#/outbox">Outbox</a>; open its link to set up the account, then sign in as them.</p>
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
<p><a href="#/work">My work</a> lists your open holds <strong>most urgent first</strong>: a blocker past its target date, then a bill past or near its due date (bill date plus payment terms), then the oldest holds. Each row says why it is where it is, like "Blocker 2 days overdue" or "Bill 5 days past due". Choose <strong>By team</strong> to group holds by the team that acts on them instead. Approvers see the bills waiting for their sign-off. The count in the side menu always shows how many items are waiting on you.</p>` },

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
<h2>Cards under the callout</h2>
<ul>
  <li><strong>Blockers:</strong> each reason for a hold, with its owner, target date, notes, files and who verified it, and how many are cleared. See <a href="#/help/blockers">Blockers</a>.</li>
  <li><strong>Recheck preview:</strong> after you choose <strong>Recheck</strong>, the saved result beside what Penny would decide now. See <a href="#/help/recheck">Recheck</a>.</li>
  <li><strong>Manual entry:</strong> for a file Penny could not read, an offer to key it by hand, or where that entry stands. An invoice keyed by hand is marked <strong>Keyed by hand</strong>. See <a href="#/help/manual-entry">Entering an invoice by hand</a>.</li>
  <li><strong>Suggested fixes:</strong> ready-made resolutions learned from earlier ones. See <a href="#/help/suggestions">Suggested fixes</a>.</li>
</ul>
<h2>The tabs</h2>
<ul>
  <li><strong>Checks:</strong> every check Penny ran, in order, with pass or fail.</li>
  <li><strong>What Penny read:</strong> every field taken from the PDF, including lines, totals, pay application math and lien waivers. Choose <strong>Show on page</strong> next to a value to see where it came from on the PDF. See <a href="#/help/source-highlighting">Seeing where a value came from</a>.</li>
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
<h2>Before you resolve</h2>
<ul>
  <li>Work each reason as a <a href="#/help/blockers">blocker</a>: give it an owner and a target date, attach proof, and mark it cleared. When some blockers are still open, the Resolve dialog says so.</li>
  <li>Choose <strong>Recheck</strong> to see what Penny would decide now, without saving anything. If the preview passes, a <strong>Resolve hold</strong> button appears right there.</li>
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
<p>The bill shows <em>Approved</em> once every step is approved, or <em>Sent back</em> if any step was sent back.</p>
<h2>Ask someone to approve</h2>
<p>On a bill that is waiting, choose <strong>Email for approval</strong>. Penny suggests Approvers, lists the approvals needed, links to the bill, and attaches the original invoice. See <a href="#/help/email">Emailing exports and approval requests</a>.</p>` },

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
<h2>Batches waiting to run</h2>
<p>On your computer, the New batch page also lists every folder in <code>inbox/</code> that has not been run for real yet, including invoices saved from <a href="#/help/manual-entry">manual entry</a>. Each shows its files, any manual entries and evidence, who created it and its last preview. Choose <strong>Preview</strong>, or <strong>Run for real</strong> as an Admin.</p>
<p>If a <a href="#/help/updates">required update</a> is waiting, adding batches and real runs pause until Penny is updated. Previews still work.</p>
<h2>The watched folder</h2>
<p>Penny can also pick up PDFs dropped into a folder and preview them by itself. It never runs a batch for real. See <a href="#/help/watched-folder">The watched folder</a>.</p>
<h2>What is recorded</h2>
<p>Every step is written to the audit log in Penny's database on the Penny computer, and shown in the <a href="#/audit">Audit trail</a> marked "On disk": who created the batch, who uploaded which files (name, size and a SHA-256 fingerprint that proves the exact file), who ran it, when, the folder, the run ID, preview or real, the results and the pre-flight check. A run that fails is recorded too.</p>
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
<h2>Try real email with a free test inbox</h2>
<p>A testing service such as Mailtrap gives you a private inbox that catches every email Penny sends, so nothing reaches a real person by mistake. It is the safest way to see invitations and resets work end to end.</p>
<ol>
  <li>Create a free Mailtrap account and open its email testing inbox.</li>
  <li>Copy the SMTP host, port, username and password it shows (for example <code>sandbox.smtp.mailtrap.io</code>, port <code>2525</code>), and set them as <code>PENNY_SMTP_HOST</code>, <code>PENNY_SMTP_PORT</code>, <code>PENNY_SMTP_USER</code> and <code>PENNY_SMTP_PASSWORD</code>.</li>
  <li>Run <code>./penny email status</code> to check the settings (it never prints the password), then <code>./penny email test --to you@yourcompany.com</code>. The message appears in the Mailtrap inbox. If it fails, Penny says what to check.</li>
  <li>Start <code>./penny web</code> and invite someone from <a href="#/users">Users</a>. Open the invitation in Mailtrap and follow its link to set up the account.</li>
</ol>
<p>To deliver to real inboxes instead, use a sending service with SMTP (for example Brevo, Mailjet or Resend, which have free plans; check their current limits) or your company mail account.</p>
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

  { slug: "source-highlighting", section: "Using the web app", title: "Seeing where a value came from",
    summary: "Highlight the invoice number, dates, totals and lines on the PDF itself.",
    html: `
<p><em>Added after submission, in version 1.9.0.</em></p>
<p>Penny reads values from the PDF. Source highlighting shows you <strong>where on the page</strong> each one came from, so you can check Penny's reading with your own eyes in a second.</p>
<h2>How to use it</h2>
<ol>
  <li>Open an invoice and choose the <strong>What Penny read</strong> tab.</li>
  <li>Choose <strong>Show on page</strong> next to a value, such as the invoice number, bill date, terms, PO, vendor, bill-to, subtotal, tax, total or a line.</li>
  <li>The PDF scrolls to that spot and draws a labeled box around it.</li>
</ol>
<p>To see everything at once, choose <strong>Highlight what Penny read</strong> above the PDF. Choose it again to clear the boxes.</p>
<h2>What it can and cannot tell you</h2>
<ul>
  <li>Penny finds each value by searching the PDF's own text for what it read. When the same number appears more than once, it picks the one beside the right label, like "Total" or "Invoice #".</li>
  <li>If a value is not on the page as text, Penny says so instead of guessing. That happens with scanned pages and with invoices <a href="#/help/manual-entry">keyed by hand</a>.</li>
  <li>A highlight shows where a value is. It does not prove the value is right. The <strong>Checks</strong> tab does that work.</li>
</ul>` },

  { slug: "export-history", section: "Using the web app", title: "Export history: has this file been imported?",
    summary: "Created, downloaded, imported, confirmed. So nobody imports a file twice.",
    html: `
<p><em>Added after submission, in version 1.9.0.</em></p>
<p>Two of Penny's files get loaded into another system: the <strong>Intacct bill import file</strong> and the <strong>Entrata handoff list</strong>. On <a href="#/exports">Exports</a>, each one now shows its history, so the answer to "did someone already import this?" is on the screen.</p>
<table class="mini"><thead><tr><th>Step</th><th>What it means</th><th>Who</th></tr></thead><tbody>
<tr><td><strong>Created</strong></td><td>Penny wrote the file in a run.</td><td>Penny</td></tr>
<tr><td><strong>Downloaded</strong></td><td>Someone saved a copy. Penny notes who and when, every time.</td><td>Anyone who can see it</td></tr>
<tr><td><strong>Imported</strong></td><td>A person says they loaded it. They type the other system's reference and the number of rows it accepted.</td><td>AP Clerk or Admin</td></tr>
<tr><td><strong>Confirmed</strong></td><td>A <em>different</em> person checked it in that system and ticked the box.</td><td>Approver or Admin</td></tr>
</tbody></table>
<h2>The safety checks</h2>
<ul>
  <li><strong>The row count must match.</strong> If the other system accepted a different number of rows than the file holds, Penny refuses the entry and tells you to find out why first.</li>
  <li><strong>Two people.</strong> The person who imported a file cannot confirm it.</li>
  <li><strong>A warning before a second import.</strong> Downloading a file that is already marked imported shows a warning about duplicate bills first.</li>
  <li><strong>The exact file.</strong> Each file shows a fingerprint (SHA-256), so you can prove the copy you hold is the one Penny wrote.</li>
  <li><strong>Mistakes can be fixed.</strong> An Admin can choose <strong>Mark as not imported</strong>, with a reason. Nothing is erased; the <a href="#/help/audit">audit trail</a> keeps every step.</li>
</ul>
<p>Preview runs and empty files cannot be marked as imported, and the page says why.</p>
<p>On an invoice, a bill in an imported file shows <strong>Import recorded</strong> beside its status.</p>
<div class="help-note"><strong>Penny still never uploads, posts or pays.</strong> This history is what people told Penny they did in the other system. "Import recorded" does not mean a bill is approved or paid.</div>` },

  { slug: "watched-folder", section: "Using the web app", title: "The watched folder",
    summary: "Drop PDFs into one folder and Penny previews them by itself.",
    html: `
<p><em>Added after submission, in version 1.9.0.</em></p>
<p>On your own computer, Penny can watch a folder. Drop invoice PDFs into it (from a scanner, an email rule or by hand) and Penny files them as a new batch and runs a <strong>preview</strong>.</p>
<h2>Turning it on</h2>
<pre><code>./penny web --package &lt;package folder&gt; --watch            # watches inbox/_incoming
./penny web --package &lt;package folder&gt; --watch ~/Scans    # or a folder you choose</code></pre>
<p>Or set <code>"watch": {"enabled": true}</code> in <code>config/rules.json</code>. The <a href="#/batch">New batch</a> page then shows the folder, when it was last checked, the last pickup, and a <strong>Check now</strong> button.</p>
<h2>What it will and will not do</h2>
<ul>
  <li><strong>It only previews.</strong> The register is never changed, so nothing can be entered just because a file appeared in a folder. An Admin still runs the batch for real from New batch.</li>
  <li><strong>It waits for a file to finish.</strong> A file is taken once it has stopped changing for a few seconds, so a scan or download still being written is left alone.</li>
  <li><strong>Only real PDFs.</strong> The name must end in .pdf, the content must be a PDF, and it must be 25 MB or less. Anything else stays in the folder, and the page lists it with the reason.</li>
  <li><strong>It never deletes.</strong> Files are moved into the new batch folder, such as <code>inbox/2026-11-10_watched-folder</code>. Shortcuts to files elsewhere, hidden files and sub-folders are ignored.</li>
  <li><strong>It pauses for required updates</strong>, like every other change. See <a href="#/help/updates">Versions and updates</a>.</li>
</ul>
<h2>What is recorded</h2>
<p>Each pickup is in the <a href="#/audit">Audit trail</a> as "Picked up files from the watched folder", with every file's name, size and fingerprint, followed by the usual batch and preview entries. The pickup is recorded under the name <strong>Watched folder</strong>, which can only preview.</p>
<div class="help-note"><strong>Where this works.</strong> The watched folder needs Penny running on a computer, so it is not part of the public demo site.</div>` },

  { slug: "phone", section: "Using the web app", title: "Using Penny on a phone",
    summary: "What changes on a small screen, and what is easier on a computer.",
    html: `
<p><em>Added after submission, in version 1.9.1.</em></p>
<p>Penny is laid out for a phone, not just squeezed onto one. Nothing scrolls sideways, and everything you can do on a computer you can do here.</p>
<h2>What changes on a phone</h2>
<ul>
  <li><strong>The menu</strong> is behind the button with three lines, at the top left. Choosing a page closes it.</li>
  <li><strong>Lists become cards.</strong> Each invoice shows the vendor and the amount side by side, then the date and the status. Tap anywhere on a card to open it.</li>
  <li><strong>Sorting</strong> moves to a row of <strong>Sort by</strong> buttons above the cards.</li>
  <li><strong>Filters fold away.</strong> On Invoices, the search box stays and the rest is behind <strong>Filters</strong>. The button counts the filters in use, like "Filters (2)".</li>
  <li><strong>Other tables</strong>, like the audit trail and Users, name each value on the card: Who, Action, Details.</li>
  <li><strong>Dialogs rise from the bottom</strong> of the screen, with full-width buttons where your thumb is.</li>
  <li><strong>Buttons and fields are larger</strong>, at least 44 pixels tall, and typing in a field does not zoom the page.</li>
</ul>
<h2>What is easier on a computer</h2>
<ul>
  <li><strong>Reading the invoice PDF.</strong> On a phone the page is small. Pinch to zoom, or choose <strong>Open in new tab</strong>. Reviewing a PDF beside Penny's checks needs a wider screen.</li>
  <li><strong>Line item tables</strong> (lines, coding) keep their columns and scroll sideways inside their own box, because the numbers need to line up. A shadow on the right edge shows there is more.</li>
  <li><strong>Editing rules</strong> works, but it is a long page on a phone.</li>
  <li><strong>Keyboard shortcuts</strong> need a keyboard.</li>
</ul>
<div class="help-note"><strong>How it is checked.</strong> An automated suite uses the app on an emulated iPhone on every change. An emulator is not a hand: it has not yet been tried on a range of real phones and tablets.</div>` },

  { slug: "team", section: "Using the web app", title: "Working as a team",
    summary: "One Penny for everyone: shared work, live updates, and checks on the server.",
    html: `
<p><em>Added after submission, in version 2.0.0.</em></p>
<p>When Penny runs on a computer with real accounts, that computer is the single source of truth for the whole team. The label at the top right says <strong>Team</strong>.</p>
<h2>What changes</h2>
<ul>
  <li><strong>Everyone sees the same picture.</strong> Holds, blockers, approvals, notes, import history and rule changes are saved on the server, not in each person's browser. Sign in from any computer and your work is there.</li>
  <li><strong>Live updates.</strong> When a teammate does something, your screen updates within a moment and a short message says who did what. No reload.</li>
  <li><strong>Typing is never interrupted.</strong> If you are in the middle of a note or a form, Penny waits and shows <strong>Your team made changes. Show them</strong> at the top.</li>
  <li><strong>The rules on the Rules page are the rules Penny runs with.</strong> A saved change is written to <code>config/rules.json</code> on the server, and the file as it was is kept in <code>state/rules_history/</code>.</li>
</ul>
<h2>What the server checks</h2>
<p>Every action is checked on the server before it is saved. The server decides who you are from your sign-in, never from what the browser says.</p>
<table class="mini"><thead><tr><th>Check</th><th>What you see if it fails</th></tr></thead><tbody>
<tr><td>Your role may do it</td><td>"Only an Approver or Admin can approve bills."</td></tr>
<tr><td>Nobody got there first</td><td>"Avery Chen already resolved this hold." Penny then shows you their decision.</td></tr>
<tr><td>A second person, where one is needed</td><td>The person who imported a file cannot confirm it. The second check of a manual entry is a different person.</td></tr>
<tr><td>The details match the real file</td><td>The row count for "Mark as imported" must equal the rows in the file. A preview's files cannot be imported.</td></tr>
<tr><td>A rule is changed from the value you were looking at</td><td>"The rule changed while you were working, so nothing was saved."</td></tr>
</tbody></table>
<p>To stay quick, your action shows on screen right away. If the server refuses it, Penny takes it back off the screen and tells you why in a box titled <strong>Penny did not save that</strong>.</p>
<h2>The audit trail</h2>
<p>There is now one <a href="#/audit">audit trail</a> for the team, kept in a database on the server (<code>state/penny.db</code>). The database itself refuses to change or delete an entry: an undo is a new entry.</p>
<h2>Moving earlier work in</h2>
<p>Before 2.0, what people did was saved in each browser. The first time an Admin signs in with a browser that still holds earlier work, Penny offers to move it into the team's audit trail. Each action keeps its original time and person and is marked as moved, with who moved it. Rule changes moved this way are history only. Nothing is removed from the browser.</p>
<div class="help-note"><strong>Where this works.</strong> Team mode needs Penny running on a computer with real accounts. See <a href="#/help/network">Running Penny for your team</a>. The public demo site is still a single-person showcase: there, what you do stays in your own browser.</div>` },

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
<p>Choose <strong>Email</strong> next to any file to send it with the file attached and a note saying what it is. Penny only emails its users and the company's allowed domains. See <a href="#/help/email">Emailing exports and approval requests</a>.</p>
<h2>Has it been imported?</h2>
<p>The Intacct bill import file and the Entrata handoff list each show a history: Created, Downloaded, Imported and Confirmed, with who and when. It stops a file from being imported twice. See <a href="#/help/export-history">Export history</a>.</p>
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
<p>When Penny runs for a team, this is one trail for everyone, kept in a database that only allows new entries. See <a href="#/help/team">Working as a team</a>.</p>
<p>It brings together three sources:</p>
<ul>
  <li><strong>Penny's runs</strong>, with what each one decided.</li>
  <li><strong>What people did in Penny:</strong> resolving and reassigning holds, blockers and their files, manual entries and second checks, approvals, notes, rule changes (including the time zone and the company look), and each step of an import file's history: downloaded, imported, confirmed.</li>
  <li><strong>What the Penny computer recorded</strong>, marked "On disk": new batches, uploads with file fingerprints, runs and failures, rechecks with the fingerprints they used, saved manual entries, invitations, account changes, password resets, sign-ins, and every email with its attachments and whether it was sent, and each pickup from the watched folder.</li>
</ul>
<ul>
  <li>Entries are never edited or deleted. An undo is a new entry that points back to the one it undoes.</li>
  <li>Times show in the company time zone, and entries from the same second keep the order they happened in.</li>
  <li>Each entry shows the before and after, and the note the person wrote.</li>
  <li>The CSV download protects against spreadsheet formula tricks, so it is safe to open in Excel. It always holds every entry that matches your filters, not just the page on screen.</li>
  <li>A long trail shows 25 entries at a time. Use the page buttons under the table.</li>
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
<p>On <a href="#/invoices">Invoices</a>, filter by status, reason, category, vendor and bill date. Click a column title to sort. Filters live in the web address, so you can bookmark or share a filtered list.</p>
<h2>Long lists</h2>
<p>A long list shows 25 rows at a time, so Penny stays quick with thousands of invoices. Under the table, use <strong>First</strong>, <strong>Previous</strong>, <strong>Next</strong> and <strong>Last</strong>, or choose 50 or 100 rows. The page is part of the web address too, so the Back button returns you to the same place.</p>
<p>Counts and totals above a table always describe the <strong>whole</strong> list, not just the page on screen. <strong>Next</strong> and <strong>Previous</strong> on an invoice also follow the whole list, across pages. On Exceptions and the By team view, a long group shows its 50 largest invoices with a link to the rest.</p>` },

  // ------------------------------------------------------------------ terminal
  { slug: "install", section: "Using Penny in the terminal", title: "Install and first run",
    summary: "Set Penny up on your computer in about a minute.",
    html: `
<p>Penny runs on Python 3.9 or newer. It sets up its own private environment, so it does not touch anything else on your computer.</p>
<pre><code>cd 04_Workflow
./penny install          # one time: creates .venv and installs the libraries
./penny check            # confirms Python, libraries, package and register
./penny demo --package ~/Downloads/Hillpointe_AP_Technical_Screen</code></pre>
<p>On Windows, type <code>penny</code> instead of <code>./penny</code>. If you see "permission denied", type <code>bash penny install</code>.</p>
<h2>Next, for a team</h2>
<ol>
  <li>Create the first Admin: <code>./penny users invite --email you@company.com --name "Your Name" --role admin</code>. Penny prints the set-up link if email is not set up yet.</li>
  <li>Set up email so invitations, resets and exports go out (see <a href="#/help/email">Emailing exports and approval requests</a>).</li>
  <li>Start the web app with <code>./penny web --package &lt;folder&gt;</code>, open the link, choose your password, and invite everyone else from <a href="#/users">Users</a>.</li>
</ol>` },

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
<tr><td><code>python tests/browser/run.py</code></td><td>Run the browser tests against a temporary copy of Penny. Needs Node and Playwright; your real data is never touched.</td></tr>
<tr><td><code>./penny reset</code></td><td>Forget everything and start fresh.</td></tr>
<tr><td><code>./penny web-export --package &lt;folder&gt;</code></td><td>Package the saved runs and invoice PDFs for this web view.</td></tr>
<tr><td><code>./penny web --package &lt;folder&gt;</code></td><td>Open this web app on your computer, with New batch able to upload and run invoices. Without <code>--package</code>, batches can be uploaded but not run.</td></tr>
<tr><td><code>./penny web --package &lt;folder&gt; --watch</code></td><td>The same, and also pick up PDFs dropped into <code>inbox/_incoming</code> (or a folder you name after <code>--watch</code>) and preview them. See <a href="#/help/watched-folder">The watched folder</a>.</td></tr>
<tr><td><code>./penny web --host 0.0.0.0 --https</code></td><td>Open Penny to your team's network. Needs real accounts and a certificate. See <a href="#/help/network">Running Penny for your team</a>.</td></tr>
<tr><td><code>./penny cert --host &lt;name&gt;</code></td><td>Make a self-signed certificate for https in <code>state/tls/</code>.</td></tr>
<tr><td><code>./penny migrate</code></td><td>Move the audit log and accounts from before 2.0 into the database. Penny also does this by itself the first time it starts.</td></tr>
<tr><td><code>./penny --version</code></td><td>Show which version of Penny this is.</td></tr>
<tr><td><code>./penny update</code></td><td>Show what is new and update from GitHub. Add <code>--check</code> to only look, or <code>--skip</code> to wait on an optional version. Your register, runs and batches are never touched.</td></tr>
<tr><td><code>./penny users invite --email &lt;email&gt; --name "Name" --role admin</code></td><td>Invite someone. The first invite turns on real accounts, so everyone signs in with their own password.</td></tr>
<tr><td><code>./penny users list</code></td><td>List everyone with an account, their role and status.</td></tr>
<tr><td><code>./penny email status</code></td><td>Show the mail settings Penny will use. The password is never printed.</td></tr>
<tr><td><code>./penny email test --to &lt;email&gt;</code></td><td>Send one test email. If it fails, Penny says what to check.</td></tr>
<tr><td><code>./penny release 2.0.0 --summary "..."</code></td><td>(Maintainer) publish a new version. Add <code>--note</code> for each change and <code>--required</code> to make it the minimum.</td></tr>
</tbody></table>
<p>Add <code>--package &lt;folder&gt;</code> when the assessment package is not next to Penny's folder.</p>` },

  { slug: "network", section: "Using Penny in the terminal", title: "Running Penny for your team",
    summary: "Real accounts, https, and opening Penny to other computers.",
    html: `
<p><em>Added after submission, in version 2.0.0.</em></p>
<p>By default Penny only answers the computer it runs on. To let a team use it, three things are needed, in this order.</p>
<h2>1. Real accounts</h2>
<pre><code>./penny users invite --email you@company.com --name "Your Name" --role admin</code></pre>
<p>The first invitation turns on real sign-in. Invite everyone else from the <a href="#/users">Users</a> page. See <a href="#/help/users">Managing people</a>.</p>
<h2>2. A certificate, so the connection is encrypted (https)</h2>
<pre><code>./penny cert --host ap-server.yourcompany.local</code></pre>
<p>This makes a self-signed certificate in <code>state/tls/</code>, good for one year. Use the name teammates will type. Browsers warn about a self-signed certificate the first time; a certificate from your IT team avoids that:</p>
<pre><code>./penny web --host 0.0.0.0 --cert company.pem --key company.key</code></pre>
<h2>3. Start Penny for the network</h2>
<pre><code>./penny web --package &lt;package folder&gt; --host 0.0.0.0 --https</code></pre>
<p>Penny prints the address teammates use. Set <code>PENNY_PUBLIC_URL</code> to that address so links in emails point to it.</p>
<h2>What Penny refuses</h2>
<ul>
  <li><strong>No accounts, no network.</strong> Penny will not open to other computers while it is still using the public demo accounts.</li>
  <li><strong>No https, no network.</strong> Without a certificate, passwords and invoices would cross the network in the clear, so Penny stops and says how to fix it. If a proxy in front of Penny already provides https, add <code>--allow-http</code> and set <code>PENNY_PUBLIC_URL</code> to the https address.</li>
</ul>
<h2>What https adds</h2>
<ul>
  <li>The sign-in cookie is marked <strong>Secure</strong>, so the browser never sends it over plain http.</li>
  <li>Browsers are told to always use https for this address from then on.</li>
  <li>Wrong passwords are limited two ways: five tries lock an email for a minute (doubling each time), and 20 wrong tries from one computer lock that computer out for five minutes.</li>
</ul>
<h2>Moving from an earlier version</h2>
<p>The first time 2.0 starts, it moves the audit log and accounts from their old files into the database (<code>state/penny.db</code>) and says what it moved. The old files are renamed with <code>.moved</code> on the end, never deleted. You can also run <code>./penny migrate</code> yourself. The processed-invoice register and the run folders stay as files, because the engine also runs from the terminal and those files are what an auditor opens.</p>
<h2>Good to know</h2>
<ul>
  <li><strong>Back up <code>state/</code>.</strong> It holds the database, the register and the certificate.</li>
  <li><strong>Restarting Penny signs everyone out.</strong> Sign-ins are kept in memory. Nothing else is lost.</li>
  <li><strong>One Penny, one computer.</strong> Run a single copy for the team. Two copies pointed at the same folder is not supported.</li>
  <li><strong>Behind a proxy,</strong> every sign-in appears to come from the proxy, so the per-computer limit counts everyone together.</li>
</ul>` },

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
<tr><td><code>display.theme</code></td><td>The company look (colors, background and corners). Set it on the <a href="#/appearance">Appearance</a> page.</td></tr>
<tr><td><code>email.allowed_domains</code></td><td>The only domains Penny may email, besides its own users. Files are attached, so keep this to your company.</td></tr>
<tr><td><code>email.max_recipients</code></td><td>The most people one email may go to.</td></tr>
</tbody></table>
<p>The thresholds above include <strong>Manual entry second check</strong>: invoices keyed by hand with a total over it are keyed again by a different person.</p>` },

  { slug: "roles", section: "Reference", title: "Roles and permissions",
    summary: "Who can see and do what.",
    html: `{{roles}}
<p>Every action checks the signed-in role twice: once to show the button, and again when the action is saved. When Penny runs for a team, that second check happens on the server, which decides who you are from your sign-in. See <a href="#/help/team">Working as a team</a>.</p>` },

  { slug: "glossary", section: "Reference", title: "Glossary",
    summary: "Plain definitions of AP and Penny terms.",
    html: `
<dl class="glossary">
<dt>Accounts payable (AP)</dt><dd>The team and process that pays the company's bills.</dd>
<dt>Approver</dt><dd>A person who must sign off on a bill before it is paid, based on its category and amount.</dd>
<dt>Audit trail</dt><dd>A permanent record of who did what, when and why.</dd>
<dt>Blocker</dt><dd>One reason a held invoice is waiting, tracked on its own with an owner, a target date, notes, files and a verifier.</dd>
<dt>Bill-to</dt><dd>The company named on the invoice as the one being billed. It must be a Hillpointe legal entity.</dd>
<dt>Certificate of insurance (COI)</dt><dd>Proof that a vendor has the required insurance. It must be valid on the bill date.</dd>
<dt>Company look</dt><dd>The colors and corners everyone sees unless they choose their own. An Admin sets it.</dd>
<dt>Change order</dt><dd>An approved change to a contract's scope or price. Only executed change orders may be billed.</dd>
<dt>Credit memo</dt><dd>A document that reduces what is owed. Penny processes credits first.</dd>
<dt>Dry run</dt><dd>A run that writes files for review but does not change Penny's register.</dd>
<dt>Duplicate</dt><dd>A bill already in the ERP history or an earlier import file under the same vendor and cleaned invoice number.</dd>
<dt>Entrata</dt><dd>The property management system for apartment communities. Penny writes a handoff list for it.</dd>
<dt>ERP history</dt><dd>Bills already entered in the accounting system before Penny ran.</dd>
<dt>Export history</dt><dd>The record of an import file from created, to downloaded, to imported, to confirmed by a second person. See <a href="#/help/export-history">Export history</a>.</dd>
<dt>Exception</dt><dd>A reason Penny held an invoice for a person.</dd>
<dt>GL account</dt><dd>The general ledger account a cost is recorded to.</dd>
<dt>Hold</dt><dd>An invoice Penny will not put in any file until a person resolves the problem.</dd>
<dt>Import file</dt><dd>The CSV file a person uploads into Sage Intacct. Being in it does not mean posted or paid.</dd>
<dt>Keyed by hand</dt><dd>An invoice a person typed in from a screenshot or re-saved copy because Penny could not read the file. Penny still checks it.</dd>
<dt>Lien waiver</dt><dd>A subcontractor's release of lien rights for work that is paid. Pay applications need a matching one.</dd>
<dt>Maker-checker</dt><dd>A control where a second person repeats key work without seeing the first person's answer. Penny uses it for manual entries over a dollar limit.</dd>
<dt>Outbox</dt><dd>The list of every email Penny sent or saved, with its attachments and whether it went out.</dd>
<dt>Pay application</dt><dd>A contractor's request for payment on work completed so far, with retainage held back.</dd>
<dt>Pre-flight</dt><dd>Penny's check of the import file, done the way Intacct would, before anything is saved.</dd>
<dt>Purchase order (PO)</dt><dd>An approved order for goods or services, with a dollar limit.</dd>
<dt>Recheck</dt><dd>A preview of what Penny would decide now for a held invoice. Nothing is saved.</dd>
<dt>Register</dt><dd>Penny's memory of every bill it has processed, used to stop duplicates.</dd>
<dt>Required update</dt><dd>A Penny version everyone must install. Until they do, Penny is read-only for them.</dd>
<dt>Retainage</dt><dd>A share of each payment held back until the work is finished, set in the rules.</dd>
<dt>Route</dt><dd>The team a hold is sent to, set in the rules.</dd>
<dt>Run</dt><dd>One pass of Penny over a folder of invoices.</dd>
<dt>Sage Intacct</dt><dd>The accounting system for construction and corporate bills.</dd>
<dt>Stabilized community</dt><dd>An apartment community that is built and operating. Its bills go to Entrata.</dd>
<dt>Subcontract</dt><dd>A contract with a trade partner for part of a construction project.</dd>
<dt>Team mode</dt><dd>Penny running on a computer with real accounts. Everyone's work is checked and saved there, and teammates see it live. See <a href="#/help/team">Working as a team</a>.</dd>
<dt>Tolerance</dt><dd>How far a bill may go over its PO before it is held.</dd>
<dt>Watched folder</dt><dd>A folder Penny checks for new invoice PDFs. It files them as a batch and previews them, and never runs a batch for real.</dd>
<dt>Vendor master</dt><dd>The official list of approved vendors, with their terms, addresses and phone numbers.</dd>
</dl>` },

  { slug: "accessibility", section: "Reference", title: "Accessibility",
    summary: "What Penny does for keyboard, screen reader, low vision and motion needs, and what is still to check.",
    html: `
<p><em>Reviewed and improved after submission, in version 1.9.0.</em></p>
<p>Penny aims to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA. Here is what that means in practice, and where the honest limits are.</p>
<h2>What is in place</h2>
<ul>
  <li><strong>Keyboard:</strong> everything works without a mouse. The first Tab stop is <strong>Skip to content</strong>. Dialogs keep focus inside and return it to the button you came from. See <a href="#/help/shortcuts">Keyboard shortcuts</a>.</li>
  <li><strong>Screen readers:</strong> pages have one main heading, named regions, labeled form fields and buttons, and messages that are announced when they appear.</li>
  <li><strong>Color:</strong> text meets AA contrast in light and dark. A status is never shown by color alone: it has an icon and a word. Links inside sentences are underlined.</li>
  <li><strong>Zoom and small screens:</strong> pages reflow at 200% zoom and on a phone with no sideways scrolling. A table that is too wide scrolls inside its own area, which can be reached and scrolled from the keyboard.</li>
  <li><strong>Targets:</strong> buttons and links are at least 24 by 24 pixels, and at least 44 pixels tall on a phone or touch screen. See <a href="#/help/phone">Using Penny on a phone</a>.</li>
  <li><strong>Motion:</strong> if your device asks for reduced motion, the intro is skipped and animations are turned off. You can also turn motion off in <a href="#/help/appearance">Appearance</a>, and make text larger there.</li>
</ul>
<h2>How it is checked</h2>
<p>An automated suite runs on every change. It checks every main screen with the axe-core engine in light and dark, on a desktop and a phone, and then tests keyboard order, focus in dialogs, target sizes, reduced motion and reflow.</p>
<h2>What is still to check</h2>
<div class="help-note"><strong>Automated tools find only part of the picture.</strong> They cannot tell whether a page makes sense when read aloud. Before Penny is used by a real team, a person who uses a screen reader every day should try the main tasks. The invoice PDF itself is shown as an image of the page; the values Penny read from it are in the <strong>What Penny read</strong> tab as real text.</div>
<p>If something gets in your way, that is a bug. Please report it on the project's GitHub page.</p>` },

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
  <li>A content security policy tells the browser to run scripts only from Penny's own files, never inline ones, so even an injected script would be blocked.</li>
  <li>Nothing is loaded from other sites. Fonts are bundled, so your visit is not reported to anyone and Penny works offline.</li>
  <li>Downloaded CSV files neutralize spreadsheet formulas.</li>
</ul>
<h2>The local server for new batches</h2>
<ul>
  <li>It only accepts connections from your own computer, unless you open it to your team with real accounts and https. Penny refuses to open to the network without both. See <a href="#/help/network">Running Penny for your team</a>.</li>
  <li>Every write request needs a special header that other websites cannot send, and requests from other sites are refused.</li>
  <li>Uploads must be real PDFs, 25 MB or less, with safe names that can only land inside the batch folder.</li>
  <li>A Clerk can preview; only an Admin can run for real. Without accounts, the server trusts the signed-in demo account. Once accounts are on, it checks the person itself (below).</li>
  <li>Every step, including failures, is added to the audit log in Penny's database (<code>state/penny.db</code>). The database itself refuses to change or delete an entry.</li>
  <li>Uploaded invoices stay in <code>inbox/</code> on your computer and are left out of git, so they are not published by accident.</li>
</ul>
<h2>Real accounts on your computer</h2>
<ul>
  <li>Once the first Admin is invited, Penny on your computer checks every password itself. Passwords are salted PBKDF2 hashes (200,000 rounds); invitation and reset links are stored only as hashes, work once and expire.</li>
  <li>The session is an HttpOnly, SameSite=Strict cookie that page scripts cannot read and other sites cannot send. It ends after 30 idle minutes, and at once when someone is turned off or their role changes.</li>
  <li>Every request acts as the signed-in person. Anything the browser says about who it is is ignored, so a Viewer cannot pretend to be an Admin.</li>
  <li>Email passwords live in environment variables, never in a project file. Links are blanked out of saved copies once an email is really sent, and files are only emailed to Penny users and the company's allowed domains.</li>
  <li>The database, the https key, links and the outbox are left out of git.</li>
  <li>Over https the session cookie is also marked Secure, and browsers are told to always use https for that address.</li>
  <li>Twenty wrong passwords from one computer lock that computer out for five minutes, on top of the lock on each email.</li>
  <li>Every action a person takes is checked on the server: their role, what teammates already did, and second-person rules. See <a href="#/help/team">Working as a team</a>.</li>
  <li>Every response carries the same content security policy and headers that stop other sites from framing Penny or guessing file types. The record of failed sign-ins is capped, so it cannot grow without limit.</li>
</ul>
<h2>What is still to come</h2>
<ul>
  <li>Single sign-on with the company's identity provider (intended for 2.1).</li>
  <li>Argon2id password hashing, in place of PBKDF2.</li>
  <li>Sign-ins that survive a restart of Penny. Today a restart signs everyone out.</li>
  <li>An outside security review. The checks here are tested on every change, but nobody outside the project has tried to break them.</li>
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
<h2>Does the demo send real email?</h2>
<p>No. Invitations, resets and emailed files go to the <a href="#/outbox">Outbox</a> in your browser, and their links work there. Penny on your computer sends real email once a mail account is set up.</p>
<h2>Can I make Penny easier on my eyes?</h2>
<p>Yes. Open <a href="#/appearance">Appearance</a> to pick light or dark, a larger text size, a theme or your own color, compact density, or less motion. It is saved to your account.</p>
<h2>What if Penny cannot read an invoice?</h2>
<p>If you can open it in another program, key it by hand beside a screenshot. Penny checks what you keyed like any other invoice. See <a href="#/help/manual-entry">Entering an invoice by hand</a>.</p>
<h2>How is Penny tested?</h2>
<p>Two ways, on every change: 108 automated checks of Penny's decisions, accounts, email and server, and 17 browser suites that sign in as each role and use the app the way a person would, including an <a href="#/help/accessibility">accessibility</a> check of every screen a test with 5,000 invoices, a run on an emulated <a href="#/help/phone">phone</a>, and three people <a href="#/help/team">working at once</a>. A third set runs on the maintainer's computer with the full example package.</p>
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
  <li>Blockers with owners and evidence, recheck previews, a rule simulator, manual entry with a second-person check, and a most-urgent-first queue (1.5).</li>
  <li>The version on every screen, and updates that are required or optional (1.6.0).</li>
  <li>Managing people with invitations and resets, emailing files and approval requests, and appearance settings (1.7.0).</li>
  <li>A foundation release with no new features: browser tests on every change, a faster server, a content security policy, and clearer code (1.8.0).</li>
</ul>
<p>Next comes Penny for a real team: one shared server, so everyone sees the same work. <a href="https://github.com/collierjamiec/Hillpointe_AP_Submission/blob/main/ROADMAP.md" target="_blank" rel="noopener">Read the roadmap to 2.0.</a></p>
<p>Each version is documented on its own, so it is always clear what was asked for and what was chosen. <a href="https://github.com/collierjamiec/Hillpointe_AP_Submission/blob/main/SCOPE.md" target="_blank" rel="noopener">Read the full scope and version history on GitHub.</a></p>` },
];
