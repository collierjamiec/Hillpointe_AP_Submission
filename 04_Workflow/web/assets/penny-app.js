/* Penny web app: The router, page chrome, keyboard shortcuts, the sign-in screen, the intro, and start-up.
   Sections: router, chrome, keyboard shortcuts, sign-in, intro. */
"use strict";

// ------------------------------------------------------------------ router
function parseHash() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = h.split("?");
  return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(qs || "") };
}
/** Phones show each row of a page table as a card (see penny.css). A card has no header row above it, so every cell
    carries its column's name, and the table keeps its meaning for screen readers after the layout changes. */
function labelTables() {
  $$("#main table.data:not([data-labeled])").forEach((t) => {
    t.dataset.labeled = "1";
    const heads = $$("thead th", t).map((th) => th.textContent.replace(/[↑↓]/g, "").trim());
    t.setAttribute("role", "table");
    $$("thead, tbody, tfoot", t).forEach((g) => g.setAttribute("role", "rowgroup"));
    $$("tr", t).forEach((r) => r.setAttribute("role", "row"));
    $$("th", t).forEach((h) => h.setAttribute("role", "columnheader"));
    $$("tbody tr", t).forEach((r) => [...r.children].forEach((c, i) => { c.setAttribute("role", "cell"); if (heads[i] && !c.dataset.label) c.dataset.label = heads[i]; }));
    $$("tfoot td", t).forEach((c) => c.setAttribute("role", "cell"));
  });
}
/** A table too wide for the screen scrolls sideways. Make that region reachable by keyboard and name it for screen readers. */
function scrollableTables() {
  labelTables();
  $$("#main .table-wrap").forEach((w) => {
    w.classList.toggle("scrolls", w.scrollWidth > w.clientWidth + 1);
    if (w.scrollWidth > w.clientWidth + 1) { w.tabIndex = 0; w.setAttribute("role", "region"); w.setAttribute("aria-label", "Table. Scroll sideways to see every column."); }
    else if (w.hasAttribute("tabindex")) { ["tabindex", "role", "aria-label"].forEach((k) => w.removeAttribute(k)); }
  });
}
let lastPath = null, lastHash = "";
const scrollMemo = {};
/** Remember the list a person is working through, so an invoice can offer Back, Previous and Next. */
function rememberList(a, b, title) {
  if (a === "invoices" && b) return;
  const ids = listIds || [...new Set($$("#main tr[data-href], #main a.att-row").map((el) => decodeURIComponent(((el.dataset.href || el.getAttribute("href")).match(/#\/invoices\/([^?]+)/) || [])[1] || "")).filter(Boolean))];
  if (!ids.length) return;
  try { sessionStorage.setItem("penny.list", JSON.stringify({ ids, label: title, href: location.hash || "#/" })); } catch (e) { /* fine */ }
}
function render() {
  listIds = null;
  if (TEAM.stale) { TEAM.stale = false; paintTeamNote(); }
  const link = linkRoute();
  if (link) return showAccountLink(link.purpose, link.token);
  if (!user) return showLogin();
  const { parts, q } = parseHash();
  const main = $("#main");
  let html, title, nav, after;
  const [a, b] = parts;
  if (!a) { html = viewDashboard(); title = "Overview"; nav = "dashboard"; }
  else if (a === "runs" && !b) { html = viewRuns(); title = "Run history"; nav = "runs"; }
  else if (a === "runs") { html = viewRun(b, q); title = X.runById[b] ? X.runById[b].label : "Run"; nav = "runs"; after = () => bindRun(b, q); }
  else if (a === "invoices" && !b) { html = viewInvoices(q); title = "Invoices"; nav = "invoices"; after = () => bindInvoices(q); }
  else if (a === "invoices" && parts[2] === "manual") { html = viewManual(X.docById[b]); title = X.docById[b] ? `Enter by hand: ${X.docById[b].vendor}` : "Enter by hand"; nav = "invoices"; after = () => bindManual(b); }
  else if (a === "invoices") { html = viewInvoice(b, q); title = X.docById[b] ? `${X.docById[b].vendor} ${X.docById[b].billNo}` : "Invoice"; nav = "invoices"; after = () => bindInvoice(b, q); }
  else if (a === "rules") { html = viewRules(); title = "Rules"; nav = "rules"; after = bindRules; }
  else if (a === "exceptions") { html = viewExceptions(); title = "Exceptions"; nav = "exceptions"; }
  else if (a === "exports") { html = viewExports(); title = "Exports"; nav = "exports"; }
  else if (a === "batch") {
    // Arriving from another page starts a fresh batch; a finished result stays only until you leave it.
    if (lastPath !== "batch" && !NB.busy && NB.result) Object.assign(NB, { name: "", files: [], result: null, error: "", steps: [], mode: "preview" });
    html = viewBatch(); title = "New batch"; nav = "batch"; after = bindBatch;
  }
  else if (a === "insights") { html = viewInsights(); title = "Insights"; nav = "insights"; after = bindInsights; }
  else if (a === "work") {
    html = viewWork(q); title = "My work"; nav = "work";
    after = () => {
      $$(".queue-tabs button").forEach((b) => b.addEventListener("click", () => (location.hash = `#/work?tab=${b.dataset.tab}${q.get("order") ? `&order=${q.get("order")}` : ""}`)));
      $$(".queue-order button").forEach((b) => b.addEventListener("click", () => (location.hash = `#/work?tab=holds&order=${b.dataset.order}`)));
    };
  }
  else if (a === "audit") { html = viewAudit(q); title = "Audit trail"; nav = "audit"; after = bindAudit; }
  else if (a === "about") { location.replace("#/help/about"); return; }
  else if (a === "whats-new") { html = viewWhatsNew(); title = "What's new"; nav = "help"; }
  else if (a === "appearance") { html = viewAppearance(); title = "Appearance"; nav = "appearance"; after = bindAppearance; }
  else if (a === "users") { html = viewUsers(); title = "Users"; nav = "users"; after = bindUsers; }
  else if (a === "outbox") { html = viewOutbox(); title = "Outbox"; nav = "outbox"; after = bindOutbox; }
  else if (a === "help") { html = viewHelp(b, q); const art = HELP().find((x) => x.slug === b); title = art ? `${art.title} · Help` : "Help center"; nav = "help"; after = bindHelp; }
  else { html = notFound("That page"); title = "Not found"; }
  if (lastHash) scrollMemo[lastHash] = window.scrollY;
  main.innerHTML = html;
  scrollableTables();
  document.title = `${title} · Penny`;
  $$("#nav a").forEach((l) => (l.dataset.nav === nav ? l.setAttribute("aria-current", "page") : l.removeAttribute("aria-current")));
  if (after) after();
  scrollableTables();          // again: a page's own setup can draw tables (the invoice list does)
  rememberList(a, b, title);
  const path = parts.join("/");
  if (path !== "rules") ruleDraft = {};
  if (path !== lastPath) {
    track("view", { page: !a ? "overview" : a === "invoices" && b ? "invoice" : a });
    if (a === "invoices" && b) openedAt[b] = Date.now();
    if (a === "help" && b) track("help_view", { slug: b });
    const back = scrollMemo[location.hash];
    window.scrollTo(0, back || 0);
    if (lastPath !== null) main.focus({ preventScroll: true });
    lastPath = path;
    if (a === "exceptions" && location.hash.includes("#code-")) { const t = document.getElementById(location.hash.split("#").pop()); if (t) t.scrollIntoView(); }
  }
  lastHash = location.hash;
  closeMenu();
}
function bindRun(id, q) {
  $$(".segmented button").forEach((btn) => btn.addEventListener("click", () => {
    const s = btn.dataset.status;
    location.hash = `#/runs/${encodeURIComponent(id)}${s ? `?status=${s}` : ""}`;
  }));
}
/** Tabs swap only the panel, so the PDF beside them does not reload. The URL keeps the tab for sharing. */
function bindInvoice(id, q) {
  const d = X.docById[id];
  if (!d) return;
  const pdfBox = $(".pdf-pages");
  if (pdfBox) renderPdf(pdfBox);
  const r = shownResult(d, q);
  const tabs = $$('[role="tab"]');
  const panel = $("#panel");
  const go = (t, focus) => {
    tabs.forEach((x) => { const on = x === t; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; });
    panel.setAttribute("aria-labelledby", t.id);
    panel.innerHTML = tabContent(t.dataset.tab, d, r);
    q.set("tab", t.dataset.tab);
    history.replaceState(null, "", `#/invoices/${encodeURIComponent(id)}?${q}`);
    if (focus) t.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => go(t));
    t.addEventListener("keydown", (e) => {
      const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (k) { e.preventDefault(); go(tabs[(i + k + tabs.length) % tabs.length], true); }
    });
  });
}

// ------------------------------------------------------------------ chrome
function openMenu() { $("#sidebar").classList.add("open"); $("#scrim").hidden = false; $("#menu-btn").setAttribute("aria-expanded", "true"); }
function closeMenu() { $("#sidebar").classList.remove("open"); $("#scrim").hidden = true; $("#menu-btn").setAttribute("aria-expanded", "false"); }
function bindChrome() {
  $("#menu-btn").addEventListener("click", () => ($("#sidebar").classList.contains("open") ? closeMenu() : openMenu()));
  $("#scrim").addEventListener("click", closeMenu);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeMenu(); closeUserMenu(); } });
  $("#theme-btn").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    setLook({ mode: dark ? "light" : "dark" });
  });
  $("#user-btn").addEventListener("click", (e) => { e.stopPropagation(); $("#user-pop").hidden ? openUserMenu() : closeUserMenu(); });
  $("#sign-out").addEventListener("click", () => { closeUserMenu(); endSession("signed-out"); });
  $("#check-updates").addEventListener("click", () => { closeUserMenu(); openUpdateCheck(); });
  $("#reset-demo").addEventListener("click", () => {
    closeUserMenu();
    openDialog("Reset the demo", "This erases every action saved in this browser: resolved holds, approvals, notes and rule changes. Penny's own results are not affected.",
      "", "Erase my demo changes", () => { EV = []; store.del(SANDBOX_KEY); store.del(OUTBOX_KEY); if (!serverAccounts()) PennyAuth.directory.reset(); derive(); ruleDraft = {}; render(); toast("Demo reset. Everything is back to Penny's results."); return ""; }, { danger: true });
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".user-menu")) closeUserMenu();
    const act = e.target.closest("[data-act]");
    if (act) { e.preventDefault(); doAction(act.dataset.act, act.dataset.doc, act.dataset); return; }
    const em = e.target.closest("[data-email-file]");
    if (em) { e.preventDefault(); emailDialog({ kind: "export", run: em.dataset.run, file: em.dataset.emailFile, bytes: +em.dataset.bytes || 0 }); return; }
    const skip = e.target.closest("a.skip-link");
    if (skip) { e.preventDefault(); const m = $("#main"); m.setAttribute("tabindex", "-1"); m.focus(); m.scrollIntoView(); return; }   // stay on this page: the address is how Penny knows which page to show
    const pgb = e.target.closest("button[data-page]");
    if (pgb) { e.preventDefault(); goToPage({ page: pgb.dataset.page }); return; }
    const dl = e.target.closest("a[data-dl]");
    if (dl) { onDownload(dl, e); return; }
    const exb = e.target.closest("[data-ex]");
    if (exb) { e.preventDefault(); exportDialog(exb.dataset.ex, exb.dataset.run, exb.dataset.file); return; }
    const src = e.target.closest("[data-src]");
    if (src) { e.preventDefault(); showSource(src.dataset.src); return; }
    if (e.target.closest("[data-src-all]")) { e.preventDefault(); toggleAllSources(); return; }
    const of = e.target.closest("[data-open-file]");
    if (of) { e.preventDefault(); openFile(of.dataset.openFile); return; }
    const ap = e.target.closest("[data-apply]");
    if (ap) { e.preventDefault(); applySuggestion(ap.dataset.apply, +ap.dataset.n); return; }
    const sum = e.target.closest("[data-view-summary]");
    if (sum) { e.preventDefault(); showRunSummary(sum.dataset.viewSummary, sum.dataset.run); return; }
    const undo = e.target.closest("[data-undo]");
    if (undo) { e.preventDefault(); undoRule(undo.dataset.undo); return; }
    const row = e.target.closest("tr[data-href]");
    if (row && !e.target.closest("a, button")) location.hash = row.dataset.href;
  });
  // Keep the session alive while someone is working; end it after the idle limit.
  let lastTouch = 0;
  const activity = () => { if (user && Date.now() - lastTouch > 30000) { lastTouch = Date.now(); AUTH().touch(); } };
  ["click", "keydown"].forEach((t) => document.addEventListener(t, activity, true));
  setInterval(() => { if (user && !AUTH().currentUser()) endSession("expired"); }, 20000);
  bindShortcuts();
  document.addEventListener("change", (e) => { if (e.target.matches && e.target.matches("select[data-per]")) goToPage({ per: e.target.value, page: null }); });
  window.addEventListener("resize", () => { clearTimeout(scrollableTables.t); scrollableTables.t = setTimeout(scrollableTables, 150); });
  // Parts of a page are redrawn without a new page (filters, sorting, adding a line), so watch for new tables.
  new MutationObserver(() => { cancelAnimationFrame(scrollableTables.raf); scrollableTables.raf = requestAnimationFrame(scrollableTables); }).observe($("#main"), { childList: true, subtree: true });
  // A shorter hint in the search box on a narrow screen, so it is not cut off.
  const narrow = window.matchMedia("(max-width: 640px)"), searchBox = $("#search"), longHint = searchBox.placeholder;
  const hint = () => { searchBox.placeholder = narrow.matches ? "Search" : longHint; };
  hint(); narrow.addEventListener("change", hint);
  window.addEventListener("hashchange", render);
}

// ------------------------------------------------------------------ keyboard shortcuts
const SHORTCUTS = [
  ["/", "Search invoices"], ["?", "Show these shortcuts"],
  ["g then o", "Go to Overview"], ["g then w", "Go to My work"], ["g then i", "Go to Invoices"], ["g then e", "Go to Exceptions"],
  ["g then b", "Go to New batch (AP Clerk, Admin)"], ["g then x", "Go to Exports"], ["g then n", "Go to Insights (Admin)"], ["g then r", "Go to Run history"], ["g then a", "Go to Audit trail"], ["g then h", "Go to Help center"],
  ["j", "Next invoice in your list"], ["k", "Previous invoice in your list"], ["b", "Back to your list"],
  ["r", "Resolve hold (AP Clerk, Admin)"], ["v", "Review approval (Approver, Admin)"], ["n", "Add a note"],
];
function showShortcuts() {
  openDialog("Keyboard shortcuts", "Shortcuts work anywhere except while you are typing in a box.",
    `<table class="mini keys"><tbody>${SHORTCUTS.map(([key, what]) => `<tr><td>${key.split(" then ").map((x) => `<kbd>${esc(x)}</kbd>`).join(" then ")}</td><td>${esc(what)}</td></tr>`).join("")}</tbody></table>`,
    "", () => "", { info: true });
}
function bindShortcuts() {
  document.addEventListener("click", (e) => { if (e.target.closest("[data-shortcuts]")) { e.preventDefault(); showShortcuts(); } });
  let g = 0;
  const go = { o: "#/", w: "#/work", i: "#/invoices", e: "#/exceptions", x: "#/exports", a: "#/audit", h: "#/help", r: "#/runs", n: "#/insights", b: "#/batch" };
  document.addEventListener("keydown", (e) => {
    if (!user || e.metaKey || e.ctrlKey || e.altKey || e.target.closest("input, select, textarea, [contenteditable]") || $("#dialog").open) return;
    const k = e.key;
    if (Date.now() - g < 1200 && go[k.toLowerCase()]) { e.preventDefault(); g = 0; track("shortcut", { key: `g ${k.toLowerCase()}` }); location.hash = go[k.toLowerCase()]; return; }
    g = 0;
    if (k === "g") { g = Date.now(); return; }
    if (k === "?") { e.preventDefault(); showShortcuts(); return; }
    const click = (sel) => { const el = $(sel); if (el) { e.preventDefault(); track("shortcut", { key: k }); el.click(); } };
    if (k === "j") click('[data-key="next"]');
    else if (k === "k") click('[data-key="prev"]');
    else if (k === "b") click(".back-link");
    else if (k === "r") click('[data-act="resolve"]');
    else if (k === "v") click('[data-act="approve"]');
    else if (k === "n") click('[data-act="note"]');
  });
}
function openUserMenu() { $("#user-pop").hidden = false; $("#user-btn").setAttribute("aria-expanded", "true"); const f = $("#user-pop [role=menuitem]"); if (f) f.focus(); }
function closeUserMenu() { $("#user-pop").hidden = true; $("#user-btn").setAttribute("aria-expanded", "false"); }

// ------------------------------------------------------------------ sign-in
function enterApp(u) {
  user = u;
  role = u.role;
  $("#user-avatar").textContent = u.initials;
  $("#user-avatar").className = `avatar av-${u.role}`;
  $("#user-name").textContent = u.name;
  $("#user-role").textContent = ROLES[u.role].name;
  $("#user-pop-head").innerHTML = `<strong>${esc(u.name)}</strong>${esc(u.title)} · ${esc(ROLES[u.role].name)}<br>${esc(u.email)}`;
  $("[data-needs=work]").hidden = !(can("resolve") || can("approve"));
  $("[data-needs=insights]").hidden = !can("rules");
  $("[data-needs=upload]").hidden = !can("upload");
  $("[data-needs=users]").hidden = !can("users");
  loadMyLook(u);
  $("[data-needs=email]").hidden = !can("email");
  const pill = $(".demo-pill");
  if (pill && SERVER) { pill.textContent = "Local"; pill.title = "Connected to Penny on this computer. Batches run with the real engine; demo sign-in and actions still stay in this browser."; }
  if (pill && teamMode()) { pill.textContent = "Team"; pill.title = "Connected to your team's Penny. Everything you do is checked and saved on the server, and teammates see it right away."; }
  track("session_start");
  $("#auth").hidden = true;
  $("#shell").hidden = false;
  lastPath = null;
  updateWorkCount();
  render();
  if (teamMode()) { teamLoop(); offerEarlierWork(); }
}
function endSession(reason) {
  AUTH().signOut(reason);
  user = null;
  teamStop();
  ruleDraft = {};
  Object.assign(MAN, { doc: null, entry: null, files: [], editing: false, error: "" });
  MYPREFS = { follow: true, look: { ...LOOK_DEFAULT }, ...FEEL_DEFAULT, mode: MYPREFS.mode };
  if (D) applyLook();
  const dlg = $("#dialog");
  if (dlg.open) dlg.close();
  showLogin(reason);
}
function showLogin(reason) {
  reason = reason || AUTH().takeSignOutReason();
  if (serverAccounts()) return showServerLogin(reason);
  $("#shell").hidden = true;
  const box = $("#auth");
  box.hidden = false;
  document.title = "Sign in · Penny";
  const msg = reason === "expired" ? `<p class="auth-info" role="status">You were signed out after ${PennyAuth.IDLE_MINUTES} minutes without activity. Please sign in again.</p>`
    : reason === "signed-out" ? `<p class="auth-info" role="status">You are signed out. Your demo changes are still saved in this browser.</p>` : "";
  const CAN = { viewer: "Read everything, change nothing", clerk: "Resolve and reassign holds", approver: "Approve or send back bills", admin: "Everything, including rules" };
  const tick = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>';
  box.innerHTML = `<div class="auth-wrap">
    <div class="auth-card">
      <section class="auth-brand" aria-label="About Penny">
        <div class="auth-logo"><svg class="auth-coin" aria-hidden="true"><use href="#coin-front"/></svg><span>Penny</span></div>
        <h1>Accounts payable, without the guesswork.</h1>
        <p class="auth-lede">Penny reads vendor invoices, checks each one against your AP rules, and shows your team what is ready, what needs review, and why.</p>
        <ul class="auth-points">
          <li>${tick}<div><b>AI reads.</b> Vendor, lines and totals come straight from each PDF.</div></li>
          <li>${tick}<div><b>Code decides.</b> Tested checks give the same answer every time.</div></li>
          <li>${tick}<div><b>People approve.</b> Every hold has a reason, an owner and an audit trail.</div></li>
        </ul>
        <details class="auth-security"><summary>How sign-in works in this demo</summary><ul>
          <li>The four accounts are fake and public. Never type a real password here.</li>
          <li>Passwords are checked against salted PBKDF2 hashes and are never stored as text.</li>
          <li>${PennyAuth.MAX_TRIES} wrong tries lock an account for a minute.</li>
          <li>Sessions end after ${PennyAuth.IDLE_MINUTES} idle minutes or when you close the tab.</li>
          <li>Your changes are saved only in this browser, and you can reset them any time.</li></ul></details>
      </section>
      <section class="auth-main" aria-labelledby="signin-title">
        <h2 id="signin-title">Sign in</h2>
        <p class="auth-sub">Choose a role to explore. Each one sees Penny a little differently.</p>
        ${msg}
        <div class="role-grid" role="list">${PennyAuth.accounts.map((a) => `<button class="role-card" type="button" role="listitem" data-email="${esc(a.email)}" data-pw="${esc(a.demoPassword)}">
          <span class="avatar av-${esc(a.role)}" aria-hidden="true">${esc(a.initials)}</span>
          <span class="role-text"><b>${esc(a.name)}</b><span class="role-name">${esc(ROLES[a.role].name)}</span><span class="role-can">${esc(CAN[a.role])}</span></span>
          <span class="role-go" aria-hidden="true">→</span></button>`).join("")}</div>
        <div class="or">or sign in with email</div>
        <form class="auth-form" id="login-form" novalidate>
          <div class="field"><label for="login-email">Email</label>
            <input id="login-email" name="email" type="email" autocomplete="username" spellcheck="false" placeholder="name@penny.demo" aria-describedby="email-err" required>
            <span class="field-err" id="email-err" hidden></span></div>
          <div class="field"><label for="login-pw">Password</label>
            <div class="pw-wrap"><input id="login-pw" name="password" type="password" autocomplete="current-password" aria-describedby="caps-hint" required>
              <button class="pw-toggle" type="button" id="pw-toggle" aria-label="Show password" aria-pressed="false">Show</button></div>
            <span class="hint caps" id="caps-hint" hidden>Caps Lock is on.</span></div>
          <p class="auth-error" id="login-error" role="alert" hidden></p>
          <button class="btn btn-primary" type="submit" id="login-submit"><span class="spin" aria-hidden="true"></span><span class="lbl">Sign in</span></button>
          <button class="link-btn forgot-link" type="button" data-forgot>Forgot your password?</button>
        </form>
        <details class="cred-box"><summary>Show demo emails and passwords</summary>
          <table class="mini creds"><tbody>${PennyAuth.accounts.map((a) => `<tr><td>${esc(ROLES[a.role].name)}</td><td><code>${esc(a.email)}</code></td><td><code>${esc(a.demoPassword)}</code></td>
            <td><button class="btn btn-sm" type="button" data-fill="${esc(a.email)}" data-pw="${esc(a.demoPassword)}">Fill</button></td></tr>`).join("")}</tbody></table></details>
      </section>
    </div>
    <p class="auth-credit"><svg class="credit-coin" aria-hidden="true"><use href="#coin-front"/></svg>Designed and built by <strong>Jamie Collier</strong> · <a href="https://github.com/collierjamiec/Hillpointe_AP_Submission" target="_blank" rel="noopener">Source on GitHub</a> · <span id="auth-version">Penny v${esc(APP_VERSION)}</span></p>
  </div>`;
  const form = $("#login-form"), err = $("#login-error"), btn = $("#login-submit"), email = $("#login-email"), pw = $("#login-pw");
  const emailErr = $("#email-err");
  const setBusy = (on, card) => {
    btn.disabled = on; btn.classList.toggle("busy", on); $(".lbl", btn).textContent = on ? "Checking…" : "Sign in";
    $$(".role-card", box).forEach((c) => { c.disabled = on; c.classList.toggle("busy", on && c === card); });
  };
  const validEmail = () => {
    const v = email.value.trim();
    const bad = !v ? "Enter the email for a demo account, like avery@penny.demo." : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? "That does not look like an email address." : "";
    emailErr.textContent = bad; emailErr.hidden = !bad; email.setAttribute("aria-invalid", bad ? "true" : "false");
    return !bad;
  };
  const go = async (card) => {
    err.hidden = true;
    if (!validEmail()) { email.focus(); return; }
    if (!pw.value) { err.textContent = "Enter the password. Demo passwords are listed below the form."; err.hidden = false; pw.focus(); return; }
    setBusy(true, card);
    const res = await PennyAuth.signIn(email.value, pw.value);
    setBusy(false);
    if (res.ok) { pw.value = ""; enterApp(res.user); toast(`Welcome, ${res.user.name.split(" ")[0]}. You are signed in as ${article(ROLES[res.user.role].name)}.`); return; }
    err.textContent = res.message; err.hidden = false;
    pw.value = ""; pw.focus();          // the email stays; the password is cleared on purpose
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); go(); });
  email.addEventListener("blur", () => { if (email.value) validEmail(); });
  email.addEventListener("input", () => { if (!emailErr.hidden) validEmail(); });
  const caps = (e) => { if (e.getModifierState) $("#caps-hint").hidden = !e.getModifierState("CapsLock"); };
  pw.addEventListener("keyup", caps); pw.addEventListener("keydown", caps);
  $("#pw-toggle").addEventListener("click", (e) => {
    const show = pw.type === "password";
    pw.type = show ? "text" : "password";
    e.currentTarget.textContent = show ? "Hide" : "Show";
    e.currentTarget.setAttribute("aria-pressed", String(show));
    e.currentTarget.setAttribute("aria-label", show ? "Hide password" : "Show password");
    pw.focus();
  });
  $$(".role-card", box).forEach((c) => c.addEventListener("click", () => { email.value = c.dataset.email; pw.value = c.dataset.pw; go(c); }));
  $$("[data-fill]", box).forEach((b) => b.addEventListener("click", () => { email.value = b.dataset.fill; pw.value = b.dataset.pw; validEmail(); pw.focus(); }));
  bindForgot(box);
}

// ------------------------------------------------------------------ intro
/* The intro. The penny is tossed and lands; a progress bar under it tracks real loading (it never runs ahead of
   the data), with plain status steps; then a welcome fades in and out. Plays once per visit, Skip ends it at once,
   and people who prefer less motion get a short, still version. */
let realProgress = 0;
const loaded = (pct) => { realProgress = Math.max(realProgress, pct); };
function playIntro() {
  const el = $("#splash");
  let seen = false;
  try { seen = !!sessionStorage.getItem("penny.introSeen"); } catch (e) { /* storage blocked: play it */ }
  if (seen || !el) { if (el) el.remove(); return Promise.resolve(); }
  try { sessionStorage.setItem("penny.introSeen", "1"); } catch (e) { /* fine */ }
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const STEPS = calm
    ? [[0, "Loading invoices…", 35], [500, "Reading your AP rules…", 65], [900, "Preparing your workspace…", 90]]
    : [[1600, "Loading invoices…", 22], [2600, "Reading your AP rules…", 46], [3600, "Checking the audit trail…", 70], [4500, "Preparing your workspace…", 90]];
  const READY_AT = calm ? 1300 : 5300;
  const fill = $("#splash-fill"), pct = $("#splash-pct"), status = $("#splash-status"), bar = $("#splash .splash-bar");
  return new Promise((resolve) => {
    const t0 = performance.now();
    const timers = [];
    let shown = 0, finished = false, ending = false;
    const paint = (p, label) => {
      shown = Math.max(shown, p);
      fill.style.width = `${shown}%`;
      pct.textContent = `${Math.round(shown)}%`;
      bar.setAttribute("aria-valuenow", String(Math.round(shown)));
      if (label && status.textContent !== label) status.textContent = label;
    };
    const finish = (skipped) => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      introResult = { skipped: skipped === true, seconds: Math.round((performance.now() - t0) / 100) / 10 };
      el.classList.add("done");
      setTimeout(() => { el.remove(); resolve(); }, 600);
    };
    const end = () => {
      ending = true;
      paint(100, "Ready");
      timers.push(setTimeout(() => el.classList.add("landed"), 450));
      timers.push(setTimeout(() => el.classList.add("welcome"), 750));
      timers.push(setTimeout(finish, calm ? 2200 : 2850));
    };
    const tick = () => {
      if (finished || ending) return;
      const t = performance.now() - t0;
      let target = 0, label = null;
      for (const [at, l, p] of STEPS) if (t >= at) { target = p; label = l; }
      target = Math.min(target, realProgress >= 100 ? 100 : Math.max(realProgress, 18));
      if (t >= READY_AT && realProgress >= 100) { end(); return; }
      if (target) paint(target, label);
      timers.push(setTimeout(tick, 120));
    };
    tick();
    $("#splash-skip").addEventListener("click", () => finish(true));
    document.addEventListener("keydown", function onKey(e) { if (e.key === "Escape" || e.key === "Enter") { document.removeEventListener("keydown", onKey); finish(true); } });
  });
}
let introResult = null;

async function loadData() {
  loaded(10);
  try {
    const res = await fetch("data/penny-data.json", { cache: "no-cache" });
    if (res.status === 401) {                     // Penny on a computer with real accounts: sign in first
      const b = await res.json().catch(() => ({}));
      SERVER = b.server || { mode: "local", accounts: true };
      loaded(100);
      return "signin";
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    D = await res.json();
  } catch (e) {
    loaded(100);
    return false;
  }
  loaded(55);
  SERVER = D.server && D.server.mode === "local" ? D.server : null;   // added by ./penny web; absent on the public site
  X = buildIndex(D);
  loaded(75);
  if (SERVER && SERVER.team) {
    try { await teamLoad(); } catch (e) { loaded(100); return false; }   // the team's audit log, from the server
  } else { TEAM.on = false; loadSandbox(); }
  derive();
  loaded(92);
  $("#generated").textContent = `Data exported ${fmtDateTime(D.generated_at)}`;
  bindSearch();
  loaded(100);
  return true;
}

async function boot() {
  bindChrome();
  const [ok] = await Promise.all([loadData(), playIntro()]);
  document.body.classList.remove("booting");
  if (ok === "signin") {
    bindUpdates();
    return render();                             // the sign-in page, or an invitation or reset link
  }
  if (!ok) {
    $("#auth").hidden = false;
    $("#auth").innerHTML = `<div class="auth-card" style="grid-template-columns:1fr"><section class="auth-main"><h2>No data yet</h2>
      <p>Penny could not load <code>data/penny-data.json</code>. Create it from the terminal, then reload this page:</p>
      <pre class="card card-pad" style="overflow:auto">./penny web-export --package ~/Downloads/Hillpointe_AP_Technical_Screen\n./penny web</pre></section></div>`;
    return;
  }
  if (introResult) track("intro", introResult);
  bindUpdates();
  checkUpdates();
  window.addEventListener("error", (e) => track("error", { message: String(e.message || "error").slice(0, 160) }));
  if (serverAccounts()) {
    try { ME = (await api("api/auth/me")).user; } catch (e) { ME = null; }
  }
  if (linkRoute()) return render();
  const u = AUTH().currentUser();
  if (u) enterApp(u); else showLogin();
}
boot();
