"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractFinancialsFromPdfs = extractFinancialsFromPdfs;
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const logger_1 = require("./logger");
async function extractFinancialsFromPdfs(opts) {
    // LLM calls can take time, especially for multiple PDFs. Scale timeout with #pdfs.
    const computedTimeoutMs = 60000 + Math.max(1, opts.pdfPaths.length) * 240000; // 1m + 4m per PDF
    const timeoutMs = opts.timeoutMs ?? Math.max(180000, computedTimeoutMs);
    const repoRoot = node_path_1.default.resolve(__dirname, "..", "..");
    const scriptPath = node_path_1.default.join(repoRoot, "python_ml", "extract_financials_from_pdfs.py");
    return await new Promise((resolve) => {
        const startedAt = Date.now();
        logger_1.log.info("PDF financial extraction start", { scriptPath, pdfs: opts.pdfPaths.length });
        const child = (0, node_child_process_1.spawn)("python3", [scriptPath], {
            stdio: ["pipe", "pipe", "pipe"],
            env: process.env,
            cwd: repoRoot, // so `import test` works
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve({ ok: false, error: `PDF extraction timed out after ${timeoutMs}ms` });
        }, timeoutMs);
        child.stdout.on("data", (d) => (stdout += d.toString("utf-8")));
        child.stderr.on("data", (d) => (stderr += d.toString("utf-8")));
        child.on("close", (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                logger_1.log.error("PDF financial extraction failed", { code, ms: Date.now() - startedAt, stderr: stderr.slice(0, 2000) });
                return resolve({ ok: false, error: stderr || `Python exited with code ${code}` });
            }
            try {
                const parsed = JSON.parse(stdout);
                if (!parsed?.ok)
                    return resolve({ ok: false, error: parsed?.error || "Unknown error" });
                logger_1.log.info("PDF financial extraction ok", { ms: Date.now() - startedAt });
                return resolve({
                    ok: true,
                    company: String(parsed.company || ""),
                    currency: String(parsed.currency || ""),
                    years: Array.isArray(parsed.years) ? parsed.years : [],
                    tableText: String(parsed.tableText || ""),
                });
            }
            catch (e) {
                logger_1.log.error("PDF financial extraction parse failed", { ms: Date.now() - startedAt, message: e?.message || String(e) });
                return resolve({ ok: false, error: `Failed to parse Python JSON. Raw stdout: ${stdout.slice(0, 2000)}` });
            }
        });
        child.stdin.write(JSON.stringify({ pdfPaths: opts.pdfPaths, highlight: !!opts.highlight }));
        child.stdin.end();
    });
}
