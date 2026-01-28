import { Sector } from "./types";

export function normalizeSector(input: string): Sector {
  const s = (input || "").trim().toLowerCase();
  if (!s) return "Other";

  // Exact match first (preserves new Indian sector labels)
  const exactMap: Record<string, Sector> = {
    "it / saas": "IT / SaaS",
    "it/saas": "IT / SaaS",
    "fintech": "Fintech",
    "fin-tech": "Fintech",
    "healthcare": "Healthcare",
    "pharma": "Pharma",
    "pharmaceutical": "Pharma",
    "pharmaceuticals": "Pharma",
    "bfsi": "BFSI",
    "banking": "BFSI",
    "insurance": "BFSI",
    "manufacturing": "Manufacturing",
    "industrial": "Manufacturing",
    "business services": "Business Services",
    "consumer": "Consumer",
    "d2c / brands": "D2C / Brands",
    "d2c": "D2C / Brands",
    "dtc": "D2C / Brands",
    "logistics": "Logistics",
    "supply chain": "Logistics",
    "agritech": "Agritech",
    "agriculture": "Agritech",
    "edtech": "EdTech",
    "education": "EdTech",
    "energy / cleantech": "Energy / Cleantech",
    "cleantech": "Energy / Cleantech",
    "energy": "Energy / Cleantech",
    "auto / ev": "Auto / EV",
    "automotive": "Auto / EV",
    "ev": "Auto / EV",
    "electric vehicle": "Auto / EV",
    "real estate": "Real Estate",
    "proptech": "Real Estate",
    "infrastructure": "Infrastructure",
    "media / entertainment": "Media / Entertainment",
    "media": "Media / Entertainment",
    "entertainment": "Media / Entertainment",
    "telecom": "Telecom",
    "telecommunications": "Telecom",
    "software": "Software",
  };

  if (exactMap[s]) return exactMap[s];

  // Fuzzy match via includes
  if (s.includes("saas") || s.includes("vertical software")) return "IT / SaaS";
  if (s.includes("fintech") || s.includes("fin tech") || s.includes("financial tech")) return "Fintech";
  if (s.includes("health")) return "Healthcare";
  if (s.includes("pharma")) return "Pharma";
  if (s.includes("bfsi") || s.includes("banking") || s.includes("insurance")) return "BFSI";
  if (s.includes("manufactur") || s.includes("industrial")) return "Manufacturing";
  if (s.includes("business service") || s.includes("b2b service")) return "Business Services";
  if (s.includes("consumer") || s.includes("retail") || s.includes("d2c") || s.includes("dtc")) return "Consumer";
  if (s.includes("logistic") || s.includes("supply chain")) return "Logistics";
  if (s.includes("agri")) return "Agritech";
  if (s.includes("edtech") || s.includes("ed-tech") || s.includes("education tech")) return "EdTech";
  if (s.includes("cleantech") || s.includes("clean tech") || s.includes("energy")) return "Energy / Cleantech";
  if (s.includes("auto") || s.includes("electric vehicle") || s.includes(" ev")) return "Auto / EV";
  if (s.includes("real estate") || s.includes("proptech")) return "Real Estate";
  if (s.includes("media") || s.includes("entertainment")) return "Media / Entertainment";
  if (s.includes("telecom")) return "Telecom";
  return "Other";
}

export function normalizeGeography(input: string): string {
  return (input || "").trim();
}

export function num(input: unknown, fallback = 0): number {
  const n = typeof input === "number" ? input : Number(input);
  return Number.isFinite(n) ? n : fallback;
}


