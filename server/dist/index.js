"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("./loadEnv");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const zod_1 = require("zod");
const agent_1 = require("./agent");
const extractDeal_1 = require("./extractDeal");
const normalize_1 = require("./normalize");
const logger_1 = require("./logger");
const workflows_1 = require("./workflows");
const claude_1 = require("./claude");
const requestLogging_1 = require("./requestLogging");
const buyerSearch_1 = require("./buyerSearch");
const generateRawDealText_1 = require("./generateRawDealText");
const pdfFinancials_1 = require("./pdfFinancials");
const multer_1 = __importDefault(require("multer"));
const uploadUtils_1 = require("./uploadUtils");
// Clear server log on each (re)start so it doesn't contain old runs.
// Set LOG_APPEND=1 to keep appending across restarts.
if (String(process.env.LOG_APPEND || "").trim() !== "1") {
    try {
        logger_1.log.clear();
    }
    catch {
        // ignore
    }
}
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: true }));
app.use(express_1.default.json({ limit: "1mb" }));
app.use(requestLogging_1.requestLoggingMiddleware);
app.get("/health", (_req, res) => res.json({ ok: true }));
const upload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (_req, _file, cb) => cb(null, (0, uploadUtils_1.ensureUploadsDir)()),
        filename: (_req, file, cb) => {
            const safe = (0, uploadUtils_1.sanitizeFilename)(file.originalname || "upload.pdf");
            cb(null, `${Date.now()}-${safe}`);
        },
    }),
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file
});
// Drag/drop upload endpoint: upload PDFs and immediately extract financials.
app.post("/api/extract-financials-from-upload", upload.array("pdfs", 50), async (req, res) => {
    try {
        const files = req.files || [];
        const highlight = String(req.body?.highlight || "").toLowerCase() === "true";
        if (!files.length)
            return res.status(400).json({ ok: false, error: "No PDF files uploaded" });
        const pdfPaths = files.map((f) => f.path);
        const out = await (0, pdfFinancials_1.extractFinancialsFromPdfs)({ pdfPaths, highlight });
        // Cleanup uploaded temp files (keep highlighted PDFs if generated).
        try {
            const fs = await Promise.resolve().then(() => __importStar(require("node:fs/promises")));
            await Promise.all(files.map(async (f) => {
                try {
                    await fs.unlink(f.path);
                }
                catch {
                    // ignore
                }
            }));
        }
        catch {
            // ignore
        }
        if (!out.ok)
            return res.status(500).json(out);
        return res.json({ ...out, uploaded: files.map((f) => ({ originalName: f.originalname })) });
    }
    catch (e) {
        logger_1.log.error("extract-financials-from-upload failed", { message: e?.message || String(e) });
        return res.status(500).json({ ok: false, error: e?.message || "Server error" });
    }
});
app.post("/api/extract-financials-from-pdf", async (req, res) => {
    try {
        const pdfPaths = Array.isArray(req.body?.pdfPaths) ? req.body.pdfPaths.map(String) : [];
        const highlight = Boolean(req.body?.highlight);
        if (!pdfPaths.length)
            return res.status(400).json({ ok: false, error: "pdfPaths must be a non-empty array" });
        const out = await (0, pdfFinancials_1.extractFinancialsFromPdfs)({ pdfPaths, highlight });
        if (!out.ok)
            return res.status(500).json(out);
        return res.json(out);
    }
    catch (e) {
        logger_1.log.error("extract-financials-from-pdf failed", { message: e?.message || String(e) });
        return res.status(500).json({ ok: false, error: e?.message || "Server error" });
    }
});
app.post("/api/generate-raw-deal-text", async (req, res) => {
    try {
        const out = await (0, generateRawDealText_1.generateRawDealText)(req.body);
        if (!out.ok)
            return res.status(400).json(out);
        return res.json(out);
    }
    catch (e) {
        logger_1.log.error("generate-raw-deal-text failed", { message: e?.message || String(e) });
        return res.status(500).json({ ok: false, error: e?.message || "Server error" });
    }
});
app.get("/api/buyers/search", (req, res) => {
    try {
        const q = typeof req.query.q === "string" ? req.query.q : "";
        const sector = typeof req.query.sector === "string" ? req.query.sector : "Any";
        const geography = typeof req.query.geography === "string" ? req.query.geography : "";
        const type = typeof req.query.type === "string" ? req.query.type : "Any";
        const tag = typeof req.query.tag === "string" ? req.query.tag : "";
        const minDeal = req.query.minDeal != null ? Number(req.query.minDeal) : undefined;
        const maxDeal = req.query.maxDeal != null ? Number(req.query.maxDeal) : undefined;
        const minEbitda = req.query.minEbitda != null ? Number(req.query.minEbitda) : undefined;
        const maxEbitda = req.query.maxEbitda != null ? Number(req.query.maxEbitda) : undefined;
        const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
        const results = (0, buyerSearch_1.searchBuyers)({
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
    }
    catch (e) {
        logger_1.log.error("buyer-search failed", { message: e?.message || String(e) });
        return res.status(500).json({ ok: false, error: e?.message || "Server error" });
    }
});
app.get("/api/debug/claude", async (_req, res) => {
    try {
        const system = "Return STRICT JSON only. No markdown.";
        const prompt = `Return JSON exactly:\n{ "ping": "pong" }`;
        const out = await (0, claude_1.claudeJson)({ system, prompt, maxTokens: 50 });
        if (!out.ok)
            return res.status(500).json({ ok: false, error: out.error, raw: out.raw });
        return res.json({ ok: true, data: out.data });
    }
    catch (e) {
        logger_1.log.error("debug-claude failed", { message: e?.message || String(e) });
        return res.status(500).json({ ok: false, error: e?.message || "Server error" });
    }
});
app.post("/api/workflows", async (req, res) => {
    try {
        const wf = (0, workflows_1.createWorkflow)();
        return res.json({ ok: true, workflow: wf });
    }
    catch (e) {
        logger_1.log.error("create-workflow failed", { message: e?.message || String(e) });
        return res.status(500).json({ error: e?.message || "Server error" });
    }
});
app.get("/api/workflows/:id", async (req, res) => {
    try {
        const wf = (0, workflows_1.getWorkflow)(String(req.params.id || ""));
        if (!wf)
            return res.status(404).json({ error: "Workflow not found" });
        return res.json({ ok: true, workflow: wf });
    }
    catch (e) {
        logger_1.log.error("get-workflow failed", { message: e?.message || String(e) });
        return res.status(500).json({ error: e?.message || "Server error" });
    }
});
app.post("/api/workflows/:id/extract", async (req, res) => {
    const workflowId = String(req.params.id || "");
    try {
        const ex = await (0, extractDeal_1.extractDealFromText)(req.body);
        if (!ex.ok) {
            (0, workflows_1.recordRun)(workflowId, { type: "extract", ok: false, note: ex.error });
            return res.status(400).json({ error: ex.error });
        }
        (0, workflows_1.updateDeal)(workflowId, ex.deal);
        (0, workflows_1.recordRun)(workflowId, { type: "extract", ok: true, note: `used=${ex.used}` });
        const wf = (0, workflows_1.getWorkflow)(workflowId);
        return res.json({ ok: true, used: ex.used, deal: ex.deal, workflow: wf });
    }
    catch (e) {
        try {
            (0, workflows_1.recordRun)(workflowId, { type: "extract", ok: false, note: e?.message || String(e) });
        }
        catch {
            // ignore
        }
        logger_1.log.error("workflow-extract failed", { message: e?.message || String(e) });
        return res.status(500).json({ error: e?.message || "Server error" });
    }
});
app.post("/api/workflows/:id/match", async (req, res) => {
    const workflowId = String(req.params.id || "");
    try {
        const wf = (0, workflows_1.getWorkflow)(workflowId);
        if (!wf)
            return res.status(404).json({ error: "Workflow not found" });
        if (!wf.deal)
            return res.status(400).json({ error: "Workflow has no deal yet. Run extract or provide deal." });
        const result = await (0, agent_1.runAnalystAgent)(wf.deal);
        (0, workflows_1.setResult)(workflowId, result);
        (0, workflows_1.recordRun)(workflowId, { type: "match", ok: true });
        return res.json({ ok: true, result, workflow: (0, workflows_1.getWorkflow)(workflowId) });
    }
    catch (e) {
        try {
            (0, workflows_1.recordRun)(workflowId, { type: "match", ok: false, note: e?.message || String(e) });
        }
        catch {
            // ignore
        }
        logger_1.log.error("workflow-match failed", { message: e?.message || String(e) });
        return res.status(500).json({ error: e?.message || "Server error" });
    }
});
const LegacyMatchRequestSchema = zod_1.z.object({
    dealName: zod_1.z.string().min(1),
    sector: zod_1.z.string().min(1),
    geography: zod_1.z.string().min(1),
    revenueMillions: zod_1.z.coerce.number().nonnegative().default(0),
    ebitdaMillions: zod_1.z.coerce.number().nonnegative().default(0),
    dealSizeMillions: zod_1.z.coerce.number().nonnegative().default(0),
    description: zod_1.z.string().min(1),
});
const NewMatchRequestSchema = zod_1.z.object({
    deal: zod_1.z.object({
        name: zod_1.z.string().min(1),
        sector: zod_1.z.string().min(1),
        geography: zod_1.z.string().min(1),
        revenue: zod_1.z.coerce.number().nonnegative().default(0),
        ebitda: zod_1.z.coerce.number().nonnegative().default(0),
        dealSize: zod_1.z.coerce.number().nonnegative().default(0),
        description: zod_1.z.string().min(1),
    }),
});
app.post("/api/match-buyers", async (req, res) => {
    try {
        const legacyParsed = LegacyMatchRequestSchema.safeParse(req.body);
        const newParsed = NewMatchRequestSchema.safeParse(req.body);
        let deal = null;
        if (legacyParsed.success) {
            const b = legacyParsed.data;
            deal = {
                name: b.dealName,
                sector: (0, normalize_1.normalizeSector)(b.sector),
                geography: (0, normalize_1.normalizeGeography)(b.geography),
                revenue: (0, normalize_1.num)(b.revenueMillions, 0),
                ebitda: (0, normalize_1.num)(b.ebitdaMillions, 0),
                dealSize: (0, normalize_1.num)(b.dealSizeMillions, 0),
                description: b.description,
            };
        }
        else if (newParsed.success) {
            const d = newParsed.data.deal;
            deal = {
                name: d.name,
                sector: (0, normalize_1.normalizeSector)(d.sector),
                geography: (0, normalize_1.normalizeGeography)(d.geography),
                revenue: (0, normalize_1.num)(d.revenue, 0),
                ebitda: (0, normalize_1.num)(d.ebitda, 0),
                dealSize: (0, normalize_1.num)(d.dealSize, 0),
                description: d.description,
            };
        }
        if (!deal) {
            return res.status(400).json({ error: "Invalid request body" });
        }
        const result = await (0, agent_1.runAnalystAgent)(deal);
        return res.json(result);
    }
    catch (e) {
        logger_1.log.error("match-buyers failed", { message: e?.message || String(e) });
        return res.status(500).json({ error: e?.message || "Server error" });
    }
});
app.post("/api/extract-deal", async (req, res) => {
    try {
        const result = await (0, extractDeal_1.extractDealFromText)(req.body);
        if (!result.ok)
            return res.status(400).json({ error: result.error });
        return res.json(result);
    }
    catch (e) {
        logger_1.log.error("extract-deal failed", { message: e?.message || String(e) });
        return res.status(500).json({ error: e?.message || "Server error" });
    }
});
const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
    logger_1.log.info(`Server running on http://localhost:${PORT}`);
});
