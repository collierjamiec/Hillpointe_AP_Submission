/* Penny web app: Working as a team (v2.0).
   Sections: what team mode is, loading the team's audit log, sending an action, live updates, moving a browser's
   earlier work. */
"use strict";

// ------------------------------------------------------------------ what team mode is
/* When Penny runs on a computer with real accounts, that server is the single source of truth. Every action is sent
   to it, checked there (who you are, what your role may do, and what teammates have already done), and saved in its
   database. This browser keeps nothing of its own: the audit log on screen is the server's, and it is refreshed the
   moment anyone on the team does something.

   To stay quick, an action shows on screen right away and is marked "pending" until the server answers. If the
   server refuses it (someone resolved that hold a second before you, say), Penny takes it back off the screen and
   tells you why.

   The public demo, and Penny on a computer with only the demo accounts, are not team mode: there, actions stay in
   the browser as they always have. */
const TEAM = { on: false, last: 0, seen: new Set(), log: [], stale: false, running: false, stop: null };
const teamMode = () => TEAM.on;
/* The server records these itself when it does the work, so the browser never sends them. */
const SERVER_OWNED = /^(batch\.|manual\.saved$|user\.|email\.|recheck\.|watch\.)/;
const stripEvent = (e) => { const { pending, seq, origin, user: _u, at: _a, repeat, ...rest } = e; return rest; };

// ------------------------------------------------------------------ loading the team's audit log
/** Start from the server's audit log instead of this browser's. Called while the data loads, before the first page. */
async function teamLoad() {
  Object.assign(TEAM, { on: true, last: 0, seen: new Set(), log: [], stale: false });
  EV = [];
  const r = await api("api/events?after=0");
  teamTake(r.events, true);
  D.batch_log = TEAM.log;
}
/** Fold events from the server into what this browser shows. Returns the ones that are new to it. */
function teamTake(events, advance) {
  const fresh = [];
  for (const e of events || []) {
    if (advance) TEAM.last = Math.max(TEAM.last, e.seq);
    if (TEAM.seen.has(e.seq)) continue;
    TEAM.seen.add(e.seq);
    if (e.origin === "server") {
      const { seq, origin, ...entry } = e;
      TEAM.log.push(entry);
      // A manual entry saved for the next run changes what the invoice page shows, so keep a copy the page can replay.
      if (e.event === "manual.saved" && e.doc) EV.push({ id: e.id || `srv-${seq}`, type: "manual.saved", doc: e.doc, batch: e.batch, folder: e.folder, at: e.at, mirror: true,
        user: { id: e.by.id, name: e.by.name, role: e.by.role, initials: "" } });
    } else {
      const i = EV.findIndex((x) => x.id === e.id);
      if (i >= 0) EV[i] = e;                                   // the server's copy replaces the pending one
      else { const p = EV.findIndex((x) => x.pending); if (p >= 0) EV.splice(p, 0, e); else EV.push(e); }
    }
    fresh.push(e);
  }
  if (D) D.batch_log = TEAM.log;
  return fresh;
}
/** Ask once, without waiting, for anything newer than what this browser has. */
async function teamPull() {
  if (!TEAM.on) return [];
  const r = await api(`api/events?after=${TEAM.last}`);
  return teamTake(r.events, true);
}

// ------------------------------------------------------------------ sending an action
/** Send one action to the server. It is already on screen as pending; this confirms it or takes it back. */
async function teamPush(ev) {
  try {
    const r = await jsonPost("api/events", { event: stripEvent(ev) });
    const i = EV.findIndex((x) => x.id === ev.id);
    if (i >= 0) EV[i] = r.event;                               // now carries the server's time, number and your real name
    TEAM.seen.add(r.event.seq);
    if (r.rules) D.rules = r.rules;
    derive();
    if (r.rules && user) { applyLook(); render(); }
  } catch (e) {
    EV = EV.filter((x) => x.id !== ev.id);
    derive();
    if (!user) return;
    try { await teamPull(); derive(); } catch (x) { /* the next live update will catch up */ }
    const dlg = $("#dialog");
    if (dlg.open) dlg.close();
    render();
    openDialog("Penny did not save that", esc(msgOf(e)), `<p class="hint">Nothing was changed. What you see now is how things stand for the whole team.</p>`, "", () => "", { info: true });
  }
}

// ------------------------------------------------------------------ live updates
const teamBusy = () => { const a = document.activeElement; return $("#dialog").open || !!(a && a.closest("#main") && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "search"); };
/** Show what teammates just did: refresh the page, or if you are in the middle of typing, offer to. */
async function teamShow(fresh) {
  if (!fresh.length || !user) return;
  if (fresh.some((e) => String(e.type || "").startsWith("rules."))) { try { D.rules = (await api("api/rules")).rules; } catch (e) { /* next load */ } }
  // A run or a pickup changes the invoices themselves, not just the log.
  if (fresh.some((e) => e.origin === "server" && /^(batch\.run|watch\.picked_up|manual\.saved)$/.test(e.event || "") && (e.by || {}).id !== user.id)) {
    try { await reloadData(); } catch (e) { /* next load */ }
  }
  derive();
  const others = fresh.filter((e) => e.origin !== "server" && e.user && e.user.id !== user.id);
  if (others.length) {
    const e = others[others.length - 1];
    toast(others.length === 1 ? `${e.user.name}: ${(EVENT_LABEL[e.type] || e.type).toLowerCase()}.` : `${plural(others.length, "new action")} from your team.`);
  }
  if (teamBusy()) { TEAM.stale = true; paintTeamNote(); } else if (others.length || fresh.some((e) => e.origin === "server")) { applyLook(); render(); }
}
/** A quiet note when the page is behind because you were typing. Choosing it, or opening any page, catches up. */
function paintTeamNote() {
  let el = $("#team-note");
  if (!el) {
    el = document.createElement("button");
    el.id = "team-note"; el.type = "button"; el.className = "team-note";
    el.addEventListener("click", () => render());
    document.body.appendChild(el);
  }
  el.textContent = "Your team made changes. Show them";
  el.hidden = !TEAM.stale;
}
/** Keep one request open to the server. It answers the moment anything new is saved, then we ask again. */
async function teamLoop() {
  if (TEAM.running || !TEAM.on) return;
  TEAM.running = true;
  let wait = 2000;
  while (TEAM.on && user) {
    const ctrl = new AbortController();
    TEAM.stop = () => ctrl.abort();
    try {
      const r = await api(`api/events?after=${TEAM.last}&wait=25`, { signal: ctrl.signal });
      wait = 2000;
      await teamShow(teamTake(r.events, true));
    } catch (e) {
      if (!TEAM.on || !user) break;
      await new Promise((ok) => setTimeout(ok, wait));          // the server is unreachable: try again, a little slower each time
      wait = Math.min(wait * 2, 30000);
    }
  }
  TEAM.running = false;
}
function teamStop() {
  if (TEAM.stop) TEAM.stop();
  TEAM.stale = false;
  const el = $("#team-note");
  if (el) el.hidden = true;
}

// ------------------------------------------------------------------ moving a browser's earlier work
/* Before 2.0, what people did was saved in each browser. An Admin can move that history into the team's audit log
   once. Each action keeps its original time and person and is marked as moved. Nothing is removed from the browser. */
const MOVED_KEY = "penny.sandbox.moved";
function earlierWork() {
  try { const j = JSON.parse(store.get(SANDBOX_KEY, "null")); return j && Array.isArray(j.events) ? j.events.filter((e) => e && e.id && e.type && e.user) : []; } catch (e) { return []; }
}
function offerEarlierWork() {
  if (!TEAM.on || !user || user.role !== "admin" || store.get(MOVED_KEY, "")) return;
  let asked = false;
  try { asked = sessionStorage.getItem("penny.move.asked") === "1"; sessionStorage.setItem("penny.move.asked", "1"); } catch (e) { /* fine */ }
  const old = earlierWork();
  if (asked || !old.length) return;
  openDialog("Move this browser's earlier work into Penny?",
    `This browser holds ${esc(plural(old.length, "action"))} saved before Penny 2.0: resolved holds, approvals, notes and rule changes.`,
    `<ul class="notes"><li>They are added to the team's audit trail with their original time and person, marked as moved by you.</li>
       <li>Rule changes are kept as history only. They do not change the rules Penny runs with.</li>
       <li>Nothing is removed from this browser, and an action already in Penny is skipped.</li></ul>
     <label class="check"><input type="checkbox" name="never"> Do not ask again in this browser</label>`,
    "Move them", (fd, how) => {
      (async () => {
        await null;
        try {
          const r = await jsonPost("api/events/import", { events: old });
          store.set(MOVED_KEY, new Date().toISOString());
          await teamPull(); derive(); render();
          toast(`Moved ${plural(r.added, "action")} into Penny${r.skipped ? `, skipped ${r.skipped} already there` : ""}.`);
        } catch (e) { openDialog("Penny could not move them", esc(msgOf(e)), "", "", () => "", { info: true }); }
      })();
      return "";
    }, { cancelLabel: "Not now", onCancel: (fd) => { if (fd && fd.get("never")) store.set(MOVED_KEY, "declined"); } });
}
