import { BUYERS } from "./buyers";
import { BuyerProfile, Sector } from "./types";

export type BuyerSearchParams = {
  q?: string;
  sector?: Sector | "Any";
  geography?: string; // substring match
  type?: "Private Equity" | "Strategic" | "Any";
  tag?: string;
  minDeal?: number;
  maxDeal?: number;
  minEbitda?: number;
  maxEbitda?: number;
  limit?: number;
};

export type BuyerSearchResult = {
  id: string;
  name: string;
  type: BuyerProfile["type"];
  sectorFocus: BuyerProfile["sectorFocus"];
  geographies: BuyerProfile["geographies"];
  minDealSize: number;
  maxDealSize: number;
  minEbitda: number;
  maxEbitda: number;
  strategyTags: string[];
  score: number;
  reason: string;
};

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function tokenize(q: string): string[] {
  return (q || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function includesCI(hay: string, needle: string) {
  return hay.toLowerCase().includes(needle.toLowerCase());
}

function scoreBuyer(tokens: string[], b: BuyerProfile): { score: number; hits: string[] } {
  if (tokens.length === 0) return { score: 0, hits: [] };

  const name = b.name;
  const sectors = b.sectorFocus.join(" ");
  const geos = b.geographies.join(" ");
  const tags = b.strategyTags.join(" ");
  const type = b.type;

  const hits: string[] = [];
  let score = 0;

  for (const t of tokens) {
    let tokenScore = 0;
    if (includesCI(name, t)) tokenScore = Math.max(tokenScore, 4.0);
    if (includesCI(tags, t)) tokenScore = Math.max(tokenScore, 2.8);
    if (includesCI(sectors, t)) tokenScore = Math.max(tokenScore, 2.3);
    if (includesCI(geos, t)) tokenScore = Math.max(tokenScore, 1.7);
    if (includesCI(type, t)) tokenScore = Math.max(tokenScore, 1.2);
    if (tokenScore > 0) hits.push(t);
    score += tokenScore;
  }

  // Small boost for breadth of matches
  const uniqueHits = new Set(hits);
  score += uniqueHits.size * 0.3;

  return { score, hits: Array.from(uniqueHits) };
}

function mandateReason(b: BuyerProfile, p: BuyerSearchParams): string[] {
  const reasons: string[] = [];
  if (Number.isFinite(p.minDeal ?? NaN) || Number.isFinite(p.maxDeal ?? NaN)) {
    reasons.push(`Deal size band: ${b.minDealSize}–${b.maxDealSize}m EV`);
  }
  if (Number.isFinite(p.minEbitda ?? NaN) || Number.isFinite(p.maxEbitda ?? NaN)) {
    reasons.push(`EBITDA band: ${b.minEbitda}–${b.maxEbitda}m`);
  }
  return reasons;
}

export function searchBuyers(params: BuyerSearchParams): BuyerSearchResult[] {
  const limit = clamp(params.limit ?? 25, 1, 100);
  const q = (params.q || "").trim();
  const tokens = tokenize(q);

  const sector = params.sector && params.sector !== "Any" ? params.sector : null;
  const geo = (params.geography || "").trim();
  const type = params.type && params.type !== "Any" ? params.type : null;
  const tag = (params.tag || "").trim();

  const minDeal = Number.isFinite(params.minDeal ?? NaN) ? Number(params.minDeal) : null;
  const maxDeal = Number.isFinite(params.maxDeal ?? NaN) ? Number(params.maxDeal) : null;
  const minEbitda = Number.isFinite(params.minEbitda ?? NaN) ? Number(params.minEbitda) : null;
  const maxEbitda = Number.isFinite(params.maxEbitda ?? NaN) ? Number(params.maxEbitda) : null;

  const filtered = BUYERS.filter((b) => {
    if (sector && !b.sectorFocus.includes(sector)) return false;
    if (type && b.type !== type) return false;
    if (geo && !b.geographies.some((g) => includesCI(geo, g) || includesCI(g, geo))) return false;
    if (tag && !b.strategyTags.some((t) => includesCI(t, tag))) return false;

    // mandate-ish numeric filters (overlap)
    if (minDeal != null && b.maxDealSize < minDeal) return false;
    if (maxDeal != null && b.minDealSize > maxDeal) return false;
    if (minEbitda != null && b.maxEbitda < minEbitda) return false;
    if (maxEbitda != null && b.minEbitda > maxEbitda) return false;

    return true;
  });

  const scored = filtered
    .map((b) => {
      const { score, hits } = scoreBuyer(tokens, b);
      const bonus = (b.pastDeals || 0) / 50; // tiny prior for "active buyers"
      const finalScore = score + bonus;
      const parts: string[] = [];
      if (hits.length) parts.push(`Matched: ${hits.slice(0, 6).join(", ")}`);
      if (!hits.length && q) parts.push("No keyword hits; matched via filters");
      const m = mandateReason(b, params);
      if (m.length) parts.push(...m);
      if (b.strategyTags?.length) parts.push(`Tags: ${b.strategyTags.slice(0, 4).join(", ")}`);

      return {
        b,
        finalScore,
        reason: parts.join(" • ") || "Match based on filters and buyer profile fields.",
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore);

  // If no query and no filters, default to "most active"
  const isEmptySearch =
    !q &&
    !sector &&
    !geo &&
    !type &&
    !tag &&
    minDeal == null &&
    maxDeal == null &&
    minEbitda == null &&
    maxEbitda == null;

  const final = isEmptySearch
    ? BUYERS.slice().sort((a, b) => (b.pastDeals || 0) - (a.pastDeals || 0)).slice(0, limit).map((b) => ({
        id: b.id,
        name: b.name,
        type: b.type,
        sectorFocus: b.sectorFocus,
        geographies: b.geographies,
        minDealSize: b.minDealSize,
        maxDealSize: b.maxDealSize,
        minEbitda: b.minEbitda,
        maxEbitda: b.maxEbitda,
        strategyTags: b.strategyTags,
        score: 0,
        reason: `Default list (most active buyers) • Past deals: ${b.pastDeals}`,
      }))
    : scored.slice(0, limit).map(({ b, finalScore, reason }) => ({
        id: b.id,
        name: b.name,
        type: b.type,
        sectorFocus: b.sectorFocus,
        geographies: b.geographies,
        minDealSize: b.minDealSize,
        maxDealSize: b.maxDealSize,
        minEbitda: b.minEbitda,
        maxEbitda: b.maxEbitda,
        strategyTags: b.strategyTags,
        score: Number(finalScore.toFixed(3)),
        reason,
      }));

  return final;
}


