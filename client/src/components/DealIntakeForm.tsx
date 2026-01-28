import { useMemo } from "react";

interface DealIntakeFormProps {
  // Raw intake state
  rawIntake: string;
  setRawIntake: (value: string) => void;
  extracting: boolean;
  extractError: string | null;
  onExtract: () => void;

  // Confirmation banner
  showConfirmBanner: boolean;
  setShowConfirmBanner: (value: boolean) => void;

  // Deal fields
  dealName: string;
  setDealName: (value: string) => void;
  sector: string;
  setSector: (value: string) => void;
  geo: string;
  setGeo: (value: string) => void;
  revenue: number;
  setRevenue: (value: number) => void;
  ebitda: number;
  setEbitda: (value: number) => void;
  dealSize: number;
  setDealSize: (value: number) => void;
  description: string;
  setDescription: (value: string) => void;
  providedInfo: { currency: string; scale: string; revenue?: number; ebitda?: number; dealSize?: number } | null;
  uncertainties?: { revenue?: string; ebitda?: string; dealSize?: string };

  // Form submission (submit handled by parent form)
  loading: boolean;
  error: string | null;
  onClear: () => void;

  // Run history
  runHistory: Array<{ at: string; type: string; ok: boolean; note?: string }>;

  // Strategic advisory
  strategicAnalysis: { recommendation: string; confidence: number; rationale: string; marketContext: string; preferredBuyerTypes: string[]; timelineRecommendation: string; risks: string[]; opportunities: string[]; valuationIndicator: string } | null;
  strategicLoading: boolean;
  strategicError: string | null;
  onStrategicAdvisory: () => void;
}

export default function DealIntakeForm(props: DealIntakeFormProps) {
  const {
    rawIntake,
    setRawIntake,
    extracting,
    extractError,
    onExtract,
    showConfirmBanner,
    setShowConfirmBanner,
    dealName,
    setDealName,
    sector,
    setSector,
    geo,
    setGeo,
    revenue,
    setRevenue,
    ebitda,
    setEbitda,
    dealSize,
    setDealSize,
    description,
    setDescription,
    providedInfo,
    uncertainties,
    loading,
    error,
    onClear,
    runHistory,
    strategicAnalysis,
    strategicLoading,
    strategicError,
    onStrategicAdvisory,
  } = props;

  const quickMetrics = useMemo(() => {
    const margin = revenue > 0 ? (ebitda / revenue) * 100 : 0;
    const multiple = ebitda > 0 ? dealSize / ebitda : 0;
    return {
      margin: isFinite(margin) ? margin : 0,
      multiple: isFinite(multiple) ? multiple : 0,
    };
  }, [revenue, ebitda, dealSize]);

  return (
    <>
      <div className="field">
        <label>Raw deal text</label>
        <textarea
          rows={6}
          value={rawIntake}
          onChange={(e) => setRawIntake(e.target.value)}
          placeholder="Paste CIM blurb / broker teaser / notes. Then Extract fields → Match buyers."
        />
        <div className="actions" style={{ marginTop: 8 }}>
          <button className="ghost" type="button" onClick={onExtract} disabled={extracting || !rawIntake.trim()}>
            {extracting ? "Extracting…" : "Extract fields"}
          </button>
        </div>
        {extractError && (
          <div className="small" style={{ marginTop: 6 }}>
            ⚠ {extractError}
          </div>
        )}
      </div>

      {showConfirmBanner && rawIntake.trim() && (
        <div className="warnBox">
          <div className="warnTitle">Confirm sector & geography</div>
          <div className="small" style={{ marginTop: 4 }}>
            We default to <b>Other</b> / blank unless the text explicitly supports a sector/geo (prevents silent hallucinations).
            If you know it, override below before matching.
          </div>
          <div className="actions" style={{ marginTop: 10 }}>
            <button
              className="ghost"
              type="button"
              onClick={() => setShowConfirmBanner(false)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {uncertainties && Object.keys(uncertainties).length > 0 && (
        <div className="warnBox" style={{ borderColor: "#f59e0b", backgroundColor: "#fffbeb" }}>
          <div className="warnTitle" style={{ color: "#d97706" }}>⚠ Clarification needed</div>
          <div className="small" style={{ marginTop: 4 }}>
            We couldn't extract exact values for the following metrics. Please enter them manually below:
          </div>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {uncertainties.revenue && (
              <div style={{ padding: 8, backgroundColor: "#fff", border: "1px solid #fbbf24", borderRadius: 4 }}>
                <strong style={{ color: "#d97706" }}>Revenue:</strong> {uncertainties.revenue}
              </div>
            )}
            {uncertainties.ebitda && (
              <div style={{ padding: 8, backgroundColor: "#fff", border: "1px solid #fbbf24", borderRadius: 4 }}>
                <strong style={{ color: "#d97706" }}>EBITDA:</strong> {uncertainties.ebitda}
              </div>
            )}
            {uncertainties.dealSize && (
              <div style={{ padding: 8, backgroundColor: "#fff", border: "1px solid #fbbf24", borderRadius: 4 }}>
                <strong style={{ color: "#d97706" }}>Deal Size:</strong> {uncertainties.dealSize}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="row">
        <div className="field">
          <label>Deal name</label>
          <input
            value={dealName}
            onChange={(e) => setDealName(e.target.value)}
            placeholder="e.g. Vertical SaaS for logistics"
          />
        </div>
        <div className="field">
          <label>Sector</label>
          <input
            list="sectorOptions"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            placeholder="Type or pick (e.g. Software)"
          />
          <datalist id="sectorOptions">
            <option value="IT / SaaS" />
            <option value="Software" />
            <option value="Fintech" />
            <option value="Healthcare" />
            <option value="Pharma" />
            <option value="BFSI" />
            <option value="Manufacturing" />
            <option value="Business Services" />
            <option value="Consumer" />
            <option value="D2C / Brands" />
            <option value="Logistics" />
            <option value="Agritech" />
            <option value="EdTech" />
            <option value="Energy / Cleantech" />
            <option value="Auto / EV" />
            <option value="Real Estate" />
            <option value="Other" />
          </datalist>
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>Geography</label>
          <input value={geo} onChange={(e) => setGeo(e.target.value)} placeholder="Mumbai, Delhi NCR, Bangalore…" />
        </div>

        <div className="field">
          <label>Revenue (INR)</label>
          <input
            type="number"
            min={0}
            step={1_000_000}
            value={revenue}
            onChange={(e) => setRevenue(parseFloat(e.target.value))}
          />
          <div className="small">
            {revenue >= 10_000_000 ? `₹${(revenue / 10_000_000).toFixed(1)}Cr` : revenue >= 100_000 ? `₹${(revenue / 100_000).toFixed(1)}L` : ""}
            {providedInfo?.currency && providedInfo.currency !== "INR" ? ` (source: ${providedInfo.currency})` : ""}
          </div>
        </div>

        <div className="field">
          <label>EBITDA (INR)</label>
          <input
            type="number"
            min={0}
            step={1_000_000}
            value={ebitda}
            onChange={(e) => setEbitda(parseFloat(e.target.value))}
          />
          <div className="small">
            {ebitda >= 10_000_000 ? `₹${(ebitda / 10_000_000).toFixed(1)}Cr` : ebitda >= 100_000 ? `₹${(ebitda / 100_000).toFixed(1)}L` : ""}
            {providedInfo?.currency && providedInfo.currency !== "INR" ? ` (source: ${providedInfo.currency})` : ""}
          </div>
        </div>

        <div className="field">
          <label>EV / Deal Size (INR)</label>
          <input
            type="number"
            min={0}
            step={1_000_000}
            value={dealSize}
            onChange={(e) => setDealSize(parseFloat(e.target.value))}
          />
          <div className="small">
            {dealSize >= 10_000_000 ? `₹${(dealSize / 10_000_000).toFixed(1)}Cr` : dealSize >= 100_000 ? `₹${(dealSize / 100_000).toFixed(1)}L` : ""}
            {providedInfo?.currency && providedInfo.currency !== "INR" ? ` (source: ${providedInfo.currency})` : ""}
          </div>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k">EBITDA margin</div>
          <div className="kpiEditRow">
            <input
              className="kpiInput"
              type="number"
              step={0.1}
              min={-100}
              value={Number.isFinite(quickMetrics.margin) ? Number(quickMetrics.margin.toFixed(1)) : 0}
              onChange={(e) => {
                const m = Number(e.target.value);
                if (!Number.isFinite(m) || revenue <= 0) return;
                const newE = (revenue * m) / 100;
                setEbitda(Number.isFinite(newE) ? newE : 0);
              }}
            />
            <div className="kpiSuffix">%</div>
          </div>
        </div>
        <div className="kpi">
          <div className="k">EV / EBITDA</div>
          <div className="kpiEditRow">
            <input
              className="kpiInput"
              type="number"
              step={0.1}
              min={0}
              value={Number.isFinite(quickMetrics.multiple) ? Number(quickMetrics.multiple.toFixed(1)) : 0}
              onChange={(e) => {
                const x = Number(e.target.value);
                if (!Number.isFinite(x) || ebitda <= 0) return;
                const newEv = ebitda * x;
                setDealSize(Number.isFinite(newEv) ? newEv : 0);
              }}
            />
            <div className="kpiSuffix">×</div>
          </div>
        </div>
      </div>

      <div className="field">
        <label>Business description</label>
        <textarea
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Customers, product, differentiation, growth, retention, etc."
        />
      </div>

      {/* Strategic Advisory Section */}
      <div className="field" style={{ marginTop: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <label>Strategic Advisory</label>
          <button
            className="ghost"
            type="button"
            onClick={onStrategicAdvisory}
            disabled={strategicLoading || loading || !dealName.trim() || !revenue || !ebitda}
          >
            {strategicLoading ? "Analyzing…" : strategicAnalysis ? "Re-analyze" : "Get advisory"}
          </button>
        </div>
        {strategicError && (
          <div className="small" style={{ color: "#f59e0b", marginTop: 4 }}>⚠ {strategicError}</div>
        )}
        {strategicAnalysis && (
          <div className="warnBox" style={{ borderColor: "#7C5CFF", backgroundColor: "rgba(124,92,255,0.08)", marginTop: 8 }}>
            <div className="warnTitle" style={{ color: "#a78bfa" }}>
              {strategicAnalysis.recommendation.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.7 }}>
                {(strategicAnalysis.confidence * 100).toFixed(0)}% confidence
              </span>
            </div>
            <div className="small" style={{ marginTop: 6, lineHeight: 1.5 }}>{strategicAnalysis.rationale}</div>
            <div className="small" style={{ marginTop: 4, opacity: 0.75 }}>{strategicAnalysis.marketContext}</div>
            <div className="small" style={{ marginTop: 4, opacity: 0.65 }}>Timeline: {strategicAnalysis.timelineRecommendation}</div>
            {strategicAnalysis.preferredBuyerTypes.length > 0 && (
              <div className="small" style={{ marginTop: 6 }}>
                Preferred buyers: {strategicAnalysis.preferredBuyerTypes.map((t) => t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())).join(", ")}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="actions">
        <button className="primary" type="submit" disabled={loading}>
          {loading ? "Matching buyers…" : "Match buyers"}
        </button>
        <button className="ghost" type="button" onClick={onClear} disabled={loading}>
          Clear output
        </button>
      </div>

      {error && (
        <div className="section" style={{ marginTop: 8 }}>
          <div className="small">⚠ {error}</div>
        </div>
      )}

      {runHistory.length > 0 && (
        <div className="section" style={{ marginTop: 10 }}>
          <h3>Run history</h3>
          <div className="small">
            {runHistory.slice(0, 6).map((r, idx) => (
              <div key={`${r.at}-${idx}`}>
                {new Date(r.at).toLocaleString()} • {r.type} • {r.ok ? "ok" : "fail"}
                {r.note ? ` • ${r.note}` : ""}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
