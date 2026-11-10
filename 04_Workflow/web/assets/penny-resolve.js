/* Penny web app: The urgency order, suggested fixes, and the dialogs for resolving, reassigning, approving and notes.
   Sections: urgency (v1.5), suggested fixes, dialogs. */
"use strict";

// ------------------------------------------------------------------ urgency (v1.5)
/* My work puts the most urgent holds first: a blocker past its target date, then a bill past or near its due date
   (bill date plus payment terms from Rules), then how long it has been held. Each row says why it is where it is. */
function addDays(isoDate, n) { const t = Date.parse(`${isoDate}T00:00:00Z`); return isNaN(t) ? "" : new Date(t + n * 86400000).toISOString().slice(0, 10); }
function daysBetween(a, b) { const x = Date.parse(`${a}T00:00:00Z`), y = Date.parse(`${b}T00:00:00Z`); return isNaN(x) || isNaN(y) ? 0 : Math.round((y - x) / 86400000); }
function billDue(d) {
  const days = (RULES().terms_days || {})[d.ex.terms_printed || ""];
  return d.date && Number.isFinite(days) ? addDays(d.date, days) : "";
}
function urgency(d) {
  const t = today();
  let score = 0;
  const why = [];
  const next = blockersOf(d).filter((b) => b.status !== "cleared" && b.due).sort((a, b) => (a.due < b.due ? -1 : 1))[0];
  if (next) {
    const n = daysBetween(t, next.due);
    if (n < 0) { score += 1000 + Math.min(-n, 400); why.push({ text: `Blocker ${plural(-n, "day")} overdue`, level: "late" }); }
    else if (n <= 2) { score += 600 - n * 50; why.push({ text: n === 0 ? "Blocker due today" : `Blocker due in ${plural(n, "day")}`, level: "soon" }); }
  }
  const due = billDue(d);
  if (due) {
    const n = daysBetween(t, due);
    if (n < 0) { score += 300 + Math.min(-n, 200); why.push({ text: `Bill ${plural(-n, "day")} past due`, level: "late" }); }
    else if (n <= 7) { score += 250 - n * 10; why.push({ text: n === 0 ? "Bill due today" : `Bill due in ${plural(n, "day")}`, level: "soon" }); }
    else score += Math.max(0, 120 - n);
  }
  const run = X.runById[d.cur.run_id];
  // Older runs did not record when they ran; then the age is counted from the bill date, and the tag says so.
  const ran = run && run.started_at && !isNaN(new Date(run.started_at)) ? todayIn(tz(), new Date(run.started_at)) : "";
  const since = ran || d.date;
  const age = since ? Math.max(0, daysBetween(since, t)) : 0;
  score += Math.min(age, 90) + Math.abs(d.amount) / 1e8;
  if (age && why.length < 2) why.push({ text: ran ? `Held ${plural(age, "day")}` : `${plural(age, "day")} since the bill date`, level: "" });
  return { score, why: why.slice(0, 2), due };
}
const urgencyTags = (d) => { const u = urgency(d); return u.why.length ? `<div class="urgency">${u.why.map((w) => `<span class="due-tag ${w.level}">${esc(w.text)}</span>`).join("")}</div>` : ""; };

// ------------------------------------------------------------------ suggested fixes
/* Penny suggests ready-made resolutions for a held invoice. They come from how people resolved the same kind of hold
   before (same main reason; same vendor counts extra; a fix that was later reopened counts against it), plus a
   built-in playbook so there is help before any history exists. Suggestions only speed up a person's action: Penny's
   own decision never changes, and a cleared invoice is still checked from scratch on the next run.
   Guardrail: payment-instruction changes are never cleared in one click; Treasury must confirm first. */
const GUARDED = new Set(["BANKCHG"]);
function playbook(d) {
  const text = (d.cur.reasons || []).join(" ");
  const po = (/Likely match[^:]*:\s*(PO[\w-]+)/.exec(text) || [])[1];
  const route = (c) => (RULES().routes || {})[c] || "";
  switch (d.primary) {
    case "OVERPO": return [{ outcome: "cleared", note: "PO change order approved by the Project Manager to cover the overage." },
      { outcome: "rejected", note: "Returned to the vendor to bill within the PO balance." }];
    case "NOPO": return [{ outcome: "cleared", note: po ? `Project Manager confirmed ${po}, Penny's likely match. Vendor will resend with the PO.` : "Project Manager confirmed the PO. Vendor will resend with it on the bill." }];
    case "COI": return [{ outcome: "cleared", note: "A current certificate of insurance is now on file." }];
    case "LIEN": return [{ outcome: "cleared", note: "Signed conditional lien waiver received, and it matches this payment." }];
    case "UNAPPCO": return [{ outcome: "rejected", note: "Returned to the subcontractor for a revised application without the unapproved change orders." }];
    case "NEWVEND": return [{ outcome: "reassign", route: route("NEWVEND"), note: "Vendor setup needed before this bill can be entered." },
      { outcome: "rejected", note: "Returned: this vendor is not approved to bill Hillpointe." }];
    case "BANKCHG": return [{ outcome: "cleared", guarded: true, note: "Treasury confirmed the new payment details by calling the phone number on file in the vendor master." }];
    default:
      if (/could not read this file|looks like a bill/i.test(text)) return [{ outcome: "rejected", note: "Asked the vendor for a clean PDF in their standard invoice layout." }];
      if (/not a Hillpointe legal entity/i.test(text)) return [{ outcome: "rejected", note: "Returned to the vendor for a corrected bill-to." }];
      if (/do not tie out/i.test(text)) return [{ outcome: "rejected", note: "Returned to the vendor: the totals on the invoice do not add up." }];
      return [];
  }
}
const sugKey = (x) => `${x.outcome}|${(x.route || "").toLowerCase()}|${String(x.note || "").trim().toLowerCase()}`;
function suggestionsFor(d) {
  if (!openHold(d)) return [];
  const scores = {};
  const add = (x, pts, source) => {
    const k = sugKey(x);
    const cur = scores[k] || (scores[k] = { ...x, score: 0, used: 0, sameVendor: false, source });
    cur.score += pts;
    if (source === "learned") { cur.source = "learned"; }
    return cur;
  };
  const reopened = new Set(EV.filter((e) => e.type === "hold.reopen").map((e) => e.doc));
  for (const e of EV) {
    if (e.doc === d.id || !["hold.resolve", "hold.reassign"].includes(e.type)) continue;
    const other = X.docById[e.doc];
    if (!other || other.primary !== d.primary) continue;
    const x = e.type === "hold.reassign" ? { outcome: "reassign", route: e.route, note: e.note } : { outcome: e.outcome, note: e.note };
    if (GUARDED.has(d.primary) && x.outcome === "cleared") x.guarded = true;
    const same = other.vendorId && other.vendorId === d.vendorId;
    const c = add(x, 1 + (same ? 2 : 0) - (reopened.has(e.doc) ? 1.5 : 0), "learned");
    c.used += 1;
    c.sameVendor = c.sameVendor || same;
  }
  playbook(d).forEach((x) => add(x, 0.5, "playbook"));
  const current = routesFor(d.codes, d.id)[0];
  return Object.values(scores).filter((x) => x.score > 0 && !(x.outcome === "reassign" && x.route === current))
    .sort((a, b) => b.score - a.score).slice(0, 3);
}
const OUTCOME = { cleared: ["Clear for next run", "b-cleared", "redo"], rejected: ["Reject to vendor", "b-rejected", "x"], reassign: ["Reassign", "b-waiting", "clock"] };
function suggestionCard(d) {
  if (!can("resolve")) return "";
  const list = suggestionsFor(d);
  if (!list.length) return "";
  if (!suggestionCard.seen) suggestionCard.seen = new Set();
  if (!suggestionCard.seen.has(d.id)) { suggestionCard.seen.add(d.id); track("suggestion_shown", { code: d.primary, count: list.length, learned: list.filter((x) => x.source === "learned").length }); }
  return `<section class="card suggest" aria-labelledby="sug-h">
    <div class="suggest-head"><h2 id="sug-h">${bIcon("check")}Suggested fix</h2><span class="hint">Pick one to resolve this hold in one click. You can undo it.</span></div>
    <ul class="suggest-list">${list.map((x, n) => { const [label, cls, icon] = OUTCOME[x.outcome]; return `<li>
      <div class="suggest-main"><span class="badge ${cls}">${bIcon(icon)}${esc(label)}${x.route ? `: ${esc(x.route)}` : ""}</span>
        <p>${esc(x.note)}</p>
        <p class="suggest-why">${x.source === "learned" ? `Learned from ${plural(x.used, "past resolution")}${x.sameVendor ? ", including this vendor" : ""}` : "From Penny's playbook for this reason"}${x.guarded ? " · Needs Treasury's confirmation" : ""}</p></div>
      <button class="btn ${n === 0 ? "btn-accent" : ""}" type="button" data-apply="${esc(d.id)}" data-n="${n}">${x.guarded ? "Review and apply" : "Apply"}</button></li>`; }).join("")}</ul>
  </section>`;
}
function applySuggestion(id, n) {
  const d = X.docById[id];
  const x = d && suggestionsFor(d)[n];
  if (!x) return;
  const meta = { source: x.source, used: x.used || 0 };
  const commit = () => {
    const ev = x.outcome === "reassign"
      ? record("hold.reassign", { doc: id, route: x.route, note: x.note, suggestion: meta, before: routesFor(d.codes, d.id).join("; "), after: x.route })
      : record("hold.resolve", { doc: id, outcome: x.outcome, note: x.note, suggestion: meta, before: "On hold", after: x.outcome === "cleared" ? "Cleared for next run" : "Rejected" });
    if (!ev) return;
    track("suggestion_applied", { code: d.primary, outcome: x.outcome, source: x.source });
    render();
    toast(x.outcome === "reassign" ? `Reassigned to ${x.route}.` : x.outcome === "cleared" ? "Hold cleared for the next run." : "Rejected and returned to the vendor.", {
      label: "Undo", fn: () => {
        const e2 = x.outcome === "reassign"
          ? record("hold.reassign", { doc: id, route: ev.before, note: "Undid a suggested fix.", before: x.route, after: ev.before })
          : record("hold.reopen", { doc: id, note: "Undid a suggested fix.", before: ev.after, after: "On hold" });
        if (e2) { track("suggestion_undone", { code: d.primary, source: x.source }); render(); toast("Undone. The hold is open again."); }
      },
    });
  };
  if (!x.guarded) return commit();
  openDialog("Confirm before clearing", `${esc(d.vendor)} · ${esc(d.billNo)}. A change to payment instructions is how most invoice fraud starts.`,
    `<p class="a-note">${esc(x.note)}</p>
     <label class="check"><input type="checkbox" name="confirm" value="yes"> Treasury called the vendor at the phone number already on file in the vendor master, not a number from this invoice, and confirmed the change.</label>`,
    "Clear for next run", (fd) => { if (fd.get("confirm") !== "yes") return "Treasury's phone confirmation is required first."; commit(); return ""; });
}
/** One-line suggestion for queue tables, so the most likely fix is one click from the list. */
function inlineSuggestion(d) {
  if (!can("resolve")) return "";
  const x = suggestionsFor(d)[0];
  if (!x) return "";
  return `<div class="suggest-inline"><span class="hint">Suggested: ${esc(OUTCOME[x.outcome][0].toLowerCase())}${x.route ? ` to ${esc(x.route)}` : ""}</span>
    <button class="btn btn-sm" type="button" data-apply="${esc(d.id)}" data-n="0">${x.guarded ? "Review" : "Apply"}</button></div>`;
}

// ------------------------------------------------------------------ dialogs
function teamsList() {
  return [...new Set(Object.values(RULES().routes || {}))].sort();
}
function openDialog(title, lede, body, submitLabel, onSubmit, opts = {}) {
  const dlg = $("#dialog");
  dlg.classList.toggle("dialog-wide", !!opts.wide);
  dlg.innerHTML = `<form method="dialog" novalidate>
    <h2 id="dialog-title">${esc(title)}</h2>${lede ? `<p class="lede">${lede}</p>` : ""}
    ${body}
    <p class="form-error" id="dlg-error" role="alert" hidden></p>
    <div class="dialog-actions"><button type="button" class="btn" value="cancel" id="dlg-cancel">${esc(opts.cancelLabel || (opts.info ? "Close" : "Cancel"))}</button>
      ${opts.info ? "" : `<button type="submit" class="btn ${opts.danger ? "btn-danger" : "btn-accent"}" value="ok">${esc(submitLabel)}</button>`}</div>
  </form>`;
  const form = $("form", dlg);
  $("#dlg-cancel", dlg).addEventListener("click", () => { if (opts.onCancel) opts.onCancel(new FormData(form)); dlg.close(); });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = onSubmit(new FormData(form));
    if (err) { const el = $("#dlg-error", dlg); el.textContent = err; el.hidden = false; return; }
    dlg.close();
  });
  if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  const first = $("input:checked, input, select, textarea", dlg);
  if (first) first.focus();
}
const noteField = (label, required, placeholder) => `<div class="field"><label for="dlg-note">${esc(label)}${required ? "" : " (optional)"}</label>
  <textarea id="dlg-note" name="note" maxlength="1000" placeholder="${esc(placeholder || "")}" ${required ? "required" : ""}></textarea>
  <span class="hint">Saved to the audit trail with your name and the time.</span></div>`;
function needNote(fd, min) {
  const n = String(fd.get("note") || "").trim();
  return n.length < min ? `Please write at least ${min} characters, so the next person knows why.` : "";
}

function doAction(act, id, data = {}) {
  const d = X.docById[id];
  if (!d) return;
  const done = (msg) => { render(); toast(msg); };
  if (act === "blocker" || act === "blocker-clear" || act === "blocker-reopen") return blockerDialog(id, data.code, act === "blocker" ? "update" : act.slice(8));
  if (act === "recheck") return recheckDialog(id);
  if (act === "email-approval") return emailDialog({ kind: "approval", doc: d });
  if (act === "resolve") {
    const bs = blockerSummary(d);
    const open = bs ? bs.total - bs.done : 0;
    openDialog("Resolve this hold", `${esc(d.vendor)} · ${esc(d.billNo || d.id)} · ${esc(money(d.amount))}`,
      `${open && bs.done ? `<p class="form-warn">${plural(open, "blocker")} of ${bs.total} ${open === 1 ? "is" : "are"} still open. You can still resolve the hold; the blockers stay on record as they are.</p>` : ""}
      <div class="choice" role="radiogroup" aria-label="Outcome">
        <label><input type="radio" name="outcome" value="cleared" checked><b>Fixed: enter it on the next run</b><small>The problem is solved (for example a PO change order is approved). Penny will check it again from scratch.</small></label>
        <label><input type="radio" name="outcome" value="rejected"><b>Reject: return it to the vendor</b><small>Nothing goes into an import file. The vendor must send a corrected document.</small></label>
      </div>${noteField("What did you check or fix?", true, "For example: PM approved change order CO-14 for $2,000.")}`,
      "Save decision", (fd) => {
        const err = needNote(fd, 10); if (err) return err;
        const ev = record("hold.resolve", { doc: id, outcome: fd.get("outcome"), note: String(fd.get("note")).trim(),
          before: "On hold", after: fd.get("outcome") === "cleared" ? "Cleared for next run" : "Rejected" });
        if (ev) done(fd.get("outcome") === "cleared" ? "Hold cleared. Penny will check it again on the next run." : "Invoice rejected and returned to the vendor.");
        return "";
      });
  } else if (act === "reopen") {
    openDialog("Reopen this hold", "The earlier decision stays in the audit trail.", noteField("Why reopen it?", true), "Reopen hold", (fd) => {
      const err = needNote(fd, 5); if (err) return err;
      if (record("hold.reopen", { doc: id, note: String(fd.get("note")).trim(), before: STATUS[d.status].label, after: "On hold" })) done("Hold reopened.");
      return "";
    });
  } else if (act === "reassign") {
    const current = routesFor(d.codes, d.id).join("; ");
    openDialog("Reassign this hold", `Now with: <strong>${esc(current)}</strong>`,
      `<div class="field"><label for="dlg-team">Send it to</label><select id="dlg-team" name="route">${teamsList().map((t) =>
        `<option${t === current ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>${noteField("Why this team?", true)}`,
      "Reassign", (fd) => {
        const err = needNote(fd, 10); if (err) return err;
        if (fd.get("route") === current) return "Pick a different team, or cancel.";
        if (record("hold.reassign", { doc: id, route: fd.get("route"), note: String(fd.get("note")).trim(), before: current, after: fd.get("route") })) done(`Reassigned to ${fd.get("route")}.`);
        return "";
      });
  } else if (act === "approve") {
    const steps = approvalSteps(d).filter((st) => st.status !== "approved");
    openDialog("Review approval", `${esc(d.vendor)} · ${esc(d.billNo)} · ${esc(money(d.amount))}. Approve as the person named in each step.`,
      `<div class="field"><label for="dlg-step">Approval step</label><select id="dlg-step" name="step">${steps.map((st) =>
        `<option value="${esc(st.label)}">${esc(st.label)}${st.status === "sent back" ? " (sent back)" : ""}</option>`).join("")}</select></div>
      <div class="choice" role="radiogroup" aria-label="Decision">
        <label><input type="radio" name="decision" value="approve" checked><b>Approve</b><small>I reviewed the bill and its coding.</small></label>
        <label><input type="radio" name="decision" value="sendback"><b>Send back</b><small>Something needs fixing before this is paid. A note is required.</small></label>
      </div>${noteField("Note", false, "Required when sending back.")}`,
      "Save", (fd) => {
        const back = fd.get("decision") === "sendback";
        if (back) { const err = needNote(fd, 10); if (err) return err; }
        const ev = record(back ? "bill.sendback" : "bill.approve", { doc: id, step: fd.get("step"), note: String(fd.get("note") || "").trim(),
          before: "Waiting", after: back ? "Sent back" : "Approved" });
        if (ev) done(back ? "Sent back with your note." : `Approved as ${fd.get("step")}.`);
        return "";
      });
  } else if (act === "note") {
    openDialog("Add a note", `${esc(d.vendor)} · ${esc(d.billNo || d.id)}`, noteField("Note", true), "Add note", (fd) => {
      const err = needNote(fd, 3); if (err) return err;
      if (record("note.add", { doc: id, note: String(fd.get("note")).trim() })) done("Note added.");
      return "";
    });
  }
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
  return `<dl class="kv">${pairs.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v, wide, src]) =>
    `<div${wide ? ' class="wide"' : ""}><dt>${esc(k)}</dt><dd>${v}${src ? srcBtn(src, k) : ""}</dd></div>`).join("")}</dl>`;
}
/** A small button that shows where a value appears on the PDF (only when this invoice has a PDF to show). */
const srcBtn = (key, label) => (SRC.doc && SRC.doc.pdf ? `<button type="button" class="src-btn" data-src="${esc(key)}" aria-label="Show on page: ${esc(label)}">Show on page</button>` : "");
function tabRead(d) {
  const ex = d.ex;
  SRC.doc = d;
  if (!ex || !ex.kind) return `<p class="empty">No extracted data for this document.</p>`;
  if (ex.kind === "unreadable") return `<p>${esc(ex.unreadable_reason)}</p>`;
  const bill = ex.bill_to || {};
  const remit = ex.remit_to || {};
  const out = [];
  out.push(kvs([
    ["Document type", esc(KIND[ex.kind] || ex.kind)],
    ["Invoice number", esc(ex.invoice_no), false, "invoice_no"],
    ["Date", esc(fmtDate(ex.date)), false, "date"],
    ["Printed terms", esc(ex.terms_printed), false, "terms"],
    ["Customer ref", esc(ex.customer_ref), false, "customer_ref"],
    ["Vendor (as printed)", esc(ex.vendor_name_raw), false, "vendor"],
    ["Bill to", esc([bill.name, bill.c_o && `c/o ${bill.c_o}`].filter(Boolean).join(", ")), false, "bill_to"],
    ["Ship to", esc(ex.ship_to), false, "ship_to"],
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
      ${ex.subtotal ? `<span class="t-label">Subtotal</span><span class="t-val">${esc(money(cents(ex.subtotal)))}${srcBtn("subtotal", "Subtotal")}</span>` : ""}
      ${ex.tax_total && cents(ex.tax_total) ? `<span class="t-label">${esc(ex.tax_label || "Tax")}</span><span class="t-val">${esc(money(cents(ex.tax_total)))}${srcBtn("tax", "Tax")}</span>` : ""}
      <span class="t-label grand">Total</span><span class="t-val grand">${esc(money(cents(ex.total)))}${srcBtn("total", "Total")}</span></div>`);
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
      ["Current payment due", `<strong>${esc(money(cents(pa.current_due)))}</strong>`, false, "current_due"],
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
      r.decision === "DUP" ? "Duplicates are never coded or written to an import file." : "This run skipped the file because it was already processed. See History for the run that wrote it."}</p>`);
  }
  const d = X.docById[r.doc_id];
  const a = d && d.cur === r ? approvalSummary(d) : null;
  if (a) {
    out.push(`<h3 class="sub-h">Required approvals · ${a.done} of ${a.total} done</h3>
      <div class="progress" role="img" aria-label="${a.done} of ${a.total} approvals done" style="margin-bottom:10px"><span style="width:${(a.done / a.total) * 100}%"></span></div>
      <ul class="approvals">${a.steps.map((st) => `<li><span class="who-line"><b>${esc(st.label)}</b>${st.by ? `<small>${esc(st.status === "approved" ? "Approved" : "Sent back")} by ${esc(st.by.name)} · ${esc(fmtDateTime(st.at))}${st.note ? ` · “${esc(st.note)}”` : ""}</small>` : "<small>Waiting for sign-off</small>"}</span>
        <span class="badge ${st.status === "approved" ? "b-approved" : st.status === "sent back" ? "b-rejected" : "b-waiting"}">${st.status === "approved" ? "Approved" : st.status === "sent back" ? "Sent back" : "Waiting"}</span></li>`).join("")}</ul>`);
  } else {
    const approvers = (r.approvers || []).length ? r.approvers : [...new Set(erows.map((e) => e.Approver).filter(Boolean))];
    if (approvers.length) out.push(`<h3 class="sub-h">Required approvers</h3><ul class="notes">${approvers.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
  }
  return out.join("");
}

function activityList(events, withTarget) {
  return `<ol class="activity">${events.map((e) => `<li><span class="avatar av-${esc(e.user.role)}" aria-hidden="true">${esc(e.user.initials)}</span><div>
    <div class="a-head"><b>${esc(e.user.name)}</b><span>${esc(describeEvent(e))}${withTarget && e.doc && X.docById[e.doc] ? ` on <a href="#/invoices/${esc(e.doc)}">${esc(X.docById[e.doc].vendor)} ${esc(X.docById[e.doc].billNo)}</a>` : ""}</span><time datetime="${esc(e.at)}">${esc(fmtDateTime(e.at))}</time></div>
    ${e.note ? `<p class="a-note">${esc(e.note)}</p>` : ""}</div></li>`).join("")}</ol>`;
}
function describeEvent(e) {
  switch (e.type) {
    case "hold.resolve": return e.outcome === "cleared" ? "cleared the hold for the next run" : "rejected it and returned it to the vendor";
    case "hold.reopen": return "reopened the hold";
    case "hold.reassign": return `reassigned it to ${e.route}`;
    case "bill.approve": return `approved as ${e.step}`;
    case "bill.sendback": return `sent it back as ${e.step}`;
    case "note.add": return "added a note";
    case "rules.update": return `changed ${plural(e.changes.length, "rule")}`;
    case "rules.revert": return "undid a rule change";
    case "batch.upload": return `uploaded ${plural(e.count || (e.files || []).length, "invoice")} to ${e.folder}`;
    case "batch.run": return `${e.dry_run ? "previewed" : "ran"} batch ${e.batch}`;
    case "export.download": return `downloaded ${(FILE_INFO[e.file] || { title: e.file }).title}`;
    case "export.imported": return `marked ${(FILE_INFO[e.file] || { title: e.file }).title} as imported, reference ${e.ref}`;
    case "export.confirmed": return `confirmed the import of ${(FILE_INFO[e.file] || { title: e.file }).title}`;
    case "export.undo": return `marked ${(FILE_INFO[e.file] || { title: e.file }).title} as not imported`;
    case "blocker.update": return `updated the ${e.code} blocker: ${e.after}`;
    case "blocker.clear": return `verified and cleared the ${e.code} blocker${(e.files || []).length ? ` with ${plural(e.files.length, "file")}` : ""}`;
    case "blocker.reopen": return `reopened the ${e.code} blocker`;
    case "manual.keyed": return `keyed the invoice by hand (${e.entry.invoice_no}, ${money(cents(e.entry.total))}) from ${plural((e.evidence || []).length, "evidence file")}`;
    case "manual.check": return e.match ? "checked the manual entry by keying it again: it matched" : "checked the manual entry by keying it again: it did not match";
    case "manual.saved": return `saved the manual entry to ${e.folder}`;
    default: return EVENT_LABEL[e.type] || e.type;
  }
}
function tabHistory(d, shown) {
  const people = EV.filter((e) => e.doc === d.id).slice().reverse();
  return `${people.length ? `<h3 class="sub-h" style="margin-top:0">What people did</h3>${activityList(people)}<h3 class="sub-h">What Penny did</h3>` : ""}
    <p style="color:var(--text-2);margin-bottom:14px">Every run that read <strong>${esc(d.file)}</strong>, oldest first.</p>
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
      <div class="pdf-bar"><span>${ICON.doc.replace("<svg", '<svg style="width:16px;height:16px;vertical-align:-3px;margin-right:6px"')}${esc(d.file)}<span class="pdf-pages-count"></span></span>
        <button type="button" class="btn btn-sm src-all" data-src-all aria-pressed="false" hidden>Highlight what Penny read</button>
        <a href="${esc(d.pdf)}" target="_blank" rel="noopener">Open in new tab ${ICON.ext.replace("<svg", '<svg style="width:14px;height:14px;vertical-align:-2px"')}</a></div>
      <div class="pdf-pages" data-pdf="${esc(d.pdf)}" data-file="${esc(d.file)}" tabindex="0" aria-label="Pages of ${esc(d.file)}">
        <p class="pdf-status" role="status">Loading the invoice…</p></div>
    </aside>`;
  }
  return `<aside class="card pdf-panel" aria-label="Invoice PDF"><div class="pdf-missing">${ICON.doc}
    <h2>The PDF is not in this build</h2>
    <p>Everything Penny read from <strong>${esc(d.file)}</strong> is on the left. To show the original here, export with the package folder:</p>
    <code>./penny web-export --package ~/Downloads/Hillpointe_AP_Technical_Screen</code></div></aside>`;
}

/* PDFs are drawn with PDF.js (bundled in assets/vendor), so every browser shows them the same way,
   including phones that cannot show a PDF inside a page. Loaded only when an invoice is opened. */
const PDFJS = "assets/vendor/pdfjs-3.11.174/";
let pdfjsReady = null;
function loadPdfJs() {
  if (!pdfjsReady) {
    pdfjsReady = new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = PDFJS + "pdf.min.js";
      tag.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; resolve(window.pdfjsLib); };
      tag.onerror = () => { pdfjsReady = null; reject(new Error("PDF reader did not load")); };
      document.head.appendChild(tag);
    });
  }
  return pdfjsReady;
}
async function renderPdf(box) {
  const url = box.dataset.pdf, file = box.dataset.file;
  const width = box.clientWidth - 24;
  if (width <= 0 || box.dataset.width === String(width)) return;
  box.dataset.width = String(width);
  try {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument(url).promise;
    const canvases = [], texts = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: (width / base.width) * ratio });
      const c = document.createElement("canvas");
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      c.setAttribute("role", "img");
      c.setAttribute("aria-label", `Page ${n} of ${pdf.numPages} of ${file}`);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      const wrap = document.createElement("div");
      wrap.className = "pdf-page";
      const layer = document.createElement("div");
      layer.className = "pdf-hl-layer";
      layer.setAttribute("aria-hidden", "true");
      wrap.append(c, layer);
      canvases.push(wrap);
      try { texts.push(pageText(await page.getTextContent(), vp)); } catch (e) { texts.push([]); }
    }
    if (!document.body.contains(box)) return;
    box.replaceChildren(...canvases);
    SRC.pages = texts;
    SRC.file = file;
    const hasText = texts.some((t) => t.length);
    const all = box.parentElement.querySelector("[data-src-all]");
    if (all) all.hidden = !hasText;
    paintSources(box);
    box.dataset.pages = String(pdf.numPages);
    const count = box.parentElement.querySelector(".pdf-pages-count");
    if (count) count.textContent = ` · ${plural(pdf.numPages, "page")}`;
  } catch (e) {
    box.innerHTML = `<p class="pdf-status">This browser could not draw the PDF. <a href="${esc(url)}" target="_blank" rel="noopener">Open ${esc(file)} in a new tab</a>.</p>`;
  }
}
// ------------------------------------------------------------------ where values appear on the page (v1.9)
/* Penny's reader works from the PDF's text. This finds where each value it read appears on the page and draws a box
   there, so a reviewer can check a number against the original in one glance. Positions come from the PDF's own text
   layer; nothing is guessed. A value that is not printed as such (a due date Penny worked out, or text split across
   lines) is reported as not found. Scanned pictures and manual entries have no text layer, so there is nothing to show. */
const SRC = { doc: null, file: "", pages: [], all: false, pick: "" };
/** One page's text as lines, each item with its place on the page as a share of the page (0 to 1). */
function pageText(tc, vp) {
  const items = tc.items.filter((i) => i.str && i.str.trim()).map((i) => {
    const [x, y] = vp.convertToViewportPoint(i.transform[4], i.transform[5]);
    const h = (Math.hypot(i.transform[2], i.transform[3]) || i.height || 8) * vp.scale;
    return { s: i.str, x: x / vp.width, y: (y - h) / vp.height, w: (i.width * vp.scale) / vp.width, h: h / vp.height };
  });
  const lines = [];
  for (const it of items.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < 0.004);
    if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
  }
  return lines.map((l) => {
    l.items.sort((a, b) => a.x - b.x);
    let text = "";
    const spans = l.items.map((it) => { if (text && !text.endsWith(" ")) text += " "; const at = text.length; text += it.s; return { it, at }; });
    return { text, low: text.toLowerCase(), spans };
  });
}
/** Every place a piece of text appears: [{ page, line, x, y, w, h }]. */
function findText(value) {
  const v = String(value || "").trim().toLowerCase();
  const out = [];
  if (v.length < 2) return out;
  SRC.pages.forEach((lines, page) => lines.forEach((line) => {
    let from = 0, at;
    while ((at = line.low.indexOf(v, from)) >= 0) {
      const end = at + v.length;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const { it, at: s0 } of line.spans) {
        const s1 = s0 + it.s.length;
        if (s1 <= at || s0 >= end) continue;
        const a = Math.max(at, s0) - s0, b = Math.min(end, s1) - s0, per = it.w / Math.max(it.s.length, 1);
        x0 = Math.min(x0, it.x + a * per); x1 = Math.max(x1, it.x + b * per);
        y0 = Math.min(y0, it.y); y1 = Math.max(y1, it.y + it.h);
      }
      if (x1 > x0) out.push({ page, line, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      from = end;
    }
  }));
  return out;
}
const usDate = (isoDate) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate || ""); return m ? `${m[2]}/${m[3]}/${m[1]}` : ""; };
const moneyForms = (v) => { const c = cents(v); if (!c && !v) return []; const n = (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return [`$${n}`, n]; };
/** What can be looked up for this document: key -> { label, values to try, a hint that picks the right line }. */
function sourceTargets(d) {
  const ex = d.ex || {}, pa = ex.pay_app || {};
  const t = {
    invoice_no: { label: "Invoice number", values: [ex.invoice_no], near: /invoice no|credit memo no|application no/ },
    date: { label: "Date", values: [usDate(ex.date)], near: /\bdate\b/ },
    terms: { label: "Printed terms", values: [ex.terms_printed], near: /\bterms\b/ },
    customer_ref: { label: "Customer ref", values: [ex.customer_ref], near: /customer ref/ },
    vendor: { label: "Vendor", values: [ex.vendor_name_raw], first: true },
    bill_to: { label: "Bill to", values: [(ex.bill_to || {}).name], first: true },
    ship_to: { label: "Ship to", values: [ex.ship_to, String(ex.ship_to || "").split(",")[0]], first: true },
    subtotal: { label: "Subtotal", values: moneyForms(ex.subtotal), near: /subtotal/ },
    tax: { label: "Tax", values: moneyForms(ex.tax_total), near: /tax/ },
    total: { label: "Total", values: moneyForms(ex.total), near: /total|amount due|balance due/, not: /subtotal/ },
    current_due: { label: "Current payment due", values: moneyForms(pa.current_due), near: /current payment due/ },
  };
  (ex.lines || []).forEach((l, i) => { t[`line-${i}`] = { label: `Line ${i + 1} amount`, values: moneyForms(l.amount), near: new RegExp(String(l.desc || "").slice(0, 14).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }; });
  return t;
}
/** Where one value is on the page. A hint (the label printed beside it) picks the right place when it appears more than once. */
function locate(target) {
  for (const v of target.values || []) {
    let hits = findText(v);
    if (!hits.length) continue;
    if (target.near) {
      const good = hits.filter((h) => target.near.test(h.line.low) && !(target.not && target.not.test(h.line.low)));
      if (good.length) hits = good;
    }
    if (target.first || target.near) hits = hits.slice(0, target.near ? hits.length : 1);
    return hits;
  }
  return [];
}
function paintSources(box) {
  box = box || $(".pdf-pages[data-pages]");
  if (!box || !SRC.doc) return;
  const layers = $$(".pdf-hl-layer", box);
  layers.forEach((l) => (l.innerHTML = ""));
  const targets = sourceTargets(SRC.doc);
  const keys = SRC.all ? Object.keys(targets) : SRC.pick ? [SRC.pick] : [];
  let first = null;
  for (const key of keys) {
    for (const h of locate(targets[key])) {
      const el = document.createElement("div");
      el.className = `pdf-hl${key === SRC.pick ? " on" : ""}`;
      el.style.cssText = `left:${(h.x * 100 - 0.4).toFixed(2)}%;top:${(h.y * 100 - 0.25).toFixed(2)}%;width:${(h.w * 100 + 0.8).toFixed(2)}%;height:${(h.h * 100 + 0.5).toFixed(2)}%`;
      el.dataset.key = key;
      if (key === SRC.pick) el.innerHTML = `<span>${esc(targets[key].label)}</span>`;   // one label at a time; all at once would overlap
      if (layers[h.page]) layers[h.page].appendChild(el);
      if (key === SRC.pick && !first) first = el;
    }
  }
  const all = box.parentElement.querySelector("[data-src-all]");
  if (all) all.setAttribute("aria-pressed", String(SRC.all));
  return first;
}
/** "Show on page" for one value: draw its box, bring it into view, and say so for people who cannot see it. */
function showSource(key) {
  const box = $(".pdf-pages[data-pages]");
  const target = SRC.doc && sourceTargets(SRC.doc)[key];
  if (!box || !target) { toast("The PDF is still loading. Try again in a moment."); return; }
  if (!SRC.pages.some((p) => p.length)) { toast("This file has no text layer (a scanned picture or a file Penny could not read), so there is nothing to point to."); return; }
  const n = locate(target).length;
  track("source_shown", { key: key.startsWith("line-") ? "line" : key, found: n > 0 });
  if (!n) { SRC.pick = ""; paintSources(box); toast(`${target.label} was not found as printed text on the page. Check it against the PDF by eye.`); return; }
  SRC.pick = key;
  const el = paintSources(box);
  if (el) el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  toast(`${target.label} is highlighted on the page${n > 1 ? ` (${n} places)` : ""}.`);
}
function toggleAllSources() {
  SRC.all = !SRC.all;
  if (!SRC.all) SRC.pick = "";
  paintSources();
  if (SRC.all) track("source_all", {});
}

let pdfResize = null;
window.addEventListener("resize", () => {
  clearTimeout(pdfResize);
  pdfResize = setTimeout(() => $$(".pdf-pages[data-pages]").forEach((b) => renderPdf(b)), 250);
});
