"""What people do in the web app, checked and saved on the server. (Added after submission, v2.0.)

Before 2.0 a person's actions (resolving a hold, approving a bill, a note, a rule change) were saved in their own
browser. Now the browser sends each one here. The server decides who is acting (from the session, never from what
the browser says), checks that their role may do it, checks it against what everyone else has already done, and only
then adds it to the audit log in the database. Rule changes are also written to config/rules.json, so the rules on
the Rules page are the rules Penny runs with.

The checks, in order
  1. The kind of action is one a browser may send. Batches, runs, manual entries saved for a run, account changes
     and emails are recorded by the server itself when it does them, so a browser cannot claim them.
  2. The person's role allows it (the same table the web app uses to show or hide buttons; a test keeps the two
     tables equal).
  3. Penny is not waiting for a required update.
  4. It still makes sense. These run inside the database's write lock, so two people cannot both win:
       a hold that is already resolved cannot be resolved again        a bill step is approved once
       a file marked imported cannot be marked again                   the row count must equal the file's rows
       the person who imported a file cannot confirm it               a preview's files cannot be imported
       the second check of a manual entry is a different person       a blocker is cleared or reopened once
       a rule is changed only from the value the person was looking at

A refused action answers with the reason in plain words and the right status: 403 (not allowed), 409 (someone got
there first, or the state changed), 422 (the details are wrong).
"""
import json
import math
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

# The same roles as ROLES in web/assets/penny-core.js. tests/test_platform.py checks the two stay equal.
ROLE_CAN = {
    "viewer": [],
    "clerk": ["resolve", "note", "upload", "email", "export"],
    "approver": ["approve", "note", "email", "confirm"],
    "admin": ["resolve", "note", "approve", "rules", "upload", "run", "users", "email", "export", "confirm"],
}
# What each action needs. None: anyone signed in. The same as EVENT_NEEDS in penny-core.js for these actions.
NEEDS = {
    "hold.resolve": "resolve", "hold.reopen": "resolve", "hold.reassign": "resolve",
    "bill.approve": "approve", "bill.sendback": "approve", "note.add": "note",
    "rules.update": "rules", "rules.revert": "rules",
    "blocker.update": "resolve", "blocker.clear": "resolve", "blocker.reopen": "resolve",
    "manual.keyed": "resolve", "manual.check": "resolve",
    "export.imported": "export", "export.undo": "export", "export.confirmed": "confirm",
    "export.download": None,
}
# Recorded by the server when it does the work, so a browser may not send them.
SERVER_OWNED = ("batch.", "manual.saved", "user.", "email.", "recheck.", "watch.")
CANNOT = {
    "resolve": "Only an AP Clerk or Admin can work holds.", "approve": "Only an Approver or Admin can approve bills.",
    "note": "Viewers cannot add notes.", "rules": "Only an Admin can change rules.",
    "export": "Only an AP Clerk or Admin can mark a file as imported.", "confirm": "Only an Approver or Admin can confirm an import.",
}
MAX_EVENT = 200 * 1024
ID_RE = re.compile(r"^[0-9a-f]{16,64}$")
NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,160}$")
RESERVED = ("id", "type", "at", "user", "seq", "origin", "pending", "repeat")


class ActionError(Exception):
    """An action the server refuses. `status` is the HTTP status to answer with."""
    def __init__(self, message, status=409):
        super().__init__(message)
        self.status = status


def subject_of(event):
    """What an action is about, so everything about one invoice, one file or the rules can be looked up together."""
    t = event.get("type", "")
    if t.startswith("rules."):
        return "rules"
    if t.startswith("export."):
        return f"file:{event.get('run')}/{event.get('file')}"
    return f"doc:{event.get('doc')}" if event.get("doc") else ""


def _name(e):
    return (e.get("user") or {}).get("name") or "Someone"


def _last(events, types):
    """The newest event of the given kinds, or None."""
    for e in reversed(events):
        if e.get("type") in types:
            return e
    return None


# ------------------------------------------------------------------ rules: the Rules page changes config/rules.json
def get_path(obj, path):
    """The value at a dotted path, or None when it is not there."""
    for k in path.split("."):
        if not isinstance(obj, dict) or k not in obj:
            return None
        obj = obj[k]
    return obj


def set_path(obj, path, value):
    """Set the value at a dotted path, making the steps on the way."""
    keys = path.split(".")
    for k in keys[:-1]:
        obj = obj.setdefault(k, {})
        if not isinstance(obj, dict):
            raise ActionError("That rule cannot be changed that way.", 422)
    obj[keys[-1]] = value


def _kind(v):
    return "bool" if isinstance(v, bool) else "number" if isinstance(v, (int, float)) else type(v).__name__


def check_rule_path(path):
    """A rule's name must be a plain dotted path. Notes in the file (names starting with _) cannot be changed here."""
    if not isinstance(path, str) or not path or len(path) > 200 or any((not k) or k.startswith("_") or k in ("constructor", "prototype") for k in path.split(".")):
        raise ActionError("That rule cannot be changed.", 422)


def check_rule_value(path, old, new):
    """A new rule value must be the same kind of thing as the old one, and a sensible number."""
    if new is None:
        raise ActionError(f"The rule {path} cannot be left empty.", 422)
    if old is not None and _kind(old) != _kind(new):
        raise ActionError(f"The new value for {path} is not the same kind of value as the old one.", 422)

    def numbers(v):
        if isinstance(v, bool):
            return
        if isinstance(v, (int, float)) and (not math.isfinite(v) or v < 0):
            raise ActionError(f"The new value for {path} has to be zero or more.", 422)
        for x in (v.values() if isinstance(v, dict) else v if isinstance(v, list) else ()):
            numbers(x)
    numbers(new)


def write_rules(cfg_path, rules, state_dir, label):
    """Replace config/rules.json in one step, after keeping a copy of the old file in state/rules_history/."""
    cfg_path = Path(cfg_path)
    need = ("thresholds", "routes", "code_priority", "terms_days", "payment_change_phrases")
    if any(k not in rules for k in need):
        raise ActionError("That change would leave the rules incomplete, so Penny did not save it.", 422)
    text = json.dumps(rules, indent=2, ensure_ascii=False) + "\n"
    if len(text.encode("utf-8")) > 1024 * 1024:
        raise ActionError("The rules would be too large.", 422)
    history = Path(state_dir) / "rules_history"
    history.mkdir(parents=True, exist_ok=True)
    shutil.copy2(cfg_path, history / f"{label}.json")
    tmp = cfg_path.with_name(cfg_path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, cfg_path)


def _apply_rules(service, event, about, who):
    """Work out the new rules for a rules.update or rules.revert, refusing if a value changed under the person."""
    rules = json.loads(Path(service.cfg_path).read_text(encoding="utf-8"))
    if event["type"] == "rules.update":
        changes = event.get("changes")
        if not isinstance(changes, list) or not changes or len(changes) > 200:
            raise ActionError("There is no rule change to save.", 422)
        pairs = [(c.get("path", ""), c.get("before"), c.get("after")) for c in changes if isinstance(c, dict)]
        if len(pairs) != len(changes):
            raise ActionError("There is no rule change to save.", 422)
    else:
        target = next((e for e in about if e.get("id") == event.get("target") and e.get("type") == "rules.update"), None)
        if not target:
            raise ActionError("That rule change is not in the audit trail.", 422)
        if any(e.get("type") == "rules.revert" and e.get("target") == target["id"] for e in about):
            raise ActionError("That rule change was already undone.", 409)
        pairs = [(c["path"], c.get("after"), c.get("before")) for c in target["changes"]]
    for path, expect, new in pairs:
        check_rule_path(path)
        now = get_path(rules, path)
        if now != expect:
            raise ActionError(f"The rule “{path}” changed while you were working, so nothing was saved. Reload the Rules page to see it as it is now.", 409)
        if new is None and event["type"] == "rules.revert":       # undoing the first time a rule was set: take it out again
            parent = get_path(rules, path.rsplit(".", 1)[0]) if "." in path else rules
            parent.pop(path.rsplit(".", 1)[-1], None)
            continue
        check_rule_value(path, now, new)
        set_path(rules, path, new)
    return rules


# ------------------------------------------------------------------ one action
def clean(event):
    """The parts of an action the browser may set. Who did it and when are filled in by the server."""
    if not isinstance(event, dict):
        raise ActionError("That is not an action Penny understands.", 400)
    t, eid = event.get("type"), event.get("id")
    if t not in NEEDS:
        if isinstance(t, str) and t.startswith(SERVER_OWNED):
            raise ActionError("Penny records that itself when it happens, so a browser cannot send it.", 400)
        raise ActionError("That is not an action Penny understands.", 400)
    if not isinstance(eid, str) or not ID_RE.match(eid):
        raise ActionError("That action has no proper ID.", 400)
    body = {k: v for k, v in event.items() if k not in RESERVED}
    if len(json.dumps(body)) > MAX_EVENT:
        raise ActionError("That is too much to save in one action.", 413)
    for k in ("doc", "run", "file"):
        if k in body and not (isinstance(body[k], str) and NAME_RE.match(body[k])):
            raise ActionError("That action does not say clearly what it is about.", 422)
    return {"id": eid, "type": t, **body}


def allowed(actor, kind):
    """Refuse (403) unless the person's role may do this kind of action."""
    need = NEEDS[kind]
    if need and need not in ROLE_CAN.get(actor.get("role"), []):
        raise ActionError(CANNOT.get(need, "Your role cannot do that."), 403)


def state_check(service, event, about, actor):
    """The "does it still make sense" checks. `about` is every earlier event on the same invoice, file or rules."""
    t, me = event["type"], actor["id"]
    if t in ("hold.resolve", "hold.reopen"):
        last = _last(about, ("hold.resolve", "hold.reopen"))
        resolved = bool(last and last["type"] == "hold.resolve")
        if t == "hold.resolve" and resolved:
            raise ActionError(f"{_name(last)} already resolved this hold. Penny has shown you their decision.", 409)
        if t == "hold.resolve" and event.get("outcome") not in ("cleared", "rejected"):
            raise ActionError("Choose whether the hold is cleared or rejected.", 422)
        if t == "hold.reopen" and not resolved:
            raise ActionError("This hold is already open.", 409)
    elif t in ("bill.approve", "bill.sendback"):
        step = event.get("step")
        if not isinstance(step, str) or not step:
            raise ActionError("That approval does not say which sign-off it is.", 422)
        last = _last([e for e in about if e.get("step") == step], ("bill.approve", "bill.sendback"))
        if last and last["type"] == t:
            raise ActionError(f"{_name(last)} already {'approved' if t == 'bill.approve' else 'sent back'} this step.", 409)
    elif t in ("blocker.clear", "blocker.reopen"):
        last = _last([e for e in about if e.get("code") == event.get("code")], ("blocker.clear", "blocker.reopen"))
        cleared = bool(last and last["type"] == "blocker.clear")
        if t == "blocker.clear" and cleared:
            raise ActionError(f"{_name(last)} already cleared this blocker.", 409)
        if t == "blocker.reopen" and not cleared:
            raise ActionError("This blocker is already open.", 409)
    elif t == "manual.check":
        keyed = _last(about, ("manual.keyed",))
        if not keyed or keyed.get("id") != event.get("entry_id"):
            raise ActionError("That manual entry was keyed again, so this check no longer applies. Reload the invoice.", 409)
        if (keyed.get("user") or {}).get("id") == me:
            raise ActionError("A different person has to do the second check.", 403)
    elif t.startswith("export.") and t != "export.download":
        last = _last(about, ("export.imported", "export.undo"))
        imported = last if last and last["type"] == "export.imported" else None
        if t == "export.imported":
            if imported:
                raise ActionError(f"{_name(imported)} already marked this file as imported (reference {imported.get('ref')}).", 409)
            info = service.export_file(event.get("run"), event.get("file"))
            if info is None:
                raise ActionError("That file is not one of Penny's run files.", 422)
            if info["dry_run"]:
                raise ActionError("That file is from a preview, so it is not for import.", 422)
            if not str(event.get("ref") or "").strip():
                raise ActionError("Type the reference from the other system.", 422)
            if info["rows"] is not None and event.get("rows") != info["rows"]:
                raise ActionError(f"The file has {info['rows']} rows, not {event.get('rows')}. Do not mark this as imported until you know why.", 422)
        elif not imported:
            raise ActionError("This file is not marked as imported.", 409)
        elif t == "export.confirmed":
            if (imported.get("user") or {}).get("id") == me:
                raise ActionError("The person who imported a file cannot confirm it. A different person has to.", 403)
            done = _last([e for e in about if e["seq"] > imported["seq"]], ("export.confirmed",))
            if done:
                raise ActionError(f"{_name(done)} already confirmed this import.", 409)


def record(service, actor, event):
    """Check one action from the web app and add it to the audit log. Returns the saved event, with its number,
    time and the person the server knows is acting. Raises ActionError with the reason when it is refused."""
    event = clean(event)
    allowed(actor, event["type"])
    if event["type"] != "export.download":
        service.paused("Changes")
    who = {"id": actor["id"], "name": actor["name"], "role": actor["role"],
           "initials": "".join(w[0] for w in str(actor["name"]).split())[:2].upper()}
    saved = {**event, "at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"), "user": who}
    subject = subject_of(event)
    new_rules = {}

    def check(db):
        about = service.store.about(subject, db=db) if subject else []
        state_check(service, saved, about, who)
        if event["type"].startswith("rules."):
            new_rules["rules"] = _apply_rules(service, saved, about, who)
            write_rules(service.cfg_path, new_rules["rules"], service.state_dir, f"before-{event['id']}")

    out = service.store.append(saved, "web", subject=subject, uid=event["id"], check=check)
    if out.get("repeat") and (out.get("user") or {}).get("id") != who["id"]:
        raise ActionError("That action ID was already used.", 409)
    return out


def bring_in(service, actor, events):
    """Move a browser's saved actions from before 2.0 into the team's audit log. Admin only. Each keeps the time
    and the person it was recorded with, is marked as moved, and says who moved it. An action already in the log
    is skipped. Rule changes are kept as history only: they do not change the rules Penny runs with."""
    if actor.get("role") != "admin":
        raise ActionError("Only an Admin can move a browser's earlier work into Penny.", 403)
    if not isinstance(events, list) or len(events) > 5000:
        raise ActionError("That is not a list of saved actions.", 400)
    added = skipped = 0
    by = {"id": actor["id"], "name": actor["name"], "role": actor["role"]}
    for e in events:
        if not (isinstance(e, dict) and isinstance(e.get("id"), str) and ID_RE.match(e["id"]) and isinstance(e.get("type"), str)
                and isinstance(e.get("user"), dict) and isinstance(e.get("at"), str) and len(json.dumps(e)) <= MAX_EVENT):
            skipped += 1
            continue
        body = {k: v for k, v in e.items() if k not in ("seq", "origin", "pending", "repeat")}
        out = service.store.append({**body, "moved_by": by, "moved": True}, "import", subject=subject_of(body), uid=e["id"])
        added, skipped = (added, skipped + 1) if out.get("repeat") else (added + 1, skipped)
    service.log({"event": "history.moved", "by": by, "count": added, "skipped": skipped})
    return {"added": added, "skipped": skipped}
