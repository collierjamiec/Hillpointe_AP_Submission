/* Penny web app: The audit trail, the help center and search.
   Sections: audit trail, help center, search. */
"use strict";

// ------------------------------------------------------------------ audit trail
// The browser writes UTC times and Penny's disk log writes local times with an offset, so both are turned into
// UTC before sorting. Comparing the raw text would put a 9:00 -05:00 entry before a 10:00 UTC one.
const iso = (t) => { const d = new Date(t); return t && !isNaN(d) ? d.toISOString() : ""; };
function auditRows() {
  const serverLog = (D.batch_log || []).map((e) => ({ ...e, type: e.event === "batch.uploaded" ? "batch.upload" : e.event, user: { id: e.by.id, name: e.by.name, role: e.by.role, initials: e.by.name.split(" ").map((w) => w[0]).join("").slice(0, 2) },
    count: e.count, sort: iso(e.at), server: true }));
  const onServer = new Set(serverLog.map((e) => e.id).filter(Boolean));
  const people = [...EV.filter((e) => !onServer.has(e.id)).map((e) => ({ ...e, sort: iso(e.at) })), ...serverLog];
  const runs = D.runs.map((r) => ({ id: `run-${r.id}`, type: "run", at: r.started_at || "", run: r, sort: iso(r.started_at) || `0000-${String(r.order).padStart(4, "0")}`,
    user: { id: "penny", name: "Penny", role: "system", initials: "P" } }));
  // Newest first. The disk log keeps whole seconds, so entries from the same second fall back to the order the
  // steps really happen in: folder created, files uploaded, Penny's run, then the run record.
  const STEP = { "batch.created": 0, "batch.upload": 1, run: 2, "batch.run": 3, "batch.run_failed": 3 };
  const sec = (x) => String(x.sort || "").slice(0, 19);
  const rank = (x) => (x.type in STEP ? STEP[x.type] : 1.5);
  return [...people, ...runs].sort((a, b) => (sec(a) < sec(b) ? 1 : sec(a) > sec(b) ? -1 : rank(b) - rank(a) || (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0)));
}
function auditTarget(e) {
  if (e.type === "run") return { html: `<a href="#/runs/${esc(e.run.id)}">${esc(e.run.label)}</a>`, text: e.run.label };
  if (e.doc) { const d = X.docById[e.doc]; const t = d ? `${d.vendor} ${d.billNo}` : e.doc; return { html: `<a href="#/invoices/${esc(e.doc)}">${esc(t)}</a>`, text: t }; }
  if (e.type && e.type.startsWith("batch.")) return e.run_id && X.runById[e.run_id] ? { html: `<a href="#/runs/${esc(e.run_id)}">${esc(e.batch)}</a>`, text: e.batch } : { html: `<code>${esc(e.batch)}</code>`, text: e.batch };
  if (e.type.startsWith("rules.")) return { html: `<a href="#/rules">Rules</a>`, text: "Rules" };
  return { html: "", text: "" };
}
function auditDetail(e) {
  if (e.type === "run") {
    const res = X.byRun[e.run.id] || [];
    const st = runStats(res);
    return `${res.length} documents: ${st.entered} ready to import, ${st.held} need review, ${st.dup} duplicates, ${st.skip} skipped`;
  }
  if (Array.isArray(e.changes)) return e.changes.map(describeChange).join("; ");
  if (e.type === "batch.created") return `Folder ${e.folder}`;
  if (e.type === "batch.run_failed") return `${e.dry_run ? "Preview" : "Real run"} ${e.run_id} on ${e.folder} did not finish: ${e.error}`;
  if (e.type === "batch.upload") return `${plural(e.count || (e.files || []).length, "file")} to ${e.folder}${e.bytes ? `, ${fmtBytes(e.bytes)}` : ""}: ${(e.files || []).slice(0, 4).map((f) => f.name).join(", ")}${(e.files || []).length > 4 ? "…" : ""}`;
  if (e.type === "batch.run") return `${e.dry_run ? "Preview" : "Real run"} ${e.run_id} on ${e.folder}: ${plural(e.documents, "document")}, ${Object.entries(e.counts || {}).map(([k, n]) => `${n} ${(STATUS[k] || { short: k }).short.toLowerCase()}`).join(", ")}; pre-flight ${e.preflight}${e.seconds ? `; ${e.seconds} s` : ""}`;
  if (e.type && e.type.startsWith("user.")) {
    const ch = e.changes ? Object.entries(e.changes).map(([k, [b, a]]) => `${k}: ${k === "role" ? (ROLES[b] || {}).name || b : b || "none"} → ${k === "role" ? (ROLES[a] || {}).name || a : a}`).join("; ") : "";
    return [e.email, e.role ? `as ${(ROLES[e.role] || {}).name || e.role}` : "", ch, e.email_status ? `email ${e.email_status}` : ""].filter(Boolean).join(" · ");
  }
  if (e.type && e.type.startsWith("email.")) return `To ${(e.to || []).join(", ")}: “${e.subject}”${(e.attachments || []).length ? `; attached ${e.attachments.map((f) => `${f.name} (${String(f.sha256 || "").slice(0, 10)})`).join(", ")}` : ""}${e.error ? `; ${e.error}` : ""}`;
  if (e.type === "recheck.preview") return `${RC_SOURCE[e.source] || e.source}: ${(STATUS[e.was] || { label: e.was }).label} → ${(STATUS[e.result] || { label: e.result }).label}${(e.codes || []).length ? ` (${e.codes.join(", ")})` : ""}; rules ${e.rules_fingerprint}, data ${e.data_fingerprint}. Preview only.`;
  if (e.type === "manual.saved" && e.server) return `Keyed by ${(e.keyed_by || {}).name || "?"}${e.checked_by ? `, checked by ${e.checked_by.name}` : ""}; invoice ${e.invoice_no}, total ${money(cents(e.total))}; ${plural((e.evidence || []).length, "evidence file")}; saved to ${e.folder}`;
  if (e.type === "manual.keyed") return `${e.entry.vendor_name} ${e.entry.invoice_no}, ${money(cents(e.entry.total))}; evidence ${(e.evidence || []).map((f) => `${f.name} (${f.sha256.slice(0, 10)})`).join(", ")}`;
  if (e.type === "blocker.clear" || e.type === "blocker.update") return `${e.code}: ${e.before} → ${e.after}${(e.files || []).length ? `; files ${e.files.map((f) => `${f.name} (${f.sha256.slice(0, 10)})`).join(", ")}` : ""}`;
  if (e.before !== undefined) return `${e.before} → ${e.after}`;
  return "";
}
function viewAudit(q) {
  const all = auditRows();
  const who = q.get("who") || "", type = q.get("type") || "";
  const rows = all.filter((e) => (!who || e.user.id === who) && (!type || e.type === type));
  const people = [...new Map(all.map((e) => [e.user.id, e.user.name])).entries()];
  const types = [...new Set(all.map((e) => e.type))];
  return `${head("Audit trail", "Every Penny run and every action a person took, newest first. Entries are never edited or deleted; an undo is a new entry.",
      `<button class="btn" id="audit-csv" type="button">Download CSV</button>`)}
    <section class="card">
      <form class="filters" id="audit-filters" data-stay>
        <div class="field"><label for="a-who">Who</label><select id="a-who" name="who"><option value="">Everyone</option>${people.map(([id, n]) => `<option value="${esc(id)}"${id === who ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></div>
        <div class="field"><label for="a-type">Action</label><select id="a-type" name="type"><option value="">Any action</option>${types.map((t) => `<option value="${esc(t)}"${t === type ? " selected" : ""}>${esc(EVENT_LABEL[t] || t)}</option>`).join("")}</select></div>
      </form>
      <div class="filter-summary"><span>${plural(rows.length, "entry", "entries")}</span><span>${plural(EV.length, "action")} by people in this browser</span></div>
      ${rows.length ? `<div class="table-wrap"><table class="data audit"><thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col" class="hide-sm">On</th><th scope="col">Details</th></tr></thead><tbody>
        ${rows.map((e) => `<tr><td style="white-space:nowrap">${esc(e.at ? fmtDateTime(e.at) : `Run ${e.run.order}`)}</td>
          <td><span style="display:inline-flex;gap:8px;align-items:center"><span class="avatar ${e.type === "run" ? "sys-avatar" : `av-${esc(e.user.role)}`}" style="width:26px;height:26px;font-size:10.5px" aria-hidden="true">${esc(e.user.initials)}</span>${esc(e.user.name)}</span></td>
          <td>${esc(e.type === "batch.run" && e.dry_run ? "Previewed a batch" : EVENT_LABEL[e.type] || e.type)}${S.revoked.has(e.id) ? ` <span class="badge b-skip">Undone</span>` : ""}${e.server ? ` <span class="pill" title="Recorded in state/batch_log.jsonl on the Penny computer">On disk</span>` : ""}</td>
          <td class="hide-sm">${auditTarget(e).html}</td>
          <td><span class="diff">${esc(auditDetail(e))}</span>${e.note ? `<span class="sub" style="display:block;color:var(--text-2)">“${esc(e.note)}”</span>` : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="empty">No entries match.</p>`}
    </section>`;
}
/** CSV cells are quoted, and text that a spreadsheet would run as a formula is neutralized (CSV injection). */
function csvCell(v) {
  let t = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return `"${t.replace(/"/g, '""')}"`;
}
function bindAudit() {
  const f = $("#audit-filters");
  f.addEventListener("change", () => {
    const p = new URLSearchParams();
    new FormData(f).forEach((v, k) => v && p.set(k, v));
    location.hash = `#/audit${p.toString() ? "?" + p : ""}`;
  });
  $("#audit-csv").addEventListener("click", () => {
    const lines = [["when", "who", "role", "action", "on", "details", "note"].map(csvCell).join(",")];
    auditRows().forEach((e) => lines.push([e.at || `run ${e.run.order}`, e.user.name, e.user.role, EVENT_LABEL[e.type] || e.type,
      auditTarget(e).text, auditDetail(e), e.note || ""].map(csvCell).join(",")));
    download("penny-audit-trail.csv", lines.join("\r\n") + "\r\n", "text/csv");
  });
}

// ------------------------------------------------------------------ help center
const HELP = () => window.PENNY_HELP || [];
const ROLE_ROWS = [
  ["Viewer", "Every run, invoice, check, rule, export and the audit trail.", "Nothing. Read-only for auditors and leaders."],
  ["AP Clerk", "Everything a Viewer sees, plus a queue of holds, most urgent first.", "Resolve, reject, reassign and reopen holds, update and clear blockers, recheck invoices, key unreadable invoices by hand and check someone else's entry, apply suggested fixes, add notes, email exports and approval requests, upload new batches and run previews."],
  ["Approver", "Everything a Viewer sees, plus bills waiting for sign-off.", "Approve or send back bills, email a bill for approval, email exports, and add notes."],
  ["Admin", "Everything, plus usage Insights.", "All of the above, plus run batches for real, edit every rule with a preview first and undo, test rule changes on every saved invoice, manage people (invite, roles, turn off, password resets), and set the company look."],
];
/** Fill the live parts of an article from the same data the app uses. */
function helpFill(html) {
  const R = RULES();
  const table = (head, rows) => `<div class="table-wrap"><table class="mini"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  return html
    .replace("{{accounts}}", table(["Person", "Role", "Email", "Password", "Can"], PennyAuth.accounts.map((a) =>
      [esc(a.name), esc(ROLES[a.role].name), `<code>${esc(a.email)}</code>`, `<code>${esc(a.demoPassword)}</code>`, esc(ROLES[a.role].blurb)])))
    .replace("{{shortcuts}}", table(["Keys", "What it does"], SHORTCUTS.map(([k, w]) => [k.split(" then ").map((x) => `<kbd>${esc(x)}</kbd>`).join(" then "), esc(w)])))
    .replace("{{roles}}", table(["Role", "Sees", "Can change"], ROLE_ROWS.map((r) => r.map(esc))))
    .replace(/\{\{thresholds\}\}/g, table(["Setting", "Value now", "What it does"], Object.entries(R.thresholds || {}).map(([k, v]) => {
      const [name, help, kind] = THRESHOLDS[k] || [k, "", ""];
      return [`${esc(name)}<span class="sub"><code>thresholds.${esc(k)}</code></span>`, esc(fmtSetting(v, kind)), esc(help)];
    })))
    .replace("{{codes}}", (R.code_priority || Object.keys(CODES)).map((c) => { const k = CODES[c] || CODES.OTHER; return `
      <section class="help-code" id="code-${esc(c)}"><h2>${esc(k.plain)} ${codeChip(c)}</h2>
      <p><strong>Why it happens.</strong> ${esc(k.why)}</p><p><strong>What to do next.</strong> ${esc(k.next)}</p>
      <p class="hint">Goes to: ${esc((R.routes || {})[c] || "")}</p></section>`; }).join(""));
}
const helpText = (a) => (a.title + " " + a.summary + " " + a.html.replace(/<[^>]+>/g, " ")).toLowerCase();
function helpSections() {
  const out = [];
  HELP().forEach((a) => { let g = out.find((x) => x[0] === a.section); if (!g) out.push((g = [a.section, []])); g[1].push(a); });
  return out;
}
function viewHelp(slug, q) {
  const all = HELP();
  if (!slug) {
    const term = (q.get("q") || "").trim();
    return `${head("Help center", "Everything about Penny: how to use this web app and the terminal, how Penny decides, every rule and code, and what each word means.")}
      <div class="help-search card"><label class="sr-only" for="help-q">Search help</label>
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4"/></svg>
        <input id="help-q" type="search" placeholder="Search help, for example: duplicate, approve, dry run" value="${esc(term)}" autocomplete="off"></div>
      <div id="help-results">${helpResults(term)}</div>`;
  }
  const idx = all.findIndex((a) => a.slug === slug);
  if (idx < 0) return notFound("That help article");
  const a = all[idx], prev = all[idx - 1], next = all[idx + 1];
  const toc = helpSections().map(([sec, list]) => `<div class="toc-group"><p class="toc-h">${esc(sec)}</p><ul>${list.map((x) =>
    `<li><a href="#/help/${esc(x.slug)}"${x.slug === slug ? ' aria-current="page"' : ""}>${esc(x.title)}</a></li>`).join("")}</ul></div>`).join("");
  return `<div class="help-layout">
    <aside class="help-toc" aria-label="Help articles">
      <a class="toc-home" href="#/help"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 9l7-6 7 6v8H3z"/><path d="M8 17v-5h4v5"/></svg>Help center home</a>
      <details ${matchMedia("(min-width: 861px)").matches ? "open" : ""} class="toc-wrap"><summary>All help articles</summary>${toc}</details></aside>
    <article class="help-article card">
      <a class="back-link help-back" href="#/help">← Back to Help center</a>
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/help">Help center</a><span aria-hidden="true">/</span><a href="#/help?section=${encodeURIComponent(a.section)}">${esc(a.section)}</a><span aria-hidden="true">/</span><span aria-current="page">${esc(a.title)}</span></nav>
      <h1>${esc(a.title)}</h1><p class="lede">${esc(a.summary)}</p>
      <div class="help-body">${helpFill(a.html)}</div>
      <nav class="help-pager" aria-label="More articles">
        ${prev ? `<a href="#/help/${esc(prev.slug)}"><span class="hint">Previous</span>${esc(prev.title)}</a>` : "<span></span>"}
        ${next ? `<a class="next" href="#/help/${esc(next.slug)}"><span class="hint">Next</span>${esc(next.title)}</a>` : "<span></span>"}
      </nav>
    </article></div>`;
}
function helpResults(term) {
  const t = term.toLowerCase();
  if (t) {
    const hits = HELP().filter((a) => t.split(/\s+/).every((w) => helpText(a).includes(w)));
    return `<p class="hint" aria-live="polite" style="margin:4px 0 12px">${plural(hits.length, "article")} match “${esc(term)}”.</p>
      ${hits.length ? `<div class="help-grid">${hits.map(helpCard).join("")}</div>` : `<div class="card"><div class="empty-state"><p>No articles match. Try a shorter word, like “hold” or “import”.</p></div></div>`}`;
  }
  return helpSections().map(([sec, list]) => `<section class="help-sec" id="sec-${esc(sec.toLowerCase().replace(/[^a-z]+/g, "-"))}"><h2>${esc(sec)}</h2><div class="help-grid">${list.map(helpCard).join("")}</div></section>`).join("");
}
const helpCard = (a) => `<a class="card help-card" href="#/help/${esc(a.slug)}"><b>${esc(a.title)}</b><span>${esc(a.summary)}</span></a>`;
function bindHelp() {
  const sec = parseHash().q.get("section");
  if (sec) { const t = document.getElementById(`sec-${sec.toLowerCase().replace(/[^a-z]+/g, "-")}`); if (t) { t.scrollIntoView(); t.classList.add("flash"); } }
  const input = $("#help-q");
  if (!input) return;
  input.addEventListener("input", () => {
    $("#help-results").innerHTML = helpResults(input.value);
    clearTimeout(bindHelp._t);
    bindHelp._t = setTimeout(() => { const q = input.value.trim(); if (q.length >= 3) { const hits = $$("#help-results .help-card").length; track("help_search", { hits, q: hits ? undefined : q.slice(0, 40) }); } }, 1200);
    history.replaceState(null, "", `#/help${input.value.trim() ? `?q=${encodeURIComponent(input.value.trim())}` : ""}`);
  });
}

function notFound(what) {
  return `${head("Not found", `${esc(what)} is not in this data. It may come from a run that has not been exported yet.`)}<p><a href="#/">Back to the dashboard</a></p>`;
}

// ------------------------------------------------------------------ search
function searchMatches(text) {
  const terms = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return X.docs.filter((d) => terms.every((t) => d.hay.includes(t) || d.hay.includes(t.replace(/[$,]/g, "")))).slice(0, 8);
}
function bindSearch() {
  const input = $("#search"), list = $("#search-results");
  let items = [], sel = -1;
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); sel = -1; };
  const paint = () => {
    $$("li", list).forEach((li, i) => li.setAttribute("aria-selected", String(i === sel)));
    const cur = $$("li", list)[sel];
    input.setAttribute("aria-activedescendant", cur ? cur.id : "");
  };
  input.addEventListener("input", () => {
    const v = input.value;
    if (!v.trim()) return close();
    items = searchMatches(v);
    clearTimeout(bindSearch._t);
    bindSearch._t = setTimeout(() => { if (input.value.trim().length >= 3) track("search", { hits: items.length, q: items.length ? undefined : input.value.trim().slice(0, 40) }); }, 1200);
    list.innerHTML = (items.length ? items.map((d, i) => `<li role="option" id="sr-${i}"><a href="#/invoices/${esc(d.id)}" tabindex="-1">
      <span class="sr-title">${esc(d.vendor)}</span><span class="sr-amt">${esc(money(d.amount))}</span>
      <span class="sr-meta">${esc(d.billNo || d.id)} · ${esc(STATUS[d.status].label)}</span></a></li>`).join("")
      : `<li class="sr-empty" role="option" aria-disabled="true">No invoices match “${esc(v)}”.</li>`) +
      `<li class="sr-all" role="option" id="sr-all"><a href="#/invoices?q=${encodeURIComponent(v)}" tabindex="-1">See all results in Invoices</a></li>`;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    sel = -1;
  });
  input.addEventListener("keydown", (e) => {
    const n = $$("li[id]", list).length;
    if (e.key === "ArrowDown" && n) { e.preventDefault(); sel = (sel + 1) % n; paint(); }
    else if (e.key === "ArrowUp" && n) { e.preventDefault(); sel = (sel - 1 + n) % n; paint(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const a = sel >= 0 ? $$("li[id] a", list)[sel] : null;
      location.hash = a ? a.getAttribute("href") : `#/invoices?q=${encodeURIComponent(input.value)}`;
      close(); input.blur();
    } else if (e.key === "Escape") { close(); }
  });
  list.addEventListener("click", () => { close(); input.value = ""; });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !e.target.closest("input, select, textarea")) { e.preventDefault(); input.focus(); }
  });
}
