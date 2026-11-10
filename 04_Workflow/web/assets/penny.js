/* Penny web view.
   Reads data/penny-data.json, written by `./penny web-export`. Penny's decisions are shown exactly as Penny made them;
   the web view never re-decides an invoice. People act on those decisions (resolve holds, approve bills, change rules),
   and every action is recorded as an event in an append-only audit log. In this demo the log lives in the visitor's
   browser (localStorage); on a real server it would live in a database and every action would be checked there too. */
(() => {
  "use strict";

  // ------------------------------------------------------------------ vocabulary
  /* What each Penny result means, in words that never overstate it. Penny writes files; it does not post or pay.
     ENTER_INTACCT = a row in the Intacct import file a person uploads. ENTER_ENTRATA = a row in the Entrata handoff list. */
  const STATUS = {
    ENTER_INTACCT: { label: "Ready for Intacct import", short: "Ready to import", cls: "b-ok", icon: "check" },
    ENTER_ENTRATA: { label: "In Entrata handoff", short: "Ready to hand off", cls: "b-ok", icon: "check" },
    HOLD: { label: "Needs review", short: "Needs review", cls: "b-hold", icon: "alert" },
    DUP: { label: "Duplicate stopped", short: "Duplicate", cls: "b-dup", icon: "stop" },
    SKIP_ALREADY_ENTERED: { label: "Skipped, already processed", short: "Skipped", cls: "b-skip", icon: "minus" },
    REPLACED: { label: "Replaced by revision", short: "Replaced", cls: "b-skip", icon: "minus" },
    CLEARED: { label: "Cleared for next run", short: "Cleared", cls: "b-cleared", icon: "redo" },
    REJECTED: { label: "Rejected to vendor", short: "Rejected", cls: "b-rejected", icon: "x" },
  };
  const STATUS_ORDER = ["ENTER_INTACCT", "ENTER_ENTRATA", "HOLD", "CLEARED", "REJECTED", "DUP", "SKIP_ALREADY_ENTERED", "REPLACED"];
  const STATUS_GROUPS = [
    { key: "entered", label: "Ready to import", match: (s) => s === "ENTER_INTACCT" || s === "ENTER_ENTRATA" },
    { key: "hold", label: "Needs review", match: (s) => s === "HOLD" },
    { key: "dup", label: "Duplicate stopped", match: (s) => s === "DUP" },
    { key: "skip", label: "Skipped", match: (s) => s === "SKIP_ALREADY_ENTERED" },
    { key: "replaced", label: "Replaced", match: (s) => s === "REPLACED" },
    { key: "cleared", label: "Cleared by a person", match: (s) => s === "CLEARED" },
    { key: "rejected", label: "Rejected by a person", match: (s) => s === "REJECTED" },
  ];
  /* Exception codes in plain language: what it means, why it happens, and what to do next. The code stays visible
     as secondary detail, because it is what the AP policy and the exception log use. */
  const CODES = {
    BANKCHG: { name: "Bank change", plain: "Payment instructions may have changed",
      help: "Payment instructions changed. Treasury confirms by phone.",
      why: "The document mentions new banking details, or its remit-to address or phone number differs from the vendor master. This is how most invoice fraud starts.",
      next: "Treasury calls the vendor at the phone number already on file in the vendor master, never the number on the invoice. Only Treasury updates banking details." },
    NEWVEND: { name: "New vendor", plain: "Vendor is not in the vendor master",
      help: "The vendor is not in the vendor master.",
      why: "Penny could not match the vendor's name to an active vendor record.",
      next: "The Vendor Master team sets the vendor up (tax form, insurance, banking) or matches it to an existing record. Penny never creates or guesses a vendor ID." },
    DUP: { name: "Duplicate", plain: "This bill was already billed",
      help: "The same bill is already in the ERP history or an earlier import file.",
      why: "The same vendor and invoice number (after cleaning up formatting like INV- prefixes and leading zeros) is already in the ERP history or an earlier import file.",
      next: "The AP Manager confirms it is a resend or reminder and closes it. Nothing is paid twice." },
    UNAPPCO: { name: "Unapproved change order", plain: "Bills a change order that is not approved",
      help: "A pay application bills a change order that is not executed.",
      why: "A pay application includes change order work that is not executed in the change order log.",
      next: "The Project Manager confirms, and the subcontractor sends a revised application without the unapproved amount." },
    COI: { name: "Insurance certificate", plain: "Insurance certificate missing or expired",
      help: "The certificate of insurance is missing or expired.",
      why: "The vendor's certificate of insurance was not valid on the bill date (after any grace days in the rules).",
      next: "Construction Compliance gets a current certificate before the bill is released." },
    LIEN: { name: "Lien waiver", plain: "Lien waiver missing or does not match",
      help: "The lien waiver is missing or does not match.",
      why: "A pay application needs a conditional lien waiver for the same amount and period. It is missing, promised later, or does not match.",
      next: "Construction Compliance gets a correct, signed waiver from the subcontractor." },
    NOPO: { name: "No PO", plain: "No valid purchase order or subcontract",
      help: "No valid purchase order or subcontract.",
      why: "Construction bills must reference an open PO or subcontract for the right vendor and project. None was found on the document.",
      next: "The Project Manager confirms the PO (Penny may suggest a likely match) and the vendor resends the bill with it." },
    OVERPO: { name: "Over PO", plain: "Goes over the purchase order balance",
      help: "The bill goes over the PO balance plus tolerance.",
      why: "This bill would push the total billed past the PO amount by more than the tolerance in the rules. Credits already entered are counted.",
      next: "The Project Manager and Supply Chain approve a PO change order, or the vendor corrects the bill." },
    OTHER: { name: "Other", plain: "Needs a person to look",
      help: "Any other reason a person needs to look.",
      why: "Something else does not fit the rules: numbers that do not tie out, a bill-to that is not a Hillpointe entity, an unknown layout, an unreadable file, and more. The reason says which.",
      next: "The AP Manager reads Penny's reason and decides what happens next." },
  };
  const KIND = { invoice: "Invoice", pay_app: "Pay application", credit_memo: "Credit memo", other: "Other document", unreadable: "Unreadable file" };
  const CATEGORY = { construction: "Construction", stabilized: "Stabilized community", corporate: "Corporate" };
  const ROLES = {
    viewer: { name: "Viewer", can: [], blurb: "can see everything and change nothing." },
    clerk: { name: "AP Clerk", can: ["resolve", "note", "upload"], blurb: "can resolve and reassign holds, add notes, and upload and preview new batches." },
    approver: { name: "Approver", can: ["approve", "note"], blurb: "can approve or send back bills that are ready to import, and add notes." },
    admin: { name: "Admin", can: ["resolve", "note", "approve", "rules", "upload", "run"], blurb: "can do everything, including changing rules and running batches for real." },
  };
  /** Which permission each kind of event needs. Checked again when the event is recorded (defense in depth). */
  const EVENT_NEEDS = {
    "hold.resolve": "resolve", "hold.reopen": "resolve", "hold.reassign": "resolve",
    "bill.approve": "approve", "bill.sendback": "approve", "note.add": "note",
    "rules.update": "rules", "rules.revert": "rules",
    "batch.upload": "upload", "batch.run": "upload",
  };
  const EVENT_LABEL = {
    "hold.resolve": "Resolved a hold", "hold.reopen": "Reopened a hold", "hold.reassign": "Reassigned a hold",
    "bill.approve": "Approved a bill", "bill.sendback": "Sent a bill back", "note.add": "Added a note",
    "rules.update": "Changed rules", "rules.revert": "Undid a rule change", "run": "Penny ran a batch",
    "batch.upload": "Uploaded a batch", "batch.run": "Ran a batch", "batch.created": "Created a batch folder", "batch.uploaded": "Uploaded a batch", "batch.run_failed": "A batch run failed",
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
  /** A total that stays honest when some amounts could not be read: never shows an unread amount as $0.00. */
  const amountKnown = (d) => !!d.amount || !!(d.ex && d.ex.total !== null && d.ex.total !== undefined && d.ex.total !== "");
  function amountLabel(list) {
    const known = list.filter(amountKnown), unknown = list.length - known.length;
    const total = money(known.reduce((a, d) => a + d.amount, 0));
    if (!list.length) return money(0);
    if (!known.length) return unknown === 1 ? "amount unavailable" : "amounts unavailable";
    return unknown ? `${total} plus ${unknown} not read` : total;
  }
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
  const BADGE_ICON = {
    check: '<path d="M4.5 10.5l3.5 3.5 7.5-8"/>',
    alert: '<path d="M10 6v5M10 14v.01"/><circle cx="10" cy="10" r="7.5"/>',
    stop: '<circle cx="10" cy="10" r="7.5"/><path d="M5 15L15 5"/>',
    minus: '<path d="M5 10h10"/>',
    redo: '<path d="M15 6v4h-4"/><path d="M15 10a5.5 5.5 0 1 1-1.6-3.9"/>',
    x: '<path d="M6 6l8 8M14 6l-8 8"/>',
    clock: '<circle cx="10" cy="10" r="7.5"/><path d="M10 6v4l2.5 2"/>',
  };
  const bIcon = (name) => `<svg viewBox="0 0 20 20" aria-hidden="true">${BADGE_ICON[name] || ""}</svg>`;
  const badge = (status, big) => {
    const s = STATUS[status] || { label: status, cls: "b-skip", icon: "minus" };
    return `<span class="badge ${s.cls}${big ? " badge-lg" : ""}">${bIcon(s.icon)}${esc(s.label)}</span>`;
  };
  /** Where Penny's output goes. Kept visually separate from workflow status. */
  const destTag = (decision) => decision === "ENTER_INTACCT" ? `<span class="dest-tag" title="Written to the Intacct import file. A person uploads it.">Intacct import file</span>`
    : decision === "ENTER_ENTRATA" ? `<span class="dest-tag" title="Written to the Entrata handoff. Property Accounting posts it.">Entrata handoff</span>` : "";
  /** How sure Penny is. Shown as Penny's own word, never turned into a percentage. */
  const confChip = (level) => `<span class="conf-chip conf-${esc(String(level).toLowerCase())}" title="Penny's confidence in this result">
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 15v-2M8 15V9M12 15V6M16 15V3" class="cb"/></svg>Confidence: ${esc(level)}</span>`;
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

  /** The rules in effect: Penny's rules.json plus any saved changes from the rules editor. */
  const RULES = () => S.rules || D.rules || {};
  function primaryCode(codes) {
    const pr = RULES().code_priority || [];
    return pr.find((c) => codes.includes(c)) || codes[0] || "";
  }
  /** Who a hold goes to. A person can reassign one hold; otherwise the routes in the rules apply. */
  function routesFor(codes, docId) {
    const h = docId && S.holds[docId];
    if (h && h.route) return [h.route];
    const pr = RULES().code_priority || [];
    const routes = RULES().routes || {};
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
        id: doc.id, file: doc.file, pdf: doc.pdf, ex, hist, cur, vendor, vendorKnown: !!cur.vendor_name,
        pennyStatus: replacement ? "REPLACED" : cur.decision, status: replacement ? "REPLACED" : cur.decision,
        replacedBy: replacement ? { doc: replacement.doc_id, run: replacement.run_id } : null,
        vendorId: cur.vendor_id, billNo: cur.bill_no || ex.invoice_no || "", date: cur.bill_date || ex.date || "",
        amount: cur._amount, codes: cur.codes || [], primary: primaryCode(cur.codes || []), category: cur.category || "",
        kind: ex.kind || "", hay,
      };
    }).sort((a, b) => a.id.localeCompare(b.id));
    return { runById, byRun, byDoc, docs, docById: Object.fromEntries(docs.map((d) => [d.id, d])) };
  }

  // ------------------------------------------------------------------ state: who is signed in, and the sandbox
  const store = {
    get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* nothing to remove */ } },
  };
  let user = null;              // { id, name, role, title, initials } from PennyAuth
  let role = "viewer";
  const can = (action) => !!user && ROLES[user.role].can.includes(action);

  const SANDBOX_KEY = "penny.sandbox.v1";
  let EV = [];                  // the audit log: every human action, oldest first, never edited
  let S = { holds: {}, approvals: {}, notes: {}, rules: null, revoked: new Set() };

  function loadSandbox() {
    try {
      const j = JSON.parse(store.get(SANDBOX_KEY, "null"));
      EV = j && Array.isArray(j.events) ? j.events.filter((e) => e && e.type && e.user) : [];
    } catch (e) { EV = []; }
  }
  function saveSandbox() {
    if (!store.set(SANDBOX_KEY, JSON.stringify({ version: 1, events: EV }))) {
      toast("This browser blocked saving, so your changes last only until you reload.");
    }
  }
  function newId() {
    const b = new Uint8Array(8);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }
  function setPath(obj, path, value) {
    const keys = path.split(".");
    let o = obj;
    keys.slice(0, -1).forEach((k) => (o = o[k] = o[k] || {}));
    o[keys[keys.length - 1]] = value;
  }
  function getPath(obj, path) { return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj); }

  /** Record one action. The role is checked here again, not just by hiding buttons. */
  function record(type, data) {
    const need = EVENT_NEEDS[type];
    if (!user || !need || !can(need)) { toast("Your role cannot do that."); return null; }
    if (!PennyAuth.currentUser()) { endSession("expired"); return null; }
    PennyAuth.touch();
    const ev = { id: newId(), at: new Date().toISOString(), type,
      user: { id: user.id, name: user.name, role: user.role, initials: user.initials }, ...data };
    EV.push(ev);
    saveSandbox();
    derive();
    track("action", { kind: type, code: data.doc && X.docById[data.doc] ? X.docById[data.doc].primary : undefined,
      seconds: data.doc && openedAt[data.doc] ? Math.round((Date.now() - openedAt[data.doc]) / 1000) : undefined,
      suggestion: data.suggestion ? data.suggestion.source : undefined });
    return ev;
  }

  /** Rebuild the current state by replaying the audit log over Penny's results. */
  function derive() {
    const revoked = new Set(EV.filter((e) => e.type === "rules.revert").map((e) => e.target));
    const holds = {}, approvals = {}, notes = {};
    const rules = JSON.parse(JSON.stringify(D.rules || {}));
    for (const e of EV) {
      if (e.type === "hold.resolve") holds[e.doc] = { ...(holds[e.doc] || {}), outcome: e.outcome, by: e.user, at: e.at, note: e.note };
      else if (e.type === "hold.reopen" && holds[e.doc]) holds[e.doc] = { route: holds[e.doc].route };
      else if (e.type === "hold.reassign") holds[e.doc] = { ...(holds[e.doc] || {}), route: e.route };
      else if (e.type === "bill.approve" || e.type === "bill.sendback") {
        (approvals[e.doc] = approvals[e.doc] || {})[e.step] = { status: e.type === "bill.approve" ? "approved" : "sent back", by: e.user, at: e.at, note: e.note };
      } else if (e.type === "note.add") (notes[e.doc] = notes[e.doc] || []).push(e);
      else if (e.type === "rules.update" && !revoked.has(e.id)) e.changes.forEach((c) => setPath(rules, c.path, c.after));
    }
    S = { holds, approvals, notes, rules, revoked };
    if (X) X.docs.forEach((d) => (d.status = humanStatus(d)));
    updateWorkCount();
  }
  function humanStatus(d) {
    const h = S.holds[d.id];
    if (d.pennyStatus === "HOLD" && h && h.outcome) return h.outcome === "cleared" ? "CLEARED" : "REJECTED";
    return d.pennyStatus;
  }

  /** The sign-offs an entered bill needs, and where each one stands. */
  function approvalSteps(d) {
    if (!d || !d.pennyStatus.startsWith("ENTER_")) return [];
    const r = d.cur;
    const labels = (r.approvers || []).length ? r.approvers : [...new Set((r.entrata_rows || []).map((e) => e.Approver).filter(Boolean))];
    const got = S.approvals[d.id] || {};
    return labels.map((label) => ({ label, ...(got[label] || { status: "waiting" }) }));
  }
  function approvalSummary(d) {
    const steps = approvalSteps(d);
    if (!steps.length) return null;
    const done = steps.filter((s) => s.status === "approved").length;
    const back = steps.some((s) => s.status === "sent back");
    return { steps, done, total: steps.length, state: back ? "sent back" : done === steps.length ? "approved" : "waiting" };
  }
  function approvalChip(d) {
    const a = approvalSummary(d);
    if (!a) return "";
    if (a.state === "approved") return `<span class="badge b-approved">${bIcon("check")}Approved</span>`;
    if (a.state === "sent back") return `<span class="badge b-rejected">${bIcon("x")}Sent back</span>`;
    return `<span class="badge b-waiting">${bIcon("clock")}${a.done} of ${a.total} approvals</span>`;
  }
  const openHold = (d) => d.pennyStatus === "HOLD" && !(S.holds[d.id] || {}).outcome;
  function myWork() {
    if (!user) return { holds: [], approvals: [] };
    return {
      holds: can("resolve") ? X.docs.filter(openHold) : [],
      approvals: can("approve") ? X.docs.filter((d) => { const a = approvalSummary(d); return a && a.state === "waiting"; }) : [],
    };
  }
  function updateWorkCount() {
    const el = $("#work-count");
    if (!el || !X) return;
    const w = myWork();
    const n = w.holds.length + w.approvals.length;
    el.textContent = String(n);
    el.hidden = !n;
  }

  /** A short message. With an action (like Undo) it stays a little longer and the button is keyboard reachable. */
  function toast(msg, action) {
    let t = $("#toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.className = "toast";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" class="toast-btn">${esc(action.label)}</button>` : ""}`;
    if (action) $(".toast-btn", t).addEventListener("click", () => { t.classList.remove("show"); action.fn(); });
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), action ? 8000 : 2600);
  }

  // ------------------------------------------------------------------ usage insights (local, privacy-safe)
  /* What is recorded: which screens are used, which actions are taken and how long they took, whether suggestions were
     shown, applied or undone, searches and help searches that found nothing, shortcuts and errors.
     What is never recorded: note text, passwords, names typed into forms, or anything that identifies a real person.
     It stays in this browser, can be turned off, cleared or downloaded, and is shaped so a server could collect the
     same events later. */
  const USAGE_KEY = "penny.usage.v1", USAGE_OFF = "penny.usage.off", USAGE_MAX = 3000;
  const usageOn = () => store.get(USAGE_OFF, "") !== "1";
  function usageEvents() {
    try { const j = JSON.parse(store.get(USAGE_KEY, "null")); return j && Array.isArray(j.events) ? j.events : []; } catch (e) { return []; }
  }
  function track(type, props = {}) {
    if (!usageOn()) return;
    const ev = { t: new Date().toISOString(), type, role: user ? user.role : "signed-out", ...props };
    const list = usageEvents();
    list.push(ev);
    store.set(USAGE_KEY, JSON.stringify({ version: 1, events: list.slice(-USAGE_MAX) }));
  }
  const openedAt = {};          // invoice id -> when it was opened, for time-to-decision

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
    return `<div class="table-wrap"><table class="data">
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
            ? `<td><span class="reason-plain">${esc((CODES[d.primary] || CODES.OTHER).plain)}</span>${d.codes.length > 1 ? `<span class="sub">and ${plural(d.codes.length - 1, "more reason")}</span>` : ""}<span class="sub">Next: ${esc(routes.join("; "))}</span><div class="chips" style="margin-top:4px">${d.codes.map(codeChip).join("")}</div>${opt.suggest ? inlineSuggestion(d) : ""}</td>`
            : `<td>${badge(d.status)}${opt.run ? "" : approvalChip(d)}${d.replacedBy && d.status === "REPLACED" ? `<span class="sub">by ${esc(d.replacedBy.doc)}</span>` :
                d.codes.length && d.status !== "DUP" ? `<div class="chips" style="margin-top:6px">${d.codes.map(codeChip).join("")}</div>` : ""}</td>`}
          <td class="num">${!d.amount && !(d.ex && d.ex.total) ? `<span class="hint">Not read</span>` : esc(money(d.amount))}</td>
        </tr>`;
      }).join("")}</tbody>
      ${opt.footer ? `<tfoot><tr class="tfoot"><td>${plural(rows.length, "invoice")}</td><td class="hide-sm"></td><td></td><td class="num">${esc(amountLabel(rows))}</td></tr></tfoot>` : ""}
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
    const seg = [{ key: "", label: "All", n: res.length }, ...STATUS_GROUPS.map((g) => ({ key: g.key, label: g.label, n: res.filter((x) => g.match(x.decision)).length }))]
      .filter((g) => g.n || !g.key);
    return `
      ${head(esc(r.label), `${esc(r.started_at ? fmtDateTime(r.started_at) + " · " : "")}Batch folder <code>${esc(r.batch)}</code> · run ID <code>${esc(r.id)}</code>`,
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
      <div class="filter-summary" aria-live="polite"><span>${plural(rows.length, "invoice")}${active ? ` match${rows.length === 1 ? "es" : ""} ${plural(active, "filter")}` : ""}</span><span class="num">${esc(amountLabel(rows))} face value</span></div>
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
          <div class="status-strip">${badge(isCurrent ? d.status : r.decision, true)}${destTag(r.decision)}${isCurrent ? approvalChip(d) : ""}${confChip(r.confidence)}</div>
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
                  `<button class="btn" data-act="reassign" data-doc="${esc(d.id)}">Reassign</button>`);
      }
    }
    const a = approvalSummary(d);
    if (a && can("approve") && a.steps.some((st) => st.status !== "approved")) {
      btns.push(`<button class="btn btn-accent" data-act="approve" data-doc="${esc(d.id)}">Review approval</button>`);
    }
    if (can("note")) btns.push(`<button class="btn" data-act="note" data-doc="${esc(d.id)}">Add a note</button>`);
    const lock = ICON.lock.replace("<svg", '<svg style="width:15px;height:15px;vertical-align:-3px;margin-right:6px"');
    return `<section class="card actions" aria-label="Actions">
      <span class="who">${lock}Signed in as ${esc(user.name)}, ${esc(article(ROLES[user.role].name))}. You ${esc(ROLES[user.role].blurb)}</span>
      ${btns.join("")}
    </section>`;
  }

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
      <div class="dialog-actions"><button type="button" class="btn" value="cancel" id="dlg-cancel">${opts.info ? "Close" : "Cancel"}</button>
        ${opts.info ? "" : `<button type="submit" class="btn ${opts.danger ? "btn-danger" : "btn-accent"}" value="ok">${esc(submitLabel)}</button>`}</div>
    </form>`;
    const form = $("form", dlg);
    $("#dlg-cancel", dlg).addEventListener("click", () => dlg.close());
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

  function doAction(act, id) {
    const d = X.docById[id];
    if (!d) return;
    const done = (msg) => { render(); toast(msg); };
    if (act === "resolve") {
      openDialog("Resolve this hold", `${esc(d.vendor)} · ${esc(d.billNo || d.id)} · ${esc(money(d.amount))}`,
        `<div class="choice" role="radiogroup" aria-label="Outcome">
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
      const canvases = [];
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
        canvases.push(c);
      }
      if (!document.body.contains(box)) return;
      box.replaceChildren(...canvases);
      box.dataset.pages = String(pdf.numPages);
      const count = box.parentElement.querySelector(".pdf-pages-count");
      if (count) count.textContent = ` · ${plural(pdf.numPages, "page")}`;
    } catch (e) {
      box.innerHTML = `<p class="pdf-status">This browser could not draw the PDF. <a href="${esc(url)}" target="_blank" rel="noopener">Open ${esc(file)} in a new tab</a>.</p>`;
    }
  }
  let pdfResize = null;
  window.addEventListener("resize", () => {
    clearTimeout(pdfResize);
    pdfResize = setTimeout(() => $$(".pdf-pages[data-pages]").forEach((b) => renderPdf(b)), 250);
  });

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
  /* ---------------------------------------------------------------- rules editor
     One schema describes every setting in rules.json: its label, help text, kind of editor and validation. Admins
     edit a draft copy; nothing changes until they save with a reason. Saved changes are audit events and can be
     undone. Penny reads the saved rules on its next run; past decisions never change. */
  const RULE_FIELDS = [
    ...Object.entries(THRESHOLDS).map(([k, [label, help, kind]]) => ({ path: `thresholds.${k}`, label, help, type: kind, group: "thresholds" })),
    { path: "code_priority", label: "Exception code priority", help: "When an invoice has several reasons, the highest one is shown first and decides its main route.", type: "order", group: "codes" },
    ...Object.keys(CODES).map((c) => ({ path: `routes.${c}`, label: `Team for ${c}`, help: "", type: "text", group: "codes", max: 140 })),
    { path: "terms_days", label: "Payment terms", help: "How many days each term gives. Due dates are worked out from these.", type: "terms", group: "terms" },
    { path: "payment_change_phrases", label: "Payment-change warning words", help: "If a document contains any of these, it goes to Treasury.", type: "words", group: "words" },
    { path: "duplicate_stamps", label: "Duplicate stamps", help: "Watermarks that suggest a resend, mentioned on duplicates.", type: "words", group: "words", upper: true },
    { path: "legal_bill_to_aliases.extra", label: "Extra approved bill-to names", help: "Other names that count as a Hillpointe legal entity on the bill-to line.", type: "words", group: "words" },
    { path: "entrata_gl_keywords", label: "Entrata GL by description", help: "For apartment community bills: description words, and the Entrata GL they map to.", type: "glmap", group: "coding" },
    { path: "corporate.gl_keywords", label: "Corporate GL by description", help: "For corporate bills: description words, and the GL account they map to.", type: "glmap", group: "coding" },
    { path: "corporate.one_time_keywords", label: "One-time service words", help: "Lines with these words are one-time services, posted 100% to the one-time entity.", type: "words", group: "coding" },
    { path: "corporate.subscription_keywords", label: "Subscription words", help: "Lines with these words are subscriptions, split by the allocation table.", type: "words", group: "coding" },
    { path: "corporate.default_entity", label: "Corporate default entity", help: "", type: "code", group: "posting" },
    { path: "corporate.one_time_acct", label: "One-time services account", help: "", type: "code", group: "posting" },
    { path: "corporate.one_time_entity", label: "One-time services entity", help: "", type: "code", group: "posting" },
    { path: "construction.posting_entity", label: "Construction posting entity", help: "", type: "code", group: "posting" },
    { path: "construction.department", label: "Construction department", help: "", type: "code", group: "posting" },
    { path: "construction.retainage_acct", label: "Retainage account", help: "", type: "code", group: "posting" },
    { path: "llm.enabled_by_default", label: "AI reader on by default", help: "Lets Claude read layouts the rules parser does not know. It was built and tested offline but never run live, so leave it off unless you have an API key.", type: "bool", group: "posting" },
  ];
  const FIELD = Object.fromEntries(RULE_FIELDS.map((f) => [f.path, f]));
  /** Turn a typed number into a stored value, or return an error message. Percent is typed as 10 and stored as 0.10. */
  function parseSetting(kind, raw) {
    const n = Number(raw);
    if (raw === "" || !isFinite(n) || n < 0) return { err: "must be a number of zero or more" };
    if (kind === "pct") return n > 100 ? { err: "must be 100% or less" } : { val: Math.round(n * 100) / 10000 };
    if (kind === "days") return Number.isInteger(n) && n <= 365 ? { val: n } : { err: "must be a whole number of days up to 365" };
    return { val: Math.round(n * 100) / 100 };
  }
  let ruleDraft = {};           // { rules: draft copy while editing, raw: typed number text by path }
  const draftRules = () => ruleDraft.rules || RULES();
  function startDraft() { if (!ruleDraft.rules) ruleDraft = { rules: JSON.parse(JSON.stringify(RULES())), raw: {} }; return ruleDraft.rules; }

  function fieldErrors(f, v, raw) {
    if (["money", "pct", "days"].includes(f.type)) {
      if (raw === undefined) return "";
      const p = parseSetting(f.type, raw);
      return p.err ? `${f.label} ${p.err}` : "";
    }
    if (f.type === "text" || f.type === "code") {
      const t = String(v ?? "").trim();
      if (!t) return `${f.label} cannot be empty`;
      if (f.type === "code" && !/^[A-Za-z0-9_-]{1,20}$/.test(t)) return `${f.label} must be a short code with letters, numbers, dashes or underscores`;
      if (t.length > (f.max || 140)) return `${f.label} is too long`;
      return "";
    }
    if (f.type === "words") {
      const list = (v || []).map((w) => String(w).trim().toLowerCase());
      if (list.some((w) => !w)) return `${f.label} has an empty entry`;
      if (new Set(list).size !== list.length) return `${f.label} has the same entry twice`;
      return "";
    }
    if (f.type === "glmap") return (v || []).some(([kw, gl]) => !String(kw).replace(/\|/g, "").trim() || !String(gl).trim()) ? `${f.label}: every row needs words and a GL` : "";
    if (f.type === "terms") {
      const names = Object.keys(v || {});
      if (names.some((n) => !n.trim())) return "Every payment term needs a name";
      if (Object.values(v || {}).some((d) => !Number.isInteger(d) || d < 0 || d > 365)) return "Payment term days must be whole numbers from 0 to 365";
      return "";
    }
    return "";
  }
  function draftChanges() {
    if (!ruleDraft.rules) return { changes: [], errors: [] };
    const changes = [], errors = [];
    for (const f of RULE_FIELDS) {
      const before = getPath(RULES(), f.path), after = getPath(ruleDraft.rules, f.path);
      const err = fieldErrors(f, after, (ruleDraft.raw || {})[f.path]);
      if (err) { errors.push(err); continue; }
      if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ path: f.path, before, after, label: f.label });
    }
    return { changes, errors };
  }
  /** A short, readable value for history, audit and previews. */
  function fmtRuleValue(path, v) {
    const f = FIELD[path] || { type: "text" };
    if (["money", "pct", "days"].includes(f.type)) return fmtSetting(v, f.type);
    if (f.type === "bool") return v ? "On" : "Off";
    if (f.type === "order") return (v || []).join(" > ");
    if (f.type === "words") return (v || []).length ? (v.length > 4 ? `${v.slice(0, 4).join(", ")} and ${v.length - 4} more` : v.join(", ")) : "none";
    if (f.type === "glmap") return plural((v || []).length, "keyword rule");
    if (f.type === "terms") return Object.entries(v || {}).map(([n, d]) => `${n}: ${d}`).join(", ");
    return String(v ?? "");
  }
  /** What exactly changed in a list, in words a reviewer can scan. */
  function describeChange(c) {
    const f = FIELD[c.path] || { type: "text" };
    if (f.type === "words") {
      const b = new Set(c.before || []), a = new Set(c.after || []);
      const add = [...a].filter((x) => !b.has(x)), del = [...b].filter((x) => !a.has(x));
      return `${c.label}: ${[add.length ? `added ${add.map((x) => `“${x}”`).join(", ")}` : "", del.length ? `removed ${del.map((x) => `“${x}”`).join(", ")}` : ""].filter(Boolean).join("; ") || "reordered"}`;
    }
    if (f.type === "glmap") {
      const key = (r) => `${r[0]} → ${r[1]}`;
      const b = new Set((c.before || []).map(key)), a = new Set((c.after || []).map(key));
      const add = [...a].filter((x) => !b.has(x)), del = [...b].filter((x) => !a.has(x));
      return `${c.label}: ${[add.length ? `added ${add.join(", ")}` : "", del.length ? `removed ${del.join(", ")}` : ""].filter(Boolean).join("; ")}`;
    }
    return `${c.label}: ${fmtRuleValue(c.path, c.before)} → ${fmtRuleValue(c.path, c.after)}`;
  }

  /** What a rules change would do to the invoices already on file. Penny's past decisions never change; this is a forecast. */
  function impactOf(changes) {
    const items = [];
    const entered = X.docs.filter((d) => d.pennyStatus.startsWith("ENTER_"));
    for (const c of changes) {
      const key = c.path.split(".")[1];
      if (c.path === "thresholds.overpo_tolerance") {
        const over = X.docs.filter((d) => openHold(d) && d.codes.includes("OVERPO")).map((d) => {
          const m = /over by \$([\d,]+\.\d{2})/.exec((d.cur.reasons || []).join(" "));
          return { d, by: m ? cents(m[1]) : null };
        });
        const freed = over.filter((o) => o.by !== null && o.by <= cents(c.after));
        items.push({ title: `${c.label}: ${fmtRuleValue(c.path, c.before)} → ${fmtRuleValue(c.path, c.after)}`, lines: [
          ...freed.map((o) => `${o.d.vendor} ${o.d.billNo} (over by ${money(o.by)}) would ${o.d.codes.length > 1 ? "lose its OVERPO hold but stay held for other reasons" : "no longer be held"}.`),
          ...(freed.length ? [] : [`No open over-PO hold would be released (${plural(over.length, "open OVERPO hold")} on file).`]),
          ...(c.after < c.before ? ["A lower tolerance can hold bills that passed before. Penny checks that on its next run."] : []),
        ] });
      } else if (["cfo_bill_over", "vp_construction_gross_over", "regional_pm_invoice_over"].includes(key)) {
        const who = { cfo_bill_over: "the CFO", vp_construction_gross_over: "the VP Construction", regional_pm_invoice_over: "the Regional PM" }[key];
        const basis = (d) => key === "vp_construction_gross_over" ? (d.ex.pay_app ? cents(d.ex.pay_app.this_period_gross) : null)
          : key === "regional_pm_invoice_over" ? (d.category === "stabilized" ? d.amount : null) : d.amount;
        const lines = [];
        for (const d of entered) {
          const b = basis(d);
          if (b === null) continue;
          const was = b > cents(c.before), now = b > cents(c.after);
          if (was !== now) lines.push(`${d.vendor} ${d.billNo} (${money(b)}) would ${now ? "now need" : "no longer need"} ${who}.`);
        }
        items.push({ title: `${c.label}: ${fmtRuleValue(c.path, c.before)} → ${fmtRuleValue(c.path, c.after)}`,
          lines: lines.length ? lines : [`No bill on file would change who signs off.`] });
      } else if (c.path.startsWith("routes.")) {
        const code = c.path.slice(7);
        const hit = X.docs.filter((d) => openHold(d) && d.codes.includes(code) && !(S.holds[d.id] || {}).route);
        items.push({ title: `Route for ${code} (${(CODES[code] || {}).name || code})`, lines: [
          `${plural(hit.length, "open hold")} with ${code} would go to “${c.after}” instead of “${c.before}”.`] });
      } else if (c.path === "code_priority") {
        const rank = (list, x) => (list.includes(x) ? list.indexOf(x) : 99);
        const top = (list, codes) => [...codes].sort((a, b) => rank(list, a) - rank(list, b))[0];
        const moved = X.docs.filter((d) => openHold(d) && d.codes.length > 1 && top(c.before, d.codes) !== top(c.after, d.codes));
        items.push({ title: "Exception code priority", lines: moved.length
          ? moved.map((d) => `${d.vendor} ${d.billNo} would show “${(CODES[top(c.after, d.codes)] || {}).plain}” first instead of “${(CODES[top(c.before, d.codes)] || {}).plain}”.`)
          : ["No open hold would show a different main reason."] });
      } else {
        items.push({ title: describeChange(c), lines: ["Penny applies this on its next run. This preview cannot estimate it from the saved results."] });
      }
    }
    return items;
  }
  function impactHtml(changes) {
    if (!changes.length) return "";
    return `<ul class="impact">${impactOf(changes).map((i) => `<li><b>${esc(i.title)}</b>${i.lines.map((l) => `<div>${esc(l)}</div>`).join("")}</li>`).join("")}</ul>`;
  }

  // editors -----------------------------------------------------------------------------------------------
  const isChanged = (path) => ruleDraft.rules && JSON.stringify(getPath(RULES(), path)) !== JSON.stringify(getPath(ruleDraft.rules, path));
  const fid = (path) => "rf-" + path.replace(/[^a-z0-9]+/gi, "-");
  function numEditor(f, v) {
    const raw = (ruleDraft.raw || {})[f.path];
    const shown = raw !== undefined ? raw : f.type === "pct" ? +(Number(v) * 100).toFixed(4) : v;
    const unitL = f.type === "money" ? '<span class="unit" aria-hidden="true">$</span>' : "";
    const unitR = f.type === "pct" ? '<span class="unit" aria-hidden="true">%</span>' : f.type === "days" ? '<span class="unit" aria-hidden="true">days</span>' : "";
    const legacyId = f.path.startsWith("thresholds.") ? `in-${f.path.split(".")[1]}` : fid(f.path);
    return `<span class="unit-wrap">${unitL}<input id="${esc(legacyId)}" class="num-input${isChanged(f.path) ? " changed" : ""}" type="number" inputmode="decimal" min="0" step="${f.type === "days" ? 1 : 0.01}"
      data-num="${esc(f.path)}" data-kind="${esc(f.type)}" value="${esc(shown)}" aria-label="${esc(f.label)}">${unitR}</span>`;
  }
  const textEditor = (f, v) => `<input id="${esc(fid(f.path))}" class="text-input${f.type === "code" ? " code-input" : ""}${isChanged(f.path) ? " changed" : ""}" data-text="${esc(f.path)}" maxlength="${f.type === "code" ? 20 : f.max || 140}" value="${esc(v ?? "")}" aria-label="${esc(f.label)}">`;
  const boolEditor = (f, v) => `<label class="switch"><input type="checkbox" data-bool="${esc(f.path)}" ${v ? "checked" : ""}><span class="switch-ui" aria-hidden="true"></span><span>${v ? "On" : "Off"}</span></label>`;
  function wordsEditor(f, list) {
    return `<div class="words-edit${isChanged(f.path) ? " changed-box" : ""}">
      <ul class="chips word-chips" aria-label="${esc(f.label)}">${(list || []).map((w, i) => `<li class="chip word-chip">${esc(w)}<button type="button" class="chip-x" data-word-del="${esc(f.path)}" data-i="${i}" aria-label="Remove ${esc(w)}">×</button></li>`).join("")}</ul>
      <div class="word-add"><input class="text-input" data-word-input="${esc(f.path)}" maxlength="80" placeholder="Add a word or phrase" aria-label="Add to ${esc(f.label)}">
        <button type="button" class="btn btn-sm" data-word-add="${esc(f.path)}">Add</button></div></div>`;
  }
  function glmapEditor(f, rows) {
    return `<div class="map-edit${isChanged(f.path) ? " changed-box" : ""}">
      <div class="map-head" aria-hidden="true"><span>Description words (comma separated)</span><span>GL</span><span></span></div>
      ${(rows || []).map(([kw, gl], i) => `<div class="map-row">
        <input class="text-input" data-gl-kw="${esc(f.path)}" data-i="${i}" value="${esc(String(kw).split("|").join(", "))}" aria-label="Words for rule ${i + 1}">
        <input class="text-input code-input" data-gl-code="${esc(f.path)}" data-i="${i}" value="${esc(gl)}" maxlength="20" aria-label="GL for rule ${i + 1}">
        <button type="button" class="icon-btn" data-gl-del="${esc(f.path)}" data-i="${i}" aria-label="Remove rule ${i + 1}">×</button></div>`).join("")}
      <button type="button" class="btn btn-sm" data-gl-add="${esc(f.path)}">Add a keyword rule</button></div>`;
  }
  function termsEditor(f, obj) {
    return `<div class="map-edit${isChanged(f.path) ? " changed-box" : ""}">
      <div class="map-head" aria-hidden="true"><span>Term name</span><span>Days</span><span></span></div>
      ${Object.entries(obj || {}).map(([n, d], i) => `<div class="map-row">
        <input class="text-input" data-term-name="${i}" value="${esc(n)}" maxlength="30" aria-label="Term ${i + 1} name">
        <input class="text-input code-input" type="number" min="0" max="365" step="1" data-term-days="${i}" value="${esc(d)}" aria-label="Term ${i + 1} days">
        <button type="button" class="icon-btn" data-term-del="${i}" aria-label="Remove term ${esc(n)}">×</button></div>`).join("")}
      <button type="button" class="btn btn-sm" data-term-add>Add a payment term</button></div>`;
  }
  function orderEditor(list) {
    return `<ol class="order-edit${isChanged("code_priority") ? " changed-box" : ""}">${list.map((c, i) => `<li>
      <span class="rank">${i + 1}</span><span>${codeChip(c)} <span class="order-name">${esc((CODES[c] || {}).plain || c)}</span></span>
      <span class="order-btns"><button type="button" class="icon-btn" data-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Move ${esc(c)} up">↑</button>
      <button type="button" class="icon-btn" data-move="${i}" data-dir="1" ${i === list.length - 1 ? "disabled" : ""} aria-label="Move ${esc(c)} down">↓</button></span></li>`).join("")}</ol>`;
  }
  function readOnlyValue(f, v) {
    if (f.type === "words") return `<div class="chips">${(v || []).map((w) => `<span class="chip">${esc(w)}</span>`).join("") || '<span class="hint">None</span>'}</div>`;
    if (f.type === "glmap") return (v || []).map(([pat, gl]) => `<div class="kw-row"><span class="chips">${String(pat).split("|").map((p) => `<span class="chip">${esc(p)}</span>`).join("")}</span><code>${esc(gl)}</code></div>`).join("");
    if (f.type === "terms") return Object.entries(v || {}).map(([n, d]) => `<div class="setting"><span class="s-name">${esc(n)}</span><span class="s-val">${esc(plural(d, "day"))}</span></div>`).join("");
    return `<div class="s-val">${esc(fmtRuleValue(f.path, v))}</div>`;
  }

  function viewRules() {
    const R = draftRules();
    const editing = can("rules");
    const changedPaths = new Set(EV.filter((e) => e.type === "rules.update" && !S.revoked.has(e.id)).flatMap((e) => e.changes.map((c) => c.path)));
    const tag = (path) => changedPaths.has(path) ? `<span class="changed-tag" title="Changed from rules.json in this demo">Changed</span>` : "";
    const editor = (f) => {
      const v = getPath(R, f.path);
      if (!editing) return readOnlyValue(f, v);
      if (["money", "pct", "days"].includes(f.type)) return numEditor(f, v);
      if (f.type === "text" || f.type === "code") return textEditor(f, v);
      if (f.type === "bool") return boolEditor(f, v);
      if (f.type === "words") return wordsEditor(f, v);
      if (f.type === "glmap") return glmapEditor(f, v);
      if (f.type === "terms") return termsEditor(f, v);
      return readOnlyValue(f, v);
    };
    const row = (f) => `<div class="setting${["words", "glmap", "terms"].includes(f.type) ? " setting-block" : ""}"><div><label class="s-name" for="${esc(fid(f.path))}">${esc(f.label)}${tag(f.path)}</label>${f.help ? `<div class="s-help">${esc(f.help)}</div>` : ""}</div>${editor(f)}</div>`;
    const group = (g) => RULE_FIELDS.filter((f) => f.group === g);
    const pr = R.code_priority || [];
    const history = EV.filter((e) => e.type === "rules.update").slice().reverse();
    return `
      ${head("Rules", "Every business rule a person might want to change lives in one settings file, config/rules.json, not in the code.",
        `<button class="btn" id="download-rules" type="button">Download rules.json</button>`)}
      <div class="role-banner" role="note">
        <span>${editing
          ? `<strong>You can edit every rule.</strong> Change anything below and Penny shows what it would do to the invoices on file before you save. Saved changes apply to Penny's next run; past decisions stay as Penny made them.`
          : `<strong>Read only.</strong> Only Admins can change rules. Sign in as Sam Rivera (Admin) to try the editor.`}</span>
        <span class="pill">Source: config/rules.json</span>
      </div>
      <div class="grid rules-grid">
        <section class="card"><div class="card-head"><h2>Thresholds</h2><p>Dollar triggers and tolerances</p></div><div class="card-body">${group("thresholds").map(row).join("")}</div></section>
        <section class="card"><div class="card-head"><h2>Exception codes</h2><p>Priority and the team each one goes to</p></div><div class="card-body">
          ${editing ? `<h3 class="sub-h" style="margin-top:0">Priority, highest first${tag("code_priority")}</h3>${orderEditor(pr)}<h3 class="sub-h">Team for each code</h3>` : ""}
          <ul class="route-list">${pr.map((c, i) => { const f = FIELD[`routes.${c}`] || { path: `routes.${c}`, label: `Team for ${c}`, type: "text" }; return `<li><span class="rank">${i + 1}</span><span>${codeChip(c)}<br><span style="font-size:13px">${esc((CODES[c] || {}).plain || "")}</span></span>
            <span>${editing ? `<label class="sr-only" for="${esc(fid(f.path))}">Team for ${esc(c)}</label>${textEditor(f, getPath(R, f.path))}` : esc(getPath(R, f.path) || "")}${tag(f.path)}</span></li>`; }).join("")}</ul>
        </div></section>
      </div>
      <div class="grid rules-grid" style="margin-top:16px">
        <section class="card"><div class="card-head"><h2>Words Penny looks for</h2></div><div class="card-body">${group("words").map(row).join("")}</div></section>
        <section class="card"><div class="card-head"><h2>Coding by description</h2></div><div class="card-body">${group("coding").map(row).join("")}</div></section>
        <section class="card"><div class="card-head"><h2>Payment terms</h2></div><div class="card-body">${group("terms").map(row).join("")}</div></section>
        <section class="card"><div class="card-head"><h2>Posting and reading</h2></div><div class="card-body">${group("posting").map(row).join("")}</div></section>
      </div>
      ${editing ? `<div class="edit-bar" id="edit-bar" hidden></div>` : ""}
      ${history.length ? `<section class="card" style="margin-top:16px"><div class="card-head"><h2>Change history</h2><p>Newest first. Undo adds a new entry; nothing is erased.</p></div><div class="card-body">
        <ul class="approvals">${history.map((e) => `<li><span class="who-line"><b>${esc(e.changes.map(describeChange).join("; "))}</b>
          <small>${esc(e.user.name)} · ${esc(fmtDateTime(e.at))} · “${esc(e.note)}”</small></span>
          ${S.revoked.has(e.id) ? `<span class="badge b-skip">Undone</span>` : editing ? `<button class="btn" data-undo="${esc(e.id)}">Undo</button>` : `<span class="badge b-approved">In effect</span>`}</li>`).join("")}</ul>
      </div></section>` : ""}`;
  }

  let rulesBound = false;
  function bindRules() {
    const dl = $("#download-rules");
    if (dl) dl.addEventListener("click", () => download("rules.json", JSON.stringify(RULES(), null, 2) + "\n", "application/json"));
    if (!$("#edit-bar")) return;
    paintRulesBar();
    if (rulesBound) return;          // #main outlives each render, so its listeners are attached once
    rulesBound = true;
    bindRulesEditor();
  }
  function paintRulesBar() {
      const bar = $("#edit-bar");
      if (!bar) return;
      const { changes, errors } = draftChanges();
      bar.hidden = !changes.length && !errors.length;
      bar.innerHTML = errors.length ? `<div style="flex:1"><strong>Fix this before saving:</strong><ul class="notes">${errors.map((x) => `<li class="form-error">${esc(x)}.</li>`).join("")}</ul></div><button class="btn" type="button" id="rules-discard">Discard changes</button>`
        : `<div style="flex:1;min-width:240px"><strong>${plural(changes.length, "unsaved change")}.</strong> What it would do to the invoices on file:${impactHtml(changes)}</div>
           <div style="display:flex;gap:8px"><button class="btn" type="button" id="rules-discard">Discard</button><button class="btn btn-accent" type="button" id="rules-save">Save changes</button></div>`;
      const disc = $("#rules-discard", bar);
      if (disc) disc.addEventListener("click", () => { ruleDraft = {}; render(); });
      const save = $("#rules-save", bar);
      if (save) save.addEventListener("click", () => openDialog("Save rule changes", "Saved changes apply to Penny's next run. You can undo them later.",
        `<ul class="impact">${changes.map((c) => `<li>${esc(describeChange(c))}</li>`).join("")}</ul>${noteField("Why are you making this change?", true, "For example: Controller approved a $1,000 PO tolerance for Q4.")}`,
        "Save changes", (fd) => {
          const err = needNote(fd, 10); if (err) return err;
          if (record("rules.update", { changes, note: String(fd.get("note")).trim() })) { ruleDraft = {}; render(); toast(`Saved ${plural(changes.length, "rule change")}.`); }
          return "";
        }));
  }
  function bindRulesEditor() {
    const main = $("#main");
    const onRules = () => !!$("#edit-bar");
    const rerender = (focusSel) => { render(); if (focusSel) { const el = $(focusSel); if (el) el.focus(); } };
    const paint = paintRulesBar;
    const mark = (el, path) => el.classList.toggle("changed", !!isChanged(path));
    main.addEventListener("input", (e) => {
      if (!onRules()) return;
      const t = e.target;
      if (t.dataset.num) {
        const f = FIELD[t.dataset.num]; const d = startDraft();
        ruleDraft.raw[f.path] = t.value;
        const p = parseSetting(f.type, t.value);
        if (!p.err) setPath(d, f.path, p.val);
        mark(t, f.path);
      } else if (t.dataset.text) { setPath(startDraft(), t.dataset.text, t.value.trim()); mark(t, t.dataset.text); }
      else if (t.dataset.glKw !== undefined && t.dataset.glKw) {
        const rows = getPath(startDraft(), t.dataset.glKw);
        rows[+t.dataset.i][0] = t.value.split(",").map((w) => w.trim()).filter(Boolean).join("|");
      } else if (t.dataset.glCode) { getPath(startDraft(), t.dataset.glCode)[+t.dataset.i][1] = t.value.trim(); }
      else if (t.dataset.termName !== undefined || t.dataset.termDays !== undefined) {
        const d = startDraft();
        const names = $$("[data-term-name]", main).map((x) => x.value.trim());
        const days = $$("[data-term-days]", main).map((x) => (x.value === "" ? NaN : Number(x.value)));
        d.terms_days = Object.fromEntries(names.map((n, i) => [n, days[i]]));
      } else return;
      paint();
    });
    main.addEventListener("change", (e) => {
      if (!onRules()) return;
      const t = e.target;
      if (t.dataset.bool) { setPath(startDraft(), t.dataset.bool, t.checked); rerender(`[data-bool="${t.dataset.bool}"]`); }
    });
    const addWord = (path) => {
      const inp = $(`[data-word-input="${path}"]`, main);
      const f = FIELD[path];
      let w = inp.value.trim();
      if (!w) { inp.focus(); return; }
      if (f.upper) w = w.toUpperCase();
      const d = startDraft();
      const list = getPath(d, path) || [];
      if (list.some((x) => x.toLowerCase() === w.toLowerCase())) { toast(`“${w}” is already on the list.`); inp.select(); return; }
      setPath(d, path, [...list, w]);
      rerender(`[data-word-input="${path}"]`);
    };
    main.addEventListener("keydown", (e) => { if (onRules() && e.key === "Enter" && e.target.dataset.wordInput) { e.preventDefault(); addWord(e.target.dataset.wordInput); } });
    main.addEventListener("click", (e) => {
      if (!onRules()) return;
      const b = e.target.closest("button");
      if (!b || !main.contains(b)) return;
      const d = () => startDraft();
      if (b.dataset.wordAdd) addWord(b.dataset.wordAdd);
      else if (b.dataset.wordDel) { const list = getPath(d(), b.dataset.wordDel).slice(); list.splice(+b.dataset.i, 1); setPath(d(), b.dataset.wordDel, list); rerender(`[data-word-input="${b.dataset.wordDel}"]`); }
      else if (b.dataset.glAdd) { const rows = getPath(d(), b.dataset.glAdd) || []; rows.push(["", ""]); setPath(d(), b.dataset.glAdd, rows); rerender(`[data-gl-kw="${b.dataset.glAdd}"][data-i="${rows.length - 1}"]`); }
      else if (b.dataset.glDel) { const rows = getPath(d(), b.dataset.glDel); rows.splice(+b.dataset.i, 1); rerender(`[data-gl-add="${b.dataset.glDel}"]`); }
      else if (b.dataset.termAdd !== undefined) { const t = d().terms_days; let n = "New term", k = 2; while (t[n] !== undefined) n = `New term ${k++}`; t[n] = 30; rerender(`[data-term-name="${Object.keys(t).length - 1}"]`); }
      else if (b.dataset.termDel !== undefined) { const t = d().terms_days; delete t[Object.keys(t)[+b.dataset.termDel]]; rerender("[data-term-add]"); }
      else if (b.dataset.move !== undefined) {
        const list = d().code_priority; const i = +b.dataset.move, to = i + +b.dataset.dir;
        [list[i], list[to]] = [list[to], list[i]];
        rerender(`[data-move="${to}"][data-dir="${b.dataset.dir}"]`);
      }
    });
  }
  function undoRule(id) {
    const e = EV.find((x) => x.id === id && x.type === "rules.update");
    if (!e || S.revoked.has(id)) return;
    openDialog("Undo this rule change", esc(e.changes.map((c) => `${c.label}: back to ${fmtRuleValue(c.path, c.before)}`).join("; ")),
      noteField("Why undo it?", true), "Undo change", (fd) => {
        const err = needNote(fd, 5); if (err) return err;
        if (record("rules.revert", { target: id, note: String(fd.get("note")).trim(),
          changes: e.changes.map((c) => ({ ...c, before: c.after, after: c.before })) })) { ruleDraft = {}; render(); toast("Change undone."); }
        return "";
      }, { danger: true });
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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
                <a class="btn btn-sm" href="${esc(f.path)}" download="${esc(friendlyName(r, f))}" aria-label="Download ${esc(info.title)} for ${esc(r.label)}">Download</a></div>
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

  // ------------------------------------------------------------------ new batch
  /* Upload a folder of invoices and run Penny on it. Running needs Penny's engine, which only the local server has
     (./penny web --package ...). The public demo lets people try every step and says plainly what would happen. */
  let SERVER = null;            // { mode: "local", engine, today, max_mb } when served by ./penny web
  const QUICK_NAMES = ["weekly-ap", "month-end", "vendor-resends", "corrections"];
  const NB = { name: "", files: [], mode: "preview", busy: false, result: null, error: "" };
  const slug = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const today = () => (SERVER && SERVER.today) || new Date().toISOString().slice(0, 10);
  const fmtBytes = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 102.4) / 10} KB` : `${Math.round(n / 104857.6) / 10} MB`;
  const knownHashes = () => Object.fromEntries(Object.values(D.documents).map((d) => [(d.extracted || {}).sha256, d.id]).filter(([h]) => h));
  const maxBytes = () => ((SERVER && SERVER.max_mb) || 25) * 1048576;

  async function addFiles(fileList) {
    const known = knownHashes();
    for (const file of Array.from(fileList)) {
      const item = { file, name: file.name, bytes: file.size, state: "checking", note: "" };
      NB.files.push(item);
      paintBatch();
      if (!/\.pdf$/i.test(file.name)) { item.state = "bad"; item.note = "Not a PDF file"; continue; }
      if (file.size > maxBytes()) { item.state = "bad"; item.note = `Larger than ${fmtBytes(maxBytes())}`; continue; }
      if (NB.files.filter((f) => f.name.toLowerCase() === file.name.toLowerCase()).length > 1) { item.state = "bad"; item.note = "Same file name twice"; continue; }
      try {
        const head = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
        if (!head.trimStart().startsWith("%PDF")) { item.state = "bad"; item.note = "Not really a PDF"; continue; }
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), (b) => b.toString(16).padStart(2, "0")).join("");
        item.sha256 = hash;
        if (known[hash]) { item.state = "warn"; item.note = `Already read as ${known[hash]}. Penny will skip or flag it.`; }
        else if (NB.files.some((f) => f !== item && f.sha256 === hash)) { item.state = "bad"; item.note = "Same file added twice"; }
        else { item.state = "ok"; item.note = "Ready"; }
      } catch (e) { item.state = "bad"; item.note = "Could not read this file"; }
    }
    paintBatch();
  }
  const readyFiles = () => NB.files.filter((f) => f.state === "ok" || f.state === "warn");

  function viewBatch() {
    if (!can("upload")) {
      return `${head("New batch", "")}<section class="card"><div class="empty-state">${ICON.shield}<h2>AP Clerks and Admins add batches</h2>
        <p>Sign in as Avery Chen (AP Clerk) or Sam Rivera (Admin) to upload invoices.</p></div></section>`;
    }
    const banner = !SERVER
      ? `<div class="mode-banner mode-demo" role="note"><b>This public demo cannot run Penny's engine.</b> Try every step here; nothing is uploaded. To process real invoices, run Penny on your computer with <code>./penny web --package &lt;package folder&gt;</code>. <a href="#/help/new-batch">How it works</a></div>`
      : SERVER.engine
        ? `<div class="mode-banner mode-ok" role="note"><b>Connected to Penny on this computer.</b> Uploads go to the <code>inbox</code> folder and runs use Penny's real engine.</div>`
        : `<div class="mode-banner mode-warn" role="note"><b>Uploads work, but Penny cannot run yet.</b> Restart with <code>./penny web --package &lt;package folder&gt;</code> so it can read the reference data.</div>`;
    return `${head("New batch", "Give the batch a name, add the invoice PDFs, then preview it or run it. Every step is recorded in the audit trail.")}
      ${banner}
      <div class="batch-flow" id="batch-flow">${batchBody()}</div>`;
  }
  function batchBody() {
    if (NB.result || NB.busy) return batchProgress();
    const name = slug(NB.name);
    const folder = `inbox/${today()}_${name || "your-batch-name"}`;
    const ready = readyFiles();
    const bad = NB.files.filter((f) => f.state === "bad");
    const canRun = can("run");
    const nameOk = name.length >= 2;
    const go = nameOk && ready.length && !NB.files.some((f) => f.state === "checking");
    const stIcon = { ok: "check", warn: "alert", bad: "x", checking: "clock" };
    return `
      <section class="card step"><div class="step-n">1</div><div class="step-body">
        <h2><label for="nb-name">Name the batch</label></h2>
        <p class="hint">Use a short name you will recognize later. Penny adds today's date in front, so folders sort by date.</p>
        <div class="nb-name"><input id="nb-name" class="text-input" maxlength="40" autocomplete="off" placeholder="weekly-ap" value="${esc(NB.name)}" aria-describedby="nb-folder">
          <div class="chips">${QUICK_NAMES.map((q) => `<button type="button" class="chip chip-btn${name === q ? " on" : ""}" data-quick="${q}">${q}</button>`).join("")}</div></div>
        <p class="nb-folder" id="nb-folder">Folder: <code>${esc(folder)}</code>${NB.name && !nameOk ? ` <span class="form-error">Use at least 2 letters or numbers.</span>` : ""}</p>
      </div></section>
      <section class="card step"><div class="step-n">2</div><div class="step-body">
        <h2>Add the invoices</h2>
        <div class="dropzone" id="dropzone" tabindex="0" role="button" aria-describedby="drop-hint">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
          <p><b>Drag invoice PDFs here</b> or <span class="link-like">choose files</span></p>
          <p class="hint" id="drop-hint">PDF only, up to ${fmtBytes(maxBytes())} each. Penny checks every file before anything is uploaded.</p>
          <input type="file" id="nb-files" accept="application/pdf,.pdf" multiple hidden>
        </div>
        ${NB.files.length ? `<div class="nb-summary"><span>${plural(ready.length, "invoice")} ready${bad.length ? `, ${bad.length} can't be added` : ""} · ${fmtBytes(ready.reduce((a, f) => a + f.bytes, 0))}</span><button type="button" class="link-btn" data-clear-files>Remove all</button></div>
          <ul class="nb-files" aria-live="polite">${NB.files.map((f, i) => `<li class="nb-file st-${f.state}">
            <span class="nb-ic" aria-hidden="true">${bIcon(stIcon[f.state])}</span>
            <span class="nb-main"><b>${esc(f.name)}</b><span class="sub">${esc(fmtBytes(f.bytes))} · ${esc(f.state === "checking" ? "Checking…" : f.note)}</span></span>
            <button type="button" class="icon-btn" data-rm-file="${i}" aria-label="Remove ${esc(f.name)}">×</button></li>`).join("")}</ul>` : ""}
      </div></section>
      <section class="card step"><div class="step-n">3</div><div class="step-body">
        <h2>Preview or run</h2>
        <div class="choice" role="radiogroup" aria-label="How to run">
          <label><input type="radio" name="nb-mode" value="preview" ${NB.mode === "preview" ? "checked" : ""}><b>Preview first (recommended)</b><small>Penny reads every invoice and writes the files for review, but does not update its register. Nothing is marked as processed.</small></label>
          <label class="${canRun ? "" : "is-disabled"}"><input type="radio" name="nb-mode" value="real" ${NB.mode === "real" && canRun ? "checked" : ""} ${canRun ? "" : "disabled"}><b>Run for real</b><small>${canRun ? "Penny updates its register, so these bills can never be written to an import file twice." : "Only an Admin can run for real. Preview now; an Admin can run it after."}</small></label>
        </div>
        <dl class="nb-review"><div><dt>Folder</dt><dd><code>${esc(folder)}</code></dd></div><div><dt>Invoices</dt><dd>${ready.length}</dd></div><div><dt>Uploaded and run by</dt><dd>${esc(user.name)} (${esc(ROLES[user.role].name)})</dd></div></dl>
        ${NB.error ? `<p class="auth-error" role="alert">${esc(NB.error)}</p>` : ""}
        <button class="btn btn-accent btn-lg" type="button" id="nb-go" ${go ? "" : "disabled"}>${NB.mode === "real" && canRun ? "Upload and run" : "Upload and preview"}</button>
        ${go ? "" : `<p class="hint">${!nameOk ? "Name the batch to continue." : !ready.length ? "Add at least one PDF to continue." : "Checking files…"}</p>`}
      </div></section>`;
  }
  function batchProgress() {
    const r = NB.result;
    if (r && r.done) {
      const c = r.counts || {};
      const readyN = (c.ENTER_INTACCT || 0) + (c.ENTER_ENTRATA || 0);
      return `<section class="card nb-done"><div class="callout-title">${bIcon("check")}<h2>${r.dry_run ? "Preview finished" : "Batch finished"}: ${esc(r.batch)}</h2></div>
        <p>Penny read ${plural(r.documents, "invoice")} in ${esc(r.seconds)} seconds${r.dry_run ? ". Nothing was saved to the register." : ", and saved them to the register."}</p>
        <ul class="nb-counts"><li><b>${readyN}</b> ready to import</li><li><b>${c.HOLD || 0}</b> need review</li><li><b>${c.DUP || 0}</b> duplicates</li><li><b>${c.SKIP_ALREADY_ENTERED || 0}</b> skipped</li></ul>
        <p class="hint">Intacct pre-flight ${esc(r.preflight)}. Recorded in the audit trail as run <code>${esc(r.run_id)}</code>.</p>
        <div class="nb-actions"><a class="btn btn-accent" href="#/runs/${esc(r.run_id)}">Open this run</a>${c.HOLD ? `<a class="btn" href="#/exceptions">Review what needs attention</a>` : ""}<button class="btn" type="button" data-nb-reset>Start another batch</button></div></section>`;
    }
    const steps = NB.steps || [];
    return `<section class="card nb-progress" aria-live="polite"><h2>Working on ${esc(NB.batchName || "your batch")}</h2>
      <ol class="nb-steps">${steps.map((st) => `<li class="ns-${st.state}"><span class="nb-ic" aria-hidden="true">${st.state === "done" ? bIcon("check") : st.state === "error" ? bIcon("x") : '<span class="spin"></span>'}</span><span>${esc(st.label)}${st.detail ? `<span class="sub">${esc(st.detail)}</span>` : ""}</span></li>`).join("")}</ol>
      ${NB.upPct !== undefined ? `<div class="splash-bar nb-bar" role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${NB.upPct}"><span style="width:${NB.upPct}%"></span></div>` : ""}
      ${NB.error ? `<p class="auth-error" role="alert">${esc(NB.error)}</p><div class="nb-actions"><button class="btn" type="button" data-nb-back>Back to the batch</button></div>` : ""}</section>`;
  }
  function paintBatch() {
    const el = $("#batch-flow");
    if (!el) return;
    const focusId = document.activeElement && document.activeElement.id;
    el.innerHTML = batchBody();
    if (focusId && $(`#${focusId}`)) { const f = $(`#${focusId}`); f.focus(); if (f.setSelectionRange && f.value) f.setSelectionRange(f.value.length, f.value.length); }
  }
  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { "X-Penny": "1", ...(opts.headers || {}) } });
    let body = {};
    try { body = await res.json(); } catch (e) { /* empty */ }
    if (!res.ok) throw new Error(body.error || `The Penny server answered ${res.status}.`);
    return body;
  }
  async function runBatch() {
    const real = NB.mode === "real" && can("run");
    const files = readyFiles();
    if (!SERVER) {
      openDialog("Running needs Penny on your computer", "This public demo has no server, so it cannot upload or read invoices. Nothing was sent anywhere.",
        `<ol class="notes"><li>Open Terminal in the project folder, then <code>cd 04_Workflow</code>.</li>
          <li>Start Penny with <code>./penny web --package ~/Downloads/Hillpointe_AP_Technical_Screen</code>.</li>
          <li>Come back to New batch in the window that opens. The same steps will upload to <code>inbox/${esc(today())}_${esc(slug(NB.name))}</code> and run Penny for real.</li></ol>`,
        "", () => "", { info: true });
      track("batch_demo_attempt", { files: files.length });
      return;
    }
    const who = { id: user.id, name: user.name, role: user.role };
    NB.busy = true; NB.error = ""; NB.steps = []; NB.upPct = 0;
    const step = (label, state = "doing", detail = "") => { NB.steps.push({ label, state, detail }); paintBatch(); return NB.steps[NB.steps.length - 1]; };
    let st;
    try {
      st = step("Creating the batch folder");
      const made = await api("api/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: NB.name, user: who, event_id: newId() }) });
      NB.batchName = made.batch;
      st.state = "done"; st.detail = made.folder;
      st = step(`Uploading ${plural(files.length, "invoice")}`);
      for (let k = 0; k < files.length; k++) {
        st.detail = `${k + 1} of ${files.length}: ${files[k].name}`; NB.upPct = Math.round((k / files.length) * 100); paintBatch();
        await api(`api/batches/${encodeURIComponent(made.batch)}/files?name=${encodeURIComponent(files[k].name)}`, { method: "POST", headers: { "X-Penny-User": JSON.stringify(who), "Content-Type": "application/pdf" }, body: files[k].file });
      }
      NB.upPct = 100; st.state = "done"; st.detail = `${plural(files.length, "file")}, ${fmtBytes(files.reduce((a, f) => a + f.bytes, 0))}`;
      const upId = newId();
      const up = await api(`api/batches/${encodeURIComponent(made.batch)}/uploaded`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: who, event_id: upId }) });
      record("batch.upload", { id: upId, batch: made.batch, folder: up.folder, files: up.files, count: up.count, bytes: up.bytes });
      NB.upPct = undefined;
      st = step(`Penny is reading ${plural(files.length, "invoice")}${real ? "" : " (preview)"}`, "doing", "This can take a few seconds per invoice.");
      const runId = newId();
      const ran = await api(`api/batches/${encodeURIComponent(made.batch)}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: who, dry_run: !real, event_id: runId }) });
      record("batch.run", { id: runId, batch: ran.batch, folder: ran.folder, run_id: ran.run_id, dry_run: ran.dry_run, counts: ran.counts, documents: ran.documents, preflight: ran.preflight });
      st.state = "done";
      step("Refreshing the web app", "doing");
      await reloadData();
      track("batch_run", { files: files.length, dry_run: ran.dry_run });
      NB.result = { ...ran, done: true }; NB.busy = false; NB.files = [];
      paintBatch();
      toast(ran.dry_run ? "Preview finished." : "Batch finished.");
    } catch (e) {
      if (st) st.state = "error";
      NB.error = `${e.message} Nothing after this step was done.`;
      paintBatch();
    }
  }
  async function reloadData() {
    const res = await fetch("data/penny-data.json", { cache: "no-cache" });
    D = await res.json();
    SERVER = D.server && D.server.mode === "local" ? D.server : SERVER;
    X = buildIndex(D);
    derive();
    $("#generated").textContent = `Data exported ${fmtDateTime(D.generated_at)}`;
  }
  function bindBatch() {
    const flow = $("#batch-flow");
    if (!flow || flow.dataset.bound) return;
    flow.dataset.bound = "1";
    flow.addEventListener("input", (e) => {
      if (e.target.id === "nb-name") { NB.name = e.target.value; NB.error = ""; paintBatch(); }
    });
    flow.addEventListener("change", (e) => {
      if (e.target.id === "nb-files") { addFiles(e.target.files); e.target.value = ""; }
      if (e.target.name === "nb-mode") { NB.mode = e.target.value; paintBatch(); }
    });
    flow.addEventListener("click", (e) => {
      const q = e.target.closest("[data-quick]");
      if (q) { NB.name = q.dataset.quick; paintBatch(); return; }
      if (e.target.closest("[data-rm-file]")) { NB.files.splice(+e.target.closest("[data-rm-file]").dataset.rmFile, 1); paintBatch(); return; }
      if (e.target.closest("[data-clear-files]")) { NB.files = []; paintBatch(); return; }
      if (e.target.closest("#nb-go")) { runBatch(); return; }
      if (e.target.closest("[data-nb-reset]")) { Object.assign(NB, { name: "", files: [], result: null, error: "", busy: false, steps: [] }); paintBatch(); return; }
      if (e.target.closest("[data-nb-back]")) { Object.assign(NB, { result: null, busy: false, error: "", steps: [] }); paintBatch(); return; }
      if (e.target.closest("#dropzone")) $("#nb-files").click();
    });
    flow.addEventListener("keydown", (e) => { if (e.target.id === "dropzone" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); $("#nb-files").click(); } });
    flow.addEventListener("dragover", (e) => { const z = e.target.closest("#dropzone"); if (z) { e.preventDefault(); z.classList.add("drag"); } });
    flow.addEventListener("dragleave", (e) => { const z = e.target.closest("#dropzone"); if (z) z.classList.remove("drag"); });
    flow.addEventListener("drop", (e) => { const z = e.target.closest("#dropzone"); if (z) { e.preventDefault(); z.classList.remove("drag"); addFiles(e.dataTransfer.files); } });
  }

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
    if (tab === "holds") {
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
      ${tabs.length > 1 ? `<div class="segmented queue-tabs" role="group" aria-label="Queue">${tabs.map(([k, l, n]) =>
        `<button data-tab="${k}" aria-pressed="${k === tab}">${esc(l)}<span class="count">${n}</span></button>`).join("")}</div>` : ""}
      ${body}
      ${mine.length ? `<section class="card" style="margin-top:16px"><div class="card-head"><h2>Your recent actions</h2><a href="#/audit?who=${esc(user.id)}">Full audit trail</a></div><div class="card-body">${activityList(mine)}</div></section>` : ""}`;
  }

  // ------------------------------------------------------------------ audit trail
  function auditRows() {
    const serverLog = (D.batch_log || []).map((e) => ({ ...e, type: e.event === "batch.uploaded" ? "batch.upload" : e.event, user: { id: e.by.id, name: e.by.name, role: e.by.role, initials: e.by.name.split(" ").map((w) => w[0]).join("").slice(0, 2) },
      count: e.count, sort: e.at, server: true }));
    const onServer = new Set(serverLog.map((e) => e.id).filter(Boolean));
    const people = [...EV.filter((e) => !onServer.has(e.id)).map((e) => ({ ...e, sort: e.at })), ...serverLog];
    const runs = D.runs.map((r) => ({ id: `run-${r.id}`, type: "run", at: r.started_at || "", run: r, sort: r.started_at || `0000-${String(r.order).padStart(4, "0")}`,
      user: { id: "penny", name: "Penny", role: "system", initials: "P" } }));
    return [...people, ...runs].sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0));
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
    if (e.changes) return e.changes.map(describeChange).join("; ");
    if (e.type === "batch.created") return `Folder ${e.folder}`;
    if (e.type === "batch.run_failed") return `${e.dry_run ? "Preview" : "Real run"} ${e.run_id} on ${e.folder} did not finish: ${e.error}`;
    if (e.type === "batch.upload") return `${plural(e.count || (e.files || []).length, "file")} to ${e.folder}${e.bytes ? `, ${fmtBytes(e.bytes)}` : ""}: ${(e.files || []).slice(0, 4).map((f) => f.name).join(", ")}${(e.files || []).length > 4 ? "…" : ""}`;
    if (e.type === "batch.run") return `${e.dry_run ? "Preview" : "Real run"} ${e.run_id} on ${e.folder}: ${e.documents} documents, ${Object.entries(e.counts || {}).map(([k, n]) => `${n} ${(STATUS[k] || { short: k }).short.toLowerCase()}`).join(", ")}; pre-flight ${e.preflight}${e.seconds ? `; ${e.seconds} s` : ""}`;
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
        <form class="filters" id="audit-filters" onsubmit="return false">
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
    ["AP Clerk", "Everything a Viewer sees, plus a queue of holds by team.", "Resolve, reject, reassign and reopen holds, apply suggested fixes, add notes, upload new batches and run previews."],
    ["Approver", "Everything a Viewer sees, plus bills waiting for sign-off.", "Approve or send back bills. Add notes."],
    ["Admin", "Everything, plus usage Insights.", "All of the above, plus run batches for real, and edit every rule with a preview first and undo."],
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

  // ------------------------------------------------------------------ router
  function parseHash() {
    const h = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = h.split("?");
    return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(qs || "") };
  }
  let lastPath = null, lastHash = "";
  const scrollMemo = {};
  /** Remember the list a person is working through, so an invoice can offer Back, Previous and Next. */
  function rememberList(a, b, title) {
    if (a === "invoices" && b) return;
    const ids = [...new Set($$("#main tr[data-href], #main a.att-row").map((el) => decodeURIComponent(((el.dataset.href || el.getAttribute("href")).match(/#\/invoices\/([^?]+)/) || [])[1] || "")).filter(Boolean))];
    if (!ids.length) return;
    try { sessionStorage.setItem("penny.list", JSON.stringify({ ids, label: title, href: location.hash || "#/" })); } catch (e) { /* fine */ }
  }
  function render() {
    if (!user) return showLogin();
    const { parts, q } = parseHash();
    const main = $("#main");
    let html, title, nav, after;
    const [a, b] = parts;
    if (!a) { html = viewDashboard(); title = "Overview"; nav = "dashboard"; }
    else if (a === "runs" && !b) { html = viewRuns(); title = "Run history"; nav = "runs"; }
    else if (a === "runs") { html = viewRun(b, q); title = X.runById[b] ? X.runById[b].label : "Run"; nav = "runs"; after = () => bindRun(b, q); }
    else if (a === "invoices" && !b) { html = viewInvoices(q); title = "Invoices"; nav = "invoices"; after = () => bindInvoices(q); }
    else if (a === "invoices") { html = viewInvoice(b, q); title = X.docById[b] ? `${X.docById[b].vendor} ${X.docById[b].billNo}` : "Invoice"; nav = "invoices"; after = () => bindInvoice(b, q); }
    else if (a === "rules") { html = viewRules(); title = "Rules"; nav = "rules"; after = bindRules; }
    else if (a === "exceptions") { html = viewExceptions(); title = "Exceptions"; nav = "exceptions"; }
    else if (a === "exports") { html = viewExports(); title = "Exports"; nav = "exports"; }
    else if (a === "batch") { html = viewBatch(); title = "New batch"; nav = "batch"; after = bindBatch; }
    else if (a === "insights") { html = viewInsights(); title = "Insights"; nav = "insights"; after = bindInsights; }
    else if (a === "work") { html = viewWork(q); title = "My work"; nav = "work"; after = () => $$(".queue-tabs button").forEach((b) => b.addEventListener("click", () => (location.hash = `#/work?tab=${b.dataset.tab}`))); }
    else if (a === "audit") { html = viewAudit(q); title = "Audit trail"; nav = "audit"; after = bindAudit; }
    else if (a === "about") { location.replace("#/help/about"); return; }
    else if (a === "help") { html = viewHelp(b, q); const art = HELP().find((x) => x.slug === b); title = art ? `${art.title} · Help` : "Help center"; nav = "help"; after = bindHelp; }
    else { html = notFound("That page"); title = "Not found"; }
    if (lastHash) scrollMemo[lastHash] = window.scrollY;
    main.innerHTML = html;
    document.title = `${title} · Penny`;
    $$("#nav a").forEach((l) => (l.dataset.nav === nav ? l.setAttribute("aria-current", "page") : l.removeAttribute("aria-current")));
    if (after) after();
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
      const next = dark ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      store.set("penny.theme", next);
    });
    $("#user-btn").addEventListener("click", (e) => { e.stopPropagation(); $("#user-pop").hidden ? openUserMenu() : closeUserMenu(); });
    $("#sign-out").addEventListener("click", () => { closeUserMenu(); endSession("signed-out"); });
    $("#reset-demo").addEventListener("click", () => {
      closeUserMenu();
      openDialog("Reset the demo", "This erases every action saved in this browser: resolved holds, approvals, notes and rule changes. Penny's own results are not affected.",
        "", "Erase my demo changes", () => { EV = []; store.del(SANDBOX_KEY); derive(); ruleDraft = {}; render(); toast("Demo reset. Everything is back to Penny's results."); return ""; }, { danger: true });
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".user-menu")) closeUserMenu();
      const act = e.target.closest("[data-act]");
      if (act) { e.preventDefault(); doAction(act.dataset.act, act.dataset.doc); return; }
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
    const activity = () => { if (user && Date.now() - lastTouch > 30000) { lastTouch = Date.now(); PennyAuth.touch(); } };
    ["click", "keydown"].forEach((t) => document.addEventListener(t, activity, true));
    setInterval(() => { if (user && !PennyAuth.currentUser()) endSession("expired"); }, 20000);
    bindShortcuts();
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
    const pill = $(".demo-pill");
    if (pill && SERVER) { pill.textContent = "Local"; pill.title = "Connected to Penny on this computer. Batches run with the real engine; demo sign-in and actions still stay in this browser."; }
    track("session_start");
    $("#auth").hidden = true;
    $("#shell").hidden = false;
    lastPath = null;
    updateWorkCount();
    render();
  }
  function endSession(reason) {
    PennyAuth.signOut(reason);
    user = null;
    ruleDraft = {};
    const dlg = $("#dialog");
    if (dlg.open) dlg.close();
    showLogin(reason);
  }
  function showLogin(reason) {
    reason = reason || PennyAuth.takeSignOutReason();
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
          </form>
          <details class="cred-box"><summary>Show demo emails and passwords</summary>
            <table class="mini creds"><tbody>${PennyAuth.accounts.map((a) => `<tr><td>${esc(ROLES[a.role].name)}</td><td><code>${esc(a.email)}</code></td><td><code>${esc(a.demoPassword)}</code></td>
              <td><button class="btn btn-sm" type="button" data-fill="${esc(a.email)}" data-pw="${esc(a.demoPassword)}">Fill</button></td></tr>`).join("")}</tbody></table></details>
        </section>
      </div>
      <p class="auth-credit"><svg class="credit-coin" aria-hidden="true"><use href="#coin-front"/></svg>Designed and built by <strong>Jamie Collier</strong> · <a href="https://github.com/collierjamiec/Hillpointe_AP_Submission" target="_blank" rel="noopener">Source on GitHub</a></p>
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
    loadSandbox();
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
    if (!ok) {
      $("#auth").hidden = false;
      $("#auth").innerHTML = `<div class="auth-card" style="grid-template-columns:1fr"><section class="auth-main"><h2>No data yet</h2>
        <p>Penny could not load <code>data/penny-data.json</code>. Create it from the terminal, then reload this page:</p>
        <pre class="card card-pad" style="overflow:auto">./penny web-export --package ~/Downloads/Hillpointe_AP_Technical_Screen\n./penny web</pre></section></div>`;
      return;
    }
    if (introResult) track("intro", introResult);
    window.addEventListener("error", (e) => track("error", { message: String(e.message || "error").slice(0, 160) }));
    const u = PennyAuth.currentUser();
    if (u) enterApp(u); else showLogin();
  }
  boot();
})();
