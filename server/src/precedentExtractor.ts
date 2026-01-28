/**
 * Extract text and structure from precedent investment memos.
 * Bridges to Python extraction scripts.
 */

import { spawn } from "child_process";
import { log } from "./logger";
import { PrecedentMemo, PrecedentSection } from "./memoTypes";

interface ExtractionResult {
  ok: boolean;
  text?: string;
  sections?: PrecedentSection[];
  metadata?: any;
  error?: string;
}

/**
 * Extract text from a precedent memo file (PDF or DOCX).
 */
export async function extractPrecedentMemo(filePath: string): Promise<ExtractionResult> {
  return new Promise((resolve) => {
    const pythonScript = "python_ml/extract_precedent.py";
    const proc = spawn("python3", [pythonScript, filePath]);

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
      log.error("precedent extraction timeout", { filePath });
      resolve({ ok: false, error: "Extraction timeout (2 minutes)" });
    }, 2 * 60 * 1000); // 2 minute timeout

    proc.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        log.error("precedent extraction failed", { code, stderr, filePath });
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
      } catch (e: any) {
        log.error("precedent extraction parse error", { message: e.message, stdout });
        return resolve({ ok: false, error: "Failed to parse extraction output" });
      }
    });
  });
}

/**
 * Extract text from multiple precedent memos.
 */
export async function extractMultiplePrecedents(
  filePaths: string[]
): Promise<{
  ok: boolean;
  results: Array<{ filePath: string; result: ExtractionResult }>;
  errors: string[];
}> {
  const results: Array<{ filePath: string; result: ExtractionResult }> = [];
  const errors: string[] = [];

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
