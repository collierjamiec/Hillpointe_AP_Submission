/* Penny web app: The words, helpers, data index and saved state every other file uses.
   Penny's web app is plain scripts with no build step. These files load in order (see index.html) and share their
   top-level names, so a function defined in one file can be used in the files after it. Nothing here re-decides an
   invoice: Penny's results are shown as Penny made them, and what people do is recorded as events.
   Sections: vocabulary, helpers, data, state: who is signed in, and the sandbox, usage insights (local, privacy-safe), shared pieces. */
"use strict";

// ------------------------------------------------------------------ vocabulary
/* What each Penny result means, in words that never overstate it. Penny writes files; it does not post or pay.
   ENTER_INTACCT = a row in the Intacct import file a person uploads. ENTER_ENTRATA = a row in the Entrata handoff list. */
/* The version of this web app. ./penny release changes it together with VERSION and releases.json, and a test
   fails if they ever disagree. */
const APP_VERSION = "2.1.0";
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
  clerk: { name: "AP Clerk", can: ["resolve", "note", "upload", "email", "export"], blurb: "can work holds and their blockers, recheck invoices, key unreadable invoices by hand, add notes, upload and preview new batches, and mark an import file as imported." },
  approver: { name: "Approver", can: ["approve", "note", "email", "confirm"], blurb: "can approve or send back bills that are ready to import, confirm an import someone else made, and add notes." },
  admin: { name: "Admin", can: ["resolve", "note", "approve", "rules", "upload", "run", "users", "email", "export", "confirm"], blurb: "can do everything, including changing and testing rules and running batches for real." },
};
/** Which permission each kind of event needs. Checked again when the event is recorded (defense in depth). */
const EVENT_NEEDS = {
  "hold.resolve": "resolve", "hold.reopen": "resolve", "hold.reassign": "resolve",
  "bill.approve": "approve", "bill.sendback": "approve", "note.add": "note",
  "rules.update": "rules", "rules.revert": "rules",
  "batch.upload": "upload", "batch.run": "upload",
  "blocker.update": "resolve", "blocker.clear": "resolve", "blocker.reopen": "resolve",
  "manual.keyed": "resolve", "manual.check": "resolve", "manual.saved": "resolve",
  "export.imported": "export", "export.undo": "export", "export.confirmed": "confirm",
  "user.invited": "users", "user.updated": "users", "user.reset_sent": "users", "user.invite_resent": "users", "email.sent": "email",
};
const EVENT_LABEL = {
  "hold.resolve": "Resolved a hold", "hold.reopen": "Reopened a hold", "hold.reassign": "Reassigned a hold",
  "bill.approve": "Approved a bill", "bill.sendback": "Sent a bill back", "note.add": "Added a note",
  "rules.update": "Changed rules", "rules.revert": "Undid a rule change", "run": "Penny ran a batch",
  "batch.upload": "Uploaded a batch", "batch.run": "Ran a batch", "batch.created": "Created a batch folder", "batch.uploaded": "Uploaded a batch", "batch.run_failed": "A batch run failed",
  "blocker.update": "Updated a blocker", "blocker.clear": "Cleared a blocker", "blocker.reopen": "Reopened a blocker",
  "manual.keyed": "Keyed an invoice by hand", "manual.check": "Checked a manual entry", "manual.saved": "Saved a manual entry for the next run",
  "recheck.preview": "Rechecked an invoice (preview)",
  "user.invited": "Invited someone", "user.updated": "Changed someone's account", "user.reset_sent": "Sent a password reset", "user.invite_resent": "Resent an invitation",
  "user.activated": "Set up their account", "user.password_reset": "Chose a new password", "user.reset_requested": "Asked for a password reset", "user.signed_in": "Signed in",
  "watch.picked_up": "Picked up files from the watched folder",
  "export.download": "Downloaded a file", "export.imported": "Marked a file as imported", "export.confirmed": "Confirmed an import", "export.undo": "Marked a file as not imported",
  "email.sent": "Sent an email", "email.saved": "Saved an email (not sent)", "email.failed": "An email failed to send",
};

// ------------------------------------------------------------------ helpers
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const plural = (n, one, many) => `${typeof n === "number" ? n.toLocaleString() : n} ${n === 1 ? one : many || one + "s"}`;
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
// Every time is shown in the company time zone (Rules > Time zone, display.time_zone in rules.json), with its short
// name, so a reviewer in another city reads the same clock as the AP team. Stored times never change.
const DEFAULT_TZ = "America/New_York";
const TZ_COMMON = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "UTC"];
function validTz(z) {
  if (!z || typeof z !== "string") return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch (e) { return false; }
}
function tz() { const z = getPath(RULES(), "display.time_zone"); return validTz(z) ? z : DEFAULT_TZ; }
function tzLabel(z) {
  if (!validTz(z)) return String(z || "");
  if (z === "UTC") return "Coordinated Universal Time (UTC)";
  const part = new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "long" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName");
  return `${part ? part.value : z} (${z.replace(/_/g, " ")})`;
}
/** Today's date as YYYY-MM-DD in the company time zone. */
function todayIn(z, when = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(when).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  return !iso || isNaN(d) ? "" : d.toLocaleString("en-US", { timeZone: tz(), month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
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
let S = { holds: {}, approvals: {}, notes: {}, rules: null, revoked: new Set(), blockers: {}, manual: {}, exports: {} };

function loadSandbox() {
  try {
    const j = JSON.parse(store.get(SANDBOX_KEY, "null"));
    EV = j && Array.isArray(j.events) ? j.events.filter((e) => e && e.type && e.user) : [];
  } catch (e) { EV = []; }
}
function saveSandbox() {
  if (teamMode()) return;                 // the server keeps the team's work; this browser keeps nothing of its own
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
  if (!AUTH().currentUser()) { endSession("expired"); return null; }
  if (UPD.state === "required") { toast(`Paused until you update: Penny ${UPD.minimum} is required. You can still look at everything.`); showUpdateHelp(); return null; }
  AUTH().touch();
  const ev = { id: newId(), at: new Date().toISOString(), type,
    user: { id: user.id, name: user.name, role: user.role, initials: user.initials }, ...data };
  if (teamMode()) {
    if (SERVER_OWNED.test(type)) return ev;       // the server records this itself; it arrives with the next live update
    ev.pending = true;                            // on screen now, confirmed (or taken back) when the server answers
    EV.push(ev);
    derive();
    teamPush(ev);
  } else {
    EV.push(ev);
    saveSandbox();
    derive();
  }
  track("action", { kind: type, code: data.doc && X.docById[data.doc] ? X.docById[data.doc].primary : undefined,
    seconds: data.doc && openedAt[data.doc] ? Math.round((Date.now() - openedAt[data.doc]) / 1000) : undefined,
    suggestion: data.suggestion ? data.suggestion.source : undefined });
  return ev;
}

const MOVED_IS_HISTORY = /^(bill\.|export\.|manual\.check$|rules\.)/;
/** Rebuild the current state by replaying the audit log over Penny's results. */
function derive() {
  const revoked = new Set(EV.filter((e) => e.type === "rules.revert").map((e) => e.target));
  const holds = {}, approvals = {}, notes = {}, blockers = {}, manual = {}, exports = {};
  const rules = JSON.parse(JSON.stringify(D.rules || {}));
  for (const e of EV) {
    // Work moved in from a browser before 2.0 was never checked by the server. It stays in the audit trail as
    // history, but it does not count as a sign-off, an import or a second check.
    if (e.moved && MOVED_IS_HISTORY.test(e.type)) continue;
    if (e.type === "hold.resolve") holds[e.doc] = { ...(holds[e.doc] || {}), outcome: e.outcome, by: e.user, at: e.at, note: e.note };
    else if (e.type === "hold.reopen" && holds[e.doc]) holds[e.doc] = { route: holds[e.doc].route };
    else if (e.type === "hold.reassign") holds[e.doc] = { ...(holds[e.doc] || {}), route: e.route };
    else if (e.type === "bill.approve" || e.type === "bill.sendback") {
      (approvals[e.doc] = approvals[e.doc] || {})[e.step] = { status: e.type === "bill.approve" ? "approved" : "sent back", by: e.user, at: e.at, note: e.note };
    } else if (e.type === "note.add") (notes[e.doc] = notes[e.doc] || []).push(e);
    else if (e.type === "rules.update" && !revoked.has(e.id) && (!teamMode() || e.pending)) e.changes.forEach((c) => setPath(rules, c.path, c.after));
    else if (e.type === "rules.revert" && teamMode() && e.pending) ((EV.find((x) => x.id === e.target) || {}).changes || []).forEach((c) => setPath(rules, c.path, c.before));
    else if (e.type.startsWith("blocker.")) {
      const m = ((blockers[e.doc] = blockers[e.doc] || {})[e.code] = blockers[e.doc][e.code] || { notes: [], files: [] });
      if (e.status) m.status = e.status;
      if (e.owner) m.owner = e.owner;
      if (e.due !== undefined) m.due = e.due;
      if (e.files && e.files.length) m.files = [...m.files, ...e.files.map((f) => ({ ...f, by: e.user, at: e.at }))];
      if (e.note) m.notes = [...m.notes, { note: e.note, by: e.user, at: e.at, type: e.type }];
      if (e.type === "blocker.clear") Object.assign(m, { status: "cleared", verifiedBy: e.user, verifiedAt: e.at });
      if (e.type === "blocker.reopen") Object.assign(m, { status: "open", verifiedBy: null, verifiedAt: null });
    } else if (e.type === "manual.keyed") manual[e.doc] = { id: e.id, entry: e.entry, evidence: e.evidence || [], by: e.user, at: e.at, note: e.note, checks: [], saved: null };
    else if (e.type === "manual.check" && manual[e.doc] && manual[e.doc].id === e.entry_id) manual[e.doc].checks.push({ by: e.user, at: e.at, match: e.match, invoice_no: e.invoice_no, total: e.total });
    else if (e.type === "manual.saved" && manual[e.doc]) manual[e.doc].saved = { batch: e.batch, folder: e.folder, by: e.user, at: e.at };
    else if (e.type.startsWith("export.")) {
      const x = (exports[`${e.run}/${e.file}`] = exports[`${e.run}/${e.file}`] || { downloads: [], imported: null, confirmed: null });
      if (e.type === "export.download") x.downloads.push({ by: e.user, at: e.at });
      else if (e.type === "export.imported") { x.imported = { by: e.user, at: e.at, ref: e.ref, rows: e.rows, note: e.note }; x.confirmed = null; }
      else if (e.type === "export.confirmed") x.confirmed = { by: e.user, at: e.at, note: e.note };
      else if (e.type === "export.undo") { x.imported = null; x.confirmed = null; }
    }
  }
  S = { holds, approvals, notes, rules, revoked, blockers, manual, exports };
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

// ------------------------------------------------------------------ long lists (v1.9)
/* Long tables show one page at a time, so the app stays quick with thousands of invoices. The page and page size
   live in the address (?page=2&per=50), so a link or the Back button returns to the same place. Totals and counts
   always describe the whole list, not just the page on screen. */
const PAGE_SIZES = [25, 50, 100];
function paged(rows, q) {
  const per = PAGE_SIZES.includes(+q.get("per")) ? +q.get("per") : PAGE_SIZES[0];
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const page = Math.min(pages, Math.max(1, Math.floor(+q.get("page")) || 1));
  const from = (page - 1) * per;
  return { per, page, pages, total: rows.length, from: rows.length ? from + 1 : 0, to: Math.min(from + per, rows.length), slice: rows.slice(from, from + per) };
}
function pagerHtml(pg, noun) {
  if (pg.total <= PAGE_SIZES[0]) return "";
  const btn = (to, label, off, aria) => `<button type="button" class="btn btn-sm" data-page="${to}" ${off ? "disabled" : ""} aria-label="${esc(aria)}">${label}</button>`;
  return `<nav class="pager" aria-label="Pages of ${esc(noun)}">
    <span class="pager-count" aria-live="polite">Showing ${pg.from.toLocaleString()} to ${pg.to.toLocaleString()} of ${pg.total.toLocaleString()} ${esc(noun)}</span>
    <span class="pager-ctl">${btn(1, "First", pg.page === 1, "First page")}${btn(pg.page - 1, "← Previous", pg.page === 1, "Previous page")}
      <span class="pager-at">Page ${pg.page} of ${pg.pages}</span>
      ${btn(pg.page + 1, "Next →", pg.page === pg.pages, "Next page")}${btn(pg.pages, "Last", pg.page === pg.pages, "Last page")}
      <label class="pager-per">Rows <select data-per aria-label="Rows per page">${PAGE_SIZES.map((n) => `<option${n === pg.per ? " selected" : ""}>${n}</option>`).join("")}</select></label></span></nav>`;
}
/** Change page or page size by changing the address, then bring the top of the table back into view. */
function goToPage(change) {
  const { parts, q } = parseHash();
  Object.entries(change).forEach(([k, v]) => (v === null ? q.delete(k) : q.set(k, v)));
  if (q.get("page") === "1") q.delete("page");
  window.addEventListener("hashchange", () => setTimeout(() => {
    const top = $("#main .table-wrap");
    if (top) { top.scrollIntoView({ block: "start" }); const first = $("#main .pager [data-page]:not([disabled])"); if (first) first.focus({ preventScroll: true }); }
  }, 0), { once: true });
  location.hash = `#/${parts.map(encodeURIComponent).join("/")}${q.toString() ? "?" + q : ""}`;
}
/** For pages that stack several tables: the first rows of a long one, and a line saying where the rest are. */
const TOP_ROWS = 50;
function topRows(rows, rest) {
  if (rows.length <= TOP_ROWS) return { rows, note: "" };
  return { rows: rows.slice(0, TOP_ROWS), note: `<p class="hint list-more">Showing the first ${TOP_ROWS} of ${rows.length.toLocaleString()}. ${rest}</p>` };
}
let listIds = null;           // every row of the list on screen (all pages), so Previous and Next on an invoice cover the whole list

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
