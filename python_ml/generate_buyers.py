#!/usr/bin/env python3
"""
Generate a synthetic but realistic-ish buyer universe.

Output: server/data/buyers.json
- Seeded + versioned so results are reproducible.
- Schema is BuyerProfile-compatible plus a few extra fields used by the outcome simulator.
"""

from __future__ import annotations

import json
import math
import os
import random
from datetime import date
from typing import Any, Dict, List


SECTORS = ["Software", "Healthcare", "Manufacturing", "Business Services", "Consumer", "Other"]
GEOS = ["US", "Canada", "UK", "Europe", "Mexico"]


def clamp01(x: float) -> float:
    if x != x or x == float("inf") or x == float("-inf"):
        return 0.0
    return max(0.0, min(1.0, x))


def lognormal(mean: float, sigma: float) -> float:
    return random.lognormvariate(math.log(max(1e-6, mean)), sigma)


def choose_sector_focus() -> List[str]:
    # 1-3 sector focus areas, skew to 1-2
    k = 1 if random.random() < 0.6 else (2 if random.random() < 0.85 else 3)
    sectors = random.sample(SECTORS[:-1], k=k)
    if random.random() < 0.12:
        sectors.append("Other")
    return list(dict.fromkeys(sectors))


def choose_geos() -> List[str]:
    # US-heavy with some cross-border
    geos = ["US"]
    if random.random() < 0.35:
        geos.append(random.choice(["Canada", "UK", "Europe", "Mexico"]))
    if random.random() < 0.12:
        geos.append(random.choice(["Canada", "UK", "Europe"]))
    return list(dict.fromkeys(geos))


def buyer_name(i: int, buyer_type: str) -> str:
    prefixes = ["Summit", "Cedar", "Northbridge", "Aurora", "Lakeshore", "Atlas", "Silver", "Evergreen", "Pioneer", "Oak"]
    suffixes_pe = ["Capital", "Partners", "Equity", "Holdings", "Growth", "Investments"]
    suffixes_strat = ["Group", "Industries", "Systems", "Holdings", "Technologies"]
    p = random.choice(prefixes)
    s = random.choice(suffixes_pe if buyer_type == "Private Equity" else suffixes_strat)
    return f"{p} {s} {i}"


def generate_buyer(i: int) -> Dict[str, Any]:
    # Type mix: mostly PE, some strategics
    buyer_type = "Private Equity" if random.random() < 0.78 else "Strategic"
    sector_focus = choose_sector_focus()
    geos = choose_geos()

    # Fund size / capacity logic
    if buyer_type == "Private Equity":
        # dry powder in $m
        dry_powder = max(75.0, lognormal(mean=450.0, sigma=0.7))
        # deal size bands scale with dry powder
        max_deal = max(30.0, min(800.0, dry_powder * (0.35 + random.random() * 0.55)))
        min_deal = max(5.0, max_deal * (0.12 + random.random() * 0.18))
        past_deals = int(clamp01(random.random() ** 0.55) * 28) + 2
        synergy_propensity = 0.25 + random.random() * 0.25
    else:
        # strategics: balance sheet, set dryPowder=0 but higher synergy propensity
        dry_powder = 0.0
        max_deal = random.choice([150.0, 250.0, 400.0, 600.0, 900.0])
        min_deal = max(25.0, max_deal * (0.08 + random.random() * 0.10))
        past_deals = int(clamp01(random.random() ** 0.6) * 22) + 3
        synergy_propensity = 0.65 + random.random() * 0.25

    # EBITDA bands correlate with deal size
    min_ebitda = max(1.0, min_deal / (12.0 + random.random() * 8.0))
    max_ebitda = max(min_ebitda + 2.0, max_deal / (6.0 + random.random() * 7.0))

    # Strategy tags
    strategy_pool = [
        "buy-and-build",
        "roll-up",
        "platform",
        "add-on",
        "majority-stake",
        "minority",
        "founder-friendly",
        "synergies",
        "vertical-integration",
        "carve-out",
        "international-expansion",
    ]
    tags = random.sample(strategy_pool, k=3 if random.random() < 0.4 else 2)
    if buyer_type == "Strategic" and "synergies" not in tags:
        tags = ["synergies"] + tags[:2]

    ownership = "Majority" if random.random() < 0.7 else "Minority"

    return {
        "id": f"syn_b{i}",
        "name": buyer_name(i, buyer_type),
        "type": buyer_type,
        "sectorFocus": sector_focus,
        "geographies": geos,
        "minEbitda": round(min_ebitda, 3),
        "maxEbitda": round(max_ebitda, 3),
        "minDealSize": round(min_deal, 3),
        "maxDealSize": round(max_deal, 3),
        "dryPowder": round(dry_powder, 3),
        "pastDeals": int(past_deals),
        "strategyTags": tags,
        # extras for simulator / future features
        "_meta": {
            "version": str(date.today()),
            "synergyPropensity": round(float(synergy_propensity), 4),
            "ownershipPreference": ownership,
        },
    }


def main() -> None:
    seed = int(os.environ.get("BUYER_SEED", os.environ.get("SYNTH_SEED", "7")))
    n = int(os.environ.get("BUYER_COUNT", "250"))
    random.seed(seed)

    buyers = [generate_buyer(i + 1) for i in range(n)]

    repo_root = os.path.dirname(os.path.dirname(__file__))
    out_path = os.path.join(repo_root, "server", "data", "buyers.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "buyerDbVersion": str(date.today()),
                "seed": seed,
                "count": n,
                "buyers": buyers,
            },
            f,
            indent=2,
        )

    print(f"Wrote {out_path} buyers={n} seed={seed}")


if __name__ == "__main__":
    main()


