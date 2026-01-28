import { claudeJson } from "./claude";
import { log } from "./logger";

export type StrategicRecommendation =
  | "exit-now"
  | "raise-growth-then-exit"
  | "recap-dividend"
  | "minority-stake"
  | "hold-grow";

export type BuyerPreference =
  | "strategic-acquirer"
  | "financial-PE-buyout"
  | "growth-equity"
  | "family-office"
  | "impact-investor";

export interface CompanyFinancials {
  revenue: number;                // INR annual revenue
  ebitda: number;                 // INR annual EBITDA
  revenueGrowthPct?: number;      // YoY revenue growth %
  ebitdaMarginPct?: number;       // EBITDA margin %
  cashPosition?: number;          // Cash on hand (INR)
  debt?: number;                  // Total debt (INR)
  employeeCount?: number;
  foundedYear?: number;
}

export interface StrategicAnalysis {
  recommendation: StrategicRecommendation;
  confidence: number;
  rationale: string;
  marketContext: string;
  preferredBuyerTypes: BuyerPreference[];
  alternativeScenarios: Array<{
    scenario: StrategicRecommendation;
    rationale: string;
  }>;
  risks: string[];
  opportunities: string[];
  valuationIndicator: string;
  timelineRecommendation: string;
}

const ADVISOR_SYSTEM = `You are a senior investment banking advisor at a top-tier Indian IB firm.
Your role is to analyze a company's financial profile and market conditions to recommend the optimal transaction strategy.
You think in terms of what maximizes value for both the company (seller) and the bank (advisor).

Key principles:
- Consider timing risk: is now the right time to transact, or should the company raise capital first?
- Market headwinds vs tailwinds: regulatory changes, sector growth, competition dynamics
- Financial health signals: revenue trajectory, margins, cash position, debt load
- India-specific context: PE market activity in the sector, strategic acquirer appetite, family office interest
- Be opinionated: a good advisor has a clear view, not a wishy-washy hedge

Return STRICT JSON only. No markdown. No extra commentary.`;

export async function getStrategicRecommendation(input: {
  deal: {
    name: string;
    sector: string;
    geography?: string;
    description?: string;
  };
  financials: CompanyFinancials;
  bankerNotes?: string;
}): Promise<{ ok: true; analysis: StrategicAnalysis } | { ok: false; error: string }> {
  const { deal, financials, bankerNotes } = input;

  const prompt = `Company Profile:
- Name: ${deal.name}
- Sector: ${deal.sector}
- Geography: ${deal.geography || "India"}
- Description: ${deal.description || "Not provided"}

Financial Metrics (all in INR):
- Annual Revenue: ₹${(financials.revenue / 10_000_000).toFixed(1)}Cr
- Annual EBITDA: ₹${(financials.ebitda / 10_000_000).toFixed(1)}Cr
- EBITDA Margin: ${financials.ebitdaMarginPct != null ? financials.ebitdaMarginPct.toFixed(1) + "%" : "Not provided"}
- Revenue Growth (YoY): ${financials.revenueGrowthPct != null ? financials.revenueGrowthPct.toFixed(1) + "%" : "Not provided"}
- Cash Position: ${financials.cashPosition != null ? "₹" + (financials.cashPosition / 10_000_000).toFixed(1) + "Cr" : "Not provided"}
- Total Debt: ${financials.debt != null ? "₹" + (financials.debt / 10_000_000).toFixed(1) + "Cr" : "Not provided"}
- Employees: ${financials.employeeCount || "Not provided"}
- Founded: ${financials.foundedYear || "Not provided"}

${bankerNotes ? `Banker's Notes / Client Intent:\n${bankerNotes}\n` : ""}

Analysis Task:
Based on the above, recommend the optimal transaction strategy that maximizes value for both the company and the advising bank. Consider:
1. Should the company exit now, or would raising growth capital first increase valuation at exit?
2. Are there sector headwinds that make immediate exit attractive?
3. Or sector tailwinds that make waiting/growing more valuable?
4. What type of buyer/investor is most relevant given the recommendation?
5. What are the key risks of waiting vs acting now?

Return this EXACT JSON shape:
{
  "recommendation": "<one of: exit-now | raise-growth-then-exit | recap-dividend | minority-stake | hold-grow>",
  "confidence": <number 0-1>,
  "rationale": "<2-4 sentences explaining the primary recommendation and WHY it maximizes value>",
  "marketContext": "<1-2 sentences on current sector/market conditions in India relevant to this company>",
  "preferredBuyerTypes": ["<array of: strategic-acquirer | financial-PE-buyout | growth-equity | family-office | impact-investor>"],
  "alternativeScenarios": [
    { "scenario": "<alternative recommendation>", "rationale": "<why this could also work, 1-2 sentences>" }
  ],
  "risks": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "opportunities": ["<opportunity 1>", "<opportunity 2>"],
  "valuationIndicator": "<e.g. '12-15x EBITDA based on comparable transactions in this sector'>",
  "timelineRecommendation": "<e.g. 'Proceed immediately' or 'Raise Series B first, revisit exit in 12-18 months'>"
}`;

  try {
    const result = await claudeJson<StrategicAnalysis>({
      system: ADVISOR_SYSTEM,
      prompt,
      maxTokens: 1800,
      temperature: 0.3,
    });

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const validRecs = ["exit-now", "raise-growth-then-exit", "recap-dividend", "minority-stake", "hold-grow"];
    if (!validRecs.includes(result.data.recommendation)) {
      log.warn("[StrategicAdvisor] Invalid recommendation value", { got: result.data.recommendation });
      return { ok: false, error: "Invalid recommendation from LLM" };
    }

    log.info("[StrategicAdvisor] Recommendation generated", {
      recommendation: result.data.recommendation,
      confidence: result.data.confidence,
      preferredBuyerTypes: result.data.preferredBuyerTypes,
    });

    return { ok: true, analysis: result.data as StrategicAnalysis };
  } catch (e: any) {
    log.error("[StrategicAdvisor] Failed", { error: e?.message || String(e) });
    return { ok: false, error: e?.message || "Strategic analysis failed" };
  }
}

// Maps strategic recommendation to buyer type score multipliers for ranking adjustment
export function getBuyerTypeWeights(recommendation: StrategicRecommendation): Record<string, number> {
  switch (recommendation) {
    case "exit-now":
      return {
        "Strategic": 1.3,
        "Private Equity": 1.2,
        "Family Office": 0.9,
        "Growth Equity": 0.6,
      };
    case "raise-growth-then-exit":
      return {
        "Growth Equity": 1.4,
        "Family Office": 1.2,
        "Private Equity": 0.8,
        "Strategic": 0.7,
      };
    case "recap-dividend":
      return {
        "Private Equity": 1.4,
        "Family Office": 1.3,
        "Strategic": 0.8,
        "Growth Equity": 0.6,
      };
    case "minority-stake":
      return {
        "Family Office": 1.4,
        "Growth Equity": 1.3,
        "Strategic": 1.0,
        "Private Equity": 0.9,
      };
    case "hold-grow":
      return {
        "Growth Equity": 1.2,
        "Family Office": 1.3,
        "Strategic": 0.8,
        "Private Equity": 0.7,
      };
    default:
      return { "Strategic": 1.0, "Private Equity": 1.0, "Family Office": 1.0, "Growth Equity": 1.0 };
  }
}
