import { useMemo, useRef, useState } from "react";
import "./App.css";

type BuyerMatch = { name: string; score: number; rationale: string };
type OutreachDraft = { buyerName: string; emailSubject: string; emailBody: string };
type ApiResponse = { dealSummary: string; buyers: BuyerMatch[]; outreachDrafts: OutreachDraft[] };
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

type TabKey = "summary" | "buyers" | "outreach" | "search";
type LeftTabKey = "deal" | "generate";

function clamp01(x: number) {
  if (!isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function App() {
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<Array<{ at: string; type: string; ok: boolean; note?: string }>>([]);

  const [genCompanyName, setGenCompanyName] = useState<string>("");
  const [genCompanyDesc, setGenCompanyDesc] = useState<string>("");
  const [genFinancialText, setGenFinancialText] = useState<string>("");
  const [genPdfPaths, setGenPdfPaths] = useState<string>("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfHighlight, setPdfHighlight] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);
  const [pdfDragging, setPdfDragging] = useState(false);
  const [pdfQueuedFiles, setPdfQueuedFiles] = useState<File[]>([]);
  const [pdfUploadedNames, setPdfUploadedNames] = useState<string[]>([]);
  const [pdfExtractYears, setPdfExtractYears] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genUsed, setGenUsed] = useState<string | null>(null);
  const [genOutput, setGenOutput] = useState<string>("");
  const [leftTab, setLeftTab] = useState<LeftTabKey>("deal");

  const [dealName, setDealName] = useState("B2B SaaS for logistics");
  const [sector, setSector] = useState("Software");
  const [geo, setGeo] = useState("US");
  const [revenue, setRevenue] = useState<number>(15);
  const [ebitda, setEbitda] = useState<number>(5);
  const [dealSize, setDealSize] = useState<number>(60);
  const [description, setDescription] = useState(
    "Vertical SaaS platform serving mid-market logistics companies with workflow automation and carrier integrations."
  );

  const [rawIntake, setRawIntake] = useState<string>("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [showConfirmBanner, setShowConfirmBanner] = useState(false);
  const [providedInfo, setProvidedInfo] = useState<{ currency: string; scale: string; revenue?: number; ebitda?: number; dealSize?: number } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [tab, setTab] = useState<TabKey>("summary");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

  const quickMetrics = useMemo(() => {
    const margin = revenue > 0 ? (ebitda / revenue) * 100 : 0;
    const multiple = ebitda > 0 ? dealSize / ebitda : 0;
    return {
      margin: isFinite(margin) ? margin : 0,
      multiple: isFinite(multiple) ? multiple : 0,
    };
  }, [revenue, ebitda, dealSize]);

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

  async function handleGenerateRawDealText() {
    setGenLoading(true);
    setGenError(null);
    setGenUsed(null);
    try {
      const res = await fetch(`${API_BASE}/api/generate-raw-deal-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: genCompanyName,
          companyDescription: genCompanyDesc,
          financialText: genFinancialText,
        }),
      });
      if (!res.ok) throw new Error(`Generator API returned ${res.status}`);
      const data = (await res.json()) as any;
      if (!data?.ok || typeof data?.rawText !== "string") throw new Error("Bad generator response");
      setGenOutput(String(data.rawText));
      setGenUsed(String(data.used || ""));
      setLeftTab("generate");
    } catch (err: any) {
      setGenError(err?.message || "Generation failed");
    } finally {
      setGenLoading(false);
    }
  }

  async function handleExtractFinancialsFromPdf() {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const pdfPaths = genPdfPaths
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!pdfPaths.length) throw new Error("Enter at least one PDF path");

      const res = await fetch(`${API_BASE}/api/extract-financials-from-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfPaths, highlight: pdfHighlight }),
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(data?.error || `PDF extract API returned ${res.status}`);
      if (!data?.ok || typeof data?.tableText !== "string") throw new Error(data?.error || "Bad PDF extract response");
      setGenFinancialText(String(data.tableText));
    } catch (e: any) {
      setPdfError(e?.message || "PDF extraction failed");
    } finally {
      setPdfLoading(false);
    }
  }

  async function uploadAndExtractPdfs(files: FileList | File[]) {
    setPdfLoading(true);
    setPdfError(null);
    setPdfStatus(null);
    try {
      const arr = Array.from(files || []);
      if (!arr.length) throw new Error("No files selected");
      setPdfUploadedNames(arr.map((f) => f.name));
      setPdfStatus(`Processing ${arr.length} PDF(s)…`);

      const fd = new FormData();
      for (const f of arr) fd.append("pdfs", f);
      fd.append("highlight", String(pdfHighlight));

      const res = await fetch(`${API_BASE}/api/extract-financials-from-upload`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(data?.error || `Upload API returned ${res.status}`);
      if (!data?.ok || typeof data?.tableText !== "string") throw new Error(data?.error || "Bad upload response");
      setGenFinancialText(String(data.tableText));
      setPdfExtractYears(Array.isArray(data?.years) ? data.years : []);
      const uploaded = Array.isArray(data?.uploaded) ? data.uploaded : [];
      const years = Array.isArray(data?.years) ? data.years : [];
      const yearLabels = years
        .map((y: any) => String(y?.year_label || "").trim())
        .filter(Boolean)
        .slice(0, 6);
      const nameList =
        uploaded.length > 0 ? uploaded.map((u: any) => String(u?.originalName || "")).filter(Boolean) : pdfUploadedNames;
      const compactNames = nameList.slice(0, 3).join(", ") + (nameList.length > 3 ? ` +${nameList.length - 3} more` : "");
      const yearsText = yearLabels.length ? ` • years: ${yearLabels.join(", ")}` : "";
      setPdfStatus(`Extracted financials from ${uploaded.length || arr.length} PDF(s)${compactNames ? ` (${compactNames})` : ""}${yearsText}`);
    } catch (e: any) {
      setPdfError(e?.message || "Upload failed");
    } finally {
      setPdfLoading(false);
    }
  }

  function addQueuedFiles(list: FileList | File[]) {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    const onlyPdf = incoming.filter((f) => (f.type || "").toLowerCase() === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    setPdfQueuedFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
      const next = [...prev];
      for (const f of onlyPdf) {
        const key = `${f.name}:${f.size}:${f.lastModified}`;
        if (!seen.has(key)) next.push(f);
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const id = await ensureWorkflow();

      // update deal in workflow by calling extract endpoint with structured text (simple approach)
      // (for now: reuse existing extract endpoint would be better, but we keep it minimal)
      await fetch(`${API_BASE}/api/workflows/${id}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText:
            `Name: ${dealName}\n` +
            `Sector: ${sector}\n` +
            `Geography: ${geo}\n` +
            `Revenue ($m): ${Number(revenue)}\n` +
            `EBITDA ($m): ${Number(ebitda)}\n` +
            `EV ($m): ${Number(dealSize)}\n` +
            `Description: ${description}`,
        }),
      });

      const res = await fetch(`${API_BASE}/api/workflows/${id}/match`, { method: "POST" });
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const payload = (await res.json()) as any;
      const data: ApiResponse = payload?.result;
      setResult(data || null);
      setTab("summary");
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
      setTab("summary");
    } catch (err: any) {
      setError(err?.message || "Failed to create workflow");
    }
  }

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
      setTab("search");
    } catch (err: any) {
      setSearchError(err?.message || "Search failed");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  function onClear() {
    setResult(null);
    setError(null);
    setTab("summary");
  }

  async function onCopy(key: string, text: string) {
    const ok = await copyToClipboard(text);
    setCopiedKey(ok ? key : null);
    if (ok) {
      window.setTimeout(() => setCopiedKey(null), 1100);
    }
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
            <div className="tag">AI-native workflow • buyer matching • outreach drafts</div>
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
            <div className="small" style={{ marginTop: -6 }}>
              Workflow: <span className="mono">{workflowId || "—"}</span>
            </div>

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

            {leftTab === "generate" && (
              <div className="section">
                <h3>Generate raw deal text</h3>
                <div className="small" style={{ marginBottom: 8 }}>
                  Enter a company name (and optionally description + pasted financial table) to generate a teaser-style raw blurb.
                </div>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>Upload PDFs (optional)</label>
                  <div
                    className={`dropzone ${pdfDragging ? "dropzoneActive" : ""}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPdfDragging(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPdfDragging(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPdfDragging(false);
                      if (e.dataTransfer?.files?.length) addQueuedFiles(e.dataTransfer.files);
                    }}
                  >
                    <div className="dropzoneTitle">Drag & drop PDF(s) here (as many as you want)</div>
                    <div className="small" style={{ marginTop: 4 }}>
                      Drop PDFs to queue them. Then click <b>Generate deal info</b> to extract financials and auto-fill the Financial input box.
                    </div>
                    <div className="actions" style={{ marginTop: 10 }}>
                      <button
                        className="ghost"
                        type="button"
                        disabled={pdfLoading}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                      >
                        Choose PDF(s)
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/pdf"
                        multiple
                        onChange={(e) => {
                          if (e.target.files?.length) addQueuedFiles(e.target.files);
                        }}
                        style={{ display: "none" }}
                      />
                      <label
                        className="checkRow"
                        onClick={(e) => {
                          // prevent dropzone click from opening finder when toggling checkbox
                          e.stopPropagation();
                        }}
                      >
                        <input type="checkbox" checked={pdfHighlight} onChange={(e) => setPdfHighlight(e.target.checked)} />
                        <span className="small">Write highlighted PDF(s)</span>
                      </label>
                      <button
                        className="primary"
                        type="button"
                        disabled={pdfLoading || pdfQueuedFiles.length === 0}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          uploadAndExtractPdfs(pdfQueuedFiles);
                        }}
                      >
                        {pdfLoading ? "Generating…" : "Generate deal info"}
                      </button>
                      {pdfQueuedFiles.length > 0 && (
                        <button
                          className="ghost"
                          type="button"
                          disabled={pdfLoading}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setPdfQueuedFiles([]);
                            setPdfStatus(null);
                            setPdfError(null);
                            setPdfExtractYears([]);
                          }}
                        >
                          Clear PDFs
                        </button>
                      )}
                      {genFinancialText.trim() && (
                        <button
                          className="ghost"
                          type="button"
                          disabled={pdfLoading}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setGenFinancialText("");
                            setPdfStatus(null);
                            setPdfError(null);
                            setPdfExtractYears([]);
                          }}
                        >
                          Clear financials
                        </button>
                      )}
                    </div>
                    {pdfQueuedFiles.length > 0 && (
                      <div className="small" style={{ marginTop: 10 }}>
                        <b>Queued:</b>{" "}
                        {pdfQueuedFiles.length <= 6
                          ? pdfQueuedFiles.map((f) => f.name).join(", ")
                          : `${pdfQueuedFiles.slice(0, 5).map((f) => f.name).join(", ")} +${pdfQueuedFiles.length - 5} more`}
                      </div>
                    )}
                    {pdfStatus && <div className="small" style={{ marginTop: 8 }}>{pdfStatus}</div>}
                    {pdfError && (
                      <div className="small" style={{ marginTop: 8 }}>
                        ⚠ {pdfError}
                      </div>
                    )}

                    {pdfExtractYears.length > 0 && (
                      <details style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                        <summary className="small" style={{ cursor: "pointer" }}>
                          Evidence (page references)
                        </summary>
                        <div className="evidenceBox">
                          {pdfExtractYears.slice(0, 12).map((y: any, idx: number) => {
                            const pdf = String(y?._sourcePdf || "");
                            const yearLabel = String(y?.year_label || "");
                            const metrics = [
                              ["Revenue", y?.revenue],
                              ["EBITDA", y?.ebitda],
                              ["PAT", y?.pat],
                              ["EPS", y?.eps],
                              ["Net worth", y?.networth],
                              ["Total assets", y?.total_assets],
                            ] as const;
                            return (
                              <div key={`${pdf}-${yearLabel}-${idx}`} className="evidenceItem">
                                <div className="evidenceTitle">
                                  {pdf ? `${pdf} • ` : ""}{yearLabel ? `FY${yearLabel}` : `Year ${idx + 1}`}
                                </div>
                                <div className="evidenceGrid">
                                  {metrics.map(([label, obj]) => {
                                    const src = obj?.source || {};
                                    const page = Number(src?.page || 0);
                                    const section = String(src?.section || "");
                                    const snippet = String(src?.snippet || "");
                                    if (!page || !snippet) return null;
                                    return (
                                      <div key={label} className="evidenceRow">
                                        <div className="evidenceMetric">{label}</div>
                                        <div className="evidenceRef">
                                          <span className="evidencePill">page {page}</span>
                                          {section ? <span className="evidencePill">{section}</span> : null}
                                          <div className="evidenceSnippet">“{snippet}”</div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                          {pdfExtractYears.length > 12 && <div className="small">Showing first 12 extracted years.</div>}
                        </div>
                      </details>
                    )}
                  </div>

                  <details style={{ marginTop: 10 }}>
                    <summary className="small" style={{ cursor: "pointer" }}>
                      Advanced: extract from existing local file paths
                    </summary>
                    <div className="field" style={{ marginTop: 8 }}>
                      <textarea
                        className="textareaCompact"
                        rows={2}
                        value={genPdfPaths}
                        onChange={(e) => setGenPdfPaths(e.target.value)}
                        placeholder="e.g.\nReliance1.pdf\nReliance2.pdf"
                      />
                      <div className="actions" style={{ marginTop: 8 }}>
                        <button className="ghost" type="button" onClick={handleExtractFinancialsFromPdf} disabled={pdfLoading || !genPdfPaths.trim()}>
                          {pdfLoading ? "Extracting…" : "Extract from paths"}
                        </button>
                      </div>
                    </div>
                  </details>
                </div>
                <div className="row">
                  <div className="field">
                    <label>Company name</label>
                    <input value={genCompanyName} onChange={(e) => setGenCompanyName(e.target.value)} placeholder="e.g. Project Orion" />
                  </div>
                  <div className="field">
                    <label>Company description (optional)</label>
                    <textarea
                      className="textareaCompact"
                      rows={2}
                      value={genCompanyDesc}
                      onChange={(e) => setGenCompanyDesc(e.target.value)}
                      placeholder="US-based vertical SaaS for logistics..."
                    />
                  </div>
                </div>
                <div className="field" style={{ marginTop: 10 }}>
                  <label>Financial input (optional)</label>
                  <textarea
                    rows={5}
                    value={genFinancialText}
                    onChange={(e) => setGenFinancialText(e.target.value)}
                    placeholder="Paste the table text (e.g., FY20A–FY27P rows like Revenue/EBITDA/etc.)"
                  />
                </div>
                <div className="actions">
                  <button className="primary" type="button" onClick={handleGenerateRawDealText} disabled={genLoading || !genCompanyName.trim()}>
                    {genLoading ? "Generating…" : "Generate raw text"}
                  </button>
                  {genUsed && <div className="small">Used: {genUsed}</div>}
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => {
                      setRawIntake(genOutput);
                      setLeftTab("deal");
                    }}
                    disabled={!genOutput.trim()}
                  >
                    Use in Deal intake
                  </button>
                </div>
                {genError && (
                  <div className="small" style={{ marginTop: 6 }}>
                    ⚠ {genError}
                  </div>
                )}

                <div className="field" style={{ marginTop: 10 }}>
                  <label>Generated raw deal text</label>
                  <textarea
                    rows={7}
                    value={genOutput}
                    onChange={(e) => setGenOutput(e.target.value)}
                    placeholder="Generated text will appear here…"
                  />
                </div>
              </div>
            )}

            {leftTab === "deal" && (
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
                    <button className="ghost" type="button" onClick={handleExtract} disabled={extracting || !rawIntake.trim()}>
                      {extracting ? "Extracting…" : "Extract fields"}
                    </button>
                  </div>
                  {extractError && (
                    <div className="small" style={{ marginTop: 6 }}>
                      ⚠ {extractError}
                    </div>
                  )}
                </div>

                {(showConfirmBanner || sector === "Other" || !geo.trim()) && rawIntake.trim() && (
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
                        onClick={() => {
                          setShowConfirmBanner(false);
                        }}
                      >
                        Dismiss
                      </button>
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
                <select value={sector} onChange={(e) => setSector(e.target.value)}>
                  <option>Software</option>
                  <option>Healthcare</option>
                  <option>Manufacturing</option>
                  <option>Business Services</option>
                  <option>Consumer</option>
                  <option>Other</option>
                </select>
              </div>
            </div>

            <div className="row">
              <div className="field">
                <label>Geography</label>
                <input value={geo} onChange={(e) => setGeo(e.target.value)} placeholder="US, UK, DACH…" />
              </div>

              <div className="field">
                <label>Revenue</label>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={revenue}
                  onChange={(e) => setRevenue(parseFloat(e.target.value))}
                />
                {providedInfo?.currency && providedInfo?.scale && (
                  <div className="small">Units: {providedInfo.currency} {providedInfo.scale}</div>
                )}
              </div>

              <div className="field">
                <label>EBITDA</label>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={ebitda}
                  onChange={(e) => setEbitda(parseFloat(e.target.value))}
                />
                {providedInfo?.currency && providedInfo?.scale && (
                  <div className="small">Units: {providedInfo.currency} {providedInfo.scale}</div>
                )}
              </div>

              <div className="field">
                <label>EV / Deal Size</label>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={dealSize}
                  onChange={(e) => setDealSize(parseFloat(e.target.value))}
                />
                {providedInfo?.currency && providedInfo?.scale && (
                  <div className="small">Units: {providedInfo.currency} {providedInfo.scale}</div>
                )}
              </div>
            </div>

            <div className="kpis">
              <div className="kpi">
                <div className="k">EBITDA margin</div>
                <div className="v">{quickMetrics.margin.toFixed(1)}%</div>
              </div>
              <div className="kpi">
                <div className="k">EV / EBITDA</div>
                <div className="v">{quickMetrics.multiple.toFixed(1)}×</div>
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

          {result && (
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

              {tab === "summary" && (
                <div className="section">
                  <h3>Analyst summary</h3>
                  <div className="small">{result.dealSummary}</div>
                </div>
              )}

              {tab === "buyers" && (
                <div className="section">
                  <h3>Buyer matches</h3>
                  <div className="buyers">
                    {result.buyers.map((b, i) => {
                      const pct = Math.round(clamp01(b.score) * 100);
                      return (
                        <div className="buyer" key={`${b.name}-${i}`}>
                          <div className="buyerTop">
                            <div className="buyerName">
                              <span className="rank">#{i + 1}</span> {b.name}
                            </div>
                            <div className="score">{pct}%</div>
                          </div>

                          <div className="scoreBar">
                            <div className="scoreFill" style={{ width: `${pct}%` }} />
                          </div>

                          <div className="buyerWhy">{b.rationale}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {tab === "outreach" && (
                <div className="section">
                  <h3>Outreach drafts</h3>
                  <div className="drafts">
                    {result.outreachDrafts.map((d, i) => {
                      const subjKey = `${d.buyerName}-subj`;
                      const bodyKey = `${d.buyerName}-body`;
                      return (
                        <details className="draft" key={`${d.buyerName}-${i}`} open={i === 0}>
                          <summary>
                            <span className="draftTitle">{d.buyerName}</span>
                            <span className="draftHint">Expand</span>
                          </summary>

                          <div className="draftInner">
                            <div className="draftSubject">
                              <div className="draftRowTop">
                                <span>Subject</span>
                                <button
                                  type="button"
                                  className="mini"
                                  onClick={() => onCopy(subjKey, d.emailSubject)}
                                >
                                  {copiedKey === subjKey ? "Copied" : "Copy"}
                                </button>
                              </div>
                              <div className="small">{d.emailSubject}</div>
                            </div>

                            <div className="draftBody">
                              <div className="draftRowTop">
                                <span>Body</span>
                                <button
                                  type="button"
                                  className="mini"
                                  onClick={() => onCopy(bodyKey, d.emailBody)}
                                >
                                  {copiedKey === bodyKey ? "Copied" : "Copy"}
                                </button>
                              </div>
                              <pre className="mono">{d.emailBody}</pre>
                            </div>
                          </div>
                        </details>
                      );
                    })}
                  </div>
                </div>
              )}

              {tab === "search" && (
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
              )}
            </div>
          )}
        </section>
      </main>

      <footer className="footer">Built for a 1-day demo: agentic workflow + ML scoring + full-stack TypeScript.</footer>
    </div>
    </>
  );
}