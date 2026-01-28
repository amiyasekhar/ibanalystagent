/**
 * Investment Memo Generator UI (CrossCourt AI Prototype)
 * Allows users to:
 * 1. Upload precedent memos
 * 2. Analyze precedents to create style guide
 * 3. Generate new investment memos
 * 4. Export to DOCX
 */

import { useState, useRef } from "react";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

type Precedent = {
  id: string;
  filename: string;
  uploadedAt: string;
  sectionsCount: number;
};

type StyleGuide = {
  id: string;
  firmName?: string;
  sectionsCount: number;
  precedentsUsed: number;
  createdAt: string;
};

type GeneratedMemo = {
  id: string;
  dealName: string;
  title: string;
  status: string;
  generatedAt: string;
  sectionsCount: number;
  exportPath?: string;
  sections?: Array<{
    heading: string;
    level: number;
    content: string[];
  }>;
};

type MemoTab = "upload" | "style" | "generate" | "view";

export default function MemoGenerator() {
  const [tab, setTab] = useState<MemoTab>("upload");

  // Upload state
  const [precedents, setPrecedents] = useState<Precedent[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Style guide state
  const [styleGuides, setStyleGuides] = useState<StyleGuide[]>([]);
  const [selectedPrecedents, setSelectedPrecedents] = useState<string[]>([]);
  const [firmName, setFirmName] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Generate memo state
  const [dealName, setDealName] = useState("");
  const [sector, setSector] = useState("Software");
  const [geography, setGeography] = useState("US");
  const [revenue, setRevenue] = useState<number>(0);
  const [ebitda, setEbitda] = useState<number>(0);
  const [dealSize, setDealSize] = useState<number>(0);
  const [description, setDescription] = useState("");
  const [highlights, setHighlights] = useState("");
  const [riskFactors, setRiskFactors] = useState("");
  const [selectedStyleGuide, setSelectedStyleGuide] = useState<string>("");
  const [useDefaultTemplate, setUseDefaultTemplate] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // PDF extraction state
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  // View memos state
  const [generatedMemos, setGeneratedMemos] = useState<GeneratedMemo[]>([]);
  const [selectedMemo, setSelectedMemo] = useState<GeneratedMemo | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Load precedents
  async function loadPrecedents() {
    try {
      const res = await fetch(`${API_BASE}/api/memos/precedents`);
      const data = await res.json();
      if (data.ok) {
        setPrecedents(data.precedents);
      }
    } catch (e: any) {
      console.error("Failed to load precedents:", e);
    }
  }

  // Upload precedents
  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("precedents", files[i]);
      }

      const res = await fetch(`${API_BASE}/api/memos/precedents/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (data.ok) {
        await loadPrecedents();
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        setUploadError(data.error || "Upload failed");
      }
    } catch (e: any) {
      setUploadError(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // Load style guides
  async function loadStyleGuides() {
    try {
      const res = await fetch(`${API_BASE}/api/memos/style-guides`);
      const data = await res.json();
      if (data.ok) {
        setStyleGuides(data.styleGuides);
      }
    } catch (e: any) {
      console.error("Failed to load style guides:", e);
    }
  }

  // Analyze precedents
  async function handleAnalyze() {
    if (selectedPrecedents.length === 0) {
      setAnalyzeError("Please select at least one precedent");
      return;
    }

    setAnalyzing(true);
    setAnalyzeError(null);

    try {
      const res = await fetch(`${API_BASE}/api/memos/style-guides/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          precedentIds: selectedPrecedents,
          firmName: firmName || undefined,
        }),
      });

      const data = await res.json();

      if (data.ok) {
        await loadStyleGuides();
        setSelectedPrecedents([]);
        setFirmName("");
        setTab("generate");
      } else {
        setAnalyzeError(data.error || "Analysis failed");
      }
    } catch (e: any) {
      setAnalyzeError(e.message || "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  // Extract financials from PDFs
  async function handlePdfExtraction(files: FileList | null) {
    if (!files || files.length === 0) return;

    setPdfExtracting(true);
    setPdfError(null);

    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("pdfs", files[i]);
      }

      const res = await fetch(`${API_BASE}/api/extract-financials-from-upload`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (data.ok && data.financials) {
        // Auto-fill form with extracted data
        const financials = data.financials;

        // Get most recent year's data
        if (financials.length > 0) {
          const latest = financials[financials.length - 1];

          if (latest.revenue) {
            setRevenue(parseFloat(latest.revenue) || 0);
          }
          if (latest.ebitda) {
            setEbitda(parseFloat(latest.ebitda) || 0);
          }

          // Build description from extracted data
          let desc = `Company with `;
          if (latest.revenue) desc += `revenue of ${latest.revenue}, `;
          if (latest.ebitda) desc += `EBITDA of ${latest.ebitda}, `;
          if (latest.pat) desc += `PAT of ${latest.pat}, `;
          desc = desc.replace(/, $/, ".");

          setDescription(desc);
        }

        if (pdfInputRef.current) pdfInputRef.current.value = "";
      } else {
        setPdfError(data.error || "PDF extraction failed");
      }
    } catch (e: any) {
      setPdfError(e.message || "PDF extraction failed");
    } finally {
      setPdfExtracting(false);
    }
  }

  // Generate memo
  async function handleGenerate() {
    if (!dealName || !description) {
      setGenerateError("Deal name and description are required");
      return;
    }

    setGenerating(true);
    setGenerateError(null);

    try {
      const res = await fetch(`${API_BASE}/api/memos/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealName,
          dealData: {
            sector,
            geography,
            revenue,
            ebitda,
            dealSize,
            description,
            highlights: highlights
              ? highlights.split("\n").filter((h) => h.trim())
              : undefined,
            riskFactors: riskFactors
              ? riskFactors.split("\n").filter((r) => r.trim())
              : undefined,
          },
          styleGuideId: useDefaultTemplate ? undefined : selectedStyleGuide,
          useDefaultTemplate,
        }),
      });

      const data = await res.json();

      if (data.ok) {
        await loadGeneratedMemos();
        setSelectedMemo(data.memo);
        setTab("view");
      } else {
        setGenerateError(data.error || "Generation failed");
      }
    } catch (e: any) {
      setGenerateError(e.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  // Load generated memos
  async function loadGeneratedMemos() {
    try {
      const res = await fetch(`${API_BASE}/api/memos/generated`);
      const data = await res.json();
      if (data.ok) {
        setGeneratedMemos(data.memos);
      }
    } catch (e: any) {
      console.error("Failed to load generated memos:", e);
    }
  }

  // Load specific memo
  async function loadMemo(id: string) {
    try {
      const res = await fetch(`${API_BASE}/api/memos/generated/${id}`);
      const data = await res.json();
      if (data.ok) {
        setSelectedMemo(data.memo);
      }
    } catch (e: any) {
      console.error("Failed to load memo:", e);
    }
  }

  // Export memo to DOCX
  async function handleExport(memoId: string) {
    setExporting(true);
    setExportError(null);

    try {
      const res = await fetch(`${API_BASE}/api/memos/generated/${memoId}/export`, {
        method: "POST",
      });

      const data = await res.json();

      if (data.ok) {
        // Trigger download
        const filename = data.filename;
        window.open(`${API_BASE}/api/memos/download/${filename}`, "_blank");
        await loadGeneratedMemos();
        if (selectedMemo?.id === memoId) {
          await loadMemo(memoId);
        }
      } else {
        setExportError(data.error || "Export failed");
      }
    } catch (e: any) {
      setExportError(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  // Toggle precedent selection
  function togglePrecedent(id: string) {
    setSelectedPrecedents((prev) =>
      prev.includes(id) ? prev.filter((pid) => pid !== id) : [...prev, id]
    );
  }

  // Load data on tab change
  function switchTab(newTab: MemoTab) {
    setTab(newTab);
    if (newTab === "upload") loadPrecedents();
    if (newTab === "style") {
      loadPrecedents();
      loadStyleGuides();
    }
    if (newTab === "generate") loadStyleGuides();
    if (newTab === "view") loadGeneratedMemos();
  }

  return (
    <div className="memo-generator">
      <div style={{ marginBottom: "16px" }}>
        <h2 style={{ margin: 0, fontSize: "20px" }}>Investment Memo Generator</h2>
        <p style={{ color: "var(--muted)", fontSize: "13px", margin: "4px 0 0 0" }}>
          CrossCourt AI Prototype - 80% Memo Automation
        </p>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={tab === "upload" ? "active" : ""}
          onClick={() => switchTab("upload")}
        >
          1. Upload Precedents
        </button>
        <button
          className={tab === "style" ? "active" : ""}
          onClick={() => switchTab("style")}
        >
          2. Create Style Guide
        </button>
        <button
          className={tab === "generate" ? "active" : ""}
          onClick={() => switchTab("generate")}
        >
          3. Generate Memo
        </button>
        <button
          className={tab === "view" ? "active" : ""}
          onClick={() => switchTab("view")}
        >
          4. View Memos
        </button>
      </div>

      {/* Upload Tab */}
      {tab === "upload" && (
        <div className="tab-content">
          <h2>Upload Precedent Investment Memos</h2>
          <p>
            Upload 3-5 example investment memos (PDF or DOCX) to teach the system
            your firm's writing style.
          </p>

          <div className="upload-section">
            <input
              type="file"
              ref={fileInputRef}
              multiple
              accept=".pdf,.docx,.doc"
              onChange={(e) => handleFileUpload(e.target.files)}
              disabled={uploading}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading..." : "Choose Files"}
            </button>
          </div>

          {uploadError && <div className="error">{uploadError}</div>}

          <h3>Uploaded Precedents ({precedents.length})</h3>
          <div className="precedents-list">
            {precedents.length === 0 && <p>No precedents uploaded yet.</p>}
            {precedents.map((p) => (
              <div key={p.id} className="precedent-card">
                <div className="precedent-name">{p.filename}</div>
                <div className="precedent-meta">
                  {p.sectionsCount} sections • {new Date(p.uploadedAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>

          {precedents.length > 0 && (
            <button onClick={() => switchTab("style")} className="next-btn">
              Next: Create Style Guide →
            </button>
          )}
        </div>
      )}

      {/* Style Guide Tab */}
      {tab === "style" && (
        <div className="tab-content">
          <h2>Create Style Guide from Precedents</h2>
          <p>
            Select precedent memos to analyze. The system will learn your firm's
            writing patterns, vocabulary, and structure.
          </p>

          <div className="form-group">
            <label>Firm Name (optional)</label>
            <input
              type="text"
              value={firmName}
              onChange={(e) => setFirmName(e.target.value)}
              placeholder="e.g., Goldman Sachs"
            />
          </div>

          <h3>Select Precedents to Analyze</h3>
          <div className="precedents-select">
            {precedents.map((p) => (
              <div key={p.id} className="precedent-checkbox">
                <input
                  type="checkbox"
                  id={`prec-${p.id}`}
                  checked={selectedPrecedents.includes(p.id)}
                  onChange={() => togglePrecedent(p.id)}
                />
                <label htmlFor={`prec-${p.id}`}>{p.filename}</label>
              </div>
            ))}
          </div>

          {analyzeError && <div className="error">{analyzeError}</div>}

          <button
            onClick={handleAnalyze}
            disabled={analyzing || selectedPrecedents.length === 0}
            className="primary-btn"
          >
            {analyzing ? "Analyzing..." : `Analyze ${selectedPrecedents.length} Precedent(s)`}
          </button>

          <h3>Existing Style Guides ({styleGuides.length})</h3>
          <div className="style-guides-list">
            {styleGuides.length === 0 && <p>No style guides created yet.</p>}
            {styleGuides.map((sg) => (
              <div key={sg.id} className="style-guide-card">
                <div className="sg-name">{sg.firmName || "Untitled Style Guide"}</div>
                <div className="sg-meta">
                  {sg.sectionsCount} sections • {sg.precedentsUsed} precedents
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generate Tab */}
      {tab === "generate" && (
        <div className="tab-content">
          <h2>Generate Investment Memo</h2>
          <p>Provide deal details and the system will generate a complete investment memo.</p>

          {/* PDF Extraction Section */}
          <div style={{
            background: "var(--card2)",
            border: "1px solid var(--stroke)",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "24px"
          }}>
            <h3 style={{ fontSize: "16px", marginTop: 0 }}>Quick Extract from PDFs (Optional)</h3>
            <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "12px" }}>
              Upload annual reports or financial documents to auto-extract revenue, EBITDA, and other metrics.
            </p>

            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <input
                type="file"
                ref={pdfInputRef}
                multiple
                accept=".pdf"
                style={{ display: "none" }}
                onChange={(e) => handlePdfExtraction(e.target.files)}
              />
              <button
                type="button"
                onClick={() => pdfInputRef.current?.click()}
                disabled={pdfExtracting}
                className="primary-btn"
                style={{ margin: 0 }}
              >
                {pdfExtracting ? "Extracting..." : "Upload PDFs to Extract Data"}
              </button>
              {pdfExtracting && (
                <span style={{ fontSize: "13px", color: "var(--muted)" }}>
                  Extracting financials from PDFs...
                </span>
              )}
            </div>

            {pdfError && (
              <div className="error" style={{ marginTop: "12px", marginBottom: 0 }}>
                {pdfError}
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Deal Name *</label>
            <input
              type="text"
              value={dealName}
              onChange={(e) => setDealName(e.target.value)}
              placeholder="e.g., Acme SaaS Acquisition"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Sector</label>
              <select value={sector} onChange={(e) => setSector(e.target.value)}>
                <option value="Software">Software</option>
                <option value="Healthcare">Healthcare</option>
                <option value="Manufacturing">Manufacturing</option>
                <option value="Business Services">Business Services</option>
                <option value="Consumer">Consumer</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="form-group">
              <label>Geography</label>
              <input
                type="text"
                value={geography}
                onChange={(e) => setGeography(e.target.value)}
                placeholder="e.g., US, Europe"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Revenue ($M)</label>
              <input
                type="number"
                value={revenue}
                onChange={(e) => setRevenue(Number(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label>EBITDA ($M)</label>
              <input
                type="number"
                value={ebitda}
                onChange={(e) => setEbitda(Number(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label>Deal Size ($M)</label>
              <input
                type="number"
                value={dealSize}
                onChange={(e) => setDealSize(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the company, products, market position..."
              rows={4}
            />
          </div>

          <div className="form-group">
            <label>Highlights (one per line, optional)</label>
            <textarea
              value={highlights}
              onChange={(e) => setHighlights(e.target.value)}
              placeholder="Strong market position&#10;Recurring revenue model&#10;Experienced management team"
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Risk Factors (one per line, optional)</label>
            <textarea
              value={riskFactors}
              onChange={(e) => setRiskFactors(e.target.value)}
              placeholder="Customer concentration&#10;Competitive market&#10;Technology risk"
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={useDefaultTemplate}
                onChange={(e) => setUseDefaultTemplate(e.target.checked)}
              />
              Use default template
            </label>
          </div>

          {!useDefaultTemplate && (
            <div className="form-group">
              <label>Style Guide</label>
              <select
                value={selectedStyleGuide}
                onChange={(e) => setSelectedStyleGuide(e.target.value)}
              >
                <option value="">Select a style guide...</option>
                {styleGuides.map((sg) => (
                  <option key={sg.id} value={sg.id}>
                    {sg.firmName || sg.id}
                  </option>
                ))}
              </select>
            </div>
          )}

          {generateError && <div className="error">{generateError}</div>}

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="primary-btn"
          >
            {generating ? "Generating Memo (5-10 min)..." : "Generate Investment Memo"}
          </button>
        </div>
      )}

      {/* View Tab */}
      {tab === "view" && (
        <div className="tab-content">
          <h2>Generated Memos ({generatedMemos.length})</h2>

          {generatedMemos.length === 0 && <p>No memos generated yet.</p>}

          <div className="memos-list">
            {generatedMemos.map((memo) => (
              <div
                key={memo.id}
                className={`memo-card ${selectedMemo?.id === memo.id ? "selected" : ""}`}
                onClick={() => loadMemo(memo.id)}
              >
                <div className="memo-title">{memo.dealName}</div>
                <div className="memo-meta">
                  {memo.sectionsCount} sections • {memo.status} •{" "}
                  {new Date(memo.generatedAt).toLocaleDateString()}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExport(memo.id);
                  }}
                  disabled={exporting}
                  className="export-btn"
                >
                  {exporting ? "Exporting..." : "Export to Word"}
                </button>
              </div>
            ))}
          </div>

          {exportError && <div className="error">{exportError}</div>}

          {selectedMemo && (
            <div className="memo-preview">
              <h3>{selectedMemo.title}</h3>
              {selectedMemo.sections?.map((section, idx) => (
                <div key={idx} className="memo-section">
                  <h4>{section.heading}</h4>
                  {Array.isArray(section.content) ? (
                    section.content.map((para, pidx) => <p key={pidx}>{para}</p>)
                  ) : (
                    <p>{section.content}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
