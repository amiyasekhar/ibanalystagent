"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.claudeJson = claudeJson;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const logger_1 = require("./logger");
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
    // Don’t crash the server at import-time, but make it obvious in logs.
    logger_1.log.warn("[Claude] ANTHROPIC_API_KEY is missing. LLM features will fall back to templates.");
}
const client = new sdk_1.default({
    apiKey: apiKey || "missing",
});
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929";
function extractJsonObject(text) {
    // Try to find the first JSON object in the response
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start)
        return null;
    const candidate = text.slice(start, end + 1);
    try {
        return JSON.parse(candidate);
    }
    catch {
        return null;
    }
}
async function claudeJson(opts) {
    if (!process.env.ANTHROPIC_API_KEY) {
        return { ok: false, error: "Missing ANTHROPIC_API_KEY" };
    }
    const startedAt = Date.now();
    try {
        const msg = await client.messages.create({
            model: DEFAULT_MODEL,
            max_tokens: opts.maxTokens ?? 1200,
            system: opts.system,
            messages: [{ role: "user", content: opts.prompt }],
            temperature: 0.2,
        });
        // SDK returns array blocks; common is text blocks
        const rawText = msg.content
            ?.map((b) => (b?.type === "text" ? b.text : ""))
            .join("\n")
            .trim() || "";
        const parsed = extractJsonObject(rawText);
        if (!parsed) {
            logger_1.log.warn("[Claude] Response was not valid JSON", {
                model: DEFAULT_MODEL,
                ms: Date.now() - startedAt,
            });
            return { ok: false, error: "Claude did not return valid JSON", raw: rawText };
        }
        logger_1.log.info("[Claude] Call succeeded", {
            model: DEFAULT_MODEL,
            ms: Date.now() - startedAt,
        });
        return { ok: true, data: parsed };
    }
    catch (e) {
        logger_1.log.error("[Claude] Call failed", {
            model: DEFAULT_MODEL,
            ms: Date.now() - startedAt,
            message: e?.message || String(e),
        });
        return { ok: false, error: e?.message || "Claude call failed" };
    }
}
