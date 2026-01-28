"use strict";
/**
 * Extract text and structure from precedent investment memos.
 * Bridges to Python extraction scripts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPrecedentMemo = extractPrecedentMemo;
exports.extractMultiplePrecedents = extractMultiplePrecedents;
const child_process_1 = require("child_process");
const logger_1 = require("./logger");
/**
 * Extract text from a precedent memo file (PDF or DOCX).
 */
async function extractPrecedentMemo(filePath) {
    return new Promise((resolve) => {
        const pythonScript = "python_ml/extract_precedent.py";
        const proc = (0, child_process_1.spawn)("python3", [pythonScript, filePath]);
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (data) => {
            stdout += data.toString();
        });
        proc.stderr.on("data", (data) => {
            stderr += data.toString();
        });
        const timeout = setTimeout(() => {
            proc.kill();
            logger_1.log.error("precedent extraction timeout", { filePath });
            resolve({ ok: false, error: "Extraction timeout (2 minutes)" });
        }, 2 * 60 * 1000); // 2 minute timeout
        proc.on("close", (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                logger_1.log.error("precedent extraction failed", { code, stderr, filePath });
                return resolve({ ok: false, error: stderr || "Extraction failed" });
            }
            try {
                const result = JSON.parse(stdout);
                if (!result.ok) {
                    return resolve({ ok: false, error: result.error || "Unknown error" });
                }
                return resolve({
                    ok: true,
                    text: result.text,
                    sections: result.sections || [],
                    metadata: result.metadata || {},
                });
            }
            catch (e) {
                logger_1.log.error("precedent extraction parse error", { message: e.message, stdout });
                return resolve({ ok: false, error: "Failed to parse extraction output" });
            }
        });
    });
}
/**
 * Extract text from multiple precedent memos.
 */
async function extractMultiplePrecedents(filePaths) {
    const results = [];
    const errors = [];
    for (const filePath of filePaths) {
        const result = await extractPrecedentMemo(filePath);
        results.push({ filePath, result });
        if (!result.ok) {
            errors.push(`${filePath}: ${result.error}`);
        }
    }
    return {
        ok: errors.length === 0,
        results,
        errors,
    };
}
