"""PDF text reading. Rotated text (watermarks such as REPRINT or PAST DUE) is separated out so it
cannot corrupt the body text, and is reported as a 'stamp' instead.

A file that cannot be read raises UnreadableFile with a plain-language reason (empty, not a PDF, password
protected, damaged, or a scanned image with no text). The caller holds that one file and the batch carries on."""
import pdfplumber


class UnreadableFile(Exception):
    """The file could not be read as an invoice. str(e) is a plain-language reason a person can act on."""


def _is_rotated(c):
    """Watermarks are drawn at an angle. pdfplumber reports them as 'upright', so look at the text matrix."""
    m = c.get("matrix")
    return bool(m) and (abs(m[1]) > 0.01 or abs(m[2]) > 0.01)


def _why_open_failed(path, err):
    """Turn a low-level PDF library error into a reason an AP clerk can act on."""
    try:
        with open(path, "rb") as f:
            head = f.read(1024)
    except OSError as e:
        return f"The file could not be opened ({e.strerror or type(e).__name__})."
    if not head.strip():
        return "The file is empty (0 bytes). The upload or email attachment probably failed."
    if b"%PDF" not in head:
        return "The file is not a PDF, even though its name ends in .pdf. It may be a different kind of file that was renamed."
    causes = [err] + [a for a in getattr(err, "args", ()) if isinstance(a, BaseException)]
    names = " ".join(type(c).__name__ for c in causes)
    if "Password" in names or "Encrypt" in names:
        return "The PDF is password protected, so its text cannot be read."
    detail = next((str(c) for c in causes if str(c).strip()), type(err).__name__)
    return f"The PDF is damaged or incomplete and could not be opened ({detail})."


def read_pdf(path):
    """Open a PDF and return its text and stamps, or raise UnreadableFile with a plain reason."""
    try:
        pdf = pdfplumber.open(path)
    except Exception as e:
        raise UnreadableFile(_why_open_failed(path, e)) from e
    pages, stamps = [], []
    with pdf:
        try:
            for n, page in enumerate(pdf.pages, start=1):
                try:
                    rotated = [c for c in page.chars if _is_rotated(c)]
                    if rotated:
                        rotated.sort(key=lambda c: c["x0"])
                        word = "".join(c["text"] for c in rotated).strip()
                        if word:
                            stamps.append(word.upper())
                    body = page.filter(lambda o: o.get("object_type") != "char" or not _is_rotated(o))
                    pages.append(body.extract_text() or "")
                except Exception as e:
                    raise UnreadableFile(f"Page {n} of the PDF is damaged and could not be read ({type(e).__name__}: {e}).") from e
        except UnreadableFile:
            raise
        except Exception as e:
            raise UnreadableFile(_why_open_failed(path, e)) from e
    if not pages:
        raise UnreadableFile("The PDF has no pages.")
    if not "".join(pages).strip():
        raise UnreadableFile("The PDF has no readable text. It is probably a scanned image or photo, which needs OCR or manual entry.")
    return {"text": "\n".join(pages), "pages": len(pages), "stamps": stamps}
