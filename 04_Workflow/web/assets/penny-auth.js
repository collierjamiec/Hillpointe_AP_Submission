/* Penny demo sign-in.

   IMPORTANT: this is a DEMO, not security. The site is static (GitHub Pages), so everything here runs in the visitor's
   browser and anyone can read it. The accounts are fake and their passwords are printed on the login screen on
   purpose. What this file does show is the right pattern, so the move to a real server is a swap, not a redesign:

   * Passwords are never stored or compared as plain text. Each account keeps a random salt and a PBKDF2-SHA256 hash
     (150,000 rounds). A login hashes what was typed with the same salt and compares the results in constant time.
   * Five wrong passwords lock that account for one minute, doubling each time it happens again.
   * A session lives in sessionStorage (gone when the tab closes), carries a random token, and ends after 30 minutes
     with no activity.
   * Every action checks the signed-in role again before it runs. A real server would do these same checks on its side,
     because anything in a browser can be changed by the person using it.

   In production: hashing (Argon2id or PBKDF2) and lockouts move to the server, the session becomes an HttpOnly, Secure,
   SameSite cookie, every write is checked server side, and the audit log is append-only in a database. Penny on a
   computer does exactly that once it has real accounts (ap_workflow/accounts.py, added in v1.7).

   The demo directory (added in v1.7): an Admin can invite people, change roles and details, turn accounts off and on,
   and send password resets, all inside this browser. Invitations and resets land in the demo Outbox with a link that
   works once and expires. The four public accounts keep their published passwords so every visitor can try them. */
(() => {
  "use strict";

  const ITERATIONS = 150000;
  const IDLE_MINUTES = 30;
  const MAX_TRIES = 5;

  // Public account details. Hashes were made with: hashlib.pbkdf2_hmac("sha256", password, salt, 150000)
  const ACCOUNTS = [
    { id: "riley", name: "Riley Brooks", email: "riley@penny.demo", role: "viewer", title: "Internal auditor",
      salt: "de9b11a0394e8c0a00da771c31a7a532", hash: "e7adab9f366b9b7362632c1b3ddef27cc3c9e892100b07a5f7c87d7f5237e7b8" },
    { id: "avery", name: "Avery Chen", email: "avery@penny.demo", role: "clerk", title: "AP specialist",
      salt: "c6f8c564c39d20f2d5107d2b27761bc1", hash: "bf020bdd597d710a223fa14e2986dfdc1ead9b19ea2f8e5897f234fb4cbc552e" },
    { id: "jordan", name: "Jordan Patel", email: "jordan@penny.demo", role: "approver", title: "Project manager",
      salt: "af409b6d94073de39faa1836f92dfe70", hash: "28f595c0ed483c373cc8bdb9afafd61a680d6c6cc8be3b22d3904568c13e0eca" },
    { id: "sam", name: "Sam Rivera", email: "sam@penny.demo", role: "admin", title: "AP manager",
      salt: "32dcc3e15b7e52735e90f348b46895ce", hash: "081ad08c20e8776b08d97046db09cb76db640e9f01b3cf3c4400a26f4352cf2b" },
  ];
  // Shown on the login screen so visitors can try every role. Never used to check a password.
  const DEMO_PASSWORDS = { riley: "penny-viewer", avery: "penny-clerk", jordan: "penny-approver", sam: "penny-admin" };

  const SESSION_KEY = "penny.session";
  const DIR_KEY = "penny.users.v1";
  const INVITE_HOURS = 72, RESET_HOURS = 1;
  const ROLES = ["viewer", "clerk", "approver", "admin"];
  const COMMON = new Set(["password", "password1", "password123", "1234567890", "qwertyuiop", "letmein123", "welcome123", "penny12345", "iloveyou12", "administrator", "changeme123"]);
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* nothing */ } },
  };
  let memoryDir = null;
  function dir() { return ls.get(DIR_KEY) || memoryDir || { extra: [], overrides: {}, tokens: {} }; }
  function saveDir(d) { memoryDir = d; ls.set(DIR_KEY, d); }
  /** Every account: the four public ones (with any Admin changes) plus people invited in this browser. */
  function all() {
    const d = dir();
    return [...ACCOUNTS.map((a) => ({ status: "active", builtIn: true, ...a, ...(d.overrides[a.id] || {}) })), ...d.extra];
  }
  const TRIES_KEY = "penny.tries";

  const ss = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked: session lasts for this page only */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* nothing to remove */ } },
  };
  let memorySession = null;   // used when sessionStorage is blocked

  const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const unhex = (h) => new Uint8Array(h.match(/../g).map((b) => parseInt(b, 16)));

  async function pbkdf2(password, saltHex) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations: ITERATIONS }, key, 256);
    return hex(bits);
  }
  function sameText(a, b) {          // constant-time compare, so timing does not reveal how much matched
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }
  function token() {
    const b = new Uint8Array(24);
    crypto.getRandomValues(b);
    return hex(b);
  }

  function lockState(email) {
    const all = ss.get(TRIES_KEY) || {};
    return all[email] || { fails: 0, lockedUntil: 0, lockouts: 0 };
  }
  function saveLock(email, st) {
    const all = ss.get(TRIES_KEY) || {};
    all[email] = st;
    ss.set(TRIES_KEY, all);
  }

  /** Resolves to { ok: true, user } or { ok: false, message }. The message never says whether the email exists. */
  async function signIn(emailRaw, password) {
    const email = String(emailRaw || "").trim().toLowerCase();
    if (!window.crypto || !crypto.subtle) {
      return { ok: false, message: "This browser cannot check passwords securely here. Open the site over https or on localhost." };
    }
    const st = lockState(email);
    const now = Date.now();
    if (st.lockedUntil > now) {
      const secs = Math.ceil((st.lockedUntil - now) / 1000);
      return { ok: false, locked: true, message: `Too many wrong tries. This account is locked for ${secs} more second${secs === 1 ? "" : "s"}.` };
    }
    const acct = all().find((a) => a.email === email && a.hash);
    // Hash even when the email is unknown, so a wrong email takes as long as a wrong password.
    const typed = await pbkdf2(String(password || ""), acct ? acct.salt : "00000000000000000000000000000000");
    if (acct && sameText(typed, acct.hash)) {
      saveLock(email, { fails: 0, lockedUntil: 0, lockouts: 0 });
      if (acct.status === "inactive") return { ok: false, message: "This account is turned off. Ask an Admin to turn it back on." };
      const session = { userId: acct.id, token: token(), issuedAt: now, lastActive: now };
      memorySession = session;
      ss.set(SESSION_KEY, session);
      return { ok: true, user: publicUser(acct) };
    }
    st.fails += 1;
    if (st.fails >= MAX_TRIES) {
      st.lockouts += 1;
      st.lockedUntil = now + 60000 * Math.pow(2, st.lockouts - 1);
      st.fails = 0;
      saveLock(email, st);
      return { ok: false, locked: true, message: `Too many wrong tries. This account is locked for ${Math.round((st.lockedUntil - now) / 60000)} minute${st.lockouts > 1 ? "s" : ""}.` };
    }
    saveLock(email, st);
    const left = MAX_TRIES - st.fails;
    return { ok: false, message: `That email and password do not match. ${left} ${left === 1 ? "try" : "tries"} left before a short lock.` };
  }

  function publicUser(a) {
    return { id: a.id, name: a.name, email: a.email, role: a.role, title: a.title || "", status: a.status || "active", builtIn: !!a.builtIn,
             created_at: a.created_at || "", created_by: a.created_by || null, updated_at: a.updated_at || "", last_sign_in: a.last_sign_in || "",
             has_password: !!a.hash, prefs: (dir().prefs || {})[a.id] || {},
             about: a.about || "", backup: a.backup || "", photo: a.photo || "", source: a.source || "penny", imported: a.imported || [],   // (v2.3) the profile
             initials: a.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() };
  }

  /** The signed-in user, or null. Ends the session when it has been idle too long. */
  function currentUser() {
    const s = ss.get(SESSION_KEY) || memorySession;
    if (!s) return null;
    if (Date.now() - s.lastActive > IDLE_MINUTES * 60000) {
      signOut("expired");
      return null;
    }
    const acct = all().find((a) => a.id === s.userId);
    if (!acct || acct.status !== "active") { signOut("expired"); return null; }
    return publicUser(acct);
  }
  function touch() {
    const s = ss.get(SESSION_KEY) || memorySession;
    if (!s) return;
    s.lastActive = Date.now();
    memorySession = s;
    ss.set(SESSION_KEY, s);
  }
  let lastReason = "";
  function signOut(reason) {
    lastReason = reason || "";
    memorySession = null;
    ss.del(SESSION_KEY);
  }
  function takeSignOutReason() { const r = lastReason; lastReason = ""; return r; }

  // ------------------------------------------------------------------ the demo directory (v1.7)
  const err = (message) => { const e = new Error(message); e.userMessage = message; throw e; };
  const nowIso = () => new Date().toISOString();
  const sha = async (text) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const cleanEmail = (v) => { const e = String(v || "").trim().toLowerCase(); if (!/^[^@\s]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/.test(e)) err("Enter a valid email address, like name@company.com."); return e; };
  const who = (u) => ({ id: u.id, name: u.name, role: u.role });
  function needAdmin(actor) { if (!actor || actor.role !== "admin") err("Only an Admin can manage people."); }
  function passwordProblem(p, email, name) {
    p = String(p || "");
    if (p.length < 10) return "Use at least 10 characters. A short phrase is easiest to remember.";
    const low = p.toLowerCase();
    if (COMMON.has(low) || new Set(low).size < 4) return "That password is too easy to guess. Try a short phrase of a few words.";
    const local = String(email || "").split("@")[0].toLowerCase();
    if ((local.length >= 4 && low.includes(local)) || String(name || "").split(/\s+/).some((w) => w.length >= 4 && low.includes(w.toLowerCase()))) return "Do not use your email or name in the password.";
    return "";
  }
  /** Change one account: built-in accounts keep their changes as overrides; invited people are edited in place. */
  function patch(d, id, fields) {
    const extra = d.extra.find((u) => u.id === id);
    if (extra) Object.assign(extra, fields);
    else d.overrides[id] = { ...(d.overrides[id] || {}), ...fields };
  }
  async function issue(d, id, purpose) {
    const t = token();
    Object.values(d.tokens).forEach((v) => { if (v.user === id && v.purpose === purpose && !v.used) v.used = "replaced"; });
    d.tokens[await sha(t)] = { user: id, purpose, expires: Date.now() + (purpose === "invite" ? INVITE_HOURS : RESET_HOURS) * 3600000, used: false };
    return { token: t, hours: purpose === "invite" ? INVITE_HOURS : RESET_HOURS };
  }
  const directory = {
    list() { return all().map(publicUser).sort((a, b) => (a.status === "inactive") - (b.status === "inactive") || a.name.localeCompare(b.name)); },
    passwordProblem,
    async invite(actor, f) {
      needAdmin(actor);
      const email = cleanEmail(f.email);
      const name = String(f.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (name.length < 2) err("Enter the person's name.");
      if (!ROLES.includes(f.role)) err("Choose a role.");
      if (all().some((u) => u.email === email)) err(`${email} already has an account. Open it to resend the invitation or reset the password.`);
      const d = dir();
      const base = email.split("@")[0].replace(/[^a-z0-9]+/g, "-").slice(0, 20) || "user";
      let id = base, n = 2;
      while (all().some((u) => u.id === id)) id = `${base}-${n++}`;
      const user = { id, email, name, title: String(f.title || "").trim().slice(0, 80), role: f.role, status: "invited", created_at: nowIso(), created_by: who(actor), updated_at: nowIso(), salt: "", hash: "" };
      d.extra.push(user);
      const link = await issue(d, id, "invite");
      saveDir(d);
      return { user: publicUser(user), ...link };
    },
    async resend(actor, id) {
      needAdmin(actor);
      const u = all().find((x) => x.id === id) || err("That person is not in Penny.");
      if (u.status !== "invited") err("They have already set up their account. Send a password reset instead.");
      const d = dir(); const link = await issue(d, id, "invite"); saveDir(d);
      return { user: publicUser(u), ...link };
    },
    async sendReset(actor, id) {
      needAdmin(actor);
      const u = all().find((x) => x.id === id) || err("That person is not in Penny.");
      if (u.builtIn) err("The four demo accounts keep their published passwords so every visitor can try them. Invite someone to try a reset.");
      if (u.status !== "active") err("Only an active account can get a password reset.");
      const d = dir(); const link = await issue(d, id, "reset"); saveDir(d);
      return { user: publicUser(u), ...link };
    },
    async forgot(email) {
      let e; try { e = cleanEmail(email); } catch (x) { return null; }
      const u = all().find((x) => x.email === e && x.status === "active" && !x.builtIn);
      if (!u) return null;
      const d = dir(); const link = await issue(d, u.id, "reset"); saveDir(d);
      return { user: publicUser(u), ...link };
    },
    update(actor, id, changes) {
      needAdmin(actor);
      const d = dir();
      const u = all().find((x) => x.id === id) || err("That person is not in Penny.");
      const before = { name: u.name, title: u.title || "", role: u.role, status: u.status, email: u.email };
      const after = { ...before };
      if ("name" in changes) { after.name = String(changes.name || "").replace(/\s+/g, " ").trim().slice(0, 80); if (after.name.length < 2) err("Enter the person's name."); }
      if ("title" in changes) after.title = String(changes.title || "").trim().slice(0, 80);
      if ("email" in changes) {
        after.email = cleanEmail(changes.email);
        if (u.builtIn && after.email !== before.email) err("The demo accounts keep their published emails.");
        if (all().some((x) => x.email === after.email && x.id !== id)) err(`${after.email} already belongs to someone else.`);
      }
      if ("role" in changes) {
        if (!ROLES.includes(changes.role)) err("Choose a role.");
        if (id === actor.id && changes.role !== "admin") err("You cannot remove your own Admin role. Ask another Admin.");
        after.role = changes.role;
      }
      if ("status" in changes) {
        if (!["active", "inactive"].includes(changes.status)) err("Status must be active or inactive.");
        if (id === actor.id && changes.status === "inactive") err("You cannot turn off your own account. Ask another Admin.");
        after.status = changes.status === "active" && !u.hash ? "invited" : changes.status;
      }
      const admins = all().map((x) => (x.id === id ? { ...x, ...after } : x)).filter((x) => x.role === "admin" && x.status === "active");
      if (!admins.length) err("Penny needs at least one active Admin, so this change was not saved.");
      const diff = Object.fromEntries(Object.keys(after).filter((k) => after[k] !== before[k]).map((k) => [k, [before[k], after[k]]]));
      if (Object.keys(diff).length) { patch(d, id, { ...after, updated_at: nowIso() }); saveDir(d); }
      return { user: publicUser({ ...u, ...after }), changes: diff };
    },
    async checkToken(t) {
      const rec = dir().tokens[await sha(String(t || ""))];
      if (!rec || rec.used || rec.expires < Date.now()) err("This link has expired or was already used. Ask an Admin to send a new one.");
      const u = all().find((x) => x.id === rec.user);
      if (!u || u.status === "inactive") err("This account is turned off. Ask an Admin.");
      return { purpose: rec.purpose, email: u.email, name: u.name, role: u.role };
    },
    async useToken(t, password, name) {
      const info = await directory.checkToken(t);
      const d = dir();
      const u = all().find((x) => x.email === info.email);
      const problem = passwordProblem(password, u.email, name || u.name);
      if (problem) err(problem);
      const salt = token().slice(0, 32);
      const fields = { salt, hash: await pbkdf2(password, salt), updated_at: nowIso() };
      if (info.purpose === "invite") { fields.status = "active"; if (name && name.trim().length >= 2) fields.name = name.replace(/\s+/g, " ").trim().slice(0, 80); }
      patch(d, u.id, fields);
      d.tokens[await sha(t)].used = nowIso();
      saveDir(d);
      return publicUser({ ...u, ...fields });
    },
    /** (v2.3) A person changes their own name, title, about line, backup person or photo. Never the email or id. */
    updateProfile(id, changes) {
      const d = dir();
      const u = all().find((x) => x.id === id) || err("Please sign in again.");
      const before = { name: u.name, title: u.title || "", about: u.about || "", backup: u.backup || "", photo: u.photo || "" };
      const after = { ...before };
      const line = (v, max) => String(v || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
      if ("name" in changes) { after.name = line(changes.name, 80); if (after.name.length < 2) err("Enter your name."); }
      if ("title" in changes) after.title = line(changes.title, 80);
      if ("about" in changes) after.about = line(changes.about, 280);
      if ("photo" in changes) {
        after.photo = String(changes.photo || "");
        if (after.photo && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(after.photo) || after.photo.length > 90000)) err("That photo could not be used. Choose a PNG, JPEG or WebP picture.");
      }
      if ("backup" in changes) {
        after.backup = String(changes.backup || "");
        if (after.backup && (after.backup === id || !all().some((x) => x.id === after.backup && (x.status || "active") === "active"))) err("Choose a backup person who has an active account, other than yourself.");
      }
      const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
      const diff = Object.fromEntries(changed.map((k) => [k, k === "photo" ? [before.photo ? "a photo" : "none", after.photo ? "a new photo" : "none"] : [before[k], after[k]]]));
      if (changed.length) {
        patch(d, id, { ...Object.fromEntries(changed.map((k) => [k, after[k]])), updated_at: nowIso() });
        saveDir(d);
        if (!ls.get(DIR_KEY) || JSON.stringify(ls.get(DIR_KEY)) !== JSON.stringify(d)) err("This browser could not save that. Its storage may be full or turned off.");
      }
      return { user: publicUser({ ...u, ...after }), changes: diff };
    },
    setPrefs(id, prefs) { const d = dir(); d.prefs = { ...(d.prefs || {}), [id]: prefs }; saveDir(d); return prefs; },
    reset() { memoryDir = null; ls.del(DIR_KEY); },
  };

  window.PennyAuth = {
    get accounts() { return ACCOUNTS.map((a) => ({ ...publicUser({ status: "active", builtIn: true, ...a, ...(dir().overrides[a.id] || {}) }), demoPassword: DEMO_PASSWORDS[a.id] })); },
    signIn, signOut, currentUser, touch, takeSignOutReason, IDLE_MINUTES, MAX_TRIES, directory,
  };
})();
