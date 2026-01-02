import Anthropic from "@anthropic-ai/sdk";
import { log } from "./logger";

const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  // Don’t crash the server at import-time, but make it obvious in logs.
  log.warn("[Claude] ANTHROPIC_API_KEY is missing. LLM features will fall back to templates.");
}

const client = new Anthropic({
  apiKey: apiKey || "missing",
});

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929";

function extractJsonObject(text: string): any | null {
  // Try to find the first JSON object in the response
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

export async function claudeJson<T>(opts: {
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<{ ok: true; data: T } | { ok: false; error: string; raw?: string }> {
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
    const rawText =
      msg.content
        ?.map((b: any) => (b?.type === "text" ? b.text : ""))
        .join("\n")
        .trim() || "";

    const parsed = extractJsonObject(rawText);
    if (!parsed) {
      log.warn("[Claude] Response was not valid JSON", {
        model: DEFAULT_MODEL,
        ms: Date.now() - startedAt,
      });
      return { ok: false, error: "Claude did not return valid JSON", raw: rawText };
    }

    log.info("[Claude] Call succeeded", {
      model: DEFAULT_MODEL,
      ms: Date.now() - startedAt,
    });
    return { ok: true, data: parsed as T };
  } catch (e: any) {
    log.error("[Claude] Call failed", {
      model: DEFAULT_MODEL,
      ms: Date.now() - startedAt,
      message: e?.message || String(e),
    });
    return { ok: false, error: e?.message || "Claude call failed" };
  }
}