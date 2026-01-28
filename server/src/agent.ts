import { claudeJson } from "./claude";
import { BUYERS } from "./buyers";
import { inferBuyerScoresPython } from "./pythonMl";
import { BuyerMatchScore, DealInput } from "./types";
import { z } from "zod";
import { validateUnsupportedClaims } from "./llmValidation";
import { log } from "./logger";

export type BuyerMatch = { name: string; score: number; rationale: string };
export type OutreachDraft = { buyerName: string; emailSubject: string; emailBody: string };

export type AgentResult = {
  dealSummary: string;
  buyers: BuyerMatch[];
  outreachDrafts: OutreachDraft[];
  // extra debugging fields (safe to ignore in UI)
  modelVersion?: string;
  llmUsed?: boolean;
  llmError?: string;
};

const AgentLlmSchema = z
  .object({
    dealSummary: z.string(),
    outreachDrafts: z
      .array(
        z.object({
          buyerName: z.string(),
          emailSubject: z.string(),
          emailBody: z.string(),
        })
      )
      .default([]),
  })
  .strict();

function extractNumbers(text: string): number[] {
  const matches = text.match(/(\d+(\.\d+)?)/g) || [];
  return matches.map((m) => Number(m)).filter((n) => Number.isFinite(n));
}

function approxEqual(a: number, b: number, tol = 0.75): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tol;
}

function emailHasOnlyDealNumbers(emailBody: string, deal: DealInput): boolean {
  const nums = extractNumbers(emailBody);
  if (!nums.length) return true;
  const allowed = [deal.revenue, deal.ebitda, deal.dealSize];
  for (const n of nums) {
    // allow trivial list numbering
    if (n >= 1 && n <= 10 && /\n\s*\d+[\)\.]/.test(emailBody)) continue;
    const ok = allowed.some((a) => approxEqual(n, a) || approxEqual(n, Math.round(a)));
    if (!ok) return false;
  }
  return true;
}

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function buildRationale(m: BuyerMatchScore): string {
  const f = m.features;
  const b = m.buyer;
  const parts: string[] = [];
  const minDealM = (b.minDealSize / 1_000_000).toFixed(1);
  const maxDealM = (b.maxDealSize / 1_000_000).toFixed(1);
  const minEbitdaM = (b.minEbitda / 1_000_000).toFixed(1);
  const maxEbitdaM = (b.maxEbitda / 1_000_000).toFixed(1);

  parts.push(f.sectorMatch ? "Sector match" : "Sector adjacency");
  parts.push(f.geoMatch ? "Geo match" : "Geo flexible");
  parts.push(f.sizeFit ? `Size fit ($${minDealM}M–$${maxDealM}M EV)` : `Out-of-range size ($${minDealM}M–$${maxDealM}M EV)`);
  // EBITDA fit is a real mandate constraint
  parts.push(f.ebitdaFit ? `EBITDA fit ($${minEbitdaM}M–$${maxEbitdaM}M)` : `EBITDA out-of-range ($${minEbitdaM}M–$${maxEbitdaM}M)`);
  parts.push(`Activity ${(clamp01(f.activityLevel) * 100).toFixed(0)}%`);
  parts.push(`Capital ${(clamp01(f.dryPowderFit) * 100).toFixed(0)}%`);
  if (b.strategyTags?.length) parts.push(`Tags: ${b.strategyTags.slice(0, 3).join(", ")}`);
  return parts.join(" • ");
}

function computeSynergyScore(deal: DealInput, buyer: { type: string; strategyTags?: string[] }): number {
  // Deal-specific "synergy propensity" (option 2): computed at match-time.
  // Heuristic: strategics + synergy-related tags skew higher; PE buy-and-build modestly increases.
  const tags = (buyer.strategyTags || []).map((t) => String(t).toLowerCase());
  const has = (t: string) => tags.includes(t);
  let score = buyer.type === "Strategic" ? 0.55 : 0.25;
  if (has("synergies")) score += 0.15;
  if (has("vertical-integration")) score += 0.10;
  if (has("carve-out")) score += 0.08;
  if (has("roll-up") || has("buy-and-build")) score += buyer.type === "Private Equity" ? 0.08 : 0.03;
  if (deal.sector && has("platform")) score += 0.03;
  return Math.max(0, Math.min(1, score));
}

function applyMandateFilters(scores: BuyerMatchScore[], deal: DealInput): BuyerMatchScore[] {
  // "Mandate fit" + explicit filtering:
  // - must be within deal size and EBITDA bands (if provided)
  // - must match sector, unless buyer explicitly covers "Other" (generalist bucket)
  const hasDealSize = deal.dealSize > 0;

  return scores.filter((m) => {
    const sectorOk = m.features.sectorMatch === 1 || m.buyer.sectorFocus.includes("Other");
    const sizeOk = hasDealSize ? m.features.sizeFit === 1 : true; // Skip size check if deal size unknown
    const ebitdaOk = m.features.ebitdaFit === 1;
    return sectorOk && sizeOk && ebitdaOk;
  });
}

export async function scoreAndRankBuyers(deal: DealInput): Promise<{ modelVersion?: string; matches: BuyerMatchScore[] }> {
  // Primary path: Python ML inference
  const py = await inferBuyerScoresPython({ deal, buyers: BUYERS });
  const scoreById = new Map(py.scores.map((s) => [s.buyerId, s]));

  const matches: BuyerMatchScore[] = BUYERS.map((b) => {
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
  log.info("[Agent] Mandate filtering", {
    beforeFiltering: matches.length,
    deal: {
      sector: deal.sector,
      geography: deal.geography || "(blank)",
      dealSize: deal.dealSize,
      ebitda: deal.ebitda,
    },
  });

  const filtered = applyMandateFilters(matches, deal);

  log.info("[Agent] After mandate filtering", {
    afterFiltering: filtered.length,
    filtered: filtered.length - matches.length,
  });

  // Incorporate deal-specific synergy score into ranking as a small multiplier
  const withSynergy = filtered.map((m: any) => {
    const synergy = computeSynergyScore(deal, m.buyer);
    const adjusted = clamp01(m.score * (0.92 + 0.16 * synergy));
    return { ...m, score: adjusted, _synergy: synergy };
  });
  withSynergy.sort((a: any, b: any) => b.score - a.score);

  return { modelVersion: py.modelVersion, matches: withSynergy.slice(0, 5) as any };
}

export async function runAnalystAgent(deal: DealInput): Promise<AgentResult> {
  log.info("[Agent] Start", {
    deal: {
      name: deal.name,
      sector: deal.sector,
      geography: deal.geography,
      provided: deal.provided,
      nominal: { revenue: deal.revenue, ebitda: deal.ebitda, dealSize: deal.dealSize },
    },
  });
  if (deal.provided?.currency && deal.provided.currency !== "USD") {
    log.warn("[Agent] Non-USD currency detected. No currency conversion is performed. Matching may be unreliable.", {
      currency: deal.provided.currency,
      scale: deal.provided.scale,
    });
  }
  if (deal.provided?.scale && deal.provided.scale !== "unit") {
    log.warn("[Agent] Scale should be 'unit' (full nominal values). Unexpected scale detected.", {
      currency: deal.provided.currency,
      scale: deal.provided.scale,
    });
  }
  // 1) ML ranking + mandate filtering
  const { modelVersion, matches } = await scoreAndRankBuyers(deal);
  const top = matches.slice(0, 5);

  // Log top matches for debugging
  log.info("[Agent] Top buyer matches", {
    totalMatches: matches.length,
    top5: top.map((m) => ({
      name: m.buyer.name,
      score: (m.score * 100).toFixed(1) + "%",
      features: {
        sectorMatch: m.features.sectorMatch,
        geoMatch: m.features.geoMatch,
        sizeFit: m.features.sizeFit,
        ebitdaFit: m.features.ebitdaFit,
        activityLevel: (m.features.activityLevel * 100).toFixed(0) + "%",
        dryPowderFit: (m.features.dryPowderFit * 100).toFixed(0) + "%",
      },
      buyer: {
        sectorFocus: m.buyer.sectorFocus,
        geographies: m.buyer.geographies,
        dealSizeRange: `$${(m.buyer.minDealSize / 1_000_000).toFixed(1)}M-$${(m.buyer.maxDealSize / 1_000_000).toFixed(1)}M`,
        ebitdaRange: `$${(m.buyer.minEbitda / 1_000_000).toFixed(1)}M-$${(m.buyer.maxEbitda / 1_000_000).toFixed(1)}M`,
      },
    })),
  });

  const buyers: BuyerMatch[] = top.map((m) => ({
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

  const llm = await claudeJson<{ dealSummary: string; outreachDrafts: OutreachDraft[] }>({
    system,
    prompt,
    maxTokens: 1100,
  });

  const fallbackSummary = `Teaser: ${deal.name} is a ${deal.sector} business in ${deal.geography} with ~$${deal.revenue}m revenue and ~$${deal.ebitda}m EBITDA. The transaction contemplates an EV of ~$${deal.dealSize}m. ${deal.description}`;

  const fallbackDrafts: OutreachDraft[] = buyers.slice(0, 3).map((b) => ({
    buyerName: b.name,
    emailSubject: `Opportunity: ${deal.name} (${deal.sector}, ${deal.geography})`,
    emailBody:
      `Hi ${b.name} team,\n\n` +
      `Sharing a new opportunity: ${deal.name} — ${deal.sector} in ${deal.geography} with ~$${deal.revenue}m revenue and ~$${deal.ebitda}m EBITDA. We’re exploring interest around an EV of ~$${deal.dealSize}m.\n\n` +
      `If this aligns with your mandate, happy to share a short teaser + set up a quick call.\n\n` +
      `Best,\nAmiya`,
  }));

  let dealSummary = fallbackSummary;
  let outreachDrafts: OutreachDraft[] = fallbackDrafts;
  let llmUsed = false;
  let llmError: string | undefined = llm.ok ? undefined : llm.error;

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
    } else {
      llmError = "Claude response schema invalid";
      log.warn("[Agent] Claude schema invalid; using fallback drafts");
    }
  }

  // Extra guardrail: forbid introducing numbers not in Deal
  const heuristicOk = outreachDrafts.every((d) => emailHasOnlyDealNumbers(d.emailBody, deal));
  if (!heuristicOk) log.warn("[Agent] Heuristic failed: email introduced unsupported numbers");

  // Second pass LLM validation: detect unsupported claims and regenerate once if needed
  if (llmUsed && outreachDrafts.length) {
    const candidateText =
      `Deal summary:\n${dealSummary}\n\n` +
      outreachDrafts.map((d) => `To: ${d.buyerName}\nSubj: ${d.emailSubject}\nBody:\n${d.emailBody}`).join("\n\n---\n\n");

    const val = await validateUnsupportedClaims({
      deal,
      candidateJson: { dealSummary, outreachDrafts },
      candidateText,
    });

    const hasIssues = (val.ok && val.unsupportedClaims.length > 0) || !heuristicOk;

    if (hasIssues) {
      log.warn("[Agent] Regenerating due to validation issues", {
        validatorIssues: val.ok ? val.unsupportedClaims.slice(0, 8) : undefined,
        heuristicOk,
      });
      const strictPrompt =
        prompt +
        `\n\nIMPORTANT STRICTNESS:\n` +
        `- You MUST NOT introduce ANY numbers, geographies, customers, margins, growth rates, or claims not explicitly present in the Deal fields above.\n` +
        `- Only mention: name, sector, geography, revenue, EBITDA, EV, and the provided description.\n` +
        `- If unsure, omit.\n` +
        (val.ok && val.unsupportedClaims.length ? `\nRemove/avoid these unsupported claims:\n- ${val.unsupportedClaims.join("\n- ")}\n` : "");

      const llm2 = await claudeJson<{ dealSummary: string; outreachDrafts: OutreachDraft[] }>({
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
            log.info("[Agent] Regeneration succeeded");
          } else {
            outreachDrafts = fallbackDrafts;
            log.warn("[Agent] Regeneration still violated heuristic; using fallback drafts");
          }
        } else {
          outreachDrafts = fallbackDrafts;
          log.warn("[Agent] Regeneration schema invalid; using fallback drafts");
        }
      } else {
        outreachDrafts = fallbackDrafts;
        log.warn("[Agent] Regeneration call failed; using fallback drafts", { error: llm2.error });
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