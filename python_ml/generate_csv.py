#!/usr/bin/env python3
"""
Generate a synthetic training CSV with SIMULATED outcome labels (pursue/NDA/IOI).

Key requirement:
- Labels should come from a *latent simulator* (process-like), not from a deterministic rule
  on the same engineered features the model trains on.

Data model:
- Rows represent (deal, buyer) pairs.
- We output both engineered features AND outcome probabilities/stage for analysis.
"""

from __future__ import annotations

import csv
import math
import os
import random
import json
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple, Optional


SECTORS = ["Software", "Healthcare", "Manufacturing", "Business Services", "Consumer", "Other"]
GEOS = ["US", "Canada", "UK", "Europe", "Mexico"]


def clamp01(x: float) -> float:
    if x != x or x == float("inf") or x == float("-inf"):
        return 0.0
    return max(0.0, min(1.0, x))


def lognormal(mean: float, sigma: float) -> float:
    # return lognormal with approximate mean (roughly)
    return random.lognormvariate(math.log(max(1e-6, mean)), sigma)


@dataclass
class Buyer:
    buyerId: str
    type: str
    sectorFocus: List[str]
    geographies: List[str]
    minDeal: float
    maxDeal: float
    minEbitda: float
    maxEbitda: float
    dryPowder: float
    pastDeals: int
    synergyPropensity: float  # 0-1 (higher for strategics)


@dataclass
class Deal:
    dealId: str
    sector: str
    geography: str
    revenue: float
    ebitda: float
    dealSize: float


def generate_buyers(n: int) -> List[Buyer]:
    buyers: List[Buyer] = []
    for i in range(n):
        # legacy fallback when buyer DB is not provided
        sector = random.choice(SECTORS[:-1]) if random.random() < 0.92 else "Other"
        geo = random.choice(GEOS)
        buyer_type = "Private Equity" if random.random() < 0.8 else "Strategic"

        # Size bands (EV, $m)
        min_deal = random.choice([5, 10, 20, 25, 30, 50])
        max_deal = min_deal + random.choice([20, 40, 60, 100, 150, 250])

        # EBITDA bands ($m)
        min_e = random.choice([1, 2, 3, 4, 5])
        max_e = min_e + random.choice([3, 5, 8, 12, 20, 35])

        # Dry powder ($m) - PE skews higher, strategics lower/0 (we keep >0 here; infer.py handles 0 too)
        dry = max(50.0, lognormal(mean=350.0, sigma=0.6))
        past = int(clamp01(random.random() ** 0.55) * 30)

        buyers.append(
            Buyer(
                buyerId=f"syn_b{i+1}",
                type=buyer_type,
                sectorFocus=[sector],
                geographies=[geo],
                minDeal=float(min_deal),
                maxDeal=float(max_deal),
                minEbitda=float(min_e),
                maxEbitda=float(max_e),
                dryPowder=float(dry),
                pastDeals=past,
                synergyPropensity=0.75 if buyer_type == "Strategic" else 0.35,
            )
        )
    return buyers


def generate_deals(n: int) -> List[Deal]:
    deals: List[Deal] = []
    for i in range(n):
        sector = random.choice(SECTORS)
        geo = random.choice(GEOS)

        # Revenue ($m): small/mid-market skew
        revenue = max(1.0, lognormal(mean=25.0, sigma=0.8))
        margin = clamp01(random.random() * 0.35)  # 0–35%
        ebitda = max(0.0, revenue * margin)

        # EV multiple and deal size ($m)
        multiple = 4.0 + (random.random() * 10.0)  # 4x–14x (coarse)
        deal_size = max(3.0, ebitda * multiple)

        deals.append(
            Deal(
                dealId=f"syn_d{i+1}",
                sector=sector,
                geography=geo,
                revenue=float(revenue),
                ebitda=float(ebitda),
                dealSize=float(deal_size),
            )
        )
    return deals


def engineer_features(deal: Deal, buyer: Buyer) -> Dict[str, float]:
    sector_match = 1.0 if (deal.sector in buyer.sectorFocus or "Other" in buyer.sectorFocus) else 0.0
    geo_match = 1.0 if any(g in deal.geography for g in buyer.geographies) else 0.0
    size_fit = 1.0 if (deal.dealSize >= buyer.minDeal and deal.dealSize <= buyer.maxDeal) else 0.0
    ebitda_fit = 1.0 if (deal.ebitda >= buyer.minEbitda and deal.ebitda <= buyer.maxEbitda) else 0.0
    dry_fit = clamp01(buyer.dryPowder / (max(1.0, deal.dealSize) * 10.0)) if buyer.dryPowder > 0 else 0.65
    activity = clamp01(buyer.pastDeals / 20.0)
    return {
        "sectorMatch": sector_match,
        "geoMatch": geo_match,
        "sizeFit": size_fit,
        "dryPowderFit": dry_fit,
        "activityLevel": activity,
        "ebitdaFit": ebitda_fit,
    }


def sigmoid(z: float) -> float:
    if z >= 0:
        ez = math.exp(-z)
        return 1.0 / (1.0 + ez)
    ez = math.exp(z)
    return ez / (1.0 + ez)


def simulate_outcomes(deal: Deal, buyer: Buyer, features: Dict[str, float]) -> Tuple[float, float, float, str, int]:
    """
    Latent simulator:
    - We create hidden variables (dealQuality, processFriction, buyerAppetite)
    - Then simulate pPursue -> pNda -> pIoi as a simple funnel.
    - Final label is 1 if outcomeStage >= IOI (configurable later).
    """
    # latent deal quality: higher margin + reasonable size tends to convert better
    margin = (deal.ebitda / deal.revenue) if deal.revenue > 0 else 0.0
    deal_quality = clamp01(0.25 + 1.25 * margin + 0.15 * random.random())

    # process friction: random, but larger deals + cross-border can increase friction
    cross_border = 1.0 if deal.geography != "US" else 0.0
    friction = clamp01(0.15 + 0.25 * cross_border + 0.20 * clamp01(deal.dealSize / 500.0) + 0.20 * random.random())

    # buyer appetite: depends on type + activity + synergy propensity (strategics)
    appetite = clamp01(
        0.25
        + 0.35 * features["activityLevel"]
        + (0.25 * buyer.synergyPropensity if buyer.type == "Strategic" else 0.10)
        + 0.10 * random.random()
    )

    # The model features influence conversion but are not the sole determinant (latent vars + noise matter).
    hard_fit = features["sectorMatch"] + features["geoMatch"] + features["sizeFit"] + features["ebitdaFit"]
    fit_score = clamp01(hard_fit / 4.0)

    # Funnel probabilities
    p_pursue = sigmoid(
        -1.0
        + 2.0 * fit_score
        + 1.0 * features["dryPowderFit"]
        + 0.8 * appetite
        + 0.7 * deal_quality
        - 0.9 * friction
        + random.gauss(0, 0.25)
    )

    p_nda = sigmoid(
        -1.2
        + 1.6 * fit_score
        + 0.7 * appetite
        + 0.9 * deal_quality
        - 1.1 * friction
        + random.gauss(0, 0.30)
    ) * p_pursue

    p_ioi = sigmoid(
        -1.4
        + 1.8 * fit_score
        + 0.4 * features["dryPowderFit"]
        + 0.6 * appetite
        + 1.0 * deal_quality
        - 1.2 * friction
        + random.gauss(0, 0.35)
    ) * p_nda

    # simulate stage
    r = random.random()
    if r < p_ioi:
        stage = "IOI"
    elif r < p_nda:
        stage = "NDA"
    elif r < p_pursue:
        stage = "Pursue"
    else:
        stage = "No"

    label = 1 if stage == "IOI" else 0
    return float(clamp01(p_pursue)), float(clamp01(p_nda)), float(clamp01(p_ioi)), stage, int(label)


def load_buyer_db() -> Optional[List[Buyer]]:
    """
    Loads buyer DB from server/data/buyers.json if present.
    """
    try:
        repo_root = os.path.dirname(os.path.dirname(__file__))
        path_ = os.path.join(repo_root, "server", "data", "buyers.json")
        if not os.path.exists(path_):
            return None
        with open(path_, "r", encoding="utf-8") as f:
            payload = json.load(f)
        buyers_raw = payload.get("buyers") if isinstance(payload, dict) else None
        if not isinstance(buyers_raw, list):
            return None
        out: List[Buyer] = []
        for b in buyers_raw:
            if not isinstance(b, dict):
                continue
            meta = b.get("_meta") if isinstance(b.get("_meta"), dict) else {}
            out.append(
                Buyer(
                    buyerId=str(b.get("id", "")),
                    type=str(b.get("type", "Private Equity")),
                    sectorFocus=list(b.get("sectorFocus") or ["Other"]),
                    geographies=list(b.get("geographies") or ["US"]),
                    minDeal=float(b.get("minDealSize") or 0),
                    maxDeal=float(b.get("maxDealSize") or 0),
                    minEbitda=float(b.get("minEbitda") or 0),
                    maxEbitda=float(b.get("maxEbitda") or 0),
                    dryPowder=float(b.get("dryPowder") or 0),
                    pastDeals=int(b.get("pastDeals") or 0),
                    synergyPropensity=float(meta.get("synergyPropensity") or (0.75 if str(b.get("type")) == "Strategic" else 0.35)),
                )
            )
        return out if out else None
    except Exception:
        return None


def write_csv(path: str, rows: List[Dict[str, object]]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not rows:
        raise ValueError("No rows to write")
    fieldnames = list(rows[0].keys())
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    seed = int(os.environ.get("SYNTH_SEED", "7"))
    random.seed(seed)

    num_deals = int(os.environ.get("SYNTH_DEALS", "350"))
    pairs_per_deal = int(os.environ.get("SYNTH_PAIRS_PER_DEAL", "25"))

    buyers = load_buyer_db() or generate_buyers(int(os.environ.get("SYNTH_BUYERS", "120")))
    deals = generate_deals(num_deals)

    out_rows: List[Dict[str, object]] = []
    for d in deals:
        # sample buyers per deal to keep file size reasonable
        sampled = random.sample(buyers, k=min(pairs_per_deal, len(buyers)))
        for b in sampled:
            f = engineer_features(d, b)
            p_pursue, p_nda, p_ioi, stage, y = simulate_outcomes(d, b, f)
            out_rows.append(
                {
                    "dealId": d.dealId,
                    "buyerId": b.buyerId,
                    "dealSector": d.sector,
                    "dealGeography": d.geography,
                    "dealRevenue": round(d.revenue, 4),
                    "dealEbitda": round(d.ebitda, 4),
                    "dealSize": round(d.dealSize, 4),
                    "buyerType": b.type,
                    "buyerSectorFocus": "|".join(b.sectorFocus),
                    "buyerGeographies": "|".join(b.geographies),
                    "buyerMinDeal": b.minDeal,
                    "buyerMaxDeal": b.maxDeal,
                    "buyerMinEbitda": b.minEbitda,
                    "buyerMaxEbitda": b.maxEbitda,
                    "buyerDryPowder": round(b.dryPowder, 4),
                    "buyerPastDeals": b.pastDeals,
                    "buyerSynergyPropensity": round(float(b.synergyPropensity), 6),
                    # engineered
                    "sectorMatch": int(f["sectorMatch"]),
                    "geoMatch": int(f["geoMatch"]),
                    "sizeFit": int(f["sizeFit"]),
                    "dryPowderFit": round(float(f["dryPowderFit"]), 6),
                    "activityLevel": round(float(f["activityLevel"]), 6),
                    "ebitdaFit": int(f["ebitdaFit"]),
                    # outcomes
                    "pPursue": round(float(p_pursue), 6),
                    "pNda": round(float(p_nda), 6),
                    "pIoi": round(float(p_ioi), 6),
                    "outcomeStage": stage,
                    "label": int(y),
                }
            )

    out_path = os.path.join(os.path.dirname(__file__), "data", "training_data.csv")
    write_csv(out_path, out_rows)
    print(f"Wrote {out_path} rows={len(out_rows)} seed={seed}")


if __name__ == "__main__":
    main()


