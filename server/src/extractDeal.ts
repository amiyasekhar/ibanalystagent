import { z } from "zod";
import { claudeJson } from "./claude";
import { DealInput } from "./types";
import { normalizeGeography, normalizeSector, num } from "./normalize";
import { validateUnsupportedClaims } from "./llmValidation";
import { log } from "./logger";

const ExtractRequestSchema = z.object({
  rawText: z.string().min(1),
});

export type ExtractDealRequest = z.infer<typeof ExtractRequestSchema>;

const ExtractedDealSchema = z
  .object({
    name: z.string(),
    sector: z.string(),
    geography: z.string(),
    revenue: z.union([z.number(), z.string()]),
    ebitda: z.union([z.number(), z.string()]),
    dealSize: z.union([z.number(), z.string()]),
    description: z.string(),
  })
  .strict();

function hasExplicitSectorHint(rawText: string, sector: string): boolean {
  const t = rawText.toLowerCase();
  const s = sector.toLowerCase();
  if (s === "software" || s === "it / saas") return t.includes("software") || t.includes("saas") || t.includes("it /");
  if (s === "fintech") return t.includes("fintech") || t.includes("fin tech") || t.includes("financial tech");
  if (s === "healthcare") return t.includes("health") || t.includes("med") || t.includes("clinic");
  if (s === "pharma") return t.includes("pharma") || t.includes("pharmaceutical");
  if (s === "bfsi") return t.includes("bfsi") || t.includes("banking") || t.includes("insurance");
  if (s === "manufacturing") return t.includes("manufactur") || t.includes("industrial") || t.includes("factory");
  if (s === "business services") return t.includes("business services") || t.includes("outsourc") || t.includes("services");
  if (s === "consumer") return t.includes("consumer") || t.includes("retail") || t.includes("e-commerce") || t.includes("d2c");
  if (s === "d2c / brands") return t.includes("d2c") || t.includes("dtc") || t.includes("direct to consumer");
  if (s === "logistics") return t.includes("logistic") || t.includes("supply chain");
  if (s === "agritech") return t.includes("agri");
  if (s === "edtech") return t.includes("edtech") || t.includes("ed-tech") || t.includes("education");
  if (s === "energy / cleantech") return t.includes("energy") || t.includes("cleantech");
  if (s === "auto / ev") return t.includes("auto") || t.includes("electric vehicle");
  if (s === "real estate") return t.includes("real estate") || t.includes("proptech");
  if (s === "telecom") return t.includes("telecom");
  return true;
}

function inferGeographyIfExplicit(rawText: string): string {
  const t = rawText.toLowerCase();
  // Indian cities first (most specific)
  if (t.includes("mumbai")) return "Mumbai";
  if (t.includes("delhi") || t.includes("ncr")) return "Delhi NCR";
  if (t.includes("bangalore") || t.includes("bengaluru")) return "Bangalore";
  if (t.includes("hyderabad")) return "Hyderabad";
  if (t.includes("pune")) return "Pune";
  if (t.includes("chennai")) return "Chennai";
  if (t.includes("kolkata")) return "Kolkata";
  if (t.includes("india") || t.includes("pan-india")) return "India";
  // International
  if (t.includes("united states") || t.includes("u.s.") || /\busa\b/.test(t) || /\bu\.s\.\b/.test(t)) return "US";
  if (t.includes("united kingdom") || /\buk\b/.test(t)) return "UK";
  if (t.includes("canada")) return "Canada";
  if (t.includes("europe") || t.includes("emea")) return "Europe";
  return "";
}

function numberMentioned(rawText: string, value: number): boolean {
  if (!Number.isFinite(value) || value <= 0) return true;
  const t = rawText.toLowerCase();
  const tNoCommas = t.replace(/,/g, "");
  const variants = new Set<string>();
  const v1 = value.toFixed(1).replace(/\.0$/, "");
  variants.add(String(value));
  variants.add(v1);
  variants.add(String(Math.round(value)));
  for (const v of variants) {
    const vv = v.replace(/,/g, "");
    // allow "980,136", "980136", "$18.5m", "₹98,000 crores", "70mm", etc
    const re = new RegExp(`\\b[₹$€£]?\\s*${vv.replace(".", "\\.")}\\s*(m|mm|million|crore|cr|bn|billion)?\\b`, "i");
    if (re.test(tNoCommas)) return true;
  }
  return false;
}

type ProvidedScale = "m" | "crore" | "b" | "t" | "k" | "unit";
type ProvidedMetrics = {
  currency: string;
  scale: ProvidedScale;
  revenue?: number;
  ebitda?: number;
  dealSize?: number;
  uncertainties?: {
    revenue?: string;
    ebitda?: string;
    dealSize?: string;
  };
};

function detectCurrencyScale(rawText: string): { currency: string; scale: ProvidedScale } {
  const t = rawText.toLowerCase();
  // currency detection (INR default for Indian context)
  let currency = "INR";
  if (t.includes("usd") || t.includes("us$") || (t.includes("$") && !t.includes("₹"))) currency = "USD";
  if (t.includes("₹") || t.includes("inr") || t.includes("crore") || t.includes("lakh")) currency = "INR";

  // scale - check for number-suffix patterns like "$26.9B" or standalone words
  let scale: ProvidedScale = "m";
  if (t.includes("billion") || /\bbn\b/.test(t) || /\d+\.?\d*\s*b\b/i.test(rawText)) scale = "b";
  else if (t.includes("million") || /\bmm\b/.test(t) || /\d+\.?\d*\s*m\b/i.test(rawText)) scale = "m";
  else if (t.includes("thousand") || /\d+\.?\d*\s*k\b/i.test(rawText)) scale = "k";
  return { currency, scale };
}

function hasCurrencyMarker(textSnippet: string): boolean {
  // Check if the text snippet has a USD currency marker (symbol or code)
  const t = textSnippet.toLowerCase();
  return /[\$]|usd|us\$/.test(t);
}

function looksLikeRange(textSnippet: string): boolean {
  // Detect patterns like "$50-100M", "$50M-$100M", "$50M to $100M", "between $50M and $100M"
  const rangePatterns = [
    /\$?\s*\d+[\d,\.]*\s*[-–—]\s*\d+[\d,\.]*\s*[bmk]/i,  // "$50-100M" or "50-100M"
    /\$\s*\d+[\d,\.]*\s*[bmk]\s*[-–—to]\s*\$?\s*\d+[\d,\.]*\s*[bmk]/i,  // "$50M-$100M" or "$50M to $100M"
    /between\s+\$?\s*\d+[\d,\.]*\s*[bmk]?\s+and\s+\$?\s*\d+[\d,\.]*\s*[bmk]/i,  // "between $50M and $100M"
  ];
  return rangePatterns.some(pattern => pattern.test(textSnippet));
}

function scaleMultiplier(scale: ProvidedScale): number {
  if (scale === "unit") return 1; // Already in full units
  if (scale === "k") return 1_000;
  if (scale === "m") return 1_000_000;
  if (scale === "b") return 1_000_000_000;
  if (scale === "t") return 1_000_000_000_000;
  // crore
  return 10_000_000;
}

// NOTE: We are intentionally NOT converting currencies right now (nominal values only).

function parseMetricWithScale(rawText: string, key: "Revenue" | "EBITDA" | "EV" | "Deal Size" | "Enterprise Value"): { value: number; scale: ProvidedScale; uncertainty?: string } | null {
  // First, try to parse pipe-delimited table format (from PDF extraction)
  // Format: year_label | revenue | ebitda | pat | eps | networth | total_assets
  // These values have NO scale suffix, so they're in full units
  const lines = rawText.split("\n");
  const headerLine = lines.find(l => l.includes("year_label") && l.includes("revenue") && l.includes("ebitda"));

  if (headerLine) {
    const headers = headerLine.split("|").map(h => h.trim().toLowerCase());
    const revenueIdx = headers.indexOf("revenue");
    const ebitdaIdx = headers.indexOf("ebitda");

    // Find all data rows (skip header and divider lines)
    const dataRows = lines
      .filter(l => l.includes("|") && !l.includes("year_label") && !l.match(/^-+$/))
      .map(l => l.split("|").map(cell => cell.trim()));

    if (dataRows.length > 0) {
      // Get the last row (most recent year)
      const lastRow = dataRows[dataRows.length - 1];

      if (key === "Revenue" && revenueIdx >= 0 && lastRow[revenueIdx]) {
        const val = Number(lastRow[revenueIdx].replace(/,/g, ""));
        if (val > 0) return { value: val, scale: "unit" }; // Table values are already in full units
      }
      if (key === "EBITDA" && ebitdaIdx >= 0 && lastRow[ebitdaIdx]) {
        const val = Number(lastRow[ebitdaIdx].replace(/,/g, ""));
        if (val > 0) return { value: val, scale: "unit" };
      }
    }
  }

  // Check for ranges - if detected, flag as uncertain
  const keyLower = key.toLowerCase();
  const searchWindow = 150; // characters around the keyword to check for ranges
  const keyIndex = rawText.toLowerCase().indexOf(keyLower);
  if (keyIndex >= 0) {
    const start = Math.max(0, keyIndex - 50);
    const end = Math.min(rawText.length, keyIndex + searchWindow);
    const snippet = rawText.substring(start, end);
    if (looksLikeRange(snippet)) {
      // Extract the range text to show user
      const rangeMatch = snippet.match(/\$?\s*\d+[\d,\.]*\s*(?:[-–—]|to)\s*\$?\s*\d+[\d,\.]*\s*[BMKbmkTt]*/);
      const rangeText = rangeMatch ? rangeMatch[0].trim() : "a range";
      return {
        value: 0,
        scale: "unit",
        uncertainty: `Range detected (${rangeText}). Please specify the exact ${key.toLowerCase()} value.`
      };
    }
  }

  // Extract from narrative text with scale suffixes
  // Pattern captures: (currency symbol)(number)(scale suffix)
  const matches: Array<{ value: number; scale: ProvidedScale; fullMatch: string }> = [];

  if (key === "Revenue") {
    // Match: "revenue ... $100B" or "revenue ... USD 100 billion"
    const pattern = /revenue[^\d\n]{0,50}?([\$]|usd|us\$)?\s*([\d,.]+)\s*(k|t|tn|b|bn|m|mm|mn|thousand|million|billion|trillion)?/gi;
    let match;
    while ((match = pattern.exec(rawText)) !== null) {
      const currencyMarker = match[1] || "";
      const val = Number(match[2].replace(/,/g, ""));
      const suffix = (match[3] || "").toLowerCase();
      const fullMatch = match[0];

      let scale: ProvidedScale = "unit";
      if (suffix === "t" || suffix === "tn" || suffix === "trillion") scale = "t";
      else if (suffix === "b" || suffix === "bn" || suffix === "billion") scale = "b";
      else if (suffix === "m" || suffix === "mm" || suffix === "mn" || suffix === "million") scale = "m";
      else if (suffix === "k" || suffix === "thousand") {
        // Only allow "k" if there's a currency marker
        if (hasCurrencyMarker(fullMatch)) {
          scale = "k";
        } else {
          continue; // Skip this match - "k" without currency
        }
      }
      if (val > 0) matches.push({ value: val, scale, fullMatch });
    }
  }
  if (key === "EBITDA") {
    const pattern = /ebitda[^\d\n]{0,50}?([\$]|usd|us\$)?\s*([\d,.]+)\s*(k|t|tn|b|bn|m|mm|mn|thousand|million|billion|trillion)?/gi;
    let match;
    while ((match = pattern.exec(rawText)) !== null) {
      const currencyMarker = match[1] || "";
      const val = Number(match[2].replace(/,/g, ""));
      const suffix = (match[3] || "").toLowerCase();
      const fullMatch = match[0];

      let scale: ProvidedScale = "unit";
      if (suffix === "t" || suffix === "tn" || suffix === "trillion") scale = "t";
      else if (suffix === "b" || suffix === "bn" || suffix === "billion") scale = "b";
      else if (suffix === "m" || suffix === "mm" || suffix === "mn" || suffix === "million") scale = "m";
      else if (suffix === "k" || suffix === "thousand") {
        if (hasCurrencyMarker(fullMatch)) {
          scale = "k";
        } else {
          continue;
        }
      }
      if (val > 0) matches.push({ value: val, scale, fullMatch });
    }
  }
  if (key === "EV" || key === "Deal Size" || key === "Enterprise Value") {
    // Only match when there's an explicit EV/valuation/deal size keyword to avoid false positives from revenue
    const pattern = /(ev|enterprise value|deal size|valuation|implied enterprise value|implied valuation)[^\d\n]{0,80}?([\$]|usd|us\$)?\s*([\d,.]+)\s*(k|t|tn|b|bn|m|mm|mn|thousand|million|billion|trillion)?/gi;
    let match;
    while ((match = pattern.exec(rawText)) !== null) {
      const currencyMarker = match[2] || "";
      const val = Number(match[3].replace(/,/g, ""));
      const suffix = (match[4] || "").toLowerCase();
      const fullMatch = match[0];

      let scale: ProvidedScale = "unit";
      if (suffix === "t" || suffix === "tn" || suffix === "trillion") scale = "t";
      else if (suffix === "b" || suffix === "bn" || suffix === "billion") scale = "b";
      else if (suffix === "m" || suffix === "mm" || suffix === "mn" || suffix === "million") scale = "m";
      else if (suffix === "k" || suffix === "thousand") {
        if (hasCurrencyMarker(fullMatch)) {
          scale = "k";
        } else {
          continue;
        }
      }
      if (val > 0) matches.push({ value: val, scale, fullMatch });
    }
  }

  // Return the match with the highest SCALED value (i.e., actual value in full units)
  if (matches.length > 0) {
    return matches.reduce((best, curr) => {
      const bestFull = best.value * scaleMultiplier(best.scale);
      const currFull = curr.value * scaleMultiplier(curr.scale);
      return currFull > bestFull ? curr : best;
    });
  }

  return null;
}

function extractProvidedMetrics(rawText: string): ProvidedMetrics {
  const { currency } = detectCurrencyScale(rawText);

  const revenueData = parseMetricWithScale(rawText, "Revenue");
  const ebitdaData = parseMetricWithScale(rawText, "EBITDA");
  const dealSizeData =
    parseMetricWithScale(rawText, "EV") ??
    parseMetricWithScale(rawText, "Deal Size") ??
    parseMetricWithScale(rawText, "Enterprise Value");

  // Apply scale multiplier to get full units
  const revenue = revenueData ? revenueData.value * scaleMultiplier(revenueData.scale) : undefined;
  const ebitda = ebitdaData ? ebitdaData.value * scaleMultiplier(ebitdaData.scale) : undefined;
  const dealSize = dealSizeData ? dealSizeData.value * scaleMultiplier(dealSizeData.scale) : undefined;

  // Collect uncertainties
  const uncertainties: { revenue?: string; ebitda?: string; dealSize?: string } = {};
  if (revenueData?.uncertainty) uncertainties.revenue = revenueData.uncertainty;
  if (ebitdaData?.uncertainty) uncertainties.ebitda = ebitdaData.uncertainty;
  if (dealSizeData?.uncertainty) uncertainties.dealSize = dealSizeData.uncertainty;

  // Determine overall scale based on what we found (use "unit" since we already scaled everything)
  const scale: ProvidedScale = "unit";

  return {
    currency,
    scale,
    revenue: revenue != null && Number.isFinite(revenue) && revenue > 0 ? revenue : undefined,
    ebitda: ebitda != null && Number.isFinite(ebitda) && ebitda > 0 ? ebitda : undefined,
    dealSize: dealSize != null && Number.isFinite(dealSize) && dealSize > 0 ? dealSize : undefined,
    uncertainties: Object.keys(uncertainties).length > 0 ? uncertainties : undefined,
  };
}

function sanitizeExtractedDeal(rawText: string, d: any): DealInput {
  const name = cleanDealName(rawText, String(d?.name || ""));
  const provided = extractProvidedMetrics(rawText);

  // extractProvidedMetrics already returns values in full units, so use them directly
  const revenueProvided = provided.revenue ?? num(d?.revenue, 0);
  const ebitdaProvided = provided.ebitda ?? num(d?.ebitda, 0);
  const dealSizeProvided = provided.dealSize ?? num(d?.dealSize, 0);

  // Enforce: numbers must be present in rawText, else zero them
  const safeRevenueProvided = numberMentioned(rawText, revenueProvided) ? revenueProvided : 0;
  const safeEbitdaProvided = numberMentioned(rawText, ebitdaProvided) ? ebitdaProvided : 0;

  // Deal size validation: must be mentioned AND must not equal revenue or EBITDA (prevents confusion)
  const dealSizeMentioned = numberMentioned(rawText, dealSizeProvided);
  const dealSizeIsRevenueOrEbitda =
    (dealSizeProvided > 0 && dealSizeProvided === revenueProvided) ||
    (dealSizeProvided > 0 && dealSizeProvided === ebitdaProvided);

  // Additional check: ensure the deal size appears near EV-related keywords
  let dealSizeHasEvContext = false;
  if (dealSizeProvided > 0) {
    const t = rawText.toLowerCase();
    const val = dealSizeProvided / 1_000_000; // Convert to millions
    const valStr = val.toFixed(1).replace(/\.0$/, "");
    const fullValStr = dealSizeProvided.toString();

    // Pattern 1: "EV $70M" or "EV ($m): 70"
    const evPatternAbbrev = new RegExp(`(\\bev\\b|enterprise value|deal size|valuation|implied.*value)[^\\d]{0,80}?\\$?\\s*${valStr.replace('.', '\\.')}`, "i");
    // Pattern 2: "EV ($m): 70000000" (structured format)
    const evPatternFull = new RegExp(`(\\bev\\b|enterprise value|deal size|valuation)\\s*\\([^)]*\\)[^\\d]{0,20}?${fullValStr}`, "i");

    dealSizeHasEvContext = evPatternAbbrev.test(t) || evPatternFull.test(t);

    log.info("[ExtractDeal] Deal size EV context check", {
      dealSizeProvided,
      valStr,
      fullValStr,
      hasEvContext: dealSizeHasEvContext,
      patternAbbrev: evPatternAbbrev.toString(),
      patternFull: evPatternFull.toString()
    });
  }

  const safeDealSizeProvided = dealSizeMentioned && !dealSizeIsRevenueOrEbitda && dealSizeHasEvContext ? dealSizeProvided : 0;

  // Enforce: sector/geo are inference-prone. Only set if explicitly supported.
  const sectorRaw = String(d?.sector || "Other");
  const sector = hasExplicitSectorHint(rawText, sectorRaw) ? normalizeSector(sectorRaw) : "Other";
  const geoExplicit = inferGeographyIfExplicit(rawText);
  const geography = geoExplicit ? normalizeGeography(geoExplicit) : "";

  return {
    name,
    sector,
    geography,
    // Already in full units (no additional scaling needed)
    revenue: safeRevenueProvided,
    ebitda: safeEbitdaProvided,
    dealSize: safeDealSizeProvided,
    description: String(d?.description || rawText).slice(0, 1200),
    provided: {
      currency: provided.currency,
      scale: "unit",
      revenue: safeRevenueProvided || undefined,
      ebitda: safeEbitdaProvided || undefined,
      dealSize: safeDealSizeProvided || undefined,
    },
    uncertainties: provided.uncertainties,
  };
}

function cleanDealName(rawText: string, proposed: string): string {
  const bad = (s: string) =>
    !s ||
    /^strictly confidential$/i.test(s) ||
    /^confidential investment opportunity$/i.test(s) ||
    /^sell-?side opportunity$/i.test(s);

  const p = (proposed || "").trim();
  if (!bad(p)) return p.slice(0, 120);

  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const l = line.replace(/[:\-–—]+$/, "").trim();
    if (bad(l)) continue;
    if (/^(investment highlights|business overview|financials|transaction|key investment considerations)$/i.test(l)) continue;
    return l.slice(0, 120);
  }
  return "Untitled deal";
}

function fallbackExtract(rawText: string): DealInput {
  // Fallback is intentionally conservative but should still parse currency/scale-aware tables.
  // Sector/geo are inference-prone: default to Other / "" unless explicitly supported by keywords.
  const text = rawText.trim();
  const lower = text.toLowerCase();

  const sectorGuess =
    lower.includes("saas") || lower.includes("it /") ? "IT / SaaS" :
    lower.includes("software") ? "Software" :
    lower.includes("fintech") || lower.includes("fin tech") ? "Fintech" :
    lower.includes("health") ? "Healthcare" :
    lower.includes("pharma") ? "Pharma" :
    lower.includes("bfsi") || lower.includes("banking") || lower.includes("insurance") ? "BFSI" :
    lower.includes("manufactur") || lower.includes("industrial") ? "Manufacturing" :
    lower.includes("business services") ? "Business Services" :
    lower.includes("consumer") || lower.includes("retail") ? "Consumer" :
    lower.includes("d2c") || lower.includes("dtc") ? "D2C / Brands" :
    lower.includes("logistic") || lower.includes("supply chain") ? "Logistics" :
    lower.includes("agri") ? "Agritech" :
    lower.includes("edtech") || lower.includes("education") ? "EdTech" :
    lower.includes("energy") || lower.includes("cleantech") ? "Energy / Cleantech" :
    lower.includes("auto") || lower.includes("electric vehicle") ? "Auto / EV" :
    lower.includes("real estate") ? "Real Estate" :
    lower.includes("telecom") ? "Telecom" :
    "Other";
  const sector = hasExplicitSectorHint(text, sectorGuess) ? sectorGuess : "Other";

  const geo = inferGeographyIfExplicit(text);

  const provided = extractProvidedMetrics(text);
  // extractProvidedMetrics already returns values in full units
  const revenueProvided = provided.revenue ?? 0;
  const ebitdaProvided = provided.ebitda ?? 0;
  const dealSizeProvided = provided.dealSize ?? 0;

  const safeRevenueProvided = numberMentioned(text, revenueProvided) ? revenueProvided : 0;
  const safeEbitdaProvided = numberMentioned(text, ebitdaProvided) ? ebitdaProvided : 0;

  // Deal size validation: must be mentioned AND must not equal revenue or EBITDA
  const dealSizeMentioned = numberMentioned(text, dealSizeProvided);
  const dealSizeIsRevenueOrEbitda =
    (dealSizeProvided > 0 && dealSizeProvided === revenueProvided) ||
    (dealSizeProvided > 0 && dealSizeProvided === ebitdaProvided);

  // Ensure deal size appears near EV-related keywords
  let dealSizeHasEvContext = false;
  if (dealSizeProvided > 0) {
    const t = text.toLowerCase();
    const val = dealSizeProvided / 1_000_000;
    const valStr = val.toFixed(1).replace(/\.0$/, "");
    const fullValStr = dealSizeProvided.toString();

    // Pattern 1: "EV $70M" or "EV ($m): 70"
    const evPatternAbbrev = new RegExp(`(\\bev\\b|enterprise value|deal size|valuation|implied.*value)[^\\d]{0,80}?\\$?\\s*${valStr.replace('.', '\\.')}`, "i");
    // Pattern 2: "EV ($m): 70000000" (structured format)
    const evPatternFull = new RegExp(`(\\bev\\b|enterprise value|deal size|valuation)\\s*\\([^)]*\\)[^\\d]{0,20}?${fullValStr}`, "i");

    dealSizeHasEvContext = evPatternAbbrev.test(t) || evPatternFull.test(t);
  }

  const safeDealSizeProvided = dealSizeMentioned && !dealSizeIsRevenueOrEbitda && dealSizeHasEvContext ? dealSizeProvided : 0;

  const name = cleanDealName(text, "");

  return {
    name,
    sector: normalizeSector(sector),
    geography: geo ? normalizeGeography(geo) : "",
    // Already in full units
    revenue: safeRevenueProvided,
    ebitda: safeEbitdaProvided,
    dealSize: safeDealSizeProvided,
    description: text.slice(0, 1200),
    provided: {
      currency: provided.currency,
      scale: "unit",
      revenue: safeRevenueProvided || undefined,
      ebitda: safeEbitdaProvided || undefined,
      dealSize: safeDealSizeProvided || undefined,
    },
    uncertainties: provided.uncertainties,
  };
}

export async function extractDealFromText(reqBody: unknown): Promise<{
  ok: true;
  deal: DealInput;
  used: "claude" | "fallback";
} | {
  ok: false;
  error: string;
}> {
  const parsed = ExtractRequestSchema.safeParse(reqBody);
  if (!parsed.success) return { ok: false, error: "Invalid request: expected { rawText: string }" };

  const rawText = parsed.data.rawText.trim();
  log.info("[ExtractDeal] Start", { rawTextLen: rawText.length, detected: detectCurrencyScale(rawText) });

  // LLM-first if configured
  const system = `You are a deal intake extraction agent.
Return STRICT JSON only. No markdown. No extra commentary.`;

  const prompt = `Extract a structured deal object from the text below.

Return JSON with exactly these keys:
{
  "name": "string",
  "sector": "IT / SaaS|Software|Fintech|Healthcare|Pharma|BFSI|Manufacturing|Business Services|Consumer|D2C / Brands|Logistics|Agritech|EdTech|Energy / Cleantech|Auto / EV|Real Estate|Media / Entertainment|Telecom|Other",
  "geography": "string (e.g. Mumbai, Delhi NCR, Bangalore, India, US, UK, Europe)",
  "revenue": number,   // numeric value as stated in the text (do not convert currencies)
  "ebitda": number,    // numeric value as stated in the text (do not convert currencies)
  "dealSize": number,  // ONLY extract if text explicitly mentions "EV", "enterprise value", or "deal size". Otherwise use 0. Do NOT use revenue or other metrics as deal size.
  "description": "string"
}

Rules:
- If a number is not present, use 0.
- Do NOT invent metrics. Do NOT use revenue as deal size.
- For dealSize: ONLY extract if the text explicitly says "EV", "enterprise value", "valuation", or "deal size". Otherwise set to 0.
- Keep description concise (<= 800 chars) but preserve key details.

Text:
"""${rawText}"""`;

  const llm = await claudeJson<DealInput>({
    system,
    prompt,
    maxTokens: 900,
  });

  if (llm.ok) {
    const parsedDeal = ExtractedDealSchema.safeParse(llm.data);
    if (!parsedDeal.success) {
      log.warn("[ExtractDeal] Claude schema invalid; using fallback");
      return { ok: true, used: "fallback", deal: fallbackExtract(rawText) };
    }

    const deal = sanitizeExtractedDeal(rawText, parsedDeal.data);
    log.info("[ExtractDeal] Claude parsed & sanitized", {
      name: deal.name,
      sector: deal.sector,
      geography: deal.geography,
      provided: deal.provided,
      nominal: { revenue: deal.revenue, ebitda: deal.ebitda, dealSize: deal.dealSize },
    });

    // Second-pass validation: if Claude introduced unsupported claims, strip by falling back to safer extraction.
    // (We keep this conservative: extraction should be factual.)
    // Validate the *sanitized* deal (not the raw Claude JSON) so corrected fields
    // (e.g. blank geography when not explicit) don't trigger false fallbacks.
    const val = await validateUnsupportedClaims({
      deal,
      rawText,
      candidateJson: deal,
      candidateText: JSON.stringify(deal),
    });
    if (val.ok && val.unsupportedClaims.length) {
      log.warn("[ExtractDeal] Validator flagged issues; using fallback", { issues: val.unsupportedClaims.slice(0, 8) });
      return { ok: true, used: "fallback", deal: fallbackExtract(rawText) };
    }

    log.info("[ExtractDeal] Used=claude");
    return { ok: true, used: "claude", deal };
  }

  log.warn("[ExtractDeal] Claude unavailable/failed; using fallback", { error: (llm as any).error });
  return { ok: true, used: "fallback", deal: fallbackExtract(rawText) };
}


