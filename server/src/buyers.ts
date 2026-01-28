import fs from "node:fs";
import path from "node:path";
import { BuyerProfile, BuyerType } from "./types";
import { log } from "./logger";

const FALLBACK_BUYERS: BuyerProfile[] = [
  {
    id: "b1",
    name: "ChrysCapital",
    type: "Private Equity",
    sectorFocus: ["BFSI", "Business Services", "Consumer"],
    geographies: ["Pan-India", "Mumbai", "Delhi NCR"],
    minEbitda: 100_000_000,      // ₹10Cr
    maxEbitda: 2_000_000_000,    // ₹200Cr
    minDealSize: 1_000_000_000,  // ₹100Cr
    maxDealSize: 8_000_000_000,  // ₹800Cr
    dryPowder: 30_000_000_000,   // ₹3000Cr
    pastDeals: 55,
    strategyTags: ["buyout", "growth-equity", "PIPE"],
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
          type: (["Strategic", "Private Equity", "Family Office", "Growth Equity"].includes(b.type) ? b.type : "Private Equity") as BuyerType,
          sectorFocus: Array.isArray(b.sectorFocus) ? (b.sectorFocus as any) : ["Other"],
          geographies: Array.isArray(b.geographies) ? b.geographies.map(String) : ["Pan-India"],
          minEbitda: Number(b.minEbitda) || 0,
          maxEbitda: Number(b.maxEbitda) || 0,
          minDealSize: Number(b.minDealSize) || 0,
          maxDealSize: Number(b.maxDealSize) || 0,
          dryPowder: Number(b.dryPowder) || 0,
          pastDeals: Number(b.pastDeals) || 0,
          strategyTags: Array.isArray(b.strategyTags) ? b.strategyTags.map(String) : [],
          investmentStage: Array.isArray(b.investmentStage) ? b.investmentStage : undefined,
          investmentThesis: typeof b.investmentThesis === "string" ? b.investmentThesis : undefined,
          portfolioCompanies: Array.isArray(b.portfolioCompanies) ? b.portfolioCompanies.map(String) : undefined,
          reputation: Array.isArray(b.reputation) ? b.reputation.map(String) : undefined,
          keyPartners: Array.isArray(b.keyPartners) ? b.keyPartners.map(String) : undefined,
          valueAdd: Array.isArray(b.valueAdd) ? b.valueAdd.map(String) : undefined,
        })
      );
  } catch (e: any) {
    log.warn("Failed to load buyers.json; using fallback buyer list", { error: e?.message || String(e) });
    return FALLBACK_BUYERS;
  }
}

// Default export used throughout server
export const BUYERS: BuyerProfile[] = loadBuyers();