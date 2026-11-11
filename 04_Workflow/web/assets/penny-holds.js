/* Penny web app: Working a held invoice: attached files, blockers and recheck previews.
   Sections: evidence files (v1.5), blockers (v1.5), recheck preview (v1.5). */
"use strict";

// ------------------------------------------------------------------ evidence files (v1.5)
/* Files people attach (screenshots, re-saved PDFs, a vendor's letter) are kept in this browser's IndexedDB under their
   SHA-256 fingerprint, so the audit trail can name exactly which file was used. If the browser blocks storage, a
   file lasts for this visit only, and Penny says so. */
const EVIDENCE_MAX = 10 * 1048576;
const MEMFILES = new Map();
let idbPromise = null;
/** Open this browser's file store, where attached evidence is kept. */
function idb() {
  if (!idbPromise) idbPromise = new Promise((res, rej) => {
    try {
      const r = indexedDB.open("penny.files", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("files");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  return idbPromise;
}
/** Keep an attached file in this browser. Returns false when the browser will not save it. */
async function putFile(meta, blob) {
  MEMFILES.set(meta.sha256, { ...meta, blob });
  try {
    const db = await idb();
    await new Promise((res, rej) => { const t = db.transaction("files", "readwrite"); t.objectStore("files").put({ ...meta, blob }, meta.sha256); t.oncomplete = res; t.onerror = () => rej(t.error); });
    return true;
  } catch (e) { return false; }
}
/** Fetch an attached file kept in this browser, or nothing when it is not here. */
async function getFile(sha) {
  if (MEMFILES.has(sha)) return MEMFILES.get(sha);
  try {
    const db = await idb();
    return await new Promise((res) => { const r = db.transaction("files").objectStore("files").get(sha); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); });
  } catch (e) { return null; }
}
const sha256Hex = async (buf) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)), (b) => b.toString(16).padStart(2, "0")).join("");
/** Check one file by its content, not its name: a PNG or JPEG screenshot, or a PDF, up to 10 MB. */
async function readEvidence(file) {
  if (file.size > EVIDENCE_MAX) return { name: file.name, error: `Larger than ${fmtBytes(EVIDENCE_MAX)}` };
  const buf = await file.arrayBuffer();
  const b = new Uint8Array(buf.slice(0, 1024));
  const text = new TextDecoder().decode(b).trimStart();
  const type = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? "png" : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "jpg" : text.startsWith("%PDF") ? "pdf" : "";
  if (!type) return { name: file.name, error: "Not a PNG, JPEG or PDF file" };
  const mime = { png: "image/png", jpg: "image/jpeg", pdf: "application/pdf" }[type];
  return { name: file.name.slice(0, 120), type, bytes: file.size, sha256: await sha256Hex(buf), blob: new Blob([buf], { type: mime }) };
}
const fileMeta = (f) => ({ name: f.name, type: f.type, bytes: f.bytes, sha256: f.sha256 });
const fileLink = (f) => `<button type="button" class="link-btn file-link" data-open-file="${esc(f.sha256)}" title="SHA-256 ${esc(f.sha256)}">${esc(f.name)}</button><span class="sub-inline">${esc(fmtBytes(f.bytes))} · ${esc(f.sha256.slice(0, 10))}</span>`;
/** Open an attached file in a new tab, or say why it cannot be opened. */
async function openFile(sha) {
  const f = await getFile(sha);
  if (!f || !f.blob) { toast("That file is not in this browser. It was attached in another browser, or the browser storage was cleared."); return; }
  const url = URL.createObjectURL(f.blob);
  const w = window.open(url, "_blank", "noopener");
  if (!w) { const a = document.createElement("a"); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
/** A file input inside a dialog: files are checked and fingerprinted as soon as they are picked. */
function evidenceField(label, hint) {
  return `<div class="field"><label for="dlg-files">${esc(label)} (optional)</label>
    <input id="dlg-files" name="files" type="file" accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf" multiple>
    <span class="hint">${esc(hint || "Screenshots (PNG or JPEG) or PDFs, up to 10 MB each. Each file is fingerprinted and named in the audit trail.")}</span>
    <ul class="dlg-files" id="dlg-file-list" aria-live="polite"></ul></div>`;
}
/** Check files as they are chosen in a dialog: their kind, size and fingerprint. */
function watchEvidence(state) {
  const inp = $("#dlg-files");
  if (!inp) return;
  inp.addEventListener("change", async () => {
    state.busy = true; state.files = [];
    const list = $("#dlg-file-list");
    list.innerHTML = `<li class="hint">Checking ${plural(inp.files.length, "file")}…</li>`;
    const out = await Promise.all(Array.from(inp.files).slice(0, 5).map(readEvidence));
    state.files = out; state.busy = false;
    list.innerHTML = out.map((f) => `<li class="${f.error ? "form-error" : ""}">${esc(f.name)}: ${f.error ? esc(f.error) : `${esc(fmtBytes(f.bytes))}, fingerprint ${esc(f.sha256.slice(0, 10))}`}</li>`).join("")
      + (inp.files.length > 5 ? `<li class="form-error">Only the first 5 files are kept.</li>` : "");
  });
}
/** Why the chosen files cannot be attached yet, in plain words, or nothing when they are fine. */
function evidenceProblem(state) {
  if (state.busy) return "Still checking the files. Try again in a moment.";
  const bad = (state.files || []).find((f) => f.error);
  return bad ? `${bad.name}: ${bad.error}. Remove it or pick another file.` : "";
}
/** Keep a set of attached files, and say so if the browser blocked it. */
async function keepFiles(files) {
  const ok = await Promise.all(files.map((f) => putFile(fileMeta(f), f.blob)));
  if (ok.includes(false)) toast("This browser blocked saving files, so attachments last only until you close this tab.");
}

// ------------------------------------------------------------------ blockers (v1.5)
/* Each reason a held invoice is waiting on is its own blocker, with an owner, a target date, a status, notes, files,
   and the person who verified it. The invoice shows how many are cleared. Blockers organize the people work; Penny
   still decides, and a cleared invoice is checked from scratch on its next run. */
const BLOCKER_STATUS = {
  open: { label: "Open", cls: "b-hold", icon: "alert" },
  waiting: { label: "Waiting for evidence", cls: "b-waiting", icon: "clock" },
  ready: { label: "Ready for recheck", cls: "b-ready", icon: "redo" },
  cleared: { label: "Cleared", cls: "b-approved", icon: "check" },
};
const blockerBadge = (st) => { const b = BLOCKER_STATUS[st] || BLOCKER_STATUS.open; return `<span class="badge ${b.cls}">${bIcon(b.icon)}${esc(b.label)}</span>`; };
/** Each reason an invoice is held, with its owner, target date and whether it has been cleared. */
function blockersOf(d) {
  if (d.pennyStatus !== "HOLD") return [];
  const got = S.blockers[d.id] || {};
  const routed = (S.holds[d.id] || {}).route;
  return (d.codes.length ? d.codes : ["OTHER"]).map((code) => ({ code, status: "open", owner: routed || (RULES().routes || {})[code] || "", due: "", notes: [], files: [], ...(got[code] || {}) }));
}
/** How many of an invoice's blockers are cleared, or nothing when it has none. */
function blockerSummary(d) {
  const list = blockersOf(d);
  return list.length ? { list, done: list.filter((b) => b.status === "cleared").length, total: list.length } : null;
}
const blockerChip = (d) => { const s2 = blockerSummary(d); return s2 && s2.done ? `<span class="badge ${s2.done === s2.total ? "b-approved" : "b-waiting"}">${bIcon(s2.done === s2.total ? "check" : "clock")}${s2.done} of ${s2.total} blockers cleared</span>` : ""; };
/** A small tag for a blocker's target date: overdue, due today, or how many days are left. */
function dueTag(due) {
  if (!due) return "";
  const n = daysBetween(today(), due);
  return n < 0 ? `<span class="due-tag late">${plural(-n, "day")} overdue</span>` : n === 0 ? `<span class="due-tag soon">due today</span>` : n <= 2 ? `<span class="due-tag soon">in ${plural(n, "day")}</span>` : "";
}
/** The Blockers card on a held invoice, with one row and its actions for each reason. */
function blockersCard(d) {
  const sum = blockerSummary(d);
  if (!sum) return "";
  const closed = !openHold(d);
  const edit = can("resolve") && !closed;
  const pct = Math.round((sum.done / sum.total) * 100);
  return `<section class="card blockers" aria-labelledby="bl-h">
    <div class="card-head"><h2 id="bl-h">Blockers</h2><p>${sum.done} of ${sum.total} cleared</p></div>
    <div class="card-body">
      <div class="progress" role="progressbar" aria-label="Blockers cleared" aria-valuemin="0" aria-valuemax="${sum.total}" aria-valuenow="${sum.done}"><span style="width:${pct}%"></span></div>
      <ul class="blocker-list">${sum.list.map((b) => {
        const last = b.notes[b.notes.length - 1];
        return `<li class="blocker st-${esc(b.status)}">
          <div class="bl-top">${codeChip(b.code)}<b>${esc((CODES[b.code] || CODES.OTHER).plain)}</b>${blockerBadge(b.status)}</div>
          <dl class="bl-meta"><div><dt>Owner</dt><dd>${esc(b.owner || "Not set")}</dd></div>
            <div><dt>Target date</dt><dd>${b.due ? `${esc(fmtDate(b.due))} ${b.status === "cleared" ? "" : dueTag(b.due)}` : "Not set"}</dd></div>
            ${b.verifiedBy ? `<div><dt>Verified by</dt><dd>${esc(b.verifiedBy.name)}, ${esc(fmtDateTime(b.verifiedAt))}</dd></div>` : ""}</dl>
          ${last ? `<p class="bl-note">“${esc(last.note)}” <span class="sub-inline">${esc(last.by.name)}, ${esc(fmtDateTime(last.at))}${b.notes.length > 1 ? ` · ${plural(b.notes.length - 1, "earlier note")}` : ""}</span></p>` : ""}
          ${b.files.length ? `<ul class="bl-files">${b.files.map((f) => `<li>${fileLink(f)}</li>`).join("")}</ul>` : ""}
          ${edit ? `<div class="bl-actions">${b.status === "cleared"
            ? `<button class="btn btn-sm" data-act="blocker-reopen" data-doc="${esc(d.id)}" data-code="${esc(b.code)}">Reopen</button>`
            : `<button class="btn btn-sm" data-act="blocker" data-doc="${esc(d.id)}" data-code="${esc(b.code)}">Update</button>
               <button class="btn btn-sm btn-accent" data-act="blocker-clear" data-doc="${esc(d.id)}" data-code="${esc(b.code)}">Mark cleared</button>`}</div>` : ""}
        </li>`;
      }).join("")}</ul>
      ${!closed && sum.done === sum.total ? `<p class="bl-done">${bIcon("check")}All blockers are cleared. Recheck the invoice, then resolve the hold.</p>` : ""}
    </div></section>`;
}
/** The dialog for updating, clearing or reopening one blocker. */
function blockerDialog(id, code, mode) {
  const d = X.docById[id];
  const b = blockersOf(d).find((x) => x.code === code);
  if (!b) return;
  const files = { files: [], busy: false };
  const name = (CODES[code] || CODES.OTHER).plain;
  if (mode === "reopen") {
    openDialog("Reopen this blocker", `${esc(name)}. The earlier verification stays in the audit trail.`, noteField("Why reopen it?", true), "Reopen", (fd) => {
      const err = needNote(fd, 5); if (err) return err;
      if (record("blocker.reopen", { doc: id, code, note: String(fd.get("note")).trim(), before: "Cleared", after: "Open" })) { render(); toast("Blocker reopened."); }
      return "";
    });
    return;
  }
  if (mode === "clear") {
    const guarded = GUARDED.has(code);
    openDialog("Mark this blocker cleared", `${esc(name)} · ${esc(d.vendor)} ${esc(d.billNo || d.id)}. You are recorded as the person who verified it.`,
      `${noteField("What did you verify?", true, code === "NOPO" ? "For example: PM confirmed PO2410315-008 and the vendor sent a corrected bill." : "For example: received the current certificate, valid to 2027-06-30.")}
       ${evidenceField("Attach proof")}
       ${guarded ? `<label class="check-line"><input type="checkbox" name="treasury" value="1"> Treasury confirmed the new payment details by phone, at the number already in the vendor master.</label>` : ""}`,
      "Mark cleared", (fd) => {
        const err = needNote(fd, 10) || evidenceProblem(files); if (err) return err;
        if (guarded && !fd.get("treasury")) return "A payment change is cleared only after Treasury confirms it by phone at the number on file.";
        const ok = files.files.filter((f) => !f.error);
        if (record("blocker.clear", { doc: id, code, note: String(fd.get("note")).trim(), files: ok.map(fileMeta), before: BLOCKER_STATUS[b.status].label, after: "Cleared" })) {
          keepFiles(ok); render(); toast(`${name}: cleared.`);
        }
        return "";
      });
    watchEvidence(files);
    return;
  }
  const teams = [...new Set([b.owner, ...teamsList()].filter(Boolean))];
  openDialog("Update this blocker", `${esc(name)} · ${esc(d.vendor)} ${esc(d.billNo || d.id)}`,
    `<div class="field"><label for="dlg-status">Status</label><select id="dlg-status" name="status">${["open", "waiting", "ready"].map((k) =>
       `<option value="${k}"${k === b.status ? " selected" : ""}>${esc(BLOCKER_STATUS[k].label)}</option>`).join("")}</select></div>
     <div class="field-row"><div class="field"><label for="dlg-owner">Owner</label><select id="dlg-owner" name="owner">${teams.map((t) => `<option${t === b.owner ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
       <div class="field"><label for="dlg-due">Target date</label><input id="dlg-due" name="due" type="date" value="${esc(b.due || "")}"></div></div>
     ${noteField("Note", true, "For example: asked the vendor for a current certificate; promised by Friday.")}
     ${evidenceField("Attach files")}`,
    "Save", (fd) => {
      const err = needNote(fd, 5) || evidenceProblem(files); if (err) return err;
      const ok = files.files.filter((f) => !f.error);
      const status = fd.get("status"), owner = fd.get("owner"), due = String(fd.get("due") || "");
      const change = [status !== b.status && `${BLOCKER_STATUS[b.status].label} → ${BLOCKER_STATUS[status].label}`, owner !== b.owner && `owner ${owner}`, due !== (b.due || "") && `target ${due ? fmtDate(due) : "removed"}`, ok.length && plural(ok.length, "file")].filter(Boolean);
      if (record("blocker.update", { doc: id, code, status, owner, due, note: String(fd.get("note")).trim(), files: ok.map(fileMeta),
        before: BLOCKER_STATUS[b.status].label, after: change.join("; ") || "Note added" })) { keepFiles(ok); render(); toast("Blocker updated."); }
      return "";
    });
  watchEvidence(files);
}

// ------------------------------------------------------------------ recheck preview (v1.5)
/* Recheck runs Penny's real engine on one held invoice again: the same reading under today's rules and reference
   data, a corrected PDF from the vendor, or a manual entry. It needs Penny on a computer (./penny web --package).
   It is a preview: Penny decides against a copy of its register and saves nothing. The server logs who asked. */
const RC = {};                 // invoice id -> the latest recheck preview shown on this page
const RC_SOURCE = { saved: "Same reading, today's rules and data", file: "Corrected PDF", keyed: "Manual entry" };
const engineReady = () => !!(SERVER && SERVER.engine);
/** Explain that an action needs Penny running on a computer, with the steps to start it. */
function needsEngine(what) {
  openDialog(`${what} needs Penny on your computer`, "This public demo has no server, so it cannot run Penny's engine. Nothing was sent anywhere.",
    `<ol class="notes"><li>Open Terminal in the project folder, then <code>cd 04_Workflow</code>.</li>
      <li>Start Penny with <code>./penny web --package ~/Downloads/Hillpointe_AP_Technical_Screen</code>.</li>
      <li>Come back to this invoice in the window that opens and try again. Penny will decide it with its real rules and reference data.</li></ol>`,
    "", () => "", { info: true });
  track("engine_demo_attempt", { what });
}
/** Ask the server what Penny would decide about an invoice now, and keep the answer as a preview. */
async function runRecheck(id, source, extra = {}) {
  const d = X.docById[id];
  const who = { id: user.id, name: user.name, role: user.role };
  toast(source === "keyed" ? "Penny is checking the manual entry…" : "Penny is rechecking this invoice…");
  try {
    let res;
    if (source === "file") {
      res = await api(`api/recheck?run=${encodeURIComponent(d.cur.run_id)}&doc=${encodeURIComponent(id)}&name=${encodeURIComponent(extra.file.name)}&event_id=${newId()}`,
        { method: "POST", headers: { "Content-Type": "application/pdf", "X-Penny-User": JSON.stringify(who) }, body: extra.file });
    } else {
      res = await api("api/recheck", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: who, run_id: d.cur.run_id, doc_id: id, source, rules: RULES(), entry: extra.entry, event_id: newId() }) });
    }
    RC[id] = { ...res, at: new Date().toISOString(), by: who };
    track("recheck", { source, result: res.after.decision });
    try { await reloadData(); } catch (e) { /* the preview still shows; the audit trail refreshes on the next load */ }
    render();
    const el = $("#rc-h");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    openDialog("Penny could not recheck this invoice", esc(e.message), "", "", () => "", { info: true });
  }
}
/** The dialog that starts a recheck and says what a preview does and does not change. */
function recheckDialog(id) {
  if (!engineReady()) return needsEngine("Rechecking");
  const d = X.docById[id];
  const st = { file: null };
  openDialog("Recheck this invoice", `${esc(d.vendor)} · ${esc(d.billNo || d.id)}. Penny decides it again as its next run would. This is a preview: nothing is saved.`,
    `<div class="choice" role="radiogroup" aria-label="What to recheck">
      <label><input type="radio" name="source" value="saved" checked><b>The same reading, with today's rules and data</b><small>Use this after a rule change, or after the reference data was fixed (for example, the vendor was added to the vendor master).</small></label>
      <label><input type="radio" name="source" value="file"><b>A corrected PDF from the vendor</b><small>Penny reads the new file and checks it. The file is not added to any batch.</small></label>
    </div>
    <div class="field" id="rc-file-field" hidden><label for="rc-file">Corrected PDF</label><input id="rc-file" name="file" type="file" accept="application/pdf,.pdf"><span class="hint">PDF only, up to 25 MB.</span></div>`,
    "Recheck", (fd) => {
      const source = fd.get("source");
      const file = $("#rc-file").files[0];
      if (source === "file" && !file) return "Choose the corrected PDF.";
      if (source === "file" && !/\.pdf$/i.test(file.name)) return "The corrected file must be a PDF.";
      runRecheck(id, source, { file });
      return "";
    });
  $$('#dialog input[name="source"]').forEach((r) => r.addEventListener("change", () => ($("#rc-file-field").hidden = r.value !== "file" || !r.checked)));
}
/** One side of a recheck comparison: a decision, its badges and its reasons. */
function briefCol(title, b) {
  const reasons = (b.reasons || []).map(parseReason);
  return `<div class="rc-col"><h3>${esc(title)}</h3><div class="status-strip">${badge(b.decision)}${destTag(b.decision)}</div>
    ${b.codes && b.codes.length ? `<div class="chips">${b.codes.map(codeChip).join("")}</div>` : ""}
    ${reasons.length ? `<ul class="notes">${reasons.slice(0, 3).map((x) => `<li>${esc(x.text.length > 220 ? x.text.slice(0, 217) + "…" : x.text)}</li>`).join("")}</ul>`
      : b.decision && b.decision.startsWith("ENTER_") ? `<p>Every check passed.</p>` : ""}
    ${(b.approvers || []).length ? `<p class="hint">Approvals needed: ${esc(b.approvers.join("; "))}</p>` : ""}</div>`;
}
/** The card that compares Penny's saved decision with what a recheck found. */
function recheckCard(d) {
  const r = RC[d.id];
  if (!r) return "";
  const a = r.after, b = r.before;
  const same = a.decision === b.decision && JSON.stringify(a.codes) === JSON.stringify(b.codes);
  const passes = a.decision && a.decision.startsWith("ENTER_");
  const verdict = same ? "No change: Penny would decide it the same way."
    : passes ? (r.source === "keyed" ? "Penny would pass the keyed invoice. Save it for the next run so an Admin can run it." : "Penny would now pass it. Once the corrected document is in a batch, the next run can write it to an import file.")
    : `Penny would still hold it${a.codes.length ? `, now for ${a.codes.join(", ")}` : ""}.`;
  const v = r.versions;
  return `<section class="card recheck" aria-labelledby="rc-h">
    <div class="card-head"><h2 id="rc-h">Recheck preview</h2><p>${esc(RC_SOURCE[r.source] || r.source)} · ${esc(fmtDateTime(r.at))}</p></div>
    <div class="card-body">
      <p class="rc-verdict ${passes ? "ok" : same ? "" : "hold"}">${esc(verdict)}</p>
      <div class="rc-cols">${briefCol("Before (saved result)", b)}${briefCol("After (this preview)", a)}</div>
      <dl class="rc-versions">
        <div><dt>Document</dt><dd>${esc(v.document.file)} · ${esc((v.document.sha256 || "").slice(0, 12) || "no fingerprint")} · read by ${esc(v.document.read_by === "manual" ? "a person (manual entry)" : v.document.read_by || "Penny")}</dd></div>
        <div><dt>Rules</dt><dd>${esc(v.rules.fingerprint)} · ${esc(v.rules.source)}</dd></div>
        <div><dt>Reference data</dt><dd>${esc(v.data.fingerprint)}</dd></div>
        <div><dt>Register</dt><dd>${plural(v.register.entries, "entry", "entries")}, ${v.register.entered} entered (a copy; not changed)</dd></div>
      </dl>
      <p class="hint">Preview only. Nothing was saved, no import file was written, and Penny's register did not change. The recheck is in the audit trail.</p>
      ${passes && openHold(d) && can("resolve") && r.source !== "keyed" ? `<div class="nb-actions"><button class="btn btn-accent" data-act="resolve" data-doc="${esc(d.id)}">Resolve hold</button></div>` : ""}
    </div></section>`;
}
