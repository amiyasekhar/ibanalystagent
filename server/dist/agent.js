"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreAndRankBuyers = scoreAndRankBuyers;
exports.runAnalystAgent = runAnalystAgent;
const claude_1 = require("./claude");
const buyers_1 = require("./buyers");
const pythonMl_1 = require("./pythonMl");
const zod_1 = require("zod");
const llmValidation_1 = require("./llmValidation");
const logger_1 = require("./logger");
const AgentLlmSchema = zod_1.z
    .object({
    dealSummary: zod_1.z.string(),
    outreachDrafts: zod_1.z
        .array(zod_1.z.object({
        buyerName: zod_1.z.string(),
        emailSubject: zod_1.z.string(),
        emailBody: zod_1.z.string(),
    }))
        .default([]),
})
    .strict();
function extractNumbers(text) {
    const matches = text.match(/(\d+(\.\d+)?)/g) || [];
    return matches.map((m) => Number(m)).filter((n) => Number.isFinite(n));
}
function approxEqual(a, b, tol = 0.75) {
    if (!Number.isFinite(a) || !Number.isFinite(b))
        return false;
    return Math.abs(a - b) <= tol;
}
function emailHasOnlyDealNumbers(emailBody, deal) {
    const nums = extractNumbers(emailBody);
    if (!nums.length)
        return true;
    const allowed = [deal.revenue, deal.ebitda, deal.dealSize];
    for (const n of nums) {
        // allow trivial list numbering
        if (n >= 1 && n <= 10 && /\n\s*\d+[\)\.]/.test(emailBody))
            continue;
        const ok = allowed.some((a) => approxEqual(n, a) || approxEqual(n, Math.round(a)));
        if (!ok)
            return false;
    }
    return true;
}
function clamp01(x) {
    if (!Number.isFinite(x))
        return 0;
    return Math.max(0, Math.min(1, x));
}
function buildRationale(m) {
    const f = m.features;
    const b = m.buyer;
    const parts = [];
    parts.push(f.sectorMatch ? "Sector match" : "Sector adjacency");
    parts.push(f.geoMatch ? "Geo match" : "Geo flexible");
    parts.push(f.sizeFit ? `Size fit (${b.minDealSize}–${b.maxDealSize}m EV)` : `Out-of-range size (${b.minDealSize}–${b.maxDealSize}m EV)`);
    // EBITDA fit is a real mandate constraint
    parts.push(f.ebitdaFit ? `EBITDA fit (${b.minEbitda}–${b.maxEbitda}m)` : `EBITDA out-of-range (${b.minEbitda}–${b.maxEbitda}m)`);
    parts.push(`Activity ${(clamp01(f.activityLevel) * 100).toFixed(0)}%`);
    parts.push(`Capital ${(clamp01(f.dryPowderFit) * 100).toFixed(0)}%`);
    if (b.strategyTags?.length)
        parts.push(`Tags: ${b.strategyTags.slice(0, 3).join(", ")}`);
    return parts.join(" • ");
}
function applyMandateFilters(scores) {
    // “Mandate fit” + explicit filtering:
    // - must be within deal size and EBITDA bands
    // - must match sector, unless buyer explicitly covers "Other" (generalist bucket)
    return scores.filter((m) => {
        const sectorOk = m.features.sectorMatch === 1 || m.buyer.sectorFocus.includes("Other");
        const sizeOk = m.features.sizeFit === 1;
        const ebitdaOk = m.features.ebitdaFit === 1;
        return sectorOk && sizeOk && ebitdaOk;
    });
}
async function scoreAndRankBuyers(deal) {
    // Primary path: Python ML inference
    const py = await (0, pythonMl_1.inferBuyerScoresPython)({ deal, buyers: buyers_1.BUYERS });
    const scoreById = new Map(py.scores.map((s) => [s.buyerId, s]));
    const matches = buyers_1.BUYERS.map((b) => {
        const s = scoreById.get(b.id);
        return {
            buyer: b,
            score: clamp01(s?.score ?? 0),
            features: {
                sectorMatch: clamp01(s?.features?.sectorMatch ?? 0),
                geoMatch: clamp01(s?.features?.geoMatch ?? 0),
                sizeFit: clamp01(s?.features?.sizeFit ?? 0),
                dryPowderFit: clamp01(s?.features?.dryPowderFit ?? 0),
                activityLevel: clamp01(s?.features?.activityLevel ?? 0),
                ebitdaFit: clamp01(s?.features?.ebitdaFit ?? 0),
            },
        };
    });
    // Apply mandate filtering then rank
    const filtered = applyMandateFilters(matches);
    filtered.sort((a, b) => b.score - a.score);
    return { modelVersion: py.modelVersion, matches: filtered.slice(0, 5) };
}
async function runAnalystAgent(deal) {
    logger_1.log.info("[Agent] Start", {
        deal: {
            name: deal.name,
            sector: deal.sector,
            geography: deal.geography,
            provided: deal.provided,
            nominal: { revenue: deal.revenue, ebitda: deal.ebitda, dealSize: deal.dealSize },
        },
    });
    if (deal.provided?.currency && (deal.provided.currency !== "USD" || deal.provided.scale !== "m")) {
        logger_1.log.warn("[Agent] Nominal units in use (no conversion). Matching/ML may be unreliable until buyer DB is aligned.", {
            currency: deal.provided.currency,
            scale: deal.provided.scale,
        });
    }
    // 1) ML ranking + mandate filtering
    const { modelVersion, matches } = await scoreAndRankBuyers(deal);
    const top = matches.slice(0, 5);
    const buyers = top.map((m) => ({
        name: m.buyer.name,
        score: m.score,
        rationale: buildRationale(m),
    }));
    // 2) LLM: teaser-style summary + outreach drafts
    const system = `You are an investment banking analyst copilot.
You write concise, realistic banker-grade outputs.
Return STRICT JSON only. No markdown. No extra commentary.`;
    const prompt = `Deal:
- Name: ${deal.name}
- Sector: ${deal.sector}
- Geography: ${deal.geography}
- Revenue: ${deal.revenue}
- EBITDA: ${deal.ebitda}
- EV / Deal Size: ${deal.dealSize}
- Description: ${deal.description}

Ranked buyers (already scored by our ML matching model):
${buyers.map((b, i) => `${i + 1}) ${b.name} score=${(b.score * 100).toFixed(0)}%`).join("\n")}

Task:
1) Write a teaser-style deal summary (4–7 sentences). Must sound like a real CIM/teaser blurb.
2) For the top 3 buyers, write email subject + email body (short, banker tone, specific, no cringe).
3) Return JSON with this exact shape:

{
  "dealSummary": "string",
  "outreachDrafts": [
    { "buyerName": "string", "emailSubject": "string", "emailBody": "string" }
  ]
}

Rules:
- Keep it realistic: no made-up traction claims.
- Mention sector + geo + revenue/EBITDA succinctly.
- No placeholders like [Name] — write it ready to send.`;
    const llm = await (0, claude_1.claudeJson)({
        system,
        prompt,
        maxTokens: 1100,
    });
    const fallbackSummary = `Teaser: ${deal.name} is a ${deal.sector} business in ${deal.geography} with ~$${deal.revenue}m revenue and ~$${deal.ebitda}m EBITDA. The transaction contemplates an EV of ~$${deal.dealSize}m. ${deal.description}`;
    const fallbackDrafts = buyers.slice(0, 3).map((b) => ({
        buyerName: b.name,
        emailSubject: `Opportunity: ${deal.name} (${deal.sector}, ${deal.geography})`,
        emailBody: `Hi ${b.name} team,\n\n` +
            `Sharing a new opportunity: ${deal.name} — ${deal.sector} in ${deal.geography} with ~$${deal.revenue}m revenue and ~$${deal.ebitda}m EBITDA. We’re exploring interest around an EV of ~$${deal.dealSize}m.\n\n` +
            `If this aligns with your mandate, happy to share a short teaser + set up a quick call.\n\n` +
            `Best,\nAmiya`,
    }));
    let dealSummary = fallbackSummary;
    let outreachDrafts = fallbackDrafts;
    let llmUsed = false;
    let llmError = llm.ok ? undefined : llm.error;
    if (llm.ok) {
        const parsed = AgentLlmSchema.safeParse(llm.data);
        if (parsed.success) {
            dealSummary = String(parsed.data.dealSummary || "").slice(0, 2200) || fallbackSummary;
            outreachDrafts = parsed.data.outreachDrafts.slice(0, 3).map((d) => ({
                buyerName: String(d.buyerName || "").slice(0, 120),
                emailSubject: String(d.emailSubject || "").slice(0, 200),
                emailBody: String(d.emailBody || "").slice(0, 4000),
            }));
            llmUsed = true;
        }
        else {
            llmError = "Claude response schema invalid";
            logger_1.log.warn("[Agent] Claude schema invalid; using fallback drafts");
        }
    }
    // Extra guardrail: forbid introducing numbers not in Deal
    const heuristicOk = outreachDrafts.every((d) => emailHasOnlyDealNumbers(d.emailBody, deal));
    if (!heuristicOk)
        logger_1.log.warn("[Agent] Heuristic failed: email introduced unsupported numbers");
    // Second pass LLM validation: detect unsupported claims and regenerate once if needed
    if (llmUsed && outreachDrafts.length) {
        const candidateText = `Deal summary:\n${dealSummary}\n\n` +
            outreachDrafts.map((d) => `To: ${d.buyerName}\nSubj: ${d.emailSubject}\nBody:\n${d.emailBody}`).join("\n\n---\n\n");
        const val = await (0, llmValidation_1.validateUnsupportedClaims)({
            deal,
            candidateJson: { dealSummary, outreachDrafts },
            candidateText,
        });
        const hasIssues = (val.ok && val.unsupportedClaims.length > 0) || !heuristicOk;
        if (hasIssues) {
            logger_1.log.warn("[Agent] Regenerating due to validation issues", {
                validatorIssues: val.ok ? val.unsupportedClaims.slice(0, 8) : undefined,
                heuristicOk,
            });
            const strictPrompt = prompt +
                `\n\nIMPORTANT STRICTNESS:\n` +
                `- You MUST NOT introduce ANY numbers, geographies, customers, margins, growth rates, or claims not explicitly present in the Deal fields above.\n` +
                `- Only mention: name, sector, geography, revenue, EBITDA, EV, and the provided description.\n` +
                `- If unsure, omit.\n` +
                (val.ok && val.unsupportedClaims.length ? `\nRemove/avoid these unsupported claims:\n- ${val.unsupportedClaims.join("\n- ")}\n` : "");
            const llm2 = await (0, claude_1.claudeJson)({
                system,
                prompt: strictPrompt,
                maxTokens: 1100,
            });
            if (llm2.ok) {
                const parsed2 = AgentLlmSchema.safeParse(llm2.data);
                if (parsed2.success) {
                    const dealSummary2 = String(parsed2.data.dealSummary || "").slice(0, 2200) || fallbackSummary;
                    const drafts2 = parsed2.data.outreachDrafts.slice(0, 3).map((d) => ({
                        buyerName: String(d.buyerName || "").slice(0, 120),
                        emailSubject: String(d.emailSubject || "").slice(0, 200),
                        emailBody: String(d.emailBody || "").slice(0, 4000),
                    }));
                    if (drafts2.length && drafts2.every((d) => emailHasOnlyDealNumbers(d.emailBody, deal))) {
                        dealSummary = dealSummary2;
                        outreachDrafts = drafts2;
                        logger_1.log.info("[Agent] Regeneration succeeded");
                    }
                    else {
                        outreachDrafts = fallbackDrafts;
                        logger_1.log.warn("[Agent] Regeneration still violated heuristic; using fallback drafts");
                    }
                }
                else {
                    outreachDrafts = fallbackDrafts;
                    logger_1.log.warn("[Agent] Regeneration schema invalid; using fallback drafts");
                }
            }
            else {
                outreachDrafts = fallbackDrafts;
                logger_1.log.warn("[Agent] Regeneration call failed; using fallback drafts", { error: llm2.error });
            }
        }
    }
    return {
        dealSummary,
        buyers,
        outreachDrafts,
        modelVersion,
        llmUsed,
        llmError,
    };
}
