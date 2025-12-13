#!/usr/bin/env python3
"""
Inference for buyer matching.

Reads JSON from stdin:
{
  "deal": { ... },
  "buyers": [ ... ]
}

Outputs JSON to stdout:
{
  "modelVersion": "...",
  "scores": [
     { "buyerId": "...", "score": 0.0-1.0, "features": { ... } }
  ]
}
"""

from __future__ import annotations

import json
import math
import os
import sys
from typing import Any, Dict, List, Tuple, Optional


def sigmoid(z: float) -> float:
    if z >= 0:
        ez = math.exp(-z)
        return 1.0 / (1.0 + ez)
    else:
        ez = math.exp(z)
        return ez / (1.0 + ez)


def clamp01(x: float) -> float:
    if x != x or x == float("inf") or x == float("-inf"):
        return 0.0
    if x < 0:
        return 0.0
    if x > 1:
        return 1.0
    return x


def normalize_sector(s: str) -> str:
    return (s or "").strip().lower()


def normalize_geo(s: str) -> str:
    return (s or "").strip().lower()


def engineer_features(deal: Dict[str, Any], buyer: Dict[str, Any]) -> Dict[str, float]:
    """
    Minimal feature engineering + preprocessing.
    """
    sector = normalize_sector(str(deal.get("sector", "")))
    geo = normalize_geo(str(deal.get("geography", "")))
    deal_size = float(deal.get("dealSize", 0) or 0)
    ebitda = float(deal.get("ebitda", 0) or 0)

    sector_focus = [normalize_sector(str(x)) for x in (buyer.get("sectorFocus") or [])]
    buyer_geos = [normalize_geo(str(x)) for x in (buyer.get("geographies") or [])]

    sector_match = 1.0 if sector and sector in sector_focus else 0.0
    geo_match = 1.0 if any(g and g in geo for g in buyer_geos) else 0.0

    min_deal = float(buyer.get("minDealSize", 0) or 0)
    max_deal = float(buyer.get("maxDealSize", 0) or 0)
    size_fit = 1.0 if (deal_size >= min_deal and (max_deal <= 0 or deal_size <= max_deal)) else 0.0

    min_ebitda = float(buyer.get("minEbitda", 0) or 0)
    max_ebitda = float(buyer.get("maxEbitda", 0) or 0)
    ebitda_fit = 1.0 if (ebitda >= min_ebitda and (max_ebitda <= 0 or ebitda <= max_ebitda)) else 0.0

    dry_powder = float(buyer.get("dryPowder", 0) or 0)
    # proxy: 10x EV check capacity is "full" fit
    dry_powder_fit = clamp01(dry_powder / (max(1.0, deal_size) * 10.0)) if dry_powder > 0 else 0.65

    past_deals = float(buyer.get("pastDeals", 0) or 0)
    activity_level = clamp01(past_deals / 20.0)

    return {
        "sectorMatch": sector_match,
        "geoMatch": geo_match,
        "sizeFit": size_fit,
        "dryPowderFit": dry_powder_fit,
        "activityLevel": activity_level,
        "ebitdaFit": ebitda_fit,
    }


def load_metadata() -> Tuple[str, List[str]]:
    meta_path = os.path.join(os.path.dirname(__file__), "artifacts", "metadata.json")
    if not os.path.exists(meta_path):
        return "unknown", ["sectorMatch", "geoMatch", "sizeFit", "dryPowderFit", "activityLevel", "ebitdaFit"]
    with open(meta_path, "r", encoding="utf-8") as f:
        payload = json.load(f)
    return str(payload.get("modelVersion", "unknown")), list(payload.get("featureNames") or [])


def try_load_sklearn_model() -> Optional[object]:
    """
    Returns a loaded sklearn model if deps + artifact exist, else None.
    """
    model_path = os.path.join(os.path.dirname(__file__), "artifacts", "model.joblib")
    if not os.path.exists(model_path):
        return None
    try:
        from joblib import load  # type: ignore
    except Exception:
        return None
    return load(model_path)


def load_legacy_weights() -> Tuple[List[float], float, str, List[str]]:
    path = os.path.join(os.path.dirname(__file__), "artifacts", "model.json")
    if not os.path.exists(path):
        raise FileNotFoundError(f"Model not found at {path}. Run: python3 python_ml/train.py")

    with open(path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    weights = payload.get("weights")
    bias = payload.get("bias")
    model_version = payload.get("modelVersion", "unknown")
    feature_names = payload.get("featureNames") or []

    if not isinstance(weights, list) or not isinstance(bias, (int, float)):
        raise ValueError("Invalid model.json (missing weights/bias)")

    return [float(w) for w in weights], float(bias), str(model_version), [str(x) for x in feature_names]


def score_with_model(weights: List[float], bias: float, features: Dict[str, float], feature_names: List[str]) -> float:
    x = [float(features.get(name, 0.0)) for name in feature_names]
    z = sum(w * xi for w, xi in zip(weights, x)) + bias
    return sigmoid(z)


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("No stdin JSON provided")

    inp = json.loads(raw)
    deal = inp.get("deal") or {}
    buyers = inp.get("buyers") or []
    if not isinstance(deal, dict) or not isinstance(buyers, list):
        raise ValueError("Invalid input JSON shape")

    model_version, feature_names = load_metadata()
    sklearn_model = try_load_sklearn_model()
    legacy: Optional[Tuple[List[float], float, str, List[str]]] = None
    if sklearn_model is None:
        legacy = load_legacy_weights()
        model_version = legacy[2]
        feature_names = legacy[3]

    out_scores: List[Dict[str, Any]] = []
    for b in buyers:
        if not isinstance(b, dict):
            continue
        buyer_id = str(b.get("id", ""))
        feats = engineer_features(deal, b)
        if sklearn_model is not None:
            # build a single-row feature array in the correct order
            x = [[float(feats.get(name, 0.0)) for name in feature_names]]
            try:
                p = float(sklearn_model.predict_proba(x)[0][1])
            except Exception:
                # if something goes wrong, fall back to legacy if available
                if legacy is None:
                    raise
                p = score_with_model(legacy[0], legacy[1], feats, feature_names)
        else:
            assert legacy is not None
            p = score_with_model(legacy[0], legacy[1], feats, feature_names)
        out_scores.append(
            {
                "buyerId": buyer_id,
                "score": float(clamp01(p)),
                "features": feats,
            }
        )

    sys.stdout.write(
        json.dumps(
            {"modelVersion": model_version, "scores": out_scores},
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()


