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
  ebitda: number;        // in millions
  revenue: number;       // in millions
  dealSize: number;      // enterprise value in millions
  description: string;
}

export interface BuyerProfile {
  id: string;
  name: string;
  type: "Private Equity" | "Strategic";
  sectorFocus: Sector[];
  geographies: string[];
  minEbitda: number;
  maxEbitda: number;
  minDealSize: number;
  maxDealSize: number;
  dryPowder: number;       // available capital in millions
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