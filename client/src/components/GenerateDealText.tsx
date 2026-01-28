import { useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

interface GenerateDealTextProps {
  onUseInDealIntake: (text: string) => void;
}

export default function GenerateDealText({ onUseInDealIntake }: GenerateDealTextProps) {
  const [genCompanyName, setGenCompanyName] = useState<string>("");
  const [genCompanyDesc, setGenCompanyDesc] = useState<string>("");
  const [genFinancialText, setGenFinancialText] = useState<string>("");
  const [genPdfPaths, setGenPdfPaths] = useState<string>("");
  const [financialRows, setFinancialRows] = useState<Array<{year_label: string; revenue: string; ebitda: string; pat: string; eps: string; networth: string; total_assets: string}>>([
    {year_label: "", revenue: "", ebitda: "", pat: "", eps: "", networth: "", total_assets: ""},
    {year_label: "", revenue: "", ebitda: "", pat: "", eps: "", networth: "", total_assets: ""},
    {year_label: "", revenue: "", ebitda: "", pat: "", eps: "", networth: "", total_assets: ""},
    {year_label: "", revenue: "", ebitda: "", pat: "", eps: "", networth: "", total_assets: ""},
  ]);
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

  // Sync financialRows state back to genFinancialText pipe-delimited format
  function syncRowsToText() {
    const cols = ["year_label", "revenue", "ebitda", "pat", "eps", "networth", "total_assets"];
    const header = cols.join(" | ");
    const divider = "-".repeat(header.length);
    const dataRows = financialRows
      .filter((row) => row.year_label.trim() || row.revenue.trim() || row.ebitda.trim() || row.pat.trim() || row.eps.trim() || row.networth.trim() || row.total_assets.trim())
      .map((row) => cols.map((col) => row[col as keyof typeof row] || "").join(" | "));
    const text = [header, divider, ...dataRows].join("\n");
    setGenFinancialText(text);
  }

  function updateRow(rowIndex: number, field: string, value: string) {
    const newRows = [...financialRows];
    newRows[rowIndex] = { ...newRows[rowIndex], [field]: value };
    setFinancialRows(newRows);
  }

  async function handleGenerateRawDealText() {
    // Sync editable grid to genFinancialText before generating
    const cols = ["year_label", "revenue", "ebitda", "pat", "eps", "networth", "total_assets"];
    const header = cols.join(" | ");
    const divider = "-".repeat(header.length);
    const dataRows = financialRows
      .filter((row) => row.year_label.trim() || row.revenue.trim() || row.ebitda.trim() || row.pat.trim() || row.eps.trim() || row.networth.trim() || row.total_assets.trim())
      .map((row) => cols.map((col) => row[col as keyof typeof row] || "").join(" | "));
    const financialTextToSend = [header, divider, ...dataRows].join("\n");
    setGenFinancialText(financialTextToSend);

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
          financialText: financialTextToSend,
        }),
      });
      if (!res.ok) throw new Error(`Generator API returned ${res.status}`);
      const data = (await res.json()) as any;
      if (!data?.ok || typeof data?.rawText !== "string") throw new Error("Bad generator response");
      setGenOutput(String(data.rawText));
      setGenUsed(String(data.used || ""));
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

      // Populate editable table from extracted data
      if (Array.isArray(data?.years) && data.years.length > 0) {
        const formatValue = (val: any, isEps: boolean = false) => {
          const num = parseFloat(val) || 0;
          if (num === 0) return "0";
          // For EPS, show as-is (already per share)
          if (isEps) return num.toFixed(2);
          // For other metrics, multiply by 1,000,000 to show full number (values are in millions)
          const fullNum = Math.round(num * 1_000_000);
          return fullNum.toLocaleString('en-US');
        };

        const rows = data.years.map((y: any) => ({
          year_label: String(y?.year_label || ""),
          revenue: formatValue(y?.revenue?.value || 0),
          ebitda: formatValue(y?.ebitda?.value || 0),
          pat: formatValue(y?.pat?.value || 0),
          eps: formatValue(y?.eps?.value || 0, true),
          networth: formatValue(y?.networth?.value || 0),
          total_assets: formatValue(y?.total_assets?.value || 0),
        }));
        setFinancialRows(rows);
      }
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

  return (
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
                                <div className="evidenceSnippet">"{snippet}"</div>
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
              placeholder="e.g.\nCompany_10K.pdf\nCompany_Annual_Report.pdf"
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
        <div style={{ overflowX: "auto", border: "1px solid #ccc", borderRadius: 4, backgroundColor: "#fff", maxWidth: "100%" }}>
          <table style={{ width: "auto", minWidth: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "monospace" }}>
            <thead>
              <tr>
                {["Year", "Revenue", "EBITDA", "PAT", "EPS", "Net Worth", "Total Assets"].map((header, idx) => (
                  <th
                    key={idx}
                    style={{
                      padding: "8px 12px",
                      border: "1px solid #333",
                      textAlign: "center",
                      fontWeight: 600,
                      fontSize: 12,
                      backgroundColor: "#f5f5f5",
                      color: "#333",
                      whiteSpace: "nowrap",
                      minWidth: idx === 0 ? "80px" : "150px"
                    }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {financialRows.map((row, rowIdx) => (
                <tr key={rowIdx}>
                  {["year_label", "revenue", "ebitda", "pat", "eps", "networth", "total_assets"].map((field, colIdx) => (
                    <td
                      key={colIdx}
                      style={{
                        padding: 0,
                        border: "1px solid #999",
                        backgroundColor: "#fff",
                        minWidth: colIdx === 0 ? "80px" : "150px"
                      }}
                    >
                      <input
                        type="text"
                        value={row[field as keyof typeof row]}
                        onChange={(e) => updateRow(rowIdx, field, e.target.value)}
                        placeholder={colIdx === 0 ? "FY2024" : "0"}
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          border: "none",
                          outline: "none",
                          fontSize: 13,
                          fontFamily: "monospace",
                          textAlign: colIdx === 0 ? "left" : "right",
                          backgroundColor: "transparent",
                          color: "#000",
                          minWidth: colIdx === 0 ? "80px" : "150px"
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="ghost"
            type="button"
            onClick={() => {
              const cols = ["year_label", "revenue", "ebitda", "pat", "eps", "networth", "total_assets"];
              const header = cols.join(" | ");
              const divider = "-".repeat(header.length);
              const dataRows = financialRows
                .filter((row) => row.year_label.trim() || row.revenue.trim() || row.ebitda.trim() || row.pat.trim() || row.eps.trim() || row.networth.trim() || row.total_assets.trim())
                .map((row) => cols.map((col) => row[col as keyof typeof row] || "").join(" | "));
              const text = [header, divider, ...dataRows].join("\n");
              navigator.clipboard.writeText(text).then(() => {
                alert("Financial data copied to clipboard!");
              }).catch(() => {
                alert("Failed to copy to clipboard");
              });
            }}
          >
            Copy
          </button>
          <button
            className="ghost"
            type="button"
            onClick={() => {
              setFinancialRows([
                {year_label: "", revenue: "", ebitda: "", pat: "", eps: "", networth: "", total_assets: ""},
                {year_label: "", revenue: "", ebitda: "", pat: "", eps: "", networth: "", total_assets: ""},
                {year_label: "", revenue: "", ebitda: "", pat: "", eps: "", networth: "", total_assets: ""},
                {year_label: "", revenue: "", ebitda: "", pat: "", eps: "", networth: "", total_assets: ""},
              ]);
              setGenFinancialText("");
            }}
          >
            Clear all
          </button>
          <button
            className="ghost"
            type="button"
            onClick={() => {
              setFinancialRows([...financialRows, {year_label: "", revenue: "", ebitda: "", pat: "", eps: "", networth: "", total_assets: ""}]);
            }}
          >
            + Add row
          </button>
          <span className="small" style={{ marginLeft: "auto", color: "#666" }}>
            Upload PDFs above to auto-fill, or enter values manually
          </span>
        </div>
      </div>
      <div className="actions">
        <button className="primary" type="button" onClick={handleGenerateRawDealText} disabled={genLoading || !genCompanyName.trim()}>
          {genLoading ? "Generating…" : "Generate raw text"}
        </button>
        {genUsed && <div className="small">Used: {genUsed}</div>}
        <button
          className="ghost"
          type="button"
          onClick={() => onUseInDealIntake(genOutput)}
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
  );
}
