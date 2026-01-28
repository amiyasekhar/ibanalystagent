// Basic domain types

export type Sector =
  | "Software"
  | "IT / SaaS"
  | "Fintech"
  | "Healthcare"
  | "Pharma"
  | "Manufacturing"
  | "Business Services"
  | "Consumer"
  | "D2C / Brands"
  | "BFSI"
  | "Real Estate"
  | "Infrastructure"
  | "Agritech"
  | "EdTech"
  | "Logistics"
  | "Energy / Cleantech"
  | "Auto / EV"
  | "Media / Entertainment"
  | "Telecom"
  | "Other";

export type BuyerType = "Private Equity" | "Strategic" | "Family Office" | "Growth Equity";

export type InvestmentStage = "growth-minority" | "control-buyout" | "pre-ipo" | "minority-stake" | "distressed";

export interface DealInput {
  name: string;
  sector: Sector;
  geography: string;
  // Deal metrics as-provided (nominal numbers). Interpretation depends on provided.currency/scale.
  ebitda: number;
  revenue: number;
  dealSize: number;
  description: string;
  // Original metrics as provided in source text (currency + scale). Default currency: INR.
  provided?: {
    currency: string; // INR (default), USD, EUR
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
  type: BuyerType;
  sectorFocus: Sector[];
  geographies: string[];
  // All monetary fields in INR (fully written-out nominal values, no implicit "millions" or "crores").
  minEbitda: number;
  maxEbitda: number;
  minDealSize: number;
  maxDealSize: number;
  dryPowder: number;       // nominal "cash/capacity" number in INR
  pastDeals: number;       // count
  strategyTags: string[];  // e.g. "buy-and-build", "roll-up", "platform"
  // Extended buyer profile fields
  investmentStage?: InvestmentStage[];
  investmentThesis?: string;
  portfolioCompanies?: string[];
  reputation?: string[];
  keyPartners?: string[];
  valueAdd?: string[];
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