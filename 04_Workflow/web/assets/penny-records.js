/* Penny web app: The Exceptions guide and the Exports page.
   Sections: exceptions, exports. */
"use strict";

// ------------------------------------------------------------------ exceptions
function viewExceptions() {
  const pr = RULES().code_priority || Object.keys(CODES);
  const open = X.docs.filter(openHold);
  const groups = pr.map((c) => [c, open.filter((d) => d.codes.includes(c))]);
  const active = groups.filter(([, rows]) => rows.length);
  const quiet = groups.filter(([, rows]) => !rows.length);
  const closed = X.docs.filter((d) => d.status === "CLEARED" || d.status === "REJECTED");
  const card = ([c, rows]) => {
    const k = CODES[c] || CODES.OTHER;
    const route = (RULES().routes || {})[c] || "";
    return `<section class="card exc-card" id="code-${esc(c)}" aria-labelledby="exc-${esc(c)}">
      <div class="exc-head"><div><h2 id="exc-${esc(c)}">${esc(k.plain)}</h2><span class="hint">${codeChip(c)} ${esc(k.name)}</span></div>
        <span class="exc-count">${rows.length ? `${plural(rows.length, "invoice")} · ${esc(amountLabel(rows))}` : "None open"}</span></div>
      <div class="exc-grid">
        <div><h3 class="callout-h">Why it happens</h3><p>${esc(k.why)}</p></div>
        <div><h3 class="callout-h">What to do next</h3><p>${esc(k.next)}</p></div>
        <div><h3 class="callout-h">Goes to</h3><p>${esc(route)}</p></div>
      </div>
      ${rows.length ? docTable(rows.sort((a, b) => b.amount - a.amount), { route: true }) : ""}
    </section>`;
  };
  return `${head("Exceptions", "Every reason Penny holds an invoice, in plain language: what it means, why it happens, what to do next and who acts. The codes match the AP policy and the exception log.")}
    ${active.length ? active.map(card).join("") : `<section class="card"><div class="empty-state">${ICON.check}<h2>No open exceptions</h2><p>Every hold has been cleared or rejected.</p></div></section>`}
    ${closed.length ? `<section class="card" style="margin-top:16px"><div class="card-head"><h2>Resolved by people</h2><p>${plural(closed.length, "invoice")} in this demo</p></div><div class="card-body" style="padding:12px 0 0">${docTable(closed, {})}</div></section>` : ""}
    <details class="card more-codes"><summary>The other ${plural(quiet.length, "code")} Penny can use</summary>${quiet.map(card).join("")}</details>`;
}

// ------------------------------------------------------------------ exports
/* Every file a run creates, described as a noun a person recognizes: what is inside, who uses it, and what it is
   not. Penny's own file names stay visible as secondary detail. */
const FILE_INFO = {
  "intacct_bill_import.csv": { title: "Intacct bill import file", type: "CSV", unit: ["bill line", "bill lines"], who: "AP team, to upload to Sage Intacct",
    what: "Bills that passed every check, laid out in Sage Intacct's import format. Upload it in Intacct after review. Penny does not upload it." },
  "entrata_handoff.csv": { title: "Entrata handoff list", type: "CSV", unit: ["row", "rows"], who: "Property Accounting",
    what: "Apartment community bills, one row per GL account, ready for Property Accounting to post in Entrata." },
  "exception_log.csv": { title: "Invoices needing review", type: "CSV", unit: ["invoice", "invoices"], who: "AP Manager and the assigned teams",
    what: "Every invoice Penny held or stopped, with the reason, the team it goes to, and Penny's confidence." },
  "approvals_for_entered_bills.csv": { title: "Approvals needed", type: "CSV", unit: ["bill", "bills"], who: "Approvers",
    what: "Who must sign off on each bill in the import file. It lists who is required; it does not record approvals." },
  "review_workbook.xlsx": { title: "Review workbook", type: "Excel", unit: null, who: "Anyone reviewing the run",
    what: "All of the files above as tabs in one Excel workbook, plus a sheet that checks every bill total with formulas." },
  "run_report.md": { title: "Run summary", type: "Summary", unit: null, who: "Anyone", view: true,
    what: "One page with the counts, every decision, and the result of Penny's Intacct pre-flight check." },
};
const FILE_ORDER = Object.keys(FILE_INFO);
const friendlyName = (run, f) => `Penny - ${run.label} - ${(FILE_INFO[f.name] || { title: f.name }).title}.${f.name.split(".").pop()}`;
function fileCount(f) {
  const info = FILE_INFO[f.name] || {};
  if (f.rows === null || f.rows === undefined || !info.unit) return "";
  return f.rows === 0 ? "Empty: nothing new in this run" : plural(f.rows, info.unit[0], info.unit[1]);
}
function viewExports() {
  const runs = D.runs.slice().reverse();
  return `${head("Exports", "The files each run created, for people to review, upload and keep. Penny never uploads, posts or pays anything; a person does.")}
    <div class="role-banner" role="note"><span><strong>Created is not uploaded.</strong> A bill in the Intacct bill import file is not in Intacct until a person uploads it, and it is not paid until it is approved.</span></div>
    ${runs.map((r) => {
      const res = X.byRun[r.id] || [];
      const st = runStats(res);
      const files = (r.files || []).slice().sort((a, b) => FILE_ORDER.indexOf(a.name) - FILE_ORDER.indexOf(b.name));
      return `<section class="card export-run" aria-labelledby="ex-${esc(r.id)}">
        <div class="export-head"><div><h2 id="ex-${esc(r.id)}">${esc(r.label)}</h2>
          <p>${esc(r.started_at ? fmtDateTime(r.started_at) : `Run ${r.order}`)} · folder <code>${esc(r.batch)}</code>${r.dry_run ? ` · <span class="badge b-skip">${bIcon("minus")}Dry run</span>` : ""}</p>
          <p class="export-tally">${plural(res.length, "document")} read: ${st.entered} ready to import, ${st.held} need review, ${st.dup} duplicate${st.dup === 1 ? "" : "s"}${st.skip ? `, ${st.skip} skipped` : ""}</p></div>
          <a class="btn btn-sm" href="#/runs/${esc(r.id)}">Open run</a></div>
        ${files.length ? `<ul class="file-list">${files.map((f) => {
          const info = FILE_INFO[f.name] || { title: f.name, type: f.name.split(".").pop().toUpperCase(), what: "", who: "" };
          const count = fileCount(f);
          return `<li class="file-row">
            <span class="file-type t-${esc(info.type.toLowerCase())}" aria-hidden="true">${esc(info.type)}</span>
            <div class="file-main"><b>${esc(info.title)}</b><p>${esc(info.what)}</p>
              <p class="file-meta"><span>For: ${esc(info.who)}</span>${count ? `<span>${esc(count)}</span>` : ""}<span><code>${esc(f.name)}</code></span></p></div>
            <div class="file-actions">${info.view ? `<button class="btn btn-sm btn-accent" type="button" data-view-summary="${esc(f.path)}" data-run="${esc(r.id)}">View</button>` : ""}
              <a class="btn btn-sm" href="${esc(f.path)}" download="${esc(friendlyName(r, f))}" aria-label="Download ${esc(info.title)} for ${esc(r.label)}">Download</a>
              ${can("email") ? `<button class="btn btn-sm" type="button" data-email-file="${esc(f.name)}" data-run="${esc(r.id)}" data-bytes="${esc(f.bytes || 0)}" aria-label="Email ${esc(info.title)} for ${esc(r.label)}">Email</button>` : ""}</div>
          </li>`; }).join("")}</ul>` : `<p class="empty">No files were saved for this run.</p>`}
      </section>`;
    }).join("")}`;
}
/** Show a run summary on the page. The file is Markdown, which most people cannot open, so it is turned into a
    readable page here, with Penny's result codes shown as plain labels. */
function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  const inline = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const cell = (t) => { const v = t.trim(); return STATUS[v] ? esc(STATUS[v].label) : inline(v); };
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    if (/^#\s/.test(l)) continue;                       // the dialog has its own title
    if (/^##\s/.test(l)) { out.push(`<h3 class="sub-h">${inline(l.replace(/^##\s*/, ""))}</h3>`); continue; }
    if (/^\|/.test(l)) {
      const rows = [];
      while (k < lines.length && /^\|/.test(lines[k])) { rows.push(lines[k]); k++; }
      k--;
      const split = (r) => r.replace(/^\||\|$/g, "").split("|");
      const head = split(rows[0]), body = rows.slice(2).map(split);
      out.push(`<div class="table-wrap"><table class="mini"><thead><tr>${head.map((h) => `<th>${inline(h.trim())}</th>`).join("")}</tr></thead><tbody>${body.map((r) =>
        `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (/^-\s/.test(l)) { out.push(`<p>• ${inline(l.replace(/^-\s*/, ""))}</p>`); continue; }
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return out.join("");
}
async function showRunSummary(path, runId) {
  const run = X.runById[runId];
  let body;
  try {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = `<div class="summary-body">${mdToHtml(await res.text())}</div>`;
  } catch (e) {
    body = `<p class="form-error">The summary could not be loaded. Try the Download button instead.</p>`;
  }
  openDialog(`Run summary · ${run ? run.label : runId}`, run ? `${esc(run.started_at ? fmtDateTime(run.started_at) : `Run ${run.order}`)} · folder <code>${esc(run.batch)}</code>` : "",
    body, "", () => "", { info: true, wide: true });
}
