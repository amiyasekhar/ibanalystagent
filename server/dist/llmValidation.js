"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateUnsupportedClaims = validateUnsupportedClaims;
const zod_1 = require("zod");
const claude_1 = require("./claude");
const logger_1 = require("./logger");
const UnsupportedClaimsSchema = zod_1.z
    .object({
    unsupportedClaims: zod_1.z.array(zod_1.z.string()).default([]),
})
    .strict();
async function validateUnsupportedClaims(opts) {
    const system = `You are a strict fact-checking validator for investment banking outputs.
Return STRICT JSON only. No markdown. No commentary.`;
    const prompt = `You will be given:
1) A Deal object (ground truth).
2) Optionally: the original raw text used for extraction.
3) A candidate output (JSON + rendered text).

Task:
- List any claims in the candidate that are NOT directly supported by the Deal object / raw text.
- Claims include: numbers (revenue/EBITDA/EV/margins/growth), geographies, customers, TAM, market position, growth rates, retention, margins, "pan-European/global", etc.
- If the candidate uses rounded numbers, it is ONLY allowed if the rounded number is clearly derivable from the Deal values (e.g., 18.5 -> "~19").
- If no issues, return an empty list.

Return JSON exactly:
{ "unsupportedClaims": ["..."] }

Deal JSON:
${JSON.stringify(opts.deal)}

Raw text (may be empty):
${opts.rawText ? opts.rawText : "(none)"}

Candidate JSON:
${JSON.stringify(opts.candidateJson)}

Candidate text:
"""${opts.candidateText}"""`;
    const out = await (0, claude_1.claudeJson)({
        system,
        prompt,
        maxTokens: 650,
        temperature: 0.0,
    });
    if (!out.ok)
        return { ok: false, error: out.error };
    const parsed = UnsupportedClaimsSchema.safeParse(out.data);
    if (!parsed.success)
        return { ok: false, error: "Validator returned invalid JSON" };
    const claims = (parsed.data.unsupportedClaims || []).map((s) => String(s || "").trim()).filter(Boolean).slice(0, 30);
    if (claims.length) {
        logger_1.log.warn("[Validator] Unsupported claims detected", { count: claims.length, claims: claims.slice(0, 10) });
    }
    else {
        logger_1.log.info("[Validator] No unsupported claims detected");
    }
    return { ok: true, unsupportedClaims: claims };
}
