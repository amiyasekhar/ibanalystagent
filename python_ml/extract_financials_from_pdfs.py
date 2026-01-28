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
            y = t.gemini_extract_from_pdf(path)
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
                t.highlight_pdf(path, y, out_pdf)
            except Exception:
                pass

    years_sorted = sorted(years, key=lambda yy: yy.get("year_label", ""))
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


