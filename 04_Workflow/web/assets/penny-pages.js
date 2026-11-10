/* Penny web app: Insights, My work, and versions and updates.
   Sections: insights, my work, versions and updates (v1.6). */
"use strict";

// ------------------------------------------------------------------ insights
const PAGE_NAMES = { overview: "Overview", work: "My work", invoices: "Invoices", invoice: "Invoice review", exceptions: "Exceptions", exports: "Exports",
  runs: "Run history", audit: "Audit trail", rules: "Rules", help: "Help center", insights: "Insights" };
function countBy(list, f) { const o = {}; list.forEach((x) => { const k = f(x); if (k !== undefined && k !== null && k !== "") o[k] = (o[k] || 0) + 1; }); return Object.entries(o).sort((a, b) => b[1] - a[1]); }
function median(nums) { if (!nums.length) return null; const s2 = nums.slice().sort((a, b) => a - b); const m = Math.floor(s2.length / 2); return s2.length % 2 ? s2[m] : Math.round((s2[m - 1] + s2[m]) / 2); }
const dur = (sec) => sec === null ? "Not enough data" : sec < 60 ? plural(sec, "second") : `${Math.round(sec / 6) / 10} minutes`;
function bars(rows, label = (k) => k) {
  if (!rows.length) return `<p class="hint">Nothing recorded yet.</p>`;
  const max = Math.max(...rows.map((r) => r[1]));
  return `<ul class="hbars">${rows.slice(0, 8).map(([k, n]) => `<li class="hbar"><span class="hbar-label">${esc(label(k))}</span><span class="hbar-track" aria-hidden="true"><span class="hbar-fill ins-fill" style="display:block;width:${(n / max) * 100}%"></span></span><span class="hbar-n">${n}</span></li>`).join("")}</ul>`;
}
function viewInsights() {
  if (!can("rules")) return `${head("Insights", "")}<section class="card"><div class="empty-state">${ICON.shield}<h2>Admins only</h2><p>Usage insights are for the person who improves Penny. Sign in as Sam Rivera (Admin) to see them.</p></div></section>`;
  const ev = usageEvents();
  const on = usageOn();
  const views = ev.filter((e) => e.type === "view");
  const actions = ev.filter((e) => e.type === "action");
  const shown = ev.filter((e) => e.type === "suggestion_shown").length;
  const applied = ev.filter((e) => e.type === "suggestion_applied");
  const undone = ev.filter((e) => e.type === "suggestion_undone");
  const resolveTimes = actions.filter((e) => e.kind === "hold.resolve" && typeof e.seconds === "number").map((e) => e.seconds);
  const sessions = ev.filter((e) => e.type === "session_start").length;
  const emptySearch = countBy(ev.filter((e) => e.type === "search" && e.hits === 0), (e) => e.q);
  const emptyHelp = countBy(ev.filter((e) => e.type === "help_search" && e.hits === 0), (e) => e.q);
  const errors = ev.filter((e) => e.type === "error");
  const introDone = ev.filter((e) => e.type === "intro").length, introSkip = ev.filter((e) => e.type === "intro" && e.skipped).length;
  const acceptance = shown ? Math.round((applied.length / shown) * 100) : null;
  // plain-language signals a person can act on
  const signals = [];
  const undoneBy = countBy(undone, (e) => e.code);
  undoneBy.forEach(([code, n]) => { if (n >= 1) signals.push(`Suggested fixes for “${(CODES[code] || {}).plain || code}” were undone ${plural(n, "time")}. Review the playbook wording for that reason.`); });
  emptySearch.slice(0, 3).forEach(([q, n]) => signals.push(`Search found nothing for “${q}” (${plural(n, "time")}). Consider making that searchable.`));
  emptyHelp.slice(0, 3).forEach(([q, n]) => signals.push(`Help search found nothing for “${q}” (${plural(n, "time")}). That may need a help article.`));
  const slow = median(resolveTimes);
  if (slow !== null && slow > 120) signals.push(`Resolving a hold takes ${dur(slow)} at the median. Suggested fixes may help more invoices.`);
  if (introDone >= 3 && introSkip / introDone > 0.5) signals.push(`Most people skip the intro (${introSkip} of ${introDone}). It may be too long.`);
  if (errors.length) signals.push(`${plural(errors.length, "error")} happened in the browser. See the list below.`);
  const holdCodes = countBy(X.docs.filter(openHold).flatMap((d) => d.codes), (c) => c);
  if (holdCodes.length) signals.push(`The most common open hold is “${(CODES[holdCodes[0][0]] || {}).plain}” (${holdCodes[0][1]}). A rule or vendor process change there would help the most.`);
  return `${head("Insights", "How Penny is being used in this browser, and signals for improving it. Nothing here leaves your browser.",
      `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="usage-download" type="button">Download data</button><button class="btn" id="usage-toggle" type="button">${on ? "Turn off" : "Turn on"}</button><button class="btn btn-danger" id="usage-clear" type="button">Clear</button></div>`)}
    ${on ? "" : `<div class="role-banner" role="note"><span><strong>Usage tracking is off.</strong> Nothing new is being recorded. Turn it on to collect insights again.</span></div>`}
    <section class="grid kpis" aria-label="Usage totals">
      ${kpi("dot-accent", "Sessions", sessions, `${plural(views.length, "screen view")}`)}
      ${kpi("dot-ok", "Actions taken", actions.length, `${plural(new Set(actions.map((a) => a.role)).size, "role")} acted`)}
      ${kpi("dot-hold", "Suggestions accepted", acceptance === null ? "None yet" : `${acceptance}%`, `${applied.length} applied, ${undone.length} undone`)}
      ${kpi("dot-dup", "Time to resolve a hold", slow === null ? "None yet" : dur(slow), "median, from opening to resolving")}
    </section>
    <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>Signals to improve Penny</h2><p>Built from the numbers below</p></div><div class="card-body">
      ${signals.length ? `<ul class="notes">${signals.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="hint">Not enough activity yet. Use Penny for a while and come back.</p>`}</div></section>
    <div class="grid two">
      <section class="card"><div class="card-head"><h2>Screens people use</h2></div><div class="card-body">${bars(countBy(views, (e) => e.page), (k) => PAGE_NAMES[k] || k)}</div></section>
      <section class="card"><div class="card-head"><h2>Actions by kind</h2></div><div class="card-body">${bars(countBy(actions, (e) => e.kind), (k) => EVENT_LABEL[k] || k)}</div></section>
      <section class="card"><div class="card-head"><h2>Suggested fixes applied, by reason</h2></div><div class="card-body">${bars(countBy(applied, (e) => e.code), (k) => (CODES[k] || {}).plain || k)}
        <p class="hint" style="margin-top:10px">${applied.filter((e) => e.source === "learned").length} came from what people did before; ${applied.filter((e) => e.source === "playbook").length} came from the playbook.</p></div></section>
      <section class="card"><div class="card-head"><h2>Actions by role</h2></div><div class="card-body">${bars(countBy(actions, (e) => e.role), (k) => (ROLES[k] || {}).name || k)}</div></section>
      <section class="card"><div class="card-head"><h2>Searches with no results</h2></div><div class="card-body">${bars(emptySearch)}</div></section>
      <section class="card"><div class="card-head"><h2>Help articles read</h2></div><div class="card-body">${bars(countBy(ev.filter((e) => e.type === "help_view"), (e) => e.slug), (k) => ((window.PENNY_HELP || []).find((a) => a.slug === k) || {}).title || k)}</div></section>
    </div>
    ${errors.length ? `<section class="card" style="margin-top:16px"><div class="card-head"><h2>Errors</h2></div><div class="card-body"><ul class="notes">${errors.slice(-10).reverse().map((e) => `<li><code>${esc(e.message)}</code> <span class="hint">${esc(fmtDateTime(e.t))}</span></li>`).join("")}</ul></div></section>` : ""}
    <section class="card card-pad prose" style="margin-top:16px"><h2 style="margin-bottom:8px">What is collected, and what is not</h2>
      <p><strong>Collected:</strong> which screens are opened, which actions are taken (and how many seconds they took), whether suggested fixes were shown, applied or undone, searches and help searches that found nothing, keyboard shortcuts, the intro, and browser errors. Each event has a time and the role (not the person).</p>
      <p><strong>Never collected:</strong> note text, passwords, anything typed into forms other than search words, or anything that identifies a real person.</p>
      <p><strong>Where it lives:</strong> only in this browser, capped at the latest ${USAGE_MAX.toLocaleString()} events. You can turn it off, clear it, or download it. On a real server the same events would be collected for the whole team with an opt-out.</p>
    </section>`;
}
function bindInsights() {
  const dl = $("#usage-download");
  if (!dl) return;
  dl.addEventListener("click", () => download("penny-usage.json", JSON.stringify({ exported_at: new Date().toISOString(), events: usageEvents() }, null, 2) + "\n", "application/json"));
  $("#usage-toggle").addEventListener("click", () => { if (usageOn()) { track("tracking_off"); store.set(USAGE_OFF, "1"); toast("Usage tracking is off."); } else { store.del(USAGE_OFF); track("tracking_on"); toast("Usage tracking is on."); } render(); });
  $("#usage-clear").addEventListener("click", () => openDialog("Clear usage data", "This erases the usage events saved in this browser. The audit trail is not affected.", "", "Clear usage data",
    () => { store.del(USAGE_KEY); render(); toast("Usage data cleared."); return ""; }, { danger: true }));
}

// ------------------------------------------------------------------ my work
function viewWork(q) {
  if (!can("resolve") && !can("approve")) {
    return `${head("My work", "")}<section class="card"><div class="empty-state">${ICON.shield}<h2>Viewers have no work queue</h2>
      <p>You can read everything: the <a href="#/">dashboard</a>, every <a href="#/invoices">invoice</a> and the <a href="#/audit">audit trail</a>. Sign in as Avery, Jordan or Sam to act.</p></div></section>`;
  }
  const w = myWork();
  const tabs = [can("resolve") && ["holds", "Holds to resolve", w.holds.length], can("approve") && ["approvals", "Bills to approve", w.approvals.length]].filter(Boolean);
  const tab = tabs.find((t) => t[0] === q.get("tab")) ? q.get("tab") : tabs[0][0];
  let body;
  const order = q.get("order") === "team" ? "team" : "urgent";
  if (tab === "holds" && order === "urgent") {
    const rows = w.holds.map((d) => [urgency(d).score, d]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
    body = rows.length ? `<section class="card"><div class="team-head"><h2>Most urgent first</h2><span>${plural(rows.length, "hold")} · ${esc(amountLabel(rows))}</span></div>
        <p class="hint queue-why">Overdue blockers come first, then bills past or near their due date (bill date plus terms), then the oldest holds. Each row says why.</p>
        ${docTable(rows, { route: true, suggest: true, urgent: true })}</section>`
      : `<section class="card"><div class="empty-state">${ICON.check}<h2>No open holds</h2><p>Every hold has been resolved. Nice work.</p></div></section>`;
  } else if (tab === "holds") {
    const teams = {};
    w.holds.forEach((d) => { const t = routesFor(d.codes, d.id)[0] || "Unassigned"; (teams[t] = teams[t] || []).push(d); });
    body = w.holds.length ? Object.entries(teams).sort((a, b) => b[1].length - a[1].length).map(([t, rows]) =>
      `<section class="card" style="margin-bottom:16px"><div class="team-head"><h2>${esc(t)}</h2><span>${plural(rows.length, "hold")} · ${esc(amountLabel(rows))}</span></div>
        ${docTable(rows.sort((a, b) => b.amount - a.amount), { route: true, suggest: true })}</section>`).join("")
      : `<section class="card"><div class="empty-state">${ICON.check}<h2>No open holds</h2><p>Every hold has been resolved. Nice work.</p></div></section>`;
  } else {
    body = w.approvals.length ? `<section class="card">${docTable(w.approvals, {})}</section>`
      : `<section class="card"><div class="empty-state">${ICON.check}<h2>Nothing waiting for approval</h2><p>Every bill ready to import has its sign-offs recorded.</p></div></section>`;
  }
  const mine = EV.filter((e) => e.user.id === user.id).slice(-6).reverse();
  return `${head("My work", `${esc(user.name)}, here is what is waiting on you as ${esc(article(ROLES[user.role].name))}.`)}
    <div class="queue-bar">${tabs.length > 1 ? `<div class="segmented queue-tabs" role="group" aria-label="Queue">${tabs.map(([k, l, n]) =>
      `<button data-tab="${k}" aria-pressed="${k === tab}">${esc(l)}<span class="count">${n}</span></button>`).join("")}</div>` : ""}
      ${tab === "holds" && w.holds.length ? `<div class="segmented queue-order" role="group" aria-label="Order">${[["urgent", "Most urgent"], ["team", "By team"]].map(([k, l]) =>
        `<button data-order="${k}" aria-pressed="${k === order}">${esc(l)}</button>`).join("")}</div>` : ""}</div>
    ${body}
    ${mine.length ? `<section class="card" style="margin-top:16px"><div class="card-head"><h2>Your recent actions</h2><a href="#/audit?who=${esc(user.id)}">Full audit trail</a></div><div class="card-body">${activityList(mine)}</div></section>` : ""}`;
}

// ------------------------------------------------------------------ versions and updates (v1.6)
/* Two kinds of update, one release file (data/releases.json, the same as 04_Workflow/releases.json):
   - The website: a newer version was published while this page was open, or since it was cached. "Update now"
     reloads the page; everything done in this browser is kept.
   - Penny on a computer (./penny web): that copy is older than the newest release on GitHub. The server checks
     and tells the page; updating happens in the terminal with ./penny update.
   A required release is the minimum. Below it, Penny is read-only: nothing can be changed and nothing runs for real
   until the update, but every page can still be read. An optional release can be skipped until the next one. */
const UPD = { state: "current", version: APP_VERSION, latest: APP_VERSION, minimum: null, newer: [], where: "web", releases: [], loaded: false };
const SKIP_KEY = "penny.update.skip";
const vparse = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || "")); return m ? [+m[1], +m[2], +m[3]] : null; };
const vcmp = (a, b) => { const x = vparse(a), y = vparse(b); if (!x || !y) return 0; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
function updateStatus(version, releases, skipped) {
  const valid = releases.filter((r) => vparse(r.version));
  if (!valid.length) return { state: "current", version, latest: version, minimum: null, newer: [] };
  const latest = valid.reduce((a, r) => (vcmp(r.version, a) > 0 ? r.version : a), valid[0].version);
  const floor = valid.filter((r) => r.required).reduce((a, r) => (!a || vcmp(r.version, a) > 0 ? r.version : a), null);
  const newer = valid.filter((r) => vcmp(r.version, version) > 0).sort((a, b) => vcmp(b.version, a.version));
  const state = floor && vcmp(version, floor) < 0 ? "required" : !newer.length ? "current" : skipped && vcmp(skipped, latest) >= 0 ? "skipped" : "optional";
  return { state, version, latest, minimum: floor, newer };
}
async function checkUpdates(force) {
  let releases = UPD.releases;
  UPD.note = "";
  if (force && SERVER) {
    try { SERVER.update = await api("api/update?force=1"); UPD.note = SERVER.update.note || ""; }
    catch (e) { UPD.note = `Could not reach Penny on this computer (${e.message}).`; }
  }
  try {
    const res = await fetch("data/releases.json", { cache: "no-store" });   // tiny file; never trust a cached copy
    if (res.ok) releases = ((await res.json()).releases || []);
    else if (!SERVER) UPD.note = "Could not load the list of versions. Showing what this page already knows.";
  } catch (e) { if (!SERVER) UPD.note = "Could not check: this browser seems to be offline. Showing what this page already knows."; }
  UPD.checkedAt = new Date().toISOString();
  UPD.releases = releases;
  UPD.loaded = true;
  const web = updateStatus(APP_VERSION, releases, store.get(SKIP_KEY, ""));
  // On a computer, the server's own check (against GitHub) is what matters for that copy of Penny.
  const local = SERVER && SERVER.update ? { ...SERVER.update, state: SERVER.update.state === "optional" && vcmp(store.get(SKIP_KEY, ""), SERVER.update.latest) >= 0 ? "skipped" : SERVER.update.state } : null;
  Object.assign(UPD, local ? { ...local, where: "local" } : { ...web, where: "web" });
  paintUpdate();
  if (user && parseHash().parts[0] === "whats-new") render();       // the page may have drawn before the notes arrived
}
function paintUpdate() {
  const tag = $("#app-version");
  if (tag) {
    tag.textContent = `Penny v${APP_VERSION}${UPD.state === "optional" || UPD.state === "skipped" ? ` · ${UPD.latest} available` : UPD.state === "required" ? " · update required" : " · What's new"}`;
    tag.classList.toggle("needs", UPD.state === "required");
  }
  const credit = $("#auth-version");
  if (credit) credit.textContent = `Penny v${APP_VERSION}`;
  const el = $("#update-banner");
  if (!el) return;
  const next = UPD.newer[0] || {};
  const how = UPD.where === "local"
    ? `<button type="button" class="btn btn-sm" data-update-help>How to update</button>`
    : `<button type="button" class="btn btn-sm ${UPD.state === "required" ? "btn-accent" : "btn-accent"}" data-update-now>Update now</button>`;
  if (UPD.state === "required") {
    el.className = "update-banner ub-required";
    el.setAttribute("role", "alert");
    el.innerHTML = `<div class="ub-text"><strong>Update required: Penny ${esc(UPD.minimum)}.</strong> This copy is ${esc(UPD.version)}. Until it is updated, Penny is read-only: you can look at everything, but changes${UPD.where === "local" ? " and real runs" : ""} are paused.</div>
      <div class="ub-actions"><a class="btn btn-sm" href="#/whats-new">What's new</a>${how}</div>`;
    el.hidden = false;
  } else if (UPD.state === "optional") {
    el.className = "update-banner ub-optional";
    el.setAttribute("role", "status");
    el.innerHTML = `<div class="ub-text"><strong>Penny ${esc(UPD.latest)} is ready.</strong> ${esc(next.summary || "")}</div>
      <div class="ub-actions"><a class="btn btn-sm" href="#/whats-new">What's new</a>${how}<button type="button" class="btn btn-sm btn-ghost" data-update-skip>Skip this version</button></div>`;
    el.hidden = false;
  } else el.hidden = true;
}
async function updateNow() {
  toast("Updating Penny…");
  // Refresh the browser's copy of every file first, so the reload cannot pick up an old cached one.
  const files = ["./", "index.html", "assets/penny.css", "data/penny-data.json", "data/releases.json",
    ...Array.from(document.scripts, (x) => x.getAttribute("src")).filter((u) => u && u.startsWith("assets/"))];
  await Promise.all(files.map((f) => fetch(f, { cache: "reload" }).catch(() => null)));
  track("update", { from: APP_VERSION, to: UPD.latest });
  location.reload();
}
function showUpdateHelp() {
  if (UPD.where !== "local") return;
  openDialog(`Update to Penny ${UPD.state === "required" ? UPD.minimum : UPD.latest}`, "Penny on this computer updates from GitHub in the terminal. Your register, runs, batches and everything in this browser are kept.",
    `<ol class="notes"><li>In Terminal, go to the project folder, then <code>cd 04_Workflow</code>.</li>
      <li>Run <code>./penny update</code>. It shows what is new, updates, and checks that everything works.</li>
      <li>Stop the web app with Ctrl+C, start it again with <code>./penny web --package &lt;package folder&gt;</code>, and reload this page.</li></ol>
     ${UPD.state === "required" ? "" : `<p class="hint">Not now? Choose Skip this version, and Penny will remind you when a newer one is out.</p>`}`, "", () => "", { info: true });
}
function bindUpdates() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-update-check]")) { e.preventDefault(); openUpdateCheck(); return; }
    if (e.target.closest("[data-close-dialog]")) { const d = $("#dialog"); if (d.open) d.close(); return; }
    if (e.target.closest("[data-update-now]")) { e.preventDefault(); updateNow(); }
    else if (e.target.closest("[data-update-help]")) { e.preventDefault(); showUpdateHelp(); }
    else if (e.target.closest("[data-update-skip]")) {
      e.preventDefault();
      if (UPD.state !== "optional") return;
      store.set(SKIP_KEY, UPD.latest);
      track("update_skip", { version: UPD.latest });
      UPD.state = "skipped";
      paintUpdate();
      const uc = $("#uc-body");
      if (uc) uc.innerHTML = updateCheckBody();
      toast(`Skipped ${UPD.latest}. Penny will tell you when a newer version is out.`);
    }
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkUpdates(); });
  setInterval(checkUpdates, 30 * 60 * 1000);
}
/** "Check for updates" (account menu and What's new): this version against the newest one, checked right now. */
const UPD_STATE = {
  current: ["You are up to date", "b-approved", "check"], optional: ["An optional update is ready", "b-ready", "redo"],
  skipped: ["An optional update is ready (you chose to wait)", "b-skip", "clock"], required: ["A required update is waiting", "b-rejected", "alert"],
};
function updateCheckBody() {
  const mine = UPD.where === "local" ? UPD.version : APP_VERSION;
  const newest = (UPD.releases || []).find((r) => r.version === UPD.latest) || UPD.newer[0] || {};
  const [label, cls, icon] = UPD_STATE[UPD.state] || UPD_STATE.current;
  const needs = UPD.state !== "current";
  const how = UPD.where === "local"
    ? `<div class="uc-how"><p><b>To update Penny on this computer:</b> in Terminal, in the <code>04_Workflow</code> folder, run <code>./penny update</code>, then restart <code>./penny web</code> and reload this page. Your register, runs and batches are kept.</p></div>`
    : "";
  return `<div class="uc-grid">
      <div class="uc-box"><span class="uc-label">This version</span><span class="uc-ver">${esc(mine)}</span><span class="sub">${UPD.where === "local" ? "Penny on this computer" : "This website"}</span></div>
      <div class="uc-box${needs ? " uc-new" : ""}"><span class="uc-label">Newest version</span><span class="uc-ver">${esc(UPD.latest)}</span><span class="sub">${esc(newest.required ? "Required" : "Optional")}${newest.date ? ` · ${esc(newest.date)}` : ""}</span></div>
    </div>
    <p class="uc-state"><span class="badge ${cls}">${bIcon(icon)}${esc(label)}</span>${UPD.minimum ? `<span class="sub-inline">Oldest version allowed: ${esc(UPD.minimum)}</span>` : ""}</p>
    ${UPD.state === "required" ? `<p class="form-warn">Until you update, Penny is read-only: you can look at everything, but changes${UPD.where === "local" ? " and real runs" : ""} are paused.</p>` : ""}
    ${UPD.newer.length ? `<ul class="uc-list">${UPD.newer.map((r) => `<li><b>${esc(r.version)}</b> <span class="badge ${r.required ? "b-rejected" : "b-skip"}">${r.required ? "Required" : "Optional"}</span> ${esc(r.summary || "")}</li>`).join("")}</ul>` : ""}
    ${needs ? how : ""}
    <p class="hint">Checked ${esc(fmtDateTime(UPD.checkedAt || new Date().toISOString()))}.${UPD.note ? ` ${esc(UPD.note)}` : ""}</p>
    <div class="nb-actions">
      ${needs && UPD.where !== "local" ? `<button type="button" class="btn btn-accent" data-update-now>Update now</button>` : ""}
      ${UPD.state === "optional" ? `<button type="button" class="btn" data-update-skip>Skip this version</button>` : ""}
      <a class="btn" href="#/whats-new" data-close-dialog>What's new</a>
      <button type="button" class="btn btn-ghost" data-update-check>Check again</button>
    </div>`;
}
async function openUpdateCheck() {
  const dlg = $("#dialog");
  if (!dlg.open) openDialog("Check for updates", "", `<div id="uc-body" aria-live="polite"><p class="hint">Checking for a newer version…</p></div>`, "", () => "", { info: true });
  else $("#uc-body").innerHTML = `<p class="hint">Checking for a newer version…</p>`;
  await checkUpdates(true);
  track("update_check", { state: UPD.state });
  const body = $("#uc-body");
  if (body) body.innerHTML = updateCheckBody();
}

function viewWhatsNew() {
  const rel = (UPD.releases || []).filter((r) => vparse(r.version)).sort((a, b) => vcmp(b.version, a.version));
  const when = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? fmtDate(d) : /^\d{4}-\d{2}$/.test(d || "") ? `${MONTHS[+d.slice(5) - 1]} ${d.slice(0, 4)}` : d || "");
  const banner = UPD.state === "required" ? `<div class="mode-banner mode-warn" role="note"><b>Penny ${esc(UPD.minimum)} is required.</b> Until you update, Penny is read-only.</div>`
    : UPD.state === "optional" || UPD.state === "skipped" ? `<div class="mode-banner mode-ok" role="note"><b>Penny ${esc(UPD.latest)} is ready.</b> ${UPD.where === "local" ? "Update in the terminal with <code>./penny update</code>." : "Choose Update now in the banner, or reload the page."}</div>` : "";
  return `${head("What's new", `You are using <strong>Penny v${esc(APP_VERSION)}</strong>${UPD.where === "local" ? ` on this computer (the copy here is ${esc(UPD.version)})` : ""}. Each version says whether it is required.`)}
    ${banner}
    <ol class="releases">${rel.map((r) => {
      const mine = r.version === (UPD.where === "local" ? UPD.version : APP_VERSION);
      const isNew = vcmp(r.version, UPD.where === "local" ? UPD.version : APP_VERSION) > 0;
      return `<li class="card release${mine ? " mine" : ""}"><div class="rel-head"><h2>Penny ${esc(r.version)}</h2>
          <span class="badge ${r.required ? "b-rejected" : "b-skip"}">${r.required ? "Required" : "Optional"}</span>
          ${mine ? `<span class="badge b-approved">${bIcon("check")}You are on this version</span>` : isNew ? `<span class="badge b-ready">New</span>` : ""}
          <span class="rel-date">${esc(when(r.date))}</span></div>
        <p>${esc(r.summary || "")}</p>
        ${(r.notes || []).length ? `<ul class="notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}</li>`;
    }).join("") || `<li class="empty">${UPD.loaded ? "The release notes could not be loaded. Check your connection and reload the page." : "Loading the release notes…"}</li>`}</ol>
    <p class="hint">Required means older copies must update before anything changes or runs for real; reading always works. Optional versions can be skipped until the next one. <a href="#/help/updates">How updates work</a></p>
    <p><button type="button" class="btn" data-update-check>Check for updates</button></p>`;
}
