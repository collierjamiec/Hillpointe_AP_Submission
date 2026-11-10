/* Penny web app: The Rules page: every setting, the editor, the impact preview, save, undo and the rule simulator.
   Sections: rules. */
"use strict";

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
  manual_entry_check_over: ["Manual entry second check", "Invoices keyed by hand with a total over this are keyed again by a different person before Penny uses them.", "money"],
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
  { path: "display.theme", label: "Company look", help: "The colors and corners everyone sees unless they choose their own. Set it on the Appearance page.", type: "theme", group: "appearance" },
  { path: "display.time_zone", label: "Company time zone", help: "Every time in Penny is shown in this zone, and new batch folders are dated by it. Saved times do not change, and Penny's decisions do not depend on it.", type: "tz", group: "workspace" },
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
  if (f.type === "tz") return v === undefined || validTz(v) ? "" : `${f.label} must be a time zone from the list`;
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
  if (f.type === "tz") return v === undefined ? `${tzLabel(DEFAULT_TZ)}, the default` : tzLabel(v);
  if (f.type === "theme") return lookName({ ...LOOK_DEFAULT, ...(v || {}) });
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
    } else if (c.path === "display.time_zone") {
      const sample = X.docs.length && D.runs.find((r) => r.started_at);
      items.push({ title: describeChange(c), lines: [
        "Every time in the web app will show in the new zone right away. Saved times do not change, only how they read.",
        `New batch folders will be dated by the new zone (today there: ${todayIn(validTz(c.after) ? c.after : DEFAULT_TZ)}).`,
        ...(sample ? [`For example, ${sample.label} started ${new Date(sample.started_at).toLocaleString("en-US", { timeZone: validTz(c.after) ? c.after : DEFAULT_TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}.`] : []),
        "No invoice decision changes." ] });
    } else {
      items.push({ title: describeChange(c), lines: ["Penny applies this on its next run. This quick preview cannot estimate it; use Test on saved invoices for the exact answer."] });
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
function tzEditor(f, v) {
  const cur = validTz(v) ? v : DEFAULT_TZ;
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone").filter((z) => !TZ_COMMON.includes(z)) : [];
  if (!TZ_COMMON.includes(cur) && !all.includes(cur)) all.unshift(cur);
  const opt = (z) => `<option value="${esc(z)}"${z === cur ? " selected" : ""}>${esc(tzLabel(z))}</option>`;
  return `<span class="tz-wrap"><select id="${esc(fid(f.path))}" class="text-input tz-select${isChanged(f.path) ? " changed" : ""}" data-tz="${esc(f.path)}">
    <optgroup label="Common in the United States">${TZ_COMMON.map(opt).join("")}</optgroup>
    ${all.length ? `<optgroup label="All time zones">${all.map(opt).join("")}</optgroup>` : ""}</select>
    <span class="s-help">Now there: ${esc(new Date().toLocaleString("en-US", { timeZone: cur, weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" }))}</span></span>`;
}
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
    if (f.type === "tz") return tzEditor(f, v);
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
    <section class="card" style="margin-top:16px"><div class="card-head"><h2>Time zone</h2><p>How Penny shows dates and times</p></div><div class="card-body">${group("workspace").map(row).join("")}</div></section>
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
         <div class="edit-bar-actions"><button class="btn" type="button" id="rules-sim">Test on saved invoices</button><button class="btn" type="button" id="rules-discard">Discard</button><button class="btn btn-accent" type="button" id="rules-save">Save changes</button></div>`;
    const sim = $("#rules-sim", bar);
    if (sim) sim.addEventListener("click", () => simulateRules(sim));
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
/** The rule simulator (v1.5): Penny re-decides every saved invoice twice, under the current rules and the draft,
    on the same saved readings and reference data, and lists exactly what would change. Nothing is saved. */
async function simulateRules(btn) {
  if (!engineReady()) return needsEngine("Testing rule changes");
  const { changes } = draftChanges();
  btn.disabled = true; btn.textContent = "Testing…";
  try {
    const res = await api("api/simulate", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: user.id, name: user.name, role: user.role }, rules_now: RULES(), rules_draft: ruleDraft.rules }) });
    track("rules_simulated", { changed: res.changes.length });
    const lineOf = (c) => {
      const d = X.docById[c.doc_id], run = X.runById[c.run_id];
      const ap = (x) => (x.approvers || []).join("; ") || "none";
      const apChange = JSON.stringify(c.before.approvers) !== JSON.stringify(c.after.approvers);
      return `<li><div class="sim-doc"><a href="#/invoices/${esc(c.doc_id)}">${esc(d ? `${d.vendor} ${d.billNo}` : c.doc_id)}</a><span class="sub">${esc(run ? run.label : c.run_id)}</span></div>
        <div class="sim-change">${badge(c.before.decision)}${c.before.codes.map(codeChip).join("")}<span class="arrow" aria-label="becomes">→</span>${badge(c.after.decision)}${c.after.codes.map(codeChip).join("")}</div>
        ${apChange ? `<p class="hint">Approvals: ${esc(ap(c.before))} → ${esc(ap(c.after))}</p>` : ""}</li>`;
    };
    openDialog("What these rule changes would do", `Penny decided ${plural(res.documents, "saved document")} from ${plural(res.runs, "run")} twice, with the current rules and with your draft, using the same readings and reference data.`,
      `<ul class="impact">${changes.map((c) => `<li>${esc(describeChange(c))}</li>`).join("")}</ul>
       ${res.changes.length ? `<h3 class="sub-h">${plural(res.changes.length, "document")} would change</h3><ul class="sim-list">${res.changes.map(lineOf).join("")}</ul>`
         : `<p class="rc-verdict">No saved document would be decided differently.</p>`}
       ${res.differs_from_saved ? `<p class="form-warn">${plural(res.differs_from_saved, "document")} already decide differently today than when they were saved, because rules or reference data changed since. They are compared on today's footing, so only your draft's effect is listed.</p>` : ""}
       <p class="hint">Rules ${esc(res.rules_now)} → ${esc(res.rules_draft)} · reference data ${esc(res.data_fingerprint)}. Preview only: nothing was saved, and past decisions stay exactly as Penny made them.</p>`,
      "", () => "", { info: true, wide: true });
  } catch (e) {
    openDialog("Penny could not test these rules", esc(e.message), "", "", () => "", { info: true });
  } finally {
    btn.disabled = false; btn.textContent = "Test on saved invoices";
  }
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
    else if (t.dataset.tz) { setPath(startDraft(), t.dataset.tz, t.value); rerender(`[data-tz="${t.dataset.tz}"]`); }
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
