/* Penny web app: My profile (v2.3).
   Sections: what a profile is, avatars, the page, saving, the photo, the password, my activity. */
"use strict";

// ------------------------------------------------------------------ what a profile is
/* Each person manages their own details: name, title, a short "about" line, who covers for them, and a photo.
   Everything on a profile can be changed except the username (the sign-in email) and the user id. Role and status
   are not part of a profile: they control access, so an Admin sets them on the Users page.

   Details imported from a Microsoft or Google account are a starting point. The person can change any of them, and
   Penny keeps their version. (Sign-in with Microsoft and Google is not built yet; the import is ready for it.)

   "My activity" is private: only the signed-in person sees their own numbers. Admins see usage by role, never by
   person (see Insights). */
const ABOUT_MAX = 280;
const PHOTO_SIZE = 192;               // pixels; the photo is cut to a square and shrunk in the browser before it is sent
const PROVIDER_NAME = { microsoft: "Microsoft", google: "Google" };
const PROFILE_FIELD = { name: "name", title: "title", about: "about line", photo: "photo", backup: "backup person" };
let PF = { people: [], photo: null, busy: false, said: "", pwSaid: "" };     // said and pwSaid outlive a redraw, so a live update cannot wipe "Saved"

// ------------------------------------------------------------------ avatars
/** What goes inside an avatar circle: the person's photo when they have one, their initials when they do not. */
function avatarInner(u) {
  return u && u.photo && /^data:image\/(png|jpeg|webp);base64,/.test(u.photo) ? `<img src="${esc(u.photo)}" alt="">` : esc((u && u.initials) || "");
}
/** Redraw the signed-in person's name and avatar in the top bar (after sign-in and after a profile change). */
function paintMe() {
  if (!user) return;
  $("#user-avatar").innerHTML = avatarInner(user);
  $("#user-avatar").className = `avatar av-${user.role}${user.photo ? " has-photo" : ""}`;
  $("#user-name").textContent = user.name;
  $("#user-role").textContent = ROLES[user.role].name;
  $("#user-pop-head").innerHTML = `<strong>${esc(user.name)}</strong>${esc(user.title)} · ${esc(ROLES[user.role].name)}<br>${esc(user.email)}`;
}

// ------------------------------------------------------------------ the page
/** The My profile page: photo, details, sign-in facts, password and my activity. */
function viewProfile() {
  const u = user, from = PROVIDER_NAME[u.source];
  const photo = PF.photo === null ? u.photo || "" : PF.photo;
  const shown = { ...u, photo };
  const others = PF.people.filter((p) => p.id && p.id !== u.id);
  const imported = (u.imported || []).map((k) => PROFILE_FIELD[k]).filter(Boolean);
  return `${head("My profile", "Your details, as teammates see them. You can change everything here except your username and user ID.")}
  <p class="look-saved" id="pf-saved" role="status"${PF.said ? "" : " hidden"}>${esc(PF.said)}</p>
  ${from ? `<div class="role-banner pf-source"><span><strong>Imported from your ${esc(from)} account.</strong> ${imported.length ? `Your ${esc(listWords(imported))} came from there.` : "You have since made every detail your own."} You can change anything below, and Penny keeps your version.</span></div>` : ""}
  <div class="pf-layout">
    <form class="card pf-card" id="pf-form" novalidate>
      <div class="card-head"><h2>About you</h2></div>
      <div class="card-body pf-body">
        <div class="pf-photo">
          <span class="avatar pf-avatar av-${esc(u.role)}${photo ? " has-photo" : ""}" id="pf-avatar" aria-hidden="true">${avatarInner(shown)}</span>
          <div class="pf-photo-actions">
            <label class="btn" for="pf-file">${photo ? "Change photo" : "Add a photo"}</label>
            <input class="sr-only" id="pf-file" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="pf-photo-hint">
            ${photo ? `<button type="button" class="btn" id="pf-photo-remove">Remove photo</button>` : ""}
            <p class="hint" id="pf-photo-hint">A PNG, JPEG or WebP picture. Penny cuts it to a square and shrinks it. Without a photo, your initials show.</p>
          </div>
        </div>
        <div class="pf-fields">
          <div class="field"><label for="pf-name">Name</label><input id="pf-name" name="name" value="${esc(u.name)}" maxlength="80" autocomplete="name" required></div>
          <div class="field"><label for="pf-title">Title</label><input id="pf-title" name="title" value="${esc(u.title || "")}" maxlength="80" autocomplete="organization-title"></div>
          <div class="field pf-wide"><label for="pf-about">About <span class="hint" id="pf-count"></span></label>
            <textarea id="pf-about" name="about" maxlength="${ABOUT_MAX}" rows="3" aria-describedby="pf-about-hint">${esc(u.about || "")}</textarea>
            <p class="hint" id="pf-about-hint">One or two sentences: what you cover, or when you are out.</p></div>
          <div class="field pf-wide"><label for="pf-backup">Who covers for you</label>
            <select id="pf-backup" name="backup" aria-describedby="pf-backup-hint"><option value="">No one chosen</option>${others.map((p) =>
              `<option value="${esc(p.id)}"${p.id === u.backup ? " selected" : ""}>${esc(p.name)}${p.title ? `, ${esc(p.title)}` : ""}</option>`).join("")}</select>
            <p class="hint" id="pf-backup-hint">Shown to an Admin on the Users page, so they know who to ask when you are away.</p></div>
        </div>
        <p class="form-error" id="pf-error" role="alert" hidden></p>
        <div class="pf-actions"><button type="submit" class="btn btn-accent" id="pf-save">Save profile</button></div>
      </div>
    </form>
    <div class="stack">
      <section class="card" aria-labelledby="pf-signin-h">
        <div class="card-head"><h2 id="pf-signin-h">Signing in</h2></div>
        <div class="card-body">
          <dl class="pf-facts">
            <div><dt>Username</dt><dd id="pf-username">${esc(u.email)}</dd></div>
            <div><dt>User ID</dt><dd id="pf-id"><code>${esc(u.id)}</code></dd></div>
            <div><dt>Role</dt><dd>${esc(ROLES[u.role].name)}</dd></div>
            <div><dt>Account</dt><dd>${esc(from ? `${from} account` : serverAccounts() ? "Penny account" : "Demo account, kept in this browser")}</dd></div>
          </dl>
          <p class="hint">Your username and user ID cannot be changed, so the audit trail always points to the same person. Your role is set by an Admin.</p>
        </div>
      </section>
      ${profilePassword(from)}
      ${profileActivity()}
    </div>
  </div>`;
}
/** "a, b and c" from a list of words. */
function listWords(list) { return list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`; }

// ------------------------------------------------------------------ saving
/** Wire the My profile page: load the people who can be a backup, then the form, the photo and the password. */
function bindProfile() {
  if (!PF.loaded) { PF.loaded = true; peopleToEmail().then((list) => { PF.people = list || []; if (location.hash.startsWith("#/profile")) render(); }); }
  const about = $("#pf-about"), count = $("#pf-count");
  const tally = () => { count.textContent = `(${about.value.length} of ${ABOUT_MAX})`; };
  about.addEventListener("input", tally); tally();
  $("#pf-form").addEventListener("input", (e) => { if (e.isTrusted && PF.said) profileSaid(""); });      // start typing again and the old "Saved" goes
  $("#pf-file").addEventListener("change", (e) => pickPhoto(e.target.files[0]));
  const rm = $("#pf-photo-remove");
  if (rm) rm.addEventListener("click", () => { PF.photo = ""; keepTyping(); });
  $("#pf-form").addEventListener("submit", (e) => { e.preventDefault(); saveProfile(); });
  bindProfilePassword();
}
/** Redraw the page without losing what has been typed (used after a photo is picked or removed). */
function keepTyping() {
  const typed = { name: $("#pf-name").value, title: $("#pf-title").value, about: $("#pf-about").value, backup: $("#pf-backup").value };
  render();
  $("#pf-name").value = typed.name; $("#pf-title").value = typed.title; $("#pf-about").value = typed.about; $("#pf-backup").value = typed.backup;
  $("#pf-about").dispatchEvent(new Event("input"));
  const f = $("#pf-photo-remove") || $("#pf-file");
  if (f) f.focus();
}
/** Send the changed details, then show the new name and photo everywhere. */
async function saveProfile() {
  if (PF.busy) return;
  const err = $("#pf-error"), btn = $("#pf-save");
  err.hidden = true;
  const want = { name: $("#pf-name").value.replace(/\s+/g, " ").trim(), title: $("#pf-title").value.trim(), about: $("#pf-about").value.replace(/\s+/g, " ").trim(),
    backup: $("#pf-backup").value, photo: PF.photo === null ? user.photo || "" : PF.photo };
  if (want.name.length < 2) { err.textContent = "Enter your name."; err.hidden = false; $("#pf-name").focus(); return; }
  const changes = Object.fromEntries(Object.keys(want).filter((k) => want[k] !== (user[k] || "")).map((k) => [k, want[k]]));
  if (!Object.keys(changes).length) { profileSaid("Nothing to save. Your profile already says this."); return; }
  PF.busy = true; btn.disabled = true;
  try {
    const res = await DIRECTORY().updateProfile(user.id, changes);
    user = { ...user, ...res.user };
    if (serverAccounts()) ME = user;
    PF.photo = null;
    // The audit trail says what changed. It never holds the picture itself. With real accounts the server writes this.
    if (!serverAccounts() && Object.keys(res.changes).length) logEvent("user.profile_updated", user, { email: user.email, user_id: user.id, changes: res.changes });
    else if (serverAccounts()) await refreshLog();
    track("profile_saved", { fields: Object.keys(res.changes).length });
    paintMe(); render();
    profileSaid("Saved. Your profile is up to date.");
  } catch (e) {
    err.textContent = msgOf(e); err.hidden = false;
  } finally { PF.busy = false; const b = $("#pf-save"); if (b) b.disabled = false; }
}
/** Say something in the page's status line, where a screen reader announces it. */
function profileSaid(text) { PF.said = text; const el = $("#pf-saved"); if (el) { el.textContent = text; el.hidden = !text; } }

// ------------------------------------------------------------------ the photo
/** Turn a chosen picture into a small square JPEG, in the browser, so only about 20 KB is ever stored or sent. */
async function pickPhoto(file) {
  const err = $("#pf-error");
  err.hidden = true;
  if (!file) return;
  try {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Choose a PNG, JPEG or WebP picture.");
    if (file.size > 12 * 1024 * 1024) throw new Error("That picture is very large. Choose one under 12 MB.");
    const bmp = await createImageBitmap(file);
    const side = Math.min(bmp.width, bmp.height);
    if (side < 32) throw new Error("That picture is too small. Choose one at least 32 pixels wide.");
    const c = document.createElement("canvas");
    c.width = c.height = PHOTO_SIZE;
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);          // a see-through picture gets a white background
    g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    PF.photo = c.toDataURL("image/jpeg", 0.85);
    keepTyping();
    profileSaid("Photo ready. Choose Save profile to keep it.");
  } catch (e) {
    $("#pf-file").value = "";
    err.textContent = e && /Choose|picture/.test(e.message) ? e.message : "That picture could not be read. Try another one."; err.hidden = false;
  }
}

// ------------------------------------------------------------------ the password
/** The password card. Demo people and people who sign in with Microsoft or Google have no Penny password to change. */
function profilePassword(from) {
  const body = from ? `<p class="hint">You sign in with ${esc(from)}, so there is no Penny password. Change your password in your ${esc(from)} account.</p>`
    : !serverAccounts() ? `<p class="hint">Demo accounts sign in with a click, so there is no password to change here. With real accounts, this is where you choose a new one.</p>`
    : `<form id="pw-form" novalidate>
        <div class="field"><label for="pw-current">Current password</label><input id="pw-current" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="pw-new">New password</label><input id="pw-new" type="password" autocomplete="new-password" aria-describedby="pw-hint" required></div>
        <div class="field"><label for="pw-again">New password again</label><input id="pw-again" type="password" autocomplete="new-password" required></div>
        <p class="hint" id="pw-hint">At least 10 characters. A short phrase is easiest to remember. Your other signed-in devices are signed out.</p>
        <p class="form-error" id="pw-error" role="alert" hidden></p>
        <p class="look-saved" id="pw-saved" role="status"${PF.pwSaid ? "" : " hidden"}>${esc(PF.pwSaid)}</p>
        <div class="pf-actions"><button type="submit" class="btn" id="pw-save">Change password</button></div>
      </form>`;
  return `<section class="card" aria-labelledby="pf-pw-h"><div class="card-head"><h2 id="pf-pw-h">Password</h2></div><div class="card-body pf-pw">${body}</div></section>`;
}
/** Wire the password form: check it here for a quick answer, then let the server decide. */
function bindProfilePassword() {
  const form = $("#pw-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#pw-error"), ok = $("#pw-saved"), cur = $("#pw-current"), a = $("#pw-new"), b = $("#pw-again");
    err.hidden = true; ok.hidden = true; PF.pwSaid = "";
    const problem = !cur.value ? "Enter your current password." : DIRECTORY().passwordProblem(a.value, user.email, user.name) || (a.value !== b.value ? "The two new passwords do not match." : "");
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    $("#pw-save").disabled = true;
    try {
      await DIRECTORY().changePassword(cur.value, a.value);
      form.reset();
      PF.pwSaid = "Password changed. Your other devices were signed out.";
      ok.textContent = PF.pwSaid; ok.hidden = false;
      track("password_changed", {});
      await refreshLog();
    } catch (x) { err.textContent = msgOf(x); err.hidden = false; }
    finally { const s = $("#pw-save"); if (s) s.disabled = false; }
  });
}

// ------------------------------------------------------------------ my activity
/** The signed-in person's own numbers, from the audit trail. Private: nobody else sees them. */
function profileActivity() {
  const mine = EV.filter((e) => e.user && e.user.id === user.id && !e.type.startsWith("user.signed_in"));
  const counts = {};
  mine.forEach((e) => { const label = EVENT_LABEL[e.type] || e.type; counts[label] = (counts[label] || 0) + 1; });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6);
  const work = myWork(), waiting = work.holds.length + work.approvals.length;
  const last = mine.length ? mine[mine.length - 1].at : "";
  return `<section class="card" aria-labelledby="pf-act-h">
    <div class="card-head"><h2 id="pf-act-h">My activity</h2><p>Only you can see this</p></div>
    <div class="card-body">
      <dl class="pf-stats">
        <div><dt>Actions you have recorded</dt><dd id="pf-actions">${mine.length}</dd></div>
        <div><dt>Waiting on you now</dt><dd id="pf-waiting">${waiting ? `<a href="#/work">${waiting}</a>` : "0"}</dd></div>
        <div><dt>Your last action</dt><dd>${last ? esc(fmtDateTime(last)) : "None yet"}</dd></div>
      </dl>
      ${rows.length ? `<table class="mini pf-breakdown"><caption class="sr-only">Your actions by kind</caption><thead><tr><th scope="col">What you did</th><th scope="col" class="num">Times</th></tr></thead><tbody>${rows.map(([k, n]) =>
        `<tr><td>${esc(k)}</td><td class="num">${n}</td></tr>`).join("")}</tbody></table>` : `<p class="hint">Nothing yet. Resolve a hold or approve a bill and it shows here.</p>`}
      <p class="hint">These numbers come from the <a href="#/audit">audit trail</a>. Admins see usage by role, never by person.</p>
    </div></section>`;
}
