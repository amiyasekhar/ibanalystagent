"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDealFromText = extractDealFromText;
const zod_1 = require("zod");
const claude_1 = require("./claude");
const normalize_1 = require("./normalize");
const ExtractRequestSchema = zod_1.z.object({
    rawText: zod_1.z.string().min(1),
});
function fallbackExtract(rawText) {
    // Very lightweight fallback: infer sector/geo via keywords; numbers via regex.
    const text = rawText.trim();
    const lower = text.toLowerCase();
    const sector = lower.includes("saas") || lower.includes("software") ? "Software" :
        lower.includes("health") ? "Healthcare" :
            lower.includes("manufactur") || lower.includes("industrial") ? "Manufacturing" :
                lower.includes("business services") ? "Business Services" :
                    lower.includes("consumer") || lower.includes("retail") ? "Consumer" :
                        "Other";
    const geo = lower.includes("united states") || lower.includes("u.s.") || lower.includes("us") ? "US" :
        lower.includes("uk") || lower.includes("united kingdom") ? "UK" :
            lower.includes("canada") ? "Canada" :
                lower.includes("europe") ? "Europe" :
                    "US";
    // Parse "$15m revenue" style
    const revenueMatch = lower.match(/revenue[^0-9]{0,20}(\$?\s*\d+(\.\d+)?)\s*m/);
    const ebitdaMatch = lower.match(/ebitda[^0-9]{0,20}(\$?\s*\d+(\.\d+)?)\s*m/);
    const evMatch = lower.match(/(ev|enterprise value|deal size)[^0-9]{0,20}(\$?\s*\d+(\.\d+)?)\s*m/);
    const revenue = revenueMatch ? (0, normalize_1.num)(revenueMatch[1]) : 0;
    const ebitda = ebitdaMatch ? (0, normalize_1.num)(ebitdaMatch[1]) : 0;
    const dealSize = evMatch ? (0, normalize_1.num)(evMatch[2]) : 0;
    // Name heuristic: first line or first 6 words
    const firstLine = text.split("\n")[0]?.trim() || "";
    const name = firstLine.length <= 60 && firstLine.length >= 2 ? firstLine : text.split(/\s+/).slice(0, 6).join(" ");
    return {
        name,
        sector: (0, normalize_1.normalizeSector)(sector),
        geography: (0, normalize_1.normalizeGeography)(geo),
        revenue,
        ebitda,
        dealSize,
        description: text.slice(0, 1200),
    };
}
async function extractDealFromText(reqBody) {
    const parsed = ExtractRequestSchema.safeParse(reqBody);
    if (!parsed.success)
        return { ok: false, error: "Invalid request: expected { rawText: string }" };
    const rawText = parsed.data.rawText.trim();
    // LLM-first if configured
    const system = `You are a deal intake extraction agent.
Return STRICT JSON only. No markdown. No extra commentary.`;
    const prompt = `Extract a structured deal object from the text below.

Return JSON with exactly these keys:
{
  "name": "string",
  "sector": "Software|Healthcare|Manufacturing|Business Services|Consumer|Other",
  "geography": "string (e.g. US, UK, Europe)",
  "revenue": number,   // in $m
  "ebitda": number,    // in $m
  "dealSize": number,  // EV in $m
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
        const d = llm.data;
        return {
            ok: true,
            used: "claude",
            deal: {
                name: String(d.name || "Untitled deal").slice(0, 120),
                sector: (0, normalize_1.normalizeSector)(String(d.sector || "Other")),
                geography: (0, normalize_1.normalizeGeography)(String(d.geography || "")),
                revenue: (0, normalize_1.num)(d.revenue, 0),
                ebitda: (0, normalize_1.num)(d.ebitda, 0),
                dealSize: (0, normalize_1.num)(d.dealSize, 0),
                description: String(d.description || rawText).slice(0, 1200),
            },
        };
    }
    return { ok: true, used: "fallback", deal: fallbackExtract(rawText) };
}
