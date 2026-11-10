"""User accounts for Penny on a computer. (Added after submission, v1.7.)

Turned on when state/users.json has at least one user. Create the first Admin from the terminal:
  ./penny users invite --email you@company.com --name "Your Name" --role admin
Without that file, ./penny web keeps the four public demo accounts (browser-only), exactly as before.

What is stored, and how
  state/users.json    each person: id, email, name, title, role, status (invited, active, inactive), who created and
                      changed them, appearance preferences, and a password as a random salt plus a PBKDF2-SHA256 hash
                      (200,000 rounds). Never the password itself.
  state/tokens.json   invite and reset links, stored only as SHA-256 hashes of the token, each with its purpose, user,
                      expiry (invite 72 hours, reset 1 hour) and whether it was used. A link works once.
  Sessions            a random token in an HttpOnly, SameSite=Strict cookie. The server keeps only its hash, in memory,
                      and ends it after 30 idle minutes, on sign out, or when the person is turned off or their role
                      changes. Restarting the server signs everyone out.

Rules that protect the team
  * Passwords: at least 10 characters, not the email or name, not a common password.
  * Five wrong passwords lock that email for a minute, doubling each time. Errors never say whether an email exists.
  * Only an Admin manages people. Nobody can turn off or demote themselves, and the last active Admin stays an Admin.
  * Every change is appended to state/batch_log.jsonl and shown in the audit trail.
"""
import hashlib
import hmac
import json
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

ROLES = ("viewer", "clerk", "approver", "admin")
ROLE_NAMES = {"viewer": "Viewer", "clerk": "AP Clerk", "approver": "Approver", "admin": "Admin"}
ITERATIONS = 200_000
INVITE_HOURS, RESET_HOURS = 72, 1
IDLE_SECONDS = 30 * 60
MAX_TRIES = 5
MAX_TRACKED = 2000          # emails remembered for lockouts; beyond this the oldest are forgotten, so memory stays bounded
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$")
COMMON = {"password", "password1", "password123", "1234567890", "qwertyuiop", "letmein123", "welcome123", "penny12345",
          "iloveyou12", "administrator", "changeme123", "123456789a", "qwerty12345"}


class AccountError(Exception):
    """A request Penny refuses, with a reason a person can act on, and the HTTP status to send."""

    def __init__(self, message, status=400):
        """Keep the message and the HTTP status to answer with."""
        super().__init__(message)
        self.status = status


def now_iso():
    """The current time in UTC, as text."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def hash_password(password, salt=None):
    """Hash a password with PBKDF2-SHA256 and a random salt. Only the salt and hash are ever stored."""
    salt = salt or secrets.token_hex(16)
    return {"salt": salt, "hash": hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), ITERATIONS).hex(), "iterations": ITERATIONS}


def password_problem(password, email="", name=""):
    """Why a password is not acceptable, in plain words, or '' when it is fine."""
    p = str(password or "")
    if len(p) < 10:
        return "Use at least 10 characters. A short phrase is easiest to remember."
    if len(p) > 200:
        return "That password is too long."
    low = p.lower()
    if low in COMMON or len(set(low)) < 4:
        return "That password is too easy to guess. Try a short phrase of a few words."
    local = str(email).split("@")[0].lower()
    if (local and len(local) >= 4 and local in low) or any(w and len(w) >= 4 and w.lower() in low for w in str(name).split()):
        return "Do not use your email or name in the password."
    return ""


def clean_email(v):
    """A trimmed, lowercase email address, or an AccountError when it is not one."""
    e = str(v or "").strip().lower()
    if not EMAIL_RE.match(e):
        raise AccountError("Enter a valid email address, like name@company.com.")
    return e


class Accounts:
    def __init__(self, state_dir, log=None, clock=time.time):
        """Accounts stored under state_dir. `log` receives audit events; `clock` can be replaced in tests."""
        self.dir = Path(state_dir)
        self.users_path = self.dir / "users.json"
        self.tokens_path = self.dir / "tokens.json"
        self.log = log or (lambda event: event)
        self.clock = clock
        self.lock = threading.RLock()
        self.sessions = {}          # sha256(token) -> {"user": id, "seen": time}
        self.tries = {}             # email -> {"fails", "until", "lockouts"}
        self._cache = (None, [])    # (file stamp, users) so users.json is parsed once per change

    # ------------------------------------------------------------------ storage
    def enabled(self):
        """True once at least one person exists. Until then the web app uses the public demo accounts."""
        return bool(self._users())

    def _users(self):
        """Everyone, read from users.json. The parsed file is reused until the file changes on disk, because every
        request looks up the signed-in person. Callers get their own copy and may change it before saving."""
        try:
            st = self.users_path.stat()
            key = (st.st_mtime_ns, st.st_size)
            if self._cache[0] != key:
                self._cache = (key, json.loads(self.users_path.read_text(encoding="utf-8")).get("users", []))
            return json.loads(json.dumps(self._cache[1]))
        except (OSError, ValueError):
            return []

    def _save_users(self, users):
        """Write users.json through a temp file, so a crash can never leave it half written."""
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.users_path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"users": users}, indent=2), encoding="utf-8")
        tmp.replace(self.users_path)
        self._cache = (None, [])    # never trust the stamp alone right after our own write

    def _tokens(self):
        """Every invitation and reset link on file, keyed by the SHA-256 of its token."""
        try:
            return json.loads(self.tokens_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _save_tokens(self, tokens):
        """Write tokens.json, dropping links that expired more than a week ago."""
        self.dir.mkdir(parents=True, exist_ok=True)
        now = self.clock()
        keep = {k: v for k, v in tokens.items() if v["expires"] > now - 7 * 86400}   # forget old links after a week
        tmp = self.tokens_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(keep, indent=2), encoding="utf-8")
        tmp.replace(self.tokens_path)

    @staticmethod
    def public(u):
        """What the web app may see about a person. Never the password hash."""
        return {k: u.get(k) for k in ("id", "email", "name", "title", "role", "status", "created_at", "created_by", "updated_at", "last_sign_in", "prefs")} | {
            "initials": "".join(w[0] for w in u["name"].split()[:2]).upper(), "has_password": bool(u.get("password"))}

    def get(self, user_id):
        """One person's full record by id (including the password hash), or None."""
        return next((u for u in self._users() if u["id"] == user_id), None)

    def list(self):
        """Everyone, as the web app may see them: active and invited people first, by name."""
        return [self.public(u) for u in sorted(self._users(), key=lambda u: (u["status"] == "inactive", u["name"].lower()))]

    # ------------------------------------------------------------------ links
    def _issue(self, user_id, purpose):
        """Create a one-time link for an invitation or reset. Any older unused link of the same kind stops working."""
        token = secrets.token_urlsafe(32)
        hours = INVITE_HOURS if purpose == "invite" else RESET_HOURS
        with self.lock:
            tokens = self._tokens()
            for v in tokens.values():                     # a new link replaces older unused ones of the same kind
                if v["user"] == user_id and v["purpose"] == purpose and not v.get("used"):
                    v["used"] = "replaced"
            tokens[hashlib.sha256(token.encode()).hexdigest()] = {"user": user_id, "purpose": purpose, "expires": self.clock() + hours * 3600, "used": False}
            self._save_tokens(tokens)
        return token, hours

    def check_token(self, token):
        """The link record and its person, or an AccountError when the link is used, expired or the account is off."""
        t = self._tokens().get(hashlib.sha256(str(token or "").encode()).hexdigest())
        if not t or t.get("used") or t["expires"] < self.clock():
            raise AccountError("This link has expired or was already used. Ask an Admin to send a new one.", 410)
        u = self.get(t["user"])
        if not u or u["status"] == "inactive":
            raise AccountError("This account is turned off. Ask an Admin.", 403)
        return t, u

    def use_token(self, token, password, name=None):
        """Set a password through an invitation or reset link, mark the link used, and sign the person out everywhere."""
        with self.lock:
            t, u = self.check_token(token)
            problem = password_problem(password, u["email"], name or u["name"])
            if problem:
                raise AccountError(problem)
            users = self._users()
            me = next(x for x in users if x["id"] == u["id"])
            me["password"] = hash_password(password)
            if name and t["purpose"] == "invite":
                me["name"] = re.sub(r"\s+", " ", str(name)).strip()[:80] or me["name"]
            if me["status"] == "invited":
                me["status"] = "active"
            me["updated_at"] = now_iso()
            self._save_users(users)
            tokens = self._tokens()
            tokens[hashlib.sha256(token.encode()).hexdigest()]["used"] = now_iso()
            self._save_tokens(tokens)
            self.end_sessions(me["id"])
        self.log({"event": "user.activated" if t["purpose"] == "invite" else "user.password_reset", "by": self._who(me), "user_id": me["id"], "email": me["email"]})
        return self.public(me)

    # ------------------------------------------------------------------ admin actions
    def _who(self, u):
        """Who did something, in the shape the audit log uses."""
        return {"id": u["id"], "name": u["name"], "role": u["role"]}

    def _admin(self, actor):
        """Refuse unless the person acting is an Admin."""
        if not actor or actor.get("role") != "admin":
            raise AccountError("Only an Admin can manage people.", 403)

    def invite(self, actor, email, name, role, title="", bootstrap=False):
        """Add a person as Invited and return (person, link token, hours valid). `bootstrap` lets the terminal create
        the first Admin when nobody can sign in yet."""
        if not bootstrap:
            self._admin(actor)
        email = clean_email(email)
        name = re.sub(r"\s+", " ", str(name or "")).strip()[:80]
        if len(name) < 2:
            raise AccountError("Enter the person's name.")
        if role not in ROLES:
            raise AccountError("Choose a role: Viewer, AP Clerk, Approver or Admin.")
        with self.lock:
            users = self._users()
            if any(u["email"] == email for u in users):
                raise AccountError(f"{email} already has an account. Open it to resend the invitation or reset the password.", 409)
            base = re.sub(r"[^a-z0-9]+", "-", email.split("@")[0]).strip("-")[:20] or "user"
            uid, n = base, 2
            while any(u["id"] == uid for u in users):
                uid, n = f"{base}-{n}", n + 1
            by = self._who(actor) if actor else {"id": "terminal", "name": "Terminal", "role": "admin"}
            user = {"id": uid, "email": email, "name": name, "title": str(title or "").strip()[:80], "role": role, "status": "invited",
                    "created_at": now_iso(), "created_by": by, "updated_at": now_iso(), "password": None, "prefs": {}}
            users.append(user)
            self._save_users(users)
        token, hours = self._issue(uid, "invite")
        self.log({"event": "user.invited", "by": by, "user_id": uid, "email": email, "role": role})
        return self.public(user), token, hours

    def resend(self, actor, user_id):
        """A fresh invitation link for someone who has not set up their account yet."""
        self._admin(actor)
        u = self.get(user_id)
        if not u:
            raise AccountError("That person is not in Penny.", 404)
        if u["status"] != "invited":
            raise AccountError("They have already set up their account. Send a password reset instead.", 409)
        token, hours = self._issue(user_id, "invite")
        self.log({"event": "user.invite_resent", "by": self._who(actor), "user_id": user_id, "email": u["email"]})
        return self.public(u), token, hours

    def send_reset(self, actor, user_id):
        """A password reset link for an active person, sent by an Admin."""
        self._admin(actor)
        u = self.get(user_id)
        if not u:
            raise AccountError("That person is not in Penny.", 404)
        if u["status"] != "active":
            raise AccountError("Only an active account can get a password reset. Resend the invitation or turn the account on first.", 409)
        token, hours = self._issue(user_id, "reset")
        self.log({"event": "user.reset_sent", "by": self._who(actor), "user_id": user_id, "email": u["email"]})
        return self.public(u), token, hours

    def forgot(self, email):
        """A person asks for their own reset. Returns (user, token) only for an active account; the web app shows the
        same message either way, so it never reveals who has an account."""
        try:
            email = clean_email(email)
        except AccountError:
            return None, None, 0
        u = next((x for x in self._users() if x["email"] == email and x["status"] == "active"), None)
        if not u:
            return None, None, 0
        token, hours = self._issue(u["id"], "reset")
        self.log({"event": "user.reset_requested", "by": self._who(u), "user_id": u["id"], "email": email})
        return self.public(u), token, hours

    def update(self, actor, user_id, changes):
        """Change a person's name, title, email, role or status. Guards: not your own role or status, and always
        one active Admin. A role, status or email change ends that person's sessions at once."""
        self._admin(actor)
        with self.lock:
            users = self._users()
            u = next((x for x in users if x["id"] == user_id), None)
            if not u:
                raise AccountError("That person is not in Penny.", 404)
            before = {k: u.get(k) for k in ("name", "title", "role", "status", "email")}
            if "name" in changes:
                name = re.sub(r"\s+", " ", str(changes["name"] or "")).strip()[:80]
                if len(name) < 2:
                    raise AccountError("Enter the person's name.")
                u["name"] = name
            if "title" in changes:
                u["title"] = str(changes["title"] or "").strip()[:80]
            if "email" in changes:
                e = clean_email(changes["email"])
                if any(x["email"] == e and x["id"] != user_id for x in users):
                    raise AccountError(f"{e} already belongs to someone else.", 409)
                u["email"] = e
            if "role" in changes:
                if changes["role"] not in ROLES:
                    raise AccountError("Choose a role: Viewer, AP Clerk, Approver or Admin.")
                if user_id == actor["id"] and changes["role"] != "admin":
                    raise AccountError("You cannot remove your own Admin role. Ask another Admin.", 409)
                u["role"] = changes["role"]
            if "status" in changes:
                st = changes["status"]
                if st not in ("active", "inactive"):
                    raise AccountError("Status must be active or inactive.")
                if user_id == actor["id"] and st == "inactive":
                    raise AccountError("You cannot turn off your own account. Ask another Admin.", 409)
                if st == "active" and not u.get("password"):
                    st = "invited"                      # turned back on, but they never set a password
                u["status"] = st
            admins = [x for x in users if x["role"] == "admin" and x["status"] == "active"]
            if not admins:
                raise AccountError("Penny needs at least one active Admin, so this change was not saved.", 409)
            after = {k: u.get(k) for k in ("name", "title", "role", "status", "email")}
            diff = {k: [before[k], after[k]] for k in after if before[k] != after[k]}
            if not diff:
                return self.public(u), {}
            u["updated_at"] = now_iso()
            self._save_users(users)
        if "role" in diff or "status" in diff or "email" in diff:
            self.end_sessions(user_id)                 # new permissions take effect at once
        self.log({"event": "user.updated", "by": self._who(actor), "user_id": user_id, "email": u["email"], "changes": diff})
        return self.public(u), diff

    def set_prefs(self, actor, prefs):
        """Save the signed-in person's own appearance settings."""
        if not isinstance(prefs, dict) or len(json.dumps(prefs)) > 4000:
            raise AccountError("Those settings could not be saved.")
        with self.lock:
            users = self._users()
            u = next(x for x in users if x["id"] == actor["id"])
            u["prefs"] = prefs
            self._save_users(users)
        return prefs

    # ------------------------------------------------------------------ sign in and sessions
    def sign_in(self, email, password):
        """Check an email and password and start a session. Five wrong tries lock that email for a minute, doubling
        each time; the message is the same whether or not the email exists. Returns (session token, person)."""
        e = str(email or "").strip().lower()
        now = self.clock()
        st = self.tries.get(e, {"fails": 0, "until": 0, "lockouts": 0})
        if st["until"] > now:
            raise AccountError(f"Too many wrong tries. Try again in {int(st['until'] - now) + 1} seconds.", 429)
        u = next((x for x in self._users() if x["email"] == e), None)
        pw = (u or {}).get("password") or {"salt": "00" * 16, "hash": "", "iterations": ITERATIONS}
        typed = hashlib.pbkdf2_hmac("sha256", str(password or "").encode(), bytes.fromhex(pw["salt"]), pw.get("iterations", ITERATIONS)).hex()
        if not u or not pw["hash"] or not hmac.compare_digest(typed, pw["hash"]):
            st["fails"] += 1
            if st["fails"] >= MAX_TRIES:
                st["lockouts"] += 1
                st["until"] = now + 60 * 2 ** (st["lockouts"] - 1)
                st["fails"] = 0
            self.tries[e] = st
            if len(self.tries) > MAX_TRACKED:           # typed emails are untrusted input: never let them grow without limit
                for old in sorted(self.tries, key=lambda k: self.tries[k]["until"])[:len(self.tries) - MAX_TRACKED]:
                    self.tries.pop(old, None)
            left = MAX_TRIES - st["fails"]
            raise AccountError("That email and password do not match." + (f" {left} {'try' if left == 1 else 'tries'} left before a short lock." if st["until"] <= now else " Too many wrong tries: wait a minute."), 401)
        self.tries.pop(e, None)
        if u["status"] == "inactive":
            raise AccountError("This account is turned off. Ask an Admin to turn it back on.", 403)
        token = secrets.token_urlsafe(32)
        with self.lock:
            self.sessions[hashlib.sha256(token.encode()).hexdigest()] = {"user": u["id"], "seen": now}
            users = self._users()
            me = next(x for x in users if x["id"] == u["id"])
            me["last_sign_in"] = now_iso()
            self._save_users(users)
        self.log({"event": "user.signed_in", "by": self._who(u), "user_id": u["id"]})
        return token, self.public(me)

    def session_user(self, token):
        """The person a session token belongs to, or None when it is unknown, idle too long, or they were turned off."""
        if not token:
            return None
        key = hashlib.sha256(token.encode()).hexdigest()
        s = self.sessions.get(key)
        now = self.clock()
        if not s or now - s["seen"] > IDLE_SECONDS:
            self.sessions.pop(key, None)
            return None
        u = self.get(s["user"])
        if not u or u["status"] != "active":
            self.sessions.pop(key, None)
            return None
        s["seen"] = now
        return self.public(u)

    def sign_out(self, token):
        """End one session."""
        if token:
            self.sessions.pop(hashlib.sha256(token.encode()).hexdigest(), None)

    def end_sessions(self, user_id):
        """End every session a person has (after a password, role, status or email change)."""
        for k in [k for k, v in self.sessions.items() if v["user"] == user_id]:
            self.sessions.pop(k, None)
