"""Small helpers shared by every module: money, dates, name and invoice-number normalization."""
import hashlib
import re
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

CENT = Decimal("0.01")


def D(x) -> Decimal:
    """Decimal from str/int/float/Decimal. Floats go through str() so 0.1 stays 0.1."""
    if isinstance(x, Decimal):
        return x
    if x is None or x == "":
        return Decimal("0")
    return Decimal(str(x))


def q(x) -> Decimal:
    """Round to cents, half up (what accountants expect)."""
    return D(x).quantize(CENT, rounding=ROUND_HALF_UP)


def parse_money(s: str) -> Decimal:
    """'$1,234.50' -> 1234.50 ; '($2,000.00)' -> -2000.00"""
    s = s.strip()
    neg = s.startswith("(") and s.endswith(")") or s.startswith("-")
    digits = re.sub(r"[^0-9.]", "", s)
    v = Decimal(digits) if digits else Decimal("0")
    return -v if neg else v


def parse_us_date(s: str) -> date:
    return datetime.strptime(s.strip(), "%m/%d/%Y").date()


def iso(d) -> str:
    return d.isoformat() if d else ""


def us(d) -> str:
    """MM/DD/YYYY, the format the Intacct template requires."""
    return d.strftime("%m/%d/%Y") if d else ""


def as_date(x):
    if x is None or x == "":
        return None
    if isinstance(x, datetime):
        return x.date()
    if isinstance(x, date):
        return x
    s = str(x).strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"unrecognized date: {x!r}")


def add_days(d: date, n: int) -> date:
    return d + timedelta(days=n)


def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


_SUFFIXES = {"llc", "inc", "co", "corp", "corporation", "company", "lp", "ltd", "llp"}


def norm_name(s: str) -> str:
    """'Sterling Grounds & Pest LLC' and 'Sterling Grounds and Pest LLC' -> same string."""
    s = (s or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    toks = [t for t in s.split() if t not in _SUFFIXES]
    return " ".join(toks)


def short_name(s: str) -> str:
    """Vendor name without legal suffix, original capitalization."""
    toks = re.sub(r"[,.]", "", s or "").split()
    while toks and toks[-1].lower() in _SUFFIXES:
        toks.pop()
    return " ".join(toks)


def norm_invoice_no(s: str) -> str:
    """Duplicate-matching key for invoice numbers.

    History was keyed by different people, so 'INV-20417', 'inv 20417', '20417' and 'INV-020417'
    must all collapse to the same key. We: upper-case, drop a leading INV / INVOICE label that is
    followed by a number, drop punctuation and spaces, and strip leading zeros inside every digit run.
    The vendor ID is always part of the duplicate key, so the same number from two vendors never collides.
    """
    s = (s or "").strip().upper()
    # only strip an 'INV'/'INVOICE' label when it is followed by a number, so vendor prefixes are safe
    s = re.sub(r"^(INVOICE|INV)[\s\-#:.]*(?=\d)", "", s)
    s = re.sub(r"[^A-Z0-9]", "", s)
    s = re.sub(r"(?<![0-9])0+(?=[0-9])", "", s)
    return s


def norm_addr(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\b(suite|ste)\b", "ste", s)
    return " ".join(s.split())


def digits(s: str) -> str:
    return re.sub(r"\D", "", s or "")
