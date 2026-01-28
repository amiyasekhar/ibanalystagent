/**
 * Export documents to Office formats (DOCX, PPTX).
 * Bridges to Python document generation scripts.
 */

import { spawn } from "child_process";
import { log } from "./logger";
import path from "path";
import fs from "fs/promises";

interface ExportResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Export memo data to DOCX format.
 */
export async function exportToDocx(memoData: any, outputFilename: string): Promise<ExportResult> {
  return new Promise(async (resolve) => {
    try {
      // Ensure exports directory exists
      const exportsDir = path.join(process.cwd(), "exports");
      await fs.mkdir(exportsDir, { recursive: true });

      const outputPath = path.join(exportsDir, outputFilename);

      // Add output path to memo data
      const dataWithPath = {
        ...memoData,
        outputPath,
      };

      const pythonScript = "python_ml/export_docx.py";
      const proc = spawn("python3", [pythonScript, "create"]);

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
        log.error("docx export timeout", { outputFilename });
        resolve({ ok: false, error: "Export timeout (1 minute)" });
      }, 60 * 1000); // 1 minute timeout

      proc.on("close", (code) => {
        clearTimeout(timeout);

        if (code !== 0) {
          log.error("docx export failed", { code, stderr, outputFilename });
          return resolve({ ok: false, error: stderr || "Export failed" });
        }

        try {
          const result = JSON.parse(stdout);
          if (!result.ok) {
            return resolve({ ok: false, error: result.error || "Unknown error" });
          }

          log.info("docx exported successfully", { path: result.path });
          return resolve({
            ok: true,
            path: result.path,
          });
        } catch (e: any) {
          log.error("docx export parse error", { message: e.message, stdout });
          return resolve({ ok: false, error: "Failed to parse export output" });
        }
      });
    } catch (e: any) {
      log.error("docx export exception", { message: e.message });
      resolve({ ok: false, error: e.message || "Unknown error" });
    }
  });
}

/**
 * Extract text from existing DOCX file.
 */
export async function extractFromDocx(docxPath: string): Promise<{
  ok: boolean;
  text?: string;
  sections?: any[];
  error?: string;
}> {
  return new Promise((resolve) => {
    const pythonScript = "python_ml/export_docx.py";
    const proc = spawn("python3", [pythonScript, "extract", docxPath]);

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
      log.error("docx extraction timeout", { docxPath });
      resolve({ ok: false, error: "Extraction timeout (1 minute)" });
    }, 60 * 1000);

    proc.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        log.error("docx extraction failed", { code, stderr });
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
      } catch (e: any) {
        log.error("docx extraction parse error", { message: e.message, stdout });
        return resolve({ ok: false, error: "Failed to parse extraction output" });
      }
    });
  });
}
