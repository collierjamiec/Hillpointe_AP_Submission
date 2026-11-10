/* Penny: the setup wizard (v2.1). A few screens that get Penny ready on a computer.
   It talks to /api/setup, which only answers when Penny was started with ./penny setup and the request carries
   that run's one-time key. The key arrives in the address after "#", which browsers never send to a server or
   write to a log; it is kept in this tab only.
   Sections: helpers, talking to Penny, the steps, drawing, start. */
"use strict";

// ------------------------------------------------------------------ helpers
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
const ICON = {
  ok: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M6.5 10.2l2.4 2.4 4.6-5"/></svg>`,
  bad: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M7 7l6 6M13 7l-6 6"/></svg>`,
  note: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M10 6v5M10 13.6v.4"/></svg>`,
};
const ZONES = [["America/New_York", "Eastern"], ["America/Chicago", "Central"], ["America/Denver", "Mountain"], ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"], ["America/Anchorage", "Alaska"], ["Pacific/Honolulu", "Hawaii"], ["UTC", "UTC"]];

// ------------------------------------------------------------------ talking to Penny
const KEY = (() => {
  const m = /[#&]key=([A-Za-z0-9_-]{8,})/.exec(location.hash);
  let key = m ? m[1] : "";
  try {
    if (key) sessionStorage.setItem("penny.setup.key", key); else key = sessionStorage.getItem("penny.setup.key") || "";
  } catch (e) { /* private browsing: the key lasts until the page is reloaded */ }
  if (m) history.replaceState(null, "", location.pathname);      // keep the key out of the address bar and history
  return key;
})();
async function ask(path, body) {
  const opts = { headers: { "X-Penny": "1", "X-Penny-Setup": KEY } };
  if (body) Object.assign(opts, { method: "POST", body: JSON.stringify(body) }, { headers: { ...opts.headers, "Content-Type": "application/json" } });
  let res;
  try { res = await fetch(path, opts); } catch (e) { throw new Error("Penny is not answering. Check that the setup window (Terminal) is still open, then try again."); }
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty */ }
  if (!res.ok) { const err = new Error(data.error || `Penny answered ${res.status}.`); err.status = res.status; throw err; }
  return data;
}

// ------------------------------------------------------------------ the steps
/* What the person has chosen so far. Saved to Penny only on the last screen. */
const W = { step: 0, state: null, pkg: null, path: "", skipPkg: false, mode: "solo", admin: null, zone: "", https: false, host: "", watch: false, done: null, busy: false, error: "" };
const STEPS = [
  { id: "check", name: "This computer" },
  { id: "package", name: "Your invoices" },
  { id: "people", name: "Who uses Penny" },
  { id: "settings", name: "Settings" },
  { id: "done", name: "All set" },
];
const hasPeople = () => W.state.people > 0;

function viewCheck() {
  const c = W.state.check;
  const rows = c.rows.map((r) => `<li class="${r.ok ? "ok" : r.need ? "bad" : "note"}">${r.ok ? ICON.ok : r.need ? ICON.bad : ICON.note}
    <div><b>${esc(r.name)}</b><span>${esc(r.detail)}</span>${r.fix ? `<span class="fix">${esc(r.fix)}</span>` : ""}</div>
    <span class="sr-only">${r.ok ? "Ready" : r.need ? "Needs fixing" : "Optional"}</span></li>`).join("");
  return `<h1>Is this computer ready?</h1>
    <p class="lede">Penny checked what it needs. Everything stays on this computer.</p>
    <ul class="check-list">${rows}</ul>
    ${c.ready ? `<p class="auth-info" role="status">This computer is ready for Penny ${esc(c.version)}.</p>`
      : `<p class="auth-error" role="alert">Something Penny needs is missing. Fix the items marked above, then check again.</p>`}
    <p class="hint">Penny is in <code>${esc(c.folder)}</code></p>
    <div class="setup-actions"><button class="btn" type="button" data-go="recheck">Check again</button>
      <button class="btn btn-accent" type="button" data-go="next" ${c.ready ? "" : "disabled"}>Continue</button></div>`;
}

function viewPackage() {
  const found = W.pkg && W.pkg.ok ? `<div class="setup-found" role="status">${ICON.ok}<div><b>This is the invoice package.</b>
      <span>${esc(plural(W.pkg.reference_files.length, "reference file"))} and ${esc(plural(W.pkg.pdfs, "invoice PDF"))} in ${esc(plural(W.pkg.batches.length, "folder"))}.</span>
      <span class="hint"><code>${esc(W.pkg.path)}</code></span></div></div>` : "";
  const quick = W.state.candidates.length ? `<div class="setup-quick"><p class="hint">Penny found ${W.state.candidates.length === 1 ? "this folder" : "these folders"}:</p>
    ${W.state.candidates.map((p) => `<button class="btn btn-sm" type="button" data-pick="${esc(p)}">${esc(p)}</button>`).join("")}</div>` : "";
  return `<h1>Where is your invoice package?</h1>
    <p class="lede">To read new invoices, Penny needs the package folder: the one with <code>02_Reference_Data</code> inside (the vendor list, purchase orders and bill history). Penny only reads it. It never changes it.</p>
    ${quick}
    <form id="pkg-form" novalidate>
      <div class="field"><label for="pkg-path">Folder path</label>
        <input id="pkg-path" name="path" type="text" autocomplete="off" spellcheck="false" value="${esc(W.path)}" placeholder="For example: ~/Downloads/Hillpointe_AP_Technical_Screen" aria-describedby="pkg-tip"></div>
      <p class="hint" id="pkg-tip">Tip: drag the folder onto a Terminal window to see its full path, then paste it here.</p>
      <button class="btn" type="submit" ${W.busy ? "disabled" : ""}>${W.busy ? "Checking…" : "Check this folder"}</button>
    </form>
    ${W.error ? `<p class="auth-error" role="alert">${esc(W.error)}</p>` : ""}${found}
    <div class="setup-actions"><button class="btn btn-ghost" type="button" data-go="back">Back</button>
      <button class="btn" type="button" data-go="skip">Skip for now</button>
      <button class="btn btn-accent" type="button" data-go="next" ${W.pkg && W.pkg.ok ? "" : "disabled"}>Continue</button></div>
    <p class="hint">Skipping is fine. You can look around with the example data, and run setup again later to add the folder.</p>`;
}

function viewPeople() {
  const already = hasPeople();
  const form = W.mode === "team" && !already ? `<fieldset class="setup-admin"><legend>You will be the first Admin</legend>
      <p class="hint">An Admin invites everyone else and chooses what each person can do.</p>
      <div class="field"><label for="ad-name">Your name</label><input id="ad-name" name="name" type="text" autocomplete="name" required></div>
      <div class="field"><label for="ad-email">Work email</label><input id="ad-email" name="email" type="email" autocomplete="username" spellcheck="false" required></div>
      <div class="field"><label for="ad-pw">Choose a password</label><div class="pw-wrap"><input id="ad-pw" name="password" type="password" autocomplete="new-password" required aria-describedby="ad-pw-tip">
        <button class="pw-toggle" type="button" id="pw-toggle" aria-label="Show password" aria-pressed="false">Show</button></div>
        <span class="hint" id="ad-pw-tip">At least 10 characters. A short phrase of a few words is easiest to remember. Penny stores it only as a scrambled fingerprint.</span></div>
    </fieldset>` : "";
  const note = already ? `<p class="auth-info" role="status">Sign-in is already on: ${esc(plural(W.state.people, "person", "people"))} can use this Penny${W.state.admins.length ? `, with ${esc(W.state.admins.join(" and "))} as Admin` : ""}. Add more from the Users page.</p>` : "";
  return `<h1>Who will use Penny?</h1>
    <p class="lede">This decides how people sign in.</p>${note}
    <form id="people-form" novalidate>
      <div class="choice" role="radiogroup" aria-label="Who will use Penny">
        <label class="${already ? "is-disabled" : ""}"><input type="radio" name="mode" value="solo" ${W.mode === "solo" ? "checked" : ""} ${already ? "disabled" : ""}><b>Just me, to look around</b>
          <small>Penny keeps its four example accounts. What you do is saved in your browser. Nothing to set up.</small></label>
        <label><input type="radio" name="mode" value="team" ${W.mode === "team" ? "checked" : ""}><b>My team</b>
          <small>Everyone signs in with their own email and password. Penny checks and saves everyone's work in one place, and teammates see it right away.</small></label>
      </div>
      ${form}
      ${W.error ? `<p class="auth-error" role="alert">${esc(W.error)}</p>` : ""}
      <div class="setup-actions"><button class="btn btn-ghost" type="button" data-go="back">Back</button>
        <button class="btn btn-accent" type="submit" ${W.busy ? "disabled" : ""}>${W.busy ? "Creating your account…" : W.mode === "team" && !already ? "Create my account and continue" : "Continue"}</button></div>
    </form>`;
}

function viewSettings() {
  const s = W.state, cert = s.certificate;
  const zones = ZONES.some(([z]) => z === W.zone) ? ZONES : [[W.zone, W.zone], ...ZONES];
  const net = W.mode === "team" ? `<fieldset class="setup-set"><legend>Who can reach Penny?</legend>
      <div class="choice">
        <label><input type="radio" name="https" value="" ${W.https ? "" : "checked"}><b>Only this computer</b><small>Good for trying it out. Teammates would need to sit at this computer.</small></label>
        <label class="${s.openssl || cert.exists ? "" : "is-disabled"}"><input type="radio" name="https" value="1" ${W.https ? "checked" : ""} ${s.openssl || cert.exists ? "" : "disabled"}><b>My team, over our network</b>
          <small>Teammates open Penny from their own computers. The connection is encrypted (https), which needs a certificate.</small></label>
      </div>
      ${W.https ? `<div class="setup-cert">
        ${cert.exists ? `<p class="setup-found">${ICON.ok}<span><b>A certificate is ready.</b> ${cert.until ? `Good until ${esc(cert.until)}.` : ""}</span></p>` : `<p class="hint">Penny can make one now. Browsers will warn about it the first time, because Penny made it itself. A certificate from your IT team avoids that.</p>`}
        <div class="field"><label for="host">This computer's name, as teammates will type it</label>
          <input id="host" name="host" type="text" autocomplete="off" spellcheck="false" value="${esc(W.host)}"></div>
        <button class="btn" type="button" data-go="cert" ${W.busy ? "disabled" : ""}>${W.busy ? "Making it…" : cert.exists ? "Make a new certificate" : "Make a certificate"}</button></div>` : ""}
      ${s.openssl || cert.exists ? "" : `<p class="hint">Opening Penny to a network needs a certificate, and this computer has no tool to make one. Your IT team can give you one. See “Running Penny for your team” in the help center.</p>`}
    </fieldset>` : "";
  return `<h1>A few settings</h1>
    <p class="lede">You can change all of these later.</p>
    <form id="settings-form" novalidate>
      <fieldset class="setup-set"><legend>Company time zone</legend>
        <div class="field"><label for="zone">Times in Penny are shown in</label>
          <select id="zone" name="zone">${zones.map(([z, n]) => `<option value="${esc(z)}" ${z === W.zone ? "selected" : ""}>${esc(n === z ? z : `${n} (${z})`)}</option>`).join("")}</select></div>
        <p class="hint">More zones are on the Rules page.</p></fieldset>
      <fieldset class="setup-set"><legend>Watched folder</legend>
        <label class="check"><input type="checkbox" name="watch" ${W.watch ? "checked" : ""}> Pick up invoice PDFs dropped into <code>inbox/_incoming</code></label>
        <p class="hint">Penny files them as a batch and runs a preview. It never runs a batch for real by itself.</p></fieldset>
      ${net}
      <fieldset class="setup-set"><legend>Email</legend>
        <p class="${s.email.sends ? "setup-found" : "hint"}">${s.email.sends ? ICON.ok : ""}<span>${esc(s.email.how)}.</span></p>
        ${s.email.sends ? "" : `<p class="hint">Invitations and emailed files are saved to Penny's Outbox with a working link until a mail account is set up. See “Emailing exports and approval requests” in the help center.</p>`}</fieldset>
      ${W.error ? `<p class="auth-error" role="alert">${esc(W.error)}</p>` : ""}
      <div class="setup-actions"><button class="btn btn-ghost" type="button" data-go="back">Back</button>
        <button class="btn btn-accent" type="submit" ${W.busy ? "disabled" : ""}>${W.busy ? "Saving…" : "Finish setup"}</button></div>
    </form>`;
}

function viewDone() {
  const c = W.done.choices;
  const lines = [
    c.package ? ["ok", "Penny can read new invoices", c.package] : ["note", "Example data only", "Run setup again to add your invoice package."],
    c.mode === "team" ? ["ok", "Your team signs in with their own accounts", W.admin ? `You are the Admin: ${W.admin.email}` : `${plural(W.state.people, "person", "people")} so far`] : ["ok", "Just you, with the example accounts", "What you do is saved in your browser."],
    c.https ? ["ok", "Open to your team over https", `Teammates use https://${W.host || W.state.computer}:${c.port}/`] : ["ok", "Only this computer can reach Penny", ""],
    ["ok", `Times are shown in ${W.zone}`, ""],
    c.watch ? ["ok", "The watched folder is on", "Drop invoice PDFs into inbox/_incoming."] : null,
  ].filter(Boolean);
  const restart = W.done.restart;
  return `<h1>Penny is set up</h1>
    <p class="lede">Here is what you chose.</p>
    <ul class="check-list">${lines.map(([k, a, b]) => `<li class="${k}">${ICON[k]}<div><b>${esc(a)}</b>${b ? `<span>${esc(b)}</span>` : ""}</div></li>`).join("")}</ul>
    <div class="setup-next"><h2>From now on</h2>
      <p>Start Penny by double-clicking <strong>Start Penny</strong> in the Penny folder, or with <code>./penny start</code> in Terminal.</p>
      ${restart ? `<p class="form-warn" role="note"><strong>One more step.</strong> ${c.https ? "Opening Penny to your team" : "The watched folder"} starts the next time Penny starts. Close the setup window (press Ctrl+C in it), then start Penny.</p>` : ""}
      ${c.mode === "team" ? `<p>Then invite your teammates from the <strong>Users</strong> page.</p>` : ""}</div>
    <div class="setup-actions"><button class="btn btn-ghost" type="button" data-go="back">Back</button>
      ${restart ? "" : `<a class="btn btn-accent" href="./">Open Penny</a>`}</div>
    <p class="hint">You can run setup again any time with <code>./penny setup</code>. It never removes anything.</p>`;
}

// ------------------------------------------------------------------ drawing
const VIEWS = { check: viewCheck, package: viewPackage, people: viewPeople, settings: viewSettings, done: viewDone };
function draw(focus) {
  const step = STEPS[W.step];
  $("#steps").innerHTML = STEPS.map((s, i) => `<li class="${i < W.step ? "done" : i === W.step ? "now" : ""}" ${i === W.step ? 'aria-current="step"' : ""}>
    <span class="n" aria-hidden="true">${i < W.step ? "✓" : i + 1}</span><span>${esc(s.name)}<span class="sr-only">${i < W.step ? " (done)" : i === W.step ? " (this step)" : ""}</span></span></li>`).join("");
  const main = $("#wizard");
  main.innerHTML = VIEWS[step.id]();
  document.title = `${step.name} · Set up Penny`;
  if (focus) { main.focus(); window.scrollTo(0, 0); }
  bind();
}
function go(n) { W.step = Math.max(0, Math.min(STEPS.length - 1, n)); W.error = ""; draw(true); }
/** Run one request with the button showing it is busy, and any refusal shown on the page. */
async function busy(work) {
  W.busy = true; W.error = ""; draw(false);
  try { await work(); } catch (e) { W.error = e.message; }
  W.busy = false; draw(false);
  const err = $("#wizard [role=alert]");
  if (err) err.scrollIntoView({ block: "nearest" });
}
function bind() {
  const main = $("#wizard");
  $$("[data-go]", main).forEach((b) => b.addEventListener("click", async () => {
    const what = b.dataset.go;
    if (what === "next") go(W.step + 1);
    else if (what === "back") go(W.step - 1);
    else if (what === "skip") { W.pkg = null; W.path = ""; W.skipPkg = true; go(W.step + 1); }
    else if (what === "recheck") busy(async () => { W.state = await ask("api/setup"); });
    else if (what === "cert") { W.host = $("#host").value.trim(); keepSettings(); busy(async () => { W.state = (await ask("api/setup/certificate", { host: W.host })).state; }); }
  }));
  $$("[data-pick]", main).forEach((b) => b.addEventListener("click", () => { W.path = b.dataset.pick; checkPackage(); }));
  const pkg = $("#pkg-form");
  if (pkg) pkg.addEventListener("submit", (e) => { e.preventDefault(); W.path = $("#pkg-path").value.trim(); checkPackage(); });
  const people = $("#people-form");
  if (people) {
    $$("input[name=mode]", people).forEach((r) => r.addEventListener("change", () => { keepAdmin(); W.mode = r.value; W.error = ""; draw(false); const f = $("#ad-name") || $("input[name=mode]:checked"); if (f) f.focus(); }));
    const t = $("#pw-toggle");
    if (t) t.addEventListener("click", () => { const pw = $("#ad-pw"), show = pw.type === "password"; pw.type = show ? "text" : "password"; t.textContent = show ? "Hide" : "Show"; t.setAttribute("aria-pressed", String(show)); t.setAttribute("aria-label", show ? "Hide password" : "Show password"); pw.focus(); });
    restoreAdmin();
    people.addEventListener("submit", (e) => {
      e.preventDefault();
      if (W.mode !== "team" || hasPeople()) return go(W.step + 1);
      keepAdmin();
      const password = $("#ad-pw").value;
      busy(async () => {
        const r = await ask("api/setup/admin", { name: W.draft.name, email: W.draft.email, password });
        W.admin = r.user; W.state = r.state; W.draft = null; W.step += 1;
      });
    });
  }
  const set = $("#settings-form");
  if (set) {
    $$("input[name=https]", set).forEach((r) => r.addEventListener("change", () => { keepSettings(); W.https = r.value === "1"; draw(false); const f = $("input[name=https]:checked"); if (f) f.focus(); }));
    set.addEventListener("submit", (e) => {
      e.preventDefault();
      keepSettings();
      busy(async () => {
        const r = await ask("api/setup/finish", { package: W.pkg && W.pkg.ok ? W.pkg.path : "", mode: W.mode, https: W.https, watch: W.watch, time_zone: W.zone, port: W.state.choices.port });
        W.done = r; W.state = r.state; W.step += 1;
      });
    });
  }
}
/* What is typed stays typed when a screen is redrawn. A password is never kept: it is read once, when sent. */
function keepAdmin() { const n = $("#ad-name"); if (n) W.draft = { name: n.value.trim(), email: $("#ad-email").value.trim() }; }
function restoreAdmin() { const n = $("#ad-name"); if (n && W.draft) { n.value = W.draft.name; $("#ad-email").value = W.draft.email; } }
function keepSettings() {
  const f = $("#settings-form");
  if (!f) return;
  W.zone = $("#zone").value; W.watch = f.elements.watch.checked;
  const h = $("#host"); if (h) W.host = h.value.trim();
}
function checkPackage() { busy(async () => { W.pkg = null; const r = await ask("api/setup/package", { path: W.path }); if (!r.ok) throw new Error(r.problem); W.pkg = r; W.path = r.path; W.skipPkg = false; }); }

// ------------------------------------------------------------------ start
// Pasting the address Penny printed into a tab that already shows the wizard only changes the part after "#".
// Load the page again so the new key is picked up.
window.addEventListener("hashchange", () => { if (/[#&]key=/.test(location.hash)) location.reload(); });
(async function start() {
  const main = $("#wizard");
  try {
    W.state = await ask("api/setup");
  } catch (e) {
    $("#steps").innerHTML = "";
    main.innerHTML = e.status === 404 ? `<h1>Setup is closed</h1>
        <p class="lede">The setup wizard only opens when Penny starts it, so nobody else can change how Penny is set up.</p>
        <ol class="notes"><li>Open Terminal in the Penny folder (<code>04_Workflow</code>).</li><li>Run <code>./penny setup</code>, or double-click <strong>Install Penny</strong>.</li><li>Penny opens this page for you, ready to use.</li></ol>
        <div class="setup-actions"><a class="btn" href="./">Open Penny</a></div>`
      : `<h1>Penny is not answering</h1><p class="auth-error" role="alert">${esc(e.message)}</p><div class="setup-actions"><a class="btn" href="setup.html">Try again</a></div>`;
    return;
  }
  const c = W.state.choices;
  $("#setup-version").textContent = `Penny v${W.state.check.version}`;
  Object.assign(W, { mode: hasPeople() || c.mode === "team" ? "team" : "solo", zone: W.state.time_zone, https: !!c.https, watch: !!c.watch, host: W.state.computer, path: c.package || "" });
  draw(false);
  if (W.path) checkPackage();          // a folder chosen last time: check it is still there
})();
