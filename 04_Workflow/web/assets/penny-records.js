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
  const closedTop = topRows(closed, `<a href="#/invoices">See them all in Invoices</a>.`);
  const card = ([c, rows]) => {
    const k = CODES[c] || CODES.OTHER;
    const route = (RULES().routes || {})[c] || "";
    const top = topRows(rows.sort((a, b) => b.amount - a.amount), `These are the largest. <a href="#/invoices?code=${esc(c)}">See every invoice with this reason</a>.`);
    return `<section class="card exc-card" id="code-${esc(c)}" aria-labelledby="exc-${esc(c)}">
      <div class="exc-head"><div><h2 id="exc-${esc(c)}">${esc(k.plain)}</h2><span class="hint">${codeChip(c)} ${esc(k.name)}</span></div>
        <span class="exc-count">${rows.length ? `${plural(rows.length, "invoice")} · ${esc(amountLabel(rows))}` : "None open"}</span></div>
      <div class="exc-grid">
        <div><h3 class="callout-h">Why it happens</h3><p>${esc(k.why)}</p></div>
        <div><h3 class="callout-h">What to do next</h3><p>${esc(k.next)}</p></div>
        <div><h3 class="callout-h">Goes to</h3><p>${esc(route)}</p></div>
      </div>
      ${rows.length ? docTable(top.rows, { route: true }) + top.note : ""}
    </section>`;
  };
  return `${head("Exceptions", "Every reason Penny holds an invoice, in plain language: what it means, why it happens, what to do next and who acts. The codes match the AP policy and the exception log.")}
    ${active.length ? active.map(card).join("") : `<section class="card"><div class="empty-state">${ICON.check}<h2>No open exceptions</h2><p>Every hold has been cleared or rejected.</p></div></section>`}
    ${closed.length ? `<section class="card" style="margin-top:16px"><div class="card-head"><h2>Resolved by people</h2><p>${plural(closed.length, "invoice")} in this demo</p></div><div class="card-body" style="padding:12px 0 0">${docTable(closedTop.rows, {})}${closedTop.note}</div></section>` : ""}
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
// ------------------------------------------------------------------ export history (v1.9)
/* The two files a person loads into another system have a history: Created by Penny, Downloaded, Imported (a person
   says they loaded it, with that system's reference and the row count), and Confirmed (a different person checked it
   there). It answers "has this file been imported?" before anyone imports it twice. Penny still never uploads, posts
   or pays: every step after Created is a person's statement, recorded with their name and the time. */
const IMPORT_INTO = { "intacct_bill_import.csv": "Sage Intacct", "entrata_handoff.csv": "Entrata" };
const exportState = (run, file) => S.exports[`${run}/${file}`] || { downloads: [], imported: null, confirmed: null };
function exportStage(r, f) {
  const x = exportState(r.id, f.name);
  return x.confirmed ? "confirmed" : x.imported ? "imported" : x.downloads.length ? "downloaded" : "created";
}
/** Why a file should not be imported at all, or "". */
function noImportReason(r, f) {
  if (r.dry_run) return "This was a preview. Its files are for review only, so there is nothing to import.";
  if (r.preflight_failed) return "The Intacct pre-flight check failed for this run, so this file must not be imported.";
  if (!f.rows) return "This file is empty: the run added nothing new.";
  return "";
}
function exportHistory(r, f) {
  const system = IMPORT_INTO[f.name];
  if (!system) return "";
  const stop = noImportReason(r, f);
  if (stop) return `<div class="ex-history"><p class="ex-none">${bIcon("minus")}${esc(stop)}</p></div>`;
  const x = exportState(r.id, f.name), stage = exportStage(r, f);
  const lastDl = x.downloads[x.downloads.length - 1];
  const step = (done, now, title, detail) => `<li class="${done ? "done" : now ? "now" : ""}"><span class="ex-dot" aria-hidden="true">${done ? bIcon("check") : ""}</span><span><b>${esc(title)}</b><span class="sub">${detail}</span></span></li>`;
  const who = (o) => `${esc(o.by.name)}, ${esc(fmtDateTime(o.at))}`;
  const mine = x.imported && user && x.imported.by.id === user.id;
  const actions = [];
  if (!x.imported && can("export")) actions.push(`<button class="btn btn-sm btn-accent" type="button" data-ex="imported" data-run="${esc(r.id)}" data-file="${esc(f.name)}">Mark as imported</button>`);
  if (x.imported && !x.confirmed && can("confirm") && !mine) actions.push(`<button class="btn btn-sm btn-accent" type="button" data-ex="confirmed" data-run="${esc(r.id)}" data-file="${esc(f.name)}">Confirm import</button>`);
  if (x.imported && can("export")) actions.push(`<button class="btn btn-sm btn-ghost" type="button" data-ex="undo" data-run="${esc(r.id)}" data-file="${esc(f.name)}">Mark as not imported</button>`);
  return `<div class="ex-history" aria-label="History of this file">
    <ol class="ex-steps">
      ${step(true, false, "Created", `by Penny${r.started_at ? `, ${esc(fmtDateTime(r.started_at))}` : ""}`)}
      ${step(!!lastDl, stage === "created", "Downloaded", lastDl ? `${who(lastDl)}${x.downloads.length > 1 ? ` · ${x.downloads.length} times` : ""}` : "Not yet")}
      ${step(!!x.imported, stage === "downloaded", `Imported into ${system}`, x.imported ? `${who(x.imported)} · reference ${esc(x.imported.ref)} · ${plural(x.imported.rows, "row")}` : "Not yet. A person does this in " + esc(system) + ".")}
      ${step(!!x.confirmed, stage === "imported", "Confirmed", x.confirmed ? who(x.confirmed) : x.imported ? (mine ? "Waiting for a different person to check it" : "Waiting for a second person to check it") : "Not yet")}
    </ol>
    ${actions.length ? `<div class="ex-actions">${actions.join("")}</div>` : ""}
    ${f.sha256 ? `<p class="ex-sha">File fingerprint (SHA-256): <code>${esc(f.sha256.slice(0, 16))}…</code></p>` : ""}
  </div>`;
}
const EX_BADGE = { downloaded: ["Downloaded, not imported", "b-waiting", "clock"], imported: ["Import recorded", "b-ready", "redo"], confirmed: ["Import confirmed", "b-approved", "check"] };
/** A chip for a bill whose import file has moved on: still never "posted" or "paid", only what a person recorded. */
function importChip(d) {
  const file = d.pennyStatus === "ENTER_INTACCT" ? "intacct_bill_import.csv" : d.pennyStatus === "ENTER_ENTRATA" ? "entrata_handoff.csv" : "";
  if (!file) return "";
  const x = exportState(d.cur.run_id, file);
  const st = x.confirmed ? "confirmed" : x.imported ? "imported" : "";
  if (!st) return "";
  const [label, cls, icon] = EX_BADGE[st];
  return `<span class="badge ${cls}" title="${esc(`${x.imported.by.name} recorded the import into ${IMPORT_INTO[file]}, reference ${x.imported.ref}`)}">${bIcon(icon)}${esc(label)}</span>`;
}
function exportDialog(kind, runId, file) {
  const r = X.runById[runId], f = (r.files || []).find((y) => y.name === file);
  if (!r || !f) return;
  const system = IMPORT_INTO[file], info = FILE_INFO[file], x = exportState(runId, file);
  const lede = `${esc(info.title)} · ${esc(r.label)} · ${plural(f.rows, info.unit[0], info.unit[1])}`;
  if (kind === "imported") {
    openDialog(`Mark as imported into ${system}`, lede,
      `<p class="hint">Do this after you have loaded the file into ${esc(system)} and it accepted every row. You are recorded as the person who imported it.</p>
       <div class="field-row"><div class="field"><label for="dlg-ref">${esc(system)} reference</label><input id="dlg-ref" name="ref" maxlength="60" autocomplete="off" placeholder="${system === "Sage Intacct" ? "Import batch or journal number" : "Batch or posting number"}" required></div>
         <div class="field"><label for="dlg-rows">Rows ${esc(system)} accepted</label><input id="dlg-rows" name="rows" inputmode="numeric" autocomplete="off" required><span class="hint">The file has ${f.rows}.</span></div></div>
       ${x.downloads.length ? "" : `<p class="form-warn">Nobody has downloaded this file from Penny in this browser. Make sure the file you imported is this one.</p>`}
       ${noteField("Note", false, "For example: imported with the 3:15 PM batch.")}`,
      "Mark as imported", (fd) => {
        const ref = String(fd.get("ref") || "").trim(), rows = String(fd.get("rows") || "").trim();
        if (ref.length < 2) return `Enter the reference ${system} gave the import, so it can be found there later.`;
        if (!/^\d+$/.test(rows)) return "Enter how many rows were accepted, as a number.";
        if (+rows !== f.rows) return `The file has ${f.rows} rows, but you entered ${rows}. If ${system} rejected some rows, do not mark this as imported: fix the import first.`;
        if (record("export.imported", { run: runId, file, ref, rows: +rows, sha256: f.sha256, note: String(fd.get("note") || "").trim(), before: "Not imported", after: `Imported into ${system}, reference ${ref}` })) { render(); toast("Recorded. A different person can now confirm it."); }
        return "";
      });
  } else if (kind === "confirmed") {
    if (x.imported.by.id === user.id) { toast("A different person must confirm an import."); return; }
    openDialog("Confirm this import", lede,
      `<p>${esc(x.imported.by.name)} recorded this as imported into ${esc(system)} on ${esc(fmtDateTime(x.imported.at))}, reference <b>${esc(x.imported.ref)}</b>, ${plural(x.imported.rows, "row")}.</p>
       <label class="check-line"><input type="checkbox" name="seen" value="1"> I looked in ${esc(system)} and found this reference with the same number of rows.</label>
       ${noteField("Note", false)}`,
      "Confirm import", (fd) => {
        if (!fd.get("seen")) return `Check it in ${system} first, then tick the box.`;
        if (record("export.confirmed", { run: runId, file, ref: x.imported.ref, note: String(fd.get("note") || "").trim(), before: "Import recorded", after: "Import confirmed" })) { render(); toast("Import confirmed."); }
        return "";
      });
  } else if (kind === "undo") {
    openDialog("Mark as not imported", `${lede}. Use this when the import failed or was reversed in ${esc(system)}. The earlier entries stay in the audit trail.`,
      noteField("What happened?", true, "For example: Intacct rejected the batch; vendor ID missing."), "Mark as not imported", (fd) => {
        const err = needNote(fd, 10); if (err) return err;
        if (record("export.undo", { run: runId, file, note: String(fd.get("note")).trim(), before: x.confirmed ? "Import confirmed" : "Import recorded", after: "Not imported" })) { render(); toast("Marked as not imported."); }
        return "";
      }, { danger: true });
  }
}
/** Every download is noted. Downloading a file that is already imported asks first, because importing it twice
    would create duplicate bills. */
function onDownload(link, e) {
  const runId = link.dataset.run, file = link.dataset.dl;
  const r = X.runById[runId], f = r && (r.files || []).find((y) => y.name === file);
  if (!f) return;
  const x = exportState(runId, file);
  const note = () => { logEvent("export.download", user, { run: runId, file, sha256: f.sha256 }); derive(); if (IMPORT_INTO[file] && $(".export-run")) setTimeout(render, 50); };
  if (IMPORT_INTO[file] && x.imported && !link.dataset.sure) {
    e.preventDefault();
    openDialog("This file was already imported", `${esc(FILE_INFO[file].title)} · ${esc(r.label)}`,
      `<p class="form-warn">${esc(x.imported.by.name)} recorded it as imported into ${esc(IMPORT_INTO[file])} on ${esc(fmtDateTime(x.imported.at))}, reference <b>${esc(x.imported.ref)}</b>. Importing it again would create duplicate bills.</p>
       <p>You can still download a copy to look at.</p>`,
      "Download a copy", () => { link.dataset.sure = "1"; link.click(); delete link.dataset.sure; return ""; });
    return;
  }
  note();
}

function viewExports() {
  const runs = D.runs.slice().reverse();
  return `${head("Exports", "The files each run created, for people to review, upload and keep. Penny never uploads, posts or pays anything; a person does.")}
    <div class="role-banner" role="note"><span><strong>Created is not uploaded.</strong> A bill in the Intacct bill import file is not in Intacct until a person uploads it, and it is not paid until it is approved. Each import file below shows its history, so nobody imports the same file twice.</span></div>
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
              <p class="file-meta"><span>For: ${esc(info.who)}</span>${count ? `<span>${esc(count)}</span>` : ""}<span><code>${esc(f.name)}</code></span></p>
              ${exportHistory(r, f)}</div>
            <div class="file-actions">${info.view ? `<button class="btn btn-sm btn-accent" type="button" data-view-summary="${esc(f.path)}" data-run="${esc(r.id)}">View</button>` : ""}
              <a class="btn btn-sm" href="${esc(f.path)}" download="${esc(friendlyName(r, f))}" data-dl="${esc(f.name)}" data-run="${esc(r.id)}" aria-label="Download ${esc(info.title)} for ${esc(r.label)}">Download</a>
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
