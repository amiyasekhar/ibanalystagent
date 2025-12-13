import { spawn } from "node:child_process";
import path from "node:path";
import { BuyerProfile, DealInput } from "./types";
import { log } from "./logger";

export type PythonBuyerScore = {
  buyerId: string;
  score: number;
  features: {
    sectorMatch: number;
    geoMatch: number;
    sizeFit: number;
    dryPowderFit: number;
    activityLevel: number;
    ebitdaFit: number;
  };
};

export type PythonInferResponse = {
  modelVersion: string;
  scores: PythonBuyerScore[];
};

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export async function inferBuyerScoresPython(opts: {
  deal: DealInput;
  buyers: BuyerProfile[];
  timeoutMs?: number;
}): Promise<PythonInferResponse> {
  const timeoutMs = opts.timeoutMs ?? 6000;

  const repoRoot = path.resolve(__dirname, "..", "..");
  const scriptPath = path.join(repoRoot, "python_ml", "infer.py");

  const payload = JSON.stringify({ deal: opts.deal, buyers: opts.buyers });

  return await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    log.info("Python inference start", { scriptPath, buyers: opts.buyers.length });

    const child = spawn("python3", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Python ML inference timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString("utf-8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf-8")));

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        log.error("Python inference failed", {
          code,
          ms: Date.now() - startedAt,
          stderr: stderr?.slice(0, 2000),
        });
        return reject(new Error(`Python ML inference failed (code=${code}): ${stderr || stdout}`));
      }
      try {
        const parsed = JSON.parse(stdout) as PythonInferResponse;
        // sanitize
        parsed.scores = (parsed.scores || []).map((s) => ({
          ...s,
          score: clamp01(Number(s.score)),
          features: {
            sectorMatch: clamp01(Number(s.features?.sectorMatch)),
            geoMatch: clamp01(Number(s.features?.geoMatch)),
            sizeFit: clamp01(Number(s.features?.sizeFit)),
            dryPowderFit: clamp01(Number(s.features?.dryPowderFit)),
            activityLevel: clamp01(Number(s.features?.activityLevel)),
            ebitdaFit: clamp01(Number(s.features?.ebitdaFit)),
          },
        }));
        log.info("Python inference ok", { ms: Date.now() - startedAt, modelVersion: parsed.modelVersion });
        resolve(parsed);
      } catch (e: any) {
        log.error("Python inference parse failed", { ms: Date.now() - startedAt, message: e?.message || String(e) });
        reject(new Error(`Failed to parse Python ML JSON: ${e?.message || e}. Raw stdout=${stdout}`));
      }
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}


