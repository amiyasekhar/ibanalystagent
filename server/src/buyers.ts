import fs from "node:fs";
import path from "node:path";
import { BuyerProfile } from "./types";
import { log } from "./logger";

const FALLBACK_BUYERS: BuyerProfile[] = [
  {
    id: "b1",
    name: "Summit Peak Capital",
    type: "Private Equity",
    sectorFocus: ["Software", "Business Services"],
    geographies: ["US", "Canada", "UK"],
    minEbitda: 3,
    maxEbitda: 20,
    minDealSize: 20,
    maxDealSize: 150,
    dryPowder: 500,
    pastDeals: 18,
    strategyTags: ["buy-and-build", "roll-up", "majority-stake"],
  },
];

function repoRoot() {
  return path.resolve(__dirname, "..", "..");
}

export function loadBuyers(): BuyerProfile[] {
  try {
    const filePath = path.join(repoRoot(), "server", "data", "buyers.json");
    if (!fs.existsSync(filePath)) {
      log.warn("buyers.json not found; using fallback buyer list", { filePath });
      return FALLBACK_BUYERS;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as any;
    const buyers = Array.isArray(parsed?.buyers) ? parsed.buyers : null;
    if (!buyers) {
      log.warn("buyers.json invalid; using fallback buyer list", { filePath });
      return FALLBACK_BUYERS;
    }
    // shallow sanitize
    return buyers
      .filter((b: any) => b?.id && b?.name)
      .map(
        (b: any): BuyerProfile => ({
          id: String(b.id),
          name: String(b.name),
          type: b.type === "Strategic" ? "Strategic" : "Private Equity",
          sectorFocus: Array.isArray(b.sectorFocus) ? (b.sectorFocus as any) : ["Other"],
          geographies: Array.isArray(b.geographies) ? b.geographies.map(String) : ["US"],
          minEbitda: Number(b.minEbitda) || 0,
          maxEbitda: Number(b.maxEbitda) || 0,
          minDealSize: Number(b.minDealSize) || 0,
          maxDealSize: Number(b.maxDealSize) || 0,
          dryPowder: Number(b.dryPowder) || 0,
          pastDeals: Number(b.pastDeals) || 0,
          strategyTags: Array.isArray(b.strategyTags) ? b.strategyTags.map(String) : [],
        })
      );
  } catch (e: any) {
    log.warn("Failed to load buyers.json; using fallback buyer list", { error: e?.message || String(e) });
    return FALLBACK_BUYERS;
  }
}

// Default export used throughout server
export const BUYERS: BuyerProfile[] = loadBuyers();