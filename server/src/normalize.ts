import { Sector } from "./types";

export function normalizeSector(input: string): Sector {
  const s = (input || "").trim().toLowerCase();
  if (!s) return "Other";

  if (s === "software" || s.includes("saas") || s.includes("vertical software")) return "Software";
  if (s === "healthcare" || s.includes("health")) return "Healthcare";
  if (s === "manufacturing" || s === "industrial" || s.includes("industrial")) return "Manufacturing";
  if (s === "business services" || s.includes("business service") || s.includes("b2b services")) return "Business Services";
  if (s === "consumer" || s.includes("consumer") || s.includes("retail") || s.includes("d2c") || s.includes("dtc"))
    return "Consumer";
  return "Other";
}

export function normalizeGeography(input: string): string {
  return (input || "").trim();
}

export function num(input: unknown, fallback = 0): number {
  const n = typeof input === "number" ? input : Number(input);
  return Number.isFinite(n) ? n : fallback;
}


