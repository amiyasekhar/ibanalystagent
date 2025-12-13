import { claudeJson } from "./claude";
import { BUYERS } from "./buyers";
import { inferBuyerScoresPython } from "./pythonMl";
import { BuyerMatchScore, DealInput } from "./types";

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

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function buildRationale(m: BuyerMatchScore): string {
  const f = m.features;
  const b = m.buyer;
  const parts: string[] = [];
  parts.push(f.sectorMatch ? "Sector match" : "Sector adjacency");
  parts.push(f.geoMatch ? "Geo match" : "Geo flexible");
  parts.push(f.sizeFit ? `Size fit (${b.minDealSize}–${b.maxDealSize}m EV)` : `Out-of-range size (${b.minDealSize}–${b.maxDealSize}m EV)`);
  // EBITDA fit is a real mandate constraint
  parts.push(f.ebitdaFit ? `EBITDA fit (${b.minEbitda}–${b.maxEbitda}m)` : `EBITDA out-of-range (${b.minEbitda}–${b.maxEbitda}m)`);
  parts.push(`Activity ${(clamp01(f.activityLevel) * 100).toFixed(0)}%`);
  parts.push(`Capital ${(clamp01(f.dryPowderFit) * 100).toFixed(0)}%`);
  if (b.strategyTags?.length) parts.push(`Tags: ${b.strategyTags.slice(0, 3).join(", ")}`);
  return parts.join(" • ");
}

function applyMandateFilters(scores: BuyerMatchScore[]): BuyerMatchScore[] {
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
  const filtered = applyMandateFilters(matches);
  filtered.sort((a, b) => b.score - a.score);

  return { modelVersion: py.modelVersion, matches: filtered.slice(0, 5) };
}

export async function runAnalystAgent(deal: DealInput): Promise<AgentResult> {
  // 1) ML ranking + mandate filtering
  const { modelVersion, matches } = await scoreAndRankBuyers(deal);
  const top = matches.slice(0, 5);

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
- Revenue ($m): ${deal.revenue}
- EBITDA ($m): ${deal.ebitda}
- EV / Deal Size ($m): ${deal.dealSize}
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

  const outreachDrafts: OutreachDraft[] =
    llm.ok && Array.isArray(llm.data.outreachDrafts) && llm.data.outreachDrafts.length
      ? llm.data.outreachDrafts.slice(0, 3)
      : buyers.slice(0, 3).map((b) => ({
          buyerName: b.name,
          emailSubject: `Opportunity: ${deal.name} (${deal.sector}, ${deal.geography})`,
          emailBody:
            `Hi ${b.name} team,\n\n` +
            `Sharing a new opportunity: ${deal.name} — ${deal.sector} in ${deal.geography} with ~$${deal.revenue}m revenue and ~$${deal.ebitda}m EBITDA. We’re exploring interest around an EV of ~$${deal.dealSize}m.\n\n` +
            `If this aligns with your mandate, happy to share a short teaser + set up a quick call.\n\n` +
            `Best,\nAmiya`,
        }));

  const dealSummary = llm.ok && typeof llm.data.dealSummary === "string" ? llm.data.dealSummary : fallbackSummary;

  return {
    dealSummary,
    buyers,
    outreachDrafts,
    modelVersion,
    llmUsed: llm.ok,
    llmError: llm.ok ? undefined : llm.error,
  };
}