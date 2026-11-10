/* Penny web app: New batch: name it, add PDFs, preview or run, and batches waiting to run.
   Sections: new batch. */
"use strict";

// ------------------------------------------------------------------ new batch
/* Upload a folder of invoices and run Penny on it. Running needs Penny's engine, which only the local server has
   (./penny web --package ...). The public demo lets people try every step and says plainly what would happen. */
let SERVER = null;            // { mode: "local", engine, today, max_mb } when served by ./penny web
const QUICK_NAMES = ["weekly-ap", "month-end", "vendor-resends", "corrections"];
const NB = { name: "", files: [], mode: "preview", busy: false, result: null, error: "" };
const slug = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const today = () => todayIn(tz());
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
    <div class="batch-flow" id="batch-flow">${batchBody()}</div>
    ${watchCard()}
    ${SERVER ? `<section class="card" id="nb-waiting" aria-labelledby="nbw-h" style="margin-top:16px"><div class="card-head"><h2 id="nbw-h">Batches waiting to run</h2><p>Folders in inbox/ not yet run for real, including saved manual entries</p></div>
      <div class="card-body" id="nb-waiting-body"><p class="hint">Loading…</p></div></section>` : ""}`;
}
/** The watched folder on the New batch page: where it is, what it last did, and what it left alone and why. */
function watchCard() {
  const w = SERVER && SERVER.watch;
  if (!SERVER) return `<section class="card card-pad watch-card" style="margin-top:16px"><h2>Watched folder</h2>
    <p class="hint">On your own computer, Penny can watch a folder: drop invoice PDFs into it and Penny files them as a batch and previews them by itself. It needs Penny running there, so it is not part of this public demo. <a href="#/help/watched-folder">How it works</a></p></section>`;
  if (!w || !w.enabled) return `<section class="card card-pad watch-card" style="margin-top:16px"><h2>Watched folder <span class="badge b-skip">Off</span></h2>
    <p class="hint">Start Penny with <code>./penny web --package &lt;package folder&gt; --watch</code> and it will pick up PDFs dropped into <code>inbox/_incoming</code> and preview them. <a href="#/help/watched-folder">How it works</a></p></section>`;
  const lp = w.last_pickup;
  return `<section class="card card-pad watch-card" id="watch-card" style="margin-top:16px" aria-live="polite">
    <div class="watch-head"><h2>Watched folder <span class="badge b-approved">${bIcon("check")}On</span></h2>
      <button class="btn btn-sm" type="button" id="watch-scan">Check now</button></div>
    <p>Drop invoice PDFs into <code>${esc(w.folder)}</code>. Penny checks every ${esc(w.every_seconds)} seconds, files them as a new batch and runs a <strong>preview</strong>. It never runs a batch for real.</p>
    <p class="hint">${w.last_scan ? `Last checked ${esc(fmtDateTime(w.last_scan))}.` : "Not checked yet."} ${lp ? `Last pickup: ${plural(lp.count, "file")} into <code>inbox/${esc(lp.batch)}</code>, ${esc(fmtDateTime(lp.at))}${lp.preview ? `. <a href="#/runs/${esc(lp.preview)}">Open the preview</a>` : ""}.` : "Nothing picked up yet."}</p>
    ${w.error ? `<p class="form-warn">${esc(w.error)}</p>` : ""}
    ${(w.ignored || []).length ? `<div class="watch-ignored"><b>Left in the folder (${w.ignored.length}):</b><ul class="notes">${w.ignored.map((i) => `<li><code>${esc(i.name)}</code>: ${esc(i.why)}</li>`).join("")}</ul></div>` : ""}
  </section>`;
}
async function watchScan(btn) {
  btn.disabled = true; btn.textContent = "Checking…";
  try {
    const res = await api("api/watch/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: { id: user.id, name: user.name, role: user.role } }) });
    SERVER.watch = res.watch;
    if (res.picked_up) { await reloadData(); toast(`Picked up ${plural(res.picked_up.count, "file")} and filed ${res.picked_up.count === 1 ? "it" : "them"} as ${res.picked_up.batch}.`); }
    else toast("Nothing new is ready. A file is taken once it has stopped changing for a few seconds.");
    render();
  } catch (e) {
    btn.disabled = false; btn.textContent = "Check now";
    openDialog("Penny could not check the folder", esc(e.message), "", "", () => "", { info: true });
  }
}
async function loadWaiting() {
  const box = $("#nb-waiting-body");
  if (!box) return;
  try {
    const { batches } = await api("api/batches");
    const waiting = batches.filter((b) => !b.events.some((e) => e.event === "batch.run" && !e.dry_run));
    box.innerHTML = waiting.length ? `<ul class="waiting">${waiting.map((b) => {
      const made = b.events.find((e) => e.event === "batch.created");
      const prev = [...b.events].reverse().find((e) => e.event === "batch.run");
      return `<li><div><b><code>${esc(b.folder)}</code></b>
          <span class="sub">${plural(b.files.length, "file")}${b.keyed.length ? ` · ${plural(b.keyed.length, "manual entry", "manual entries")}` : ""}${b.evidence.length ? ` · ${plural(b.evidence.length, "evidence file")}` : ""}${made ? ` · created by ${esc(made.by.name)}, ${esc(fmtDateTime(made.at))}` : ""}</span>
          ${prev ? `<span class="sub">Last preview: <a href="#/runs/${esc(prev.run_id)}">${esc(prev.run_id)}</a>, ${esc(fmtDateTime(prev.at))}</span>` : ""}</div>
        <div class="nb-actions">${b.files.length ? `<button class="btn btn-sm" data-wait-run="${esc(b.batch)}" data-real="0">Preview</button>${can("run") ? `<button class="btn btn-sm btn-accent" data-wait-run="${esc(b.batch)}" data-real="1">Run for real</button>` : ""}` : `<span class="hint">No PDFs yet</span>`}</div></li>`;
    }).join("")}</ul>${can("run") ? "" : `<p class="hint">Only an Admin runs a batch for real. You can preview.</p>`}` : `<p class="empty">Nothing is waiting. Every batch in inbox/ has been run.</p>`;
  } catch (e) { box.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
}
async function runWaiting(btn) {
  const batch = btn.dataset.waitRun, real = btn.dataset.real === "1" && can("run");
  $$("[data-wait-run]").forEach((b) => (b.disabled = true));
  btn.textContent = real ? "Running…" : "Previewing…";
  try {
    const id = newId();
    const ran = await api(`api/batches/${encodeURIComponent(batch)}/run`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: user.id, name: user.name, role: user.role }, dry_run: !real, event_id: id }) });
    record("batch.run", { id, batch: ran.batch, folder: ran.folder, run_id: ran.run_id, dry_run: ran.dry_run, counts: ran.counts, documents: ran.documents, preflight: ran.preflight });
    await reloadData();
    render();
    toast(`${ran.dry_run ? "Preview" : "Run"} finished: ${ran.run_id}.`, { label: "Open the run", fn: () => (location.hash = `#/runs/${ran.run_id}`) });
  } catch (e) {
    openDialog("Penny could not run this batch", esc(e.message), "", "", () => "", { info: true });
    loadWaiting();
  }
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
  if (res.status === 401 && serverAccounts() && user && !/^api\/auth\//.test(path)) { endSession("expired"); }
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
    const made = await api("api/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: NB.name, user: who, date: today(), event_id: newId() }) });
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
  if (teamMode()) D.batch_log = TEAM.log;        // the live log from the server, not the copy inside the data file
  derive();
  $("#generated").textContent = `Data exported ${fmtDateTime(D.generated_at)}`;
}
function bindBatch() {
  const scan = $("#watch-scan");
  if (scan) scan.addEventListener("click", () => watchScan(scan));
  const wait = $("#nb-waiting");
  if (wait) { loadWaiting(); wait.addEventListener("click", (e) => { const b = e.target.closest("[data-wait-run]"); if (b) runWaiting(b); }); }
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
