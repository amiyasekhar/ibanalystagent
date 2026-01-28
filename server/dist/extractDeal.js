"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDealFromText = extractDealFromText;
const zod_1 = require("zod");
const claude_1 = require("./claude");
const normalize_1 = require("./normalize");
const llmValidation_1 = require("./llmValidation");
const logger_1 = require("./logger");
const ExtractRequestSchema = zod_1.z.object({
    rawText: zod_1.z.string().min(1),
});
const ExtractedDealSchema = zod_1.z
    .object({
    name: zod_1.z.string(),
    sector: zod_1.z.string(),
    geography: zod_1.z.string(),
    revenue: zod_1.z.union([zod_1.z.number(), zod_1.z.string()]),
    ebitda: zod_1.z.union([zod_1.z.number(), zod_1.z.string()]),
    dealSize: zod_1.z.union([zod_1.z.number(), zod_1.z.string()]),
    description: zod_1.z.string(),
})
    .strict();
function hasExplicitSectorHint(rawText, sector) {
    const t = rawText.toLowerCase();
    const s = sector.toLowerCase();
    if (s === "software")
        return t.includes("software") || t.includes("saas") || t.includes("saaS".toLowerCase());
    if (s === "healthcare")
        return t.includes("health") || t.includes("med") || t.includes("clinic") || t.includes("pharma");
    if (s === "manufacturing")
        return t.includes("manufactur") || t.includes("industrial") || t.includes("factory");
    if (s === "business services")
        return t.includes("business services") || t.includes("outsourc") || t.includes("services");
    if (s === "consumer")
        return t.includes("consumer") || t.includes("retail") || t.includes("e-commerce") || t.includes("d2c");
    return true;
}
function inferGeographyIfExplicit(rawText) {
    const t = rawText.toLowerCase();
    // IMPORTANT: do NOT treat the pronoun "us" as geography. Require explicit tokens.
    if (t.includes("united states") || t.includes("u.s.") || /\busa\b/.test(t) || /\bu\.s\.\b/.test(t))
        return "US";
    if (t.includes("united kingdom") || /\buk\b/.test(t))
        return "UK";
    if (t.includes("canada"))
        return "Canada";
    if (t.includes("europe") || t.includes("emea"))
        return "Europe";
    if (t.includes("india"))
        return "India";
    return "";
}
function numberMentioned(rawText, value) {
    if (!Number.isFinite(value) || value <= 0)
        return true;
    const t = rawText.toLowerCase();
    const tNoCommas = t.replace(/,/g, "");
    const variants = new Set();
    const v1 = value.toFixed(1).replace(/\.0$/, "");
    variants.add(String(value));
    variants.add(v1);
    variants.add(String(Math.round(value)));
    for (const v of variants) {
        const vv = v.replace(/,/g, "");
        // allow "980,136", "980136", "$18.5m", "₹98,000 crores", "70mm", etc
        const re = new RegExp(`\\b[₹$€£]?\\s*${vv.replace(".", "\\.")}\\s*(m|mm|million|crore|cr|bn|billion)?\\b`, "i");
        if (re.test(tNoCommas))
            return true;
    }
    return false;
}
// All financials are assumed to be in USD millions
// No currency conversion - everything is USD millions
function parseLatestMetricFromFinancials(rawText, key) {
    // If user pasted a FY table (often from PDF extraction), use the most recent FY block.
    // Example line: "FY 2024-25:\nRevenue: 980,136 | EBITDA: 183,422 | ..."
    const re = new RegExp(`FY\\s*\\d{4}[-–]\\d{2}:[\\s\\S]*?${key}:\\s*([\\d,]+)`, "gi");
    let m;
    let last = null;
    while ((m = re.exec(rawText)) !== null) {
        last = m[1];
    }
    if (last)
        return Number(String(last).replace(/,/g, ""));
    // Fallback: "$18.5m revenue" style
    const low = rawText.toLowerCase();
    if (key === "Revenue") {
        const mm = low.match(/revenue[^0-9]{0,30}(\$?\s*[\d,.]+)\s*(m|mm|million|crore|cr|bn|billion)?/i);
        if (mm?.[1])
            return Number(mm[1].replace(/,/g, ""));
    }
    if (key === "EBITDA") {
        const mm = low.match(/ebitda[^0-9]{0,30}(\$?\s*[\d,.]+)\s*(m|mm|million|crore|cr|bn|billion)?/i);
        if (mm?.[1])
            return Number(mm[1].replace(/,/g, ""));
    }
    if (key === "EV" || key === "Deal Size" || key === "Enterprise Value") {
        const mm = low.match(/(ev|enterprise value|deal size)[^0-9]{0,30}(\$?\s*[\d,.]+)\s*(m|mm|million|crore|cr|bn|billion)?/i);
        if (mm?.[2])
            return Number(mm[2].replace(/,/g, ""));
    }
    return null;
}
function extractProvidedMetrics(rawText) {
    const { currency, scale } = detectCurrencyScale(rawText);
    const revenue = parseLatestMetricFromFinancials(rawText, "Revenue");
    const ebitda = parseLatestMetricFromFinancials(rawText, "EBITDA");
    const dealSize = parseLatestMetricFromFinancials(rawText, "EV") ??
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
function sanitizeExtractedDeal(rawText, d) {
    const name = cleanDealName(rawText, String(d?.name || ""));
    const provided = extractProvidedMetrics(rawText);
    const revenueProvided = provided.revenue ?? (0, normalize_1.num)(d?.revenue, 0);
    const ebitdaProvided = provided.ebitda ?? (0, normalize_1.num)(d?.ebitda, 0);
    const dealSizeProvided = provided.dealSize ?? (0, normalize_1.num)(d?.dealSize, 0);
    // Enforce: numbers must be present in rawText, else zero them (in provided units)
    const safeRevenueProvided = numberMentioned(rawText, revenueProvided) ? revenueProvided : 0;
    const safeEbitdaProvided = numberMentioned(rawText, ebitdaProvided) ? ebitdaProvided : 0;
    const safeDealSizeProvided = numberMentioned(rawText, dealSizeProvided) ? dealSizeProvided : 0;
    // Enforce: sector/geo are inference-prone. Only set if explicitly supported.
    const sectorRaw = String(d?.sector || "Other");
    const sector = hasExplicitSectorHint(rawText, sectorRaw) ? (0, normalize_1.normalizeSector)(sectorRaw) : "Other";
    const geoExplicit = inferGeographyIfExplicit(rawText);
    const geography = geoExplicit ? (0, normalize_1.normalizeGeography)(geoExplicit) : "";
    const mult = scaleMultiplier(provided.scale);
    return {
        name,
        sector,
        geography,
        // All values in USD millions
        revenue: safeRevenueProvided,
        ebitda: safeEbitdaProvided,
        dealSize: safeDealSizeProvided,
        description: String(d?.description || rawText).slice(0, 1200),
    };
}
function cleanDealName(rawText, proposed) {
    const bad = (s) => !s ||
        /^strictly confidential$/i.test(s) ||
        /^confidential investment opportunity$/i.test(s) ||
        /^sell-?side opportunity$/i.test(s);
    const p = (proposed || "").trim();
    if (!bad(p))
        return p.slice(0, 120);
    const lines = rawText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    for (const line of lines) {
        const l = line.replace(/[:\-–—]+$/, "").trim();
        if (bad(l))
            continue;
        if (/^(investment highlights|business overview|financials|transaction|key investment considerations)$/i.test(l))
            continue;
        return l.slice(0, 120);
    }
    return "Untitled deal";
}
function fallbackExtract(rawText) {
    // Fallback is intentionally conservative but should still parse currency/scale-aware tables.
    // Sector/geo are inference-prone: default to Other / "" unless explicitly supported by keywords.
    const text = rawText.trim();
    const lower = text.toLowerCase();
    const sectorGuess = lower.includes("saas") || lower.includes("software") ? "Software" :
        lower.includes("health") ? "Healthcare" :
            lower.includes("manufactur") || lower.includes("industrial") ? "Manufacturing" :
                lower.includes("business services") ? "Business Services" :
                    lower.includes("consumer") || lower.includes("retail") ? "Consumer" :
                        "Other";
    const sector = hasExplicitSectorHint(text, sectorGuess) ? sectorGuess : "Other";
    const geo = inferGeographyIfExplicit(text);
    // Extract numbers (assumed to be in USD millions)
    const numbers = extractNumbers(text);
    const revenueProvided = numbers[0] ?? 0;
    const ebitdaProvided = numbers[1] ?? 0;
    const dealSizeProvided = numbers[2] ?? 0;
    const safeRevenueProvided = numberMentioned(text, revenueProvided) ? revenueProvided : 0;
    const safeEbitdaProvided = numberMentioned(text, ebitdaProvided) ? ebitdaProvided : 0;
    const safeDealSizeProvided = numberMentioned(text, dealSizeProvided) ? dealSizeProvided : 0;
    const name = cleanDealName(text, "");
    return {
        name,
        sector: (0, normalize_1.normalizeSector)(sector),
        geography: geo ? (0, normalize_1.normalizeGeography)(geo) : "",
        // All values in USD millions
        revenue: safeRevenueProvided,
        ebitda: safeEbitdaProvided,
        dealSize: safeDealSizeProvided,
        description: text.slice(0, 1200),
    };
}
async function extractDealFromText(reqBody) {
    const parsed = ExtractRequestSchema.safeParse(reqBody);
    if (!parsed.success)
        return { ok: false, error: "Invalid request: expected { rawText: string }" };
    const rawText = parsed.data.rawText.trim();
    logger_1.log.info("[ExtractDeal] Start", { rawTextLen: rawText.length, detected: detectCurrencyScale(rawText) });
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
    const llm = await (0, claude_1.claudeJson)({
        system,
        prompt,
        maxTokens: 900,
    });
    if (llm.ok) {
        const parsedDeal = ExtractedDealSchema.safeParse(llm.data);
        if (!parsedDeal.success) {
            logger_1.log.warn("[ExtractDeal] Claude schema invalid; using fallback");
            return { ok: true, used: "fallback", deal: fallbackExtract(rawText) };
        }
        const deal = sanitizeExtractedDeal(rawText, parsedDeal.data);
        logger_1.log.info("[ExtractDeal] Claude parsed & sanitized", {
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
        const val = await (0, llmValidation_1.validateUnsupportedClaims)({
            deal,
            rawText,
            candidateJson: deal,
            candidateText: JSON.stringify(deal),
        });
        if (val.ok && val.unsupportedClaims.length) {
            logger_1.log.warn("[ExtractDeal] Validator flagged issues; using fallback", { issues: val.unsupportedClaims.slice(0, 8) });
            return { ok: true, used: "fallback", deal: fallbackExtract(rawText) };
        }
        logger_1.log.info("[ExtractDeal] Used=claude");
        return { ok: true, used: "claude", deal };
    }
    logger_1.log.warn("[ExtractDeal] Claude unavailable/failed; using fallback", { error: llm.error });
    return { ok: true, used: "fallback", deal: fallbackExtract(rawText) };
}
