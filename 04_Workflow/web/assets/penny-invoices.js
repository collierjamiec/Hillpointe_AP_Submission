/* Penny web app: The Overview, run history, the invoice list and the invoice page.
   Sections: overview, runs, invoices list, invoice detail. */
"use strict";

// ------------------------------------------------------------------ overview
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
const kpi = (dot, label, value, sub, href) => {
  const inner = `<div class="kpi-label"><span class="dot ${dot}"></span>${esc(label)}</div><div class="kpi-value">${esc(value)}</div><div class="kpi-sub">${esc(sub)}</div>`;
  return href ? `<a class="card kpi kpi-${dot} kpi-link" href="${esc(href)}">${inner}<span class="kpi-go" aria-hidden="true">→</span></a>` : `<div class="card kpi kpi-${dot}">${inner}</div>`;
};
/** One line per item that needs a person: who, how much, why in plain words, and who acts next. */
function attentionRow(d, kind) {
  const href = `#/invoices/${encodeURIComponent(d.id)}`;
  if (kind === "approval") {
    const a = approvalSummary(d);
    const next = a.steps.find((st) => st.status !== "approved");
    return `<li><a class="att-row" href="${href}"><span class="att-main"><b>${esc(d.vendor)}</b><span class="sub">${esc(d.billNo)} · waiting on ${esc(next ? next.label : "sign-off")}</span></span>
      <span class="att-why">${approvalChip(d)}</span><span class="att-amt num">${esc(money(d.amount))}</span></a></li>`;
  }
  const c = CODES[d.primary] || CODES.OTHER;
  return `<li><a class="att-row" href="${href}"><span class="att-main"><b>${esc(d.vendor)}</b><span class="sub">${esc(d.billNo || d.id)}${d.codes.length > 1 ? ` · ${plural(d.codes.length, "reason")}` : ""}</span></span>
    <span class="att-why"><span class="att-reason">${esc(c.plain)}</span><span class="sub">Next: ${esc(routesFor(d.codes, d.id)[0] || "AP Manager")}</span></span>
    <span class="att-amt num">${!d.amount && !(d.ex && d.ex.total) ? `<span class="hint">Not read</span>` : esc(money(d.amount))}</span></a></li>`;
}
function viewDashboard() {
  const docs = X.docs;
  const sum = (list) => list.reduce((a, d) => a + d.amount, 0);
  const ready = docs.filter((d) => d.pennyStatus.startsWith("ENTER_"));
  const open = docs.filter(openHold).sort((a, b) => b.amount - a.amount);
  const dups = docs.filter((d) => d.status === "DUP");
  const resolved = docs.filter((d) => d.status === "CLEARED" || d.status === "REJECTED");
  const waiting = docs.filter((d) => { const a = approvalSummary(d); return a && a.state === "waiting"; });
  const twice = enteredTwiceCount();
  const skipped = D.results.filter((r) => r.decision === "SKIP_ALREADY_ENTERED").length;

  let focus;
  if (can("resolve")) {
    focus = { kind: "hold", items: open, title: open.length ? `${plural(open.length, "invoice")} need${open.length === 1 ? "s" : ""} your review` : "Nothing needs review",
      sub: open.length ? `${amountLabel(open)} is waiting. Start with the largest; each one shows why it was held and what to do.` : "Every hold has been cleared or rejected. Penny will re-check cleared ones on its next run.",
      cta: open.length ? { href: `#/invoices/${encodeURIComponent(open[0].id)}`, label: "Start reviewing" } : null };
  } else if (can("approve")) {
    focus = { kind: "approval", items: waiting, title: waiting.length ? `${plural(waiting.length, "bill")} waiting for your sign-off` : "Nothing is waiting for sign-off",
      sub: waiting.length ? "These are in the import file and need an approval before they are paid." : "Every bill ready to import has its approvals recorded.",
      cta: waiting.length ? { href: `#/invoices/${encodeURIComponent(waiting[0].id)}`, label: "Start approving" } : null };
  } else {
    focus = { kind: "hold", items: open, title: `${plural(open.length, "invoice")} waiting on the AP team`, sub: "You can read every detail. Sign in as Avery (AP Clerk) or Sam (Admin) to act on them.",
      cta: { href: "#/exceptions", label: "See why they are held" } };
  }
  const codeCounts = {};
  open.forEach((d) => d.codes.forEach((c) => (codeCounts[c] = (codeCounts[c] || 0) + 1)));
  const codeRows = Object.entries(codeCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const maxCode = Math.max(1, ...codeRows.map(([, n]) => n));
  const recent = EV.slice(-5).reverse();
  const first = user.name.split(" ")[0];

  return `
    ${head(`${greeting()}, ${esc(first)}`, "Here is what needs attention, why, and what to do next.")}
    <section class="card attention" aria-labelledby="att-title">
      <div class="att-head">
        <div><h2 id="att-title">${esc(focus.title)}</h2><p>${esc(focus.sub)}</p></div>
        ${focus.cta ? `<a class="btn btn-accent btn-lg" href="${esc(focus.cta.href)}">${esc(focus.cta.label)} <span aria-hidden="true">→</span></a>` : ""}
      </div>
      ${focus.items.length ? `<ul class="att-list">${focus.items.slice(0, 6).map((d) => attentionRow(d, focus.kind)).join("")}</ul>
        ${focus.items.length > 6 ? `<a class="att-more" href="${focus.kind === "approval" ? "#/work?tab=approvals" : "#/work"}">See all ${focus.items.length}</a>` : ""}`
        : `<div class="empty-state">${ICON.check}<p>You are all caught up.</p></div>`}
    </section>
    <section class="grid kpis" aria-label="Totals across all runs">
      ${kpi("dot-hold", "Needs review", open.length, `${amountLabel(open)} held for a person`, "#/exceptions")}
      ${kpi("dot-ok", "Ready to import", ready.length, `${amountLabel(ready)} in generated files, not uploaded`, "#/exports")}
      ${kpi("dot-dup", "Duplicates stopped", dups.length, `${amountLabel(dups)} not billed twice`, "#/invoices?status=dup")}
      ${kpi("dot-accent", "Resolved by people", resolved.length, can("approve") && !can("resolve") ? `${plural(waiting.length, "bill")} awaiting sign-off` : "in this demo, see the audit trail", "#/audit")}
    </section>
    <div class="proof" role="note">
      ${ICON.shield}
      <p><strong>${twice === 0 ? "Rerun safe." : "Check needed."}</strong> ${plural(twice, "bill")} written to an import file twice across ${plural(D.runs.length, "run")}.
      Running a batch again skipped ${plural(skipped, "document")} already processed.${docs.some((d) => d.replacedBy)
        ? ` ${plural(docs.filter((d) => d.replacedBy).length, "earlier hold")} closed out when a revised invoice passed every check.` : ""}</p>
    </div>
    <div class="grid two">
      <section class="card" aria-labelledby="h-why">
        <div class="card-head"><h2 id="h-why">Why invoices need review</h2><a href="#/exceptions">Exceptions guide</a></div>
        <div class="card-body">
          ${codeRows.length ? `<ul class="hbars">${codeRows.map(([c, n]) => `
            <li><a class="hbar" href="#/exceptions#code-${esc(c)}">
              <span class="hbar-label">${esc((CODES[c] || {}).plain || c)}<small>${esc(c)}</small></span>
              <span class="hbar-track" aria-hidden="true"><span class="hbar-fill" style="display:block;width:${(n / maxCode) * 100}%"></span></span>
              <span class="hbar-n">${n}</span></a>
            </li>`).join("")}</ul><p class="hint" style="margin-top:12px">An invoice can be held for more than one reason.</p>` : `<p class="empty">Nothing needs review.</p>`}
        </div>
      </section>
      <section class="card" aria-labelledby="h-recent">
        <div class="card-head"><h2 id="h-recent">What happened recently</h2><a href="#/audit">Audit trail</a></div>
        <div class="card-body">
          ${recent.length ? activityList(recent, true) : `<div class="empty-state small"><p>No one has acted yet in this browser.</p>
            <p class="hint">${can("resolve") ? "Open an invoice that needs review and choose Resolve hold." : can("approve") ? "Open a bill waiting for sign-off and choose Review approval." : "Sign in as Avery, Jordan or Sam to try the actions."}</p></div>`}
        </div>
      </section>
    </div>`;
}

/** Invoice table used by the dashboard, run detail and invoice list. Rows open the invoice. */
function docTable(rows, opt = {}) {
  if (!rows.length) return `<p class="empty">No invoices match these filters.</p>`;
  const sortable = !!opt.sort;
  const th = (key, label, cls = "") => {
    if (!sortable) return `<th class="${cls}" scope="col">${label}</th>`;
    const active = opt.sort.key === key;
    const dir = active ? opt.sort.dir : "";
    return `<th class="${cls}" scope="col" ${active ? `aria-sort="${dir === "asc" ? "ascending" : "descending"}"` : ""}><button class="sort" data-sort="${key}">${label}${active ? (dir === "asc" ? " ↑" : " ↓") : ""}</button></th>`;
  };
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return `<div class="table-wrap"><table class="data docs${sortable ? " sortable" : ""}">
    <thead><tr>
      ${th("vendor", "Vendor and invoice")}
      ${th("date", "Bill date", "hide-sm")}
      ${opt.route ? `<th scope="col">Why it needs review</th>` : th("status", "Status")}
      ${th("amount", "Amount", "num")}
    </tr></thead>
    <tbody>${rows.map((d) => {
      const href = `#/invoices/${encodeURIComponent(d.id)}${opt.run ? `?run=${encodeURIComponent(opt.run)}` : ""}`;
      const routes = routesFor(d.codes, d.id);
      return `<tr data-href="${esc(href)}">
        <td><a class="main-link" href="${esc(href)}">${esc(d.vendor)}</a><span class="sub">${esc(d.billNo || "No invoice number")} · ${esc(d.id)}</span></td>
        <td class="hide-sm">${esc(fmtDate(d.date))}</td>
        ${opt.route
          ? `<td><span class="reason-plain">${esc((CODES[d.primary] || CODES.OTHER).plain)}</span>${d.codes.length > 1 ? `<span class="sub">and ${plural(d.codes.length - 1, "more reason")}</span>` : ""}<span class="sub">Next: ${esc(routes.join("; "))}</span><div class="chips" style="margin-top:4px">${d.codes.map(codeChip).join("")}${blockerChip(d)}${manualChip(d)}</div>${opt.urgent ? urgencyTags(d) : ""}${opt.suggest ? inlineSuggestion(d) : ""}</td>`
          : `<td>${badge(d.status)}${opt.run ? "" : approvalChip(d)}${d.replacedBy && d.status === "REPLACED" ? `<span class="sub">by ${esc(d.replacedBy.doc)}</span>` :
              d.codes.length && d.status !== "DUP" ? `<div class="chips" style="margin-top:6px">${d.codes.map(codeChip).join("")}</div>` : ""}</td>`}
        <td class="num">${!d.amount && !(d.ex && d.ex.total) ? `<span class="hint">Not read</span>` : esc(money(d.amount))}</td>
      </tr>`;
    }).join("")}</tbody>
    ${opt.footer ? `<tfoot><tr class="tfoot"><td>${plural((opt.all || rows).length, "invoice")}</td><td class="hide-sm"></td><td></td><td class="num">${esc(amountLabel(opt.all || rows))}</td></tr></tfoot>` : ""}
  </table></div>`;
}

// ------------------------------------------------------------------ runs
function runStats(res) {
  const c = (f) => res.filter(f).length;
  return {
    entered: c((r) => r.decision.startsWith("ENTER_")), held: c((r) => r.decision === "HOLD"),
    dup: c((r) => r.decision === "DUP"), skip: c((r) => r.decision === "SKIP_ALREADY_ENTERED"),
    enteredAmt: res.filter((r) => r.decision.startsWith("ENTER_")).reduce((a, r) => a + r._amount, 0),
  };
}
function viewRuns() {
  return `
    ${head("Run history", "Each run reads one batch of invoices and writes files for a person to review. Running the same batch again is safe: documents already processed are skipped, never written to an import file twice.")}
    <div class="run-cards">${D.runs.map((r) => {
      const res = X.byRun[r.id] || [];
      const s = runStats(res);
      const firstRun = D.runs.find((o) => o.batch === r.batch);
      return `<a class="card run-card" href="#/runs/${esc(r.id)}">
        <div class="run-card-top">
          <div><h2>${esc(r.label)}</h2><div class="muted">${esc(r.started_at ? fmtDateTime(r.started_at) : `Run ${r.order}`)} · ${esc(r.batch)}${r.ran_by ? ` · run by ${esc(r.ran_by.name)}` : ""}</div></div>
          <span class="pill ${r.preflight_failed ? "" : "pill-ok"}">${r.preflight_failed ? "Pre-flight failed" : "Pre-flight passed"}</span>
        </div>
        ${stackbar(res)}
        <div class="run-stats">
          <div><b>${s.entered}</b><span>Ready to import</span></div>
          <div><b>${s.held}</b><span>Needs review</span></div>
          <div><b>${s.dup}</b><span>Duplicates</span></div>
          <div><b>${s.skip}</b><span>Skipped</span></div>
        </div>
        ${r.dry_run ? `<p class="run-note" style="color:var(--text-3)">Dry run: files were written for review; the register was not changed.</p>` : ""}
        ${r.rerun ? `<p class="run-note">${ICON.check}<span>Same ${plural(res.length, "file")} as ${esc(firstRun && firstRun.id !== r.id ? firstRun.label : "the first run")}. Nothing was written to an import file twice.</span></p>`
                  : `<p class="run-note" style="color:var(--text-3)">${esc(money(s.enteredAmt))} written to import files from ${plural(res.length, "document")}.</p>`}
      </a>`;
    }).join("")}</div>
    <div style="margin-top:16px">${legend()}</div>`;
}

function viewRun(id, q) {
  const r = X.runById[id];
  if (!r) return notFound("That run");
  const res = X.byRun[id] || [];
  const s = runStats(res);
  const group = STATUS_GROUPS.find((g) => g.key === q.get("status"));
  const rows = res.filter((x) => !group || group.match(x.decision)).map((x) => {
    const d = X.docById[x.doc_id];
    return { ...d, status: x.decision, codes: x.codes, amount: x._amount, billNo: x.bill_no || d.billNo, vendor: x.vendor_name || d.vendor, date: x.bill_date || d.date };
  });
  const pg = paged(rows, q);
  listIds = rows.map((d) => d.id);
  const seg = [{ key: "", label: "All", n: res.length }, ...STATUS_GROUPS.map((g) => ({ key: g.key, label: g.label, n: res.filter((x) => g.match(x.decision)).length }))]
    .filter((g) => g.n || !g.key);
  return `
    ${head(esc(r.label), `${esc(r.started_at ? fmtDateTime(r.started_at) + " · " : "")}Batch folder <code>${esc(r.batch)}</code> · run ID <code>${esc(r.id)}</code>${r.penny_version ? ` · decided by Penny ${esc(r.penny_version)}` : ""}`,
      `<span class="pill ${r.preflight_failed ? "" : "pill-ok"}">${r.preflight_failed ? "Pre-flight failed" : "Intacct pre-flight passed"}</span>`,
      `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/runs">Run history</a><span aria-hidden="true">/</span><span>${esc(r.label)}</span></nav>`)}
    <section class="grid kpis" aria-label="Run totals">
      ${kpi("dot-ok", "Ready to import", s.entered, `${money(s.enteredAmt)} in this run's files`)}
      ${kpi("dot-hold", "Needs review", s.held, "held for a person in this run")}
      ${kpi("dot-dup", "Duplicates", s.dup, "stopped before any file")}
      ${kpi("dot-skip", "Skipped", s.skip, "already processed earlier")}
    </section>
    <section class="card">
      <div class="filters">
        <div class="segmented" role="group" aria-label="Filter by result">${seg.map((g) =>
          `<button data-status="${g.key}" aria-pressed="${(q.get("status") || "") === g.key}">${esc(g.label)}<span class="count">${g.n}</span></button>`).join("")}</div>
      </div>
      ${docTable(pg.slice, { run: id, footer: true, all: rows })}
      ${pagerHtml(pg, "documents")}
    </section>`;
}

// ------------------------------------------------------------------ invoices list
const SORTS = {
  vendor: (a, b) => a.vendor.localeCompare(b.vendor) || a.id.localeCompare(b.id),
  date: (a, b) => (a.date || "").localeCompare(b.date || "") || a.id.localeCompare(b.id),
  amount: (a, b) => a.amount - b.amount,
  status: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.id.localeCompare(b.id),
};
function filterDocs(q) {
  const text = (q.get("q") || "").trim().toLowerCase();
  const group = STATUS_GROUPS.find((g) => g.key === q.get("status"));
  const code = q.get("code"), cat = q.get("category"), vendor = q.get("vendor"), from = q.get("from"), to = q.get("to");
  let rows = X.docs.filter((d) =>
    (!text || text.split(/\s+/).every((t) => d.hay.includes(t.replace(/[$,]/g, "")) || d.hay.includes(t))) &&
    (!group || group.match(d.status)) && (!code || d.codes.includes(code)) && (!cat || d.category === cat) &&
    (!vendor || d.vendor === vendor) && (!from || d.date >= from) && (!to || d.date <= to));
  const key = SORTS[q.get("sort")] ? q.get("sort") : "date";
  const dir = q.get("dir") === "asc" ? "asc" : q.get("dir") === "desc" ? "desc" : key === "vendor" ? "asc" : "desc";
  rows.sort(SORTS[key]);
  if (dir === "desc") rows.reverse();
  return { rows, sort: { key, dir } };
}
function viewInvoices(q) {
  const opts = (vals, cur, label) => `<option value="">${label}</option>` + vals.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`).join("");
  const vendors = [...new Set(X.docs.map((d) => d.vendor))].sort();
  const codes = Object.keys(CODES).filter((c) => X.docs.some((d) => d.codes.includes(c)));
  const cats = [...new Set(X.docs.map((d) => d.category).filter(Boolean))];
  const dates = X.docs.map((d) => d.date).filter(Boolean).sort();
  return `
    ${head("Invoices", `Every document Penny has read, with its latest result. Filter by result, reason, vendor or bill date.`)}
    <section class="card">
      <form class="filters" id="inv-filters" data-stay>
        <div class="field field-grow"><label for="f-q">Search</label><input id="f-q" name="q" type="search" value="${esc(q.get("q") || "")}" placeholder="Vendor, invoice no., PO or amount"></div>
        <button type="button" class="btn filters-toggle" id="f-toggle" aria-expanded="false" aria-controls="inv-filters">Filters</button>
        <div class="field"><label for="f-status">Result</label><select id="f-status" name="status">${opts(STATUS_GROUPS.map((g) => [g.key, g.label]), q.get("status"), "Any result")}</select></div>
        <div class="field"><label for="f-code">Reason</label><select id="f-code" name="code">${opts(codes.map((c) => [c, `${CODES[c].name} (${c})`]), q.get("code"), "Any reason")}</select></div>
        <div class="field"><label for="f-cat">Category</label><select id="f-cat" name="category">${opts(cats.map((c) => [c, CATEGORY[c] || c]), q.get("category"), "Any category")}</select></div>
        <div class="field"><label for="f-vendor">Vendor</label><select id="f-vendor" name="vendor">${opts(vendors.map((v) => [v, v]), q.get("vendor"), "Any vendor")}</select></div>
        <div class="field"><label for="f-from">Bill date from</label><input id="f-from" name="from" type="date" value="${esc(q.get("from") || "")}" min="${esc(dates[0] || "")}" max="${esc(dates[dates.length - 1] || "")}"></div>
        <div class="field"><label for="f-to">to</label><input id="f-to" name="to" type="date" value="${esc(q.get("to") || "")}" min="${esc(dates[0] || "")}" max="${esc(dates[dates.length - 1] || "")}"></div>
        <button type="button" class="btn btn-ghost" id="f-clear">Clear</button>
      </form>
      <div id="inv-results"></div>
    </section>`;
}
function renderInvoiceResults(q) {
  const { rows, sort } = filterDocs(q);
  const active = ["q", "status", "code", "category", "vendor", "from", "to"].filter((k) => q.get(k)).length;
  const pg = paged(rows, q);
  listIds = rows.map((d) => d.id);
  $("#inv-results").innerHTML = `
    <div class="filter-summary" aria-live="polite"><span>${plural(rows.length, "invoice")}${active ? ` match${rows.length === 1 ? "es" : ""} ${plural(active, "filter")}` : ""}</span><span class="num">${esc(amountLabel(rows))} face value</span></div>
    ${docTable(pg.slice, { sort, footer: false })}
    ${pagerHtml(pg, "invoices")}`;
  scrollableTables();          // label the new table now, not a frame later, so cards and screen readers never see it bare
  // Filters and sorting change the list without loading a new page, so keep Previous and Next on an invoice in step.
  try { sessionStorage.setItem("penny.list", JSON.stringify({ ids: listIds, label: "Invoices", href: location.hash || "#/invoices" })); } catch (e) { /* fine */ }
}
function bindInvoices(q) {
  renderInvoiceResults(q);
  const form = $("#inv-filters");
  // On a phone the filters fold away behind one button, so the list starts on the first screen.
  const toggle = $("#f-toggle");
  const paintToggle = () => {
    const n = ["status", "code", "category", "vendor", "from", "to"].filter((k) => q.get(k)).length;
    toggle.textContent = n ? `Filters (${n})` : "Filters";
    toggle.setAttribute("aria-expanded", form.classList.contains("open"));
  };
  if (["status", "code", "category", "vendor", "from", "to"].some((k) => q.get(k))) form.classList.add("open");
  paintToggle();
  toggle.addEventListener("click", () => { form.classList.toggle("open"); paintToggle(); });
  const sync = () => {
    const p = new URLSearchParams();
    new FormData(form).forEach((v, k) => v && p.set(k, v));
    if (q.get("sort")) p.set("sort", q.get("sort"));
    if (q.get("dir")) p.set("dir", q.get("dir"));
    if (q.get("per")) p.set("per", q.get("per"));          // a new filter starts again at page 1, with the same page size
    q = p;
    history.replaceState(null, "", `#/invoices${p.toString() ? "?" + p : ""}`);
    renderInvoiceResults(q);
    paintToggle();
  };
  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  $("#f-clear").addEventListener("click", () => { form.reset(); $$("input", form).forEach((i) => (i.value = "")); $$("select", form).forEach((s) => (s.value = "")); sync(); });
  $("#inv-results").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sort]");
    if (!b) return;
    const key = b.dataset.sort;
    const cur = filterDocs(q).sort;
    q.set("sort", key);
    q.set("dir", cur.key === key && cur.dir === "asc" ? "desc" : cur.key === key ? "asc" : key === "vendor" ? "asc" : "desc");
    q.delete("page");
    history.replaceState(null, "", `#/invoices?${q}`);
    renderInvoiceResults(q);
    const again = $(`#inv-results button[data-sort="${key}"]`);
    if (again) again.focus();
  });
}

// ------------------------------------------------------------------ invoice detail
function viewInvoice(id, q) {
  const d = X.docById[id];
  if (!d) return notFound("That invoice");
  const r = shownResult(d, q);
  const run = X.runById[r.run_id];
  const ex = d.ex;
  const tab = ["checks", "read", "coding", "history"].includes(q.get("tab")) ? q.get("tab") : "checks";
  const isCurrent = r === d.cur;
  const kind = KIND[ex.kind] || "Document";

  return `
    ${recordNav(d.id)}
    <div class="inv-head">
      <div class="inv-title">
        <h1>${esc(d.vendor)}</h1>
        <div class="inv-meta">
          <span>${esc(kind)} <strong>${esc(r.bill_no || ex.invoice_no || "No number")}</strong></span>
          ${r.bill_date || ex.date ? `<span>Dated ${esc(fmtDate(r.bill_date || ex.date))}</span>` : ""}
          ${r.category ? `<span>${esc(CATEGORY[r.category] || r.category)}</span>` : ""}
          ${r.vendor_id ? `<span>Vendor ${esc(r.vendor_id)}</span>` : ""}
          <span>${esc(d.file)}</span>
        </div>
        <div class="status-strip">${badge(isCurrent ? d.status : r.decision, true)}${destTag(r.decision)}${isCurrent ? approvalChip(d) + importChip(d) + blockerChip(d) + manualChip(d) : ""}${confChip(r.confidence)}</div>
      </div>
      <div class="inv-amount"><div class="eyebrow">${cents(r.amount) < 0 ? "Credit" : "Amount"}</div>${!cents(r.amount) && !ex.total
        ? `<div class="big" style="color:var(--text-3);font-size:22px">Not read</div>` : `<div class="big">${esc(money(cents(r.amount)))}</div>`}
        <div class="kpi-sub">${isCurrent ? "Latest result" : "Result"} from ${esc(run.label)}${isCurrent ? "" : ` · <a href="#/invoices/${esc(d.id)}">see latest</a>`}</div></div>
    </div>
    <div class="inv-layout">
      <div class="stack">
        ${isCurrent && d.replacedBy ? replacedCallout(d) : ""}
        ${isCurrent ? humanCallout(d) : ""}
        ${outcomeCallout(r, isCurrent && (d.replacedBy || (S.holds[d.id] || {}).outcome))}
        ${isCurrent ? recheckCard(d) + manualCallout(d) + blockersCard(d) : ""}
        ${isCurrent ? suggestionCard(d) : ""}
        ${isCurrent ? actionsCard(d) : `<section class="card actions"><span class="who">You are looking at an earlier run. <a href="#/invoices/${esc(d.id)}">Open the latest result</a> to take action.</span></section>`}
        <section class="card">
          <div class="tabs" role="tablist" aria-label="Invoice details">
            ${[["checks", "Checks"], ["read", "What Penny read"], ["coding", "Coding and approvals"], ["history", `History and activity (${d.hist.length + EV.filter((e) => e.doc === d.id).length})`]].map(([k, l]) =>
              `<button role="tab" id="tab-${k}" aria-controls="panel" aria-selected="${k === tab}" tabindex="${k === tab ? 0 : -1}" data-tab="${k}">${esc(l)}</button>`).join("")}
          </div>
          <div class="tab-panel" id="panel" role="tabpanel" aria-labelledby="tab-${tab}" tabindex="0">
            ${tabContent(tab, d, r)}
          </div>
        </section>
      </div>
      ${pdfPanel(d)}
    </div>`;
}

function tabContent(tab, d, r) {
  return tab === "checks" ? tabChecks(r) : tab === "read" ? tabRead(d) : tab === "coding" ? tabCoding(r) : tabHistory(d, r);
}
function shownResult(d, q) {
  const runId = q.get("run");
  return (runId && d.hist.find((h) => h.run_id === runId)) || d.cur;
}

/** Back to the list you came from, and previous / next record in that list (keys: K and J). */
function listContext() {
  try { return JSON.parse(sessionStorage.getItem("penny.list") || "null"); } catch (e) { return null; }
}
function recordNav(id) {
  const ctx = listContext();
  const i = ctx ? ctx.ids.indexOf(id) : -1;
  const back = i >= 0 ? `<a href="${esc(ctx.href)}" class="back-link">← Back to ${esc(ctx.label)}</a>` : `<a href="#/invoices" class="back-link">← All invoices</a>`;
  if (i < 0) return `<nav class="record-nav" aria-label="Record navigation">${back}<span class="crumb-id">${esc(id)}</span></nav>`;
  const prev = ctx.ids[i - 1], next = ctx.ids[i + 1];
  return `<nav class="record-nav" aria-label="Record navigation">${back}<span class="crumb-id">${esc(id)}</span>
    <span class="record-step"><span class="hint">${i + 1} of ${ctx.ids.length}</span>
      ${prev ? `<a class="btn btn-sm" href="#/invoices/${esc(prev)}" data-key="prev" aria-keyshortcuts="k">← Previous</a>` : `<span class="btn btn-sm" aria-disabled="true">← Previous</span>`}
      ${next ? `<a class="btn btn-sm btn-accent" href="#/invoices/${esc(next)}" data-key="next" aria-keyshortcuts="j">Next →</a>` : `<span class="btn btn-sm" aria-disabled="true">Next →</span>`}</span></nav>`;
}

function replacedCallout(d) {
  const nd = X.docById[d.replacedBy.doc];
  return `<section class="callout callout-ok" aria-labelledby="closed"><h2 id="closed">This hold is closed</h2>
    <p>A revised invoice, <a href="#/invoices/${esc(nd.id)}">${esc(nd.id)}</a>, passed every check in ${esc(X.runById[d.replacedBy.run].label)} and was written to the import file. This original never was, so it cannot be billed twice. The original hold is shown below for the record.</p></section>`;
}

function outcomeCallout(r, closed) {
  const reasons = (r.reasons || []).map(parseReason);
  if (r.decision === "HOLD" || r.decision === "DUP") {
    const routes = routesFor(r.codes || [], r.doc_id);
    const hold = r.decision === "HOLD";
    const primary = CODES[primaryCode(r.codes || [])] || CODES.OTHER;
    const nexts = [...new Set((r.codes || []).map((c) => (CODES[c] || CODES.OTHER).next))];
    return `<section class="callout ${hold ? "callout-hold" : "callout-dup"}" aria-labelledby="why">
      <div class="callout-title">${bIcon(hold ? "alert" : "stop")}<h2 id="why">${hold ? (closed ? "It was held: " : "Needs review: ") : "Stopped as a duplicate: "}${esc(primary.plain.toLowerCase())}</h2></div>
      <div><h3 class="callout-h">What Penny found</h3>
      ${reasons.map((x) => `<div class="reason"><p>${x.code && x.code !== primaryCode(r.codes || []) ? `<strong>${esc((CODES[x.code] || {}).plain || x.code)}.</strong> ` : ""}${esc(x.text)}</p>${x.code ? codeChip(x.code) : ""}</div>`).join("")}</div>
      ${closed ? "" : `<div><h3 class="callout-h">What to do next</h3><ul class="notes">${nexts.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`}
      ${routes.length ? `<div class="route"><span>Goes to</span><strong>${esc(routes.join("; "))}</strong></div>` : ""}
      ${hold && !closed ? `<p class="hint">Nothing from this document is in an import file. When the issue is fixed, Penny reads it again from scratch on the next run.</p>` : ""}
    </section>`;
  }
  if (r.decision === "SKIP_ALREADY_ENTERED") {
    return `<section class="callout callout-skip"><div class="callout-title">${bIcon("minus")}<h2>Skipped: this exact file was already processed</h2></div><p>${esc((r.info || []).join(" ") || "This exact file was processed in an earlier run, so nothing was done.")}</p></section>`;
  }
  const entrata = r.decision === "ENTER_ENTRATA";
  return `<section class="callout callout-ok"><div class="callout-title">${bIcon("check")}<h2>${entrata ? "Added to the Entrata handoff" : "Added to the Intacct import file"}</h2></div>
    <p>Every check passed${(r.lines || []).length ? `, and Penny wrote ${plural(r.lines.length, "line")} to the import file` : ""}${(r.entrata_rows || []).length ? `, and Penny wrote ${plural(r.entrata_rows.length, "row")} to the handoff list` : ""}.
    ${entrata ? "Property Accounting posts it in Entrata; it is not posted yet." : "A person still uploads that file to Sage Intacct, so this bill is not posted or paid yet."}</p>
    ${(r.info || []).length ? `<div><h3 class="callout-h">Notes for a person to check</h3><ul class="notes">${r.info.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : ""}
  </section>`;
}

/** What a person did about this invoice, shown above Penny's own reasons. */
function humanCallout(d) {
  const h = S.holds[d.id];
  if (d.pennyStatus === "HOLD" && h && h.outcome) {
    const cleared = h.outcome === "cleared";
    return `<section class="callout ${cleared ? "callout-ok" : "callout-hold"}" aria-labelledby="human">
      <div class="callout-title">${bIcon(cleared ? "redo" : "x")}<h2 id="human">${cleared ? "Cleared for the next run" : "Rejected and returned to the vendor"}</h2></div>
      <p>${esc(h.by.name)} (${esc(ROLES[h.by.role].name)}) ${cleared ? "cleared this hold" : "rejected this invoice"} on ${esc(fmtDateTime(h.at))}.</p>
      <div class="activity"><p class="a-note">${esc(h.note)}</p></div>
      <p class="hint">${cleared ? "Penny still decides: the next run reads the corrected document from scratch and writes it to an import file only if every check passes." : "Nothing goes into an import file. The vendor needs to send a corrected document."}</p>
    </section>`;
  }
  return "";
}

/** The buttons a signed-in person can use here. Hidden when the role cannot use them, and checked again on save. */
function actionsCard(d) {
  const btns = [];
  if (d.pennyStatus === "HOLD") {
    if ((S.holds[d.id] || {}).outcome) {
      if (can("resolve")) btns.push(`<button class="btn" data-act="reopen" data-doc="${esc(d.id)}">Reopen hold</button>`);
    } else if (can("resolve")) {
      btns.push(`<button class="btn btn-accent" data-act="resolve" data-doc="${esc(d.id)}">Resolve hold</button>`,
                `<button class="btn" data-act="recheck" data-doc="${esc(d.id)}">Recheck</button>`,
                `<button class="btn" data-act="reassign" data-doc="${esc(d.id)}">Reassign</button>`);
      if (canKey(d)) btns.push(`<a class="btn" href="#/invoices/${esc(d.id)}/manual">Enter by hand</a>`);
    }
  }
  const a = approvalSummary(d);
  if (a && can("approve") && a.steps.some((st) => st.status !== "approved")) {
    btns.push(`<button class="btn btn-accent" data-act="approve" data-doc="${esc(d.id)}">Review approval</button>`);
  }
  if (a && can("email") && a.state === "waiting") btns.push(`<button class="btn" data-act="email-approval" data-doc="${esc(d.id)}">Email for approval</button>`);
  if (can("note")) btns.push(`<button class="btn" data-act="note" data-doc="${esc(d.id)}">Add a note</button>`);
  const lock = ICON.lock.replace("<svg", '<svg style="width:15px;height:15px;vertical-align:-3px;margin-right:6px"');
  return `<section class="card actions" aria-label="Actions">
    <span class="who">${lock}Signed in as ${esc(user.name)}, ${esc(article(ROLES[user.role].name))}. You ${esc(ROLES[user.role].blurb)}</span>
    ${btns.join("")}
  </section>`;
}
