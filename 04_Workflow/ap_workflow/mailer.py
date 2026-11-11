"""Email from Penny on a computer. (Added after submission, v1.7.)

Sending is set up with environment variables, so a password never sits in a file in the project:
  PENNY_SMTP_HOST       for example smtp.gmail.com or smtp.office365.com
  PENNY_SMTP_PORT       587 (STARTTLS, the default) or 465 (SSL)
  PENNY_SMTP_USER       the mail account
  PENNY_SMTP_PASSWORD   an app password for that account
  PENNY_SMTP_FROM       the From address (defaults to PENNY_SMTP_USER)
  PENNY_PUBLIC_URL      optional: the address people open Penny at, for links in emails

Without PENNY_SMTP_HOST, nothing is sent: each email is saved in state/outbox/ instead, marked "Saved, not sent", so
an Admin can see it and pass an invitation link on by hand. Every email, sent or not, is listed in
state/outbox/outbox.jsonl with who sent it, to whom, when, its attachments (name, size, SHA-256) and the result.

Links in invitations and resets work once and expire. When an email was really sent, the saved copy has the link
blanked out, so the outbox on disk cannot be used to take over an account.
"""
import hashlib
import json
import mimetypes
import os
import re
import secrets
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

ADDRESS_RE = re.compile(r"^[^@\s]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$")


def configured():
    """True when a mail server is set up (PENNY_SMTP_HOST)."""
    return bool(os.environ.get("PENNY_SMTP_HOST"))


def settings():
    """What is set up, for ./penny email status. Never the password itself, only whether one is set."""
    env = os.environ
    return {"PENNY_SMTP_HOST": env.get("PENNY_SMTP_HOST", ""), "PENNY_SMTP_PORT": env.get("PENNY_SMTP_PORT", "") or "587 (default)",
            "PENNY_SMTP_USER": env.get("PENNY_SMTP_USER", ""), "PENNY_SMTP_PASSWORD": "set" if env.get("PENNY_SMTP_PASSWORD") else "",
            "PENNY_SMTP_FROM": env.get("PENNY_SMTP_FROM", "") or (env.get("PENNY_SMTP_USER", "") and "same as PENNY_SMTP_USER"),
            "PENNY_PUBLIC_URL": env.get("PENNY_PUBLIC_URL", "") or "the address in the browser (default)"}


def explain(error):
    """Turn a mail error into what to check, in plain words."""
    e = str(error or "")
    low = e.lower()
    if "authentication" in low or "535" in e or "534" in e or "username and password" in low:
        return ("The mail server refused the username or password. Check PENNY_SMTP_USER and PENNY_SMTP_PASSWORD. "
                "Gmail and Microsoft 365 need an app password, not your normal password.")
    if "getaddrinfo" in low or "name or service not known" in low or "nodename nor servname" in low or "gaierror" in low:
        return "Penny could not find that mail server. Check the spelling of PENNY_SMTP_HOST."
    if "timed out" in low or "timeout" in low:
        return ("The mail server did not answer. Check PENNY_SMTP_PORT (587 is most common; Mailtrap also offers 2525), "
                "and that your network allows outgoing mail.")
    if "refused" in low:
        return "The mail server turned the connection away. Check PENNY_SMTP_HOST and PENNY_SMTP_PORT."
    if "ssl" in low or "wrong version number" in low or "starttls" in low:
        return "The secure connection failed. Use port 465 for SSL, or 587 (or 2525) for STARTTLS."
    if "sender" in low or "553" in e or "550" in e:
        return "The server would not send from that address. Set PENNY_SMTP_FROM to an address your mail account may send as."
    return "Check the mail settings with ./penny email status, then try again."


def describe():
    """For the web app and the terminal: where email goes, without any secret."""
    if not configured():
        return {"sends": False, "how": "Saved to the outbox, not sent (no mail server is set up)"}
    return {"sends": True, "how": f"Sent through {os.environ['PENNY_SMTP_HOST']} as {os.environ.get('PENNY_SMTP_FROM') or os.environ.get('PENNY_SMTP_USER', '')}"}


class Outbox:
    """Every email Penny sends, or saves when no mail server is set up, with a record of each."""

    def __init__(self, state_dir):
        """Emails are kept under state_dir/outbox, with one index file."""
        self.dir = Path(state_dir) / "outbox"
        self.index = self.dir / "outbox.jsonl"

    def send(self, to, subject, text, by, kind, attachments=(), redact=()):
        """Send (or save) one email. `attachments` is a list of (name, bytes). `redact` lists strings, like a one-time
        link, that are blanked out of the saved copy once the email has really been sent."""
        to = [t.strip().lower() for t in to if str(t).strip()]
        bad = [t for t in to if not ADDRESS_RE.match(t)]
        if not to or bad:
            raise ValueError(f"Not a valid email address: {', '.join(bad) or '(none)'}")
        sender = os.environ.get("PENNY_SMTP_FROM") or os.environ.get("PENNY_SMTP_USER") or "penny@localhost"
        msg = EmailMessage()
        msg["From"] = formataddr(("Penny AP", sender))
        msg["To"] = ", ".join(to)
        msg["Subject"] = subject
        msg["Message-ID"] = make_msgid(domain="penny.local")
        msg.set_content(text)
        meta = []
        for name, data in attachments:
            ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
            main, sub = ctype.split("/", 1)
            msg.add_attachment(data, maintype=main, subtype=sub, filename=name)
            meta.append({"name": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        status, error = "saved", ""
        if configured():
            try:
                self._smtp(msg)
                status = "sent"
            except Exception as e:                      # the record shows the failure; nothing is retried silently
                status, error = "failed", f"{type(e).__name__}: {e}"[:300]
        copy = msg.as_string()
        if status == "sent":
            for secret in redact:
                copy = copy.replace(secret, "[link removed after sending]")
        self.dir.mkdir(parents=True, exist_ok=True)
        eid = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + secrets.token_hex(3)
        (self.dir / f"{eid}.eml").write_text(copy, encoding="utf-8")
        entry = {"id": eid, "at": datetime.now().astimezone().isoformat(timespec="seconds"), "by": by, "to": to, "subject": subject,
                 "kind": kind, "attachments": meta, "status": status, "error": error, "file": f"{eid}.eml",
                 "body": text if status != "sent" or not redact else _redact(text, redact)}
        with open(self.index, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
        return entry

    def list(self, user=None):
        """Every email, newest first. Admins see all of them; everyone else sees the ones they sent."""
        if not self.index.exists():
            return []
        rows = [json.loads(line) for line in self.index.read_text(encoding="utf-8").splitlines() if line.strip()]
        if user and user.get("role") != "admin":
            rows = [r for r in rows if (r.get("by") or {}).get("id") == user["id"]]
        return list(reversed(rows))

    @staticmethod
    def _smtp(msg):
        """Send one message: SSL on port 465, otherwise STARTTLS."""
        host, port = os.environ["PENNY_SMTP_HOST"], int(os.environ.get("PENNY_SMTP_PORT") or 587)
        user, password = os.environ.get("PENNY_SMTP_USER"), os.environ.get("PENNY_SMTP_PASSWORD")
        ctx = ssl.create_default_context()
        if port == 465:
            with smtplib.SMTP_SSL(host, port, context=ctx, timeout=20) as s:
                if user:
                    s.login(user, password or "")
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=20) as s:
                s.starttls(context=ctx)
                if user:
                    s.login(user, password or "")
                s.send_message(msg)


def _redact(text, secrets_):
    """The text with each secret (a one-time link) blanked out."""
    for s in secrets_:
        text = text.replace(s, "[link removed after sending]")
    return text
