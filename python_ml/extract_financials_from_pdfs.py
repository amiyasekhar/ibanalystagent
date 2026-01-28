#!/usr/bin/env python3
"""
Bridge script: extract financial metrics from local PDF paths using the existing test.py logic.

Input (stdin JSON):
{
  "pdfPaths": ["path1.pdf", "path2.pdf"],
  "highlight": false
}

Output (stdout JSON):
{
  "ok": true,
  "company": "string",
  "currency": "detected from document (e.g. USD, INR)",
  "years": [ ... year objects ... ],
  "tableText": "string"
}
"""

from __future__ import annotations

import json
import os
import sys
import importlib.util
from typing import Any, Dict, List


METRIC_KEYS = ["revenue", "ebitda", "pat", "eps", "networth", "total_assets"]


def dedupe_years(years: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Merge duplicate year_label entries.  For each metric, keep the entry
    whose value is non-zero (or the later-seen one when both are non-zero)."""
    merged: Dict[str, Dict[str, Any]] = {}
    for y in years:
        label = y.get("year_label", "")
        if label not in merged:
            merged[label] = dict(y)
            continue
        # Merge: for each metric key, prefer the non-zero value
        existing = merged[label]
        for k in METRIC_KEYS:
            new_val = (y.get(k) or {}).get("value", 0)
            old_val = (existing.get(k) or {}).get("value", 0)
            try:
                new_num = float(new_val) if new_val else 0
                old_num = float(old_val) if old_val else 0
            except (TypeError, ValueError):
                new_num = 0
                old_num = 0
            # Replace if existing is zero but new is non-zero
            if old_num == 0 and new_num != 0:
                existing[k] = y.get(k)
        # Keep _sourcePdf from whichever had more non-zero metrics
        new_filled = sum(1 for k in METRIC_KEYS if (y.get(k) or {}).get("value", 0))
        old_filled = sum(1 for k in METRIC_KEYS if (existing.get(k) or {}).get("value", 0))
        if new_filled > old_filled:
            existing["_sourcePdf"] = y.get("_sourcePdf", existing.get("_sourcePdf", ""))
    return list(merged.values())


def to_table_text(years: List[Dict[str, Any]]) -> str:
    # Simple banker-friendly table text for pasting into the app.
    # Each year object is expected to have {year_label, revenue/ebitda/pat/eps/networth/total_assets} each as {value, source}.
    cols = ["year_label", "revenue", "ebitda", "pat", "eps", "networth", "total_assets"]
    header = " | ".join(cols)
    lines = [header, "-" * len(header)]
    for y in years:
        def val(k: str) -> str:
            if k == "year_label":
                return str(y.get("year_label", ""))
            v = (y.get(k, {}) or {}).get("value", 0)
            try:
                num = float(v) if isinstance(v, (int, float)) else 0
                if num == 0:
                    return "0"
                # For EPS, show as-is (already per share)
                if k == "eps":
                    return f"{num:.2f}"
                # For other metrics, multiply by 1,000,000 to show full number (values are in millions)
                # Display as "26914000000" or with commas
                full_num = int(num * 1_000_000)
                return f"{full_num:,}"
            except Exception:
                return str(v)

        lines.append(" | ".join(val(c) for c in cols))
    return "\n".join(lines)


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        sys.stdout.write(json.dumps({"ok": False, "error": "No stdin JSON provided"}))
        return

    req = json.loads(raw)
    pdf_paths = req.get("pdfPaths") or []
    highlight = bool(req.get("highlight", False))

    if not isinstance(pdf_paths, list) or not pdf_paths:
        sys.stdout.write(json.dumps({"ok": False, "error": "pdfPaths must be a non-empty array"}))
        return

    # Import the existing extractor functions from repo-root test.py
    # NOTE: We must avoid colliding with Python's stdlib "test" package.
    # Import repo-root test.py explicitly by file path.
    try:
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        test_path = os.path.join(repo_root, "test.py")

        spec = importlib.util.spec_from_file_location("ibanalyst_test", test_path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Could not load module spec for {test_path}")

        t = importlib.util.module_from_spec(spec)  # type: ignore
        spec.loader.exec_module(t)  # type: ignore

        # Basic sanity check to fail fast with a helpful message
        if not hasattr(t, "gemini_extract_from_pdf"):
            raise RuntimeError("Loaded test.py but gemini_extract_from_pdf is missing (unexpected).")
    except Exception as e:
        sys.stdout.write(json.dumps({"ok": False, "error": f"Failed to import repo test.py: {str(e)}"}))
        return

    years: List[Dict[str, Any]] = []
    for p in pdf_paths:
        if not isinstance(p, str):
            continue
        path = p.strip()
        if not path:
            continue
        if not os.path.exists(path):
            sys.stdout.write(json.dumps({"ok": False, "error": f"PDF not found: {path}"}))
            return

        try:
            # Debug: log locator output to stderr so server captures it
            loc = t.gemini_locate_pages(path) or {}
            sys.stderr.write(f"[DEBUG] {os.path.basename(path)} locator: {json.dumps(loc)}\n")
            sys.stderr.flush()

            extracted = t.gemini_extract_from_pdf(path)
            sys.stderr.write(f"[DEBUG] {os.path.basename(path)} extracted years: {[y.get('year_label') for y in extracted]}\n")
            sys.stderr.flush()
        except Exception as e:
            msg = str(e)
            if "SSLV3_ALERT_BAD_RECORD_MAC" in msg:
                sys.stdout.write(
                    json.dumps(
                        {
                            "ok": False,
                            "error": "Gemini network/TLS error (SSLV3_ALERT_BAD_RECORD_MAC). This is usually transient or local SSL/cert/proxy related. Try again, switch networks, or update httpx/google-genai/certifi.",
                        }
                    )
                )
                return
            sys.stdout.write(json.dumps({"ok": False, "error": f"Gemini extraction failed: {msg}"}))
            return

        # gemini_extract_from_pdf now returns a list of year objects (one per
        # fiscal year found in comparative statements).  Iterate and process each.
        for y in extracted:
            y["_sourcePdf"] = os.path.basename(path)
            y["year_label"] = t.norm_year_label(y.get("year_label"))
            t.normalize_units_in_place(y)

            # Repair pages (for highlighting + credibility)
            t.repair_sources(path, y)

            if t.needs_eps_fix(y):
                try:
                    t.apply_eps_only(path, y)
                except Exception:
                    pass

            if t.needs_networth_fix(y):
                try:
                    t.apply_networth_only(path, y)
                except Exception:
                    pass

            # PAT attributable to Owners
            try:
                attrib = t.gemini_extract_pat_attrib_owners(path)
                v = t.safe_num(attrib.get("value", 0))
                if v and t.looks_like_inr_not_crore(v):
                    attrib["value"] = v / t.CRORE_TO_INR
                if t.safe_num(attrib.get("value", 0)) > 0:
                    t.repair_single_source_page(path, "pat", attrib, fallback_val=t.safe_num(attrib.get("value", 0)))
                    y["_pat_attrib_owners"] = attrib
            except Exception:
                pass

            # Re-run repair after replacements
            t.repair_sources(path, y)

            years.append(y)

        if highlight:
            out_pdf = os.path.splitext(path)[0] + "_HIGHLIGHTED.pdf"
            try:
                # Highlight using the first year object as representative source map
                t.highlight_pdf(path, extracted[0] if extracted else {}, out_pdf)
            except Exception:
                pass

    years_deduped = dedupe_years(years)
    years_sorted = sorted(years_deduped, key=lambda yy: yy.get("year_label", ""))
    out = {
        "ok": True,
        "company": "",  # Company name detection can be added later if needed
        "currency": "Detected from document",  # Currency detection handled by extract logic
        "years": years_sorted,
        "tableText": to_table_text(years_sorted),
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()


