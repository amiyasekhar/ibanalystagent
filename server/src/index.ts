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

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use(requestLoggingMiddleware);

app.get("/health", (_req, res) => res.json({ ok: true }));

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

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  log.info(`Server running on http://localhost:${PORT}`);
});