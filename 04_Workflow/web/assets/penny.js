/* Penny web view (phase 1: view only).
   Reads data/penny-data.json, written by `./penny web-export`. It displays what Penny already decided and never
   decides anything itself. Roles are wired in now so phase 2 can turn on editing without a rebuild. */
(() => {
  "use strict";

  // ------------------------------------------------------------------ vocabulary
  const STATUS = {
    ENTER_INTACCT: { label: "Entered in Intacct", short: "Entered", cls: "b-ok" },
    ENTER_ENTRATA: { label: "Sent to Entrata", short: "Entered", cls: "b-ok" },
    HOLD: { label: "On hold", short: "On hold", cls: "b-hold" },
    DUP: { label: "Duplicate", short: "Duplicate", cls: "b-dup" },
    SKIP_ALREADY_ENTERED: { label: "Already entered", short: "Already entered", cls: "b-skip" },
    REPLACED: { label: "Replaced", short: "Replaced", cls: "b-skip" },
  };
  const STATUS_ORDER = ["ENTER_INTACCT", "ENTER_ENTRATA", "HOLD", "DUP", "SKIP_ALREADY_ENTERED", "REPLACED"];
  const STATUS_GROUPS = [
    { key: "entered", label: "Entered", match: (s) => s === "ENTER_INTACCT" || s === "ENTER_ENTRATA" },
    { key: "hold", label: "On hold", match: (s) => s === "HOLD" },
    { key: "dup", label: "Duplicate", match: (s) => s === "DUP" },
    { key: "skip", label: "Already entered", match: (s) => s === "SKIP_ALREADY_ENTERED" },
    { key: "replaced", label: "Replaced", match: (s) => s === "REPLACED" },
  ];
  const CODES = {
    BANKCHG: { name: "Bank change", help: "Payment instructions changed. Treasury confirms by phone." },
    NEWVEND: { name: "New vendor", help: "The vendor is not in the vendor master." },
    DUP: { name: "Duplicate", help: "This bill was already entered." },
    UNAPPCO: { name: "Unapproved change order", help: "A pay application bills a change order that is not executed." },
    COI: { name: "Insurance certificate", help: "The certificate of insurance is missing or expired." },
    LIEN: { name: "Lien waiver", help: "The lien waiver is missing or does not match." },
    NOPO: { name: "No PO", help: "No valid purchase order or subcontract." },
    OVERPO: { name: "Over PO", help: "The bill goes over the PO balance plus tolerance." },
    OTHER: { name: "Other", help: "Any other reason a person needs to look." },
  };
  const KIND = { invoice: "Invoice", pay_app: "Pay application", credit_memo: "Credit memo", other: "Other document", unreadable: "Unreadable file" };
  const CATEGORY = { construction: "Construction", stabilized: "Stabilized community", corporate: "Corporate" };
  const ROLES = {
    viewer: { name: "Viewer", can: [], blurb: "can see everything and change nothing." },
    clerk: { name: "AP Clerk", can: ["resolve", "note", "upload"], blurb: "can resolve holds, add notes and run new batches." },
    approver: { name: "Approver", can: ["approve", "note"], blurb: "can approve entered bills and add notes." },
    admin: { name: "Admin", can: ["resolve", "note", "upload", "approve", "rules", "users"], blurb: "can do everything, including changing rules and managing people." },
  };

  // ------------------------------------------------------------------ helpers
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  const article = (w) => `${/^[AEIOU]/i.test(w) ? "an" : "a"} ${w}`;

  /** Money arrives as decimal strings ("15102.07"). Work in whole cents so totals never drift. */
  function cents(v) {
    if (v === null || v === undefined || v === "") return 0;
    const s = String(v).trim();
    const neg = s.startsWith("-") || s.startsWith("(");
    const [whole, frac = ""] = s.replace(/[^0-9.]/g, "").split(".");
    const c = parseInt(whole || "0", 10) * 100 + parseInt((frac + "00").slice(0, 2), 10);
    return neg ? -c : c;
  }
  const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const USD0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const money = (c) => USD.format(c / 100);
  const moneyShort = (c) => (Math.abs(c) >= 1000000 ? USD0.format(c / 100) : USD.format(c / 100));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : "";
  }
  function fmtDateTime(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  const badge = (status, big) => {
    const s = STATUS[status] || { label: status, cls: "b-skip" };
    return `<span class="badge ${s.cls}${big ? " badge-lg" : ""}">${esc(s.label)}</span>`;
  };
  const codeChip = (c) => `<span class="chip chip-code" title="${esc((CODES[c] || {}).name || c)}">${esc(c)}</span>`;
  const ICON = {
    check: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M6.8 10.2l2.2 2.2 4.2-4.6"/></svg>',
    x: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M7.5 7.5l5 5M12.5 7.5l-5 5"/></svg>',
    shield: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5l6 2.2v4.6c0 3.9-2.6 6.7-6 8.2-3.4-1.5-6-4.3-6-8.2V4.7z"/><path d="M7.2 10l2 2 3.6-4"/></svg>',
    doc: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h7l3 3v12H5z"/><path d="M12 2.5v3h3M8 10h4M8 13h4"/></svg>',
    ext: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 3h6v6M17 3l-8 8M14 12v4H4V6h4"/></svg>',
    lock: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg>',
  };

  function parseReason(r) {
    const m = /^\[([A-Z]+)\]\s*(.*)$/s.exec(r || "");
    return m ? { code: m[1], text: m[2] } : { code: "", text: r };
  }
  function parseTrail(t) {
    const m = /^(PASS|FAIL)\s+(?:\[([A-Z]+)\]\s*)?(.*)$/s.exec(t || "");
    return m ? { ok: m[1] === "PASS", code: m[2] || "", text: m[3] } : { ok: true, code: "", text: t };
  }

  // ------------------------------------------------------------------ data
  let D = null; // raw export
  let X = null; // indexes

  function primaryCode(codes) {
    const pr = (D.rules && D.rules.code_priority) || [];
    return pr.find((c) => codes.includes(c)) || codes[0] || "";
  }
  function routesFor(codes) {
    const pr = (D.rules && D.rules.code_priority) || [];
    const routes = (D.rules && D.rules.routes) || {};
    const out = [];
    const rank = (c) => (pr.includes(c) ? pr.indexOf(c) : 99);
    [...codes].sort((a, b) => rank(a) - rank(b)).forEach((c) => {
      if (routes[c] && !out.includes(routes[c])) out.push(routes[c]);
    });
    return out;
  }

  function buildIndex(data) {
    const runById = Object.fromEntries(data.runs.map((r) => [r.id, r]));
    const byRun = {}, byDoc = {};
    for (const r of data.results) {
      r._amount = cents(r.amount);
      (byRun[r.run_id] = byRun[r.run_id] || []).push(r);
      (byDoc[r.doc_id] = byDoc[r.doc_id] || []).push(r);
    }
    Object.values(byDoc).forEach((list) => list.sort((a, b) => runById[a.run_id].order - runById[b.run_id].order));
    const docs = Object.values(data.documents).map((doc) => {
      const hist = byDoc[doc.id] || [];
      const cur = [...hist].reverse().find((r) => r.decision !== "SKIP_ALREADY_ENTERED") || hist[hist.length - 1];
      const ex = doc.extracted || {};
      // A held bill is closed out when a later run enters a revised version under the same register key.
      const replacement = cur.decision === "HOLD" && data.results.find((o) => o.decision.startsWith("ENTER_") && o.doc_id !== doc.id &&
        (o.supersedes === cur.key || o.key === cur.key) && runById[o.run_id].order > runById[cur.run_id].order);
      const vendor = cur.vendor_name || ex.vendor_name_raw || "Unknown vendor";
      const refs = Object.values(ex.refs || {}).flat();
      const hay = [doc.id, doc.file, vendor, ex.vendor_name_raw, cur.vendor_id, cur.bill_no, ex.invoice_no, cur.reference_no,
        ex.customer_ref, ...refs, cur.amount, money(cur._amount), cur.project_id].filter(Boolean).join(" ").toLowerCase();
      return {
        id: doc.id, file: doc.file, pdf: doc.pdf, ex, hist, cur, status: replacement ? "REPLACED" : cur.decision, vendor, vendorKnown: !!cur.vendor_name,
        replacedBy: replacement ? { doc: replacement.doc_id, run: replacement.run_id } : null,
        vendorId: cur.vendor_id, billNo: cur.bill_no || ex.invoice_no || "", date: cur.bill_date || ex.date || "",
        amount: cur._amount, codes: cur.codes || [], primary: primaryCode(cur.codes || []), category: cur.category || "",
        kind: ex.kind || "", hay,
      };
    }).sort((a, b) => a.id.localeCompare(b.id));
    return { runById, byRun, byDoc, docs, docById: Object.fromEntries(docs.map((d) => [d.id, d])) };
  }

  // ------------------------------------------------------------------ state: role and theme
  const store = {
    get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: fine */ } },
  };
  let role = store.get("penny.role", "viewer");
  if (!ROLES[role]) role = "viewer";
  const can = (action) => ROLES[role].can.includes(action);

  function toast(msg) {
    let t = $("#toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.setAttribute("role", "status");
      t.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:80;background:var(--text);color:var(--bg);padding:10px 16px;border-radius:8px;font-size:13.5px;box-shadow:var(--shadow-lg);max-width:calc(100vw - 32px);opacity:0;transition:opacity .15s";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.style.opacity = "0"), 2600);
  }

  /** A future action. Shown only to roles that will have it, clearly marked as phase 2. */
  function actionBtn(action, label) {
    if (!can(action)) return "";
    return `<button class="btn" aria-disabled="true" data-phase2="${esc(label)}">${esc(label)} <span class="tag-phase">Phase 2</span></button>`;
  }

  // ------------------------------------------------------------------ shared pieces
  function head(title, lede, right = "", crumbs = "") {
    return `<div class="page-head"><div>${crumbs}<h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ""}</div>${right}</div>`;
  }
  function stackbar(results) {
    const n = results.length || 1;
    const segs = STATUS_ORDER.map((s) => [s, results.filter((r) => r.decision === s).length]).filter(([, c]) => c);
    const label = segs.map(([s, c]) => `${c} ${STATUS[s].label.toLowerCase()}`).join(", ");
    return `<div class="stackbar" role="img" aria-label="${esc(label)}">${segs.map(([s, c]) =>
      `<span class="s-${s}" style="width:${(c / n) * 100}%" title="${esc(`${STATUS[s].label}: ${c}`)}"></span>`).join("")}</div>`;
  }
  const legend = () => `<div class="legend">${STATUS_ORDER.filter((s) => s !== "REPLACED").map((s) =>
    `<span><i class="s-${s}"></i>${esc(STATUS[s].label)}</span>`).join("")}</div>`;

  function enteredTwiceCount() {
    const seen = {};
    D.results.filter((r) => r.decision.startsWith("ENTER_")).forEach((r) => {
      const k = `${r.vendor_id}|${r.bill_no}`;
      (seen[k] = seen[k] || new Set()).add(r.run_id);
    });
    return Object.values(seen).filter((s) => s.size > 1).length;
  }

  // ------------------------------------------------------------------ dashboard
  function viewDashboard() {
    const docs = X.docs;
    const sum = (list) => list.reduce((a, d) => a + d.amount, 0);
    const entered = docs.filter((d) => d.status.startsWith("ENTER_"));
    const held = docs.filter((d) => d.status === "HOLD");
    const dups = docs.filter((d) => d.status === "DUP");
    const replaced = docs.filter((d) => d.status === "REPLACED");
    const batches = new Set(D.runs.map((r) => r.batch)).size;
    const twice = enteredTwiceCount();
    const skipped = D.results.filter((r) => r.decision === "SKIP_ALREADY_ENTERED").length;

    const codeCounts = {};
    held.forEach((d) => d.codes.forEach((c) => (codeCounts[c] = (codeCounts[c] || 0) + 1)));
    const codeRows = Object.entries(codeCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const maxCode = Math.max(1, ...codeRows.map(([, n]) => n));

    const attention = [...held].sort((a, b) => b.amount - a.amount);

    return `
      ${head("Dashboard", `Penny read ${plural(docs.length, "vendor document")} across ${plural(batches, "batch", "batches")} and ${plural(D.runs.length, "run")}. Here is where every dollar landed.`)}
      <section class="grid kpis" aria-label="Totals">
        ${kpi("dot-accent", "Documents received", docs.length, `${plural(batches, "batch", "batches")}, ${plural(D.runs.length, "run")}`)}
        ${kpi("dot-ok", "Entered", entered.length, `${money(sum(entered))} ready to pay`)}
        ${kpi("dot-hold", "On hold", held.length, `${money(sum(held))} waiting on a person`)}
        ${kpi("dot-dup", "Duplicates stopped", dups.length, `${money(sum(dups))} not paid twice`)}
      </section>
      <div class="proof" role="note">
        ${ICON.shield}
        <p><strong>${twice === 0 ? "Rerun safe." : "Check needed."}</strong> ${plural(twice, "bill")} entered twice across ${plural(D.runs.length, "run")}.
        Running the same batch again skipped ${plural(skipped, "bill")} that ${skipped === 1 ? "was" : "were"} already entered.${replaced.length
          ? ` ${plural(replaced.length, "earlier hold")} closed out when a revised invoice was entered.` : ""}</p>
      </div>
      <div class="grid two">
        <section class="card" aria-labelledby="h-why">
          <div class="card-head"><h2 id="h-why">Why invoices are on hold</h2><p>${plural(held.length, "invoice")}, some with more than one reason</p></div>
          <div class="card-body">
            ${codeRows.length ? `<ul class="hbars">${codeRows.map(([c, n]) => `
              <li class="hbar">
                <span class="hbar-label">${esc((CODES[c] || {}).name || c)}<small>${esc(c)}</small></span>
                <span class="hbar-track" aria-hidden="true"><span class="hbar-fill" style="display:block;width:${(n / maxCode) * 100}%"></span></span>
                <span class="hbar-n">${n}</span>
              </li>`).join("")}</ul>` : `<p class="empty">Nothing is on hold.</p>`}
          </div>
        </section>
        <section class="card" aria-labelledby="h-runs">
          <div class="card-head"><h2 id="h-runs">Results by run</h2><a href="#/runs">All runs</a></div>
          <div class="card-body">
            <div class="run-rows">${D.runs.map((r) => {
              const res = X.byRun[r.id] || [];
              return `<div class="run-row"><span><a href="#/runs/${esc(r.id)}">${esc(r.label)}</a><small>${esc(r.rerun ? "Same files again" : r.batch)}</small></span>${stackbar(res)}<span class="hbar-n">${res.length}</span></div>`;
            }).join("")}</div>
            ${legend()}
          </div>
        </section>
      </div>
      <section class="card" style="margin-top:16px" aria-labelledby="h-att">
        <div class="card-head"><h2 id="h-att">Needs a person</h2><a href="#/invoices?status=hold">See all holds</a></div>
        <div class="card-body" style="padding:12px 0 0">
          ${attention.length ? docTable(attention, { route: true }) : `<p class="empty">Nothing needs a person right now.</p>`}
        </div>
      </section>`;
  }
  const kpi = (dot, label, value, sub) =>
    `<div class="card kpi"><div class="kpi-label"><span class="dot ${dot}"></span>${esc(label)}</div><div class="kpi-value">${esc(value)}</div><div class="kpi-sub">${esc(sub)}</div></div>`;

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
    return `<div class="table-wrap"><table class="data">
      <thead><tr>
        ${th("vendor", "Vendor and invoice")}
        ${th("date", "Bill date", "hide-sm")}
        ${opt.route ? `<th scope="col" class="hide-sm">Reason and route</th>` : th("status", "Result")}
        ${th("amount", "Amount", "num")}
      </tr></thead>
      <tbody>${rows.map((d) => {
        const href = `#/invoices/${encodeURIComponent(d.id)}${opt.run ? `?run=${encodeURIComponent(opt.run)}` : ""}`;
        const routes = routesFor(d.codes);
        return `<tr data-href="${esc(href)}">
          <td><a class="main-link" href="${esc(href)}">${esc(d.vendor)}</a><span class="sub">${esc(d.billNo || "No invoice number")} · ${esc(d.id)}</span></td>
          <td class="hide-sm">${esc(fmtDate(d.date))}</td>
          ${opt.route
            ? `<td class="hide-sm"><div class="chips">${d.codes.map(codeChip).join("")}</div><span class="sub">${esc(routes.join("; "))}</span></td>`
            : `<td>${badge(d.status)}${d.replacedBy && d.status === "REPLACED" ? `<span class="sub">by ${esc(d.replacedBy.doc)}</span>` :
                d.codes.length && d.status !== "DUP" ? `<div class="chips" style="margin-top:6px">${d.codes.map(codeChip).join("")}</div>` : ""}</td>`}
          <td class="num">${esc(money(d.amount))}</td>
        </tr>`;
      }).join("")}</tbody>
      ${opt.footer ? `<tfoot><tr class="tfoot"><td>${plural(rows.length, "invoice")}</td><td class="hide-sm"></td><td></td><td class="num">${esc(money(total))}</td></tr></tfoot>` : ""}
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
      ${head("Runs", "Each run reads one batch of invoices. Running the same batch again is safe: bills already entered are skipped, never entered twice.")}
      <div class="run-cards">${D.runs.map((r) => {
        const res = X.byRun[r.id] || [];
        const s = runStats(res);
        const firstRun = D.runs.find((o) => o.batch === r.batch);
        return `<a class="card run-card" href="#/runs/${esc(r.id)}">
          <div class="run-card-top">
            <div><h2>${esc(r.label)}</h2><div class="muted">${esc(r.started_at ? fmtDateTime(r.started_at) : `Run ${r.order}`)} · ${esc(r.batch)}</div></div>
            <span class="pill ${r.preflight_failed ? "" : "pill-ok"}">${r.preflight_failed ? "Pre-flight failed" : "Pre-flight passed"}</span>
          </div>
          ${stackbar(res)}
          <div class="run-stats">
            <div><b>${s.entered}</b><span>Entered</span></div>
            <div><b>${s.held}</b><span>On hold</span></div>
            <div><b>${s.dup}</b><span>Duplicates</span></div>
            <div><b>${s.skip}</b><span>Already entered</span></div>
          </div>
          ${r.rerun ? `<p class="run-note">${ICON.check}<span>Same ${plural(res.length, "file")} as ${esc(firstRun && firstRun.id !== r.id ? firstRun.label : "the first run")}. Nothing was entered twice.</span></p>`
                    : `<p class="run-note" style="color:var(--text-3)">${esc(money(s.enteredAmt))} entered from ${plural(res.length, "document")}.</p>`}
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
    const seg = [{ key: "", label: "All", n: res.length }, ...STATUS_GROUPS.map((g) => ({ key: g.key, label: g.label, n: res.filter((x) => g.match(x.decision)).length }))]
      .filter((g) => g.n || !g.key);
    return `
      ${head(esc(r.label), `${esc(r.started_at ? fmtDateTime(r.started_at) + " · " : "")}Batch folder <code>${esc(r.batch)}</code> · run ID <code>${esc(r.id)}</code>`,
        `<span class="pill ${r.preflight_failed ? "" : "pill-ok"}">${r.preflight_failed ? "Pre-flight failed" : "Intacct pre-flight passed"}</span>`,
        `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/runs">Runs</a><span aria-hidden="true">/</span><span>${esc(r.label)}</span></nav>`)}
      <section class="grid kpis" aria-label="Run totals">
        ${kpi("dot-ok", "Entered", s.entered, money(s.enteredAmt))}
        ${kpi("dot-hold", "On hold", s.held, "waiting on a person")}
        ${kpi("dot-dup", "Duplicates", s.dup, "stopped before entry")}
        ${kpi("dot-skip", "Already entered", s.skip, "skipped on rerun")}
      </section>
      <section class="card">
        <div class="filters">
          <div class="segmented" role="group" aria-label="Filter by result">${seg.map((g) =>
            `<button data-status="${g.key}" aria-pressed="${(q.get("status") || "") === g.key}">${esc(g.label)}<span class="count">${g.n}</span></button>`).join("")}</div>
        </div>
        ${docTable(rows, { run: id, footer: true })}
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
        <form class="filters" id="inv-filters" onsubmit="return false">
          <div class="field field-grow"><label for="f-q">Search</label><input id="f-q" name="q" type="search" value="${esc(q.get("q") || "")}" placeholder="Vendor, invoice no., PO or amount"></div>
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
    $("#inv-results").innerHTML = `
      <div class="filter-summary" aria-live="polite"><span>${plural(rows.length, "invoice")}${active ? ` match${rows.length === 1 ? "es" : ""} ${plural(active, "filter")}` : ""}</span><span class="num">${esc(money(rows.reduce((a, d) => a + d.amount, 0)))} face value</span></div>
      ${docTable(rows, { sort, footer: false })}`;
  }
  function bindInvoices(q) {
    renderInvoiceResults(q);
    const form = $("#inv-filters");
    const sync = () => {
      const p = new URLSearchParams();
      new FormData(form).forEach((v, k) => v && p.set(k, v));
      if (q.get("sort")) p.set("sort", q.get("sort"));
      if (q.get("dir")) p.set("dir", q.get("dir"));
      q = p;
      history.replaceState(null, "", `#/invoices${p.toString() ? "?" + p : ""}`);
      renderInvoiceResults(q);
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
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/invoices">Invoices</a><span aria-hidden="true">/</span><span>${esc(d.id)}</span></nav>
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
          <div class="chips">${badge(isCurrent && d.replacedBy ? "REPLACED" : r.decision, true)}<span class="chip">Confidence: ${esc(r.confidence)}</span></div>
        </div>
        <div class="inv-amount"><div class="eyebrow">${cents(r.amount) < 0 ? "Credit" : "Amount"}</div><div class="big">${esc(money(cents(r.amount)))}</div>
          <div class="kpi-sub">${isCurrent ? "Latest result" : "Result"} from ${esc(run.label)}${isCurrent ? "" : ` · <a href="#/invoices/${esc(d.id)}">see latest</a>`}</div></div>
      </div>
      <div class="inv-layout">
        <div class="stack">
          ${isCurrent && d.replacedBy ? replacedCallout(d) : ""}
          ${outcomeCallout(r, isCurrent && d.replacedBy)}
          ${actionsCard(r)}
          <section class="card">
            <div class="tabs" role="tablist" aria-label="Invoice details">
              ${[["checks", "Checks"], ["read", "What Penny read"], ["coding", "Coding and approvers"], ["history", `History (${d.hist.length})`]].map(([k, l]) =>
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

  function replacedCallout(d) {
    const nd = X.docById[d.replacedBy.doc];
    return `<section class="callout callout-ok" aria-labelledby="closed"><h2 id="closed">This hold is closed</h2>
      <p>A revised invoice, <a href="#/invoices/${esc(nd.id)}">${esc(nd.id)}</a>, was entered in ${esc(X.runById[d.replacedBy.run].label)}. This original was never entered, so nothing was paid twice. The original hold is shown below for the record.</p></section>`;
  }

  function outcomeCallout(r, closed) {
    const reasons = (r.reasons || []).map(parseReason);
    if (r.decision === "HOLD" || r.decision === "DUP") {
      const routes = routesFor(r.codes || []);
      const hold = r.decision === "HOLD";
      return `<section class="callout ${hold ? "callout-hold" : "callout-dup"}" aria-labelledby="why">
        <h2 id="why">${hold ? (closed ? "Why it was held" : "Why it is on hold") : "Why it is a duplicate"}</h2>
        ${reasons.map((x) => `<div class="reason">${x.code ? codeChip(x.code) : "<span></span>"}<p>${esc(x.text)}</p></div>`).join("")}
        ${routes.length ? `<div class="route"><span>Send to</span><strong>${esc(routes.join("; "))}</strong></div>` : ""}
        ${hold && !closed ? `<p style="font-size:13px;color:var(--text-2)">Nothing from this document was written to the import file. When the issue is fixed, the next run reads it again from scratch.</p>` : ""}
      </section>`;
    }
    if (r.decision === "SKIP_ALREADY_ENTERED") {
      return `<section class="callout callout-skip"><h2>Already entered</h2><p>${esc((r.info || []).join(" ") || "This exact file was entered in an earlier run, so nothing was done.")}</p></section>`;
    }
    const where = r.decision === "ENTER_ENTRATA" ? "Sent to Entrata" : "Entered in Sage Intacct";
    return `<section class="callout callout-ok"><h2>${where}</h2>
      <p>Every check passed${(r.lines || []).length ? `, and Penny wrote ${plural(r.lines.length, "line")} to the import file` : ""}${(r.entrata_rows || []).length ? `, and Penny wrote ${plural(r.entrata_rows.length, "row")} to the Entrata handoff` : ""}.</p>
      ${(r.info || []).length ? `<div><h3 style="margin-bottom:6px">Notes for a person to review</h3><ul class="notes">${r.info.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : ""}
    </section>`;
  }

  function actionsCard(r) {
    const btns = [];
    const open = r.decision === "HOLD" && !(X.docById[r.doc_id] || {}).replacedBy;
    if (open) btns.push(actionBtn("resolve", "Resolve hold"), actionBtn("resolve", "Reassign"));
    if (r.decision.startsWith("ENTER_") && (r.approvers || []).length) btns.push(actionBtn("approve", "Approve"));
    btns.push(actionBtn("note", "Add a note"));
    const html = btns.filter(Boolean).join("");
    return `<section class="card actions" aria-label="Actions">
      <span class="who">${ICON.lock.replace("<svg", '<svg style="width:15px;height:15px;vertical-align:-3px;margin-right:6px"')}As ${esc(article(ROLES[role].name))}, you ${esc(ROLES[role].blurb)}</span>
      ${html}
    </section>`;
  }

  function tabChecks(r) {
    const trail = (r.trail || []).map(parseTrail);
    if (!trail.length) return `<p class="empty">No checks recorded for this result.</p>`;
    const fails = trail.filter((t) => !t.ok).length;
    return `<p style="color:var(--text-2);margin-bottom:8px">${plural(trail.length, "check")} ran in order. ${fails ? `${fails} did not pass.` : "All passed."}
      ${r.confidence_basis && r.confidence_basis.length ? `Confidence is ${esc(r.confidence)} because: ${esc(r.confidence_basis.join("; "))}.` : ""}</p>
      <ol class="checks">${trail.map((t) => `<li class="${t.ok ? "pass" : "fail"}">${t.ok ? ICON.check : ICON.x}
        <p><span class="sr-only">${t.ok ? "Passed:" : "Failed:"} </span>${t.code ? `<span class="code">${esc(t.code)}</span>` : ""}${esc(t.text)}</p></li>`).join("")}</ol>`;
  }

  function kvs(pairs) {
    return `<dl class="kv">${pairs.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v, wide]) =>
      `<div${wide ? ' class="wide"' : ""}><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
  }
  function tabRead(d) {
    const ex = d.ex;
    if (!ex || !ex.kind) return `<p class="empty">No extracted data for this document.</p>`;
    if (ex.kind === "unreadable") return `<p>${esc(ex.unreadable_reason)}</p>`;
    const bill = ex.bill_to || {};
    const remit = ex.remit_to || {};
    const out = [];
    out.push(kvs([
      ["Document type", esc(KIND[ex.kind] || ex.kind)],
      ["Invoice number", esc(ex.invoice_no)],
      ["Date", esc(fmtDate(ex.date))],
      ["Printed terms", esc(ex.terms_printed)],
      ["Customer ref", esc(ex.customer_ref)],
      ["Vendor (as printed)", esc(ex.vendor_name_raw)],
      ["Bill to", esc([bill.name, bill.c_o && `c/o ${bill.c_o}`].filter(Boolean).join(", "))],
      ["Ship to", esc(ex.ship_to)],
      ["Remit to", esc([remit.name, remit.address].filter(Boolean).join(", ")), true],
      ["Phone", esc((ex.phones_on_doc || []).join(", "))],
      ["Email", esc((ex.emails_on_doc || []).join(", "))],
      ["Pages", esc(ex.pages)],
      ["Stamps", (ex.stamps || []).length ? `<span class="chips">${ex.stamps.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</span>` : ""],
      ["Revised invoice", ex.revised ? esc(`Yes${ex.replaces_invoice ? `, replaces ${ex.replaces_invoice}` : ""}`) : ""],
      ["Credit for invoice", esc(ex.credit_original_invoice)],
      ["Payment-change wording", (ex.payment_change_hits || []).length ? esc(ex.payment_change_hits.join("; ")) : ""],
    ]));
    if ((ex.lines || []).length) {
      out.push(`<h3 class="sub-h">Lines</h3><div class="table-wrap"><table class="mini"><thead><tr><th scope="col">Description</th><th class="num" scope="col">Qty</th><th class="hide-xs" scope="col">Unit</th><th class="num hide-xs" scope="col">Rate</th><th class="num" scope="col">Amount</th></tr></thead><tbody>
        ${ex.lines.map((l) => `<tr><td>${esc(l.desc)}</td><td class="num">${esc(l.qty ?? "")}</td><td class="hide-xs">${esc(l.unit ?? "")}</td><td class="num hide-xs">${l.rate ? esc(money(cents(l.rate))) : ""}</td><td class="num">${esc(money(cents(l.amount)))}</td></tr>`).join("")}
      </tbody></table></div>`);
      out.push(`<div class="totals">
        ${ex.subtotal ? `<span class="t-label">Subtotal</span><span class="t-val">${esc(money(cents(ex.subtotal)))}</span>` : ""}
        ${ex.tax_total && cents(ex.tax_total) ? `<span class="t-label">${esc(ex.tax_label || "Tax")}</span><span class="t-val">${esc(money(cents(ex.tax_total)))}</span>` : ""}
        <span class="t-label grand">Total</span><span class="t-val grand">${esc(money(cents(ex.total)))}</span></div>`);
    }
    const pa = ex.pay_app;
    if (pa) {
      out.push(`<h3 class="sub-h">Pay application ${esc(pa.app_no ?? "")}</h3>` + kvs([
        ["Period", esc(`${fmtDate(pa.period_start)} to ${fmtDate(pa.period_end)}`)],
        ["Original contract", esc(money(cents(pa.original_contract)))],
        ["Net change orders", esc(money(cents(pa.net_change_cos)))],
        ["Contract to date", esc(money(cents(pa.contract_to_date)))],
        ["Completed to date", esc(money(cents(pa.completed_to_date)))],
        ["Retainage to date", esc(money(cents(pa.retainage_to_date)))],
        ["Previous certificates", esc(money(cents(pa.previous_certificates)))],
        ["This period, gross", esc(money(cents(pa.this_period_gross)))],
        ["This period, retainage", esc(money(cents(pa.this_period_retainage)))],
        ["Current payment due", `<strong>${esc(money(cents(pa.current_due)))}</strong>`],
      ]));
      if ((pa.continuation || []).length) {
        out.push(`<div class="table-wrap" style="margin-top:12px"><table class="mini"><thead><tr><th scope="col">Work this period</th><th class="num" scope="col">Amount</th><th class="num" scope="col">Retainage</th></tr></thead><tbody>
          ${pa.continuation.map((c) => `<tr><td>${esc(c.desc)}</td><td class="num">${esc(money(cents(c.amount)))}</td><td class="num">${esc(money(cents(c.retainage)))}</td></tr>`).join("")}</tbody></table></div>`);
      }
      if ((pa.change_orders_billed || []).length) out.push(`<p style="margin-top:10px;color:var(--text-2)">Change orders billed: ${esc(pa.change_orders_billed.map((c) => (typeof c === "string" ? c : c.number || JSON.stringify(c))).join(", "))}</p>`);
    }
    const lw = ex.lien_waiver;
    if (lw && (lw.attached || lw.promised_later)) {
      out.push(`<h3 class="sub-h">Lien waiver</h3>` + kvs([
        ["Attached", lw.attached ? "Yes" : lw.promised_later ? "No, promised later" : "No"],
        ["Claimant", esc(lw.claimant)],
        ["Amount", lw.amount ? esc(money(cents(lw.amount))) : ""],
        ["Through", esc(fmtDate(lw.through_date))],
        ["Signature line", lw.signature_line_blank ? "Appears blank in the text" : "Signed"],
      ]));
    }
    const w = (ex.extraction || {}).warnings || [];
    out.push(`<p style="margin-top:16px;font-size:13px;color:var(--text-3)">Read by the ${esc((ex.extraction || {}).method === "rules" ? "rules parser (no AI, same answer every run)" : (ex.extraction || {}).method || "parser")}.${w.length ? " Warnings: " + esc(w.join("; ")) : ""}</p>`);
    return out.join("");
  }

  function tabCoding(r) {
    const out = [];
    const lines = r.lines || [], erows = r.entrata_rows || [];
    if (lines.length) {
      const h = lines[0];
      out.push(kvs([["GL posting date", esc(fmtDate(h.GL_POSTING_DATE))], ["Due date", esc(fmtDate(h.DUE_DATE))], ["Terms", esc(h.TERM_NAME)],
        ["Reference", esc(h.REFERENCE_NO)], ["Description", esc(h.DESCRIPTION), true]]));
      out.push(`<h3 class="sub-h">Sage Intacct import lines</h3><div class="table-wrap"><table class="mini"><thead><tr>
        <th scope="col">#</th><th scope="col">Account</th><th scope="col">Entity</th><th scope="col" class="hide-xs">Project</th><th scope="col" class="hide-xs">Cost code</th><th scope="col">Memo</th><th class="num" scope="col">Amount</th></tr></thead><tbody>
        ${lines.map((l) => `<tr><td>${esc(l.LINE_NO)}</td><td><code>${esc(l.ACCT_NO)}</code></td><td>${esc(l.LOCATION_ID)}${l.DEPARTMENT_ID ? ` · ${esc(l.DEPARTMENT_ID)}` : ""}</td><td class="hide-xs">${esc(l.PROJECT_ID || "")}</td><td class="hide-xs">${esc([l.TASK_ID, l.COST_TYPE_ID].filter(Boolean).join(" · "))}</td><td>${esc(l.LINE_MEMO)}</td><td class="num">${esc(money(cents(l.AMOUNT)))}</td></tr>`).join("")}
      </tbody><tfoot><tr class="tfoot"><td colspan="3">Bill total</td><td class="hide-xs"></td><td class="hide-xs"></td><td></td><td class="num">${esc(money(lines.reduce((a, l) => a + cents(l.AMOUNT), 0)))}</td></tr></tfoot></table></div>`);
    }
    if (erows.length) {
      out.push(`<h3 class="sub-h" style="margin-top:0">Entrata handoff</h3><div class="table-wrap"><table class="mini"><thead><tr><th scope="col">Property</th><th scope="col">GL</th><th scope="col">Description</th><th scope="col" class="hide-xs">Post month</th><th class="num" scope="col">Amount</th></tr></thead><tbody>
        ${erows.map((e) => `<tr><td>${esc(e.Property)}</td><td><code>${esc(e["Entrata GL"])}</code></td><td>${esc(e.Description)}</td><td class="hide-xs">${esc(e["Post Month"])}</td><td class="num">${esc(money(cents(e.Amount)))}</td></tr>`).join("")}
      </tbody></table></div>`);
    }
    if (!lines.length && !erows.length) {
      out.push(`<p class="empty">${r.decision === "HOLD" ? "Held documents are not coded. Nothing is written to an import file until the hold is cleared." :
        r.decision === "DUP" ? "Duplicates are never coded or entered." : "This run did not enter the bill again. See the run where it was first entered in History."}</p>`);
    }
    const approvers = r.approvers || (erows[0] && erows[0].Approver ? [erows[0].Approver] : []);
    const ap = approvers.length ? approvers : erows.map((e) => e.Approver).filter(Boolean);
    if (ap.length) out.push(`<h3 class="sub-h">Required approvers</h3><ul class="notes">${[...new Set(ap)].map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`);
    return out.join("");
  }

  function tabHistory(d, shown) {
    return `<p style="color:var(--text-2);margin-bottom:14px">Every run that read <strong>${esc(d.file)}</strong>, oldest first.</p>
      <ol class="timeline">${d.hist.map((h) => {
        const run = X.runById[h.run_id];
        const why = (h.reasons || []).map(parseReason)[0];
        const note = why ? why.text : (h.info || [])[0] || (h.decision.startsWith("ENTER_") ? "All checks passed." : "");
        return `<li class="${h === shown ? "current" : ""}"><div class="t-row"><a href="#/invoices/${esc(d.id)}?run=${esc(h.run_id)}">${esc(run.label)}</a>${badge(h.decision)}${h === shown ? '<span class="chip">Showing</span>' : ""}</div>
          ${note ? `<p class="t-note">${esc(note.length > 180 ? note.slice(0, 177) + "…" : note)}</p>` : ""}</li>`;
      }).join("")}</ol>`;
  }

  function pdfPanel(d) {
    if (d.pdf) {
      return `<aside class="card pdf-panel" aria-label="Invoice PDF">
        <div class="pdf-bar"><span>${ICON.doc.replace("<svg", '<svg style="width:16px;height:16px;vertical-align:-3px;margin-right:6px"')}${esc(d.file)}</span>
          <a href="${esc(d.pdf)}" target="_blank" rel="noopener">Open in new tab ${ICON.ext.replace("<svg", '<svg style="width:14px;height:14px;vertical-align:-2px"')}</a></div>
        <iframe class="pdf-frame" src="${esc(d.pdf)}#view=FitH&toolbar=0" title="Invoice ${esc(d.file)}" loading="lazy"></iframe>
      </aside>`;
    }
    return `<aside class="card pdf-panel" aria-label="Invoice PDF"><div class="pdf-missing">${ICON.doc}
      <h2>The PDF is not in this build</h2>
      <p>Everything Penny read from <strong>${esc(d.file)}</strong> is on the left. To show the original here, export with the package folder:</p>
      <code>./penny web-export --package ~/Downloads/Hillpointe_AP_Technical_Screen</code></div></aside>`;
  }

  // ------------------------------------------------------------------ rules
  const THRESHOLDS = {
    overpo_tolerance: ["PO overage tolerance", "How far a bill can go past the PO balance before it is held.", "money"],
    retainage_pct: ["Retainage", "Share of each pay application held back until the work is done.", "pct"],
    retainage_tolerance: ["Retainage rounding tolerance", "Largest rounding difference allowed on retainage.", "money"],
    vp_construction_gross_over: ["VP Construction approval", "Pay applications with gross work over this need the VP.", "money"],
    regional_pm_invoice_over: ["Regional PM approval", "Community invoices over this need the Regional PM.", "money"],
    cfo_bill_over: ["CFO approval", "Any bill over this needs the CFO.", "money"],
    arithmetic_tolerance: ["Arithmetic tolerance", "Largest difference allowed when checking that the numbers tie out.", "money"],
    coi_grace_days: ["Insurance grace period", "Days after a certificate expires before bills are held.", "days"],
  };
  function fmtSetting(v, kind) {
    if (kind === "money") return money(cents(v));
    if (kind === "pct") return `${+(Number(v) * 100).toFixed(2)}%`;
    if (kind === "days") return plural(Number(v), "day");
    return String(v);
  }
  function viewRules() {
    const R = D.rules || {};
    const th = R.thresholds || {};
    const pr = R.code_priority || [];
    const routes = R.routes || {};
    const kw = (pairs) => pairs.map(([pat, gl]) => `<div class="kw-row"><span class="chips">${String(pat).split("|").map((p) => `<span class="chip">${esc(p)}</span>`).join("")}</span><code>${esc(gl)}</code></div>`).join("");
    const words = (list) => `<div class="chips">${(list || []).map((w) => `<span class="chip">${esc(w)}</span>`).join("")}</div>`;
    const corp = R.corporate || {};
    const cons = R.construction || {};
    return `
      ${head("Rules", esc(R._readme || "Every business rule a person might want to change lives in one settings file, not in the code."),
        can("rules") ? `<button class="btn" aria-disabled="true" data-phase2="Edit rules">Edit rules <span class="tag-phase">Phase 2</span></button>` : "")}
      <div class="role-banner" role="note">
        <span>${can("rules")
          ? `<strong>You are an Admin.</strong> In phase 2 you will edit these here, see what a change would do to past batches before saving, and undo any change.`
          : `<strong>Read only.</strong> Only Admins can change rules. Switch the role at the top to see the Admin view.`}</span>
        <span class="pill">Source: config/rules.json</span>
      </div>
      <div class="grid rules-grid">
        <section class="card"><div class="card-head"><h2>Thresholds</h2></div><div class="card-body">
          ${Object.entries(th).map(([k, v]) => {
            const [name, help, kind] = THRESHOLDS[k] || [k.replace(/_/g, " "), "", ""];
            return `<div class="setting"><div><div class="s-name">${esc(name)}</div>${help ? `<div class="s-help">${esc(help)}</div>` : ""}</div><div class="s-val">${esc(fmtSetting(v, kind))}</div></div>`;
          }).join("")}
        </div></section>
        <section class="card"><div class="card-head"><h2>Exception codes and routes</h2><p>Highest priority first</p></div><div class="card-body">
          <ul class="route-list">${pr.map((c, i) => `<li><span class="rank">${i + 1}</span><span>${codeChip(c)}<br><span style="font-size:13px">${esc((CODES[c] || {}).name || "")}</span></span><span>${esc(routes[c] || "")}<br><span class="s-help" style="font-size:12.5px;color:var(--text-3)">${esc((CODES[c] || {}).help || "")}</span></span></li>`).join("")}</ul>
        </div></section>
        <section class="card"><div class="card-head"><h2>Payment change warning words</h2><p>Any of these sends a bill to Treasury</p></div><div class="card-body">${words(R.payment_change_phrases)}</div></section>
        <section class="card"><div class="card-head"><h2>Duplicate stamps</h2><p>Watermarks that suggest a resend</p></div><div class="card-body">${words(R.duplicate_stamps)}</div></section>
        <section class="card"><div class="card-head"><h2>Entrata GL by description</h2><p>Stabilized communities</p></div><div class="card-body">${kw(R.entrata_gl_keywords || [])}</div></section>
        <section class="card"><div class="card-head"><h2>Corporate coding</h2><p>Default entity ${esc(corp.default_entity || "")}</p></div><div class="card-body">
          ${kw(corp.gl_keywords || [])}
          <h3 class="sub-h">One-time services (account ${esc(corp.one_time_acct || "")})</h3>${words(corp.one_time_keywords)}
          <h3 class="sub-h">Subscriptions (split by the allocation table)</h3>${words(corp.subscription_keywords)}
        </div></section>
        <section class="card"><div class="card-head"><h2>Payment terms</h2></div><div class="card-body">
          ${Object.entries(R.terms_days || {}).map(([t, n]) => `<div class="setting"><span class="s-name">${esc(t)}</span><span class="s-val">${esc(plural(n, "day"))}</span></div>`).join("")}
        </div></section>
        <section class="card"><div class="card-head"><h2>Construction posting</h2></div><div class="card-body">
          <div class="setting"><span class="s-name">Posting entity</span><span class="s-val">${esc(cons.posting_entity || "")}</span></div>
          <div class="setting"><span class="s-name">Department</span><span class="s-val">${esc(cons.department || "")}</span></div>
          <div class="setting"><span class="s-name">Retainage account</span><span class="s-val">${esc(cons.retainage_acct || "")}</span></div>
          <div class="setting"><span class="s-name">AI extraction</span><span class="s-val">${R.llm && R.llm.enabled_by_default ? "On" : "Off (rules parser)"}</span></div>
        </div></section>
      </div>`;
  }

  // ------------------------------------------------------------------ about
  function viewAbout() {
    const roleRows = [
      ["Viewer", "See every run, invoice, check and rule.", "Nothing changes. Read-only for auditors and leaders."],
      ["AP Clerk", "Everything a Viewer sees.", "Run new batches, resolve holds with a note, reassign."],
      ["Approver", "Everything a Viewer sees.", "Approve entered bills that need their sign-off."],
      ["Admin", "Everything.", "Change rules with a preview first, manage people and roles."],
    ];
    return `
      ${head("How Penny works", "Penny turns a folder of vendor PDFs into ready-to-import bills, and holds everything else for a person with a clear reason.")}
      <ol class="steps">
        <li class="card"><span class="n">1</span><h3>Read</h3><p>Pull the vendor, invoice number, lines and totals from each PDF. A file that cannot be read is held, never guessed.</p></li>
        <li class="card"><span class="n">2</span><h3>Check</h3><p>Run up to 15 checks in order: math, vendor, bill-to, bank changes, duplicates, PO, insurance, lien waivers and more.</p></li>
        <li class="card"><span class="n">3</span><h3>Decide</h3><p>Enter it, hold it with a code and a route, or stop it as a duplicate. Every reason is written down.</p></li>
        <li class="card"><span class="n">4</span><h3>Remember</h3><p>Keep a register of what was entered, so running a batch again never enters a bill twice.</p></li>
      </ol>
      <div class="grid two" style="margin-top:16px">
        <section class="card card-pad prose"><h2 style="margin-bottom:10px">AI reads. Code decides. People approve.</h2>
          <p>Reading a PDF is the only fuzzy step, so that is the only place AI may help, and it is off by default. Every decision is made by plain, tested rules that give the same answer every time.</p>
          <p>Penny never pays anything and never talks to the accounting system. It writes files for a person to review and upload. Anything unusual goes to the right team with the reason spelled out.</p>
          <p>The same engine powers the terminal and this web view, so they can never disagree.</p>
        </section>
        <section class="card"><div class="card-head"><h2>Who can do what</h2><span class="tag-phase">Editing arrives in phase 2</span></div>
          <div class="card-body" style="padding:12px 0 0"><div class="table-wrap"><table class="mini role-table"><thead><tr><th scope="col">Role</th><th scope="col">Sees</th><th scope="col">Can change</th></tr></thead><tbody>
            ${roleRows.map(([r, s, c]) => `<tr><td>${esc(r)}</td><td>${esc(s)}</td><td>${esc(c)}</td></tr>`).join("")}
          </tbody></table></div></div>
        </section>
      </div>
      <section class="card card-pad prose" style="margin-top:16px" aria-labelledby="h-origin">
        <h2 id="h-origin" style="margin-bottom:10px">Where Penny came from</h2>
        <p>Penny began as my answer to an accounts payable technical screen. The assignment asked for an Intacct import file, an Entrata handoff, an exception log, the required approvers, and proof that a rerun is safe. That version was submitted in October 2026 and is kept exactly as it was handed in.</p>
        <p>Everything since then is my own work beyond the assignment: safer handling of bad files, and this web view. Each version is documented on its own, so it is always clear what was asked for and what I chose to build.</p>
        <p><a href="https://github.com/collierjamiec/Hillpointe_AP_Submission/blob/main/SCOPE.md" target="_blank" rel="noopener">Read the full scope and version history</a></p>
      </section>`;
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

  // ------------------------------------------------------------------ router
  function parseHash() {
    const h = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = h.split("?");
    return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(qs || "") };
  }
  let lastPath = null;
  function render() {
    const { parts, q } = parseHash();
    const main = $("#main");
    let html, title, nav, after;
    const [a, b] = parts;
    if (!a) { html = viewDashboard(); title = "Dashboard"; nav = "dashboard"; }
    else if (a === "runs" && !b) { html = viewRuns(); title = "Runs"; nav = "runs"; }
    else if (a === "runs") { html = viewRun(b, q); title = X.runById[b] ? X.runById[b].label : "Run"; nav = "runs"; after = () => bindRun(b, q); }
    else if (a === "invoices" && !b) { html = viewInvoices(q); title = "Invoices"; nav = "invoices"; after = () => bindInvoices(q); }
    else if (a === "invoices") { html = viewInvoice(b, q); title = X.docById[b] ? `${X.docById[b].vendor} ${X.docById[b].billNo}` : "Invoice"; nav = "invoices"; after = () => bindInvoice(b, q); }
    else if (a === "rules") { html = viewRules(); title = "Rules"; nav = "rules"; }
    else if (a === "about") { html = viewAbout(); title = "How Penny works"; nav = "about"; }
    else { html = notFound("That page"); title = "Not found"; }
    main.innerHTML = html;
    document.title = `${title} · Penny`;
    $$("#nav a").forEach((l) => (l.dataset.nav === nav ? l.setAttribute("aria-current", "page") : l.removeAttribute("aria-current")));
    if (after) after();
    const path = parts.join("/");
    if (path !== lastPath) {
      window.scrollTo(0, 0);
      if (lastPath !== null) main.focus({ preventScroll: true });
      lastPath = path;
    }
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
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
    const roleSel = $("#role");
    roleSel.value = role;
    roleSel.addEventListener("change", () => {
      role = roleSel.value;
      store.set("penny.role", role);
      render();
      toast(`Now viewing as ${ROLES[role].name}. ${article(ROLES[role].name).replace(/^a/, "A")} ${ROLES[role].blurb}`);
    });
    $("#theme-btn").addEventListener("click", () => {
      const dark = document.documentElement.dataset.theme
        ? document.documentElement.dataset.theme === "dark"
        : matchMedia("(prefers-color-scheme: dark)").matches;
      const next = dark ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      store.set("penny.theme", next);
    });
    document.addEventListener("click", (e) => {
      const p2 = e.target.closest("[data-phase2]");
      if (p2) { e.preventDefault(); toast(`${p2.dataset.phase2} is coming in phase 2. This is a view-only preview.`); return; }
      const row = e.target.closest("tr[data-href]");
      if (row && !e.target.closest("a, button")) location.hash = row.dataset.href;
    });
    window.addEventListener("hashchange", render);
  }

  async function boot() {
    bindChrome();
    try {
      const res = await fetch("data/penny-data.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      D = await res.json();
    } catch (e) {
      $("#main").innerHTML = `${head("No data yet", "Penny could not load <code>data/penny-data.json</code>. Create it from the terminal, then reload this page:")}
        <pre class="card card-pad" style="overflow:auto">./penny web-export --package ~/Downloads/Hillpointe_AP_Technical_Screen\n./penny web</pre>`;
      return;
    }
    X = buildIndex(D);
    $("#generated").textContent = `Data exported ${fmtDateTime(D.generated_at)}`;
    bindSearch();
    render();
  }
  boot();
})();
