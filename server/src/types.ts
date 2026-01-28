// Basic domain types

export type Sector =
  | "Software"
  | "Healthcare"
  | "Manufacturing"
  | "Business Services"
  | "Consumer"
  | "Other";

export interface DealInput {
  name: string;
  sector: Sector;
  geography: string;
  // Deal metrics as-provided (nominal numbers). Interpretation depends on provided.currency/scale.
  ebitda: number;
  revenue: number;
  dealSize: number;
  description: string;
  // Original metrics as provided in source text (currency + scale)
  provided?: {
    // informational only; we do not normalize currencies right now
    currency: string; // e.g. USD, INR, EUR (best-effort)
    scale: "m" | "crore" | "b" | "t" | "k" | "unit"; // unit indicates already expanded to full nominal units
    revenue?: number;
    ebitda?: number;
    dealSize?: number;
  };
  // Uncertainty warnings for metrics that need user clarification
  uncertainties?: {
    revenue?: string;
    ebitda?: string;
    dealSize?: string;
  };
}

export interface BuyerProfile {
  id: string;
  name: string;
  type: "Private Equity" | "Strategic";
  sectorFocus: Sector[];
  geographies: string[];
  // All monetary fields are fully written-out nominal values (no implicit "millions").
  minEbitda: number;
  maxEbitda: number;
  minDealSize: number;
  maxDealSize: number;
  dryPowder: number;       // nominal "cash/capacity" number
  pastDeals: number;       // count
  strategyTags: string[];  // e.g. "buy-and-build", "roll-up", "platform"
}

export interface BuyerMatchScore {
  buyer: BuyerProfile;
  score: number;            // 0–1
  features: {
    sectorMatch: number;
    geoMatch: number;
    sizeFit: number;
    dryPowderFit: number;
    activityLevel: number;
    ebitdaFit: number;
  };
}

export interface DealSummary {
  oneLiner: string;
  highlights: string[];
  riskFactors: string[];
}

export interface OutreachEmail {
  buyerId: string;
  buyerName: string;
  subject: string;
  body: string;
}

export interface MatchRequest {
  deal: DealInput;
}

export interface MatchResponse {
  dealSummary: DealSummary;
  matches: BuyerMatchScore[];
  outreachDrafts: OutreachEmail[];
}