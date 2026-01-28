import { useState } from "react";
import "./App.css";
import BuyerResults from "./components/BuyerResults";
import GenerateDealText from "./components/GenerateDealText";
import DealIntakeForm from "./components/DealIntakeForm";

type BuyerMatch = { name: string; score: number; rationale: string };
type OutreachDraft = { buyerName: string; emailSubject: string; emailBody: string };

type StrategicAnalysis = {
  recommendation: string;
  confidence: number;
  rationale: string;
  marketContext: string;
  preferredBuyerTypes: string[];
  alternativeScenarios: Array<{ scenario: string; rationale: string }>;
  risks: string[];
  opportunities: string[];
  valuationIndicator: string;
  timelineRecommendation: string;
};

type ApiResponse = { dealSummary: string; buyers: BuyerMatch[]; outreachDrafts: OutreachDraft[]; strategicRationale?: string };

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

type LeftTabKey = "deal" | "generate";

export default function App() {
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<Array<{ at: string; type: string; ok: boolean; note?: string }>>([]);
  const [leftTab, setLeftTab] = useState<LeftTabKey>("deal");

  const [dealName, setDealName] = useState("Replit Technologies");
  const [sector, setSector] = useState("IT / SaaS");
  const [geo, setGeo] = useState("Mumbai");
  const [revenue, setRevenue] = useState<number>(150_000_000);       // ₹15Cr
  const [ebitda, setEbitda] = useState<number>(37_500_000);          // ₹3.75Cr
  const [dealSize, setDealSize] = useState<number>(600_000_000);     // ₹60Cr
  const [description, setDescription] = useState(
    "B2B SaaS platform serving mid-market logistics companies in India with workflow automation, carrier integrations, and real-time tracking."
  );

  const [strategicAnalysis, setStrategicAnalysis] = useState<StrategicAnalysis | null>(null);
  const [strategicLoading, setStrategicLoading] = useState(false);
  const [strategicError, setStrategicError] = useState<string | null>(null);

  const [rawIntake, setRawIntake] = useState<string>("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [showConfirmBanner, setShowConfirmBanner] = useState(false);
  const [providedInfo, setProvidedInfo] = useState<{ currency: string; scale: string; revenue?: number; ebitda?: number; dealSize?: number } | null>(null);
  const [uncertainties, setUncertainties] = useState<{ revenue?: string; ebitda?: string; dealSize?: string } | undefined>(undefined);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);

  async function ensureWorkflow() {
    if (workflowId) return workflowId;
    const res = await fetch(`${API_BASE}/api/workflows`, { method: "POST" });
    if (!res.ok) throw new Error(`Workflow API returned ${res.status}`);
    const data = (await res.json()) as any;
    const id = String(data?.workflow?.id || "");
    if (!id) throw new Error("Bad workflow response");
    setWorkflowId(id);
    setRunHistory(Array.isArray(data?.workflow?.runs) ? data.workflow.runs : []);
    return id;
  }

  async function refreshWorkflow(id: string) {
    const res = await fetch(`${API_BASE}/api/workflows/${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as any;
    const runs = Array.isArray(data?.workflow?.runs) ? data.workflow.runs : [];
    setRunHistory(runs);
  }

  function handleUseInDealIntake(text: string) {
    setRawIntake(text);
    setLeftTab("deal");
  }

  async function handleStrategicAdvisory() {
    setStrategicLoading(true);
    setStrategicError(null);
    try {
      const res = await fetch(`${API_BASE}/api/strategic-recommendation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deal: { name: dealName, sector, geography: geo, description },
          financials: { revenue, ebitda },
        }),
      });
      if (!res.ok) throw new Error(`Strategic API returned ${res.status}`);
      const data = (await res.json()) as any;
      if (!data?.ok || !data?.analysis) throw new Error(data?.error || "Bad response");
      setStrategicAnalysis(data.analysis as StrategicAnalysis);
    } catch (err: any) {
      setStrategicError(err?.message || "Strategic advisory failed");
    } finally {
      setStrategicLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const id = await ensureWorkflow();

      // Seed deal into workflow via extract endpoint (structured text, INR nominal values)
      await fetch(`${API_BASE}/api/workflows/${id}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText:
            `Name: ${dealName}\n` +
            `Sector: ${sector}\n` +
            `Geography: ${geo}\n` +
            `Revenue (INR): ${Number(revenue)}\n` +
            `EBITDA (INR): ${Number(ebitda)}\n` +
            `EV (INR): ${Number(dealSize)}\n` +
            `Description: ${description}`,
        }),
      });

      const matchBody: any = {};
      if (strategicAnalysis) matchBody.strategicAnalysis = strategicAnalysis;
      const res = await fetch(`${API_BASE}/api/workflows/${id}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(matchBody),
      });
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const payload = (await res.json()) as any;
      const data: ApiResponse = payload?.result;
      setResult(data || null);
      await refreshWorkflow(id);
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleExtract() {
    const text = rawIntake.trim();
    if (!text) return;
    setExtracting(true);
    setExtractError(null);
    try {
      const id = await ensureWorkflow();
      const res = await fetch(`${API_BASE}/api/workflows/${id}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: text }),
      });
      if (!res.ok) throw new Error(`Extract API returned ${res.status}`);
      const data = (await res.json()) as any;
      if (!data?.ok || !data?.deal) throw new Error("Bad extract response");

      setDealName(String(data.deal.name || ""));
      setSector(String(data.deal.sector || "Other"));
      setGeo(String(data.deal.geography || ""));
      setRevenue(Number(data.deal.revenue || 0));
      setEbitda(Number(data.deal.ebitda || 0));
      setDealSize(Number(data.deal.dealSize || 0));
      setDescription(String(data.deal.description || ""));
      setProvidedInfo(data?.deal?.provided ? (data.deal.provided as any) : null);
      setUncertainties(data?.deal?.uncertainties || undefined);
      const needsConfirm = String(data.deal.sector || "Other") === "Other" || !String(data.deal.geography || "").trim();
      setShowConfirmBanner(needsConfirm);
      await refreshWorkflow(id);
    } catch (err: any) {
      setExtractError(err?.message || "Extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  async function onNewWorkflow() {
    try {
      const res = await fetch(`${API_BASE}/api/workflows`, { method: "POST" });
      if (!res.ok) throw new Error(`Workflow API returned ${res.status}`);
      const data = (await res.json()) as any;
      const id = String(data?.workflow?.id || "");
      if (!id) throw new Error("Bad workflow response");
      setWorkflowId(id);
      setRunHistory(Array.isArray(data?.workflow?.runs) ? data.workflow.runs : []);
      setResult(null);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to create workflow");
    }
  }

  function onClear() {
    setResult(null);
    setError(null);
  }

  const statusText = result ? "Ready" : loading ? "Running…" : "Idle";
  const dotClass = loading ? "live" : result ? "live" : "";

  return (
    <>
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">OD</div>
          <div className="brandText">
            <div className="name">OffDeal Analyst Co-Pilot</div>
            <div className="tag">AI-native workflow • strategic advisory • buyer matching • outreach drafts</div>
          </div>
        </div>

        <div className="statusPill">
          <span className={`dot ${dotClass}`} />
          <span>{statusText}</span>
        </div>
      </header>

      <main className="grid">
        {/* LEFT */}
        <section className="card">
          <div className="cardHeader">
            <div>
              <h2>Deal Intake</h2>
              <p>Enter a teaser-style summary. The agent returns ranked buyers + drafts.</p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div className="badge">Demo</div>
              <button className="ghost" type="button" onClick={onNewWorkflow} disabled={loading || extracting}>
                New workflow
              </button>
            </div>
          </div>

          <form className="form" onSubmit={handleSubmit}>
            <div className="pillRow" style={{ marginTop: 6 }}>
              <button
                type="button"
                className={`pill ${leftTab === "generate" ? "pillActive" : ""}`}
                onClick={() => setLeftTab("generate")}
              >
                Generate deal text
              </button>
              <button
                type="button"
                className={`pill ${leftTab === "deal" ? "pillActive" : ""}`}
                onClick={() => setLeftTab("deal")}
              >
                Deal intake
              </button>
            </div>

            {leftTab === "generate" && <GenerateDealText onUseInDealIntake={handleUseInDealIntake} />}

            {leftTab === "deal" && (
              <DealIntakeForm
                rawIntake={rawIntake}
                setRawIntake={setRawIntake}
                extracting={extracting}
                extractError={extractError}
                onExtract={handleExtract}
                showConfirmBanner={showConfirmBanner}
                setShowConfirmBanner={setShowConfirmBanner}
                dealName={dealName}
                setDealName={setDealName}
                sector={sector}
                setSector={setSector}
                geo={geo}
                setGeo={setGeo}
                revenue={revenue}
                setRevenue={setRevenue}
                ebitda={ebitda}
                setEbitda={setEbitda}
                dealSize={dealSize}
                setDealSize={setDealSize}
                description={description}
                setDescription={setDescription}
                providedInfo={providedInfo}
                uncertainties={uncertainties}
                loading={loading}
                error={error}
                onClear={onClear}
                runHistory={runHistory}
                strategicAnalysis={strategicAnalysis}
                strategicLoading={strategicLoading}
                strategicError={strategicError}
                onStrategicAdvisory={handleStrategicAdvisory}
              />
            )}
          </form>
        </section>

        {/* RIGHT */}
        <section className="card">
          <div className="cardHeader">
            <div>
              <h2>Output</h2>
              <p>Ranked buyers, reasoning, and 1-click outreach drafts.</p>
            </div>
            <div className="badge">{result ? "Results" : "Waiting"}</div>
          </div>

          {!result && !error && (
            <div className="empty">
              <h3>Run a match to see results</h3>
              <div className="small">
                You’ll get a deal summary, a ranked buyer list with match scores, and outreach drafts.
              </div>
              <ul className="small" style={{ marginTop: 10 }}>
                <li>Keep the description specific: ICP, product, moat, retention.</li>
                <li>Provide realistic EBITDA to improve buyer fit scoring.</li>
              </ul>
            </div>
          )}

          {result && <BuyerResults result={result} />}
        </section>
      </main>

      <footer className="footer">Built for a 1-day demo: agentic workflow + ML scoring + full-stack TypeScript.</footer>
    </div>
    </>
  );
}