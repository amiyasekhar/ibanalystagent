import os
import json
import re
import time
from typing import Dict, Any, List, Tuple, Optional

from dotenv import load_dotenv
from google import genai
import fitz  # PyMuPDF

load_dotenv()

# -------------------------
# CONFIG
# -------------------------
PDF_FILES = []  # Configure with actual PDF files as needed
MODEL_NAME = "gemini-2.5-pro"

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY") or None)

METRICS = ["revenue", "ebitda", "pat", "eps", "networth", "total_assets"]

KEYWORDS = {
    "revenue": ["Value of Sales", "Sales & Services", "Revenue", "Total income", "Income", "Total Revenue"],
    "ebitda": ["EBITDA", "EBDIT", "Earnings Before Depreciation", "Operating EBITDA", "Operating Income", "Operating income", "Income from operations"],
    "pat": ["PROFIT AFTER TAX", "Profit after tax", "PAT", "Profit for the year", "Net Profit", "Net profit", "Net Income", "Net income"],
    "eps": ["Earnings Per Equity Share", "Basic (in", "EPS", "Earnings per share", "Diluted"],
    "networth": ["Total Equity", "Total equity", "Total Equity attributable", "Equity", "Net worth", "Shareholders' funds", "Stockholders' Equity"],
    "total_assets": ["Total Assets", "Assets"],
}

# Anchors = additional constraints for page repair + validation
ANCHORS = {
    "eps": ["earnings per equity share", "basic", "diluted"],
    "pat": ["owners", "attributable"],
    "networth": ["total equity"],
}

# Store NON-EPS in INR CRORE
CRORE_TO_INR = 10_000_000.0

# -------------------------
# Prompts
# -------------------------
LOCATOR_PROMPT = r"""
You are a PDF navigator for a public-company annual report.

Task: identify the physical PDF page numbers (1-based) where the following CONSOLIDATED statements appear for the CURRENT report year:
1) Consolidated Statement of Profit and Loss (or Income Statement)
2) Consolidated Balance Sheet
3) Earnings per Equity Share (EPS) table/row (basic/diluted)

Return STRICT JSON ONLY:
{
  "income_statement_pages": [number, ...],
  "balance_sheet_pages": [number, ...],
  "eps_pages": [number, ...]
}

Rules:
- Prefer the main consolidated statements (not notes unless the statement itself is in notes).
- Use physical PDF page numbers (1-based).
- If unsure, return an empty list for that item.
- JSON only. No markdown.
"""

EXTRACTION_PROMPT = r"""
You are a precise financial table extractor working on a PDF.

For the attached annual report PDF, extract CONSOLIDATED financial metrics
for the SINGLE financial year the report relates to.

CRITICAL UNITS RULE:
- Detect the currency and scale used in the document (e.g., USD millions, INR crores, EUR millions).
- Return all metrics (revenue, ebitda, pat, networth, total_assets) in the SAME scale as shown in the document.
- For EPS: return in the native currency per share (e.g., USD per share, INR per share, EUR per share).

Return STRICT JSON ONLY with exactly this structure:

{
  "year_label": "string",
  "year_end": "string",
  "revenue": { "value": number, "source": { "page": number, "section": "string", "snippet": "string" } },
  "ebitda":  { "value": number, "source": { "page": number, "section": "string", "snippet": "string" } },
  "pat":     { "value": number, "source": { "page": number, "section": "string", "snippet": "string" } },
  "eps":     { "value": number, "source": { "page": number, "section": "string", "snippet": "string" } },
  "networth":{ "value": number, "source": { "page": number, "section": "string", "snippet": "string" } },
  "total_assets": { "value": number, "source": { "page": number, "section": "string", "snippet": "string" } }
}

Rules:
- Use CONSOLIDATED figures only if both standalone and consolidated are shown.
- Ignore prior-year comparison columns; only extract the CURRENT report year.
- For year_label: Return ONLY the fiscal year as a 4-digit number (e.g., "2025", "2024"). If the report says "fiscal year ended January 28, 2024", return "2024". Do NOT include month names or multiple years.
- For EBITDA: Look for "EBITDA", "Operating EBITDA", or "Operating Income" (common in US 10-K filings).
- For PAT (Profit After Tax): Look for "Net Income", "Net Profit", or "Profit for the year".
- For Networth: Look for "Total Equity", "Stockholders' Equity", or "Shareholders' Equity".
- Page numbers must correspond to the PDF page where the value appears (physical PDF page index, 1-based).
- Snippet should be a short excerpt (≤ 200 chars) containing the number.
- If a metric is not clearly present, set value=0 and page=0 and section/snippet empty.
- Use plain numbers without commas.
- Do NOT invent numbers.
- Return JSON only. No markdown. No commentary.
"""

# EPS-only with strict basis + scope locking
EPS_ONLY_PROMPT = r"""
You are extracting one value from a company annual report PDF.

Find: CONSOLIDATED "Earnings per Equity Share" for the CURRENT report year only.

CRITICAL:
- Prefer BASIC EPS (not diluted).
- Prefer "Continuing and Discontinued Operations" (TOTAL EPS).
- If the report ONLY shows continuing operations, use that and indicate scope.

Return STRICT JSON ONLY:
{
  "value": number,
  "basis": "basic" | "diluted",
  "scope": "total" | "continuing",
  "source": { "page": number, "section": "string", "snippet": "string" }
}

Rules:
- EPS must be in native currency per share (e.g., USD, INR, EUR per share - as shown in document).
- Page is physical PDF page index (1-based).
- Snippet ≤ 200 chars and MUST include:
  - the word "Basic" or "Diluted"
  - and the EPS number for the current year
  - and "Continuing and Discontinued" if scope="total" OR "Continuing Operations" if scope="continuing"
- Ignore prior-year EPS numbers in the same row/column.
- If not found: value=0 and page=0 and section/snippet empty and basis="basic" and scope="total".
- JSON only.
"""

# Force Total Equity for networth
NETWORTH_ONLY_PROMPT = r"""
You are extracting one value from a company annual report PDF.

Find: CONSOLIDATED "Total Equity" (also called "Total equity", "Total Equity attributable to owners", "Shareholders' Equity", etc.)
from the CONSOLIDATED BALANCE SHEET for the CURRENT report year only.

Return STRICT JSON ONLY:
{
  "value": number,
  "source": { "page": number, "section": "string", "snippet": "string" }
}

Rules:
- Value must be in the same scale as shown in document (e.g., millions, crores, billions).
- Page is physical PDF page index (1-based).
- Snippet ≤ 200 chars and MUST contain the phrase "Total Equity" (or "Total equity") and the current-year number.
- Do NOT return "Equity Share Capital" or "Other Equity" separately.
- If not found: value=0 and page=0 and section/snippet empty.
- JSON only.
"""

# Targeted prompt to get PAT attributable to owners (for implied-shares sanity)
PAT_ATTRIB_PROMPT = r"""
You are extracting one value from a company annual report PDF.

Find: CONSOLIDATED "Net Profit attributable to Owners/Shareholders" (or "Net Income", or equivalent wording)
for the CURRENT report year only (not prior year).

Return STRICT JSON ONLY:
{
  "value": number,
  "source": { "page": number, "section": "string", "snippet": "string" }
}

Rules:
- Value must be in the same scale as shown in document (e.g., millions, crores, billions).
- Page is physical PDF page index (1-based).
- Snippet ≤ 200 chars and must contain the number and "Owners" or "attributable".
- If not found: value=0 and page=0 and section/snippet empty.
- JSON only.
"""

# -------------------------
# Utility
# -------------------------
def safe_num(x) -> float:
    try:
        return float(x)
    except Exception:
        return 0.0

def norm_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("…", "...")).strip()

def norm_year_label(s: str) -> str:
    s = (s or "").strip()
    # Remove FY prefix
    s = s.replace("FY ", "").replace("FY", "")
    # Extract just the 4-digit year (handles cases like "January 2026, 2025" -> "2025")
    # Look for all 4-digit years in the string
    years = re.findall(r'\b(20\d{2})\b', s)
    if years:
        # Return the last year found (most likely the fiscal year)
        return years[-1]
    return s

def looks_like_inr_not_crore(v: float) -> bool:
    # If someone returns INR, it's ~1e13; crore is ~1e6
    return v >= 1e9

def normalize_units_in_place(year_obj: Dict[str, Any]) -> None:
    for m in ["revenue", "ebitda", "pat", "networth", "total_assets"]:
        v = safe_num(year_obj.get(m, {}).get("value", 0))
        if v and looks_like_inr_not_crore(v):
            year_obj[m]["value"] = v / CRORE_TO_INR

    eps = safe_num(year_obj.get("eps", {}).get("value", 0))
    if eps > 10_000:
        year_obj["eps"]["value"] = eps / CRORE_TO_INR

def json_strip_fences(raw: str) -> str:
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`").strip()
        if raw.lower().startswith("json"):
            raw = raw[4:].strip()
    return raw

def snippet_has_total_equity(sn: str) -> bool:
    sn = norm_spaces(sn).lower()
    return ("total equity" in sn) or ("total equity attributable" in sn)

def snippet_looks_like_components(sn: str) -> bool:
    sn = norm_spaces(sn).lower()
    return ("equity share capital" in sn) or ("other equity" in sn)

def eps_snippet_is_diluted(sn: str) -> bool:
    sn = norm_spaces(sn).lower()
    return "diluted" in sn and "basic" not in sn

def eps_snippet_has_basic(sn: str) -> bool:
    sn = norm_spaces(sn).lower()
    return "basic" in sn

def page_passes_constraints(metric: str, page_text: str, snippet: str = "") -> bool:
    t = norm_spaces(page_text).lower()
    sn = norm_spaces(snippet).lower()

    kws = [k.lower() for k in KEYWORDS.get(metric, [])]
    if kws and not any(k in t for k in kws):
        return False

    if metric in ANCHORS:
        if not any(a in t for a in ANCHORS[metric]):
            return False

    if metric == "pat" and ("owners" in sn or "attributable" in sn):
        if ("owners" not in t) and ("attributable" not in t):
            return False

    return True

# -------------------------
# Gemini calls
# -------------------------
def _wrap_prompt_with_page_map(prompt: str, page_map: Optional[List[int]]) -> str:
    if not page_map:
        return prompt
    # page_map[i] = original physical page number for subset page (i+1)
    mapping = ", ".join([f"{i+1}->{p}" for i, p in enumerate(page_map[:120])])
    return (
        "NOTE: You are provided a SUBSET PDF composed of selected pages from the original annual report.\n"
        "When you return source.page, you MUST use the ORIGINAL physical PDF page numbers.\n"
        "Subset-to-original page mapping (subset_index->original_page):\n"
        f"{mapping}\n\n"
        + prompt
    )

def _subset_pdf(pdf_path: str, pages_1based: List[int]) -> Tuple[str, List[int]]:
    import tempfile
    pages = sorted(set([p for p in pages_1based if isinstance(p, int) and p > 0]))
    if not pages:
        return pdf_path, []
    doc = fitz.open(pdf_path)
    out = fitz.open()
    page_map: List[int] = []
    for p in pages:
        idx = p - 1
        if 0 <= idx < len(doc):
            out.insert_pdf(doc, from_page=idx, to_page=idx)
            page_map.append(p)
    tmp = tempfile.NamedTemporaryFile(prefix="subset_", suffix=".pdf", delete=False)
    tmp.close()
    out.save(tmp.name)
    out.close()
    doc.close()
    return tmp.name, page_map

def gemini_locate_pages(pdf_path: str) -> Dict[str, Any]:
    return _gemini_pdf_call(pdf_path, LOCATOR_PROMPT)

def _gemini_pdf_call(pdf_path: str, prompt: str, page_map: Optional[List[int]] = None) -> Dict[str, Any]:
    with open(pdf_path, "rb") as f:
        pdf_bytes = f.read()
    pdf_part = genai.types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf")
    last_err: Optional[Exception] = None
    wrapped_prompt = _wrap_prompt_with_page_map(prompt, page_map)
    # Transient TLS/network issues can happen with large PDF uploads. Retry a few times.
    for attempt in range(1, 4):
        try:
            resp = client.models.generate_content(
                model=MODEL_NAME,
                contents=[pdf_part, wrapped_prompt],
                config=genai.types.GenerateContentConfig(
                    temperature=0.2,
                    top_p=0.9,
                ),
            )
            raw = json_strip_fences(resp.text or "")
            return json.loads(raw)
        except Exception as e:
            last_err = e
            msg = str(e)
            # Only retry the common transient read/TLS errors
            transient = ("SSLV3_ALERT_BAD_RECORD_MAC" in msg) or ("httpx.ReadError" in msg) or ("ReadError" in msg)
            if not transient or attempt >= 3:
                break
            time.sleep(0.8 * attempt)
    raise last_err if last_err else RuntimeError("Gemini PDF call failed")

def gemini_extract_from_pdf(pdf_path: str) -> Dict[str, Any]:
    # Two-step: locate relevant pages first, then extract from subset PDF for speed/accuracy.
    try:
        loc = gemini_locate_pages(pdf_path) or {}
        pages = []
        pages += list(loc.get("income_statement_pages") or [])
        pages += list(loc.get("balance_sheet_pages") or [])
        pages += list(loc.get("eps_pages") or [])
        # Add neighbors to handle split statements across pages
        expanded = []
        for p in pages:
            try:
                p = int(p)
            except Exception:
                continue
            expanded.extend([p - 1, p, p + 1])
        subset_path, page_map = _subset_pdf(pdf_path, expanded)
        try:
            return _gemini_pdf_call(subset_path, EXTRACTION_PROMPT, page_map=page_map)
        finally:
            if subset_path != pdf_path:
                try:
                    os.remove(subset_path)
                except Exception:
                    pass
    except Exception:
        return _gemini_pdf_call(pdf_path, EXTRACTION_PROMPT)

def gemini_extract_pat_attrib_owners(pdf_path: str) -> Dict[str, Any]:
    return _gemini_pdf_call(pdf_path, PAT_ATTRIB_PROMPT)

def gemini_extract_eps_only(pdf_path: str) -> Dict[str, Any]:
    return _gemini_pdf_call(pdf_path, EPS_ONLY_PROMPT)

def gemini_extract_networth_only(pdf_path: str) -> Dict[str, Any]:
    return _gemini_pdf_call(pdf_path, NETWORTH_ONLY_PROMPT)

# -------------------------
# Page repair (fix Gemini bad page numbers)
# -------------------------
def find_best_page_by_snippet(doc: fitz.Document, metric: str, snippet: str) -> Optional[int]:
    snippet = norm_spaces(snippet)
    if not snippet or len(snippet) < 10:
        return None

    anchors = [snippet]
    if len(snippet) > 160:
        anchors.append(snippet[:160])
    if len(snippet) > 120:
        anchors.append(snippet[:120])
    if len(snippet) > 80:
        anchors.append(snippet[:80])

    for pno in range(len(doc)):
        page_text = doc[pno].get_text("text")
        if not page_passes_constraints(metric, page_text, snippet=snippet):
            continue

        text = norm_spaces(page_text)
        for a in anchors:
            if a in text:
                return pno + 1
    return None

def find_best_page_by_number(doc: fitz.Document, metric: str, val: float) -> Optional[int]:
    if not val or val == 0:
        return None

    iv = int(round(val))
    cands = set()
    cands.add(str(iv))
    cands.add(f"{val:.2f}".rstrip("0").rstrip("."))
    cands.add(f"{val:.1f}".rstrip("0").rstrip("."))

    def comma_international(n: int) -> str:
        return f"{n:,}"

    def comma_indian(n: int) -> str:
        s = str(n)
        if len(s) <= 3:
            return s
        last3 = s[-3:]
        rest = s[:-3]
        parts = []
        while len(rest) > 2:
            parts.append(rest[-2:])
            rest = rest[:-2]
        if rest:
            parts.append(rest)
        return ",".join(reversed(parts)) + "," + last3

    cands.add(comma_international(iv))
    cands.add(comma_indian(iv))

    for pno in range(len(doc)):
        page_text = doc[pno].get_text("text")
        if not page_passes_constraints(metric, page_text):
            continue

        for c in cands:
            if c in page_text:
                return pno + 1
    return None

def repair_sources(pdf_path: str, year_obj: Dict[str, Any]) -> List[Tuple[str, str]]:
    doc = fitz.open(pdf_path)
    repairs = []

    for m in METRICS:
        src = (year_obj.get(m, {}) or {}).get("source", {}) or {}
        p = int(src.get("page", 0) or 0)

        if p <= 0 or p > len(doc):
            snippet = src.get("snippet", "") or ""
            val = safe_num((year_obj.get(m, {}) or {}).get("value", 0))

            newp = find_best_page_by_snippet(doc, m, snippet)
            if newp is None:
                newp = find_best_page_by_number(doc, m, val)

            if newp is not None:
                year_obj[m]["source"]["page"] = int(newp)
                repairs.append((m, f"page {p} -> {newp}"))
            else:
                repairs.append((m, f"page {p} unresolved"))

    doc.close()
    return repairs

def repair_single_source_page(pdf_path: str, metric: str, src_obj: Dict[str, Any], fallback_val: float = 0.0) -> None:
    src = (src_obj or {}).get("source", {}) or {}
    p = int(src.get("page", 0) or 0)

    doc = fitz.open(pdf_path)
    try:
        if p <= 0 or p > len(doc):
            snippet = src.get("snippet", "") or ""
            newp = find_best_page_by_snippet(doc, metric, snippet)
            if newp is None:
                newp = find_best_page_by_number(doc, metric, safe_num(fallback_val))
            if newp is not None:
                src_obj["source"]["page"] = int(newp)
    finally:
        doc.close()

# -------------------------
# Highlighting
# -------------------------
def candidate_number_strings(val: float) -> List[str]:
    if val is None or float(val) == 0.0:
        return []
    cands = set()

    if abs(val - int(val)) < 1e-9:
        cands.add(str(int(val)))
    cands.add(str(val))
    cands.add(f"{val:.2f}".rstrip("0").rstrip("."))
    cands.add(f"{val:.1f}".rstrip("0").rstrip("."))

    for c in list(cands):
        digits = re.sub(r"[^\d]", "", c)
        if digits:
            cands.add(digits)

    return [c for c in cands if c and c != "0"]

def highlight_rects(page: fitz.Page, rects: List[fitz.Rect]) -> None:
    for r in rects:
        page.add_highlight_annot(r)

def region_fallback_highlight(page: fitz.Page, metric: str) -> bool:
    kws = KEYWORDS.get(metric, [])
    for kw in kws:
        rects = page.search_for(kw)
        if rects:
            expanded = []
            for r in rects[:6]:
                expanded.append(
                    fitz.Rect(r.x0, max(0, r.y0 - 12), page.rect.x1, min(page.rect.y1, r.y1 + 14))
                )
            highlight_rects(page, expanded)
            return True
    return False

def highlight_one_metric(page: fitz.Page, metric: str, snippet: str, val: float) -> bool:
    snippet = norm_spaces(snippet)

    if snippet:
        for q in [snippet, snippet[:140], snippet[:100], snippet[:70]]:
            rects = page.search_for(q)
            if rects:
                highlight_rects(page, rects)
                return True

    for cand in candidate_number_strings(float(val)):
        rects = page.search_for(cand)
        if rects:
            highlight_rects(page, rects)
            return True

    return region_fallback_highlight(page, metric)

def highlight_pdf(input_pdf: str, year_obj: Dict[str, Any], out_pdf: str) -> List[Tuple[str, str]]:
    doc = fitz.open(input_pdf)
    failures: List[Tuple[str, str]] = []

    for m in METRICS:
        src = year_obj.get(m, {}).get("source", {}) or {}
        page_no = int(src.get("page", 0) or 0)

        if page_no <= 0 or page_no > len(doc):
            failures.append((m, "invalid page"))
            continue

        page = doc[page_no - 1]
        ok = highlight_one_metric(page, m, src.get("snippet", ""), safe_num(year_obj[m]["value"]))
        if not ok:
            failures.append((m, f"not found on page {page_no}"))

        section = norm_spaces(src.get("section", ""))
        try:
            page.insert_text((36, 36), f"{year_obj.get('year_label','')} • {m} • {section}", fontsize=8)
        except Exception:
            pass

    doc.save(out_pdf)
    doc.close()
    return failures

# -------------------------
# Checks
# -------------------------
def yoy_growth(prev, curr):
    if prev == 0:
        return None
    return (curr - prev) / prev

def run_yoy_checks(years_sorted: List[Dict[str, Any]]) -> List[str]:
    warnings = []
    for i in range(1, len(years_sorted)):
        a = years_sorted[i-1]
        b = years_sorted[i]
        ay, by = a["year_label"], b["year_label"]

        rev_a, rev_b = safe_num(a["revenue"]["value"]), safe_num(b["revenue"]["value"])
        e_a, e_b     = safe_num(a["ebitda"]["value"]), safe_num(b["ebitda"]["value"])
        p_a, p_b     = safe_num(a["pat"]["value"]), safe_num(b["pat"]["value"])

        for name, x0, x1, limit in [
            ("Revenue", rev_a, rev_b, 0.35),
            ("EBITDA",  e_a,   e_b,   0.50),
            ("PAT",     p_a,   p_b,   0.60),
        ]:
            g = yoy_growth(x0, x1)
            if g is not None and abs(g) > limit:
                warnings.append(f"WARN [YoY] {name} {ay}->{by} looks large: {g*100:.1f}%")

        if rev_b:
            e_m = e_b / rev_b
            p_m = p_b / rev_b
            if not (0.05 <= e_m <= 0.35):
                warnings.append(f"WARN [Margin] EBITDA margin {by} odd: {e_m*100:.1f}%")
            if not (0.02 <= p_m <= 0.20):
                warnings.append(f"WARN [Margin] PAT margin {by} odd: {p_m*100:.1f}%")

    return warnings

def implied_shares(pat_crore: float, eps: float) -> float:
    if pat_crore <= 0 or eps <= 0:
        return 0.0
    return (pat_crore * CRORE_TO_INR) / eps

def run_pat_eps_checks(
    years_sorted: List[Dict[str, Any]],
    expected_multipliers: Tuple[float, ...] = (2.0,),
    tol: float = 0.25,
) -> List[str]:
    msgs = []
    rows = []
    for y in years_sorted:
        yl = y.get("year_label", "")
        eps = safe_num(y["eps"]["value"])

        # HARD RULE: only PAT attributable to owners (no fallback)
        pat_for_eps = safe_num((y.get("_pat_attrib_owners", {}) or {}).get("value", 0))
        if pat_for_eps <= 0 or eps <= 0:
            rows.append((yl, 0.0))
            continue

        shares = implied_shares(pat_for_eps, eps)
        rows.append((yl, shares))

    rows.sort(key=lambda r: r[0])

    for i in range(1, len(rows)):
        y0, s0 = rows[i-1]
        y1, s1 = rows[i]
        if s0 <= 0 or s1 <= 0:
            msgs.append(
                f"WARN [PAT/EPS] Missing/zero PAT attributable to owners OR EPS for {y0} or {y1}; "
                f"cannot validate implied shares. (No fallback to Profit-for-year.)"
            )
            continue

        ratio = s1 / s0
        expected = None
        for m in expected_multipliers:
            if (m * (1 - tol)) <= ratio <= (m * (1 + tol)):
                expected = m
                break

        if expected is not None:
            msgs.append(
                f"INFO [PAT/EPS] Implied shares {y0}->{y1} ≈ {ratio:.2f}x (expected ~{expected}x). "
                f"(~{s0/1e9:.3f}B -> {s1/1e9:.3f}B shares)"
            )
            continue

        change = abs(s1 - s0) / s0
        if change > 0.12:
            msgs.append(
                f"WARN [PAT/EPS] Implied shares changed {y0}->{y1} by {change*100:.1f}% "
                f"(ratio {ratio:.2f}x). Check EPS type/units/PAT basis."
            )
        else:
            msgs.append(f"OK   [PAT/EPS] Implied shares {y0}->{y1} changed {change*100:.1f}%.")

    return msgs

def eps_snippet_prior_value(eps_snip: str) -> Optional[float]:
    eps_snip = norm_spaces(eps_snip)
    nums = re.findall(r"\b\d+\.\d+\b", eps_snip)
    if len(nums) >= 2:
        try:
            return float(nums[1])
        except Exception:
            return None
    return None

def is_share_base_change_year(prev_y: Dict[str, Any], curr_y: Dict[str, Any], tol_low=1.7, tol_high=2.3) -> bool:
    prev_eps = safe_num((prev_y.get("eps", {}) or {}).get("value", 0))
    curr_eps = safe_num((curr_y.get("eps", {}) or {}).get("value", 0))

    prev_pat = safe_num((prev_y.get("_pat_attrib_owners", {}) or {}).get("value", 0))
    curr_pat = safe_num((curr_y.get("_pat_attrib_owners", {}) or {}).get("value", 0))

    if prev_eps <= 0 or curr_eps <= 0 or prev_pat <= 0 or curr_pat <= 0:
        return False

    s0 = implied_shares(prev_pat, prev_eps)
    s1 = implied_shares(curr_pat, curr_eps)
    if s0 <= 0:
        return False

    ratio = s1 / s0
    return tol_low <= ratio <= tol_high

def run_eps_basis_checks(years_sorted: List[Dict[str, Any]]) -> List[str]:
    msgs = []
    by_year = {y["year_label"]: y for y in years_sorted}
    years = [y["year_label"] for y in years_sorted]

    for i in range(1, len(years)):
        curr = by_year[years[i]]
        prev = by_year[years[i-1]]

        # Guardrail #3: if share base changed ~2x, suppress EPS prior-year mismatch warning
        if is_share_base_change_year(prev, curr):
            continue

        prior_in_curr = eps_snippet_prior_value((curr.get("eps", {}) or {}).get("source", {}).get("snippet", ""))
        prev_eps = safe_num((prev.get("eps", {}) or {}).get("value", 0))
        if prior_in_curr is not None and prev_eps > 0:
            if abs(prior_in_curr - prev_eps) / prev_eps > 0.10:
                msgs.append(
                    f"WARN [EPS BASIS] {curr['year_label']} EPS snippet shows prior-year EPS ~{prior_in_curr}, "
                    f"but extracted {prev['year_label']} EPS is {prev_eps}. Likely different EPS row/basis."
                )
    return msgs

# -------------------------
# EPS / Networth Fix-ups
# -------------------------
def needs_eps_fix(year_obj: Dict[str, Any]) -> bool:
    eps_obj = year_obj.get("eps", {}) or {}
    v = safe_num(eps_obj.get("value", 0))
    sn = (eps_obj.get("source", {}) or {}).get("snippet", "") or ""
    s = norm_spaces(sn).lower()

    if v <= 0:
        return True
    if "basic" not in s and "diluted" not in s:
        return True
    if eps_snippet_is_diluted(sn):
        return True
    # also require scope words if present in prompt output
    return False

def apply_eps_only(pdf_path: str, year_obj: Dict[str, Any]) -> None:
    eps_only = gemini_extract_eps_only(pdf_path)

    eps_v = safe_num(eps_only.get("value", 0))
    if eps_v > 10_000:
        eps_only["value"] = eps_v / CRORE_TO_INR

    repair_single_source_page(pdf_path, "eps", eps_only, fallback_val=safe_num(eps_only.get("value", 0)))

    basis = (eps_only.get("basis", "") or "basic").lower().strip()
    scope = (eps_only.get("scope", "") or "total").lower().strip()
    snip = (eps_only.get("source", {}) or {}).get("snippet", "") or ""
    s = norm_spaces(snip).lower()

    if eps_v <= 0:
        return

    # must indicate basic/diluted explicitly
    if ("basic" not in s) and ("diluted" not in s):
        return

    # enforce scope labeling
    if scope == "total":
        if "continuing and discontinued" not in s:
            return
    elif scope == "continuing":
        if "continuing" not in s:
            return

    year_obj["_eps_basis"] = "diluted" if basis == "diluted" else "basic"
    year_obj["_eps_scope"] = scope
    year_obj["eps"] = {"value": eps_only["value"], "source": eps_only["source"]}

def needs_networth_fix(year_obj: Dict[str, Any]) -> bool:
    nw = year_obj.get("networth", {}) or {}
    v = safe_num(nw.get("value", 0))
    sn = (nw.get("source", {}) or {}).get("snippet", "") or ""

    if v <= 0:
        return True
    if snippet_looks_like_components(sn) and not snippet_has_total_equity(sn):
        return True
    if not snippet_has_total_equity(sn):
        return True
    return False

def apply_networth_only(pdf_path: str, year_obj: Dict[str, Any]) -> None:
    nw_only = gemini_extract_networth_only(pdf_path)

    v = safe_num(nw_only.get("value", 0))
    if v and looks_like_inr_not_crore(v):
        nw_only["value"] = v / CRORE_TO_INR

    repair_single_source_page(pdf_path, "networth", nw_only, fallback_val=safe_num(nw_only.get("value", 0)))

    sn = (nw_only.get("source", {}) or {}).get("snippet", "") or ""
    if safe_num(nw_only.get("value", 0)) > 0 and snippet_has_total_equity(sn):
        year_obj["networth"] = {"value": nw_only["value"], "source": nw_only["source"]}

# -------------------------
# MAIN
# -------------------------
def main():
    years: List[Dict[str, Any]] = []

    for p in PDF_FILES:
        if not os.path.exists(p):
            raise FileNotFoundError(p)

        print(f"\n=== Processing {p} (full PDF into Gemini) ===")
        y = gemini_extract_from_pdf(p)

        y["year_label"] = norm_year_label(y.get("year_label"))
        normalize_units_in_place(y)

        # Repair bad page numbers (critical for highlighting)
        repairs = repair_sources(p, y)
        fixed = [r for r in repairs if "->" in r[1]]
        if fixed:
            print("  -> Repaired source pages:", fixed)

        # EPS: force BASIC+scope locking
        if needs_eps_fix(y):
            print("  -> EPS looks missing/ambiguous/diluted-only. Re-querying EPS-only (prefer BASIC + lock scope)...")
            try:
                apply_eps_only(p, y)
            except Exception as e:
                print("  -> EPS-only requery failed (non-fatal):", str(e))

        # Networth: force Total Equity
        if needs_networth_fix(y):
            print("  -> Networth looks like components or missing 'Total Equity'. Re-querying networth-only (Total Equity)...")
            try:
                apply_networth_only(p, y)
            except Exception as e:
                print("  -> Networth-only requery failed (non-fatal):", str(e))

        # Repair pages again (in case EPS/Networth were replaced)
        repair_sources(p, y)

        # PAT attributable to Owners
        try:
            attrib = gemini_extract_pat_attrib_owners(p)
            v = safe_num(attrib.get("value", 0))
            if v and looks_like_inr_not_crore(v):
                attrib["value"] = v / CRORE_TO_INR

            if safe_num(attrib.get("value", 0)) > 0:
                repair_single_source_page(p, "pat", attrib, fallback_val=safe_num(attrib.get("value", 0)))
                y["_pat_attrib_owners"] = attrib
        except Exception:
            pass

        print(json.dumps(y, indent=2))
        years.append(y)

        out_pdf = os.path.splitext(p)[0] + "_HIGHLIGHTED.pdf"
        print(f"-> Writing highlights: {out_pdf}")
        failures = highlight_pdf(p, y, out_pdf)
        if failures:
            print("Highlight failures:", failures)

    years_sorted = sorted(years, key=lambda yy: yy.get("year_label", ""))

    combined = {
        "company": "",  # Company name detection can be added if needed
        "currency": "Detected from document",  # Currency/scale detected from document
        "years": years_sorted,
    }

    with open("financials_with_sources.json", "w") as f:
        json.dump(combined, f, indent=2)

    print("\n✅ Saved: financials_with_sources.json")

    print("\n=== YoY reconciliation checks ===")
    yoy_warnings = run_yoy_checks(years_sorted)
    if yoy_warnings:
        for w in yoy_warnings:
            print(w)
    else:
        print("OK: No YoY warnings.")

    print("\n=== EPS row vs prior-year extracted EPS checks ===")
    eps_msgs = run_eps_basis_checks(years_sorted)
    if eps_msgs:
        for m in eps_msgs:
            print(m)
    else:
        print("OK: No EPS basis warnings.")

    print("\n=== Cross-metric PAT vs EPS implied shares checks ===")
    for msg in run_pat_eps_checks(years_sorted, expected_multipliers=(2.0,), tol=0.25):
        print(msg)

    print("\n=== Implied shares (PAT/EPS) ===")
    for yy in years_sorted:
        eps = safe_num((yy.get("eps", {}) or {}).get("value", 0))
        pat_for_eps = safe_num((yy.get("_pat_attrib_owners", {}) or {}).get("value", 0))

        if pat_for_eps <= 0 or eps <= 0:
            print(f"{yy.get('year_label','')}: missing _pat_attrib_owners or EPS; skipping implied shares.")
            continue

        shares = implied_shares(pat_for_eps, eps)
        basis = (yy.get("_eps_basis", "") or "unknown")
        scope = (yy.get("_eps_scope", "") or "unknown")
        print(f"{yy['year_label']}: PAT_for_EPS={pat_for_eps}cr, EPS={eps} ({basis},{scope}) => implied shares ~ {shares/1e9:.3f}B")


if __name__ == "__main__":
    main()