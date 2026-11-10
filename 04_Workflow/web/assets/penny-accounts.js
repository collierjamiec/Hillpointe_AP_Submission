/* Penny web app: Accounts: both kinds of sign-in, invitation and reset links, the Users page, the Outbox and sending email.
   Sections: accounts (v1.7). */
"use strict";

// ------------------------------------------------------------------ accounts (v1.7)
/* Two kinds of sign-in, one interface:
   - The public demo and Penny on a computer without accounts use PennyAuth (penny-auth.js): the four public demo
     accounts plus anyone an Admin invites in this browser. Emails go to a demo Outbox in this browser.
   - Penny on a computer with accounts (state/users.json) uses ServerAuth: the server checks passwords, keeps the
     session in an HttpOnly cookie, and sends real email (or saves it when no mail server is set up). */
let ME = null;
const serverAccounts = () => !!(SERVER && SERVER.accounts);
const jsonPost = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
const ServerAuth = {
  IDLE_MINUTES: 30, MAX_TRIES: 5, reason: "",
  async signIn(email, password) {
    try { const r = await jsonPost("api/auth/login", { email: String(email || "").trim(), password }); ME = r.user; return { ok: true, user: r.user }; }
    catch (e) { return { ok: false, message: e.message }; }
  },
  currentUser() { return ME; },
  touch() { /* the server slides the session on every request */ },
  signOut(reason) { ServerAuth.reason = reason || ""; ME = null; fetch("api/auth/logout", { method: "POST", headers: { "X-Penny": "1", "Content-Type": "application/json" }, body: "{}" }).catch(() => null); },
  takeSignOutReason() { const r = ServerAuth.reason; ServerAuth.reason = ""; return r; },
  directory: {
    passwordProblem: (...a) => PennyAuth.directory.passwordProblem(...a),
    async list() { return (await api("api/users")).users; },
    async invite(actor, f) { return jsonPost("api/users", f); },
    async resend(actor, id) { return jsonPost(`api/users/${encodeURIComponent(id)}/resend`, {}); },
    async sendReset(actor, id) { return jsonPost(`api/users/${encodeURIComponent(id)}/reset`, {}); },
    async update(actor, id, changes) { return jsonPost(`api/users/${encodeURIComponent(id)}`, { changes }); },
    async checkToken(t) { return api(`api/auth/token?token=${encodeURIComponent(t)}`); },
    async useToken(t, password, name, purpose) { return (await jsonPost(purpose === "reset" ? "api/auth/reset" : "api/auth/activate", { token: t, password, name })).user; },
    async forgot(email) { await jsonPost("api/auth/forgot", { email }); return null; },
    async setPrefs(id, prefs) { return (await jsonPost("api/me/prefs", { prefs })).prefs; },
  },
};
const AUTH = () => (serverAccounts() ? ServerAuth : PennyAuth);
const DIRECTORY = () => AUTH().directory;
const appLink = (route) => `${location.origin}${location.pathname}#/${route}`;
function linkRoute() {
  const m = /^#\/(activate|reset)\?token=([A-Za-z0-9_-]{16,})/.exec(location.hash);
  return m ? { purpose: m[1] === "activate" ? "invite" : "reset", token: m[2] } : null;
}
async function refreshLog() {
  if (!SERVER) return;
  try { D.batch_log = (await api("api/log")).log; } catch (e) { /* the audit trail refreshes on the next load */ }
}
const msgOf = (e) => (e && (e.userMessage || e.message)) || "Something went wrong.";

// ---- demo outbox: emails the public demo would send, kept in this browser
const OUTBOX_KEY = "penny.outbox.v1";
const demoOutbox = () => { try { return JSON.parse(store.get(OUTBOX_KEY, "[]")); } catch (e) { return []; } };
function demoSend(mail) {
  const entry = { id: newId(), at: new Date().toISOString(), status: "demo", attachments: [], ...mail };
  const list = demoOutbox();
  list.unshift(entry);
  store.set(OUTBOX_KEY, JSON.stringify(list.slice(0, 200)));
  return entry;
}
function accountMail(purpose, u, token, hours, byName) {
  const link = appLink(`${purpose === "invite" ? "activate" : "reset"}?token=${token}`);
  const first = u.name.split(" ")[0];
  const body = purpose === "invite"
    ? `Hi ${first},\n\n${byName} invited you to Penny, the accounts payable workspace, as ${ROLES[u.role].name}.\n\nSet up your account and choose a password:\n${link}\n\nThis link works once and expires in ${hours} hours. If you did not expect this email, you can ignore it.\n\nPenny AP`
    : `Hi ${first},\n\n${byName ? `${byName} sent you a link` : "Someone (most likely you) asked on the sign-in page for a link"} to choose a new Penny password:\n${link}\n\nThis link works once and expires in ${hours} hour${hours === 1 ? "" : "s"}. If you did not ask for this, you can ignore it.\n\nPenny AP`;
  return demoSend({ to: [u.email], subject: purpose === "invite" ? "You're invited to Penny" : "Reset your Penny password", body, kind: purpose,
    by: byName ? { id: user ? user.id : "", name: byName, role: user ? user.role : "system" } : { id: u.id, name: u.name, role: "system" } });
}
const STATUS_MAIL = { sent: ["Sent", "b-approved"], saved: ["Saved, not sent", "b-waiting"], failed: ["Failed", "b-rejected"], demo: ["Demo: not sent", "b-skip"] };
const mailBadge = (st) => { const [l, c] = STATUS_MAIL[st] || [st, "b-skip"]; return `<span class="badge ${c}">${esc(l)}</span>`; };
/** After an invite or reset: what happened to the email, in words. */
function mailOutcome(res, what) {
  if (!res.email) return `${what} is in the Outbox. This demo has no real email, so open the Outbox to see the message and its link.`;
  if (res.email.status === "sent") return `${what} was emailed.`;
  if (res.email.status === "failed") return `${what} could not be emailed (${res.email.error}). It is saved in the Outbox.`;
  return `${what} was saved to the Outbox, not sent, because no mail server is set up. Copy the link from the Outbox and pass it on.`;
}

// ---- forgot password (both sign-in screens)
function bindForgot(box) {
  const b = $("[data-forgot]", box);
  if (!b) return;
  b.addEventListener("click", () => {
    const main = $(".auth-main", box);
    const prefill = ($("#login-email", box) || {}).value || "";
    main.innerHTML = `<h2 id="signin-title">Reset your password</h2>
      <p class="auth-sub">Enter the email you sign in with. If it has an active Penny account, we will send a link to choose a new password. The link works once and expires in 1 hour.</p>
      <form class="auth-form" id="forgot-form" novalidate>
        <div class="field"><label for="forgot-email">Email</label><input id="forgot-email" name="email" type="email" autocomplete="username" spellcheck="false" value="${esc(prefill)}" required></div>
        <p class="auth-error" id="forgot-error" role="alert" hidden></p>
        <button class="btn btn-primary" type="submit">Send the link</button>
        <button class="link-btn forgot-link" type="button" id="forgot-back">Back to sign in</button>
      </form><div id="forgot-done" aria-live="polite"></div>`;
    $("#forgot-back").addEventListener("click", () => showLogin());
    $("#forgot-email").focus();
    $("#forgot-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = $("#forgot-email").value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { const er = $("#forgot-error"); er.textContent = "Enter the email you sign in with."; er.hidden = false; return; }
      let demo = null;
      try { const r = await DIRECTORY().forgot(v); if (r && !serverAccounts()) demo = accountMail("reset", r.user, r.token, r.hours, null); } catch (x) { /* same message either way */ }
      track("password_forgot", {});
      $("#forgot-form").hidden = true;
      $("#forgot-done").innerHTML = `<p class="auth-info" role="status">If <b>${esc(v)}</b> has an active Penny account, a reset link is on its way. Check your email.</p>
        ${!serverAccounts() ? `<p class="hint">This demo has no real email.${demo ? ` Here is the message Penny would send:</p><pre class="mail-body">${linkify(demo.body)}</pre>` : " The four demo accounts keep their published passwords, so a reset is only sent for people an Admin invited in this browser.</p>"}` : ""}
        <button class="btn" type="button" id="forgot-done-back">Back to sign in</button>`;
      $("#forgot-done-back").addEventListener("click", () => showLogin());
    });
  });
}

// ---- sign in when Penny on a computer has real accounts
function showServerLogin(reason) {
  $("#shell").hidden = true;
  const box = $("#auth");
  box.hidden = false;
  document.title = "Sign in · Penny";
  const msg = reason === "expired" ? `<p class="auth-info" role="status">You were signed out after 30 minutes without activity, or your access changed. Please sign in again.</p>`
    : reason === "signed-out" ? `<p class="auth-info" role="status">You are signed out.</p>`
    : reason === "ready" ? `<p class="auth-info" role="status">Your password is set. Sign in to start.</p>` : "";
  box.innerHTML = `<div class="auth-wrap"><div class="auth-card auth-card-solo">
      <section class="auth-main" aria-labelledby="signin-title">
        <div class="auth-logo"><svg class="auth-coin" aria-hidden="true"><use href="#coin-front"/></svg><span>Penny</span></div>
        <h2 id="signin-title">Sign in</h2>
        <p class="auth-sub">Use the email your Admin invited. Your password is checked by Penny on this computer and never stored as text.</p>
        ${msg}
        <form class="auth-form" id="login-form" novalidate>
          <div class="field"><label for="login-email">Email</label><input id="login-email" name="email" type="email" autocomplete="username" spellcheck="false" value="${esc(ServerAuth.lastEmail || "")}" required></div>
          <div class="field"><label for="login-pw">Password</label><div class="pw-wrap"><input id="login-pw" name="password" type="password" autocomplete="current-password" required>
            <button class="pw-toggle" type="button" id="pw-toggle" aria-label="Show password" aria-pressed="false">Show</button></div></div>
          <p class="auth-error" id="login-error" role="alert" hidden></p>
          <button class="btn btn-primary" type="submit" id="login-submit"><span class="spin" aria-hidden="true"></span><span class="lbl">Sign in</span></button>
          <button class="link-btn forgot-link" type="button" data-forgot>Forgot your password?</button>
        </form>
      </section></div>
    <p class="auth-credit"><svg class="credit-coin" aria-hidden="true"><use href="#coin-front"/></svg>Designed and built by <strong>Jamie Collier</strong> · <span id="auth-version">Penny v${esc(APP_VERSION)}</span></p></div>`;
  const pw = $("#login-pw"), em = $("#login-email"), err = $("#login-error"), btn = $("#login-submit");
  (em.value ? pw : em).focus();
  $("#pw-toggle").addEventListener("click", (e) => { const show = pw.type === "password"; pw.type = show ? "text" : "password"; e.currentTarget.textContent = show ? "Hide" : "Show"; e.currentTarget.setAttribute("aria-pressed", String(show)); pw.focus(); });
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!em.value.trim() || !pw.value) { err.textContent = "Enter your email and password."; err.hidden = false; return; }
    btn.disabled = true; btn.classList.add("busy"); $(".lbl", btn).textContent = "Checking…";
    ServerAuth.lastEmail = em.value.trim();
    const res = await ServerAuth.signIn(em.value, pw.value);
    if (res.ok) {
      const ok = await loadData();
      if (ok === true) { pw.value = ""; enterApp(res.user); toast(`Welcome, ${res.user.name.split(" ")[0]}.`); return; }
    }
    btn.disabled = false; btn.classList.remove("busy"); $(".lbl", btn).textContent = "Sign in";
    err.textContent = res.ok ? "Signed in, but Penny could not load its data. Reload the page." : res.message; err.hidden = false;
    pw.value = ""; pw.focus();
  });
  bindForgot(box);
}

// ---- invitation and reset links
async function showAccountLink(purpose, token) {
  $("#shell").hidden = true;
  const box = $("#auth");
  box.hidden = false;
  document.title = purpose === "invite" ? "Set up your account · Penny" : "Choose a new password · Penny";
  const shell = (inner) => `<div class="auth-wrap"><div class="auth-card auth-card-solo"><section class="auth-main" aria-labelledby="link-title">
      <div class="auth-logo"><svg class="auth-coin" aria-hidden="true"><use href="#coin-front"/></svg><span>Penny</span></div>${inner}</section></div>
    <p class="auth-credit">Designed and built by <strong>Jamie Collier</strong> · Penny v${esc(APP_VERSION)}</p></div>`;
  box.innerHTML = shell(`<h2 id="link-title">Checking your link…</h2>`);
  let info;
  try { info = await DIRECTORY().checkToken(token); }
  catch (e) {
    box.innerHTML = shell(`<h2 id="link-title">This link does not work</h2><p class="auth-error" role="alert">${esc(msgOf(e))}</p>
      <button class="btn btn-primary" type="button" id="link-out">Go to sign in</button>`);
    $("#link-out").addEventListener("click", () => { history.replaceState(null, "", "#/"); showLogin(); });
    return;
  }
  const invite = info.purpose === "invite";
  box.innerHTML = shell(`<h2 id="link-title">${invite ? `Welcome to Penny, ${esc(info.name.split(" ")[0])}` : "Choose a new password"}</h2>
    <p class="auth-sub">${invite ? `You were invited as ${esc(article(ROLES[info.role].name))}. Check your name, then choose a password.` : `For <b>${esc(info.email)}</b>. Your old password stops working once you save.`}</p>
    <form class="auth-form" id="link-form" novalidate>
      <div class="field"><label for="link-email">Email</label><input id="link-email" type="email" value="${esc(info.email)}" autocomplete="username" readonly></div>
      ${invite ? `<div class="field"><label for="link-name">Your name</label><input id="link-name" name="name" value="${esc(info.name)}" autocomplete="name" maxlength="80"></div>` : ""}
      <div class="field"><label for="link-pw">New password</label><div class="pw-wrap"><input id="link-pw" type="password" autocomplete="new-password" aria-describedby="pw-rules" required>
        <button class="pw-toggle" type="button" id="pw-toggle" aria-label="Show password" aria-pressed="false">Show</button></div>
        <ul class="pw-rules" id="pw-rules"><li data-r="len">At least 10 characters</li><li data-r="mine">Not your email or name</li><li data-r="easy">Not an easy one to guess</li></ul></div>
      <div class="field"><label for="link-pw2">Type it again</label><input id="link-pw2" type="password" autocomplete="new-password" required></div>
      <p class="auth-error" id="link-error" role="alert" hidden></p>
      <button class="btn btn-primary" type="submit" id="link-submit">${invite ? "Create my account" : "Save my new password"}</button>
    </form>`);
  const pw = $("#link-pw"), pw2 = $("#link-pw2"), err = $("#link-error");
  const nameOf = () => ($("#link-name") || { value: info.name }).value;
  const check = () => {
    const p = pw.value, problem = DIRECTORY().passwordProblem(p, info.email, nameOf());
    $$("#pw-rules li").forEach((li) => {
      const ok = li.dataset.r === "len" ? p.length >= 10 : li.dataset.r === "mine" ? !/email or name/.test(problem) && p.length > 0 : p.length >= 10 && !/easy/.test(problem);
      li.classList.toggle("ok", ok);
    });
    return problem;
  };
  pw.addEventListener("input", check);
  pw.focus();
  $("#pw-toggle").addEventListener("click", (e) => { const show = pw.type === "password"; pw.type = pw2.type = show ? "text" : "password"; e.currentTarget.textContent = show ? "Hide" : "Show"; e.currentTarget.setAttribute("aria-pressed", String(show)); });
  $("#link-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const problem = check() || (pw.value !== pw2.value ? "The two passwords do not match." : "");
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    $("#link-submit").disabled = true;
    try {
      const u = await DIRECTORY().useToken(token, pw.value, invite ? nameOf() : undefined, info.purpose);
      if (!serverAccounts()) logEvent(invite ? "user.activated" : "user.password_reset", u, { email: u.email, user_id: u.id });
      track(invite ? "account_activated" : "password_reset", {});
      history.replaceState(null, "", "#/");
      ServerAuth.lastEmail = info.email;
      if (user) endSession("signed-out");
      if (serverAccounts()) return showServerLogin("ready");
      showLogin();
      const em = $("#login-email"); if (em) { em.value = info.email; $("#login-pw").focus(); }
      toast(invite ? "Your account is ready. Sign in with your new password." : "Password saved. Sign in with your new password.");
    } catch (x) {
      $("#link-submit").disabled = false;
      err.textContent = msgOf(x); err.hidden = false;
    }
  });
}
/** A demo event recorded for someone who is not signed in (activating an invitation). */
function logEvent(type, who, data) {
  EV.push({ id: newId(), at: new Date().toISOString(), type, user: { id: who.id, name: who.name, role: who.role, initials: who.initials || "" }, ...data });
  saveSandbox();
}

// ---- Users page (Admin)
const PEOPLE = { list: null, error: "" };
const STATUS_USER = { active: ["Active", "b-approved"], invited: ["Invited", "b-waiting"], inactive: ["Turned off", "b-skip"] };
async function loadPeople() {
  try { PEOPLE.list = await DIRECTORY().list(); PEOPLE.error = ""; } catch (e) { PEOPLE.error = msgOf(e); PEOPLE.list = PEOPLE.list || []; }
  const box = $("#users-body");
  if (box) box.innerHTML = usersTable();
}
function usersTable() {
  if (PEOPLE.error) return `<p class="form-error">${esc(PEOPLE.error)}</p>`;
  if (!PEOPLE.list) return `<p class="hint">Loading people…</p>`;
  const counts = Object.fromEntries(Object.keys(STATUS_USER).map((k) => [k, PEOPLE.list.filter((u) => u.status === k).length]));
  return `<div class="filter-summary"><span>${counts.active} active · ${counts.invited} invited · ${counts.inactive} turned off</span>${PEOPLE.list.some((u) => u.builtIn) ? "<span>Demo accounts keep their published passwords, so they have no reset.</span>" : ""}</div>
    <div class="table-wrap"><table class="data users"><thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col" class="hide-sm">Last sign-in</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${PEOPLE.list.map((u) => {
      const [sl, sc] = STATUS_USER[u.status] || [u.status, "b-skip"];
      const me = user && u.id === user.id;
      return `<tr><td><span class="u-person"><span class="avatar av-${esc(u.role)}" aria-hidden="true">${esc(u.initials)}</span><span><b>${esc(u.name)}</b>${me ? ' <span class="chip">You</span>' : ""}${u.builtIn ? ' <span class="chip" title="Public demo account with a published password">Demo account</span>' : ""}
          <span class="sub">${esc(u.email)}${u.title ? ` · ${esc(u.title)}` : ""}</span></span></span></td>
        <td>${esc(ROLES[u.role].name)}</td><td><span class="badge ${sc}">${esc(sl)}</span></td>
        <td class="hide-sm">${u.last_sign_in ? esc(fmtDateTime(u.last_sign_in)) : '<span class="hint">Never</span>'}</td>
        <td><div class="u-actions"><button class="btn btn-sm" type="button" data-user-edit="${esc(u.id)}">Edit</button>
          ${u.status === "invited" ? `<button class="btn btn-sm" type="button" data-user-resend="${esc(u.id)}">Resend invite</button>` : ""}
          ${u.status === "active" && !u.builtIn ? `<button class="btn btn-sm" type="button" data-user-reset="${esc(u.id)}">Send password reset</button>` : ""}
          ${me ? "" : `<button class="btn btn-sm ${u.status === "inactive" ? "" : "btn-ghost"}" type="button" data-user-toggle="${esc(u.id)}">${u.status === "inactive" ? "Turn on" : "Turn off"}</button>`}</div></td></tr>`;
    }).join("")}</tbody></table></div>`;
}
function viewUsers() {
  if (!can("users")) return `${head("Users", "")}<section class="card"><div class="empty-state">${ICON.shield}<h2>Only Admins manage people</h2><p>Sign in as an Admin to invite people, change roles or send password resets.</p></div></section>`;
  if (!PEOPLE.list) loadPeople();
  const mail = serverAccounts() ? (SERVER.email || {}) : null;
  return `${head("Users", "Invite people, choose what each one can do, turn accounts off, and send password resets. Every change is in the audit trail.",
      `<button class="btn btn-accent" type="button" id="user-invite">Invite someone</button>`)}
    <div class="mode-banner ${serverAccounts() ? (mail.sends ? "mode-ok" : "mode-warn") : "mode-demo"}" role="note">${serverAccounts()
      ? `<b>Accounts on this computer.</b> Email: ${esc(mail.how || "")}.${mail.sends ? "" : " Set PENNY_SMTP_HOST to send for real (see Help)."}`
      : `<b>Demo directory.</b> People you invite are kept in this browser, and their emails land in the <a href="#/outbox">Outbox</a> with a working link. The four public demo accounts keep their published passwords.`}</div>
    <section class="card" id="users-body">${usersTable()}</section>
    <section class="card card-pad" style="margin-top:16px"><h2 class="sub-h" style="margin-top:0">Roles</h2>
      <ul class="role-list">${Object.entries(ROLES).map(([k, r]) => `<li><b>${esc(r.name)}</b> ${esc(r.blurb)}</li>`).join("")}</ul></section>`;
}
const roleSelect = (cur) => `<select id="dlg-role" name="role">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}"${k === cur ? " selected" : ""}>${esc(r.name)}</option>`).join("")}</select>`;
async function userAction(fn, okMsg) {
  try { const res = await fn(); await loadPeople(); await refreshLog(); toast(okMsg(res)); return ""; }
  catch (e) { toast(msgOf(e)); return msgOf(e); }
}
function bindUsers() {
  const main = $("#main");
  const inv = $("#user-invite");
  if (inv) inv.addEventListener("click", () => openDialog("Invite someone", "They get an email with a link to set up their account and choose a password. The link works once and expires in 72 hours.",
    `<div class="field-row"><div class="field"><label for="dlg-name">Name</label><input id="dlg-name" name="name" maxlength="80" autocomplete="off" required></div>
      <div class="field"><label for="dlg-email">Email</label><input id="dlg-email" name="email" type="email" autocomplete="off" spellcheck="false" required></div></div>
     <div class="field-row"><div class="field"><label for="dlg-title">Job title (optional)</label><input id="dlg-title" name="title" maxlength="80"></div>
      <div class="field"><label for="dlg-role">Role</label>${roleSelect("viewer")}</div></div>
     <p class="hint">Start with the least access someone needs. You can change it any time.</p>`,
    "Send invitation", (fd) => {
      const f = { name: String(fd.get("name") || "").trim(), email: String(fd.get("email") || "").trim(), title: String(fd.get("title") || "").trim(), role: fd.get("role") };
      if (f.name.length < 2) return "Enter their name.";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return "Enter a valid email address.";
      (async () => {
        await null;            // let the dialog that started this close first, so a follow-up message stays open
        try {
          const res = await DIRECTORY().invite(user, f);
          if (!serverAccounts()) { const m = accountMail("invite", res.user, res.token, res.hours, user.name); record("user.invited", { email: res.user.email, role: res.user.role, user_id: res.user.id, email_status: "demo", outbox: m.id }); }
          await loadPeople(); await refreshLog();
          toast(mailOutcome(res, `${res.user.name}'s invitation`));
        } catch (e) { openDialog("The invitation was not sent", esc(msgOf(e)), "", "", () => "", { info: true }); }
      })();
      return "";
    }));
  if (main.dataset.usersBound) return;
  main.dataset.usersBound = "1";
  main.addEventListener("click", (e) => {
    if (!$("#users-body")) return;
    const find = (attr) => { const b = e.target.closest(`[${attr}]`); return b ? (PEOPLE.list || []).find((u) => u.id === b.getAttribute(attr)) : null; };
    let u;
    if ((u = find("data-user-edit"))) {
      const me = u.id === user.id;
      openDialog(`Edit ${u.name}`, esc(u.email), `<div class="field-row"><div class="field"><label for="dlg-name">Name</label><input id="dlg-name" name="name" value="${esc(u.name)}" maxlength="80"></div>
          <div class="field"><label for="dlg-email">Email</label><input id="dlg-email" name="email" type="email" value="${esc(u.email)}" ${u.builtIn ? "readonly" : ""}></div></div>
        <div class="field-row"><div class="field"><label for="dlg-title">Job title</label><input id="dlg-title" name="title" value="${esc(u.title || "")}" maxlength="80"></div>
          <div class="field"><label for="dlg-role">Role</label>${roleSelect(u.role)}</div></div>
        ${me ? `<p class="hint">You cannot remove your own Admin role or turn off your own account. Another Admin can.</p>` : `<p class="hint">Changing someone's role or email signs them out, so the change takes effect at once.</p>`}`,
        "Save changes", (fd) => {
          const changes = {};
          for (const k of ["name", "email", "title", "role"]) { const v = String(fd.get(k) || "").trim(); if (v !== String(u[k] || "")) changes[k] = v; }
          if (!Object.keys(changes).length) return "Nothing changed.";
          (async () => {
        await null;            // let the dialog that started this close first, so a follow-up message stays open
            try {
              const res = await DIRECTORY().update(user, u.id, changes);
              if (!serverAccounts() && Object.keys(res.changes).length) record("user.updated", { email: res.user.email, user_id: u.id, changes: res.changes });
              await loadPeople(); await refreshLog(); toast(`${res.user.name} updated.`);
            } catch (x) { openDialog("Not saved", esc(msgOf(x)), "", "", () => "", { info: true }); }
          })();
          return "";
        });
    } else if ((u = find("data-user-toggle"))) {
      const off = u.status !== "inactive";
      openDialog(off ? `Turn off ${u.name}'s account?` : `Turn ${u.name}'s account back on?`, off ? "They are signed out at once and cannot sign in until an Admin turns the account back on. Nothing they did is removed." : u.has_password ? "They can sign in again with their password." : "They never finished setting up, so they will need a new invitation.",
        "", off ? "Turn off" : "Turn on", () => {
          (async () => {
        await null;            // let the dialog that started this close first, so a follow-up message stays open
            try {
              const res = await DIRECTORY().update(user, u.id, { status: off ? "inactive" : "active" });
              if (!serverAccounts()) record("user.updated", { email: u.email, user_id: u.id, changes: res.changes });
              await loadPeople(); await refreshLog(); toast(off ? `${u.name}'s account is turned off.` : `${u.name}'s account is on.`);
            } catch (x) { openDialog("Not changed", esc(msgOf(x)), "", "", () => "", { info: true }); }
          })();
          return "";
        }, { danger: off });
    } else if ((u = find("data-user-reset")) || (u = find("data-user-resend"))) {
      const reset = !!e.target.closest("[data-user-reset]");
      userAction(async () => {
        await null;            // let the dialog that started this close first, so a follow-up message stays open
        const res = await (reset ? DIRECTORY().sendReset(user, u.id) : DIRECTORY().resend(user, u.id));
        if (!serverAccounts()) { accountMail(reset ? "reset" : "invite", res.user, res.token, res.hours, user.name); record(reset ? "user.reset_sent" : "user.invite_resent", { email: u.email, user_id: u.id, email_status: "demo" }); }
        return res;
      }, (res) => mailOutcome(res, reset ? `The reset link for ${u.name}` : `The new invitation for ${u.name}`));
    }
  });
}

// ---- Outbox
const OB = { list: null };
async function loadOutbox() {
  if (serverAccounts() || SERVER) {
    try { OB.list = (await api("api/outbox")).emails.map((m) => ({ ...m, bodyText: m.body })); } catch (e) { OB.list = []; OB.error = msgOf(e); }
  } else OB.list = demoOutbox().filter((m) => can("users") || !m.by || m.by.id === user.id).map((m) => ({ ...m, bodyText: m.body }));
  const box = $("#outbox-body");
  if (box) box.innerHTML = outboxTable();
}
function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_self">${u}</a>`);
}
function outboxTable() {
  if (!OB.list) return `<p class="hint">Loading…</p>`;
  if (!OB.list.length) return `<div class="empty-state">${ICON.check}<h2>No emails yet</h2><p>Invitations, password resets, approval requests and exports you email show up here.</p></div>`;
  return `<div class="table-wrap"><table class="data outbox"><thead><tr><th scope="col">When</th><th scope="col">To</th><th scope="col">Subject</th><th scope="col">Status</th></tr></thead><tbody>
    ${OB.list.map((m) => `<tr data-mail="${esc(m.id)}" tabindex="0"><td style="white-space:nowrap">${esc(fmtDateTime(m.at))}</td><td>${esc((m.to || []).join(", "))}</td>
      <td><a href="#" class="main-link" data-mail-open="${esc(m.id)}">${esc(m.subject)}</a><span class="sub">${esc((m.by || {}).name || "")}${(m.attachments || []).length ? ` · ${plural(m.attachments.length, "attachment")}` : ""}</span></td>
      <td>${mailBadge(m.status)}</td></tr>`).join("")}</tbody></table></div>`;
}
function viewOutbox() {
  if (!can("email")) return `${head("Outbox", "")}<section class="card"><div class="empty-state">${ICON.shield}<h2>Viewers do not send email</h2><p>AP Clerks, Approvers and Admins can email exports and approval requests.</p></div></section>`;
  OB.list = null;
  loadOutbox();
  const mail = SERVER && SERVER.email;
  return `${head("Outbox", `${can("users") ? "Every email Penny sent or saved" : "Emails you sent from Penny"}, newest first. Open one to read it exactly as it went out.`)}
    <div class="mode-banner ${SERVER ? (mail && mail.sends ? "mode-ok" : "mode-warn") : "mode-demo"}" role="note">${SERVER ? `<b>Email:</b> ${esc((mail || {}).how || "")}.` : "<b>Demo outbox.</b> This public demo cannot send email, so each message is kept here in your browser instead. Links in it work."}</div>
    <section class="card" id="outbox-body">${outboxTable()}</section>`;
}
function bindOutbox() {
  const box = $("#outbox-body");
  if (!box) return;
  const open = (id) => {
    const m = (OB.list || []).find((x) => x.id === id);
    if (!m) return;
    openDialog(m.subject, `To ${esc((m.to || []).join(", "))} · ${esc(fmtDateTime(m.at))} · ${mailBadge(m.status)}${m.error ? ` <span class="form-error">${esc(m.error)}</span>` : ""}`,
      `<pre class="mail-body">${linkify(m.bodyText || "")}</pre>${(m.attachments || []).length ? `<p class="hint">Attached: ${m.attachments.map((f) => `${esc(f.name)} (${esc(fmtBytes(f.bytes || 0))}${f.sha256 ? `, ${esc(f.sha256.slice(0, 10))}` : ""})`).join(", ")}</p>` : ""}`,
      "", () => "", { info: true, wide: true });
  };
  box.addEventListener("click", (e) => { const a = e.target.closest("[data-mail-open]"); if (a) { e.preventDefault(); open(a.dataset.mailOpen); return; } const tr = e.target.closest("tr[data-mail]"); if (tr && !e.target.closest("a")) open(tr.dataset.mail); });
  box.addEventListener("keydown", (e) => { const tr = e.target.closest("tr[data-mail]"); if (tr && e.key === "Enter") open(tr.dataset.mail); });
}

// ---- Email an export or an approval request
async function peopleToEmail() {
  try { return serverAccounts() ? (await api("api/people")).people : PennyAuth.directory.list().filter((u) => u.status === "active"); } catch (e) { return []; }
}
function allowedDomains() { return ((RULES().email || {}).allowed_domains || []).map((d) => String(d).toLowerCase()); }
async function emailDialog(o) {
  let subject, body, attachLine, suggest;
  const people = await peopleToEmail();
  if (o.kind === "export") {
    const run = X.runById[o.run], info = FILE_INFO[o.file] || { title: o.file, what: "", who: "" };
    subject = `${info.title}: ${run.label}`;
    attachLine = `${o.file}${o.bytes ? ` (${fmtBytes(o.bytes)})` : ""}`;
    body = `What it is: ${info.what}`;
    suggest = people.filter((p) => p.role === "clerk" || p.role === "admin");
  } else {
    const d = o.doc, steps = approvalSteps(d).filter((s2) => s2.status !== "approved").map((s2) => s2.label);
    subject = `Approval needed: ${d.vendor} ${d.billNo} (${money(d.amount)})`;
    attachLine = d.pdf ? `${d.file} (the original invoice)` : "No PDF on file";
    body = `Approvals needed: ${steps.join("; ")}. The bill is ready for import; it is not posted or paid yet.`;
    suggest = people.filter((p) => p.role === "approver" || p.role === "admin");
  }
  const domains = allowedDomains();
  openDialog(o.kind === "export" ? "Email this file" : "Email for approval", esc(subject),
    `<div class="field"><label for="dlg-to">To</label><input id="dlg-to" name="to" autocomplete="off" spellcheck="false" placeholder="name@${esc(domains[0] || "company.com")}, another@…" aria-describedby="dlg-to-hint">
      <span class="hint" id="dlg-to-hint">Separate addresses with commas. Penny may email its users and ${domains.length ? `addresses at ${esc(domains.join(", "))}` : "no one else"}.</span>
      ${suggest.length ? `<div class="chips" style="margin-top:6px">${suggest.slice(0, 8).map((p) => `<button type="button" class="chip chip-btn" data-add-to="${esc(p.email)}">${esc(p.name)} · ${esc(ROLES[p.role].name)}</button>`).join("")}</div>` : ""}</div>
     ${noteField("Note", false, o.kind === "export" ? "For example: here is today's import file for review." : "For example: please approve by Friday.")}
     <p class="hint">${esc(body)}</p><p class="hint"><b>Attached:</b> ${esc(attachLine)}</p>
     ${SERVER ? "" : `<p class="hint">This demo cannot send email. The message goes to the <a href="#/outbox">Outbox</a> in this browser.</p>`}`,
    "Send", (fd) => {
      const to = String(fd.get("to") || "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (!to.length) return "Add at least one recipient.";
      const bad = to.find((t) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t));
      if (bad) return `“${bad}” is not a valid email address.`;
      const known = new Set(people.map((p) => p.email));
      const outside = to.find((t) => !known.has(t) && !domains.includes(t.split("@")[1]));
      if (outside) return `${outside} is outside the domains Penny may email (${domains.join(", ") || "none set"}). An Admin can add one in rules.json.`;
      if (to.length > ((RULES().email || {}).max_recipients || 10)) return "That is too many recipients for one email.";
      const note = String(fd.get("note") || "").trim();
      (async () => {
        await null;            // let the dialog that started this close first, so a follow-up message stays open
        try {
          if (SERVER) {
            const res = await jsonPost("api/email", { kind: o.kind, to, note, run_id: o.kind === "export" ? o.run : o.doc.cur.run_id, doc_id: o.kind === "approval" ? o.doc.id : "", file: o.file || "",
              user: { id: user.id, name: user.name, role: user.role } });
            await refreshLog();
            toast(res.status === "sent" ? "Email sent." : res.status === "saved" ? "Saved to the Outbox, not sent: no mail server is set up." : `The email failed: ${res.error}`);
          } else {
            const link = o.kind === "export" ? appLink(`runs/${o.run}`) : appLink(`invoices/${o.doc.id}`);
            const m = demoSend({ to, subject, kind: o.kind, by: { id: user.id, name: user.name, role: user.role },
              body: `${user.name} ${o.kind === "export" ? "shared a file" : "asked you to review a bill"} in Penny.\n\n${note ? `Note: ${note}\n\n` : ""}${body}\n\nOpen it in Penny: ${link}\n\nSent from Penny by ${user.name}.`,
              attachments: [{ name: o.kind === "export" ? o.file : o.doc.file, bytes: o.bytes || 0 }] });
            record("email.sent", { to, subject, kind: o.kind, doc: o.kind === "approval" ? o.doc.id : undefined, attachments: m.attachments, outbox: m.id });
            toast("Saved to the demo Outbox. This demo cannot send real email.");
          }
        } catch (e) { openDialog("The email was not sent", esc(msgOf(e)), "", "", () => "", { info: true }); }
      })();
      return "";
    });
  $$("#dialog [data-add-to]").forEach((b) => b.addEventListener("click", () => {
    const inp = $("#dlg-to");
    const list = inp.value.split(/[,;\s]+/).filter(Boolean);
    if (!list.includes(b.dataset.addTo)) list.push(b.dataset.addTo);
    inp.value = list.join(", ");
    b.classList.add("on");
  }));
}
