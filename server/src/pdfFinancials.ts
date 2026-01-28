import { spawn } from "node:child_process";
import path from "node:path";
import { log } from "./logger";

export type ExtractFinancialsResponse =
  | { ok: true; company: string; currency: string; years: any[]; tableText: string }
  | { ok: false; error: string };

export async function extractFinancialsFromPdfs(opts: { pdfPaths: string[]; highlight?: boolean; timeoutMs?: number }): Promise<ExtractFinancialsResponse> {
  // LLM calls can take time, especially for multiple PDFs. Scale timeout with #pdfs.
  const computedTimeoutMs = 60_000 + Math.max(1, opts.pdfPaths.length) * 240_000; // 1m + 4m per PDF
  const timeoutMs = opts.timeoutMs ?? Math.max(180_000, computedTimeoutMs);
  const repoRoot = path.resolve(__dirname, "..", "..");
  const scriptPath = path.join(repoRoot, "python_ml", "extract_financials_from_pdfs.py");

  return await new Promise((resolve) => {
    const startedAt = Date.now();
    log.info("PDF financial extraction start", { scriptPath, pdfs: opts.pdfPaths.length });

    const child = spawn("python3", [scriptPath], {
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
        log.error("PDF financial extraction failed", { code, ms: Date.now() - startedAt, stderr: stderr.slice(0, 2000) });
        return resolve({ ok: false, error: stderr || `Python exited with code ${code}` });
      }
      try {
        const parsed = JSON.parse(stdout) as any;
        if (!parsed?.ok) return resolve({ ok: false, error: parsed?.error || "Unknown error" });
        log.info("PDF financial extraction ok", { ms: Date.now() - startedAt, debug: stderr.slice(0, 3000) });
        return resolve({
          ok: true,
          company: String(parsed.company || ""),
          currency: String(parsed.currency || ""),
          years: Array.isArray(parsed.years) ? parsed.years : [],
          tableText: String(parsed.tableText || ""),
        });
      } catch (e: any) {
        log.error("PDF financial extraction parse failed", { ms: Date.now() - startedAt, message: e?.message || String(e) });
        return resolve({ ok: false, error: `Failed to parse Python JSON. Raw stdout: ${stdout.slice(0, 2000)}` });
      }
    });

    child.stdin.write(JSON.stringify({ pdfPaths: opts.pdfPaths, highlight: !!opts.highlight }));
    child.stdin.end();
  });
}


