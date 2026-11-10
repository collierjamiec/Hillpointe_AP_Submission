/* Penny web app: Manual entry for files Penny could not read, with the second-person check.
   Sections: manual entry (v1.5). */
"use strict";

// ------------------------------------------------------------------ manual entry (v1.5)
/* When Penny cannot read a file but a person can open it in another program, the person keys the invoice beside a
   screenshot or re-saved copy. Penny then runs every normal check on the keyed record. Above the dollar limit in
   Rules (thresholds.manual_entry_check_over), a different person keys the invoice number and total again without
   seeing the first entry; both must match. The original file stays the source document, and every step is logged. */
const MANUAL_KINDS = new Set(["unreadable", "unrecognized"]);
const canKey = (d) => d.pennyStatus === "HOLD" && MANUAL_KINDS.has(d.ex.kind) && openHold(d);
const keyedByHand = (d) => (d.ex.extraction || {}).method === "manual";
const checkLimit = () => { const raw = getPath(RULES(), "thresholds.manual_entry_check_over"); const v = Number(raw); return raw !== undefined && raw !== null && Number.isFinite(v) ? Math.round(v * 100) : 0; };
const normNo = (v) => String(v || "").toUpperCase().replace(/[\s-]+/g, "");
function manualState(d) {
  const m = S.manual[d.id];
  if (!m) return null;
  const needsCheck = Math.abs(cents(m.entry.total)) > checkLimit();
  const last = m.checks[m.checks.length - 1];
  const checked = last && last.match ? last : null;
  const state = m.saved ? "saved" : !needsCheck || checked ? "ready" : last ? "mismatch" : "check";
  return { ...m, needsCheck, checked, last, state };
}
const MANUAL_STATE = {
  check: ["Waiting for a second check", "b-waiting", "clock"], mismatch: ["Second check did not match", "b-rejected", "x"],
  ready: ["Manual entry ready", "b-ready", "redo"], saved: ["Manual entry saved for the next run", "b-approved", "check"],
};
function manualChip(d) {
  if (keyedByHand(d)) return `<span class="badge b-manual" title="A person keyed this invoice from the original file">${bIcon("check")}Keyed by hand</span>`;
  const m = manualState(d);
  if (!m) return "";
  const [label, cls, icon] = MANUAL_STATE[m.state];
  return `<span class="badge ${cls}">${bIcon(icon)}${esc(label)}</span>`;
}
function manualCallout(d) {
  if (keyedByHand(d)) {
    const x = d.ex.extraction;
    return `<section class="callout callout-manual" aria-labelledby="mk"><div class="callout-title">${bIcon("check")}<h2 id="mk">Keyed by hand from the original file</h2></div>
      <p>${esc((x.keyed_by || {}).name || "A person")} keyed this invoice${x.keyed_at ? ` on ${esc(fmtDateTime(x.keyed_at))}` : ""}${x.checked_by ? `, and ${esc(x.checked_by.name)} checked the invoice number and total by keying them again` : ""}. Penny ran every normal check on what was keyed.</p>
      ${x.reason ? `<div class="activity"><p class="a-note">${esc(x.reason)}</p></div>` : ""}
      ${(x.evidence || []).length ? `<p class="hint">Evidence on file: ${x.evidence.map((f) => `${esc(f.name)} (${esc(String(f.sha256).slice(0, 10))})`).join(", ")}</p>` : ""}</section>`;
  }
  const m = manualState(d);
  if (m) {
    const [label] = MANUAL_STATE[m.state];
    return `<section class="callout callout-manual" aria-labelledby="mk"><div class="callout-title">${bIcon("redo")}<h2 id="mk">${esc(label)}</h2></div>
      <p>${esc(m.by.name)} keyed this invoice by hand on ${esc(fmtDateTime(m.at))}.${m.state === "check" ? " A different person needs to key the invoice number and total again before it can go further." : ""}</p>
      <div class="nb-actions"><a class="btn ${m.state === "saved" ? "" : "btn-accent"}" href="#/invoices/${esc(d.id)}/manual">Open the manual entry</a></div></section>`;
  }
  if (canKey(d) && can("resolve")) {
    return `<section class="callout callout-manual" aria-labelledby="mk"><div class="callout-title">${bIcon("redo")}<h2 id="mk">Can you open this file in another program?</h2></div>
      <p>If a person can read it, they can key the invoice beside a screenshot. Penny then checks the keyed invoice like any other${checkLimit() ? `, and a second person confirms it above ${esc(money(checkLimit()))}` : ""}.</p>
      <div class="nb-actions"><a class="btn btn-accent" href="#/invoices/${esc(d.id)}/manual">Enter it by hand</a><a class="btn" href="#/help/manual-entry">How manual entry works</a></div></section>`;
  }
  return "";
}

const MAN = { doc: null, entry: null, files: [], editing: false, error: "", preview: 0 };
const blankLine = () => ({ desc: "", qty: "", rate: "", amount: "", auto: true });
function startManual(d, fromExisting) {
  const m = S.manual[d.id];
  const seen = String(d.ex.amount_seen || "").replace(/[^0-9.]/g, "");
  const base = fromExisting && m ? JSON.parse(JSON.stringify(m.entry)) : {
    kind: "invoice", vendor_name: d.ex.vendor_name_raw || "", invoice_no: d.ex.invoice_no || "", date: d.ex.date || "", terms: d.ex.terms_printed || "",
    customer_ref: ((d.ex.refs || {}).po || [])[0] || d.ex.customer_ref || "", other_refs: "", bill_to: (d.ex.bill_to || {}).name || "", ship_to: d.ex.ship_to || "",
    remit_address: "", lines: [blankLine()], subtotal: "", tax_total: "0.00", total: seen, payment_change: false, lien_waiver_attached: false, reason: "",
    auto_subtotal: true, auto_total: !seen };
  base.lines = (base.lines || []).map((l) => ({ ...blankLine(), ...l, auto: l.auto !== undefined ? l.auto : false }));
  Object.assign(MAN, { doc: d.id, entry: base, files: fromExisting && m ? m.evidence.map((f) => ({ ...f })) : [], editing: true, error: "", preview: 0 });
}
const c2s = (c) => (c / 100).toFixed(2);
function tieOut(e) {
  const lines = e.lines.map((l) => cents(l.amount));
  const sum = lines.reduce((a, b) => a + b, 0);
  const sub = cents(e.subtotal), tax = cents(e.tax_total), tot = cents(e.total);
  return { sum, sub, tax, tot, subOk: e.subtotal !== "" && sum === sub, totOk: e.total !== "" && sub + tax === tot };
}
function manualProblems(e, files) {
  const p = [];
  if (!files.length) p.push("Attach the screenshot or re-saved file you are keying from");
  if (!e.vendor_name.trim()) p.push("Vendor name is required");
  if (!e.invoice_no.trim()) p.push("Invoice number is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "")) p.push("Invoice date is required");
  if (!e.lines.some((l) => l.desc.trim() && l.amount !== "")) p.push("Add at least one line with a description and an amount");
  e.lines.forEach((l, i) => { if ((l.desc.trim() || l.amount !== "") && (!l.desc.trim() || !/^-?\d+(\.\d{1,2})?$/.test(String(l.amount).replace(/[$,]/g, "")))) p.push(`Line ${i + 1} needs a description and an amount like 1234.56`); });
  const t = tieOut(e);
  if (!t.subOk) p.push(`The lines add to ${money(t.sum)}, but the subtotal is ${e.subtotal === "" ? "empty" : money(t.sub)}`);
  if (!t.totOk) p.push(`Subtotal plus tax is ${money(t.sub + t.tax)}, but the total is ${e.total === "" ? "empty" : money(t.tot)}`);
  if ((e.reason || "").trim().length < 10) p.push("Say why this invoice is keyed by hand (at least 10 characters)");
  return p;
}
/** The entry exactly as the server and the audit trail see it. */
function entryForServer(m) {
  const e = m.entry;
  return { ...e, lines: e.lines.filter((l) => l.desc.trim() || l.amount !== "").map(({ desc, qty, rate, amount }) => ({ desc, qty: qty || "1", rate, amount })),
    keyed_by: { id: m.by.id, name: m.by.name, role: m.by.role }, keyed_at: m.at,
    checked_by: m.checked ? { id: m.checked.by.id, name: m.checked.by.name, role: m.checked.by.role } : null,
    evidence: m.evidence.map(fileMeta) };
}

function viewManual(d) {
  if (!d) return notFound("That invoice");
  const back = `<nav class="record-nav" aria-label="Record navigation"><a href="#/invoices/${esc(d.id)}" class="back-link">← Back to the invoice</a><span class="crumb-id">${esc(d.id)}</span></nav>`;
  const m = manualState(d);
  if (keyedByHand(d) || (!canKey(d) && !m)) {
    return `${back}${head("Enter by hand", "")}<section class="card"><div class="empty-state">${ICON.shield}<h2>${keyedByHand(d) ? "This invoice was already keyed by hand" : "This invoice does not need manual entry"}</h2>
      <p>Manual entry is for held files Penny could not read, or bills in a layout it does not know. ${keyedByHand(d) ? "Penny has checked the keyed record." : "Penny read this one itself."}</p></div></section>`;
  }
  if (MAN.doc !== d.id) { MAN.doc = d.id; MAN.editing = false; MAN.files = []; MAN.entry = null; MAN.error = ""; }
  if (!m && can("resolve") && !MAN.editing) startManual(d, false);
  const why = d.cur.reasons && d.cur.reasons[0] ? parseReason(d.cur.reasons[0]).text : "";
  const demo = !SERVER ? `<div class="mode-banner mode-demo" role="note"><b>Keying and the second check work here.</b> Checking the keyed invoice with Penny and saving it for the next run need Penny on your computer. <a href="#/help/manual-entry">How it works</a></div>` : "";
  const steps = [["Key it beside the evidence", !m || MAN.editing ? "now" : "done"], ["Second person checks", !m || MAN.editing ? "" : m.needsCheck ? (m.checked ? "done" : "now") : "skip"],
    ["Check with Penny", m && !MAN.editing && m.state === "ready" ? "now" : m && m.state === "saved" ? "done" : ""], ["Save for the next run", m && m.state === "saved" ? "done" : ""]];
  return `${back}
    ${head(`Enter by hand: ${esc(d.vendor)}`, `${esc(d.file)}. ${esc(why.length > 200 ? why.slice(0, 197) + "…" : why)}`)}
    ${demo}
    <ol class="m-steps" aria-label="Steps">${steps.map(([l, st], i) => `<li class="ms-${st || "todo"}"><span class="ms-n">${st === "done" ? bIcon("check") : i + 1}</span>${esc(l)}${st === "skip" ? `<span class="sub">Not needed under ${esc(money(checkLimit()))}</span>` : ""}</li>`).join("")}</ol>
    <div class="manual-layout">
      <section class="card m-evidence" aria-labelledby="ev-h"><div class="card-head"><h2 id="ev-h">Evidence</h2><p>What the invoice is keyed from</p></div>
        <div class="card-body" id="m-evidence">${evidencePanel(d, m)}</div></section>
      <section class="card m-form" aria-labelledby="mf-h"><div class="card-body" id="m-body">${manualBody(d, m)}</div></section>
    </div>
    ${recheckCard(d)}`;
}
function evidencePanel(d, m) {
  const files = MAN.editing ? MAN.files : m ? m.evidence : [];
  const cur = files[MAN.preview] || files[0];
  return `${MAN.editing ? `<div class="dropzone dz-sm" id="m-drop" tabindex="0" role="button" aria-describedby="m-drop-hint">
        <p><b>Drop a screenshot or re-saved PDF</b> or <span class="link-like">choose a file</span></p>
        <p class="hint" id="m-drop-hint">PNG, JPEG or PDF, up to 10 MB, at most 5 files.</p>
        <input type="file" id="m-files" accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf" multiple hidden></div>` : ""}
    ${files.length ? `<ul class="m-files">${files.map((f, i) => `<li class="${f.error ? "st-bad" : ""}${i === MAN.preview ? " on" : ""}">
        ${f.error ? `<span><b>${esc(f.name)}</b><span class="sub form-error">${esc(f.error)}</span></span>` : `<button type="button" class="link-btn" data-m-preview="${i}">${esc(f.name)}</button><span class="sub">${esc(fmtBytes(f.bytes))} · ${esc(f.sha256.slice(0, 12))}</span>`}
        ${MAN.editing ? `<button type="button" class="icon-btn" data-m-rm="${i}" aria-label="Remove ${esc(f.name)}">×</button>` : ""}</li>`).join("")}</ul>
      <div class="m-preview" id="m-preview" data-sha="${esc(cur && !cur.error ? cur.sha256 : "")}"><p class="hint">Loading the preview…</p></div>`
      : `<p class="empty">${MAN.editing ? "No evidence yet. A reviewer must be able to see what you keyed from." : "No evidence attached."}</p>`}
    ${d.pdf ? `<p class="hint"><a href="${esc(d.pdf)}" target="_blank" rel="noopener">Open the original file</a> (the one Penny could not read). It stays the source document.</p>` : ""}`;
}
async function paintEvidencePreview() {
  const box = $("#m-preview");
  if (!box) return;
  const sha = box.dataset.sha;
  const f = sha ? (MAN.files.find((x) => x.sha256 === sha && x.blob) || await getFile(sha)) : null;
  if (!f || !f.blob) { box.innerHTML = `<p class="hint">${sha ? "This file is not in this browser (it was attached in another browser, or storage was cleared). Its fingerprint is still on record." : ""}</p>`; return; }
  if (box.dataset.url) URL.revokeObjectURL(box.dataset.url);
  const url = URL.createObjectURL(f.blob);
  box.dataset.url = url;
  box.innerHTML = f.type === "pdf" ? `<iframe src="${esc(url)}" title="Evidence: ${esc(f.name)}"></iframe>` : `<img src="${esc(url)}" alt="Evidence: ${esc(f.name)}">`;
}
const mField = (key, label, opts = {}) => `<div class="field${opts.cls ? " " + opts.cls : ""}"><label for="m-${key}">${esc(label)}${opts.optional ? " (optional)" : ""}</label>
  <input id="m-${key}" class="text-input" data-m="${key}" type="${opts.type || "text"}" value="${esc(MAN.entry[key] ?? "")}" ${opts.list ? `list="${opts.list}"` : ""} ${opts.attrs || ""} autocomplete="off"></div>`;
function tieBox() {
  const t = tieOut(MAN.entry);
  const row = (ok, text) => `<li class="${ok ? "ok" : "bad"}">${bIcon(ok ? "check" : "alert")}${esc(text)}</li>`;
  return `<ul class="tie">${row(t.subOk, `Lines add to ${money(t.sum)}${MAN.entry.subtotal === "" ? "" : t.subOk ? ", same as the subtotal" : `, but the subtotal is ${money(t.sub)}`}`)}
    ${row(t.totOk, `Subtotal plus tax is ${money(t.sub + t.tax)}${MAN.entry.total === "" ? "" : t.totOk ? ", same as the total" : `, but the total is ${money(t.tot)}`}`)}
    ${Math.abs(t.tot) > checkLimit() ? `<li class="info">${bIcon("clock")}Over ${esc(money(checkLimit()))}: a second person will key the invoice number and total again.</li>` : ""}</ul>`;
}
function manualForm() {
  const e = MAN.entry;
  const vendors = [...new Set(X.docs.filter((x) => x.vendorKnown).map((x) => x.vendor))].sort();
  const terms = Object.keys(RULES().terms_days || {});
  return `<h2 id="mf-h">Key the invoice</h2>
    <p class="hint">Type exactly what the document says. Penny checks the vendor, PO, coding, dates and approvals from this, the same way it checks a PDF it reads itself.</p>
    <datalist id="m-vendors">${vendors.map((v) => `<option value="${esc(v)}">`).join("")}</datalist>
    <div class="m-grid">
      <div class="field"><label for="m-kind">Document type</label><select id="m-kind" data-m="kind"><option value="invoice"${e.kind === "invoice" ? " selected" : ""}>Invoice</option><option value="credit_memo"${e.kind === "credit_memo" ? " selected" : ""}>Credit memo</option></select></div>
      ${mField("vendor_name", "Vendor name", { list: "m-vendors", cls: "span2" })}
      ${mField("invoice_no", "Invoice number", { attrs: 'maxlength="40"' })}
      ${mField("date", "Invoice date", { type: "date" })}
      <div class="field"><label for="m-terms">Terms</label><select id="m-terms" data-m="terms"><option value="">Not shown</option>${terms.map((t) => `<option${t === e.terms ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
      ${mField("customer_ref", "PO or customer reference", { optional: true })}
      ${mField("bill_to", "Bill to", { cls: "span2" })}
      ${mField("ship_to", "Ship to or property", { optional: true, cls: "span2" })}
      ${mField("remit_address", "Remit-to address", { optional: true, cls: "span2" })}
      ${e.kind === "credit_memo" ? mField("credit_original_invoice", "Original invoice it credits", { optional: true }) : ""}
    </div>
    <h3 class="sub-h">Line items</h3>
    <div class="m-lines" role="group" aria-label="Line items">
      <div class="m-line m-line-head" aria-hidden="true"><span>Description</span><span>Qty</span><span>Rate</span><span>Amount</span><span></span></div>
      ${e.lines.map((l, i) => `<div class="m-line">
        <input class="text-input" data-lf="desc" data-i="${i}" value="${esc(l.desc)}" aria-label="Line ${i + 1} description">
        <input class="text-input num-in" data-lf="qty" data-i="${i}" value="${esc(l.qty)}" inputmode="decimal" aria-label="Line ${i + 1} quantity">
        <input class="text-input num-in" data-lf="rate" data-i="${i}" value="${esc(l.rate)}" inputmode="decimal" aria-label="Line ${i + 1} rate">
        <input class="text-input num-in" data-lf="amount" data-i="${i}" value="${esc(l.amount)}" inputmode="decimal" aria-label="Line ${i + 1} amount">
        <button type="button" class="icon-btn" data-m-line-rm="${i}" aria-label="Remove line ${i + 1}" ${e.lines.length === 1 ? "disabled" : ""}>×</button></div>`).join("")}
      <button type="button" class="btn btn-sm" data-m-line-add>Add a line</button>
    </div>
    <div class="m-grid m-totals">
      ${mField("subtotal", "Subtotal", { attrs: 'inputmode="decimal"' })}${mField("tax_total", "Tax", { attrs: 'inputmode="decimal"' })}${mField("total", "Total", { attrs: 'inputmode="decimal"' })}
    </div>
    <div id="m-tie">${tieBox()}</div>
    <label class="check-line"><input type="checkbox" data-m="payment_change"${e.payment_change ? " checked" : ""}> The document mentions new bank or payment details (Penny sends it to Treasury)</label>
    ${e.kind === "invoice" ? `<label class="check-line"><input type="checkbox" data-m="lien_waiver_attached"${e.lien_waiver_attached ? " checked" : ""}> A lien waiver is attached</label>` : ""}
    <div class="field"><label for="m-reason">Why is it keyed by hand?</label><textarea id="m-reason" data-m="reason" maxlength="300" placeholder="For example: vendor's statement layout; Penny cannot read it. Keyed from the PDF opened in Preview.">${esc(e.reason)}</textarea>
      <span class="hint">Saved to the audit trail with your name and the time.</span></div>
    ${MAN.error ? `<div class="auth-error" role="alert">${MAN.error}</div>` : ""}
    <div class="nb-actions"><button class="btn btn-accent btn-lg" type="button" id="m-save">Save entry</button>${S.manual[MAN.doc] ? `<button class="btn" type="button" id="m-cancel">Cancel changes</button>` : ""}</div>`;
}
function entrySummary(e) {
  const row = (l, v) => v ? `<div><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>` : "";
  return `<dl class="m-summary">${row("Document type", e.kind === "credit_memo" ? "Credit memo" : "Invoice")}${row("Vendor", e.vendor_name)}${row("Invoice number", e.invoice_no)}
    ${row("Invoice date", fmtDate(e.date))}${row("Terms", e.terms)}${row("PO or reference", e.customer_ref)}${row("Bill to", e.bill_to)}${row("Ship to", e.ship_to)}
    ${row("Total", money(cents(e.total)))}${row("Mentions new payment details", e.payment_change ? "Yes" : "")}</dl>
    <table class="data m-lines-table"><thead><tr><th scope="col">Description</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Rate</th><th scope="col" class="num">Amount</th></tr></thead>
    <tbody>${e.lines.filter((l) => l.desc || l.amount).map((l) => `<tr><td>${esc(l.desc)}</td><td class="num">${esc(l.qty)}</td><td class="num">${esc(l.rate)}</td><td class="num">${esc(money(cents(l.amount)))}</td></tr>`).join("")}</tbody></table>
    ${e.reason ? `<div class="activity"><p class="a-note">${esc(e.reason)}</p></div>` : ""}`;
}
function manualBody(d, m) {
  if (MAN.editing && can("resolve")) return manualForm();
  if (!m) return `<h2 id="mf-h">Not keyed yet</h2><p>An AP Clerk or Admin can key this invoice. Sign in as Avery Chen or Sam Rivera to try it.</p>`;
  const mine = user && m.by.id === user.id;
  const keyedLine = `<p class="hint">Keyed by ${esc(m.by.name)} (${esc(ROLES[m.by.role].name)}), ${esc(fmtDateTime(m.at))}.</p>`;
  if ((m.state === "check" || m.state === "mismatch") && !mine && can("resolve")) {
    return `<h2 id="mf-h">Second check: key it again</h2>
      <p>Look at the evidence and type the invoice number and total yourself. You cannot see what ${esc(m.by.name)} keyed; Penny compares the two.</p>
      ${m.state === "mismatch" ? `<p class="form-warn">The last check did not match. Look again carefully, or ask ${esc(m.by.name)} to fix the entry.</p>` : ""}
      <form id="m-check" class="m-grid" autocomplete="off" data-stay>
        <div class="field"><label for="mc-no">Invoice number</label><input id="mc-no" class="text-input" name="invoice_no" maxlength="40" required></div>
        <div class="field"><label for="mc-total">Total</label><input id="mc-total" class="text-input" name="total" inputmode="decimal" required></div>
        <div class="nb-actions span2"><button class="btn btn-accent" type="submit">Compare</button></div>
      </form>${keyedLine}`;
  }
  const st = MANUAL_STATE[m.state];
  const lastCheck = m.last ? `<p class="${m.last.match ? "hint" : "form-warn"}">${m.last.match ? `${esc(m.last.by.name)} keyed the invoice number and total again on ${esc(fmtDateTime(m.last.at))}. Both matched.`
    : `${esc(m.last.by.name)} keyed invoice <b>${esc(m.last.invoice_no)}</b> and total <b>${esc(money(cents(m.last.total)))}</b>, which does not match this entry. ${mine ? "Check the evidence and fix the entry, or ask them to check again." : ""}`}</p>` : "";
  const actions = [];
  if (m.state === "ready") {
    actions.push(`<button class="btn" type="button" id="m-penny">Check with Penny</button>`, `<button class="btn btn-accent" type="button" id="m-store">Save for the next run</button>`);
  }
  if (m.state === "saved") actions.push(`<a class="btn btn-accent" href="#/batch">Go to New batch</a>`);
  if (m.state !== "saved" && mine && can("resolve")) actions.push(`<button class="btn" type="button" id="m-edit">Edit the entry</button>`);
  return `<h2 id="mf-h">${esc(st[0])}</h2>
    ${m.state === "check" ? `<p>The total is over ${esc(money(checkLimit()))}, so a different AP Clerk or Admin must key the invoice number and total again from the evidence. ${mine ? "Sign in as someone else to try it." : ""}</p>` : ""}
    ${m.state === "ready" ? `<p>Check it with Penny to see the decision, then save it for the next run. ${m.needsCheck ? "" : `It is under ${esc(money(checkLimit()))}, so one person and a reason are enough.`}</p>` : ""}
    ${m.state === "saved" ? `<p>Saved to <code>${esc(m.saved.folder)}</code> with the original file and the evidence. An Admin previews or runs that batch from <a href="#/batch">New batch</a>, and Penny uses the keyed record in place of reading the file.</p>` : ""}
    ${lastCheck}
    ${entrySummary(m.entry)}
    ${keyedLine}
    ${actions.length ? `<div class="nb-actions">${actions.join("")}</div>` : ""}`;
}
function paintManual() {
  const d = X.docById[MAN.doc];
  if (!d || !$("#m-body")) return;
  $("#m-body").innerHTML = manualBody(d, manualState(d));
  $("#m-evidence").innerHTML = evidencePanel(d, manualState(d));
  paintEvidencePreview();
}
async function addEvidence(list) {
  const room = 5 - MAN.files.length;
  if (room <= 0) { toast("At most 5 evidence files."); return; }
  const picked = Array.from(list).slice(0, room);
  const out = await Promise.all(picked.map(readEvidence));
  for (const f of out) {
    if (!f.error && MAN.files.some((x) => x.sha256 === f.sha256)) f.error = "Same file added twice";
    MAN.files.push(f);
  }
  MAN.preview = Math.max(0, MAN.files.findIndex((f) => !f.error));
  const d = X.docById[MAN.doc];
  $("#m-evidence").innerHTML = evidencePanel(d, manualState(d));
  paintEvidencePreview();
}
const blobToBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
function bindManual(id) {
  const d = X.docById[id];
  paintEvidencePreview();
  const main = $("#main");
  if (main.dataset.manualBound) return;
  main.dataset.manualBound = "1";
  const onPage = () => !!$("#m-body");
  const set = (key, v) => {
    const e = MAN.entry;
    e[key] = v;
    if (key === "subtotal") e.auto_subtotal = false;
    if (key === "total") e.auto_total = false;
  };
  const recalc = () => {
    const e = MAN.entry;
    const t = tieOut(e);
    if (e.auto_subtotal && e.lines.some((l) => l.amount !== "")) { e.subtotal = c2s(t.sum); const el = $("#m-subtotal"); if (el) el.value = e.subtotal; }
    if (e.auto_total && e.subtotal !== "") { e.total = c2s(cents(e.subtotal) + cents(e.tax_total)); const el = $("#m-total"); if (el) el.value = e.total; }
    const box = $("#m-tie"); if (box) box.innerHTML = tieBox();
  };
  main.addEventListener("input", (ev) => {
    if (!onPage() || !MAN.editing) return;
    const t = ev.target;
    if (t.dataset.lf) {
      const l = MAN.entry.lines[+t.dataset.i];
      l[t.dataset.lf] = t.value;
      if (t.dataset.lf === "amount") l.auto = false;
      if ((t.dataset.lf === "qty" || t.dataset.lf === "rate") && l.auto) {
        const q = Number(String(l.qty).replace(/,/g, "")), r = Number(String(l.rate).replace(/[$,]/g, ""));
        if (Number.isFinite(q) && Number.isFinite(r) && l.qty !== "" && l.rate !== "") { l.amount = (Math.round(q * r * 100) / 100).toFixed(2); const el = $(`[data-lf="amount"][data-i="${t.dataset.i}"]`); if (el) el.value = l.amount; }
      }
      recalc();
    } else if (t.dataset.m && t.type !== "checkbox" && t.tagName !== "SELECT") { set(t.dataset.m, t.value); if (["subtotal", "tax_total", "total"].includes(t.dataset.m)) recalc(); }
  });
  main.addEventListener("change", (ev) => {
    if (!onPage()) return;
    const t = ev.target;
    if (t.id === "m-files") { addEvidence(t.files); t.value = ""; return; }
    if (!MAN.editing || !t.dataset.m) return;
    if (t.type === "checkbox") set(t.dataset.m, t.checked);
    else if (t.tagName === "SELECT") { set(t.dataset.m, t.value); if (t.dataset.m === "kind") $("#m-body").innerHTML = manualForm(); }
  });
  main.addEventListener("click", async (ev) => {
    if (!onPage()) return;
    const t = ev.target;
    const doc = X.docById[MAN.doc];
    const pv = t.closest("[data-m-preview]");
    if (pv) { MAN.preview = +pv.dataset.mPreview; $("#m-evidence").innerHTML = evidencePanel(doc, manualState(doc)); paintEvidencePreview(); return; }
    const rm = t.closest("[data-m-rm]");
    if (rm) { MAN.files.splice(+rm.dataset.mRm, 1); MAN.preview = 0; $("#m-evidence").innerHTML = evidencePanel(doc, manualState(doc)); paintEvidencePreview(); return; }
    if (t.closest("#m-drop")) { $("#m-files").click(); return; }
    if (t.closest("[data-m-line-add]")) { MAN.entry.lines.push(blankLine()); $("#m-body").innerHTML = manualForm(); const n = $$("[data-lf=desc]"); n[n.length - 1].focus(); return; }
    const lr = t.closest("[data-m-line-rm]");
    if (lr) { MAN.entry.lines.splice(+lr.dataset.mLineRm, 1); $("#m-body").innerHTML = manualForm(); recalc(); return; }
    if (t.closest("#m-edit")) { startManual(doc, true); render(); return; }
    if (t.closest("#m-cancel")) { MAN.editing = false; render(); return; }
    if (t.closest("#m-save")) {
      const files = MAN.files.filter((f) => !f.error);
      const p = manualProblems(MAN.entry, files);
      if (MAN.files.some((f) => f.error)) p.unshift("Remove the evidence files that cannot be used");
      if (p.length) { MAN.error = `<strong>Fix this before saving:</strong><ul class="notes">${p.map((x) => `<li>${esc(x)}.</li>`).join("")}</ul>`; $("#m-body").innerHTML = manualForm(); $(".auth-error").scrollIntoView({ block: "center" }); return; }
      const { auto_subtotal, auto_total, ...entry } = MAN.entry;
      entry.lines = entry.lines.filter((l) => l.desc.trim() || l.amount !== "").map(({ desc, qty, rate, amount }) => ({ desc: desc.trim(), qty: qty || "1", rate, amount }));
      const redo = !!S.manual[doc.id];
      const over = Math.abs(cents(entry.total)) > checkLimit();
      if (record("manual.keyed", { doc: doc.id, entry, evidence: files.map(fileMeta), note: entry.reason.trim(),
        before: redo ? "Keyed before" : "Not keyed", after: over ? "Waiting for a second check" : "Ready to check with Penny" })) {
        await keepFiles(files.filter((f) => f.blob));
        MAN.editing = false; MAN.error = ""; delete RC[doc.id];
        render(); toast(over ? "Entry saved. A different person must now check it." : "Entry saved.");
      }
      return;
    }
    if (t.closest("#m-penny")) {
      if (!engineReady()) return needsEngine("Checking with Penny");
      runRecheck(doc.id, "keyed", { entry: entryForServer(manualState(doc)) });
      return;
    }
    if (t.closest("#m-store")) {
      if (!engineReady()) return needsEngine("Saving for the next run");
      const m = manualState(doc);
      const btn = t.closest("#m-store");
      btn.disabled = true; btn.textContent = "Saving…";
      try {
        const evidence = [];
        for (const f of m.evidence) {
          const got = await getFile(f.sha256);
          if (!got || !got.blob) throw new Error(`${f.name} is not in this browser any more, so it cannot be sent. Edit the entry and attach it again.`);
          evidence.push({ name: f.name, data: await blobToBase64(got.blob) });
        }
        const id2 = newId();
        const res = await api("api/manual", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: { id: user.id, name: user.name, role: user.role }, run_id: doc.cur.run_id, doc_id: doc.id, entry: entryForServer(m), evidence, date: today(), event_id: id2 }) });
        record("manual.saved", { id: id2, doc: doc.id, batch: res.batch, folder: res.folder, before: "Ready", after: `Saved to ${res.folder}` });
        try { await reloadData(); } catch (e) { /* shown on the next load */ }
        render(); toast(`Saved to ${res.folder}. An Admin can run it from New batch.`);
      } catch (e) {
        btn.disabled = false; btn.textContent = "Save for the next run";
        openDialog("The entry was not saved", esc(e.message), "", "", () => "", { info: true });
      }
    }
  });
  main.addEventListener("submit", (ev) => {
    if (!onPage() || ev.target.id !== "m-check") return;
    ev.preventDefault();
    const doc = X.docById[MAN.doc];
    const m = manualState(doc);
    const fd = new FormData(ev.target);
    const no = String(fd.get("invoice_no") || "").trim(), tot = String(fd.get("total") || "").replace(/[$,\s]/g, "");
    if (!no || !/^-?\d+(\.\d{1,2})?$/.test(tot)) { toast("Type the invoice number and a total like 1234.56."); return; }
    if (m.by.id === user.id) { toast("You keyed this entry. A different person must check it."); return; }
    const match = normNo(no) === normNo(m.entry.invoice_no) && cents(tot) === cents(m.entry.total);
    if (record("manual.check", { doc: doc.id, entry_id: m.id, invoice_no: no, total: tot, match, before: "Waiting for a second check", after: match ? "Matched" : "Did not match" })) {
      render(); toast(match ? "Both match. The entry is ready to check with Penny." : "It does not match. The entry stays on hold until it is fixed or checked again.");
    }
  });
  main.addEventListener("dragover", (ev) => { const z = ev.target.closest("#m-drop"); if (z) { ev.preventDefault(); z.classList.add("drag"); } });
  main.addEventListener("dragleave", (ev) => { const z = ev.target.closest("#m-drop"); if (z) z.classList.remove("drag"); });
  main.addEventListener("drop", (ev) => { const z = ev.target.closest("#m-drop"); if (z) { ev.preventDefault(); z.classList.remove("drag"); addEvidence(ev.dataTransfer.files); } });
  main.addEventListener("keydown", (ev) => { if (ev.target.id === "m-drop" && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); $("#m-files").click(); } });
}
