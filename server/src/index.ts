import "./loadEnv";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { runAnalystAgent } from "./agent";
import { extractDealFromText } from "./extractDeal";
import { normalizeGeography, normalizeSector, num } from "./normalize";
import { log } from "./logger";
import { DealInput } from "./types";
import { createWorkflow, getWorkflow, recordRun, setResult, updateDeal } from "./workflows";
import { claudeJson } from "./claude";
import { requestLoggingMiddleware } from "./requestLogging";
import { searchBuyers } from "./buyerSearch";
import { generateRawDealText } from "./generateRawDealText";
import { extractFinancialsFromPdfs } from "./pdfFinancials";
import multer from "multer";
import { ensureUploadsDir, sanitizeFilename } from "./uploadUtils";
import { extractPrecedentMemo } from "./precedentExtractor";
import { analyzeStyleFromPrecedents, getDefaultStyleGuide } from "./styleGuideAnalyzer";
import { generateInvestmentMemo, memoToDocxData } from "./memoGenerator";
import { exportToDocx } from "./docExport";
import {
  savePrecedent,
  getPrecedent,
  getAllPrecedents,
  saveStyleGuide,
  getStyleGuide,
  getAllStyleGuides,
  saveGeneratedMemo,
  getGeneratedMemo,
  getAllGeneratedMemos,
  setMemoExportPath,
  getMemoStats,
} from "./memoStorage";

// Clear server log on each (re)start so it doesn't contain old runs.
// Set LOG_APPEND=1 to keep appending across restarts.
if (String(process.env.LOG_APPEND || "").trim() !== "1") {
  try {
    log.clear();
  } catch {
    // ignore
  }
}

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use(requestLoggingMiddleware);

app.get("/health", (_req, res) => res.json({ ok: true }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ensureUploadsDir()),
    filename: (_req, file, cb) => {
      const safe = sanitizeFilename(file.originalname || "upload.pdf");
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: {
    fileSize: 150 * 1024 * 1024, // 150MB per file (handles multipart overhead + base64 encoding)
    files: 50 // max 50 files
  },
});

// Drag/drop upload endpoint: upload PDFs and immediately extract financials.
app.post("/api/extract-financials-from-upload", upload.array("pdfs", 50), async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    const highlight = String((req.body as any)?.highlight || "").toLowerCase() === "true";
    if (!files.length) return res.status(400).json({ ok: false, error: "No PDF files uploaded" });

    const pdfPaths = files.map((f) => f.path);
    const out = await extractFinancialsFromPdfs({ pdfPaths, highlight });
    // Cleanup uploaded temp files (keep highlighted PDFs if generated).
    try {
      const fs = await import("node:fs/promises");
      await Promise.all(
        files.map(async (f) => {
          try {
            await fs.unlink(f.path);
          } catch {
            // ignore
          }
        })
      );
    } catch {
      // ignore
    }

    if (!out.ok) return res.status(500).json(out);
    return res.json({ ...out, uploaded: files.map((f) => ({ originalName: f.originalname })) });
  } catch (e: any) {
    log.error("extract-financials-from-upload failed", { message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

app.post("/api/extract-financials-from-pdf", async (req, res) => {
  try {
    const pdfPaths = Array.isArray(req.body?.pdfPaths) ? req.body.pdfPaths.map(String) : [];
    const highlight = Boolean(req.body?.highlight);
    if (!pdfPaths.length) return res.status(400).json({ ok: false, error: "pdfPaths must be a non-empty array" });

    const out = await extractFinancialsFromPdfs({ pdfPaths, highlight });
    if (!out.ok) return res.status(500).json(out);
    return res.json(out);
  } catch (e: any) {
    log.error("extract-financials-from-pdf failed", { message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

app.post("/api/generate-raw-deal-text", async (req, res) => {
  try {
    const out = await generateRawDealText(req.body);
    if (!out.ok) return res.status(400).json(out);
    return res.json(out);
  } catch (e: any) {
    log.error("generate-raw-deal-text failed", { message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

app.get("/api/buyers/search", (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const sector = typeof req.query.sector === "string" ? (req.query.sector as any) : "Any";
    const geography = typeof req.query.geography === "string" ? req.query.geography : "";
    const type = typeof req.query.type === "string" ? (req.query.type as any) : "Any";
    const tag = typeof req.query.tag === "string" ? req.query.tag : "";

    const minDeal = req.query.minDeal != null ? Number(req.query.minDeal) : undefined;
    const maxDeal = req.query.maxDeal != null ? Number(req.query.maxDeal) : undefined;
    const minEbitda = req.query.minEbitda != null ? Number(req.query.minEbitda) : undefined;
    const maxEbitda = req.query.maxEbitda != null ? Number(req.query.maxEbitda) : undefined;
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;

    const results = searchBuyers({
      q,
      sector,
      geography,
      type,
      tag,
      minDeal,
      maxDeal,
      minEbitda,
      maxEbitda,
      limit,
    });

    return res.json({ ok: true, results });
  } catch (e: any) {
    log.error("buyer-search failed", { message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

app.get("/api/debug/claude", async (_req, res) => {
  try {
    const system = "Return STRICT JSON only. No markdown.";
    const prompt = `Return JSON exactly:\n{ "ping": "pong" }`;
    const out = await claudeJson<{ ping: string }>({ system, prompt, maxTokens: 50 });
    if (!out.ok) return res.status(500).json({ ok: false, error: out.error, raw: out.raw });
    return res.json({ ok: true, data: out.data });
  } catch (e: any) {
    log.error("debug-claude failed", { message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

app.post("/api/workflows", async (req, res) => {
  try {
    const wf = createWorkflow();
    return res.json({ ok: true, workflow: wf });
  } catch (e: any) {
    log.error("create-workflow failed", { message: e?.message || String(e) });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

app.get("/api/workflows/:id", async (req, res) => {
  try {
    const wf = getWorkflow(String(req.params.id || ""));
    if (!wf) return res.status(404).json({ error: "Workflow not found" });
    return res.json({ ok: true, workflow: wf });
  } catch (e: any) {
    log.error("get-workflow failed", { message: e?.message || String(e) });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

app.post("/api/workflows/:id/extract", async (req, res) => {
  const workflowId = String(req.params.id || "");
  try {
    const ex = await extractDealFromText(req.body);
    if (!ex.ok) {
      recordRun(workflowId, { type: "extract", ok: false, note: ex.error });
      return res.status(400).json({ error: ex.error });
    }
    updateDeal(workflowId, ex.deal);
    recordRun(workflowId, { type: "extract", ok: true, note: `used=${ex.used}` });
    const wf = getWorkflow(workflowId);
    return res.json({ ok: true, used: ex.used, deal: ex.deal, workflow: wf });
  } catch (e: any) {
    try {
      recordRun(workflowId, { type: "extract", ok: false, note: e?.message || String(e) });
    } catch {
      // ignore
    }
    log.error("workflow-extract failed", { message: e?.message || String(e) });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

app.post("/api/workflows/:id/match", async (req, res) => {
  const workflowId = String(req.params.id || "");
  try {
    const wf = getWorkflow(workflowId);
    if (!wf) return res.status(404).json({ error: "Workflow not found" });
    if (!wf.deal) return res.status(400).json({ error: "Workflow has no deal yet. Run extract or provide deal." });

    const result = await runAnalystAgent(wf.deal);
    setResult(workflowId, result);
    recordRun(workflowId, { type: "match", ok: true });
    return res.json({ ok: true, result, workflow: getWorkflow(workflowId) });
  } catch (e: any) {
    try {
      recordRun(workflowId, { type: "match", ok: false, note: e?.message || String(e) });
    } catch {
      // ignore
    }
    log.error("workflow-match failed", { message: e?.message || String(e) });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

const LegacyMatchRequestSchema = z.object({
  dealName: z.string().min(1),
  sector: z.string().min(1),
  geography: z.string().min(1),
  revenueMillions: z.coerce.number().nonnegative().default(0),
  ebitdaMillions: z.coerce.number().nonnegative().default(0),
  dealSizeMillions: z.coerce.number().nonnegative().default(0),
  description: z.string().min(1),
});

const NewMatchRequestSchema = z.object({
  deal: z.object({
    name: z.string().min(1),
    sector: z.string().min(1),
    geography: z.string().min(1),
    revenue: z.coerce.number().nonnegative().default(0),
    ebitda: z.coerce.number().nonnegative().default(0),
    dealSize: z.coerce.number().nonnegative().default(0),
    description: z.string().min(1),
  }),
});

app.post("/api/match-buyers", async (req, res) => {
  try {
    const legacyParsed = LegacyMatchRequestSchema.safeParse(req.body);
    const newParsed = NewMatchRequestSchema.safeParse(req.body);

    let deal: DealInput | null = null;

    if (legacyParsed.success) {
      const b = legacyParsed.data;
      deal = {
        name: b.dealName,
        sector: normalizeSector(b.sector),
        geography: normalizeGeography(b.geography),
        revenue: num(b.revenueMillions, 0),
        ebitda: num(b.ebitdaMillions, 0),
        dealSize: num(b.dealSizeMillions, 0),
        description: b.description,
      };
    } else if (newParsed.success) {
      const d = newParsed.data.deal;
      deal = {
        name: d.name,
        sector: normalizeSector(d.sector),
        geography: normalizeGeography(d.geography),
        revenue: num(d.revenue, 0),
        ebitda: num(d.ebitda, 0),
        dealSize: num(d.dealSize, 0),
        description: d.description,
      };
    }

    if (!deal) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    const result = await runAnalystAgent(deal);
    return res.json(result);
  } catch (e: any) {
    log.error("match-buyers failed", { message: e?.message || String(e) });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

app.post("/api/extract-deal", async (req, res) => {
  try {
    const result = await extractDealFromText(req.body);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json(result);
  } catch (e: any) {
    log.error("extract-deal failed", { message: e?.message || String(e) });
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

// ============================================================================
// CROSSCOURT AI PROTOTYPE: Investment Memo Generator
// ============================================================================

// Upload precedent memos (PDF or DOCX)
app.post("/api/memos/precedents/upload", upload.array("precedents", 10), async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) {
      return res.status(400).json({ ok: false, error: "No files uploaded" });
    }

    const results = [];
    const errors = [];

    for (const file of files) {
      // Extract text from precedent
      const extraction = await extractPrecedentMemo(file.path);

      if (extraction.ok) {
        // Save precedent to storage
        const precedent = savePrecedent({
          filename: file.originalname,
          filePath: file.path,
          extractedText: extraction.text,
          sections: extraction.sections,
          metadata: extraction.metadata,
        });

        results.push({
          id: precedent.id,
          filename: precedent.filename,
          sectionsCount: precedent.sections?.length || 0,
        });
      } else {
        errors.push({ filename: file.originalname, error: extraction.error });
      }
    }

    return res.json({
      ok: true,
      uploaded: results.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e: any) {
    log.error("precedent upload failed", { message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

// Get all precedents
app.get("/api/memos/precedents", (_req, res) => {
  try {
    const precedents = getAllPrecedents();
    return res.json({
      ok: true,
      precedents: precedents.map((p) => ({
        id: p.id,
        filename: p.filename,
        uploadedAt: p.uploadedAt,
        sectionsCount: p.sections?.length || 0,
      })),
    });
  } catch (e: any) {
    log.error("get precedents failed", { message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

// Analyze precedents and create style guide
app.post("/api/memos/style-guides/analyze", async (req, res) => {
  try {
    const { precedentIds, firmName } = req.body;

    if (!Array.isArray(precedentIds) || precedentIds.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "precedentIds must be a non-empty array",
      });
    }

    // Get precedents
    const precedents = precedentIds
      .map((id) => getPrecedent(String(id)))
      .filter((p) => p !== undefined);

    if (precedents.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "No valid precedents found",
      });
    }

    // Analyze and create style guide
    const result = await analyzeStyleFromPrecedents(precedents, firmName);

    if (!result.ok) {
      return res.status(500).json(result);
    }

    // Save style guide
    saveStyleGuide(result.styleGuide!);

    return res.json({
      ok: true,
      styleGuide: result.styleGuide,
    });
  } catch (e: any) {
    log.error("style guide analysis failed", { message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

// Get all style guides
app.get("/api/memos/style-guides", (_req, res) => {
  try {
    const styleGuides = getAllStyleGuides();
    return res.json({
      ok: true,
      styleGuides: styleGuides.map((sg) => ({
        id: sg.id,
        firmName: sg.firmName,
        sectionsCount: sg.sections.length,
        precedentsUsed: sg.precedentIds.length,
        createdAt: sg.createdAt,
      })),
    });
  } catch (e: any) {
    log.error("get style guides failed", { message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

// Get default style guide
app.get("/api/memos/style-guides/default", (_req, res) => {
  try {
    const defaultGuide = getDefaultStyleGuide();
    return res.json({ ok: true, styleGuide: defaultGuide });
  } catch (e: any) {
    log.error("get default style guide failed", { message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

// Generate investment memo
app.post("/api/memos/generate", async (req, res) => {
  try {
    const { dealName, dealData, styleGuideId, useDefaultTemplate } = req.body;

    if (!dealName || !dealData) {
      return res.status(400).json({
        ok: false,
        error: "dealName and dealData are required",
      });
    }

    // Get style guide
    let styleGuide;
    if (!useDefaultTemplate && styleGuideId) {
      styleGuide = getStyleGuide(styleGuideId);
      if (!styleGuide) {
        return res.status(404).json({
          ok: false,
          error: `Style guide not found: ${styleGuideId}`,
        });
      }
    }

    // Generate memo
    const result = await generateInvestmentMemo(
      { dealName, dealData, styleGuideId },
      styleGuide
    );

    if (!result.ok) {
      return res.status(500).json(result);
    }

    // Save generated memo
    saveGeneratedMemo(result.memo!);

    return res.json({
      ok: true,
      memo: result.memo,
    });
  } catch (e: any) {
    log.error("memo generation failed", { message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

// Get all generated memos
app.get("/api/memos/generated", (_req, res) => {
  try {
    const memos = getAllGeneratedMemos();
    return res.json({
      ok: true,
      memos: memos.map((m) => ({
        id: m.id,
        dealName: m.dealName,
        title: m.title,
        status: m.status,
        generatedAt: m.generatedAt,
        sectionsCount: m.sections.length,
        exportPath: m.exportPath,
      })),
    });
  } catch (e: any) {
    log.error("get generated memos failed", { message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

// Get specific memo
app.get("/api/memos/generated/:id", (req, res) => {
  try {
    const memo = getGeneratedMemo(req.params.id);
    if (!memo) {
      return res.status(404).json({ ok: false, error: "Memo not found" });
    }
    return res.json({ ok: true, memo });
  } catch (e: any) {
    log.error("get memo failed", { message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

// Export memo to DOCX
app.post("/api/memos/generated/:id/export", async (req, res) => {
  try {
    const memo = getGeneratedMemo(req.params.id);
    if (!memo) {
      return res.status(404).json({ ok: false, error: "Memo not found" });
    }

    // Convert memo to DOCX data format
    const docxData = memoToDocxData(memo);

    // Generate filename
    const sanitizedName = memo.dealName.replace(/[^a-z0-9]/gi, "_");
    const filename = `memo_${sanitizedName}_${Date.now()}.docx`;

    // Export to DOCX
    const result = await exportToDocx(docxData, filename);

    if (!result.ok) {
      return res.status(500).json(result);
    }

    // Update memo with export path
    setMemoExportPath(memo.id, result.path!);

    return res.json({
      ok: true,
      path: result.path,
      filename,
    });
  } catch (e: any) {
    log.error("memo export failed", { message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

// Download exported memo
app.get("/api/memos/download/:filename", (req, res) => {
  try {
    const path = require("path");
    const filePath = path.join(process.cwd(), "exports", req.params.filename);
    res.download(filePath);
  } catch (e: any) {
    log.error("memo download failed", { message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

// Get stats
app.get("/api/memos/stats", (_req, res) => {
  try {
    const stats = getMemoStats();
    return res.json({ ok: true, stats });
  } catch (e: any) {
    log.error("get memo stats failed", { message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

// ============================================================================

// Multer error handler (must be after all routes)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    log.error("Multer error", { code: err.code, message: err.message, field: err.field });
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ ok: false, error: "File too large (max 150MB per file)" });
    }
    return res.status(400).json({ ok: false, error: err.message });
  }
  // Pass other errors to default handler
  if (err) {
    log.error("Unhandled error", { message: err?.message || String(err) });
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
  next();
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  log.info(`Server running on http://localhost:${PORT}`);
});