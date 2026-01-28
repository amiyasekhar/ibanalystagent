"use strict";
/**
 * Export documents to Office formats (DOCX, PPTX).
 * Bridges to Python document generation scripts.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportToDocx = exportToDocx;
exports.extractFromDocx = extractFromDocx;
const child_process_1 = require("child_process");
const logger_1 = require("./logger");
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
/**
 * Export memo data to DOCX format.
 */
async function exportToDocx(memoData, outputFilename) {
    return new Promise(async (resolve) => {
        try {
            // Ensure exports directory exists
            const exportsDir = path_1.default.join(process.cwd(), "exports");
            await promises_1.default.mkdir(exportsDir, { recursive: true });
            const outputPath = path_1.default.join(exportsDir, outputFilename);
            // Add output path to memo data
            const dataWithPath = {
                ...memoData,
                outputPath,
            };
            const pythonScript = "python_ml/export_docx.py";
            const proc = (0, child_process_1.spawn)("python3", [pythonScript, "create"]);
            // Send memo data via stdin
            proc.stdin.write(JSON.stringify(dataWithPath));
            proc.stdin.end();
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
                logger_1.log.error("docx export timeout", { outputFilename });
                resolve({ ok: false, error: "Export timeout (1 minute)" });
            }, 60 * 1000); // 1 minute timeout
            proc.on("close", (code) => {
                clearTimeout(timeout);
                if (code !== 0) {
                    logger_1.log.error("docx export failed", { code, stderr, outputFilename });
                    return resolve({ ok: false, error: stderr || "Export failed" });
                }
                try {
                    const result = JSON.parse(stdout);
                    if (!result.ok) {
                        return resolve({ ok: false, error: result.error || "Unknown error" });
                    }
                    logger_1.log.info("docx exported successfully", { path: result.path });
                    return resolve({
                        ok: true,
                        path: result.path,
                    });
                }
                catch (e) {
                    logger_1.log.error("docx export parse error", { message: e.message, stdout });
                    return resolve({ ok: false, error: "Failed to parse export output" });
                }
            });
        }
        catch (e) {
            logger_1.log.error("docx export exception", { message: e.message });
            resolve({ ok: false, error: e.message || "Unknown error" });
        }
    });
}
/**
 * Extract text from existing DOCX file.
 */
async function extractFromDocx(docxPath) {
    return new Promise((resolve) => {
        const pythonScript = "python_ml/export_docx.py";
        const proc = (0, child_process_1.spawn)("python3", [pythonScript, "extract", docxPath]);
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
            logger_1.log.error("docx extraction timeout", { docxPath });
            resolve({ ok: false, error: "Extraction timeout (1 minute)" });
        }, 60 * 1000);
        proc.on("close", (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                logger_1.log.error("docx extraction failed", { code, stderr });
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
                    sections: result.sections,
                });
            }
            catch (e) {
                logger_1.log.error("docx extraction parse error", { message: e.message, stdout });
                return resolve({ ok: false, error: "Failed to parse extraction output" });
            }
        });
    });
}
