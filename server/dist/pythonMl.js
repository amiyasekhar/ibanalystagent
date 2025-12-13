"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferBuyerScoresPython = inferBuyerScoresPython;
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const logger_1 = require("./logger");
function clamp01(x) {
    if (!Number.isFinite(x))
        return 0;
    return Math.max(0, Math.min(1, x));
}
async function inferBuyerScoresPython(opts) {
    const timeoutMs = opts.timeoutMs ?? 6000;
    const repoRoot = node_path_1.default.resolve(__dirname, "..", "..");
    const scriptPath = node_path_1.default.join(repoRoot, "python_ml", "infer.py");
    const payload = JSON.stringify({ deal: opts.deal, buyers: opts.buyers });
    return await new Promise((resolve, reject) => {
        const startedAt = Date.now();
        logger_1.log.info("Python inference start", { scriptPath, buyers: opts.buyers.length });
        const child = (0, node_child_process_1.spawn)("python3", [scriptPath], {
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
                logger_1.log.error("Python inference failed", {
                    code,
                    ms: Date.now() - startedAt,
                    stderr: stderr?.slice(0, 2000),
                });
                return reject(new Error(`Python ML inference failed (code=${code}): ${stderr || stdout}`));
            }
            try {
                const parsed = JSON.parse(stdout);
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
                logger_1.log.info("Python inference ok", { ms: Date.now() - startedAt, modelVersion: parsed.modelVersion });
                resolve(parsed);
            }
            catch (e) {
                logger_1.log.error("Python inference parse failed", { ms: Date.now() - startedAt, message: e?.message || String(e) });
                reject(new Error(`Failed to parse Python ML JSON: ${e?.message || e}. Raw stdout=${stdout}`));
            }
        });
        child.stdin.write(payload);
        child.stdin.end();
    });
}
