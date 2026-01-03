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
  if (s === "software") return t.includes("software") || t.includes("saas") || t.includes("saaS".toLowerCase());
  if (s === "healthcare") return t.includes("health") || t.includes("med") || t.includes("clinic") || t.includes("pharma");
  if (s === "manufacturing") return t.includes("manufactur") || t.includes("industrial") || t.includes("factory");
  if (s === "business services") return t.includes("business services") || t.includes("outsourc") || t.includes("services");
  if (s === "consumer") return t.includes("consumer") || t.includes("retail") || t.includes("e-commerce") || t.includes("d2c");
  return true;
}

function inferGeographyIfExplicit(rawText: string): string {
  const t = rawText.toLowerCase();
  // IMPORTANT: do NOT treat the pronoun "us" as geography. Require explicit tokens.
  if (t.includes("united states") || t.includes("u.s.") || /\busa\b/.test(t) || /\bu\.s\.\b/.test(t)) return "US";
  if (t.includes("united kingdom") || /\buk\b/.test(t)) return "UK";
  if (t.includes("canada")) return "Canada";
  if (t.includes("europe") || t.includes("emea")) return "Europe";
  if (t.includes("india")) return "India";
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

type ProvidedScale = "m" | "crore" | "b";
type ProvidedMetrics = {
  currency: string;
  scale: ProvidedScale;
  revenue?: number;
  ebitda?: number;
  dealSize?: number;
};

function detectCurrencyScale(rawText: string): { currency: string; scale: ProvidedScale } {
  const t = rawText.toLowerCase();
  // currency
  let currency = "USD";
  if (t.includes("₹") || t.includes("inr") || t.includes("rupee")) currency = "INR";
  else if (t.includes("€") || t.includes("eur")) currency = "EUR";
  else if (t.includes("£") || t.includes("gbp")) currency = "GBP";
  else if (t.includes("$") || t.includes("usd")) currency = "USD";

  // scale
  let scale: ProvidedScale = "m";
  if (t.includes("crore") || /\bcr\b/.test(t)) scale = "crore";
  else if (t.includes("billion") || /\bbn\b/.test(t)) scale = "b";
  else if (t.includes("million") || /\bmm\b/.test(t) || /\bm\b/.test(t)) scale = "m";
  return { currency, scale };
}

function scaleMultiplier(scale: ProvidedScale): number {
  if (scale === "m") return 1_000_000;
  if (scale === "b") return 1_000_000_000;
  // crore
  return 10_000_000;
}

// NOTE: We are intentionally NOT converting currencies right now (nominal values only).

function parseLatestMetricFromFinancials(rawText: string, key: "Revenue" | "EBITDA" | "EV" | "Deal Size" | "Enterprise Value"): number | null {
  // If user pasted a FY table (often from PDF extraction), use the most recent FY block.
  // Example line: "FY 2024-25:\nRevenue: 980,136 | EBITDA: 183,422 | ..."
  const re = new RegExp(`FY\\s*\\d{4}[-–]\\d{2}:[\\s\\S]*?${key}:\\s*([\\d,]+)`, "gi");
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(rawText)) !== null) {
    last = m[1];
  }
  if (last) return Number(String(last).replace(/,/g, ""));

  // Fallback: "$18.5m revenue" style
  const low = rawText.toLowerCase();
  if (key === "Revenue") {
    const mm = low.match(/revenue[^0-9]{0,30}(\$?\s*[\d,.]+)\s*(m|mm|million|crore|cr|bn|billion)?/i);
    if (mm?.[1]) return Number(mm[1].replace(/,/g, ""));
  }
  if (key === "EBITDA") {
    const mm = low.match(/ebitda[^0-9]{0,30}(\$?\s*[\d,.]+)\s*(m|mm|million|crore|cr|bn|billion)?/i);
    if (mm?.[1]) return Number(mm[1].replace(/,/g, ""));
  }
  if (key === "EV" || key === "Deal Size" || key === "Enterprise Value") {
    const mm = low.match(/(ev|enterprise value|deal size)[^0-9]{0,30}(\$?\s*[\d,.]+)\s*(m|mm|million|crore|cr|bn|billion)?/i);
    if (mm?.[2]) return Number(mm[2].replace(/,/g, ""));
  }
  return null;
}

function extractProvidedMetrics(rawText: string): ProvidedMetrics {
  const { currency, scale } = detectCurrencyScale(rawText);
  const revenue = parseLatestMetricFromFinancials(rawText, "Revenue");
  const ebitda = parseLatestMetricFromFinancials(rawText, "EBITDA");
  const dealSize =
    parseLatestMetricFromFinancials(rawText, "EV") ??
    parseLatestMetricFromFinancials(rawText, "Deal Size") ??
    parseLatestMetricFromFinancials(rawText, "Enterprise Value");
  return {
    currency,
    scale,
    revenue: revenue != null && Number.isFinite(revenue) ? revenue : undefined,
    ebitda: ebitda != null && Number.isFinite(ebitda) ? ebitda : undefined,
    dealSize: dealSize != null && Number.isFinite(dealSize) ? dealSize : undefined,
  };
}

function sanitizeExtractedDeal(rawText: string, d: any): DealInput {
  const name = cleanDealName(rawText, String(d?.name || ""));
  const provided = extractProvidedMetrics(rawText);
  const revenueProvided = provided.revenue ?? num(d?.revenue, 0);
  const ebitdaProvided = provided.ebitda ?? num(d?.ebitda, 0);
  const dealSizeProvided = provided.dealSize ?? num(d?.dealSize, 0);

  // Enforce: numbers must be present in rawText, else zero them (in provided units)
  const safeRevenueProvided = numberMentioned(rawText, revenueProvided) ? revenueProvided : 0;
  const safeEbitdaProvided = numberMentioned(rawText, ebitdaProvided) ? ebitdaProvided : 0;
  const safeDealSizeProvided = numberMentioned(rawText, dealSizeProvided) ? dealSizeProvided : 0;

  // Enforce: sector/geo are inference-prone. Only set if explicitly supported.
  const sectorRaw = String(d?.sector || "Other");
  const sector = hasExplicitSectorHint(rawText, sectorRaw) ? normalizeSector(sectorRaw) : "Other";
  const geoExplicit = inferGeographyIfExplicit(rawText);
  const geography = geoExplicit ? normalizeGeography(geoExplicit) : "";

  const mult = scaleMultiplier(provided.scale);
  return {
    name,
    sector,
    geography,
    // NOMINAL values (no conversion)
    revenue: safeRevenueProvided ? safeRevenueProvided * mult : 0,
    ebitda: safeEbitdaProvided ? safeEbitdaProvided * mult : 0,
    dealSize: safeDealSizeProvided ? safeDealSizeProvided * mult : 0,
    description: String(d?.description || rawText).slice(0, 1200),
    provided: {
      currency: provided.currency,
      scale: "unit",
      revenue: safeRevenueProvided ? safeRevenueProvided * mult : undefined,
      ebitda: safeEbitdaProvided ? safeEbitdaProvided * mult : undefined,
      dealSize: safeDealSizeProvided ? safeDealSizeProvided * mult : undefined,
    },
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
    lower.includes("saas") || lower.includes("software") ? "Software" :
    lower.includes("health") ? "Healthcare" :
    lower.includes("manufactur") || lower.includes("industrial") ? "Manufacturing" :
    lower.includes("business services") ? "Business Services" :
    lower.includes("consumer") || lower.includes("retail") ? "Consumer" :
    "Other";
  const sector = hasExplicitSectorHint(text, sectorGuess) ? sectorGuess : "Other";

  const geo = inferGeographyIfExplicit(text);

  const provided = extractProvidedMetrics(text);
  const revenueProvided = provided.revenue ?? 0;
  const ebitdaProvided = provided.ebitda ?? 0;
  const dealSizeProvided = provided.dealSize ?? 0;

  const safeRevenueProvided = numberMentioned(text, revenueProvided) ? revenueProvided : 0;
  const safeEbitdaProvided = numberMentioned(text, ebitdaProvided) ? ebitdaProvided : 0;
  const safeDealSizeProvided = numberMentioned(text, dealSizeProvided) ? dealSizeProvided : 0;

  const name = cleanDealName(text, "");
  const mult = scaleMultiplier(provided.scale);

  return {
    name,
    sector: normalizeSector(sector),
    geography: geo ? normalizeGeography(geo) : "",
    // NOMINAL values (no conversion)
    revenue: safeRevenueProvided ? safeRevenueProvided * mult : 0,
    ebitda: safeEbitdaProvided ? safeEbitdaProvided * mult : 0,
    dealSize: safeDealSizeProvided ? safeDealSizeProvided * mult : 0,
    description: text.slice(0, 1200),
    provided: {
      currency: provided.currency,
      scale: "unit",
      revenue: safeRevenueProvided ? safeRevenueProvided * mult : undefined,
      ebitda: safeEbitdaProvided ? safeEbitdaProvided * mult : undefined,
      dealSize: safeDealSizeProvided ? safeDealSizeProvided * mult : undefined,
    },
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
  "sector": "Software|Healthcare|Manufacturing|Business Services|Consumer|Other",
  "geography": "string (e.g. US, UK, Europe)",
  "revenue": number,   // numeric value as stated in the text (do not convert currencies)
  "ebitda": number,    // numeric value as stated in the text (do not convert currencies)
  "dealSize": number,  // EV as stated in the text (do not convert currencies)
  "description": "string"
}

Rules:
- If a number is not present, use 0.
- Do NOT invent metrics.
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


