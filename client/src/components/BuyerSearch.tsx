import { useState } from "react";

type BuyerSearchResult = {
  id: string;
  name: string;
  type: "Private Equity" | "Strategic";
  sectorFocus: string[];
  geographies: string[];
  minDealSize: number;
  maxDealSize: number;
  minEbitda: number;
  maxEbitda: number;
  strategyTags: string[];
  score: number;
  reason: string;
};

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

function clamp01(x: number) {
  if (!isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export default function BuyerSearch() {
  const [searchQ, setSearchQ] = useState("");
  const [searchSector, setSearchSector] = useState<string>("Any");
  const [searchGeo, setSearchGeo] = useState<string>("");
  const [searchType, setSearchType] = useState<string>("Any");
  const [searchTag, setSearchTag] = useState<string>("");
  const [searchMinDeal, setSearchMinDeal] = useState<string>("");
  const [searchMaxDeal, setSearchMaxDeal] = useState<string>("");
  const [searchMinEbitda, setSearchMinEbitda] = useState<string>("");
  const [searchMaxEbitda, setSearchMaxEbitda] = useState<string>("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<BuyerSearchResult[]>([]);

  async function runBuyerSearch() {
    setSearchLoading(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams();
      if (searchQ.trim()) params.set("q", searchQ.trim());
      if (searchSector && searchSector !== "Any") params.set("sector", searchSector);
      if (searchGeo.trim()) params.set("geography", searchGeo.trim());
      if (searchType && searchType !== "Any") params.set("type", searchType);
      if (searchTag.trim()) params.set("tag", searchTag.trim());
      if (searchMinDeal.trim()) params.set("minDeal", searchMinDeal.trim());
      if (searchMaxDeal.trim()) params.set("maxDeal", searchMaxDeal.trim());
      if (searchMinEbitda.trim()) params.set("minEbitda", searchMinEbitda.trim());
      if (searchMaxEbitda.trim()) params.set("maxEbitda", searchMaxEbitda.trim());
      params.set("limit", "25");

      const res = await fetch(`${API_BASE}/api/buyers/search?${params.toString()}`);
      if (!res.ok) throw new Error(`Search API returned ${res.status}`);
      const data = (await res.json()) as any;
      if (!data?.ok || !Array.isArray(data?.results)) throw new Error("Bad search response");
      setSearchResults(data.results);
    } catch (err: any) {
      setSearchError(err?.message || "Search failed");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  return (
    <div className="section">
      <h3>Buyer search</h3>
      <div className="small" style={{ marginBottom: 8 }}>
        Search the buyer universe with keywords + filters. (This is separate from deal matching.)
      </div>

      <div className="row">
        <div className="field">
          <label>Query</label>
          <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="e.g. roll-up software US" />
        </div>
        <div className="field">
          <label>Type</label>
          <select value={searchType} onChange={(e) => setSearchType(e.target.value)}>
            <option>Any</option>
            <option>Private Equity</option>
            <option>Strategic</option>
          </select>
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>Sector</label>
          <select value={searchSector} onChange={(e) => setSearchSector(e.target.value)}>
            <option>Any</option>
            <option>Software</option>
            <option>Healthcare</option>
            <option>Manufacturing</option>
            <option>Business Services</option>
            <option>Consumer</option>
            <option>Other</option>
          </select>
        </div>
        <div className="field">
          <label>Geography</label>
          <input value={searchGeo} onChange={(e) => setSearchGeo(e.target.value)} placeholder="US, UK, Europe…" />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>Tag</label>
          <input value={searchTag} onChange={(e) => setSearchTag(e.target.value)} placeholder="buy-and-build, synergies…" />
        </div>
        <div className="field">
          <label>EV ($m) min</label>
          <input value={searchMinDeal} onChange={(e) => setSearchMinDeal(e.target.value)} placeholder="e.g. 25" />
        </div>
        <div className="field">
          <label>EV ($m) max</label>
          <input value={searchMaxDeal} onChange={(e) => setSearchMaxDeal(e.target.value)} placeholder="e.g. 150" />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>EBITDA ($m) min</label>
          <input value={searchMinEbitda} onChange={(e) => setSearchMinEbitda(e.target.value)} placeholder="e.g. 3" />
        </div>
        <div className="field">
          <label>EBITDA ($m) max</label>
          <input value={searchMaxEbitda} onChange={(e) => setSearchMaxEbitda(e.target.value)} placeholder="e.g. 20" />
        </div>
        <div className="field" style={{ alignSelf: "end" }}>
          <button className="primary" type="button" onClick={runBuyerSearch} disabled={searchLoading}>
            {searchLoading ? "Searching…" : "Search"}
          </button>
        </div>
      </div>

      {searchError && (
        <div className="small" style={{ marginTop: 6 }}>
          ⚠ {searchError}
        </div>
      )}

      <div className="buyers" style={{ marginTop: 10 }}>
        {searchResults.map((b, i) => (
          <div className="buyer" key={b.id}>
            <div className="buyerTop">
              <div className="buyerName">
                <span className="rank">#{i + 1}</span> {b.name}
              </div>
              <div className="score">{Math.round(clamp01(b.score / 10) * 100)}%</div>
            </div>
            <div className="buyerWhy">{b.reason}</div>
            <div className="small" style={{ marginTop: 6 }}>
              {b.type} • Sectors: {b.sectorFocus.join(", ")} • Geos: {b.geographies.join(", ")} • EV: {b.minDealSize}–{b.maxDealSize} • EBITDA: {b.minEbitda}–{b.maxEbitda}
            </div>
          </div>
        ))}
        {searchResults.length === 0 && !searchLoading && !searchError && (
          <div className="small">No results yet — run a search.</div>
        )}
      </div>
    </div>
  );
}
