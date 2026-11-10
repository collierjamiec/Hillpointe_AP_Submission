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
   SameSite cookie, every write is checked server side, and the audit log is append-only in a database. */
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
    const acct = ACCOUNTS.find((a) => a.email === email);
    // Hash even when the email is unknown, so a wrong email takes as long as a wrong password.
    const typed = await pbkdf2(String(password || ""), acct ? acct.salt : "00000000000000000000000000000000");
    if (acct && sameText(typed, acct.hash)) {
      saveLock(email, { fails: 0, lockedUntil: 0, lockouts: 0 });
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
    return { id: a.id, name: a.name, email: a.email, role: a.role, title: a.title,
             initials: a.name.split(" ").map((w) => w[0]).join("").slice(0, 2) };
  }

  /** The signed-in user, or null. Ends the session when it has been idle too long. */
  function currentUser() {
    const s = ss.get(SESSION_KEY) || memorySession;
    if (!s) return null;
    if (Date.now() - s.lastActive > IDLE_MINUTES * 60000) {
      signOut("expired");
      return null;
    }
    const acct = ACCOUNTS.find((a) => a.id === s.userId);
    return acct ? publicUser(acct) : null;
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

  window.PennyAuth = {
    accounts: ACCOUNTS.map((a) => ({ ...publicUser(a), demoPassword: DEMO_PASSWORDS[a.id] })),
    signIn, signOut, currentUser, touch, takeSignOutReason, IDLE_MINUTES, MAX_TRIES,
  };
})();
