import { useState } from "react";
import DealSummary from "./DealSummary";
import BuyerMatchList from "./BuyerMatchList";
import OutreachDrafts from "./OutreachDrafts";
import BuyerSearch from "./BuyerSearch";

type BuyerMatch = {
  name: string;
  score: number;
  rationale: string;
};

type OutreachDraft = {
  buyerName: string;
  emailSubject: string;
  emailBody: string;
};

type ApiResponse = {
  dealSummary: string;
  buyers: BuyerMatch[];
  outreachDrafts: OutreachDraft[];
};

type TabKey = "summary" | "buyers" | "outreach" | "search";

interface BuyerResultsProps {
  result: ApiResponse;
}

export default function BuyerResults({ result }: BuyerResultsProps) {
  const [tab, setTab] = useState<TabKey>("summary");

  return (
    <div className="output">
      {/* Tabs */}
      <div className="pillRow">
        <button
          type="button"
          className={`pill ${tab === "summary" ? "pillActive" : ""}`}
          onClick={() => setTab("summary")}
        >
          Summary
        </button>
        <button
          type="button"
          className={`pill ${tab === "buyers" ? "pillActive" : ""}`}
          onClick={() => setTab("buyers")}
        >
          Buyers ({result.buyers.length})
        </button>
        <button
          type="button"
          className={`pill ${tab === "outreach" ? "pillActive" : ""}`}
          onClick={() => setTab("outreach")}
        >
          Outreach ({result.outreachDrafts.length})
        </button>
        <button
          type="button"
          className={`pill ${tab === "search" ? "pillActive" : ""}`}
          onClick={() => setTab("search")}
        >
          Buyer Search
        </button>
      </div>

      {tab === "summary" && <DealSummary summary={result.dealSummary} />}
      {tab === "buyers" && <BuyerMatchList buyers={result.buyers} />}
      {tab === "outreach" && <OutreachDrafts drafts={result.outreachDrafts} />}
      {tab === "search" && <BuyerSearch />}
    </div>
  );
}
