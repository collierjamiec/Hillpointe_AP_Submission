"""PDF text reading. Rotated text (watermarks such as REPRINT or PAST DUE) is separated out so it
cannot corrupt the body text, and is reported as a 'stamp' instead."""
import pdfplumber


def _is_rotated(c):
    """Watermarks are drawn at an angle. pdfplumber reports them as 'upright', so look at the text matrix."""
    m = c.get("matrix")
    return bool(m) and (abs(m[1]) > 0.01 or abs(m[2]) > 0.01)


def read_pdf(path):
    pages, stamps = [], []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            rotated = [c for c in page.chars if _is_rotated(c)]
            if rotated:
                rotated.sort(key=lambda c: c["x0"])
                word = "".join(c["text"] for c in rotated).strip()
                if word:
                    stamps.append(word.upper())
            body = page.filter(lambda o: o.get("object_type") != "char" or not _is_rotated(o))
            pages.append(body.extract_text() or "")
    return {"text": "\n".join(pages), "pages": len(pages), "stamps": stamps}
